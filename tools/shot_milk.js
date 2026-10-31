/* 奶茶「倒牛奶后杯子换成装满牛奶图 + 茶色染色」验收截图。 */
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
const errors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}
async function rect(selector) {
  const r = await ev(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height};})()`);
  if (!r) throw new Error("找不到元素 " + selector);
  return r;
}
async function mouse(type, x, y, extra = {}) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
}
async function drag(sx, sy, tx, ty, steps = 14) {
  await mouse("mousePressed", sx, sy);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps);
    await sleep(20);
  }
  await mouse("mouseReleased", tx, ty);
  await sleep(150);
}
async function shotClip(name, selector, pad = 20, scale = 2) {
  const b = await ev(`(()=>{const e=document.querySelector('${selector}');if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};})()`);
  const r = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2, scale },
  });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9233", "--window-size=1440,900",
    "--no-first-run", "--user-data-dir=" + path.join(ROOT, ".chrome-milk")], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9233/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { }
    await sleep(300);
  }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text || "");
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });

  for (const tea of ["hongcha", "wulong", "moli"]) {
    await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
    await sleep(1800);
    await ev(`document.getElementById('btn-start').click()`); await sleep(600);
    await ev(`document.querySelectorAll('.dish-card')[2].click()`); await sleep(600);
    await ev(`document.getElementById('btn-cook-this').click()`); await sleep(800);
    await ev(`document.querySelector('.choice-card[data-tea="${tea}"]').click()`); await sleep(1300);
    const before = await ev(`(()=>({src:document.querySelector('#cupImg').src.split('/').pop(),
      hasMilk:document.querySelector('#cupZone').classList.contains('has-milk')}))()`);
    await shotClip(`_milk_${tea}_before.png`, "#cupZone", 26, 2.4);
    // 倒牛奶
    const m = await rect("#milkItem"), c = await rect("#cupZone");
    await drag(m.x, m.y, c.x, c.y, 16);
    await sleep(1600);
    const after = await ev(`(()=>({src:document.querySelector('#cupImg').src.split('/').pop(),
      hasMilk:document.querySelector('#cupZone').classList.contains('has-milk'),
      tint:getComputedStyle(document.querySelector('#cupTint')).backgroundColor,
      tintOpacity:getComputedStyle(document.querySelector('#cupTint')).opacity,
      mask:(getComputedStyle(document.querySelector('#cupTint')).maskImage||'').slice(0,60)}))()`);
    console.log(`  ${tea}: 前=${JSON.stringify(before)}`);
    console.log(`  ${tea}: 后=${JSON.stringify(after)}`);
    await shotClip(`_milk_${tea}_after.png`, "#cupZone", 26, 2.4);
  }
  console.log("\n页面异常:", errors.length ? errors : "无");
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
