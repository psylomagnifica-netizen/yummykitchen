/* ============================================================
 * shot_hands.js — 鲜花饼「双手合十」轻压定形验收
 *
 * 真实摄像头里没有手，所以这里用 Hands.__injectProvider 注入合成关键点，
 * 覆盖三种情形：
 *   A. 双手合十     → 应识别成功、进度环走满、自动完成定型
 *   B. 双手分开     → 不应误判（状态停在 two-hand）
 *   C. 摄像头不可用 → 降级路径「按住面团长按 600ms」仍能完成定型
 * ============================================================ */
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
  const r = await ev(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height,left:b.left,top:b.top};})()`);
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
async function hold(x, y, ms) {
  await mouse("mousePressed", x, y);
  await sleep(ms);
  await mouse("mouseReleased", x, y);
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}
async function shotClip(name, selector, pad = 20, scale = 2) {
  const b = await ev(`(()=>{const e=document.querySelector('${selector}');if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};})()`);
  if (!b) return;
  const r = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2, scale },
  });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}

/* ---------- 合成关键点生成器 + 合成摄像头（注入页面） ---------- */
const SYNTH = `
/* headless 假摄像头只支持一次 getUserMedia，第二次就报 NotFoundError；
   这里用 canvas.captureStream 造一条永不断流的合成视频，测试才能反复跑。 */
