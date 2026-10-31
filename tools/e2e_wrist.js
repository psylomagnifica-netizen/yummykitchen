/* 炒饭「右手握拳转腕三下」手势判定测试
 *
 * 用 mock 替换摄像头与手部模型，注入受控的关键点序列，验证：
 *   A. 右手握拳 + 转腕三下 → 判定翻炒完成
 *   B. 右手张开（不握拳）+ 一直转腕 → 不触发
 *   C. 左手握拳转腕（模型标签 "Right"）→ 不触发
 *   D. 只有两指卷起（半握拳）→ 不触发
 *   E. 锅铲在转腕过程中跟着绕锅公转
 *
 * 用法：node tools/e2e_wrist.js
 */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const BASE = "http://127.0.0.1:8931/index.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, msgId = 0;
const pending = new Map();
const pageErrors = [];
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
  const r = await ev(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {cx:b.left+b.width/2,cy:b.top+b.height/2};})()`);
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
    await sleep(20);
  }
  await mouse("mouseReleased", tx, ty);
  await sleep(140);
}
async function dragEl(fromSel, toSel) {
  const a = await rect(fromSel), b = await rect(toSel);
  await drag(a.cx, a.cy, b.cx, b.cy);
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ✓ " + name + (detail ? "  " + detail : "")); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  " + detail : "")); }
}

/* ---------- 页面内 mock ---------- */
const MOCK = `(()=>{
  // 测试参数：stepDeg 每帧转多少度；fist 握拳；label 模型给的左右标签
  window.__wt = { stepDeg: 0, fist: true, label: "Left", angle: 0, calls: 0 };

  navigator.mediaDevices.getUserMedia = async () => ({
    getTracks: () => [{ kind: "video", readyState: "live", stop() {} }],
  });
  // srcObject 原本是只读属性，严格模式下赋值会抛 TypeError，必须先改成可写
  Object.defineProperty(HTMLVideoElement.prototype, "srcObject", {
    writable: true, configurable: true, value: null });
  Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
    get() { return 4; }, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, "currentTime", {
    get() { return performance.now() / 1000; }, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    get() { return 640; }, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    get() { return 480; }, configurable: true });
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };

  const OPEN = [
    {x:0,y:0},{x:8,y:-8},{x:12,y:-16},{x:14,y:-22},{x:15,y:-27},
    {x:20,y:30},{x:25,y:55},{x:28,y:72},{x:30,y:80},
    {x:25,y:32},{x:28,y:60},{x:30,y:82},{x:31,y:88},
    {x:32,y:30},{x:33,y:55},{x:34,y:70},{x:34,y:78},
    {x:42,y:25},{x:42,y:45},{x:43,y:57},{x:43,y:65},
  ];
  const FIST = [
    {x:0,y:0},{x:6,y:-6},{x:9,y:-12},{x:10,y:-16},{x:11,y:-19},
    {x:20,y:30},{x:25,y:55},{x:22,y:48},{x:20,y:40},
    {x:25,y:32},{x:28,y:60},{x:24,y:52},{x:22,y:44},
    {x:32,y:30},{x:33,y:55},{x:29,y:47},{x:27,y:40},
    {x:42,y:25},{x:42,y:45},{x:37,y:38},{x:34,y:32},
  ];
  // 半握拳：只有食指、小指卷起（2 指）→ 不应判定为握拳
  const HALF = FIST.map(function(p, i){
    const copy = Object.assign({}, p);
    if (i === 8 || i === 12 || i === 16) { copy.x = OPEN[i].x; copy.y = OPEN[i].y; }
    return copy;
  });

  window.__wt.makeHand = function (kind, deg) {
    const base = kind === "open" ? OPEN : (kind === "half" ? HALF : FIST);
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return base.map(function (p) {
      const x = p.x * c - p.y * s, y = p.x * s + p.y * c;
      return { x: x / 200 + 0.35, y: y / 200 + 0.30, z: 0 };
    });
  };

  HandCam.setProvider(async () => ({
    detectForVideo: function () {
      const t = window.__wt;
      t.angle += t.stepDeg;
      t.calls++;
      const kind = t.fist === true ? "fist" : (t.fist === "half" ? "half" : "open");
      return {
        landmarks: [window.__wt.makeHand(kind, t.angle)],
        handednesses: [[{ categoryName: t.label, score: 0.95, index: 0 }]],
      };
    },
  }));
  return true;
})()`;

async function waitFor(fn, timeout = 6000, step = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/* ---------- 重新进入炒饭的翻炒阶段 ---------- */
async function gotoStir() {
  // 用完整流程重开：会顺带卸载火候条，否则上一个场景残留的 9 秒计时器
  // 会自动结束火候并跳到结果页，把后续场景全带偏
  await ev(`Game.startCook(Game.currentDish)`);
  await sleep(800);
  const w = await rect("#wokZone");
  await mouse("mousePressed", w.cx, w.cy); await mouse("mouseReleased", w.cx, w.cy);
  await sleep(1500);
  for (const ing of ["egg", "rice", "carrot", "scallion"]) {
    await dragEl(`.ing-item[data-ing="${ing}"]`, "#wokZone");
    await sleep(700);
  }
  await sleep(1600);
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9233", "--window-size=1440,900",
    "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + path.join(ROOT, ".chrome-wrist")], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9233/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { }
    await sleep(300);
  }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.text || "");
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate", { url: BASE + "?nocache=" + Date.now() });
  await sleep(2200);

  /* ---------- 进入炒饭的翻炒阶段 ---------- */
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(600);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.cx, wok.cy); await mouse("mouseReleased", wok.cx, wok.cy);
  await sleep(1500);
  for (const ing of ["egg", "rice", "carrot", "scallion"]) {
    await dragEl(`.ing-item[data-ing="${ing}"]`, "#wokZone");
    await sleep(700);
  }
  await sleep(1600);

  const inStir = async () => await ev(`(()=>{
    const ring = document.getElementById('stirRing');
    const fb = document.getElementById('firebar-slot');
    const fireOn = fb && fb.children.length > 0;
    return !!ring && ring.style.display !== 'none' && !fireOn;
  })()`);
  check("进入翻炒阶段", await inStir());

  /* ---------- 注入 mock ---------- */
  await ev(MOCK);
  check("注入 mock 摄像头与假模型", await ev(`typeof HandCam.setProvider === "function" && typeof Wrist.start === "function"`));

  /* ============================================================
     A. 右手握拳 + 转腕三下 → 触发
     ============================================================ */
  console.log("\n[A] 右手握拳 + 转动手腕三下");
  await gotoStir();
  await ev(`document.getElementById('btnCamStart').click()`);
  const running = await waitFor(async () => await ev(`Wrist.isRunning`), 6000);
  check("摄像头与模型就绪", !!running);
  await ev(`window.__wt.stepDeg = 8; window.__wt.fist = true; window.__wt.label = "Left";`);

  const before = await ev(`document.querySelector('#spatula').style.transform`);
  // 触发后 Wrist.stop() 会把状态清零，所以用「进度点全部点亮」+「进入火候阶段」判断
  const lit = await waitFor(async () => {
    const n = await ev(`document.querySelectorAll('#camTurnRow .turn-dot.on').length`);
    return n >= 3 ? n : null;
  }, 8000);
  check("转腕累积到三下并触发", !!lit, lit ? `${lit} 个进度点点亮` : "超时未触发");
  const after = await ev(`document.querySelector('#spatula').style.transform`);
  check("锅铲随转腕绕锅公转", before !== after, `${before}  →  ${after}`);
  const leftStir = await waitFor(async () => !(await inStir()) ? true : null, 4000);
  check("翻炒完成后进入火候阶段", !!leftStir);

  /* ============================================================
     B. 右手张开 + 一直转腕 → 不触发
     ============================================================ */
  console.log("\n[B] 右手张开（未握拳）持续转腕");
  await gotoStir();
  check("回到翻炒阶段", await inStir());
  await ev(`document.getElementById('btnCamStart').click()`);
  await waitFor(async () => await ev(`Wrist.isRunning`), 6000);
  await ev(`window.__wt.stepDeg = 8; window.__wt.fist = false; window.__wt.label = "Left";`);
  await sleep(2500);
  const stB = await ev(`({turns: Wrist.state.turns, pathDeg: Math.round(Wrist.state.pathDeg)})`);
  check("未握拳不累计转角", stB.turns === 0 && stB.pathDeg === 0, JSON.stringify(stB));
  check("未握拳不触发完成", await inStir());
  await ev(`Wrist.stop()`);

  /* ============================================================
     C. 左手握拳转腕（模型标签 "Right"）→ 不触发
     ============================================================ */
  console.log("\n[C] 左手握拳转腕（原始帧标签 Right = 用户左手）");
  await gotoStir();
  await ev(`document.getElementById('btnCamStart').click()`);
  await waitFor(async () => await ev(`Wrist.isRunning`), 6000);
  await ev(`window.__wt.stepDeg = 8; window.__wt.fist = true; window.__wt.label = "Right";`);
  await sleep(2500);
  const stC = await ev(`({turns: Wrist.state.turns, pathDeg: Math.round(Wrist.state.pathDeg), haveRight: Wrist.state.haveRight})`);
  check("左手不计入转腕", stC.turns === 0 && stC.pathDeg === 0, JSON.stringify(stC));
  check("左手不触发完成", await inStir());
  await ev(`Wrist.stop()`);

  /* ============================================================
     D. 半握拳（仅两指卷起）→ 不触发
     ============================================================ */
  console.log("\n[D] 半握拳（仅两指卷起）");
  await gotoStir();
  await ev(`document.getElementById('btnCamStart').click()`);
  await waitFor(async () => await ev(`Wrist.isRunning`), 6000);
  await ev(`window.__wt.stepDeg = 8; window.__wt.fist = "half"; window.__wt.label = "Left";`);
  await sleep(2500);
  const stD = await ev(`({turns: Wrist.state.turns, pathDeg: Math.round(Wrist.state.pathDeg)})`);
  check("半握拳不判定为握拳", stD.turns === 0 && stD.pathDeg === 0, JSON.stringify(stD));
  check("半握拳不触发完成", await inStir());
  await ev(`Wrist.stop()`);

  /* ============================================================
     E. 鼠标画圈降级路径仍然可用
     ============================================================ */
  console.log("\n[E] 降级路径：鼠标画圈");
  await gotoStir();
  const wok2 = await rect("#wokZone");
  const R = 40;
  await mouse("mousePressed", wok2.cx + R, wok2.cy);
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2.4;
    await mouse("mouseMoved", wok2.cx + R * Math.cos(a), wok2.cy + R * Math.sin(a));
    await sleep(16);
  }
  await mouse("mouseReleased", wok2.cx + R, wok2.cy);
  await sleep(1200);
  const doneE = await waitFor(async () => !(await inStir()) ? true : null, 4000);
  check("鼠标画圈也能完成翻炒", !!doneE);

  /* ============================================================
     F. 离开本道菜时必须释放摄像头轨道
     ============================================================ */
  console.log("\n[F] 返回菜单时释放摄像头");
  await gotoStir();
  await ev(`document.getElementById('btnCamStart').click()`);
  await waitFor(async () => await ev(`Wrist.isRunning`), 6000);
  const tracks = await ev(`JSON.stringify(HandCam.streamState)`);
  check("摄像头轨道已开启", !!tracks && tracks.indexOf("live") >= 0, tracks);
  await ev(`document.getElementById('btn-back-menu').click()`);
  await sleep(800);
  const afterLeave = await ev(`JSON.stringify({running: Wrist.isRunning, stream: HandCam.streamState})`);
  check("返回菜单后摄像头已释放", afterLeave.indexOf('"stream":null') >= 0 && afterLeave.indexOf('"running":false') >= 0, afterLeave);

  console.log("\n页面异常:", pageErrors.length ? pageErrors.join(" | ") : "无 ✓");
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
