/* ============================================================
 * diag_inline.js — 验证 file:// 下用内联 blob 资源能否跑起 MediaPipe
 *
 * 原理：
 *   file:// 下 fetch/import 本地文件被禁，但 blob: URL 与 data: URL 可用。
 *   所以把运行时与模型 gzip+base64 内联，运行时还原成 blob URL：
 *     - bundle       → import(blobUrl)          （实测 OK）
 *     - wasm loader  → blobUrl 当 script src      （crossOrigin=anonymous）
 *     - wasm 二进制  → blobUrl 当 wasmBinaryPath
 *     - 模型         → baseOptions.modelAssetBuffer（Uint8Array，免掉模型文件请求）
 * ============================================================ */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
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
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("页面异常: " + (d.exception?.description || d.text));
  }
  return r.result ? r.result.value : undefined;
}

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9338", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + path.join(ROOT, ".chrome-diag6"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2200);
  const list = await (await fetch("http://127.0.0.1:9338/json/list")).json();
  const page = list.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  };
  await send("Page.enable"); await send("Runtime.enable");

  const fileUrl = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

  // 把还原+建 landmarker 的逻辑整段注入
  const PROBE = `
(async () => {
  const out = {};
  const log = [];

  // 1) 经典 script 标签加载内联包（file:// 下允许）
  try {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('assets/vendor/mediapipe/inline_vendor.js', location.href).href;
      s.onload = res; s.onerror = () => rej(new Error('script load error'));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('TIMEOUT')), 60000);
    });
    out.inlineLoaded = 'OK keys=' + Object.keys(window.MPInline || {}).join(',');
  } catch (e) {
    out.inlineLoaded = 'FAIL ' + (e.name + ': ' + e.message);
    return JSON.stringify(out, null, 1);
  }

  // 2) base64+gzip → Uint8Array
  function ungzip(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Uint8Array(bytes);   // gzip 字节
  }
  function gunzipToBytes(gzBytes) {
    // 用 DecompressionStream 解压
    const ds = new DecompressionStream('gzip');
    return new Response(new Blob([gzBytes]).stream().pipeThrough(ds)).arrayBuffer()
      .then(b => new Uint8Array(b));
  }

  out.decomp = await (async () => {
    try {
      const gz = ungzip(window.MPInline.MP_INLINE_BUNDLE);
      const raw = await gunzipToBytes(gz);
      return 'OK rawLen=' + raw.length + ' head=' + new TextDecoder().decode(raw.slice(0, 20));
    } catch (e) { return 'FAIL ' + (e.name + ': ' + e.message); }
  })();

  // 3) blob URL 化 + import
  const urls = {};
  try {
    const bundleRaw = await gunzipToBytes(ungzip(window.MPInline.MP_INLINE_BUNDLE));
    const bundleBlob = new Blob([bundleRaw], { type: 'text/javascript' });
    urls.bundle = URL.createObjectURL(bundleBlob);
    const m = await import(urls.bundle);
    out.importBundle = 'OK has=' + (typeof m.HandLandmarker) + ' fileset=' + (typeof m.FilesetResolver);
    window.__MP = m;

    const wasmJsRaw = await gunzipToBytes(ungzip(window.MPInline.MP_INLINE_WASM_JS));
    urls.wasmJs = URL.createObjectURL(new Blob([wasmJsRaw], { type: 'text/javascript' }));
    const wasmBinRaw = await gunzipToBytes(ungzip(window.MP_INLINE_WASM_BIN || window.MPInline.MP_INLINE_WASM_BIN));
    urls.wasmBin = URL.createObjectURL(new Blob([wasmBinRaw], { type: 'application/wasm' }));
    out.blobUrls = 'OK';

    // 4) 用自造 fileset（blob URL）+ modelAssetBuffer 建 HandLandmarker
    const modelRaw = await gunzipToBytes(ungzip(window.MPInline.MP_INLINE_MODEL_HAND));
    out.modelBytes = modelRaw.length;

    const fileset = { wasmLoaderPath: urls.wasmJs, wasmBinaryPath: urls.wasmBin };
    const lm = await m.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: modelRaw, delegate: 'CPU' },
      runningMode: 'VIDEO', numHands: 2,
    });
    out.landmarker = 'OK ' + (lm ? 'created' : 'null');

    // 5) 真跑一次推理
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0,0,640,480);
    const stream = c.captureStream(30);
    const v = document.createElement('video'); v.srcObject = stream; v.muted = true; v.playsInline = true;
    document.body.appendChild(v);
    await v.play();
    await new Promise(r => setTimeout(r, 600));
    const res = lm.detectForVideo(v, performance.now());
    out.infer = 'OK hands=' + ((res && res.landmarks) || []).length;
    lm.close();
  } catch (e) {
    out.importBundle = out.importBundle || ('FAIL ' + (e.name + ': ' + e.message));
    out.error = (e && (e.name + ': ' + e.message)) || String(e);
  }

  return JSON.stringify(out, null, 1);
})()
`;

  for (const [tag, url] of [["file://", fileUrl], ["http://", "http://127.0.0.1:8931/index.html"]]) {
    console.log("\n===== " + tag + " =====");
    const t0 = Date.now();
    await send("Page.navigate", { url: url + "?d=" + Date.now() });
    await sleep(2600);
    try { console.log(await ev(PROBE)); }
    catch (e) { console.log("✗ " + e.message); }
    console.log("   耗时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  }

  ws.close(); chrome.kill();
  await sleep(200);
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
