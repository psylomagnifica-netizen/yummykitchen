/* ============================================================
 * handcam.js — 手部识别共享内核（摄像头 + 模型 + 骨架绘制）
 *
 * 抽出来是为了让多套手势共用同一套「摄像头 / 模型 / 绘制」管线：
 *   · wrist.js —— 右手握拳转腕（炒饭「环形翻炒」）
 *   · hands.js —— 双手合十（鲜花饼「轻压定形」，目前仍为自包含实现，
 *                 后续可迁到本内核上；未迁移前两套代码互不干扰，
 *                 因为它们分别在不同阶段运行）
 * 手势本身只保留「怎么判」，摄像头与错误处理代码集中在这里。
 *
 * 隐私：画面只在本机浏览器内实时计算，不上传、不录制、不落盘；
 *      离开对应阶段立刻 stop() 释放所有视频轨道。
 *
 * file:// 兜底：模型与运行时统一走 MPLoader（内联 gzip+base64 资源）。
 * ============================================================ */
"use strict";

const HandCam = (() => {
  /* ---------- MediaPipe Hands 21 点骨架连线 ---------- */
  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17],
  ];

  /* ---------- 内部状态 ---------- */
  let stream = null;
  let landmarker = null;
  let rafId = 0;
  let running = false;
  let lastVideoTime = -1;
  let lastTs = 0;
  let videoEl = null;
  let overlayCtx = null;
  let provider = null;          // 测试注入点
  let mode = "none";            // "model" | "none"
  let onStatusCb = null;
  let onFrameCb = null;
  let lastEmit = "";
  let numHands = 2;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ---------- 错误诊断 ---------- */
  /**
   * 把模型加载异常翻译成人能看懂、可执行的一句话。
   * 区分四种常见成因，避免所有情况都只显示「摄像头不可用」。
   */
  function diagnose(e) {
    const msg = String((e && e.message) || e || "");
    if (/Failed to fetch|NetworkError|dynamically imported module|importScripts/i.test(msg)) {
      if (MPLoader.isFileProtocol) {
        return {
          reason: "network",
          detail: "浏览器拦截了本地资源加载（file:// 限制），已尝试内联兜底仍失败",
        };
      }
      return { reason: "network", detail: "识别资源加载失败，请检查网络或本地服务器是否正常" };
    }
    if (/404|Not Found/i.test(msg)) {
      return { reason: "missing", detail: "识别模型文件缺失，请确认 assets/vendor/mediapipe 目录完整" };
    }
    if (/WebAssembly|wasm|Invalid|compile/i.test(msg)) {
      return { reason: "wasm", detail: "识别引擎初始化失败，可能是显卡驱动不支持 GPU 加速" };
    }
    return { reason: "unknown", detail: "手部识别模型加载失败" };
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
    if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
    emitStatus("stopped", "摄像头已关闭");
  }

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* ---------- 加载 MediaPipe ---------- */
  async function loadModel() {
    if (provider) { landmarker = await provider(); return landmarker; }
    // 统一走 MPLoader：正常路径用本地文件，file:// 下自动切内联兜底
    landmarker = await MPLoader.create("hand", {
      runningMode: "VIDEO",
      numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return landmarker;
  }

  /** 把归一化关键点换算成视频像素坐标（x/y 缩放比例不同，直接算距离会失真） */
  function toPixels(lms, vw, vh) {
    return lms.map((p) => ({ x: p.x * vw, y: p.y * vh }));
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

    let res = null;
    try {
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      res = landmarker.detectForVideo(videoEl, ts);
    } catch (e) {
      return;
    }

    const lms = (res && res.landmarks) || [];
    const vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
    const handsPx = lms.map((l) => toPixels(l, vw, vh));
    // MediaPipe 的左右手标签：数组顺序与 landmarks 一致
    const handedness = (res && (res.handednesses || res.handedness)) || [];

    if (onFrameCb) {
      try { onFrameCb({ handsPx, handedness, raw: res, vw, vh }); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- 对外接口 ---------- */
  async function start(opts) {
    const { video, onStatus, onFrame, overlay, hands = 2 } = opts || {};
    if (!supported()) {
      emitStatus("unsupported", "当前浏览器不支持摄像头");
      return { ok: false, reason: "unsupported" };
    }
    onStatusCb = onStatus; onFrameCb = onFrame;
    numHands = hands;
    lastEmit = "";
    videoEl = video || null;
    if (overlay && overlay.getContext) {
      overlay.width = overlay.clientWidth * (window.devicePixelRatio || 1) || 320;
      overlay.height = overlay.clientHeight * (window.devicePixelRatio || 1) || 240;
      overlayCtx = overlay.getContext("2d");
    }

    emitStatus("requesting", "正在请求摄像头权限…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
    } catch (e) {
      console.warn("[handcam] 摄像头不可用：", e && (e.name + " " + e.message));
      const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      emitStatus("denied", denied ? "摄像头权限被拒绝" : "摄像头不可用");
      return { ok: false, reason: denied ? "denied" : "unavailable" };
    }

    videoEl.srcObject = stream;
    try { await videoEl.play(); } catch (e) { /* 自动播放策略可能拦截，muted 下通常可用 */ }

    emitStatus("loading", "正在加载手部识别模型…");
    try {
      await loadModel();
      mode = "model";
      emitStatus("ready", "模型就绪");
    } catch (e) {
      console.warn("[handcam] 模型加载失败：", e && (e.name + " " + e.message));
      mode = "none";
      // 把真实原因透出来，界面才能给出可执行的建议（而不是笼统的「不可用」）
      const why = diagnose(e);
      emitStatus("failed", why.detail, { reason: why.reason, error: String(e && e.message || e) });
      stopCamera();
      return { ok: false, reason: "model", detail: why.detail, cause: why.reason };
    }
    running = true;
    lastVideoTime = -1;
    loop();
    return { ok: true, mode };
  }

  /* ---------- 绘制工具 ---------- */
  /**
   * 画面是镜像显示的（CSS scaleX(-1)），所以骨架绘制也要镜像，
   * 否则画出来的手会和视频里的人对不上。
   */
  function mapPoint(p) {
    if (!overlayCtx) return p;
    const c = overlayCtx.canvas;
    const W = c.width, H = c.height;
    const vw = videoEl && videoEl.videoWidth ? videoEl.videoWidth : 640;
    const vh = videoEl && videoEl.videoHeight ? videoEl.videoHeight : 480;
    const scale = Math.max(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    return { x: W - (ox + p.x * scale), y: oy + p.y * scale };
  }

  /** 画一只手的骨架 */
  function drawSkeleton(pts, opts) {
    if (!overlayCtx) return;
    const { color = "rgba(230, 182, 85, .9)", dotColor = "rgba(245, 210, 140, 1)", width = 1.5 } = opts || {};
    const sp = pts.map(mapPoint);
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = Math.max(1.5, overlayCtx.canvas.width / 220);
    overlayCtx.lineCap = "round";
    CONNECTIONS.forEach(([a, b]) => {
      overlayCtx.beginPath();
      overlayCtx.moveTo(sp[a].x, sp[a].y);
      overlayCtx.lineTo(sp[b].x, sp[b].y);
      overlayCtx.stroke();
    });
    overlayCtx.fillStyle = dotColor;
    sp.forEach((p) => {
      overlayCtx.beginPath();
      overlayCtx.arc(p.x, p.y, Math.max(2, overlayCtx.canvas.width / 190), 0, Math.PI * 2);
      overlayCtx.fill();
    });
  }

  function clearOverlay() {
    if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
  }

  return {
    start, stop, supported,
    /* 测试用：注入自定义 landmarker（异步工厂），返回 { detectForVideo(video, ts) } */
    setProvider(fn) { provider = fn; },
    diagnose,
    drawSkeleton, mapPoint, clearOverlay,
    CONNECTIONS,
    get ctx() { return overlayCtx; },
    get mode() { return mode; },
    get isRunning() { return running; },
    /* 摄像头轨道状态，便于自检与测试断言 */
    get streamState() {
      if (!stream) return null;
      return stream.getTracks().map((t) => ({ kind: t.kind, ready: t.readyState }));
    },
  };
})();
