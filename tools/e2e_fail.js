/* 火候失误专项测试：验证「欠火 / 过火」直接进入结果卡，且结果卡体现没熟 / 焦了。
 * 用法：node tools/e2e_fail.js
 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const CHROME = "C:/Users/29870/.agent-browser/browsers/chrome-156.0.8078.73/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, msgId = 0;
const pending = new Map();
const pageErrors = [];

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
  const r = await evaluate(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height};})()`);
  if (!r) throw new Error("找不到元素 " + selector);
  return r;
}
async function mouse(type, x, y) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
async function drag(sx, sy, tx, ty, steps = 14) {
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
  await drag(a.x, a.y, b.x, b.y);
}
async function circle(cx, cy, radius, turns) {
  await mouse("mousePressed", cx + radius, cy);
  const total = Math.PI * 2 * turns;
  for (let a = 0; a <= total + 0.01; a += 0.2) {
    await mouse("mouseMoved", cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    await sleep(14);
  }
  await mouse("mouseReleased", cx + radius, cy);
}
async function hold(x, y, ms) {
  await mouse("mousePressed", x, y); await sleep(ms); await mouse("mouseReleased", x, y);
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}
async function activeScreen() {
  return evaluate(`(()=>{const a=document.querySelector('.screen.active');return a?a.id:'';})()`);
}
async function waitScreen(id, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await activeScreen() === id) return true;
    await sleep(120);
  }
  return false;
}
async function enterDish(cardIndex) {
  await evaluate(`document.querySelectorAll('.dish-card')[${cardIndex}].click()`);
  await sleep(500);
  await evaluate(`document.getElementById('btn-cook-this').click()`);
  await sleep(800);
  if (await activeScreen() !== "screen-cook") throw new Error("未进入烹饪页");
}

/* 走到火候阶段 */
const RECIPES = {
  async chaofan() {
    const wok = await rect("#wokZone");
    await mouse("mousePressed", wok.x, wok.y); await mouse("mouseReleased", wok.x, wok.y);
    await sleep(1400);
    for (const ing of ["egg", "rice", "carrot", "scallion"]) {
      await dragEl(`.ing-item[data-ing="${ing}"]`, "#wokZone");
      await sleep(700);
    }
    await sleep(1400);
    const w2 = await rect("#wokZone");
    await circle(w2.x, w2.y, Math.min(w2.w, w2.h) * 0.28, 3.3);
    await sleep(1500);
  },
  async zongzi() {
    await evaluate(`document.querySelectorAll('#branchOverlay .paper')[0].click()`);
    await sleep(1000);
    await dragEl('.ing-item[data-ing="zongrice"]', "#wrapZone"); await sleep(700);
    await dragEl('.ing-item[data-ing="pork"]', "#wrapZone"); await sleep(700);
    await dragEl('.ing-item[data-ing="yolk"]', "#wrapZone"); await sleep(1200);
    for (const [dx, dy] of [[0, -120], [-140, 0], [140, 0]]) {
      const z = await rect("#wrapZone");
      await drag(z.x, z.y, z.x + dx, z.y + dy); await sleep(800);
    }
    await sleep(2400);
  },
  async huoguo() {
    await evaluate(`document.querySelector('.choice-card[data-broth="mala"]').click()`);
    await sleep(1300);
    await evaluate(`document.querySelector('.choice-card[data-ing="beef"]').click()`);
    await evaluate(`document.querySelector('.choice-card[data-ing="tofu"]').click()`);
    await sleep(300);
    await evaluate(`document.getElementById('btn-pick-ok').click()`);
    await sleep(700);
    await dragEl('.ing-item[data-ing="beef"]', "#potZone"); await sleep(500);
    await dragEl('.ing-item[data-ing="tofu"]', "#potZone"); await sleep(1500);
  },
  async suancaiyu() {
    await evaluate(`document.querySelector('[data-sour="特酸"]').click()`);
    await evaluate(`document.getElementById('btn-huajiao').click()`);
    await evaluate(`document.getElementById('btn-taste-ok').click()`);
    await sleep(1200);
    for (let i = 0; i < 3; i++) {
      const n = await evaluate(`document.querySelectorAll('.ing-item.next').length`);
      if (!n) break;
      await dragEl(".ing-item.next", "#potZone"); await sleep(500);
    }
    await sleep(1200);
    for (let i = 0; i < 3; i++) {
      const used = await evaluate(`document.getElementById('fishItem') ? document.getElementById('fishItem').classList.contains('used') : true`);
      if (used) break;
      await dragEl("#fishItem", "#potZone"); await sleep(600);
    }
    await sleep(1400);
  },
  async xianhuabing() {
    await evaluate(`document.getElementById('btn-crust-ok').click()`);
    await sleep(1000);
    await dragEl("#roseItem", "#boardZone");
    await sleep(1200);
    for (const [dx, dy] of [[0, -120], [-140, 0]]) {
      const d = await rect("#doughWrap");
      await drag(d.x, d.y, d.x + dx, d.y + dy); await sleep(700);
    }
    const d2 = await rect("#doughWrap");
    await hold(d2.x, d2.y, 1000);
    await sleep(1400);
    await dragEl("#doughWrap", "#oven");
    await sleep(1500);
  },
};

