/* 录音素材（bgm/*.wav）触发点端到端测试
 *
 * 覆盖：
 *   1. 炒饭：下第一个菜起循环「炒菜.wav」→ 出锅前停 → 结果卡播「成功出锅.wav」
 *   2. 奶茶：牛奶入杯播「倒牛奶.wav」；放冰块播下料音
 *   3. 火锅：每拖一个食材下锅播一次下料音；涮煮播「蒸煮.wav」
 *   4. 酸菜鱼：底料 + 鱼片共 6 次下料音；煮制播「蒸煮.wav」
 *   5. 粽子：蒸煮播「蒸煮.wav」
 *   6. 鲜花饼：结果卡播「成功出锅.wav」
 *   7. 失败路径（炒饭过火）：结果卡不播「成功出锅.wav」
 *
 * 用法：node tools/e2e_sfx.js
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const BASE = "http://127.0.0.1:8931/index.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, msgId = 0;
const pending = new Map();
const pageErrors = [];
const consoleErrors = [];

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
async function rect(selector) {
  const r = await ev(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height,left:b.left,right:b.right};})()`);
  if (!r) throw new Error("找不到元素 " + selector);
  return r;
}
async function mouse(type, x, y) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
async function drag(sx, sy, tx, ty, steps = 12) {
  await mouse("mousePressed", sx, sy);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps);
    await sleep(22);
  }
  await mouse("mouseReleased", tx, ty);
  await sleep(150);
}
async function dragEl(fromSel, toSel) {
  const a = await ev(`(()=>{const el=document.querySelector('${fromSel}');if(!el)return null;
    const h=el.querySelector('.combo-pick')||el;const b=h.getBoundingClientRect();
    return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
  if (!a) throw new Error("找不到元素 " + fromSel);
  const b = await rect(toSel);
  await drag(a.x, a.y, b.x, b.y);
}
async function circle(cx, cy, radius, turns) {
  await mouse("mousePressed", cx + radius, cy);
  const total = Math.PI * 2 * turns;
  for (let a = 0; a <= total + 0.01; a += 0.2) {
    await mouse("mouseMoved", cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    await sleep(16);
  }
  await mouse("mouseReleased", cx + radius, cy);
}
async function hold(x, y, ms) {
  await mouse("mousePressed", x, y);
  await sleep(ms);
  await mouse("mouseReleased", x, y);
}
async function activeScreen() {
  return ev(`(()=>{const s=[...document.querySelectorAll('.screen')].find(x=>x.classList.contains('active'));return s?s.id:'none';})()`);
}
async function waitScreen(id, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await activeScreen()) === id) return true;
    await sleep(200);
  }
  throw new Error("等待屏幕超时: " + id + "（当前 " + (await activeScreen()) + "）");
}
async function stopFireInZone(lo, hi, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await ev(`(()=>{const n=document.querySelector('.firebar-needle');return n?parseFloat(n.style.left):-1;})()`);
    if (v >= lo && v <= hi) { await ev(`document.querySelector('.btn-fire').click()`); return v; }
    if (v > hi + 4) throw new Error("火候错过区间: " + v.toFixed(1));
    await sleep(60);
  }
  throw new Error("火候条等待超时");
}
async function enterDish(cardIndex) {
  await ev(`document.querySelectorAll('.dish-card')[${cardIndex}].click()`);
  await sleep(500);
  await ev(`document.getElementById('btn-cook-this').click()`);
  await sleep(800);
  if ((await activeScreen()) !== "screen-cook") throw new Error("未进入烹饪页");
  await ev(`window.__sfx.calls = {}`);   // 每道菜单独计数
}

/* ---------- 音频状态读取 ---------- */
async function ast(name) {
  return ev(`(()=>{const a=window.Sfx.element(${JSON.stringify(name)});if(!a)return null;
    return {src:decodeURIComponent(a.currentSrc||a.src||""),paused:a.paused,t:a.currentTime,
            ready:a.readyState,loop:a.loop,vol:a.volume,err:a.error?a.error.code:0};})()`);
}
async function calls() { return ev(`window.__sfx.calls`); }

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ✓ " + name + (detail ? "  " + detail : "")); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  " + detail : "")); }
}
/** 断言某个素材正在播放，且确实加载出来了（有进度、没报错） */
function checkPlaying(label, name, fileName) {
  return (async () => {
    const a = await ast(name);
    if (!a) { check(label, false, "音频元素不存在"); return false; }
    const srcOk = a.src.indexOf(fileName) >= 0;
    const ok = !a.paused && a.ready >= 2 && a.t > 0 && !a.err && srcOk;
    check(label, ok, `src=${a.src.split("/").pop()} paused=${a.paused} t=${a.t.toFixed(2)}s vol=${a.vol}`);
    return ok;
  })();
}

