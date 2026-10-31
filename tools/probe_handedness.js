/* ============================================================
 * probe_handedness.js — 实证 MediaPipe handedness 的左右手约定
 *
 * 背景：MediaPipe 官方说明「handedness 假定输入图像是镜像的
 * （前置摄像头自拍视角、图像已水平翻转）」。而我们的摄像头
 * 送进模型的是**未镜像的原始帧**（镜像只发生在 CSS 显示层），
 * 所以模型给出的 Left/Right 与「用户实际的左右手」很可能是反的。
 *
 * 这个脚本用真实手部照片跑真实模型，输出：
 *   - 每只手的 handedness 标签
 *   - 每只手的腕关节 x 坐标
 * 再对照照片里「面对镜头的人」的解剖学左右手，得出结论。
 *
 * 用法：node tools/probe_handedness.js
 * ============================================================ */
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
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}

(async () => {
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9235", "--window-size=1280,860",
    "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + path.join(ROOT, ".chrome-probe")], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9235/json")).json(); if (targets.some(t => t.type === "page")) break; } catch (e) { }
    await sleep(300);
  }
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: BASE });
  await sleep(2000);

  const b64 = fs.readFileSync(path.join(ROOT, "_debug", "hand_real_b64.txt"), "utf8").trim();
  await ev(`window.__B64 = ${JSON.stringify(b64)}; true`, false);

  const out = await ev(`(async () => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/jpeg;base64," + window.__B64; });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const cvFlip = document.createElement("canvas");
    cvFlip.width = cv.width; cvFlip.height = cv.height;
    const fctx = cvFlip.getContext("2d");
    fctx.translate(cv.width, 0); fctx.scale(-1, 1); fctx.drawImage(cv, 0, 0);

    const lm = await MPLoader.create("hand", { runningMode: "IMAGE", numHands: 2, minHandDetectionConfidence: 0.4 });
    const grab = (canvas) => {
      const r = lm.detect(canvas);
      const hs = r.handednesses || r.handedness || [];
      return (r.landmarks || []).map((pts, i) => ({
        wristX: +pts[0].x.toFixed(3),
        wristY: +pts[0].y.toFixed(3),
        label: (hs[i] && hs[i][0]) ? hs[i][0].categoryName : "?",
        score: (hs[i] && hs[i][0]) ? +hs[i][0].score.toFixed(3) : 0,
      }));
    };
    const raw = grab(cv);
    const flip = grab(cvFlip);
    return JSON.stringify({ raw, flip });
  })()`);

  console.log("原始帧（非镜像）:");
  JSON.parse(out).raw.forEach((h, i) => console.log(`  手${i + 1}: label=${h.label}(${h.score})  腕x=${h.wristX} 腕y=${h.wristY}`));
  console.log("水平翻转帧:");
  JSON.parse(out).flip.forEach((h, i) => console.log(`  手${i + 1}: label=${h.label}(${h.score})  腕x=${h.wristX} 腕y=${h.wristY}`));

  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
