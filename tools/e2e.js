/* 全量端到端自测：覆盖六道菜的核心交互链路 + 页面错误收集。
 * 用法：node tools/e2e.js [all|chaofan|zongzi|naicha|huoguo|suancaiyu|xianhuabing]
 * 依赖：node 22（内置 fetch / WebSocket），Chrome 已安装在 .agent-browser/browsers。
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
const pageErrors = [];   // 页面运行时异常
const consoleErrors = []; // console.error / 未捕获 Promise

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}

async function rect(selector) {
  const r = await evaluate(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height,left:b.left,top:b.top};})()`);
  if (!r) throw new Error("找不到元素 " + selector);
  return r;
}

async function mouse(type, x, y, extra = {}) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
}

async function drag(sx, sy, tx, ty, steps = 12) {
  await mouse("mousePressed", sx, sy);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps);
    await sleep(24);
  }
  await mouse("mouseReleased", tx, ty);
  await sleep(150);
}

async function dragEl(fromSel, toSel) {
  // 组合素材（碗 + 米）只有 .combo-pick（碗里的米）是拖拽把手，碗是固定的
  const a = await evaluate(`(()=>{const el=document.querySelector('${fromSel}');if(!el)return null;
    const h=el.querySelector('.combo-pick')||el;const b=h.getBoundingClientRect();
    return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height};})()`);
  if (!a) throw new Error("找不到元素 " + fromSel);
  const b = await rect(toSel);
  await drag(a.x, a.y, b.x, b.y);
}

async function circle(cx, cy, radius, turns, dir = 1) {
  await mouse("mousePressed", cx + radius, cy);
  const total = Math.PI * 2 * turns;
  for (let a = 0; a <= total + 0.01; a += 0.2) {
    await mouse("mouseMoved", cx + Math.cos(a * dir) * radius, cy + Math.sin(a * dir) * radius);
    await sleep(16);
  }
  await mouse("mouseReleased", cx + radius, cy);
}

async function hold(x, y, ms) {
  await mouse("mousePressed", x, y);
  await sleep(ms);
  await mouse("mouseReleased", x, y);
}

async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}

async function activeScreen() {
  return evaluate(`(()=>{const s=[...document.querySelectorAll('.screen')].find(x=>x.classList.contains('active'));return s?s.id:'none';})()`);
}

async function waitScreen(id, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await activeScreen()) === id) return;
    await sleep(200);
  }
  throw new Error("等待屏幕超时: " + id + "（当前 " + (await activeScreen()) + "）");
}

async function hint() {
  return evaluate(`document.getElementById('hint-text') ? document.getElementById('hint-text').textContent.trim() : ''`);
}

/* 等待火候针进入目标区间后点击按钮 */
async function stopFireInZone(lo, hi) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const v = await evaluate(`(()=>{const n=document.querySelector('.firebar-needle');return n?parseFloat(n.style.left):-1;})()`);
    if (v >= lo && v <= hi) {
      await evaluate(`document.querySelector('.btn-fire').click()`);
      return v;
    }
    if (v > hi + 4) throw new Error("火候错过区间: " + v.toFixed(1));
    await sleep(70);
  }
  throw new Error("火候条等待超时");
}

async function enterDish(cardIndex) {
  await evaluate(`document.querySelectorAll('.dish-card')[${cardIndex}].click()`);
  await sleep(500);
  await evaluate(`document.getElementById('btn-cook-this').click()`);
  await sleep(700);
  const s = await activeScreen();
  if (s !== "screen-cook") throw new Error("未进入烹饪页，当前 " + s);
}

/* ---------------- 炒饭 ---------------- */
async function testChaofan() {
  console.log("[炒饭] 热锅→按序下料→环形翻炒→关火→盛出");
  await enterDish(0);
  // 热锅
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.x, wok.y);
  await mouse("mouseReleased", wok.x, wok.y);
  await sleep(1400);
  // 按序下料：egg → rice → carrot → scallion
  for (const ing of ["egg", "rice", "carrot", "scallion"]) {
    const sel = `.ing-item[data-ing="${ing}"]`;
    const has = await evaluate(`!!document.querySelector('${sel}')`);
    if (!has) throw new Error("备料区缺少 " + ing);
    await dragEl(sel, "#wokZone");
    await sleep(700);
  }
  const dropped = await evaluate(`document.querySelectorAll('#wokContents img').length`);
  if (dropped !== 4) throw new Error("下料数量异常: " + dropped);
  await sleep(1400);
  // 环形翻炒 3 圈
  const wok2 = await rect("#wokZone");
  const R = Math.min(wok2.w, wok2.h) * 0.28;
  await circle(wok2.x, wok2.y, R, 3.3);
  await sleep(1500);
  // 火候
  await stopFireInZone(62, 78);
  await sleep(1800);
  // 盛出
  await dragEl("#spatula", "#serveBowl");
  await waitScreen("screen-result");
  await sleep(900);
  await shot("_test_chaofan_result.png");
  console.log("  ✓ 炒饭全流程完成");
}

