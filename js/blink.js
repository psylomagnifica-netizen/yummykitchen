/* ============================================================
 * blink.js — 摄像头眨眼检测（奶茶「眨眼封口」交互）
 *
 * 设计要点：
 * 1. 摄像头画面只在本机浏览器内实时计算，不上传、不录制、不落盘；
 *    一旦离开封口阶段立刻停掉所有视频轨道。
 * 2. 主检测：MediaPipe FaceLandmarker（已本地化到 assets/vendor/mediapipe，
 *    不依赖外网 CDN），用眼角/眼睑关键点算 EAR（Eye Aspect Ratio）。
 * 3. 降级检测：模型加载失败时退化为「眼部暗像素面积」启发式，
 *    精度略低但仍可用，界面会标注「近似模式」。
 * 4. 任何异常都不会阻断游戏：调用方始终保留点按/长按的替代路径。
 * ============================================================ */
"use strict";

const Blink = (() => {
  /* ---------- 路径（相对本脚本所在目录，兼容子目录部署） ----------
   * blink.js 位于 <root>/js/，素材在 <root>/assets/，故从脚本目录上溯一级。 */
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || "";
  const SCRIPT_DIR = SCRIPT_URL ? SCRIPT_URL.slice(0, SCRIPT_URL.lastIndexOf("/") + 1) : "";
  const ROOT_DIR = SCRIPT_DIR.replace(/js\/?$/, "");
  const VENDOR = `${ROOT_DIR}assets/vendor/mediapipe`;

  /* ---------- FaceLandmarker 眼部关键点（MediaPipe 468/478 网格） ---------- */
  // [外角, 上睑1, 上睑2, 内角, 下睑1, 下睑2]
  const EYE_A = [33, 160, 158, 133, 153, 144];   // 画面左侧眼
  const EYE_B = [362, 385, 387, 263, 374, 380]; // 画面右侧眼

  /* ---------- 眨眼判定参数 ---------- */
  const CLOSE_RATIO = 0.74;   // EAR 低于 睁眼基线 × 此值 → 判为闭眼
  const OPEN_RATIO = 0.88;    // EAR 高于 睁眼基线 × 此值 → 判为睁眼
  const CLOSE_FRAMES = 2;     // 连续闭眼帧数才确认闭眼（抗抖动）
  const COOLDOWN_MS = 700;    // 两次眨眼的最小间隔
  const BASE_EAR = 0.30;      // 睁眼基线初值
  const BASE_ALPHA = 0.06;    // 基线 EMA 更新系数

  /* ---------- 内部状态 ---------- */
  let stream = null;
  let landmarker = null;
  let rafId = 0;
  let running = false;
  let lastVideoTime = -1;
  let lastTs = 0;
  let mode = "none";          // "model" | "approx" | "none"
  let openEar = BASE_EAR;
  let closedFrames = 0;
  let isClosed = false;
  let lastBlinkAt = 0;
  let videoEl = null;
  let overlayCtx = null;
  let onBlinkCb = null;
  let onStatusCb = null;
  let approxCanvas = null;
  let approxCtx = null;
  let approxBaseline = 0.30;
  let approxDark = 0;
  let approxClosedFrames = 0;
  let approxIsClosed = false;
  let lastEmit = "";

  /* ---------- 工具 ---------- */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function eyeAspect(pts, idx) {
    const p1 = pts[idx[0]], p2 = pts[idx[1]], p3 = pts[idx[2]];
    const p4 = pts[idx[3]], p5 = pts[idx[4]], p6 = pts[idx[5]];
    const d = dist(p1, p4);
    if (!d) return 0;
    return (dist(p2, p6) + dist(p3, p5)) / (2 * d);
  }

  function emitStatus(status, detail, info) {
    if (status === lastEmit) return;   // 同状态不重复广播，避免 UI 抖动
    lastEmit = status;
    if (onStatusCb) { try { onStatusCb(status, detail || "", info || {}); } catch (e) { /* ignore */ } }
  }

  /* ---------- 摄像头 ---------- */
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (videoEl) { try { videoEl.srcObject = null; } catch (e) { /* ignore */ } }
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    stopCamera();
    mode = "none";
    closedFrames = 0;
    isClosed = false;
    approxClosedFrames = 0;
    approxIsClosed = false;
    emitStatus("stopped", "摄像头已关闭");
  }

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* ---------- 加载 MediaPipe ---------- */
  let provider = null;   // 测试注入点：替换 landmarker 来源

  async function loadModel() {
    if (provider) { landmarker = await provider(); return landmarker; }
    // 统一走 MPLoader：正常路径用本地文件，file:// 下自动切内联兜底
    landmarker = await MPLoader.create("face", {
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    return landmarker;
  }

  /* ---------- 近似（无模型）检测：眼部暗像素面积 ---------- */
  function approxDetect() {
    const w = 64, h = 48;
    if (!approxCanvas) {
      approxCanvas = document.createElement("canvas");
      approxCanvas.width = w; approxCanvas.height = h;
      approxCtx = approxCanvas.getContext("2d", { willReadFrequently: true });
    }
    approxCtx.drawImage(videoEl, 0, 0, w, h);
    const data = approxCtx.getImageData(0, 0, w, h).data;
    // 取画面中上部「眼部带」（x 30%~70%，y 22%~48%）作为观察窗
    const x0 = Math.floor(w * 0.30), x1 = Math.floor(w * 0.70);
    const y0 = Math.floor(h * 0.22), y1 = Math.floor(h * 0.48);
    let dark = 0, total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        total++;
        if (luma < 92) dark++;
      }
    }
    approxDark = total ? dark / total : 0;
    // 睁眼基线 = 观察到的暗像素占比峰值（缓慢上浮）
    approxBaseline = Math.max(approxBaseline * 0.995, approxDark);
    const closeAt = approxBaseline * 0.62;
    const openAt = approxBaseline * 0.84;
    if (approxDark < closeAt) approxClosedFrames++;
    else approxClosedFrames = 0;
    if (!approxIsClosed && approxClosedFrames >= CLOSE_FRAMES) {
      approxIsClosed = true;
      emitStatus("closed", "检测到闭眼");
    } else if (approxIsClosed && approxDark > openAt) {
          approxIsClosed = false;
    fireBlink();
    if (!running) return;
  }
    return approxDark;
  }

  /* ---------- 眨眼触发 ---------- */
  function fireBlink() {
    const now = performance.now();
    if (now - lastBlinkAt < COOLDOWN_MS) return;
    lastBlinkAt = now;
    if (onBlinkCb) { try { onBlinkCb(); } catch (e) { /* ignore */ } }
  }

  /* ---------- 绘制眼部指示 ---------- */
  function drawOverlay(pts, closed) {
    if (!overlayCtx || !pts) { if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height); return; }
    const c = overlayCtx.canvas;
    const W = c.width, H = c.height;
    overlayCtx.clearRect(0, 0, W, H);
    const color = closed ? "rgba(120, 200, 140, .95)" : "rgba(240, 200, 110, .9)";
    [EYE_A, EYE_B].forEach((idx) => {
      const xs = idx.map((i) => pts[i].x * W);
      const ys = idx.map((i) => pts[i].y * H);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const pad = 6;
      overlayCtx.strokeStyle = color;
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([5, 4]);
      overlayCtx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
      overlayCtx.setLineDash([]);
    });
  }

  /* ---------- 主循环 ---------- */
  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    /* 页面不可见时不做推理：既省电，也减少无谓的画面采集 */
    if (document.hidden) return;
    if (!videoEl || videoEl.readyState < 2) return;
    if (videoEl.currentTime === lastVideoTime) return;   // 同一帧不重复检测
    lastVideoTime = videoEl.currentTime;

    if (mode === "model" && landmarker) {
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      let res = null;
      try {
        res = landmarker.detectForVideo(videoEl, ts);
      } catch (e) {
        return;
      }
      const faces = res && res.faceLandmarks;
      if (!faces || !faces.length) {
        emitStatus("no-face", "没看到人脸");
        drawOverlay(null, false);
        return;
      }
      const pts = faces[0];
      const ear = (eyeAspect(pts, EYE_A) + eyeAspect(pts, EYE_B)) / 2;
      // 睁眼基线：只从明显睁眼的样本更新
      if (ear > openEar * 0.95) openEar = openEar * (1 - BASE_ALPHA) + ear * BASE_ALPHA;
      const closeAt = openEar * CLOSE_RATIO;
      const openAt = openEar * OPEN_RATIO;
      if (ear < closeAt) closedFrames++;
      else closedFrames = 0;
      if (!isClosed && closedFrames >= CLOSE_FRAMES) {
        isClosed = true;
        emitStatus("closed", "检测到闭眼");
      } else if (isClosed && ear > openAt) {
        isClosed = false;
        fireBlink();
        /* onBlink 可能已经触发业务收尾（封杯）并调用 stop()，
           此时 mode 已被重置，不能再广播 tracking 状态。 */
        if (!running) return;
      }
      if (!isClosed) emitStatus("tracking", "已就位，眨一下眼");
      drawOverlay(pts, isClosed);
    } else if (mode === "approx") {
      approxDetect();
    }
  }

  /* ---------- 对外接口 ---------- */
  async function start(opts) {
    const { video, onStatus, onBlink, overlay } = opts || {};
    if (!supported()) {
      emitStatus("unsupported", "当前浏览器不支持摄像头");
      return { ok: false, reason: "unsupported" };
    }
    onStatusCb = onStatus; onBlinkCb = onBlink;
    lastEmit = "";
    videoEl = video || null;
    if (overlay) {
      overlay.width = overlay.clientWidth * (window.devicePixelRatio || 1);
      overlay.height = overlay.clientHeight * (window.devicePixelRatio || 1);
      overlayCtx = overlay.getContext("2d");
    }

    emitStatus("requesting", "正在请求摄像头权限…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
    } catch (e) {
      console.warn("[blink] 摄像头不可用：", e && (e.name + " " + e.message));
      const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      emitStatus("denied", denied ? "摄像头权限被拒绝" : "摄像头不可用");
      return { ok: false, reason: denied ? "denied" : "unavailable" };
    }

    videoEl.srcObject = stream;
    try { await videoEl.play(); } catch (e) { /* 自动播放策略可能拦截，muted 下通常可用 */ }
    emitStatus("loading", "正在加载眨眼识别模型…");
    try {
      await loadModel();
      mode = "model";
      emitStatus("ready", "模型就绪");
    } catch (e) {
      console.warn("[blink] 模型加载失败，改用近似模式：", e && (e.name + " " + e.message));
      mode = "approx";
      // 近似模式只是退化路径，仍把真实原因带上，便于自述与排查
      emitStatus("ready", "已启用近似模式", { fallback: true, error: String((e && e.message) || e) });
    }
    running = true;
    lastVideoTime = -1;
    loop();
    return { ok: true, mode };
  }

  return {
    start, stop, supported,
    /* 测试用：注入自定义 landmarker（异步工厂），返回 { detectForVideo(video, ts) } */
    __injectProvider(fn) { provider = fn; },
    get mode() { return mode; },
    get isRunning() { return running; },
    /* 摄像头轨道状态，便于自检与测试断言 */
    get streamState() {
      if (!stream) return null;
      return stream.getTracks().map((t) => ({ kind: t.kind, ready: t.readyState }));
    },
  };
})();
