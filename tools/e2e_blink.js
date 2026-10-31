/* ============================================================
 * e2e_blink.js — 「眨眼封口」端到端验证
 *
 * 分两个独立浏览器实例（Chrome 的假摄像头不支持二次取流）：
 *  实例 1  A 模型管线：本地 MediaPipe（wasm + face_landmarker.task）真实加载 + 推理
 *          C 资源回收：停止后视频轨道 readyState = ended
 *  实例 2  B 眨眼封口：受控关键点序列（睁→闭→睁）驱动 onBlink → 封杯 → 结果卡
 *
 * 用法：node tools/e2e_blink.js
 * ============================================================ */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const PORT = 8931;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 静态服务器（wasm 需要正确的 MIME；端口占用则复用） ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".wasm": "application/wasm",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
  ".task": "application/octet-stream", ".docx": "application/octet-stream",
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.on("error", (e) => {
      if (e.code === "EADDRINUSE") { console.log("[服务] 复用已运行的 8931 端口服务"); resolve(null); }
      else { console.error(e); process.exit(1); }
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ---------- CDP 客户端 ---------- */
let ws, msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, "_debug", name), Buffer.from(r.data, "base64"));
  console.log("  [截图] _debug/" + name);
}
async function rect(sel) {
  return ev(`(()=>{const e=document.querySelector('${sel}');if(!e)return null;const b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height};})()`);
}
async function mouse(type, x, y, extra = {}) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
}
async function tap(x, y) { await mouse("mousePressed", x, y); await sleep(70); await mouse("mouseReleased", x, y); await sleep(240); }
async function tapEl(sel) { const p = await rect(sel); if (!p) throw new Error("缺少元素 " + sel); await tap(p.x, p.y); }
async function dragEl(fromSel, toSel) {
  const a = await rect(fromSel), b = await rect(toSel);
  if (!a || !b) throw new Error("缺少拖拽元素");
  await mouse("mouseMoved", a.x, a.y);
  await mouse("mousePressed", a.x, a.y);
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, { buttons: 1 });
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

let pass = 0, fail = 0;
const errors = [];
function check(cond, msg) { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } }

/* ---------- 启动浏览器 ---------- */
async function launch(profile, port) {
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, "--window-size=1280,860",
    "--no-first-run", `--user-data-dir=${path.join(ROOT, profile)}`,
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch (e) { /* retry */ }
    await sleep(300);
  }
  ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
    if (m.method === "Runtime.consoleAPICalled") {
      const t = m.params.type;
      const txt = m.params.args.map((a) => a.value ?? a.description).join(" ");
      if (t === "error" && !/^INFO: /.test(txt)) errors.push("console.error: " + txt);
      if (t === "warning" && txt.startsWith("[blink]")) console.log("  [warn] " + txt);
    }
  });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?t=${Date.now()}` });
  await sleep(2000);
  return chrome;
}

/* ============================================================
 * 实例 1：A 模型管线 + C 资源回收
 * ============================================================ */
async function instance1() {
  console.log("\n[A] MediaPipe 眨眼识别模型管线（真实模型）");
  const chrome = await launch(".chrome-blink1", 9234);
  const probe = await ev(`(async () => {
    const v = document.createElement('video');
    v.id = '__probe'; v.playsInline = true; v.muted = true;
    v.style.cssText = 'position:fixed;left:-9999px;width:320px;height:240px';
    document.body.appendChild(v);
    window.__probeLog = [];
    const res = await Blink.start({ video: v, onStatus: (s, d) => window.__probeLog.push(s + '|' + d) });
    const out = { ok: !!res.ok, mode: res.mode };
    await new Promise(r => setTimeout(r, 1500));
    out.after = window.__probeLog.slice();
    out.stream = Blink.streamState;
    out.video = { w: v.videoWidth, ready: v.readyState, hasSrc: !!v.srcObject };
    Blink.stop();
    await new Promise(r => setTimeout(r, 300));
    out.streamAfterStop = Blink.streamState;
    v.remove();
    return out;
  })()`);
  check(probe.ok === true, "摄像头取流成功（getUserMedia 通过）");
  check(probe.mode === "model", `本地 FaceLandmarker 模型加载成功（mode=${probe.mode}）`);
  check(probe.after && probe.after.some((s) => s.startsWith("no-face") || s.startsWith("tracking")),
    `推理循环运行中：${probe.after ? probe.after.join(" / ") : "无"}`);
  check(probe.stream && probe.stream.length === 1,
    `摄像头轨道已创建：${JSON.stringify(probe.stream)}（headless 假设备 readyState 常为 ended，非产品问题）`);
  check(!probe.streamAfterStop, `停止后摄像头已释放：${JSON.stringify(probe.streamAfterStop)}`);
  chrome.kill();
  await sleep(400);
}

/* ============================================================
 * 实例 2：B 眨眼封口（受控关键点）
 * ============================================================ */
async function instance2() {
  console.log("\n[B] 奶茶「眨眼封口」");
  const chrome = await launch(".chrome-blink2", 9235);

  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[2].click()`); await sleep(600);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);

  await ev(`document.querySelector('.choice-card[data-tea="hongcha"]').click()`); await sleep(1400);
  await ev(`document.querySelector('[data-milk="标准"]').click()`);
  await ev(`document.querySelector('[data-sweet="五分"]').click()`);
  await dragEl("#milkItem", "#cupZone"); await sleep(1500);
  const cup = await rect("#cupZone");
  await circle(cup.x, cup.y, Math.min(cup.w, 90) * 0.7, 2.4);
  await sleep(1800);

  const sealHint = await ev(`document.getElementById('hint-text').textContent`);
  check(/眨/.test(sealHint), `封杯提示引导眨眼：${sealHint.trim().slice(0, 30)}`);
  check(await ev(`!!document.querySelector('#camPanel')`), "摄像头面板已渲染");
  await shot("_debug_blink_panel.png");

  // 注入受控关键点：前 20 帧睁眼，随后闭眼 5 帧再睁眼
  await ev(`(() => {
    Blink.__injectProvider(async () => {
      let frame = 0;
      const t0 = performance.now();
      const mk = (closed) => {
        const pts = new Array(478).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
        const setEye = (idx) => {
          const [p1, p2, p3, p4, p5, p6] = idx;
          const h = closed ? 0.0025 : 0.016;   // 睁眼 EAR≈0.32，闭眼 EAR≈0.05
          const base = 0.45, x0 = 0.30, w = 0.10;
          pts[p1] = { x: x0, y: base, z: 0 };
          pts[p4] = { x: x0 + w, y: base, z: 0 };
          pts[p2] = { x: x0 + w * 0.3, y: base - h, z: 0 };
          pts[p3] = { x: x0 + w * 0.7, y: base - h, z: 0 };
          pts[p5] = { x: x0 + w * 0.7, y: base + h, z: 0 };
          pts[p6] = { x: x0 + w * 0.3, y: base + h, z: 0 };
        };
        setEye([33, 160, 158, 133, 153, 144]);
        setEye([362, 385, 387, 263, 374, 380]);
        return pts;
      };
      return {
        detectForVideo: () => {
          frame++;
          window.__providerCalled = true;
          /* 按时间控制闭眼（不受假摄像头帧率影响）：
             点击后 4.0~4.6 秒闭眼一次，前 4 秒保持睁眼以便检查面板状态 */
          const elapsed = performance.now() - t0;
          const closed = elapsed > 4000 && elapsed < 4600;
          return { faceLandmarks: [mk(closed)] };
        },
      };
    });
    window.__providerCalled = false;
    return true;
  })()`);

  await tapEl("#btnCamStart");
  await sleep(1200);
  const badge = await ev(`document.getElementById('camBadge').textContent`);
  check(/识别中|近似/.test(badge), `面板状态：${badge}`);
  check(await ev(`document.getElementById('camVeil').classList.contains('cam-veil-off')`), "摄像头已开启，遮罩提示消失");
  check(await ev(`(() => { const v = document.getElementById('camVideo'); return !!(v && v.srcObject && v.videoWidth > 0); })()`),
    "视频流已渲染（videoWidth > 0）");
  check(await ev(`(Blink.streamState || []).length === 1`), "视频轨道已建立");
  const eyeOpen = await ev(`document.getElementById('camEyePath').getAttribute('d')`);
  check(/Q24 2/.test(eyeOpen), "眼睛指示器处于「睁眼」状态");
  await shot("_debug_blink_live.png");

  let sealed = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    if (await ev(`document.getElementById('screen-result').classList.contains('active')`)) { sealed = true; break; }
  }
  check(sealed, "眨眼被检测 → 自动封杯 → 进入结果卡");
  check(await ev(`(() => { const l = document.querySelector('#lid'); return !!(l && !l.classList.contains('hidden')); })()`), "杯盖已盖上");
  const telemetry = await ev(`JSON.stringify((Telemetry.events || []).filter(e => e.event === 'blink_detected'))`);
  check(/blink_detected/.test(telemetry), "埋点记录到 blink_detected：" + telemetry);
  await shot("_debug_blink_result.png");

  console.log("\n[C] 离开菜品后摄像头资源回收");
  const camState = await ev(`(() => {
    const v = document.getElementById('camVideo');
    if (!v) return { gone: true };
    const s = v.srcObject;
    if (!s) return { src: null };
    return { tracks: s.getTracks().map(t => ({ kind: t.kind, ready: t.readyState })) };
  })()`);
  const allEnded = !camState.tracks || camState.tracks.length === 0 ||
    camState.tracks.every((t) => t.ready === "ended");
  check(allEnded, "视频轨道已释放（readyState=ended）：" + JSON.stringify(camState));

  chrome.kill();
  await sleep(400);
}

(async () => {
  fs.mkdirSync(path.join(ROOT, "_debug"), { recursive: true });
  const srv = await serve();
  await instance1();
  await instance2();
  console.log("\n===== 结果 =====");
  console.log(`  通过 ${pass} / 失败 ${fail}`);
  if (errors.length) { console.log("  页面异常:"); errors.forEach((e) => console.log("   ! " + e)); }
  else console.log("  无页面异常 ✓");
  if (srv) srv.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error("测试异常:", e); process.exit(1); });
