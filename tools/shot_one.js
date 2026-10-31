/* 单点调试截图：进入某道菜的某个阶段后截图。
   用法: node tools/shot_one.js <dishIndex> <shotName> [extraJs] */
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

(async () => {
  const dishIndex = parseInt(process.argv[2] || "0", 10);
  const shotName = process.argv[3] || "_one.png";
  const extraJs = process.argv[4] || "";

  const chrome = spawn(CHROME, ["--headless=new","--remote-debugging-port=9226","--window-size=1280,860","--no-first-run","--user-data-dir="+path.join(ROOT,".chrome-one")], {stdio:"ignore"});
  let targets = null;
  for (let i=0;i<40;i++){ try{ targets = await (await fetch("http://127.0.0.1:9226/json")).json(); if(targets.some(t=>t.type==="page")) break; }catch(e){} await sleep(300); }
  ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=(e)=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}};
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate",{url:"http://127.0.0.1:8931/index.html?nocache="+Date.now()});
  await sleep(1800);
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[${dishIndex}].click()`); await sleep(700);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(1000);
  if (extraJs) { await ev(extraJs); await sleep(1600); }
  await shot(shotName);
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
