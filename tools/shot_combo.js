/* 组合素材（碗固定 + 米可拖）验收 + 炒饭锅铲位置测量。
 * 用法：node tools/shot_combo.js
 *
 * ⚠ 重要经验：Page.captureScreenshot 带 clip 时会临时改写 device metrics，
 *   之后 CDP 的 Input.dispatchMouseEvent 会被丢弃（实测只到 2~3 个事件）。
 *   所以本脚本严格遵守「先跑完全部手势，最后再集中截图」。
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
  const r = await ev(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height,left:b.left,top:b.top};})()`);
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
    await sleep(22);
  }
  await mouse("mouseReleased", tx, ty);
  await sleep(160);
}
async function dragEl(fromSel, toSel) {
  const a = await ev(`(()=>{const el=document.querySelector('${fromSel}');if(!el)return null;
    const h=el.querySelector('.combo-pick')||el;const b=h.getBoundingClientRect();
    return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);
  const b = await rect(toSel);
  await drag(a.x, a.y, b.x, b.y);
}
async function circle(cx, cy, radius, turns) {
  // Chrome 会把连续的小幅 mousemove 合并掉 —— 步长放大到 0.45rad 才不会被吞
  await mouse("mousePressed", cx + radius, cy);
  const total = Math.PI * 2 * turns;
  for (let a = 0; a <= total + 0.01; a += 0.45) {
    await mouse("mouseMoved", cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    await sleep(30);
  }
  await mouse("mouseReleased", cx + radius, cy);
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}
async function shotClip(name, selector, pad = 12, scale = 2) {
  const b = await ev(`(()=>{const e=document.querySelector('${selector}');if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};})()`);
  if (!b) { console.log("  [跳过截图] 找不到 " + selector); return; }
  const r = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2, scale },
  });
  fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64"));
  console.log("  [截图] " + name);
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9229", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + path.join(ROOT, ".chrome-combo")], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9229/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { }
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
  await send("Page.navigate", { url: BASE });
  await sleep(2000);
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);

  /* ============ 炒饭：全部手势先跑完 ============ */
  console.log("\n=== 炒饭：碗固定 + 只有米可拖 ===");
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(600);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  const wok = await rect("#wokZone");
  await mouse("mousePressed", wok.x, wok.y); await mouse("mouseReleased", wok.x, wok.y);
  await sleep(1500);

  const comboInfo = await ev(`(()=>{
    const card=document.querySelector('.ing-item[data-ing="rice"]');
    const pick=card.querySelector('.combo-pick'), bowl=card.querySelector('.combo-bowl');
    const pb=pick.getBoundingClientRect(), bb=bowl.getBoundingClientRect(), cb=card.getBoundingClientRect();
    return { hasCombo:card.classList.contains('combo'),
      pickSrc:pick.querySelector('img').getAttribute('src'), bowlSrc:bowl.getAttribute('src'),
      pickTopPct:Math.round((pb.top-cb.top)/cb.height*100), pickBottomPct:Math.round((pb.bottom-cb.top)/cb.height*100),
      bowlTopPct:Math.round((bb.top-cb.top)/cb.height*100) };
  })()`);
  console.log("  组合卡片:", JSON.stringify(comboInfo));

  // 拖碗（碗身左下角，pointer-events:none）→ 应完全无效，且不影响下一次手势
  const bowlRect = await rect('.ing-item[data-ing="rice"] .combo-bowl');
  await drag(bowlRect.left + bowlRect.w * 0.10, bowlRect.top + bowlRect.h * 0.72, wok.x, wok.y, 10);
  await sleep(500);
  console.log("  拖碗后锅内食材数（应为 0）:", await ev(`document.querySelectorAll('#wokContents img').length`));
  console.log("  拖碗提示:", await ev(`document.getElementById('feedback-banner') ? document.getElementById('feedback-banner').textContent.trim() : ''`));

  // 按顺序下料：egg → rice → carrot → scallion
  await dragEl('.ing-item[data-ing="egg"]', "#wokZone"); await sleep(700);
  await dragEl('.ing-item[data-ing="rice"]', "#wokZone"); await sleep(700);
  console.log("  拖米后:", JSON.stringify(await ev(`(()=>{
    const c=document.querySelector('.ing-item[data-ing="rice"]');
    return { wok:document.querySelectorAll('#wokContents img').length,
             used:c.classList.contains('used'),
             pickVisible:getComputedStyle(c.querySelector('.combo-pick')).display!=='none',
             bowlOpacity:getComputedStyle(c.querySelector('.combo-bowl')).opacity };})()`)));
  await dragEl('.ing-item[data-ing="carrot"]', "#wokZone"); await sleep(700);
  await dragEl('.ing-item[data-ing="scallion"]', "#wokZone"); await sleep(1400);

  console.log("  翻炒阶段提示:", await ev(`document.getElementById('hint-text').textContent.trim()`));
  const w2 = await rect("#wokZone");
  await circle(w2.x, w2.y, Math.min(w2.w, w2.h) * 0.28, 3.3);
  await sleep(1800);
  console.log("  翻炒后提示:", await ev(`document.getElementById('hint-text').textContent.trim()`));

  let guard = 0, fired = false;
  while (guard++ < 300) {
    const v = await ev(`(()=>{const n=document.querySelector('.firebar-needle');return n?parseFloat(n.style.left):-1;})()`);
    if (v >= 62 && v <= 78) { await ev(`document.querySelector('.btn-fire').click()`); fired = true; break; }
    if (v > 86) break;
    await sleep(70);
  }
  console.log("  火候已关:", fired, "|", await ev(`document.getElementById('hint-text').textContent.trim()`));
  await sleep(2400);
  console.log("  盛出阶段提示:", await ev(`document.getElementById('hint-text').textContent.trim()`));

  const serveGeo = await ev(`(()=>{const st=document.querySelector('#cook-stage').getBoundingClientRect();
    const b=document.querySelector('#spatula').getBoundingClientRect();
    const w=document.querySelector('#wokZone').getBoundingClientRect();
    const bw=document.querySelector('#serveBowl').getBoundingClientRect();
    return {spatula:{x:Math.round(b.left-st.left),y:Math.round(b.top-st.top),w:Math.round(b.width),h:Math.round(b.height)},
            wok:{x:Math.round(w.left-st.left),y:Math.round(w.top-st.top)},
            bowl:{x:Math.round(bw.left-st.left),y:Math.round(bw.top-st.top)}};})()`);
  console.log("  盛出阶段几何:", JSON.stringify(serveGeo));
  await shot("_combo_chaofan_serve.png");   // 整页截图（不带 clip，不影响后续手势）

  await dragEl("#spatula", "#serveBowl");
  await sleep(1200);
  console.log("  结果页:", await ev(`(()=>{const s=[...document.querySelectorAll('.screen')].find(x=>x.classList.contains('active'));return s?s.id:'none';})()`));

  /* ============ 集中截图 ============ */
  console.log("\n=== 截图 ===");
  await shot("_combo_chaofan_result.png");

  /* ============ 粽子（重新加载页面，避免在结果页上测） ============ */
  console.log("\n=== 粽子：碗固定 + 只有米可拖 ===");
  await send("Page.navigate", { url: BASE });
  await sleep(2000);
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);
  await ev(`document.querySelectorAll('.dish-card')[1].click()`); await sleep(600);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  await ev(`document.querySelectorAll('#branchOverlay .paper')[0].click()`); await sleep(1000);
  const zRice = await rect('.ing-item[data-ing="zongrice"] .combo-pick');
  const zBowl = await rect('.ing-item[data-ing="zongrice"] .combo-bowl');
  const leaf = await rect("#wrapZone");
  await drag(zBowl.left + zBowl.w * 0.10, zBowl.top + zBowl.h * 0.72, leaf.x, leaf.y, 10);
  await sleep(500);
  console.log("  拖碗后粽叶上食材数（应为 0）:", await ev(`document.querySelectorAll('#onLeaf img').length`));
  console.log("  米把手位置上的元素:", await ev(`(()=>{const e=document.elementFromPoint(${zRice.x},${zRice.y});
    return e? e.tagName+'.'+e.className : 'null';})()`));
  console.log("  米把手 rect:", await ev(`(()=>{const b=document.querySelector('.ing-item[data-ing="zongrice"] .combo-pick').getBoundingClientRect();
    return JSON.stringify({x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2),w:Math.round(b.width)});})()`));
  await drag(zRice.x, zRice.y, leaf.x, leaf.y, 14);
  await sleep(900);
  console.log("  拖米后:", JSON.stringify(await ev(`(()=>({ leaf:document.querySelectorAll('#onLeaf img').length,
    src:document.querySelector('#onLeaf img')?document.querySelector('#onLeaf img').getAttribute('src'):null,
    used:document.querySelector('.ing-item[data-ing="zongrice"]').classList.contains('used') }))()`)));
  await shot("_combo_zongzi_board.png");
  await shotClip("_combo_zongzi_leaf.png", '#wrapZone', 30, 1.6);

  console.log("\n页面异常:", pageErrors.length ? pageErrors : "无");
  ws.close(); chrome.kill();
  await sleep(300);
  process.exit(0);
})().catch((e) => { console.error("✗", e); process.exit(1); });
