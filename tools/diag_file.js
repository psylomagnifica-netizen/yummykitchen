/* ============================================================
 * diag_file.js — 探明 file:// 下到底哪些资源能加载
 * 用于确定「双击打开」场景的修复边界
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
    "--headless=new", "--remote-debugging-port=9334", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + path.join(ROOT, ".chrome-diag2"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2200);
  const list = await (await fetch("http://127.0.0.1:9334/json/list")).json();
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
  // 1) fetch 读 .task
  try { const r = await fetch(V + 'hand_landmarker.task'); out.taskFetch = r.status + ' len=' + (await r.arrayBuffer()).byteLength; }
  catch (e) { out.taskFetch = 'FAIL ' + (e.name + ': ' + e.message); }
  // 2) fetch 读 wasm
  try { const r = await fetch(V + 'wasm/vision_wasm_internal.wasm'); out.wasmFetch = r.status + ' len=' + (await r.arrayBuffer()).byteLength; }
  catch (e) { out.wasmFetch = 'FAIL ' + (e.name + ': ' + e.message); }
  // 3) XHR 读 .task
  try { out.taskXhr = await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', V + 'hand_landmarker.task'); x.responseType='arraybuffer'; x.onload=()=>res(x.status+' len='+x.response.byteLength); x.onerror=()=>rej(new Error('xhr error')); x.send(); }); }
  catch (e) { out.taskXhr = 'FAIL ' + e.message; }
  // 4) 动态 import 传统 script（非 module）
  try { out.scriptLoad = await new Promise((res) => { const s = document.createElement('script'); s.src = V + 'vision_bundle.mjs'; s.onload=()=>res('loaded'); s.onerror=()=>res('script error'); document.head.appendChild(s); }); }
  catch (e) { out.scriptLoad = 'FAIL ' + e.message; }
  // 5) 动态 import module
  try { await import(V + 'vision_bundle.mjs'); out.moduleImport = 'OK'; }
  catch (e) { out.moduleImport = 'FAIL ' + (e.name + ': ' + e.message); }
  // 6) 页面里已有的 <img src> 能否加载本地 png（file:// 下相对路径）
  out.imgOk = await new Promise((res) => { const i = new Image(); i.onload=()=>res('OK ' + i.naturalWidth); i.onerror=()=>res('FAIL'); i.src = new URL('assets/ing/奶茶_装满牛奶.png', location.href).href; });
  return JSON.stringify(out, null, 1);
})()
`;

  for (const [tag, url] of [["file://", fileUrl], ["http://", "http://127.0.0.1:8931/index.html"]]) {
    console.log("\n===== " + tag + " =====");
    await send("Page.navigate", { url: url + "?d=" + Date.now() });
    await sleep(2600);
    try {
      console.log(await ev(PROBE));
    } catch (e) { console.log("✗ " + e.message); }
  }

  ws.close(); chrome.kill();
  await sleep(200);
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