window.__stubCam = function () {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const ctx = c.getContext('2d');
  let t = 0;
  setInterval(() => {
    t += 1;
    ctx.fillStyle = '#2e3a46'; ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#4b6a80'; ctx.fillRect(20, 20, 600, 440);
    ctx.fillStyle = '#8ab'; ctx.font = '28px sans-serif';
    ctx.fillText('synthetic camera ' + t, 40, 60);
  }, 66);
  navigator.mediaDevices.getUserMedia = async () => c.captureStream(30);
};
window.__buildHand = function (wrist, tipC, palmW) {
  const dx = tipC.x - wrist.x, dy = tipC.y - wrist.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const px = -uy, py = ux;
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0, y: 0 });
  const set = (i, x, y) => { lm[i].x = x; lm[i].y = y; };
  set(0, wrist.x, wrist.y);
  const mcpOff = [-0.5, -0.17, 0.17, 0.5];
  const tipOff = [-0.26, -0.08, 0.08, 0.26];
  const mcpI = [5, 9, 13, 17], pipI = [6, 10, 14, 18], dipI = [7, 11, 15, 19], tipI = [8, 12, 16, 20];
  for (let i = 0; i < 4; i++) {
    const om = mcpOff[i] * palmW, ot = tipOff[i] * palmW;
    set(mcpI[i], tipC.x + px * om - ux * L * 0.72, tipC.y + py * om - uy * L * 0.72);
    set(pipI[i], tipC.x + px * ot - ux * L * 0.50, tipC.y + py * ot - uy * L * 0.50);
    set(dipI[i], tipC.x + px * ot - ux * L * 0.26, tipC.y + py * ot - uy * L * 0.26);
    set(tipI[i], tipC.x + px * ot, tipC.y + py * ot);
  }
  const tx = tipC.x + px * (-0.62 * palmW) - ux * L * 0.60;
  const ty = tipC.y + py * (-0.62 * palmW) - uy * L * 0.60;
  set(1, wrist.x + (tx - wrist.x) * 0.30, wrist.y + (ty - wrist.y) * 0.30);
  set(2, wrist.x + (tx - wrist.x) * 0.62, wrist.y + (ty - wrist.y) * 0.62);
  set(3, wrist.x + (tx - wrist.x) * 0.85, wrist.y + (ty - wrist.y) * 0.85);
  set(4, tx, ty);
  return lm;
};
window.__toNorm = function (lm) { return lm.map(p => ({ x: p.x / 640, y: p.y / 480 })); };
/* 合十：两手掌心相对、手指同向朝上、指尖靠拢、手腕分居两侧 */
window.__poseTogether = function () {
  const A = window.__buildHand({x:250,y:400}, {x:310,y:205}, 80);
  const B = window.__buildHand({x:390,y:400}, {x:326,y:210}, 80);
  return [window.__toNorm(A), window.__toNorm(B)];
};
/* 分开：两只手离得很远 */
window.__poseApart = function () {
  const A = window.__buildHand({x:180,y:400}, {x:210,y:200}, 80);
  const B = window.__buildHand({x:560,y:400}, {x:530,y:210}, 80);
  return [window.__toNorm(A), window.__toNorm(B)];
};
window.__injectPose = function (pose) {
  Hands.__injectProvider(async () => ({
    detectForVideo: () => ({ landmarks: pose, handedness: [] })
  }));
};
`;

/* ---------- 走到「轻压定形」阶段 ---------- */
async function gotoPressPhase() {
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[5].click()`); await sleep(700);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  await ev(`document.getElementById('btn-crust-ok').click()`); await sleep(1100);
  const rose = await rect("#roseItem"), board = await rect("#boardZone");
  await drag(rose.x, rose.y, board.x, board.y, 16);
  await sleep(1300);
  // 两折：向上 → 向左
  for (const [dx, dy] of [[0, -120], [-140, 0]]) {
    const d = await rect("#doughWrap");
    await drag(d.x, d.y, d.x + dx, d.y + dy, 14);
    await sleep(800);
  }
  await sleep(700);
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9241", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check",
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--user-data-dir=" + path.join(ROOT, ".chrome-hands")], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9241/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { }
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

  /* ============ 0. 真实手部模型能否加载 ============ */
  console.log("\n=== 0. 真实 MediaPipe 手部模型加载 ===");
  await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
  await sleep(1900);
  await ev(SYNTH);
  await ev(`window.__stubCam()`);
  await gotoPressPhase();
  await ev(`document.getElementById('btnCamStart').click()`);
  await sleep(6000);
  const model = await ev(`(()=>({mode:Hands.mode, running:Hands.isRunning,
    badge:document.getElementById('camBadge').textContent,
    stream:Hands.streamState}))()`);
  console.log("  模型状态:", JSON.stringify(model));
  await shotClip("_hands_model.png", "#camPanel", 18, 2);
  const ok0 = model.mode === "model";
  await ev(`Hands.stop()`);

  /* ============ A. 双手合十 ============ */
  console.log("\n=== A. 双手合十 → 应自动完成定型 ===");
  await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
  await sleep(1900);
  await ev(SYNTH);
  await ev(`window.__stubCam()`);
  await gotoPressPhase();
  const inPress = await ev(`(()=>({panel:!!document.querySelector('#camPanel'),
    ring:!!document.querySelector('#pressRing'), hint:document.getElementById('hint-text').textContent.trim()}))()`);
  console.log("  定形阶段初始态:", JSON.stringify(inPress));
  await shotClip("_hands_press_panel.png", "#camPanel", 18, 2);

  await ev(`window.__injectPose(window.__poseTogether())`);
  await ev(`document.getElementById('btnCamStart').click()`);
  await sleep(340);   // 等遮罩淡出，画面干净
  /* 抢在保持满 700ms 之前抓一张「合十中」的图 */
  let snapped = false;
  for (let i = 0; i < 24; i++) {
    const s = await ev(`Hands.score`);
    if (Number(s) > 0.72) {
      await shotClip("_hands_press_prayer.png", "#camPanel", 18, 2);
      await shotClip("_hands_indicator_on.png", "#camHandRow", 8, 3);
      const mid = await ev(`(()=>({score:Hands.score, badge:document.getElementById('camBadge').textContent,
        handText:document.getElementById('camHandText').textContent,
        rowClass:document.getElementById('camHandRow').className,
        ringHidden:document.querySelector('#pressRing').classList.contains('hidden'),
        dash:document.getElementById('pressRingFg').style.strokeDashoffset}))()`);
      console.log("  合十瞬间:", JSON.stringify(mid));
      snapped = true;
      break;
    }
    await sleep(50);
  }
  if (!snapped) console.log("  ⚠ 未抓到合十瞬间");
  await sleep(1600);
  const done = await ev(`(()=>({dough:document.getElementById('doughImg').style.transform,
    stream:Hands.streamState, running:Hands.isRunning,
    fb:(document.getElementById('feedback-banner')||{}).textContent,
    hint:document.getElementById('hint-text').textContent.trim()}))()`);
  console.log("  合十保持后:", JSON.stringify(done));
  await shot("_hands_press_done.png");
  const okA = done.dough.includes("0.76") && !done.running;

  /* ============ B. 双手分开 → 不应误判 ============ */
  console.log("\n=== B. 双手分开 → 不应误判 ===");
  await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
  await sleep(1900);
  await ev(SYNTH);
  await ev(`window.__stubCam()`);
  await gotoPressPhase();
  await ev(`window.__injectPose(window.__poseApart())`);
  await ev(`document.getElementById('btnCamStart').click()`);
  await sleep(2600);
  const detB = await ev(`(()=>({score:Hands.score, badge:document.getElementById('camBadge').textContent,
    handText:document.getElementById('camHandText').textContent,
    rowClass:document.getElementById('camHandRow').className,
    dough:document.getElementById('doughImg').style.transform,
    running:Hands.isRunning}))()`);
  console.log("  分开时状态:", JSON.stringify(detB));
  await shotClip("_hands_press_apart.png", "#camPanel", 18, 2);
  await shotClip("_hands_indicator_near.png", "#camHandRow", 8, 3);
  const okB = Number(detB.score) < 0.72 && !detB.dough.includes("0.76");

  /* ============ C. 降级路径：长按面团 ============ */
  console.log("\n=== C. 摄像头不可用 → 长按降级路径 ===");
  await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
  await sleep(1900);
  await gotoPressPhase();
  await ev(`document.getElementById('btnCamSkip').click()`);
  await sleep(500);
  const skipped = await ev(`(()=>({panel:!!document.querySelector('#camPanel'),
    hint:document.getElementById('hint-text').textContent.trim()}))()`);
  console.log("  跳过摄像头后:", JSON.stringify(skipped));
  const d = await rect("#doughWrap");
  await hold(d.x, d.y, 1100);
  await sleep(1400);
  const doneC = await ev(`(()=>({dough:document.getElementById('doughImg').style.transform,
    oven:!!document.querySelector('#oven'), hint:document.getElementById('hint-text').textContent.trim()}))()`);
  console.log("  长按后:", JSON.stringify(doneC));
  await shot("_hands_press_fallback.png");
  const okC = doneC.dough.includes("0.76");

  console.log("\n=== 结论 ===");
  console.log("  0 真实模型加载:", ok0 ? "✓" : "✗");
  console.log("  A 合十自动定型:", okA ? "✓" : "✗");
  console.log("  B 分开不误判:", okB ? "✓" : "✗");
  console.log("  C 长按降级:", okC ? "✓" : "✗");
  console.log("  页面异常:", errors.length ? errors : "无");
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(ok0 && okA && okB && okC ? 0 : 1);
})().catch((e) => { console.error("✗", e); process.exit(1); });
