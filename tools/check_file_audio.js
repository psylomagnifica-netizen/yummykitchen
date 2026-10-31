/* file:// 直接双击打开时，bgm/*.wav 是否还能播
 * 用法：node tools/check_file_audio.js
 */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const FILE_URL = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/").replace(/^\//, "");
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
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9235", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=" + path.join(ROOT, ".chrome-fileaudio")], { stdio: "ignore" });
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try {
        targets = await (await fetch("http://127.0.0.1:9235/json")).json();
        if (targets.some((t) => t.type === "page")) break;
      } catch (e) {}
      await sleep(300);
    }
    ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
    await send("Page.enable"); await send("Runtime.enable");
    await send("Page.navigate", { url: FILE_URL });
    await sleep(2500);
    console.log("页面协议:", await ev(`location.protocol`));
    console.log("Sfx 已加载:", await ev(`typeof window.Sfx === "object"`));

    // 直接播每一个素材，看是否都能真正出声
    const names = await ev(`Object.keys(window.Sfx.BANK)`);
    for (const n of names) {
      await ev(`window.Sfx.play(${JSON.stringify(n)})`);
      await sleep(900);
      const a = await ev(`(()=>{const a=window.Sfx.element(${JSON.stringify(n)});if(!a)return null;
        return {src:decodeURIComponent(a.currentSrc||a.src),paused:a.paused,t:a.currentTime,ready:a.readyState,err:a.error?a.error.code:0};})()`);
      const ok = a && !a.paused && a.ready >= 2 && a.t > 0 && !a.err;
      console.log(`  ${ok ? "✓" : "✗"} ${n.padEnd(5)} ${a ? a.src.split("/").pop() : "无元素"}  paused=${a && a.paused} t=${a && a.t.toFixed(2)}s ready=${a && a.ready} err=${a && a.err}`);
    }
  } catch (e) {
    console.error("异常:", e.message);
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch (e) {}
    chrome.kill();
  }
})();