/* ============================================================ */
async function testChaofan() {
  console.log("\n[1] 炒饭 —— 炒菜.wav（下第一个菜起→出锅前停）+ 成功出锅.wav");
  await enterDish(0);
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.x, wok.y); await mouse("mouseReleased", wok.x, wok.y);
  await sleep(1400);

  // 下第一个菜之前还没播
  check("下第一个菜之前不播炒菜声", (await ast("fry")) === null, "");

  await dragEl('.ing-item[data-ing="egg"]', "#wokZone");
  await sleep(900);
  await checkPlaying("下第一个菜起开始播炒菜声", "fry", "炒菜.wav");

  for (const ing of ["rice", "carrot", "scallion"]) {
    await dragEl(`.ing-item[data-ing="${ing}"]`, "#wokZone");
    await sleep(600);
  }
  check("下料期间炒菜声持续", (await ast("fry")).paused === false, "");

  // 翻炒
  await sleep(1400);
  const wok2 = await rect("#wokZone");
  await circle(wok2.x, wok2.y, Math.min(wok2.w, wok2.h) * 0.28, 3.3);
  await sleep(1500);
  check("翻炒阶段炒菜声仍在", (await ast("fry")).paused === false, "");

  // 火候 → 出锅
  await stopFireInZone(62, 78);
  await sleep(1800);
  const fryAtServe = await ast("fry");
  check("出锅前炒菜声停止", fryAtServe.paused === true, `paused=${fryAtServe.paused} t=${fryAtServe.t.toFixed(2)}`);

  // 盛出 → 结果卡
  await dragEl("#spatula", "#serveBowl");
  await waitScreen("screen-result");
  await sleep(1200);
  await checkPlaying("结果卡播放成功出锅音乐", "done", "成功出锅.wav");
  const c = await calls();
  check("结果卡前已停掉炒菜声", (c["stop:fry"] || 0) >= 1, `stop:fry=${c["stop:fry"] || 0}`);
}

/* ============================================================ */
async function testNaicha() {
  console.log("\n[2] 奶茶 —— 倒牛奶.wav + 放冰块下料音");
  await enterDish(2);
  await ev(`document.querySelector('.choice-card[data-tea="hongcha"]').click()`);
  await sleep(1400);
  await dragEl("#milkItem", "#cupZone");
  await sleep(1000);
  await checkPlaying("牛奶拖进杯子后播倒奶声", "milk", "倒牛奶.wav");

  await dragEl("#iceItem", "#cupZone");
  await sleep(700);
  await checkPlaying("放冰块播下料音", "drop", "火锅下料放冰块.wav");
  let c = await calls();
  check("放冰块只触发 1 次下料音", (c["play:drop"] || 0) === 1, `play:drop=${c["play:drop"] || 0}`);

  const cup = await rect("#cupZone");
  await circle(cup.x, cup.y, Math.min(cup.w, 90) * 0.7, 2.4);
  await sleep(1500);
  await hold(cup.x, cup.y, 1200);
  await waitScreen("screen-result");
  await sleep(1200);
  await checkPlaying("结果卡播放成功出锅音乐", "done", "成功出锅.wav");
}

/* ============================================================ */
async function testHuoguo() {
  console.log("\n[3] 火锅 —— 每拖一个下锅响一次 + 蒸煮.wav");
  await enterDish(3);
  await ev(`document.querySelector('.choice-card[data-broth="mala"]').click()`);
  await sleep(1300);
  await ev(`document.querySelector('.choice-card[data-ing="beef"]').click()`);
  await ev(`document.querySelector('.choice-card[data-ing="tofu"]').click()`);
  await sleep(300);
  await ev(`document.getElementById('btn-pick-ok').click()`);
  await sleep(700);

  await dragEl('.ing-item[data-ing="beef"]', "#potZone");
  await sleep(500);
  let c = await calls();
  check("拖第 1 个食材下锅响 1 次", (c["play:drop"] || 0) === 1, `play:drop=${c["play:drop"] || 0}`);
  await dragEl('.ing-item[data-ing="tofu"]', "#potZone");
  await sleep(500);
  c = await calls();
  check("拖第 2 个食材下锅再响 1 次", (c["play:drop"] || 0) === 2, `play:drop=${c["play:drop"] || 0}`);

  await sleep(1400);
  await checkPlaying("涮煮阶段播蒸煮声", "boil", "蒸煮.wav");

  await stopFireInZone(55, 78);
  await waitScreen("screen-result");
  await sleep(1200);
  const b = await ast("boil");
  check("出结果卡时蒸煮声停止", b.paused === true, `paused=${b.paused}`);
  await checkPlaying("结果卡播放成功出锅音乐", "done", "成功出锅.wav");
}