/* 在火候条的指定时机点强行关火 */
async function stopFireAt(mode) {
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const st = await evaluate(`(()=>{
      const n=document.querySelector('.firebar-needle');
      const b=document.querySelector('.btn-fire');
      if(!n||!b) return {v:-1,btn:false};
      return {v:parseFloat(n.style.left)||0, btn:true};
    })()`);
    if (!st.btn) { await sleep(120); continue; }
    const v = st.v;
    if (mode === "under" && v >= 5) {
      await evaluate(`document.querySelector('.btn-fire').click()`);
      return v;
    }
    if (mode === "over" && v >= 93) {
      await evaluate(`document.querySelector('.btn-fire').click()`);
      return v;
    }
    await sleep(35);
  }
  throw new Error("火候条等待超时 (" + mode + ")");
}

/* 读取结果卡信息：标题 / 摘要 / 埋点 outcome / canvas 印章像素 */
async function readResultCard() {
  const title = await evaluate(`document.getElementById('result-title').textContent`);
  const summary = await evaluate(`document.getElementById('result-summary').innerText`);
  const outcome = await evaluate(`(()=>{
    try{
      const T = (typeof Telemetry!=='undefined') ? Telemetry : null;
      const logs = T ? T.events : [];
      const c = logs.filter(l=>l.event==='result_card').pop();
      return c ? c.outcome : null;
    }catch(e){ return 'ERR:'+e.message; }
  })()`);
  const stamp = await evaluate(`(()=>{
    const cv=document.getElementById('result-canvas');
    const ctx=cv.getContext('2d');
    // 印章画在菜品图右下角：ix+is-150, iy+is-150（与 buildResultCard 一致）
    const W=cv.width, H=cv.height;
    const ix=110, iy=300, is=W-220;
    const cx=ix+is-150, cy=iy+is-150;
    const d=ctx.getImageData(cx-140, cy-140, 280, 280).data;
    let red=0,blue=0;
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],b=d[i+2];
      if(r>90&&r<200&&g<70&&b<55) red++;
      if(b>70&&b<160&&r<95&&g<115) blue++;
    }
    return {red,blue};
  })()`);
  // 菜品图区域的暗色像素占比：焦糊图是黑锅+焦炭（暗色多），原菜品图是暖黄亮色
  const imgStat = await evaluate(`(()=>{
    const cv=document.getElementById('result-canvas');
    const ctx=cv.getContext('2d');
    const ix=110, iy=300, is=cv.width-220;
    // 取图区中央 60% 区域，避开右下角印章
    const d=ctx.getImageData(ix+60, iy+60, is-320, is-320).data;
    let dark=0, total=0;
    for(let i=0;i<d.length;i+=4){
      const lum=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;
      if(lum<90) dark++;
      total++;
    }
    return {dark, total, ratio: total? dark/total : 0};
  })()`);
  return { title, summary, outcome, stamp, imgStat };
}

