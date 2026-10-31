/* ============================================================
 * shot_fileproto.js — 验证 file:// 双击打开时，摄像头手势仍可用
 *
 * 背景：浏览器在 file:// 下禁用 fetch / XHR / 动态 import，
 *       MediaPipe 的运行时与模型一个都加载不到（曾表现为「手部模型加载失败」）。
 *       现在通过 assets/vendor/mediapipe/inline_*.js 的内联兜底解决。
 *
 * 本脚本在 file:// 与 http:// 两种协议下各跑一遍：
 *   1) 真实加载 MediaPipe（不注入假 landmarker）
 *   2) 用合成关键点验证「双手合十」能触发定型
 *   3) 验证长按降级路径依然可用
 * ============================================================ */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
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
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("页面异常: " + (d.exception?.description || d.text));
  }
  return r.result ? r.result.value : undefined;
}
async function mouse(type, x, y, extra = {}) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
}
async function hold(x, y, ms) {
  await mouse("mousePressed", x, y);
  await sleep(ms);
  await mouse("mouseReleased", x, y);
}
async function dragReal(sx, sy, tx, ty, steps = 14) {
  await mouse("mousePressed", sx, sy);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps);
    await sleep(20);
  }
  await mouse("mouseReleased", tx, ty);
  await sleep(150);
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}
async function rect(selector) {
  const r = await ev(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height};})()`);
  if (!r) throw new Error("找不到元素 " + selector);
  return r;
}

/* 合成关键点 + 合成摄像头（注入页面） */
const SYNTH = `
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
    set(pipI[i], tipC.x + px * ot - ux * L * 0.50, tipC.y + py * om - uy * L * 0.50);
    set(dipI[i], tipC.x + px * ot - ux * L * 0.26, tipC.y + py * om - uy * L * 0.26);
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
window.__poseTogether = function () {
  const A = window.__buildHand({x:250,y:400}, {x:310,y:205}, 80);
  const B = window.__buildHand({x:390,y:400}, {x:326,y:210}, 80);
  return [window.__toNorm(A), window.__toNorm(B)];
};
window.__stubCam = function () {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d'); let t = 0;
  setInterval(() => { t++; g.fillStyle = '#' + (t % 255).toString(16).padStart(2,'0') + '4080'; g.fillRect(0,0,640,480); }, 33);
  navigator.mediaDevices.getUserMedia = async () => c.captureStream(30);
};
`;

/* 进入鲜花饼「轻压定形」阶段：选饼皮 → 拖玫瑰馅 → 两折 */
const GOTO_PRESS = `
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  document.getElementById('btn-start').click();
  await sleep(700);
  document.querySelectorAll('.dish-card')[5].click();
  await sleep(700);
  document.getElementById('btn-cook-this').click();
  await sleep(900);
  document.getElementById('btn-crust-ok').click();
  await sleep(1100);
  return { hint: document.getElementById('hint-text').textContent.trim() };
})()
`;

/* 用真实鼠标事件走完「拖馅 → 两折」 */
async function walkToPress() {
  await ev(GOTO_PRESS);
  const rose = await rect("#roseItem img"), board = await rect("#boardZone");
  await dragReal(rose.x, rose.y, board.x, board.y, 20);
  await sleep(1600);
  // 玫瑰馅没放上去时，兜底用 click 路径
  const placed = await ev(`!!document.querySelector('#onDough img')`);
  if (!placed) {
    await ev(`document.getElementById('roseItem').click()`);
    await sleep(300);
    await ev(`document.getElementById('boardZone').click()`);
    await sleep(1600);
  }
  for (const [dx, dy] of [[0, -120], [-140, 0]]) {
    const d = await rect("#doughWrap");
    await dragReal(d.x, d.y, d.x + dx, d.y + dy, 14);
    await sleep(900);
  }
  await sleep(800);
}

/* 最强验证：走真实模型 + 真实手部照片（base64 内联，避开 file:// 的 canvas 污染限制），
   看 detectForVideo 能否真的检出 21 点手部关键点 —— 检验整条真实链路。 */
const REAL_PIPELINE = `
(async () => {
  const bin = atob(window.__HAND_TEST_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 640, 480);
  const stream = c.captureStream(30);
  const v = document.createElement('video');
  v.srcObject = stream; v.muted = true; v.playsInline = true;
  document.body.appendChild(v);
  await v.play();
  await new Promise(r => setTimeout(r, 700));

  const lm = await MPLoader.create('hand', { runningMode: 'VIDEO', numHands: 2 });
  let maxHands = 0, frames = 0, withHand = 0, points = 0;
  for (let i = 0; i < 20; i++) {
    const r = lm.detectForVideo(v, performance.now() + i * 50);
    const lms = r.landmarks || [];
    if (lms.length > maxHands) maxHands = lms.length;
    if (lms.length >= 1) { withHand++; points = (lms[0] || []).length; }
    frames++;
    await new Promise(r2 => setTimeout(r2, 90));
  }
  lm.close();
  return JSON.stringify({ frames, maxHands, framesWithHand: withHand, landmarksPerHand: points });
})()
`;

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9340", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    "--user-data-dir=" + path.join(ROOT, ".chrome-fileproto"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2400);
  const list = await (await fetch("http://127.0.0.1:9340/json/list")).json();
  const page = list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails.text);
    }
  };
  await send("Page.enable"); await send("Runtime.enable");

  // 把手部照片的 base64 在页面加载前注入（file:// 下无法 fetch 本地文件）
  const b64File = path.join(ROOT, "_debug", "hand_real_b64.txt");
  if (fs.existsSync(b64File)) {
    const handB64 = fs.readFileSync(b64File, "utf8").trim();
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__HAND_TEST_B64 = ${JSON.stringify(handB64)};`,
    });
  } else {
    console.log("  [提示] 缺少 _debug/hand_real_b64.txt，跳过真实推理链路验证");
  }

  const fileUrl = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");
  const cases = [
    { tag: "file://（双击打开）", url: fileUrl },
    { tag: "http://（本地服务器）", url: "http://127.0.0.1:8931/index.html" },
  ];

  let allOk = true;

  for (const c of cases) {
    console.log("\n" + "=".repeat(62));
    console.log("== " + c.tag);
    errors.length = 0;
    await send("Page.navigate", { url: c.url + (c.url.includes("?") ? "&" : "?") + "d=" + Date.now() });
    await sleep(3200);
    await ev(SYNTH);

    const env = await ev(`JSON.stringify({
      proto: location.protocol,
      loaderMode: MPLoader.mode,
      secure: window.isSecureContext,
      hasMPLoader: typeof MPLoader
    })`);
    console.log("   环境:", env);

    // 1) 真实加载 MediaPipe（不注入假 landmarker）
    const t0 = Date.now();
    const loadRes = await ev(`(async () => {
      try {
        const lm = await MPLoader.create('hand', { runningMode: 'VIDEO', numHands: 2 });
        return JSON.stringify({ ok: true, ms: ${Date.now()} - 0, created: !!lm });
      } catch (e) {
        return JSON.stringify({ ok: false, err: (e && e.name + ': ' + e.message) || String(e) });
      }
    })()`);
    console.log("   真实模型加载:", loadRes, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    const loadOk = JSON.parse(loadRes).ok;
    if (!loadOk) allOk = false;

    // 1b) 真实模型 + 真实手部照片 → 检出手部（验证整条真实链路）
    const hasB64 = await ev(`typeof window.__HAND_TEST_B64 === 'string'`);
    let pipeOk = true;
    if (hasB64) {
      const pipe = await ev(REAL_PIPELINE);
      console.log("   真实推理链路:", pipe);
      pipeOk = JSON.parse(pipe).maxHands >= 1 && JSON.parse(pipe).landmarksPerHand === 21;
    } else {
      console.log("   真实推理链路: 跳过（无测试素材）");
    }
    if (!pipeOk) allOk = false;

    // 2) 进入定形阶段 → 注入合十姿态 → 应自动定型
    await ev(`window.__stubCam()`);
    await walkToPress();
    const gotoRes = await ev(`({ hasPanel: !!document.querySelector('#camPanel'),
      hint: document.getElementById('hint-text').textContent.trim() })`);
    console.log("   定形阶段:", JSON.stringify(gotoRes));

    await ev(`window.__injectPose && 0`);
    await ev(`(async () => {
      Hands.__injectProvider(async () => ({
        detectForVideo: () => ({ landmarks: window.__poseTogether(), handedness: [] })
      }));
      document.getElementById('btnCamStart').click();
    })()`);
    await sleep(2600);
    const done = await ev(`(()=>({
      dough: document.getElementById('doughImg').style.transform,
      badge: document.getElementById('camBadge').textContent,
      handText: document.getElementById('camHandText').textContent
    }))()`);
    console.log("   合十后:", JSON.stringify(done));
    const prayerOk = String(done.dough).includes("0.76");
    if (!prayerOk) allOk = false;

    await shot("_fileproto_" + (c.tag.startsWith("file") ? "file" : "http") + ".png");

    // 3) 降级路径
    await send("Page.navigate", { url: c.url + "?d=" + Date.now() });
    await sleep(2800);
    await ev(SYNTH);
    await ev(`window.__stubCam()`);
    await walkToPress();
    await ev(`document.getElementById('btnCamSkip').click()`);
    await sleep(500);
    const d = await rect("#doughWrap");
    await hold(d.x, d.y, 1100);
    await sleep(1400);
    const fb = await ev(`document.getElementById('doughImg').style.transform`);
    console.log("   长按降级:", fb);
    const fbOk = String(fb).includes("0.76");
    if (!fbOk) allOk = false;

    console.log("   → 真实模型 " + (loadOk ? "✓" : "✗") + " / 真实推理 " + (pipeOk ? "✓" : "✗") + " / 合十 " + (prayerOk ? "✓" : "✗") + " / 降级 " + (fbOk ? "✓" : "✗"));
    console.log("   页面异常:", errors.length ? errors : "无");
  }

  console.log("\n=== 结论 ===");
  console.log("  file:// 双击打开可用:", allOk ? "✓" : "✗");
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error("✗", e); process.exit(1); });