/* ---------------- 粽子 ---------------- */
async function testZongzi() {
  console.log("[粽子] 咸/甜分支→放料→三折包裹→蒸煮起锅");
  await enterDish(1);
  // 分支：咸口
  await evaluate(`document.querySelectorAll('#branchOverlay .paper')[0].click()`);
  await sleep(1000);
  // 先糯米，再馅料
  await dragEl('.ing-item[data-ing="zongrice"]', "#wrapZone");
  await sleep(700);
  await dragEl('.ing-item[data-ing="pork"]', "#wrapZone");
  await sleep(700);
  await dragEl('.ing-item[data-ing="yolk"]', "#wrapZone");
  await sleep(1200);
  // 三折：上 → 左 → 右
  for (const [dx, dy] of [[0, -120], [-140, 0], [140, 0]]) {
    const z = await rect("#wrapZone");
    await drag(z.x, z.y, z.x + dx, z.y + dy, 14);
    await sleep(800);
  }
  await sleep(2400);
  await shot("_test_zongzi_steam.png");
  await stopFireInZone(58, 80);
  await waitScreen("screen-result");
  await sleep(900);
  await shot("_test_zongzi_result.png");
  console.log("  ✓ 粽子全流程完成");
}

/* ---------------- 奶茶 ---------------- */
async function testNaicha() {
  console.log("[奶茶] 选茶底→加奶调甜→搅拌→封杯");
  await enterDish(2);
  await evaluate(`document.querySelector('.choice-card[data-tea="hongcha"]').click()`);
  await sleep(1400);
  await evaluate(`document.querySelector('[data-milk="标准"]').click()`);
  await evaluate(`document.querySelector('[data-sweet="五分"]').click()`);
  await dragEl("#milkItem", "#cupZone");
  await sleep(1500);
  const cup = await rect("#cupZone");
  await circle(cup.x, cup.y, Math.min(cup.w, 90) * 0.7, 2.4);
  await sleep(1500);
  await hold(cup.x, cup.y, 1200);
  await waitScreen("screen-result");
  await sleep(900);
  await shot("_test_naicha_result.png");
  console.log("  ✓ 奶茶全流程完成");
}

/* ---------------- 火锅 ---------------- */
async function testHuoguo() {
  console.log("[火锅] 选锅底→选食材→下锅→涮煮");
  await enterDish(3);
  await evaluate(`document.querySelector('.choice-card[data-broth="mala"]').click()`);
  await sleep(1300);
  await evaluate(`document.querySelector('.choice-card[data-ing="beef"]').click()`);
  await evaluate(`document.querySelector('.choice-card[data-ing="tofu"]').click()`);
  await sleep(300);
  await evaluate(`document.getElementById('btn-pick-ok').click()`);
  await sleep(700);
  await dragEl('.ing-item[data-ing="beef"]', "#potZone");
  await sleep(500);
  await dragEl('.ing-item[data-ing="tofu"]', "#potZone");
  await sleep(1500);
  await shot("_test_huoguo_boil.png");
  await stopFireInZone(55, 78);
  await waitScreen("screen-result");
  await sleep(900);
  await shot("_test_huoguo_result.png");
  console.log("  ✓ 火锅全流程完成");
}

