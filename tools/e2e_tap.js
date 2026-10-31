/* 点选替代路径（PRD F4.3）端到端验证。
 * 场景：轻点食材 → 提示已拿起 → 再点锅 → 食材入锅。
 * 用法：node tools/e2e_tap.js
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params})); });
}
async function ev(e) { const r = await send("Runtime.evaluate", {expression: e, returnByValue: true, awaitPromise: true}); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception)); return r.result?.value; }
async function shot(name) { const r = await send("Page.captureScreenshot", {format: "png"}); fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64")); console.log("  [截图] " + name); }
async function rect(sel) { return ev(`(()=>{const e=document.querySelector('${sel}');if(!e)return null;const b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height};})()`); }
async function mouse(type, x, y) { await send("Input.dispatchMouseEvent", {type, x, y, button: "left", clickCount: 1}); }
async function tap(x, y) { await mouse("mousePressed", x, y); await sleep(70); await mouse("mouseReleased", x, y); await sleep(260); }
async function tapEl(sel) { const p = await rect(sel); if (!p) throw new Error("缺少元素 " + sel); await tap(p.x, p.y); }

const errors = [];
let pass = 0, fail = 0;
function check(cond, msg) { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } }

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9233", "--window-size=1280,860", "--no-first-run", "--user-data-dir=" + path.join(ROOT, ".chrome-tap")], {stdio: "ignore"});
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9233/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) {} await sleep(300); }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const {resolve, reject} = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setCacheDisabled", {cacheDisabled: true});
  await send("Page.navigate", {url: "http://127.0.0.1:8931/index.html?t=" + Date.now()});
  await sleep(1800);

  // 收集页面异常
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text + " " + (m.params.exceptionDetails.exception?.description || ""));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + JSON.stringify(m.params.args.map(a => a.value || a.description)));
  });

  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(500);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(800);

  // 点锅进入下料阶段
  await tapEl("#wokZone"); await sleep(900);

  console.log("[点选替代路径] 炒饭");
  const eggBefore = await ev(`document.querySelectorAll('#wokContents img').length`);

  // ① 轻点鸡蛋 → 应被拾起
  await tapEl('.ing-item[data-ing="egg"]');
  const picked = await ev(`!!document.querySelector('.ing-item.picked')`);
  check(picked, "轻点食材后进入「已拾起」状态");
  const hint = await ev(`document.getElementById('feedback-banner').textContent`);
  check(/拿起/.test(hint), `提示语说明下一步：${hint.trim()}`);
  await shot("_tap_1_picked.png");

  // ② 再点锅 → 应完成放置
  await tapEl("#wokZone"); await sleep(700);
  const eggAfter = await ev(`document.querySelectorAll('#wokContents img').length`);
  check(eggAfter === eggBefore + 1, `点锅后食材入锅（锅内 ${eggBefore} → ${eggAfter}）`);
  const stillPicked = await ev(`!!document.querySelector('.ing-item.picked')`);
  check(!stillPicked, "放置后自动清除拾起状态");

  // ③ 放完 4 样 → 进入翻炒阶段
  for (const ing of ["rice", "carrot", "scallion"]) {
    await tapEl(`.ing-item[data-ing="${ing}"]`);
    await tapEl("#wokZone");
    await sleep(450);
  }
  const allIn = await ev(`document.querySelectorAll('#wokContents img').length`);
  check(allIn >= 4, `四样食材全部入锅（当前 ${allIn}）`);
  await sleep(900);
  const stirHint = await ev(`document.getElementById('hint-text').textContent`);
  check(/翻|搅/.test(stirHint), `进入翻炒阶段：${stirHint.trim().slice(0, 24)}`);

  // ④ 取消拾取：轻点两次应回到未选中
  await ev(`document.getElementById('btn-retry').click()`); await sleep(900);
  await tapEl("#wokZone"); await sleep(700);
  await tapEl('.ing-item[data-ing="egg"]');
  await tapEl('.ing-item[data-ing="egg"]');
  const cancelled = await ev(`!document.querySelector('.ing-item.picked')`);
  check(cancelled, "再次轻点同一食材可取消拾起");

  console.log("\n===== 结果 =====");
  console.log(`  通过 ${pass} / 失败 ${fail}`);
  if (errors.length) { console.log("  页面异常:"); errors.forEach(e => console.log("   ! " + e)); }
  else console.log("  无页面异常 ✓");
  chrome.kill();
  process.exit(fail || errors.length ? 1 : 0);
})();
