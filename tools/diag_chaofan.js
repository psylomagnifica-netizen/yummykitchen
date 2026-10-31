/* 诊断脚本：定位炒饭流程卡点与图层遮挡 */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params})); });
}
async function ev(e) { const r = await send("Runtime.evaluate", {expression: e, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception)); return r.result?.value; }

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9223", "--window-size=1280,860", "--no-first-run", "--user-data-dir=" + path.join(ROOT, ".chrome-diag")], {stdio: "ignore"});
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9223/json")).json(); if (targets.some(t=>t.type==="page")) break; } catch(e){} await sleep(300); }
  ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const {resolve,reject}=pending.get(m.id); pending.delete(m.id); m.error?reject(new Error(m.error.message)):resolve(m.result); } };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", {url: "http://127.0.0.1:8931/index.html"});
  await sleep(1800);
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(400);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(700);

  // 点火
  const wok = await ev(`(()=>{const e=document.querySelector('#wokZone');const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height,left:b.left,top:b.top};})()`);
  console.log("wokZone rect:", JSON.stringify(wok));
  await send("Input.dispatchMouseEvent", {type:"mousePressed",x:wok.x,y:wok.y,button:"left",clickCount:1});
  await send("Input.dispatchMouseEvent", {type:"mouseReleased",x:wok.x,y:wok.y,button:"left",clickCount:1});
  await sleep(1200);

  // 下料
  for (const ing of ["egg","rice","carrot","scallion"]) {
    const a = await ev(`(()=>{const e=document.querySelector('.ing-item[data-ing="${ing}"]');const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
    const b = wok;
    await send("Input.dispatchMouseEvent", {type:"mousePressed",x:a.x,y:a.y,button:"left",clickCount:1});
    for (let i=1;i<=12;i++) { await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12,button:"left"}); await sleep(20); }
    await send("Input.dispatchMouseEvent", {type:"mouseReleased",x:b.x,y:b.y,button:"left",clickCount:1});
    await sleep(600);
  }
  await sleep(1500);

  // 现在是翻炒阶段，检查图层与命中测试
  const diag = await ev(`(()=>{
    const wok = document.querySelector('#wokZone');
    const b = wok.getBoundingClientRect();
    const cx = b.x+b.width/2, cy = b.y+b.height/2;
    const at = document.elementFromPoint(cx, cy);
    const stack = document.elementsFromPoint(cx, cy).map(e=>e.id||e.className||e.tagName);
    return {
      phaseHint: document.getElementById('hint-text').textContent.trim(),
      wokRect: {x:cx, y:cy, w:b.width, h:b.height},
      topElAtCenter: at ? (at.id||at.className||at.tagName) : null,
      stackAtCenter: stack,
      ringDisplay: getComputedStyle(document.querySelector('#stirRing')).display,
      contentsImgs: document.querySelectorAll('#wokContents img').length,
      spatulaRect: (()=>{const s=document.querySelector('#spatula');const r=s.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,display:s.style.display};})(),
      prepBoard: (()=>{const p=document.querySelector('#prepBoard');const r=p.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};})(),
      firebarHidden: document.getElementById('firebar-block').classList.contains('hidden'),
    };
  })()`);
  console.log("\n=== 翻炒阶段诊断 ===");
  console.log(JSON.stringify(diag, null, 2));

  // 尝试在 wok 中心画圈
  const R = Math.min(wok.w, wok.h) * 0.28;
  console.log("\n画圈半径:", R.toFixed(1), "起点:", (wok.x+R).toFixed(0), wok.y.toFixed(0));
  await send("Input.dispatchMouseEvent", {type:"mousePressed",x:wok.x+R,y:wok.y,button:"left",clickCount:1});
  const total = Math.PI*2*3.4;
  for (let a=0; a<=total; a+=0.2) {
    await send("Input.dispatchMouseEvent", {type:"mouseMoved",x:wok.x+Math.cos(a)*R,y:wok.y+Math.sin(a)*R,button:"left"});
    await sleep(16);
  }
  await send("Input.dispatchMouseEvent", {type:"mouseReleased",x:wok.x+R,y:wok.y,button:"left",clickCount:1});
  await sleep(1500);
  const after = await ev(`(()=>({hint:document.getElementById('hint-text').textContent.trim(), firebar:!document.getElementById('firebar-block').classList.contains('hidden'), ringOffset:document.querySelector('#stirRingFg').style.strokeDashoffset}))()`);
  console.log("画圈后:", JSON.stringify(after));

  ws.close(); chrome.kill();
})().catch(e=>{console.error("诊断异常:", e.message); process.exit(1);});
