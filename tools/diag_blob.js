/* ============================================================
 * diag_blob.js — 测试 file:// 下「blob URL + 内联资源」方案可行性
 *
 * 需要验证三件事：
 *  1) file:// 页面能否 import(blobURL)（ES module from blob）
 *  2) file:// 页面能否 fetch(blobURL)（取 wasm 二进制 / 模型）
 *  3) file:// 下能否 importScripts(file://...) 或用 blob 替代 wasm loader
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
    "--headless=new", "--remote-debugging-port=9336", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + path.join(ROOT, ".chrome-diag4"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2200);
  const list = await (await fetch("http://127.0.0.1:9336/json/list")).json();
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
  // 1) import(blobURL) —— ES module from blob
  try {
    const src = 'export const hello = "blob-module-works"; export default 42;';
    const u = URL.createObjectURL(new Blob([src], {type:'text/javascript'}));
    const m = await import(u);
    out.blobModule = 'OK ' + m.hello + ' default=' + m.default;
  } catch (e) { out.blobModule = 'FAIL ' + (e.name + ': ' + e.message); }

  // 2) fetch(blobURL) —— 取二进制
  try {
    const u = URL.createObjectURL(new Blob([new Uint8Array([1,2,3,4,5])], {type:'application/octet-stream'}));
    const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer());
    out.blobFetch = 'OK len=' + b.length + ' first=' + b[0];
  } catch (e) { out.blobFetch = 'FAIL ' + (e.name + ': ' + e.message); }

  // 3) Worker + importScripts(blobURL)
  try {
    const workerSrc = 'importScripts(URL.createObjectURL(new Blob(["self.onmessage=()=>postMessage(\\"worker-ok\\")"],{type:"text/javascript"})));';
    const wu = URL.createObjectURL(new Blob([workerSrc], {type:'text/javascript'}));
    const w = new Worker(wu);
    out.workerBlob = await new Promise((res) => {
      const t = setTimeout(()=>res('TIMEOUT'), 3000);
      w.onmessage = (e)=>{ clearTimeout(t); res('OK ' + e.data); };
      w.onerror = (e)=>{ clearTimeout(t); res('FAIL ' + e.message); };
      w.postMessage(1);
    });
    w.terminate();
  } catch (e) { out.workerBlob = 'FAIL ' + (e.name + ': ' + e.message); }

  // 4) Worker + importScripts(file://...)
  try {
    const wu = URL.createObjectURL(new Blob(['importScripts("file:///__nope__");'], {type:'text/javascript'}));
    const w = new Worker(wu);
    out.workerFile = await new Promise((res) => {
      const t = setTimeout(()=>res('TIMEOUT'), 3000);
      w.onmessage = (e)=>{ clearTimeout(t); res('OK'); };
      w.onerror = (e)=>{ clearTimeout(t); res('FAIL ' + (e.message||'err')); };
    });
    w.terminate();
  } catch (e) { out.workerFile = 'FAIL ' + (e.name + ': ' + e.message); }

  // 5) 经典 script 标签能否读同源 file:// 的 .mjs（会因 export 语法报错，但看能否取到源码）
  out.scriptTagFetch = await new Promise((res) => {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', new URL('assets/vendor/mediapipe/vision_bundle.mjs', location.href).href, false);
      x.send();
      res('syncXhr status=' + x.status + ' len=' + (x.responseText||'').length);
    } catch (e) { res('FAIL ' + e.message); }
  });

  // 6) <script type="module" src="file://..."> 能否加载
  out.moduleTag = await new Promise((res) => {
    const s = document.createElement('script');
    s.type = 'module';
    s.onload = () => res('loaded');
    s.onerror = (e) => res('error');
    s.src = new URL('assets/vendor/mediapipe/vision_bundle.mjs', location.href).href;
    document.head.appendChild(s);
    setTimeout(()=>res('TIMEOUT'), 3000);
  });

  // 7) data: URL 的 module import
  try {
    const u = 'data:text/javascript,' + encodeURIComponent('export const v="data-module-ok";');
    const m = await import(u);
    out.dataModule = 'OK ' + m.v;
  } catch (e) { out.dataModule = 'FAIL ' + (e.name + ': ' + e.message); }

  // 8) data: URL 的 fetch
  try {
    const r = await fetch('data:application/octet-stream;base64,AQIDBAU=');
    const b = new Uint8Array(await r.arrayBuffer());
    out.dataFetch = 'OK len=' + b.length;
  } catch (e) { out.dataFetch = 'FAIL ' + (e.name + ': ' + e.message); }

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
