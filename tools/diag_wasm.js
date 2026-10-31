/* ============================================================
 * diag_wasm.js — 测试 file:// 下让 MediaPipe 跑起来的可能路径
 *
 * 未知点：
 *  1) blob worker 里 importScripts(真实本地 file:// js) 行不行
 *  2) worker 内 fetch(file://.../vision_wasm_internal.wasm) 行不行
 *  3) CDN 的 UMD 版 vision_bundle.js 是否存在、能否 classic script 加载
 *  4) 浏览器到底能访问哪些 CDN
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
    "--headless=new", "--remote-debugging-port=9337", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + path.join(ROOT, ".chrome-diag5"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2200);
  const list = await (await fetch("http://127.0.0.1:9337/json/list")).json();
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
  const V = new URL('assets/vendor/mediapipe/', location.href).href;
  const realJs = V + 'wasm/vision_wasm_internal.js';
  const realWasm = V + 'wasm/vision_wasm_internal.wasm';

  // 1) blob worker 里 importScripts(真实本地 file:// js)
  out.workerImportLocal = await new Promise((res) => {
    try {
      const src = 'try{importScripts(' + JSON.stringify(realJs) + ');self.postMessage("imported ok:"+(typeof self.createModule));}catch(e){self.postMessage("ERR "+e.name+": "+e.message);}';
      const w = new Worker(URL.createObjectURL(new Blob([src], {type:'text/javascript'})));
      const t = setTimeout(()=>res('TIMEOUT'), 5000);
      w.onmessage = (e)=>{clearTimeout(t); res(e.data); w.terminate();};
      w.onerror = (e)=>{clearTimeout(t); res('WORKER ERROR '+(e.message||'')); w.terminate();};
    } catch (e) { res('THROW ' + e.message); }
  });

  // 2) blob worker 内 fetch 本地 wasm
  out.workerFetchWasm = await new Promise((res) => {
    try {
      const src = 'fetch(' + JSON.stringify(realWasm) + ').then(r=>r.arrayBuffer()).then(b=>postMessage("OK len="+b.byteLength)).catch(e=>postMessage("ERR "+e.name+": "+e.message));';
      const w = new Worker(URL.createObjectURL(new Blob([src], {type:'text/javascript'})));
      const t = setTimeout(()=>res('TIMEOUT'), 8000);
      w.onmessage = (e)=>{clearTimeout(t); res(e.data); w.terminate();};
      w.onerror = (e)=>{clearTimeout(t); res('WORKER ERROR '+(e.message||'')); w.terminate();};
    } catch (e) { res('THROW ' + e.message); }
  });

  // 3) 主线程 fetch CDN 列表（看浏览器能访问哪些 CDN）
  const cdns = {
    jsdelivr: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.js',
    unpkg: 'https://unpkg.com/@mediapipe/tasks-vision@0.10.21/vision_bundle.js',
    gstorageTask: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  };
  out.cdnReach = {};
  for (const [k, u] of Object.entries(cdns)) {
    try { const r = await fetch(u); out.cdnReach[k] = r.status + ' len=' + (await r.arrayBuffer()).byteLength; }
    catch (e) { out.cdnReach[k] = 'FAIL ' + (e.name + ': ' + e.message); }
  }

  // 4) classic script 标签加载 CDN 的 UMD bundle
  out.cdnUmdScript = await new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.js';
    s.onload = () => res('loaded global=' + (typeof window.vision !== 'undefined' ? 'vision' : typeof window.TasksVision !== 'undefined' ? 'TasksVision' : 'unknown'));
    s.onerror = () => res('script error');
    document.head.appendChild(s);
    setTimeout(()=>res('TIMEOUT'), 8000);
  });

  // 5) 页面内能看到的全局变量（MediaPipe UMD 常挂在 window 上）
  out.globals = ['vision','TasksVision','FilesetResolver','HandLandmarker','FaceLandmarker']
    .map(k => k + '=' + (typeof window[k])).join(',');

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
