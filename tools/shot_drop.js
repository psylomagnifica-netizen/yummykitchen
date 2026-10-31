/* 炒饭下料阶段截图：把 4 种食材依次拖进锅里，看落点是否在锅内。 */
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
async function mouse(type,x,y,extra={}) { await send("Input.dispatchMouseEvent",{type,x,y,button:"left",clickCount:1,buttons: type==="mouseMoved"?1:1,...extra}); }

(async () => {
  const chrome = spawn(CHROME, ["--headless=new","--remote-debugging-port=9227","--window-size=1280,860","--no-first-run","--user-data-dir="+path.join(ROOT,".chrome-drop")], {stdio:"ignore"});
  let targets = null;
  for (let i=0;i<40;i++){ try{ targets = await (await fetch("http://127.0.0.1:9227/json")).json(); if(targets.some(t=>t.type==="page")) break; }catch(e){} await sleep(300); }
  ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=(e)=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}};
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate",{url:"http://127.0.0.1:8931/index.html?nocache="+Date.now()});
  await sleep(1800);
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(700);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(1000);
  // 开火
  await ev(`document.querySelector('#wokZone').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  await sleep(1200);
  // 依次拖拽 4 种食材
  const items = await ev(`Array.from(document.querySelectorAll('.ing-item')).map(e=>{const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})`);
  const wok = await ev(`(()=>{const b=document.querySelector('#wokZone').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
  for (const it of items) {
    await mouse("mousePressed", it.x, it.y);
    await sleep(120);
    await mouse("mouseMoved", wok.x, wok.y);
    await sleep(120);
    await mouse("mouseReleased", wok.x, wok.y);
    await sleep(700);
  }
  await sleep(600);
  await shot("_one_drop.png");
  // 报告食材落点与锅口的关系
  const geo = await ev(`(()=>{
    const wok=document.querySelector('#wokZone').getBoundingClientRect();
    const imgs=Array.from(document.querySelectorAll('#wokContents img')).map(i=>{const b=i.getBoundingClientRect();return {cx:Math.round(b.x+b.width/2),cy:Math.round(b.y+b.height/2),w:Math.round(b.width)};});
    return {wok:{x:Math.round(wok.x),y:Math.round(wok.y),w:Math.round(wok.width),h:Math.round(wok.height)},imgs};
  })()`);
  console.log(JSON.stringify(geo, null, 1));
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