const DISHES = ["chaofan", "zongzi", "huoguo", "suancaiyu", "xianhuabing"];
const CARD_IDX = { chaofan: 0, zongzi: 1, naicha: 2, huoguo: 3, suancaiyu: 4, xianhuabing: 5 };

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9229", "--window-size=1280,860", "--no-first-run", "--user-data-dir=" + path.join(ROOT, ".chrome-fail")], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9229/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { } await sleep(300); }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    else if (m.method === "Runtime.exceptionThrown") pageErrors.push(JSON.stringify(m.params.exceptionDetails.text));
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate", { url: "http://127.0.0.1:8931/index.html?nocache=" + Date.now() });
  await sleep(1800);

  const results = [];
  for (const dish of DISHES) {
    for (const mode of ["under", "over"]) {
      const label = `${dish}/${mode}`;
      try {
        await evaluate(`document.getElementById('btn-start') && document.getElementById('btn-start').click()`);
        await sleep(500);
        await enterDish(CARD_IDX[dish]);
        await RECIPES[dish]();
        const v = await stopFireAt(mode);
        const reached = await waitScreen("screen-result", 8000);
        await sleep(800);
        const card = await readResultCard();
        const expStamp = mode === "over" ? "red" : "blue";
        const stampOk = expStamp === "red" ? card.stamp.red > 400 : card.stamp.blue > 400;
        // 过火 → 菜品图必须换成焦糊实拍图（暗色像素占比显著高于原菜品图）
        const imgOk = mode === "over" ? card.imgStat.ratio > 0.28 : true;
        const ok = reached && card.outcome === mode && stampOk && imgOk;
        results.push({ label, ok, reached, outcome: card.outcome, stamp: card.stamp, title: card.title, v: +v.toFixed(1), imgRatio: +(card.imgStat.ratio * 100).toFixed(1) });
        console.log(`${ok ? "✓" : "✗"} ${label}  到结果页=${reached} outcome=${card.outcome} 火候=${v.toFixed(1)}% 印章(红${card.stamp.red}/蓝${card.stamp.blue}) 图暗色占比=${(card.imgStat.ratio * 100).toFixed(1)}%  标题「${card.title}」`);
        await shot(`_fail_${dish}_${mode}.png`);
      } catch (e) {
        let diag = "";
        try {
          diag = await evaluate(`JSON.stringify({
            screen: [...document.querySelectorAll('.screen')].filter(s=>s.classList.contains('active')).map(s=>s.id).join(),
            stageLen: (document.getElementById('cook-stage')||{innerHTML:''}).innerHTML.length,
            slotLen: (document.getElementById('choiceSlot')||{innerHTML:''}).innerHTML.length,
            head: ((document.getElementById('cook-stage')||{innerHTML:''}).innerHTML||'').slice(0,260),
            dish: Game.currentDish && Game.currentDish.name,
            segBtns: [...document.querySelectorAll('.seg-btn')].map(b=>b.textContent),
          })`);
        } catch (e2) { diag = "(诊断失败) " + e2.message; }
        results.push({ label, ok: false, err: e.message + " | " + diag });
        console.log(`✗ ${label}  ${e.message}`);
        console.log(`   现场: ${diag}`);
      }
    }
  }

  console.log("\n=== 汇总 ===");
  const pass = results.filter(r => r.ok).length;
  console.log(`通过 ${pass}/${results.length}`);
  results.filter(r => !r.ok).forEach(r => console.log("  失败:", r.label, r.err || JSON.stringify(r)));
  if (pageErrors.length) console.log("页面异常:", pageErrors.slice(0, 5));

  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
