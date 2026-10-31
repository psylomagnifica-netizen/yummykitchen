/* ============================================================
 * wrist.js — 右手「握拳 + 转动手腕」识别（炒饭「环形翻炒」）
 *
 * 交互定义（用户需求原文）：
 *   「用户右手握拳转动手腕三下就算翻炒好了」
 *   → 右手握拳，手腕转三下，判定翻炒完成。
 *
 * 判据拆解：
 * 1. 右手 —— MediaPipe 的 handedness 假定输入图像已被镜像；本项目送进模型的是
 *    **未镜像的原始帧**（镜像只发生在 CSS scaleX(-1) 的显示层），所以模型标签
 *    与用户的解剖学左右手相反。
 *    实测（tools/probe_handedness.js，真实手部照片 + 真实模型）：
 *      原始帧中用户右手位于画面左侧 → 标签 "Left"；把图像水平翻转后标签随之变成 "Right"。
 *    因此原始帧上的 "Left" 就是用户的右手。
 * 2. 握拳 —— 用「指尖是否比 PIP 关节更靠近手腕」判断手指卷起，四指里卷起 3 根
 *    即握拳（迟滞：≥3 进入，≤2 退出）。这个几何判据与手心朝向镜头还是手背朝向镜头
 *    无关，比「指尖贴图」稳得多。
 * 3. 转腕 —— 取掌轴向量（手腕 → 中指根）的方向角，逐帧解缠绕后累计**路径长度**。
 *    用路径长度（而不是净转角）是为了兼容两种自然动作：单向连续扭转，
 *    以及来回甩动。每累计 STEP_DEG 记作「转了一下」，转满三下即完成。
 *
 * 鲁棒性：
 *   · 手部被短暂遮挡（检测丢失）时不清零，最多容忍 LOST_MS；
 *   · 松开握拳超过 OPEN_RESET_MS 才重置进度，避免抖动误清；
 *   · 单帧角度变化小于 NOISE_DEG 视为噪声，不计入累计。
 *
 * 隐私：画面只在本机浏览器内实时计算，不上传、不录制、不落盘。
 * ============================================================ */
"use strict";

