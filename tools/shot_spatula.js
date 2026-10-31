/* 炒饭锅铲位置选型：进入翻炒阶段，依次试几组 left/top/width 并截图。 */
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
async function drag(sx, sy, tx, ty, steps = 12) {
  await mouse("mousePressed", sx, sy);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps);
    await sleep(20);
  }
  await mouse("mouseReleased", tx, ty);
  await sleep(140);
}
async function dragEl(fromSel, toSel) {
  const a = await rect(fromSel), b = await rect(toSel);
  await drag(a.x, a.y, b.x, b.y);
}
async function shotClip(name, selector, pad = 0, scale = 1.4) {
  const b = await ev(`(()=>{const e=document.querySelector('${selector}');if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};})()`);
  const r = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2, scale },
  });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9231", "--window-size=1440,900",
    "--no-first-run", "--user-data-dir=" + path.join(ROOT, ".chrome-spat")], { stdio: "ignore" });
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
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
  await sleep(2000);
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(600);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.x, wok.y); await mouse("mouseReleased", wok.x, wok.y);
  await sleep(1500);
  for (const ing of ["egg", "rice", "carrot", "scallion"]) {
    await dragEl(`.ing-item[data-ing="${ing}"]`, "#wokZone");
    await sleep(700);
  }
  await sleep(1600);
  console.log("阶段:", await ev(`document.getElementById('hint-text').textContent.trim()`));

  const base = await ev(`(()=>{
    const st=document.querySelector('#cook-stage').getBoundingClientRect();
    const g=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();
      return {x:Math.round(b.left-st.left),y:Math.round(b.top-st.top),w:Math.round(b.width),h:Math.round(b.height)};};
    return {stage:{w:Math.round(st.width),h:Math.round(st.height)},wokImg:g('.wok-img'),wokZone:g('#wokZone'),ring:g('#stirRing'),contents:g('#wokContents')};
  })()`);
  console.log("基准几何:", JSON.stringify(base));

  const cands = [
    { name: "A_current", left: "30%", top: "82%", width: "17%" },
    { name: "D_ul36_20", left: "36%", top: "20%", width: "19%" },
    { name: "D2_ul34_15", left: "34%", top: "15%", width: "18%" },
    { name: "D3_ul35_17", left: "35%", top: "17%", width: "18%" },
    { name: "D4_ul33_13b", left: "33%", top: "13%", width: "18%" },
  ];
  for (const c of cands) {
    await ev(`(()=>{const s=document.querySelector('#spatula');s.style.left='${c.left}';s.style.top='${c.top}';s.style.width='${c.width}';s.style.transform='';})()`);
    await sleep(260);
    const g = await ev(`(()=>{const st=document.querySelector('#cook-stage').getBoundingClientRect();
      const b=document.querySelector('#spatula').getBoundingClientRect();
      return {x:Math.round(b.left-st.left),y:Math.round(b.top-st.top),w:Math.round(b.width),h:Math.round(b.height)};})()`);
    console.log(" ", c.name, JSON.stringify(c), "→", JSON.stringify(g));
    await shotClip("_spat_" + c.name + ".png", "#cook-stage", 0, 1.0);
  }
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
