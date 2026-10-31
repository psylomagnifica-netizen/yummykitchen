/* ============================================================
 * hands.js — 摄像头「双手合十」识别（鲜花饼「轻压定形」交互）
 *
 * 设计要点：
 * 1. 摄像头画面只在本机浏览器内实时计算，不上传、不录制、不落盘；
 *    一旦离开定形阶段立刻停掉所有视频轨道。
 * 2. 手部模型（hand_landmarker.task）与 MediaPipe 运行时（vision_bundle.mjs / wasm）
 *    均已本地化到 assets/vendor/mediapipe，不依赖外网 CDN。
 * 3. 「合十」用几何判据而非指尖贴图，四条一起看才能把真合十和
 *    「单手」「双手叠放」「双手分开比划」「比心」区分开：
 *      · 指尖合拢 —— 两手 4 指指尖的形心距离 ÷ 掌宽，越小越近
 *      · 腕部分离 —— 两手手腕距离 ÷ 掌宽；合十时两只手腕分居掌心两侧，
 *        距离约 1 个掌宽；而双手平摊在桌上时手腕也很近，故用此项排除
 *      · 手指伸直 —— 指尖比 PIP 关节更远离手腕（卷起的手掌会判负）
 *      · 指向平行 —— 两手手指方向向量夹角，合十时两指同向朝上
 * 4. 合十需要保持 HOLD_MS 才算完成，与「按住面团长按 600ms」的节奏一致，
 *    避免手抖一下就误判完成；分数用迟滞阈值（ON/OFF）避免边界闪烁。
 * 5. 任何异常都不会阻断游戏：调用方始终保留「按住面团长按」的替代路径。
 * ============================================================ */
"use strict";

