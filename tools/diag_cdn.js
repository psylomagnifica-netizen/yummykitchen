/* ============================================================
 * diag_cdn.js — 测试 file:// 下能否用 CDN 兜底加载 MediaPipe
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
  if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9335", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + path.join(ROOT, ".chrome-diag3"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2200);
  const list = await (await fetch("http://127.0.0.1:9335/json/list")).json();
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

  const PROBE = `
(async () => {
  const out = {};
  const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
  // 1) file:// 页面 fetch CDN 的 wasm
  try { const r = await fetch(CDN + '/wasm/vision_wasm_internal.wasm'); out.cdnWasm = r.status + ' len=' + (await r.arrayBuffer()).byteLength; }
  catch (e) { out.cdnWasm = 'FAIL ' + (e.name + ': ' + e.message); }
  // 2) file:// 页面 fetch CDN 的手部模型
  try { const r = await fetch('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'); out.cdnTask = r.status + ' len=' + (await r.arrayBuffer()).byteLength; }
  catch (e) { out.cdnTask = 'FAIL ' + (e.name + ': ' + e.message); }
  // 3) file:// 页面动态 import CDN 的 mjs
  try { const m = await import(CDN + '/vision_bundle.mjs'); out.cdnImport = 'OK has=' + (typeof m.HandLandmarker); }
  catch (e) { out.cdnImport = 'FAIL ' + (e.name + ': ' + e.message); }
  // 4) 完整跑一遍 CDN 版 HandLandmarker
  out.cdnFull = await (async () => {
    try {
      const m = await import(CDN + '/vision_bundle.mjs');
      const fs = await m.FilesetResolver.forVisionTasks(CDN + '/wasm');
      const lm = await m.HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
      });
      return 'OK ' + (lm ? 'landmarker' : 'null');
    } catch (e) { return 'FAIL ' + (e.name + ': ' + e.message); }
  })();
  return JSON.stringify(out, null, 1);
})()
`;

  for (const [tag, url] of [["file://", fileUrl], ["http://", "http://127.0.0.1:8931/index.html"]]) {
    console.log("\n===== " + tag + " =====");
    await send("Page.navigate", { url: url + "?d=" + Date.now() });
    await sleep(2600);
    try { console.log(await ev(PROBE)); }
    catch (e) { console.log("✗ " + e.message); }
  }

  ws.close(); chrome.kill();
  await sleep(200);
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
