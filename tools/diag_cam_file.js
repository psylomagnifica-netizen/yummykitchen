/* ============================================================
 * diag_cam_file.js — file:// 下真实 getUserMedia 是否可用
 * （Chrome 对 file:// 的媒体权限策略与 http 不同）
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
  if (r.exceptionDetails) return "EXC: " + JSON.stringify(r.exceptionDetails.exception);
  return r.result ? r.result.value : undefined;
}

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9343", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    "--user-data-dir=" + path.join(ROOT, ".chrome-camfile"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2400);
  const list = await (await fetch("http://127.0.0.1:9343/json/list")).json();
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
  for (const [tag, url] of [["file://", fileUrl], ["http://", "http://127.0.0.1:8931/index.html"]]) {
    console.log("\n== " + tag);
    await send("Page.navigate", { url: url + "?d=" + Date.now() });
    await sleep(2600);
    const r = await ev(`(async () => {
      const out = { proto: location.protocol, secure: window.isSecureContext };
      out.hasMD = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } } });
        out.cam = 'OK tracks=' + s.getTracks().map(t => t.kind + ':' + t.readyState).join(',');
        s.getTracks().forEach(t => t.stop());
      } catch (e) {
        out.cam = 'FAIL ' + (e.name + ': ' + e.message);
      }
      return JSON.stringify(out);
    })()`);
    console.log("   " + r);
  }

  ws.close(); chrome.kill();
  await sleep(200);
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