const Hands = (() => {
  /* ---------- 路径（相对本脚本所在目录，兼容子目录部署） ---------- */
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || "";
  const SCRIPT_DIR = SCRIPT_URL ? SCRIPT_URL.slice(0, SCRIPT_URL.lastIndexOf("/") + 1) : "";
  const ROOT_DIR = SCRIPT_DIR.replace(/js\/?$/, "");
  const VENDOR = `${ROOT_DIR}assets/vendor/mediapipe`;

  /* ---------- MediaPipe Hands 21 点骨架 ---------- */
  const TIPS = [8, 12, 16, 20];      // 食/中/无名/小 指尖
  const PIPS = [6, 10, 14, 18];      // 对应 PIP 关节
  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17],
  ];

  /* ---------- 判定参数 ---------- */
  const PRAYER_ON = 0.72;    // 合十成立分数线
  const PRAYER_OFF = 0.55;   // 掉出分数线（迟滞，防抖动）
  const HOLD_MS = 700;       // 合十需保持的时长
  const COOLDOWN_MS = 600;   // 完成后的重复触发冷却

  /* ---------- 内部状态 ---------- */
  let stream = null;
  let landmarker = null;
  let rafId = 0;
  let running = false;
  let lastVideoTime = -1;
  let lastTs = 0;
  let videoEl = null;
  let overlayCtx = null;
  let onStatusCb = null;
  let onPressCb = null;
  let provider = null;          // 测试注入点
  let mode = "none";            // "model" | "none"
  let holdMs = 0;               // 合十已保持时长
  let lastFrameAt = 0;
  let praying = false;
  let firedAt = 0;              // 上次触发完成的时间
  let lastEmit = "";            // 状态去重
  let lastScore = 0;            // 最近一次合十分数（调试/测试用）

  /* ---------- 工具 ---------- */
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /**
   * 把模型加载异常翻译成人能看懂、可执行的一句话。
   * 区分四种常见成因，避免所有情况都只显示「摄像头不可用」。
   */
  function diagnoseModelError(e) {
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
    holdMs = 0;
    praying = false;
    lastFrameAt = 0;
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
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return landmarker;
  }

  /* ---------- 单手几何量 ---------- */
  /** 把归一化关键点换算成视频像素坐标（x/y 缩放比例不同，直接算距离会失真） */
  function toPixels(lms, vw, vh) {
    return lms.map((p) => ({ x: p.x * vw, y: p.y * vh }));
  }

  function analyzeHand(pts) {
    const wrist = pts[0];
    // 掌宽：食指根 ↔ 小指根，作为尺度基准
    const palmWidth = Math.max(1e-3, dist(pts[5], pts[17]));
    // 四指指尖形心
    let cx = 0, cy = 0;
    TIPS.forEach((i) => { cx += pts[i].x; cy += pts[i].y; });
    cx /= TIPS.length; cy /= TIPS.length;
    const tipC = { x: cx, y: cy };
    // 手指伸直度：指尖比 PIP 更远离手腕才算伸直（卷指会变负）
    let ext = 0;
    for (let k = 0; k < TIPS.length; k++) {
      ext += dist(pts[TIPS[k]], wrist) - dist(pts[PIPS[k]], wrist);
    }
    ext = ext / TIPS.length / palmWidth;
    return { wrist, tipC, palmWidth, ext, dir: { x: tipC.x - wrist.x, y: tipC.y - wrist.y } };
  }

  /** 两手是否构成「合十」，返回 {score, detail} */
  function evaluatePrayer(A, B) {
    const scale = Math.max(1e-3, (A.palmWidth + B.palmWidth) / 2);
    const tipGap = dist(A.tipC, B.tipC) / scale;        // 指尖合拢度
    const wristGap = dist(A.wrist, B.wrist) / scale;    // 腕部分离度
    const ext = Math.min(A.ext, B.ext);                 // 两只手都要伸直
    const na = Math.hypot(A.dir.x, A.dir.y) || 1;
    const nb = Math.hypot(B.dir.x, B.dir.y) || 1;
    const cos = (A.dir.x * B.dir.x + A.dir.y * B.dir.y) / (na * nb);
    const angDeg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;

    const tipScore = clamp01((0.62 - tipGap) / (0.62 - 0.18));   // ≤0.18 掌宽 → 满分
    const wristOK = wristGap > 0.50 && wristGap < 3.40;
    const extScore = clamp01((ext - 0.02) / 0.20);               // ≥0.22 掌宽 → 满分
    const parScore = clamp01((70 - angDeg) / (70 - 25));          // ≤25° → 满分
    const score = 0.40 * tipScore + 0.16 * (wristOK ? 1 : 0) + 0.22 * extScore + 0.22 * parScore;

    return {
      score,
      tipGap, wristGap, ext, angDeg,
      tipC_A: A.tipC, tipC_B: B.tipC,
    };
  }

  /* ---------- 绘制手部骨架 ---------- */
  function drawOverlay(handsPx, prayer) {
    if (!overlayCtx) return;
    const c = overlayCtx.canvas;
    const W = c.width, H = c.height;
    overlayCtx.clearRect(0, 0, W, H);
    if (!handsPx.length) return;

    // object-fit: cover 的映射（含镜像，摄像头画面是 scaleX(-1) 的）
    const vw = videoEl && videoEl.videoWidth ? videoEl.videoWidth : 640;
    const vh = videoEl && videoEl.videoHeight ? videoEl.videoHeight : 480;
    const scale = Math.max(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    const map = (p) => ({ x: W - (ox + p.x * scale), y: oy + p.y * scale });

    const ok = prayer && prayer.score >= PRAYER_ON;
    const color = ok ? "rgba(126, 200, 138, .95)" : "rgba(230, 182, 85, .9)";
    const dotColor = ok ? "rgba(160, 226, 170, 1)" : "rgba(245, 210, 140, 1)";

    handsPx.forEach((pts) => {
      const sp = pts.map(map);
      overlayCtx.strokeStyle = color;
      overlayCtx.lineWidth = Math.max(1.5, W / 220);
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
        overlayCtx.arc(p.x, p.y, Math.max(2, W / 190), 0, Math.PI * 2);
        overlayCtx.fill();
      });
    });

    // 合十成立时，把两只手的指尖连起来，强化「合在一起」的读图
    if (ok && prayer.tipC_A && prayer.tipC_B) {
      const a = map(prayer.tipC_A), b = map(prayer.tipC_B);
      overlayCtx.strokeStyle = "rgba(126, 200, 138, .95)";
      overlayCtx.lineWidth = Math.max(2, W / 170);
      overlayCtx.setLineDash([6, 5]);
      overlayCtx.beginPath();
      overlayCtx.moveTo(a.x, a.y);
      overlayCtx.lineTo(b.x, b.y);
      overlayCtx.stroke();
      overlayCtx.setLineDash([]);
    }
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

    const now = performance.now();
    const dt = lastFrameAt ? Math.min(120, now - lastFrameAt) : 16;
    lastFrameAt = now;

    if (handsPx.length < 2) {
      holdMs = 0;
      praying = false;
      drawOverlay(handsPx, null);
      if (handsPx.length === 0) emitStatus("no-hand", "没看到手", { hands: 0 });
      else emitStatus("one-hand", "还要另一只手", { hands: handsPx.length });
      return;
    }

    const A = analyzeHand(handsPx[0]);
    const B = analyzeHand(handsPx[1]);
    const prayer = evaluatePrayer(A, B);
    lastScore = prayer.score;

    if (praying) {
      if (prayer.score < PRAYER_OFF) {
        // 合十被破坏 → 归零重算
        praying = false;
        holdMs = 0;
        emitStatus("two-hand", "双手还没合到一起", { score: prayer.score });
      } else {
        holdMs += dt;
        const progress = clamp01(holdMs / HOLD_MS);
        if (onStatusCb) {
          try { onStatusCb("prayer", "双手合十了，别动", { score: prayer.score, progress, holdMs }); }
          catch (e) { /* ignore */ }
        }
        if (holdMs >= HOLD_MS && now - firedAt > COOLDOWN_MS) {
          firedAt = now;
          if (onPressCb) { try { onPressCb({ score: prayer.score }); } catch (e) { /* ignore */ } }
        }
      }
    } else if (prayer.score >= PRAYER_ON) {
      praying = true;
      holdMs = 0;
      emitStatus("prayer", "双手合十了，别动", { score: prayer.score, progress: 0 });
    } else {
      // 两只手都在画面里，但还没合到一起 —— 持续提示，避免玩家以为没被识别
      emitStatus("two-hand", "双手还没合到一起", { score: prayer.score });
    }

    drawOverlay(handsPx, prayer);
  }

  /* ---------- 对外接口 ---------- */
  async function start(opts) {
    const { video, onStatus, onPress, overlay } = opts || {};
    if (!supported()) {
      emitStatus("unsupported", "当前浏览器不支持摄像头");
      return { ok: false, reason: "unsupported" };
    }
    onStatusCb = onStatus; onPressCb = onPress;
    lastEmit = "";
    holdMs = 0; praying = false; lastFrameAt = 0; lastScore = 0;
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
      console.warn("[hands] 摄像头不可用：", e && (e.name + " " + e.message));
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
      console.warn("[hands] 模型加载失败：", e && (e.name + " " + e.message));
      mode = "none";
      // 把真实原因透出来，界面才能给出可执行的建议（而不是笼统的「不可用」）
      const why = diagnoseModelError(e);
      emitStatus("failed", why.detail, { reason: why.reason, error: String(e && e.message || e) });
      stopCamera();
      return { ok: false, reason: "model", detail: why.detail, cause: why.reason };
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
    get score() { return lastScore; },
    get holdMs() { return holdMs; },
    /* 摄像头轨道状态，便于自检与测试断言 */
    get streamState() {
      if (!stream) return null;
      return stream.getTracks().map((t) => ({ kind: t.kind, ready: t.readyState }));
    },
  };
})();
