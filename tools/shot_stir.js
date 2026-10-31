/* 炒饭「环形翻炒」阶段视觉验收：
 *   1. 锅铲是否挪到了锅的右方
 *   2. 手柄是否朝外（画面右）、铲头是否朝锅内（画面左）
 *   3. 摄像头面板是否出现在左上角且不压住锅
 * 用法：node tools/shot_stir.js
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const BASE = "http://127.0.0.1:8931/index.html";
const MOBILE = process.env.MOBILE === "1";           // 窄屏模式 390×844
const PORT = MOBILE ? 9234 : 9232;
const WIN = MOBILE ? "390,844" : "1440,900";
const PROFILE = MOBILE ? ".chrome-stir-m" : ".chrome-stir";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, msgId = 0;
const pending = new Map();
const pageErrors = [];
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
  const r = await ev(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height,cx:b.left+b.width/2,cy:b.top+b.height/2};})()`);
  if (!r) throw new Error("找不到元素 " + selector);
  return r;
}
async function mouse(type, x, y) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
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
  await drag(a.cx, a.cy, b.cx, b.cy);
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}
async function shotClip(name, selector, pad = 0, scale = 1.2) {
  const b = await ev(`(()=>{const e=document.querySelector('${selector}');if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};})()`);
  if (!b) { console.log("  [跳过] 找不到 " + selector); return; }
  const r = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2, scale },
  });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--window-size=" + WIN,
    "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + path.join(ROOT, PROFILE)], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { }
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
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
  await sleep(2000);
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(600);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.cx, wok.cy); await mouse("mouseReleased", wok.cx, wok.cy);
  await sleep(1500);
  for (const ing of ["egg", "rice", "carrot", "scallion"]) {
    await dragEl(`.ing-item[data-ing="${ing}"]`, "#wokZone");
    await sleep(700);
  }
  await sleep(1800);

  console.log("提示:", await ev(`document.getElementById('hint-text').textContent.trim()`));

  const geo = await ev(`(()=>{
    const st = document.querySelector('#cook-stage').getBoundingClientRect();
    const wok = document.querySelector('#wokZone').getBoundingClientRect();
    const sp = document.querySelector('#spatula');
    const b = sp.getBoundingClientRect();
    const cs = getComputedStyle(sp);
    const m = /rotate\\(([-0-9.]+)deg\\)/.exec(cs.transform === 'none' ? '' : cs.transform);
    const panel = document.querySelector('#camPanel');
    const pb = panel ? panel.getBoundingClientRect() : null;
    return {
      stage: {w: Math.round(st.width), h: Math.round(st.height)},
      wok: {l: Math.round(wok.left), r: Math.round(wok.right), t: Math.round(wok.top), b: Math.round(wok.bottom),
            cx: Math.round(wok.left+wok.width/2), cy: Math.round(wok.top+wok.height/2)},
      spat: {l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom),
             cx: Math.round(b.left+b.width/2), cy: Math.round(b.top+b.height/2),
             w: Math.round(b.width), h: Math.round(b.height)},
      transform: cs.transform,
      panel: pb ? {l: Math.round(pb.left), r: Math.round(pb.right), t: Math.round(pb.top), b: Math.round(pb.bottom)} : null,
      hasPanel: !!panel,
      // 锅铲 div 的原始盒子（旋转后的 AABB 会虚增宽度，判定溢出要用原始盒子）
      div: { left: Math.round(sp.offsetLeft), top: Math.round(sp.offsetTop),
             w: Math.round(sp.offsetWidth), h: Math.round(sp.offsetHeight) },
    };
  })()`);
  console.log("几何:", JSON.stringify(geo, null, 1));

  // 依据实测素材轴向换算：铲头指向角 = 素材铲头角(-42.6°) + 旋转角
  const rot = await ev(`(()=>{const cs=getComputedStyle(document.querySelector('#spatula'));const m=new DOMMatrix(cs.transform);return Math.atan2(m.b,m.a)*180/Math.PI;})()`);
  const headDeg = (-42.6 + rot + 360) % 360;
  const handleDeg = (137.2 + rot + 360) % 360;
  console.log(`锅铲旋转角 ${rot.toFixed(1)}° → 铲头指向 ${headDeg.toFixed(1)}°、手柄指向 ${handleDeg.toFixed(1)}°`);
  console.log(`锅铲中心 x=${geo.spat.cx}  锅内腔右缘 x=${geo.wok.r}  → ${geo.spat.cx > geo.wok.r ? "在锅的右方 ✓" : "不在锅的右方 ✗"}`);
  console.log(`铲头朝锅内(≈180°) → ${Math.abs(((headDeg - 180 + 540) % 360) - 180) < 12 ? "✓" : "✗"}`);
  console.log(`手柄朝外(≈0°) → ${Math.min(handleDeg, 360 - handleDeg) < 12 ? "✓" : "✗"}`);

  await shotClip("_stir_1_stage.png", "#cook-stage", 0, 1.0);
  await shot("_stir_2_full.png");
  await shotClip("_stir_3_spatula.png", "#spatula", 40, 1.6);
  if (MOBILE) {
    await shotClip("_stir_4_mobile_panel.png", "#camPanel", 10, 1.6);
    const stageBox = geo.stage;
    // 真实手柄末端位置（沿手柄方向 0.638 × div 宽），不用旋转后的 AABB 判断
    const handleEnd = geo.div.left + geo.div.w / 2 + geo.div.w * 0.638;
    console.log(`窄屏：舞台 ${stageBox.w}×${stageBox.h}，面板 ${geo.panel.l}~${geo.panel.r}（左），锅 ${geo.wok.l}~${geo.wok.r}`);
    console.log(`  面板右缘 ${geo.panel.r} 是否压到锅左缘 ${geo.wok.l} → ${geo.panel.r > geo.wok.l ? "有重叠" : "无重叠 ✓"}`);
    console.log(`  手柄末端 x=${handleEnd.toFixed(0)} 是否超出舞台宽 ${stageBox.w} → ${handleEnd > stageBox.w ? "溢出 ✗" : "未溢出 ✓"}`);
    console.log(`  锅铲 div 盒子 ${geo.div.left}~${geo.div.left + geo.div.w} 是否在舞台内 → ${geo.div.left >= 0 && geo.div.left + geo.div.w <= stageBox.w ? "✓" : "✗"}`);
  }

  console.log(pageErrors.length ? "  页面异常: " + pageErrors.join(" | ") : "  无页面异常 ✓");
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
