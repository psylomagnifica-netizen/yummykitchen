/* 全菜视觉快照：依次进入六道菜，抓取关键阶段截图供人工复核。
 * 用法：node tools/snapshot_all.js
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
async function shot(name) { const r = await send("Page.captureScreenshot", {format:"png"}); fs.writeFileSync(path.join(ROOT,name), Buffer.from(r.data,"base64")); console.log("  [截图] "+name); }
async function rect(sel) { return ev(`(()=>{const e=document.querySelector('${sel}');if(!e)return null;const b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};})()`); }
async function mouse(type,x,y){ await send("Input.dispatchMouseEvent",{type,x,y,button:"left",clickCount:1}); }
async function drag(sx,sy,tx,ty,steps=12){ await mouse("mousePressed",sx,sy); for(let i=1;i<=steps;i++){await mouse("mouseMoved",sx+(tx-sx)*i/steps,sy+(ty-sy)*i/steps);await sleep(22);} await mouse("mouseReleased",tx,ty); await sleep(140); }
async function dragEl(a,b){ const p=await rect(a),q=await rect(b); if(!p||!q) throw new Error("missing "+a+" / "+b); await drag(p.x,p.y,q.x,q.y); }
async function circle(cx,cy,r,turns){ await mouse("mousePressed",cx+r,cy); const tot=Math.PI*2*turns; for(let a=0;a<=tot;a+=0.2){await mouse("mouseMoved",cx+Math.cos(a)*r,cy+Math.sin(a)*r);await sleep(14);} await mouse("mouseReleased",cx+r,cy); }
async function hold(x,y,ms){ await mouse("mousePressed",x,y); await sleep(ms); await mouse("mouseReleased",x,y); }

async function enterDish(i){ await ev(`document.querySelectorAll('.dish-card')[${i}].click()`); await sleep(450); await ev(`document.getElementById('btn-cook-this').click()`); await sleep(700); }

async function main(){
  const chrome = spawn(CHROME, ["--headless=new","--remote-debugging-port=9225","--window-size=1280,860","--no-first-run","--user-data-dir="+path.join(ROOT,".chrome-shot2")], {stdio:"ignore"});
  let targets=null;
  for(let i=0;i<40;i++){ try{targets=await (await fetch("http://127.0.0.1:9225/json")).json(); if(targets.some(t=>t.type==="page")) break;}catch(e){} await sleep(300);}
  ws=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=(e)=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}};
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setCacheDisabled",{cacheDisabled:true});
  await send("Page.navigate",{url:"http://127.0.0.1:8931/index.html?t="+Date.now()});
  await sleep(1800);
  await ev(`document.getElementById('btn-start').click()`); await sleep(700);

  // 炒饭：下料阶段
  await enterDish(0);
  const wok = await rect("#wokZone");
  await mouse("mousePressed",wok.x,wok.y); await mouse("mouseReleased",wok.x,wok.y);
  await sleep(1400);
  await shot("_shot_1_chaofan_drop.png");
  for(const ing of ["egg","rice","carrot","scallion"]){ await dragEl(`.ing-item[data-ing="${ing}"]`,"#wokZone"); await sleep(500); }
  await sleep(1300);
  const w2 = await rect("#wokZone");
  await circle(w2.x,w2.y,Math.min(w2.w||220,220)*0.25,3.3);
  await sleep(1600);
  await shot("_shot_2_chaofan_stir.png");
  await ev(`document.getElementById('btn-result-menu') ? 0 : 0`);

  // 粽子
  await ev(`document.getElementById('btn-back-menu').click()`); await sleep(600);
  await enterDish(1);
  await shot("_shot_3_zongzi_branch.png");
  await ev(`document.querySelectorAll('#branchOverlay .paper')[0].click()`); await sleep(900);
  await dragEl('.ing-item[data-ing="zongrice"]',"#wrapZone"); await sleep(600);
  await dragEl('.ing-item[data-ing="pork"]',"#wrapZone"); await sleep(600);
  await dragEl('.ing-item[data-ing="yolk"]',"#wrapZone"); await sleep(1200);
  await shot("_shot_4_zongzi_wrap.png");

  // 奶茶
  await ev(`document.getElementById('btn-back-menu').click()`); await sleep(600);
  await enterDish(2);
  await ev(`document.querySelector('.choice-card[data-tea="hongcha"]').click()`); await sleep(1300);
  await shot("_shot_5_naicha_tea.png");
  await dragEl("#milkItem","#cupZone"); await sleep(1400);
  await shot("_shot_6_naicha_pour.png");

  // 火锅
  await ev(`document.getElementById('btn-back-menu').click()`); await sleep(600);
  await enterDish(3);
  await ev(`document.querySelector('.choice-card[data-broth="mala"]').click()`); await sleep(1300);
  await shot("_shot_7_huoguo_broth.png");
  await ev(`document.querySelector('.choice-card[data-ing="beef"]').click()`);
  await ev(`document.querySelector('.choice-card[data-ing="tofu"]').click()`); await sleep(300);
  await ev(`document.getElementById('btn-pick-ok').click()`); await sleep(700);
  await dragEl('.ing-item[data-ing="beef"]',"#potZone"); await sleep(500);
  await dragEl('.ing-item[data-ing="tofu"]',"#potZone"); await sleep(1400);
  await shot("_shot_8_huoguo_pot.png");

  // 酸菜鱼
  await ev(`document.getElementById('btn-back-menu').click()`); await sleep(600);
  await enterDish(4);
  await ev(`document.querySelector('[data-sour="特酸"]').click()`);
  await ev(`document.getElementById('btn-taste-ok').click()`); await sleep(1200);
  for(let i=0;i<3;i++){ if(!await ev(`document.querySelectorAll('.ing-item.next').length`)) break; await dragEl(".ing-item.next","#potZone"); await sleep(500); }
  await sleep(1200);
  await shot("_shot_9_suancaiyu_pot.png");

  // 鲜花饼
  await ev(`document.getElementById('btn-back-menu').click()`); await sleep(600);
  await enterDish(5);
  await ev(`document.getElementById('btn-crust-ok').click()`); await sleep(1000);
  await dragEl("#roseItem","#boardZone"); await sleep(1100);
  await shot("_shot_10_xianhuabing_board.png");
  await ev(`document.getElementById('btn-back-menu').click()`); await sleep(400);

  ws.close(); chrome.kill();
  console.log("全部快照完成");
}
main().catch(e=>{console.error("快照异常:",e.message);process.exit(1);});