/* ============================================================ */
async function testSuancaiyu() {
  console.log("\n[4] 酸菜鱼 —— 每个食材进锅响一次 + 蒸煮.wav");
  await enterDish(4);
  await ev(`document.querySelector('[data-sour="特酸"]').click()`);
  await ev(`document.getElementById('btn-huajiao').click()`);
  await ev(`document.getElementById('btn-taste-ok').click()`);
  await sleep(1200);
  await checkPlaying("备汤底时开始煮（蒸煮声）", "boil", "蒸煮.wav");

  for (let i = 0; i < 3; i++) {
    const n = await ev(`document.querySelectorAll('.ing-item.next').length`);
    if (!n) break;
    await dragEl(".ing-item.next", "#potZone");
    await sleep(500);
  }
  let c = await calls();
  check("3 份底料进锅响 3 次", (c["play:drop"] || 0) === 3, `play:drop=${c["play:drop"] || 0}`);

  await sleep(1200);
  for (let i = 0; i < 3; i++) {
    const used = await ev(`document.getElementById('fishItem') ? document.getElementById('fishItem').classList.contains('used') : true`);
    if (used) break;
    await dragEl("#fishItem", "#potZone");
    await sleep(600);
  }
  c = await calls();
  check("3 片鱼片进锅再响 3 次（共 6 次）", (c["play:drop"] || 0) === 6, `play:drop=${c["play:drop"] || 0}`);

  await sleep(1400);
  await stopFireInZone(63, 80);
  await waitScreen("screen-result");
  await sleep(1200);
  const b = await ast("boil");
  check("出结果卡时蒸煮声停止", b.paused === true, `paused=${b.paused}`);
  await checkPlaying("结果卡播放成功出锅音乐", "done", "成功出锅.wav");
}

/* ============================================================ */
async function testZongzi() {
  console.log("\n[5] 粽子 —— 蒸煮.wav");
  await enterDish(1);
  await ev(`document.querySelectorAll('#branchOverlay .paper')[0].click()`);
  await sleep(1000);
  for (const ing of ["zongrice", "pork", "yolk"]) {
    await dragEl(`.ing-item[data-ing="${ing}"]`, "#wrapZone");
    await sleep(700);
  }
  await sleep(1200);
  for (const [dx, dy] of [[0, -120], [-140, 0], [140, 0]]) {
    const z = await rect("#wrapZone");
    await drag(z.x, z.y, z.x + dx, z.y + dy, 14);
    await sleep(800);
  }
  await sleep(2400);
  await checkPlaying("蒸煮阶段播蒸煮声", "boil", "蒸煮.wav");

  await stopFireInZone(58, 80);
  await waitScreen("screen-result");
  await sleep(1200);
  const b = await ast("boil");
  check("出结果卡时蒸煮声停止", b.paused === true, `paused=${b.paused}`);
  await checkPlaying("结果卡播放成功出锅音乐", "done", "成功出锅.wav");
}

/* ============================================================ */
async function testXianhuabing() {
  console.log("\n[6] 鲜花饼 —— 结果卡成功出锅.wav");
  await enterDish(5);
  await ev(`document.getElementById('btn-crust-ok').click()`);
  await sleep(1000);
  await dragEl("#roseItem", "#boardZone");
  await sleep(1200);
  for (const [dx, dy] of [[0, -120], [-140, 0]]) {
    const d = await rect("#doughWrap");
    await drag(d.x, d.y, d.x + dx, d.y + dy, 14);
    await sleep(700);
  }
  const d2 = await rect("#doughWrap");
  await hold(d2.x, d2.y, 1000);
  await sleep(1400);
  await dragEl("#doughWrap", "#oven");
  await sleep(1500);
  await stopFireInZone(58, 80);
  await waitScreen("screen-result");
  await sleep(1200);
  await checkPlaying("结果卡播放成功出锅音乐", "done", "成功出锅.wav");
}

/* ============================================================ */
async function testFailNoMusic() {
  console.log("\n[7] 失败路径 —— 做砸了不播成功出锅音乐");
  await ev(`document.getElementById('btn-result-menu') && document.getElementById('btn-result-menu').click()`);
  await sleep(700);
  await ev(`document.getElementById('btn-start') && document.getElementById('btn-start').click()`);
  await sleep(700);
  await enterDish(0);
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.x, wok.y); await mouse("mouseReleased", wok.x, wok.y);
  await sleep(1400);
  for (const ing of ["egg", "rice", "carrot", "scallion"]) {
    await dragEl(`.ing-item[data-ing="${ing}"]`, "#wokZone");
    await sleep(600);
  }
  await sleep(1400);
  const wok2 = await rect("#wokZone");
  await circle(wok2.x, wok2.y, Math.min(wok2.w, wok2.h) * 0.28, 3.3);
  await sleep(1500);
  // 故意等火候条冲过头
  await stopFireInZone(93, 99);
  await waitScreen("screen-result");
  await sleep(1400);
  const d = await ast("done");
  check("失败结果卡不播成功出锅音乐", !d || d.paused === true, d ? `paused=${d.paused} t=${d.t.toFixed(2)}` : "未创建音频元素");
  // Telemetry 是顶层 const，只在全局词法环境可见，取不到 window.Telemetry
  const outcome = await ev(`(()=>{const T=(typeof Telemetry!=='undefined')?Telemetry:null;
    const L=T?T.events:[];const c=L.filter(l=>l.event==='result_card').pop();return c?c.outcome:null;})()`);
  const title = await ev(`document.getElementById('result-title').textContent`);
  check("确实是失败结局", outcome && outcome !== "perfect", `outcome=${outcome} 标题「${title}」`);
}