/* ---------------- 酸菜鱼 ---------------- */
async function testSuancaiyu() {
  console.log("[酸菜鱼] 调口味→备汤底→下鱼片→掌火候");
  await enterDish(4);
  await evaluate(`document.querySelector('[data-sour="特酸"]').click()`);
  await evaluate(`document.getElementById('btn-huajiao').click()`);
  await evaluate(`document.getElementById('btn-taste-ok').click()`);
  await sleep(1200);
  for (let i = 0; i < 3; i++) {
    const n = await evaluate(`document.querySelectorAll('.ing-item.next').length`);
    if (!n) break;
    await dragEl(".ing-item.next", "#potZone");
    await sleep(500);
  }
  await sleep(1200);
  for (let i = 0; i < 3; i++) {
    const used = await evaluate(`document.getElementById('fishItem') ? document.getElementById('fishItem').classList.contains('used') : true`);
    if (used) break;
    await dragEl("#fishItem", "#potZone");
    await sleep(600);
  }
  await sleep(1400);
  await stopFireInZone(63, 80);
  await waitScreen("screen-result");
  await sleep(900);
  await shot("_test_suancaiyu_result.png");
  console.log("  ✓ 酸菜鱼全流程完成");
}

/* ---------------- 鲜花饼 ---------------- */
async function testXianhuabing() {
  console.log("[鲜花饼] 选馅→包馅→轻压→入烤箱→烘烤");
  await enterDish(5);
  await evaluate(`document.getElementById('btn-crust-ok').click()`);
  await sleep(1000);
  await dragEl("#roseItem", "#boardZone");
  await sleep(1200);
  // 两折：上 → 左
  for (const [dx, dy] of [[0, -120], [-140, 0]]) {
    const d = await rect("#doughWrap");
    await drag(d.x, d.y, d.x + dx, d.y + dy, 14);
    await sleep(700);
  }
  // 轻压 600ms
  const d2 = await rect("#doughWrap");
  await hold(d2.x, d2.y, 1000);
  await sleep(1400);
  await dragEl("#doughWrap", "#oven");
  await sleep(1500);
  await shot("_test_xianhuabing_bake.png");
  await stopFireInZone(58, 80);
  await waitScreen("screen-result");
  await sleep(900);
  await shot("_test_xianhuabing_result.png");
  console.log("  ✓ 鲜花饼全流程完成");
}

/* ---------------- 主流程 ---------------- */
const TESTS = {
  chaofan: testChaofan,
  zongzi: testZongzi,
  naicha: testNaicha,
  huoguo: testHuoguo,
  suancaiyu: testSuancaiyu,
  xianhuabing: testXianhuabing,
};

async function main() {
  const which = process.argv[2] || "all";
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=9222",
    "--window-size=1280,860", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + path.join(ROOT, ".chrome-test-profile"),
  ], { stdio: "ignore" });
  const results = [];
  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try {
        targets = await (await fetch("http://127.0.0.1:9222/json")).json();
        if (targets.some((t) => t.type === "page")) break;
      } catch (e) {}
      await sleep(300);
    }
    const page = targets.find((t) => t.type === "page");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
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
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.navigate", { url: BASE });
    await sleep(1800);
    await evaluate(`document.getElementById('btn-start').click()`);
    await sleep(800);

    const names = which === "all" ? Object.keys(TESTS) : [which];
    for (const name of names) {
      const errBefore = pageErrors.length + consoleErrors.length;
      try {
        await TESTS[name]();
        results.push({ name, ok: true, newErrors: pageErrors.length + consoleErrors.length - errBefore });
      } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
        results.push({ name, ok: false, error: e.message });
        try { await shot(`_test_fail_${name}.png`); } catch (e2) {}
        // 回到菜单继续下一道
        try {
          await evaluate(`document.getElementById('btn-result-menu') ? document.getElementById('btn-result-menu').click() : 0`);
          await sleep(600);
        } catch (e2) {}
      }
    }
    console.log("\n===== 测试汇总 =====");
    results.forEach((r) => console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.error ? " → " + r.error : ""}${r.ok && r.newErrors ? ` (告警 ${r.newErrors} 条)` : ""}`));
    if (pageErrors.length) {
      console.log("\n页面异常:");
      pageErrors.slice(0, 12).forEach((e) => console.log("  ! " + String(e).split("\n")[0]));
    }
    if (consoleErrors.length) {
      console.log("\n控制台告警:");
      consoleErrors.slice(0, 12).forEach((e) => console.log("  ! " + e));
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `\n${failed} 道未通过` : "\n全部通过 ✓");
    if (failed) process.exitCode = 1;
  } catch (err) {
    console.error("测试框架异常:", err.message);
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch (e) {}
    chrome.kill();
  }
}

main();
