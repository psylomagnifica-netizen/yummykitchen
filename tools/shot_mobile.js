/* 窄屏响应式检查：在 390x844（手机）下截取菜单页与烹饪页。
 * 用法：node tools/shot_mobile.js
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
async function shot(name) { const r = await send("Page.captureScreenshot", {format: "png", captureBeyondViewport: false}); fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.data, "base64")); console.log("  [截图] " + name); }

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9231", "--window-size=390,844", "--no-first-run", "--user-data-dir=" + path.join(ROOT, ".chrome-mobile")], {stdio: "ignore"});
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9231/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) {} await sleep(300); }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const {resolve, reject} = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setCacheDisabled", {cacheDisabled: true});
  await send("Emulation.setDeviceMetricsOverride", {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
  await send("Page.navigate", {url: "http://127.0.0.1:8931/index.html?t=" + Date.now()});
  await sleep(1800);
  await shot("_mob_1_start.png");
  await ev(`document.getElementById('btn-start').click()`); await sleep(900);
  await shot("_mob_2_menu.png");
  await ev(`document.querySelectorAll('.dish-card')[0].click()`); await sleep(700);
  await shot("_mob_3_intro.png");
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  await shot("_mob_4_cook.png");
  // 炒饭第一阶段即为备料下料，检查窄屏备料区是否遮挡锅具
  await ev(`(()=>{const z=document.getElementById('wokZone'); const b=document.getElementById('prepBoard');
     if(z&&b){const r1=z.getBoundingClientRect(), r2=b.getBoundingClientRect();
       const ov=!(r1.right<r2.left||r1.left>r2.right||r1.bottom<r2.top||r1.top>r2.bottom);
       console.log('overlap='+ov);}} )()`);
  await sleep(400);
  await shot("_mob_5_prep.png");
  // 点锅进入下料阶段，检查备料区与锅的遮挡关系
  await ev(`(()=>{const z=document.getElementById('wokZone'); if(!z) return;
     const r=z.getBoundingClientRect();
     const ev2=new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2});
     z.dispatchEvent(ev2);
     z.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
  })()`);
  await sleep(1200);
  await shot("_mob_6_ing.png");
  // 奶茶：新玻璃杯在窄屏下的显示（选茶底 → 有茶）
  await ev(`document.querySelectorAll('.dish-card')[2].click()`); await sleep(700);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  await ev(`document.querySelector('[data-tea=hongcha]').click()`); await sleep(1400);
  await shot("_mob_7_naicha.png");

  // 鲜花饼：轻压定形阶段的摄像头面板（窄屏下须让开面团，且不溢出视口）
  await ev(`document.querySelectorAll('.dish-card')[5].click()`); await sleep(700);
  await ev(`document.getElementById('btn-cook-this').click()`); await sleep(900);
  await ev(`document.getElementById('btn-crust-ok').click()`); await sleep(1100);
  await ev(`(()=>{
    const rose=document.getElementById('roseItem'), board=document.getElementById('boardZone');
    if(!rose||!board) return;
    const a=rose.getBoundingClientRect(), b=board.getBoundingClientRect();
    const fire=(t,x,y)=>{const o={bubbles:true,clientX:x,clientY:y,pointerId:1};
      rose.dispatchEvent(new PointerEvent(t,o)); window.dispatchEvent(new PointerEvent(t,o));};
    fire('pointerdown', a.x+a.width/2, a.y+a.height/2);
    fire('pointermove', b.x+b.width/2, b.y+b.height/2);
    fire('pointerup', b.x+b.width/2, b.y+b.height/2);
  })()`);
  await sleep(1400);
  for (const [dx, dy] of [[0, -120], [-140, 0]]) {
    await ev(`(()=>{
      const d=document.getElementById('doughWrap'); const b=d.getBoundingClientRect();
      const x=b.x+b.width/2, y=b.y+b.height/2;
      const fire=(t,cx,cy)=>{const o={bubbles:true,clientX:cx,clientY:cy,pointerId:1};
        d.dispatchEvent(new PointerEvent(t,o)); window.dispatchEvent(new PointerEvent(t,o));};
      fire('pointerdown', x, y); fire('pointermove', x+${dx}, y+${dy}); fire('pointerup', x+${dx}, y+${dy});
    })()`);
    await sleep(900);
  }
  await sleep(700);
  await shot("_mob_8_press.png");
  const layout = await ev(`(()=>{
    const p=document.getElementById('camPanel'), d=document.querySelector('#doughWrap');
    if(!p||!d) return null;
    const a=p.getBoundingClientRect(), b=d.getBoundingClientRect();
    const ov=!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);
    return {panelW:Math.round(a.width), panelTop:Math.round(a.top), panelBottom:Math.round(a.bottom),
            viewH:window.innerHeight, overflow:a.bottom>window.innerHeight+1||a.right>window.innerWidth+1,
            overlapDough:ov, stageClass:document.getElementById('cook-stage').className};
  })()`);
  console.log("  轻压阶段布局:", JSON.stringify(layout));
  chrome.kill();
  process.exit(0);
})();
