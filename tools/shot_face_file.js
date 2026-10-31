/* ============================================================
 * shot_face_file.js — 验证奶茶「眨眼封口」在 file:// 下也能加载人脸模型
 * （与手部模型同一个根因：file:// 禁 fetch/import）
 * ============================================================ */
"use strict";
const { spawn } = require("child_process");
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
  if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9342", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    "--user-data-dir=" + path.join(ROOT, ".chrome-facefile"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2400);
  const list = await (await fetch("http://127.0.0.1:9342/json/list")).json();
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

  const fileUrl = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");
  let ok = true;

  for (const [tag, url] of [["file://", fileUrl], ["http://", "http://127.0.0.1:8931/index.html"]]) {
    console.log("\n== " + tag);
    errors.length = 0;
    await send("Page.navigate", { url: url + "?d=" + Date.now() });
    await sleep(2800);

    const t0 = Date.now();
    const res = await ev(`(async () => {
      try {
        const lm = await MPLoader.create('face', { runningMode: 'VIDEO', numFaces: 1 });
        return JSON.stringify({ ok: true, created: !!lm, mode: MPLoader.mode });
      } catch (e) {
        return JSON.stringify({ ok: false, err: (e && e.name + ': ' + e.message) || String(e), mode: MPLoader.mode });
      }
    })()`);
    console.log("   人脸模型加载:", res, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (!JSON.parse(res).ok) ok = false;

    // 走一遍眨眼模块的启动路径（用注入 provider 避免依赖真实人脸）
    const blink = await ev(`(async () => {
      try {
        const r = await Blink.start({ video: document.createElement('video'), onStatus: () => {} });
        return JSON.stringify({ ok: r.ok, mode: Blink.mode });
      } catch (e) { return JSON.stringify({ ok: false, err: String(e) }); }
    })()`);
    console.log("   Blink 启动:", blink);
    console.log("   页面异常:", errors.length ? errors : "无");
    await ev(`Blink.stop()`);
  }

  ws.close(); chrome.kill();
  await sleep(300);
  console.log("\n=== 结论 ===");
  console.log("  人脸模型 file:// 可用:", ok ? "✓" : "✗");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("✗", e); process.exit(1); });
