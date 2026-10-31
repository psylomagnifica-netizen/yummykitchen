/* 缓存诊断：对比带版本参数与不带版本参数时，浏览器实际拿到的素材尺寸。
 * 用法：node tools/check_cache.js
 */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params})); });
}
async function ev(e) { const r = await send("Runtime.evaluate", {expression: e, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception)); return r.result?.value; }

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9229", "--no-first-run", "--user-data-dir=" + path.join(ROOT, ".chrome-shot2")], {stdio: "ignore"});
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9229/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) {} await sleep(300); }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const {resolve, reject} = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", {url: "http://127.0.0.1:8931/index.html?t=" + Date.now()});
  await sleep(1500);

  const probe = async (url) => await ev(`new Promise(res=>{const i=new Image();i.onload=()=>res(i.naturalWidth+'x'+i.naturalHeight);i.onerror=()=>res('ERR');i.src='${url}';})`);
  console.log("board.png?v=2      ->", await probe("assets/tool/board.png?v=2"));
  console.log("board.png?v=9      ->", await probe("assets/tool/board.png?v=9"));
  console.log("board.png (无版本) ->", await probe("assets/tool/board.png"));
  console.log("wok.png?v=2        ->", await probe("assets/tool/wok.png?v=2"));
  console.log("wok.png?v=9        ->", await probe("assets/tool/wok.png?v=9"));
  chrome.kill();
  process.exit(0);
})();