const Wrist = (() => {
  /* ---------- 21 点骨架中的指尖 / PIP ---------- */
  const TIPS = [8, 12, 16, 20];   // 食 / 中 / 无名 / 小 指尖
  const PIPS = [6, 10, 14, 18];   // 对应的 PIP 关节

  /* ---------- 判定参数 ---------- */
  const TURN_COUNT = 3;                   // 转几下算翻炒完成
  const STEP_DEG = 80;                    // 每「一下」按 80° 累计转角
  const TOTAL_DEG = TURN_COUNT * STEP_DEG; // 240°
  const NOISE_DEG = 2.5;                 // 单帧噪声门限（小于它不计）
  const FIST_ON = 3;                     // 卷起 3 指即握拳
  const FIST_OFF = 2;                    // 迟滞：卷起 ≤2 指即视为松开
  const LOST_MS = 400;                   // 手部短暂丢失的容忍时长
  const OPEN_RESET_MS = 250;             // 松开握拳多久才算「松手」

  /* 原始帧上的右手标签（见文件头「镜像约定」说明） */
  const RIGHT_LABEL = "Left";

  /* ---------- 内部状态 ---------- */
  let running = false;
  let fist = false;            // 当前是否处于握拳态
  let openSince = 0;           // 松开握拳的起始时刻（0 = 仍握拳）
  let lastAngle = null;        // 上一帧掌轴角
  let pathDeg = 0;             // 累计转角（路径长度，单位：度）
  let turns = 0;               // 已完成的「下」数
  let lastSeenAt = 0;          // 最近一次看到右手的时间
  let haveRight = false;       // 是否曾看到右手
  let fired = false;           // 是否已经完成（防止重复触发）
  let lastEmit = "";           // 状态去重
  let onStatusCb = null;
  let onProgressCb = null;
  let onCompleteCb = null;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function emitStatus(status, detail, info) {
    if (status === lastEmit) return;   // 同状态不重复广播，避免 UI 抖动
    lastEmit = status;
    if (onStatusCb) { try { onStatusCb(status, detail || "", info || {}); } catch (e) { /* ignore */ } }
  }

  /** 读取一只手的左右标签与置信度（兼容 handednesses 的嵌套数组结构） */
  function labelOf(h) {
    const one = Array.isArray(h) ? h[0] : h;
    if (!one) return { label: "", score: 0 };
    return { label: one.categoryName || "", score: typeof one.score === "number" ? one.score : 0 };
  }

  /** 握拳：数一数有几根手指卷起（指尖比 PIP 更靠近手腕） */
  function countCurled(pts) {
    const wrist = pts[0];
    let n = 0;
    for (let k = 0; k < TIPS.length; k++) {
      const dTip = dist(pts[TIPS[k]], wrist);
      const dPip = dist(pts[PIPS[k]], wrist);
      if (dTip < dPip * 1.02) n++;
    }
    return n;
  }

  /** 掌轴角：手腕 → 中指根（握拳时中指根依然稳定，转腕时跟着前臂转） */
  function palmAngle(pts) {
    return Math.atan2(pts[9].y - pts[0].y, pts[9].x - pts[0].x);
  }

  function resetProgress() {
    pathDeg = 0;
    turns = 0;
    lastAngle = null;
  }

  function emitProgress() {
    if (!onProgressCb) return;
    const stepDeg = pathDeg - turns * STEP_DEG;      // 当前这一下已转过的角度
    try {
      onProgressCb({
        turns,
        turnProgress: clamp01(stepDeg / STEP_DEG),
        totalProgress: clamp01(pathDeg / TOTAL_DEG),
        pathDeg,
        fist,
        haveRight,
        rightSeen: haveRight,
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------- 绘制 ---------- */
  function draw(handsPx, handedness) {
    HandCam.clearOverlay();
    handsPx.forEach((pts, i) => {
      const { label } = labelOf(handedness[i]);
      const isRight = label === RIGHT_LABEL;
      if (isRight) {
        HandCam.drawSkeleton(pts, fist
          ? { color: "rgba(126, 200, 138, .95)", dotColor: "rgba(160, 226, 170, 1)" }
          : { color: "rgba(230, 182, 85, .9)", dotColor: "rgba(245, 210, 140, 1)" });
      } else {
        HandCam.drawSkeleton(pts, {
          color: "rgba(190, 190, 200, .30)",
          dotColor: "rgba(205, 205, 215, .35)",
          width: 1,
        });
      }
    });
  }

  /* ---------- 每帧判定 ---------- */
  function handleFrame(frame) {
    if (!running) return;
    const now = performance.now();
    const handsPx = frame.handsPx || [];
    const handedness = frame.handedness || [];

    // 找出用户的右手（原始帧上标签为 "Left"）
    let right = null;
    let rightScore = -1;
    handsPx.forEach((pts, i) => {
      const { label, score } = labelOf(handedness[i]);
      if (label === RIGHT_LABEL && score > rightScore) {
        right = pts;
        rightScore = score;
      }
    });

    draw(handsPx, handedness);

    if (!right) {
      haveRight = false;
      // 短暂丢失不清零，超过容忍时长才判定为「人离开了」
      if (now - lastSeenAt > LOST_MS) {
        if (fist || pathDeg > 0) {
          fist = false;
          openSince = 0;
          resetProgress();
          emitProgress();
        }
        emitStatus("no-right", "没看到右手，把右手伸进画面");
      }
      emitProgress();
      return;
    }

    haveRight = true;
    lastSeenAt = now;

    /* --- 握拳判定（迟滞） --- */
    const curled = countCurled(right);
    if (fist) {
      if (curled <= FIST_OFF) fist = false;
    } else if (curled >= FIST_ON) {
      fist = true;
    }

    /* --- 松开握拳足够久才重置进度 --- */
    if (fist) {
      openSince = 0;
    } else {
      if (!openSince) openSince = now;
      else if (now - openSince > OPEN_RESET_MS && pathDeg > 0) {
        resetProgress();
        emitProgress();
      }
    }

    /* --- 转角累计 --- */
    const ang = palmAngle(right);
    if (lastAngle !== null && fist) {
      let d = ang - lastAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const deg = (d * 180) / Math.PI;
      if (Math.abs(deg) >= NOISE_DEG) pathDeg += Math.abs(deg);
    }
    lastAngle = ang;

    /* --- 计数 --- */
    const newTurns = Math.min(TURN_COUNT, Math.floor(pathDeg / STEP_DEG));
    if (newTurns !== turns) {
      turns = newTurns;
      if (turns > 0) emitStatus("turn", `转了 ${turns} 下`, { turns, pathDeg });
    }

    if (!fist) {
      emitStatus("open", "右手握拳，再转动手腕", { curled, pathDeg, turns });
    } else if (turns < TURN_COUNT) {
      emitStatus("fist", "握拳了，开始转动手腕", { curled, pathDeg, turns });
    }

    emitProgress();

    /* --- 完成 --- */
    if (turns >= TURN_COUNT && !fired) {
      fired = true;
      emitStatus("done", "手腕转了三下，翻炒完成！", { turns, pathDeg });
      if (onCompleteCb) { try { onCompleteCb({ turns, pathDeg }); } catch (e) { /* ignore */ } }
    }
  }

  /* ---------- 对外接口 ---------- */
  async function start(opts) {
    const { video, overlay, onStatus, onProgress, onComplete } = opts || {};
    onStatusCb = onStatus || null;
    onProgressCb = onProgress || null;
    onCompleteCb = onComplete || null;
    fist = false; openSince = 0; lastAngle = null;
    pathDeg = 0; turns = 0; lastSeenAt = 0; haveRight = false; fired = false;
    lastEmit = "";

    const res = await HandCam.start({
      video,
      overlay,
      hands: 2,
      onStatus: (status, detail, info) => {
        if (onStatusCb) { try { onStatusCb(status, detail, info); } catch (e) { /* ignore */ } }
      },
      onFrame: handleFrame,
    });
    if (res.ok) running = true;
    return res;
  }

  function stop() {
    running = false;
    fist = false; openSince = 0; lastAngle = null;
    pathDeg = 0; turns = 0; haveRight = false;
    HandCam.stop();
  }

  return {
    start, stop,
    supported: () => HandCam.supported(),
    /* 测试用：注入自定义 landmarker 工厂 */
    setProvider(fn) { HandCam.setProvider(fn); },
    get state() {
      return { turns, pathDeg, fist, haveRight, running, fired };
    },
    get isRunning() { return running; },
    /* 识别模式："model" | "none"（模型是否真的跑起来了） */
    get mode() { return HandCam.mode; },
    /* 常量暴露给调用方做进度映射 */
    TURN_COUNT, STEP_DEG, TOTAL_DEG,
  };
})();