/* ============================================================ */
async function testLifecycle() {
  console.log("\n[8] 生命周期 —— 暂停/继续/中途返回菜单不漏音");
  await ev(`document.getElementById('btn-result-menu') && document.getElementById('btn-result-menu').click()`);
  await sleep(700);
  await ev(`document.getElementById('btn-start') && document.getElementById('btn-start').click()`);
  await sleep(700);
  await enterDish(0);
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.x, wok.y); await mouse("mouseReleased", wok.x, wok.y);
  await sleep(1400);
  await dragEl('.ing-item[data-ing="egg"]', "#wokZone");
  await sleep(900);
  check("炒菜声已起", (await ast("fry")).paused === false, "");

  // 暂停 → 暂停音频；继续 → 接着放
  await ev(`document.getElementById('btn-pause').click()`);
  await sleep(600);
  const paused = await ast("fry");
  check("暂停时炒菜声也暂停", paused.paused === true, `paused=${paused.paused}`);
  await ev(`document.getElementById('btn-resume').click()`);
  await sleep(700);
  check("继续后炒菜声接着放", (await ast("fry")).paused === false, "");

  // 烹饪中直接返回菜单 → 必须停干净
  await ev(`document.getElementById('btn-back-menu').click()`);
  await sleep(800);
  const left = await ast("fry");
  check("中途返回菜单后炒菜声停止", left.paused === true, `paused=${left.paused}`);
  check("已回到菜单页", (await activeScreen()) === "screen-menu", "");
}

/* ============================================================ */
async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9234",
    "--window-size=1280,860", "--no-first-run", "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=" + path.join(ROOT, ".chrome-sfx"),
  ], { stdio: "ignore" });
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try {
        targets = await (await fetch("http://127.0.0.1:9234/json")).json();
        if (targets.some((t) => t.type === "page")) break;
      } catch (e) {}
      await sleep(300);
    }
    const page = targets.find((t) => t.type === "page");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        return;
      }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        pageErrors.push(d.exception?.description || d.text || "未知异常");
      }
      if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
        consoleErrors.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    };
    await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
    await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
    await sleep(2200);

    // 给 Sfx 包一层计数器，统计各触发点被调用了几次
    await ev(`(()=>{
      window.__sfx = { calls: {} };
      ["play","loop","stop"].forEach((fn)=>{
        const orig = window.Sfx[fn];
        window.Sfx[fn] = function(name){
          const k = fn + ":" + name;
          window.__sfx.calls[k] = (window.__sfx.calls[k]||0) + 1;
          return orig.call(window.Sfx, name);
        };
      });
      return true;
    })()`);
    check("Sfx 计数补丁注入成功", await ev(`typeof window.Sfx.play === "function" && !!window.__sfx`));

    await ev(`document.getElementById('btn-start').click()`);
    await sleep(800);

    const suites = [testChaofan, testNaicha, testHuoguo, testSuancaiyu, testZongzi, testXianhuabing, testFailNoMusic, testLifecycle];
    for (const fn of suites) {
      const errBefore = pageErrors.length + consoleErrors.length;
      try {
        await fn();
      } catch (e) {
        fail++;
        console.error("  ✗ 场景异常: " + e.message);
      }
      const newErr = pageErrors.length + consoleErrors.length - errBefore;
      if (newErr) console.log(`  ! 该场景新增 ${newErr} 条页面告警`);
    }

    console.log(`\n===== 音效测试汇总：${pass} 通过 / ${fail} 失败 =====`);
    if (pageErrors.length) {
      console.log("\n页面异常:");
      pageErrors.slice(0, 10).forEach((e) => console.log("  ! " + String(e).split("\n")[0]));
    }
    if (consoleErrors.length) {
      console.log("\n控制台告警:");
      consoleErrors.slice(0, 10).forEach((e) => console.log("  ! " + e));
    }
    if (fail) process.exitCode = 1;
  } catch (err) {
    console.error("测试框架异常:", err.message);
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch (e) {}
    chrome.kill();
  }
}

main();
