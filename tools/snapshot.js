/* 视觉快照脚本：在指定菜品的指定阶段截图，用于人工复核布局。 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params})); });
}
async function ev(e) { const r = await send("Runtime.evaluate", {expression: e, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception)); return r.result?.value; }
async function shot(name) { const r = await send("Page.captureScreenshot", {format:"png"}); fs.writeFileSync(path.join(ROOT,name), Buffer.from(r.data,"base64")); console.log("  [截图] "+name); }
async function mouse(type,x,y){ await send("Input.dispatchMouseEvent",{type,x,y,button:"left",clickCount:1}); }

(async () => {
  const chrome = spawn(CHROME, ["--headless=new","--remote-debugging-port=9224","--window-size=1280,860","--no-first-run","--user-data-dir="+path.join(ROOT,".chrome-shot")], {stdio:"ignore"});
  let targets=null;
  for (let i=0;i<40;i++){ try{ targets=await (await fetch("http://127.0.0.1:9224/json")).json(); if(targets.some(t=>t.type==="page")) break; }catch(e){} await sleep(300); }
  ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=(e)=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}};
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate",{url:"http://127.0.0.1:8931/index.html?nocache="+Date.now()});
  await sleep(1800);
  await ev(`document.getElementById('btn-start').click()`); await sleep(800);
  await shot("_shot_menu.png");
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(500);
  await shot("_shot_dishintro.png");
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(800);
  await shot("_shot_chaofan_intro.png");
  // 点火
  const wok = await ev(`(()=>{const e=document.querySelector('#wokZone');const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
  await mouse("mousePressed", wok.x, wok.y); await mouse("mouseReleased", wok.x, wok.y);
  await sleep(1400);
  await shot("_shot_chaofan_drop.png");
  ws.close(); chrome.kill();
})().catch(e=>{console.error(e.message); process.exit(1);});
