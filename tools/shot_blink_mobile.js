/* 窄屏下检查摄像头面板是否遮挡茶杯 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(e) {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result?.value;
}
async function rect(sel) {
  return ev(`(()=>{const e=document.querySelector('${sel}');if(!e)return null;const b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height};})()`);
}
async function mouse(type, x, y, extra = {}) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
}
async function dragEl(fromSel, toSel) {
  const a = await rect(fromSel), b = await rect(toSel);
  if (!a || !b) throw new Error("缺少拖拽元素 " + fromSel);
  await mouse("mouseMoved", a.x, a.y);
  await mouse("mousePressed", a.x, a.y);
  for (let i = 1; i <= 14; i++) {
    await mouse("mouseMoved", a.x + (b.x - a.x) * i / 14, a.y + (b.y - a.y) * i / 14, { buttons: 1 });
    await sleep(22);
  }
  await mouse("mouseReleased", b.x, b.y);
  await sleep(400);
}
async function circle(cx, cy, r, turns) {
  const steps = Math.round(turns * 26);
  await mouse("mouseMoved", cx + r, cy);
  await mouse("mousePressed", cx + r, cy);
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 * turns;
    await mouse("mouseMoved", cx + Math.cos(a) * r, cy + Math.sin(a) * r, { buttons: 1 });
    await sleep(16);
  }
  await mouse("mouseReleased", cx + r, cy);
}
(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9237", "--window-size=430,932", "--no-first-run", "--user-data-dir=" + path.join(ROOT, ".chrome-mob")], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9237/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { } await sleep(300); }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "http://127.0.0.1:8931/index.html?mob=" + Date.now() });
  await sleep(2000);

  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[2].click()`); await sleep(600);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(1000);
  await ev(`document.querySelector('.choice-card[data-tea="hongcha"]').click()`); await sleep(1500);
  await dragEl("#milkItem", "#cupZone"); await sleep(1500);
  const cup = await rect("#cupZone");
  await circle(cup.x, cup.y, cup.w * 0.26, 2.6);
  await sleep(1800);
  console.log("提示:", await ev(`document.getElementById('hint-text').textContent`));
  console.log("面板存在:", await ev(`!!document.querySelector('#camPanel')`));

  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, "_debug", "_debug_blink_mobile.png"), Buffer.from(r.data, "base64"));
  console.log("  [截图] _debug/_debug_blink_mobile.png");
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
