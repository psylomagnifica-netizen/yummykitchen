/* ============================================================
 * diag_hands.js — 定位「手部模型加载失败」的真实原因
 *
 * 同一个页面分别用两种方式打开，逐一执行 Hands.start() 并抓取真实异常：
 *   A. http://127.0.0.1:8931/index.html   （本地 HTTP 服务）
 *   B. file:///D:/.../index.html           （直接双击 HTML 打开）
 * 摄像头用 canvas.captureStream 合成，只隔离「模型加载」这一步。
 * ============================================================ */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, msgId = 0;
const pending = new Map();
const consoleMsgs = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception));
  }
  return r.result ? r.result.value : undefined;
}

/* 合成摄像头：只替换 getUserMedia，模型加载仍走真实路径 */
const STUB_CAM = `
(() => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d');
  let t = 0;
  setInterval(() => { t++; g.fillStyle = '#' + (t % 255).toString(16).padStart(2,'0') + '4080'; g.fillRect(0,0,640,480); }, 33);
  if (!navigator.mediaDevices) navigator.mediaDevices = {};
  navigator.mediaDevices.getUserMedia = async () => c.captureStream(30);
  window.__camStub = true;
})();
`;

/* 真实调用 Hands.start()，把异常原文带出来 */
const RUN_START = `
(async () => {
  const v = document.createElement('video');
  v.playsInline = true; v.muted = true;
  document.body.appendChild(v);
  const errs = [];
  const origWarn = console.warn;
  console.warn = (...a) => { errs.push(a.map(String).join(' ')); origWarn(...a); };
  let res = null, thrown = null;
  try {
    res = await Hands.start({ video: v, overlay: null, onStatus: (s, d) => { errs.push('status:' + s + ' ' + d); } });
  } catch (e) {
    thrown = (e && (e.name + ': ' + e.message)) || String(e);
  }
  console.warn = origWarn;
  return JSON.stringify({
    res, thrown, errs,
    mode: Hands.mode,
    // 单独再试一次「只加载模型」，把 import/fileset 的真实错误逼出来
    importErr: await (async () => {
      try {
        const V = location.href.endsWith('.html')
          ? new URL('assets/vendor/mediapipe/', location.href).href
          : '';
        const mod = await import(V + 'vision_bundle.mjs');
        const fs = await mod.FilesetResolver.forVisionTasks(V + 'wasm');
        const lm = await mod.HandLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: V + 'hand_landmarker.task', delegate: 'CPU' },
          runningMode: 'VIDEO', numHands: 2,
        });
        return 'OK ' + (lm ? 'landmarker created' : 'null');
      } catch (e) {
        return (e && (e.name + ': ' + e.message)) || String(e);
      }
    })(),
  });
})()
`;

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9333", "--no-first-run", "--no-default-browser-check",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    "--user-data-dir=" + path.join(ROOT, ".chrome-diag"),
    "--window-size=1280,860", "about:blank",
  ], { stdio: "ignore" });

  await sleep(2200);
  const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
  const page = list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const txt = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
      consoleMsgs.push(`[${msg.params.type}] ${txt}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleMsgs.push("[exception] " + JSON.stringify(msg.params.exceptionDetails.text));
    }
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");

  const cases = [
    { tag: "A. http://127.0.0.1:8931", url: "http://127.0.0.1:8931/index.html" },
    { tag: "B. file:// 双击打开", url: "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/") },
  ];

  for (const c of cases) {
    console.log("\n" + "=".repeat(60));
    console.log("== " + c.tag);
    console.log("   " + c.url);
    consoleMsgs.length = 0;
    try {
      await send("Page.navigate", { url: c.url + (c.url.includes("?") ? "&" : "?") + "d=" + Date.now() });
      await sleep(3200);
      const base = await ev(`JSON.stringify({proto:location.protocol, href:location.href.slice(0,60),
        hasHands: typeof Hands, secure: window.isSecureContext,
        md: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)})`);
      console.log("   环境:", base);
      await ev(STUB_CAM);
      const raw = await ev(RUN_START);
      console.log("   结果:", raw);
    } catch (e) {
      console.log("   ✗ 失败:", e.message);
    }
    const warn = consoleMsgs.filter((m) => /hands|model|Model|wasm|WASM|import|CORS|Failed|失败/i.test(m));
    if (warn.length) { console.log("   --- 控制台相关日志 ---"); warn.slice(0, 14).forEach((m) => console.log("     " + m)); }
  }

  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
