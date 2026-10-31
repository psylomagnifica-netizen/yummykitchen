/* 炒饭「鸡蛋」新素材验收：备料卡 + 入锅后的锅内效果。
 * 用法：node tools/shot_egg.js
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const BASE = "http://127.0.0.1:8931/index.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, msgId = 0;
const pending = new Map();
const pageErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}
async function rect(selector) {
  const r = await ev(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
  if (!r) throw new Error("找不到元素 " + selector);
  return r;
}
async function mouse(type, x, y) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
async function drag(sx, sy, tx, ty, steps = 14) {
  await mouse("mousePressed", sx, sy);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps);
    await sleep(22);
  }
  await mouse("mouseReleased", tx, ty);
  await sleep(160);
}
async function dragEl(fromSel, toSel) {
  const a = await ev(`(()=>{const el=document.querySelector('${fromSel}');if(!el)return null;
    const h=el.querySelector('.combo-pick')||el;const b=h.getBoundingClientRect();
    return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
  const b = await rect(toSel);
  await drag(a.x, a.y, b.x, b.y);
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}
async function shotClip(name, selector, pad = 14, scale = 2) {
  const b = await ev(`(()=>{const e=document.querySelector('${selector}');if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};})()`);
  if (!b) { console.log("  [跳过截图] 找不到 " + selector); return; }
  const r = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2, scale },
  });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9231", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + path.join(ROOT, ".chrome-egg")], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9231/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { }
    await sleep(300);
  }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.text || "");
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: BASE });
  await sleep(2000);
  await ev(`document.getElementById('btn-start').click()`); await sleep(600);
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(600);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.x, wok.y); await mouse("mouseReleased", wok.x, wok.y);
  await sleep(1600);

  const src = await ev(`document.querySelector('.ing-item[data-ing="egg"] img').getAttribute('src')`);
  console.log("  鸡蛋素材:", src);

  await shotClip("_egg_1_board.png", "#prepBoard");

  await dragEl('.ing-item[data-ing="egg"]', "#wokZone");
  await sleep(900);
  await shotClip("_egg_2_wok.png", "#wokZone");
  await shot("_egg_3_full.png");

  const potSrc = await ev(`document.querySelector('#wokContents img').getAttribute('src')`);
  console.log("  锅内素材:", potSrc);

  console.log(pageErrors.length ? "  页面异常: " + pageErrors.join(" | ") : "  无页面异常 ✓");
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
