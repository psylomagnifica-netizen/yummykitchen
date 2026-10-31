/* ============================================================
 * shot_env.js — 验证启动页的环境自检提示
 *   file://  → 应显示提示条，指向 start-server.bat / serve.py
 *   http://  → 不应显示提示条
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
  if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}
async function shotClip(name, selector, pad = 16, scale = 2) {
  const b = await ev(`(()=>{const e=document.querySelector('${selector}');if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};})()`);
  if (!b) return;
  const r = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2, scale },
  });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9341", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + path.join(ROOT, ".chrome-env"), "about:blank",
  ], { stdio: "ignore" });
  await sleep(2400);
  const list = await (await fetch("http://127.0.0.1:9341/json/list")).json();
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

  for (const [tag, url, expectVisible] of [
    ["file://（双击打开）", fileUrl, true],
    ["http://（本地服务器）", "http://127.0.0.1:8931/index.html", false],
  ]) {
    console.log("\n== " + tag);
    errors.length = 0;
    await send("Page.navigate", { url: url + "?d=" + Date.now() });
    await sleep(2600);
    const st = await ev(`(()=>{
      const n = document.getElementById('envNotice');
      return { visible: !n.classList.contains('hidden'),
               text: n.textContent.replace(/\\s+/g,' ').trim().slice(0, 130) };
    })()`);
    console.log("   提示条可见:", st.visible);
    console.log("   内容:", st.text);
    const pass = st.visible === expectVisible;
    if (!pass) ok = false;
    console.log("   → " + (pass ? "✓" : "✗"));
    console.log("   页面异常:", errors.length ? errors : "无");
    if (expectVisible) await shotClip("_env_notice_file.png", "#envNotice", 18, 2);
  }

  ws.close(); chrome.kill();
  await sleep(300);
  console.log("\n=== 结论 ===");
  console.log("  环境自检:", ok ? "✓" : "✗");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("✗", e); process.exit(1); });
