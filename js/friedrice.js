/* ============================================================
 * friedrice.js — 炒饭「别把这锅炒糊了」（P0 核心路径，PRD 5.4）
 * 流程：热锅备料 → 拖拽下料 → 环形翻炒手势 → 火候阈值条关火 → 盛出装盘
 * ============================================================ */
"use strict";

Game.runners.chaofan = (() => {
  const dish = () => DISHES.find((d) => d.id === "chaofan");

  let phase = "intro";
  let dropped = [];        // 已下锅食材
  let mistakes = 0;        // 失误计数（影响完成度）
  let fireAttempts = 0;
  let stirDone = false;
  let fb = null;           // FireBar 实例
  let smokeTimer = null;
  let stirCleanup = null; // 翻炒阶段的清理函数（事件监听 + 摄像头）
  let stirBy = "mouse";    // 翻炒完成方式："wrist"（转腕三下）| "mouse"（画圈一圈）

  const stage = () => Game.stage();

  /* ---------- 锅铲素材的轴向（实测值，别凭印象改） ----------
   * assets/tool/spatula.png 为 505×462，铲头在右上、木柄在左下。
   * 以图片中心（= CSS transform-origin）为原点量角（正 x 向右、正 y 向下）：
   *   铲头指向 -42.6°，手柄指向 137.2°。
   * 早期代码里「铲头朝 135°」的注释是反的，会把锅铲整体转错方向。
   * 下面四个常量由 tools/measure_spatula_axis.py 实测得出，改素材后请重跑该脚本。 */
  const HEAD_DIR_DEG = -42.6;    // 素材原始朝向下铲头的指向角
  const HANDLE_DIR_DEG = 137.2;  // 素材原始朝向下手柄的指向角
  const HEAD_TIP_RATIO = 0.571;  // 铲头金属片最远顶点离中心的比例
  const HANDLE_TIP_RATIO = 0.638;// 木柄最远端离中心的比例
  const SPATULA_W = "18%";       // 锅铲宽度（相对舞台）

  /**
   * 把锅铲摆到「锅的右方」停靠位：
   *   手柄朝外（画面右侧），铲头朝锅内（画面左侧）。
   * 位置由锅的实际像素位置反推，不写死百分比 —— 窄屏 / 舞台尺寸变化都不会跑位。
   * @returns {{cx:number, cy:number, spatW:number, spatH:number}|null} 锅铲中心点
   */
  function parkSpatula() {
    const st = stage();
    const spatula = st.querySelector("#spatula");
    const wok = st.querySelector("#wokZone");
    if (!spatula || !wok) return null;
    const stBox = st.getBoundingClientRect();
    const wokBox = wok.getBoundingClientRect();

    spatula.style.width = SPATULA_W;
    spatula.style.aspectRatio = "505 / 462";   // 图片未加载时也能拿到正确高度
    const spatBox = spatula.getBoundingClientRect();
    const spatW = spatBox.width || 1;
    const spatH = spatBox.height || 1;

    const tip = spatW * HEAD_TIP_RATIO;         // 铲头尖端离中心的距离
    const handle = spatW * HANDLE_TIP_RATIO;    // 手柄末端离中心的距离
    const inset = wokBox.width * 0.12;          // 铲头探进锅里的深度
    // 铲头朝左 ⇒ 尖端在中心左侧 tip 处；要让尖端探进锅沿 inset，就得到这个中心位置
    let cx = wokBox.right - inset + tip;
    const maxCx = stBox.right - handle - 12;    // 手柄末端不能伸出舞台（留一点余量给旋转后的包围盒）
    if (cx > maxCx) cx = maxCx;
    const cy = wokBox.top + wokBox.height / 2;  // 与锅心同高

    spatula.style.left = (cx - spatW / 2 - stBox.left).toFixed(1) + "px";
    spatula.style.top = (cy - spatH / 2 - stBox.top).toFixed(1) + "px";
    // 手柄朝画面右（外侧）：把素材手柄角转到 0°，铲头就自动朝左（锅内）
    spatula.style.transform = `rotate(${(0 - HANDLE_DIR_DEG).toFixed(1)}deg)`;
    return { cx, cy, spatW, spatH };
  }

  /* ---------- 舞台搭建 ---------- */
  function buildStage() {
    stage().innerHTML = `
      <div class="wok-zone" id="wokZone">
        <img class="wok-img" id="wokImg" src="assets/tool/wok.png?v=5" alt="炒锅">
        <div class="heat-glow" id="heatGlow"></div>
        <div class="contents" id="wokContents"></div>
        <div class="char-overlay" id="charOverlay"></div>
        <svg class="progress-ring" id="stirRing" viewBox="0 0 100 100" style="display:none">
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,250,240,.35)" stroke-width="3"/>
          <circle id="stirRingFg" cx="50" cy="50" r="48" fill="none" stroke="#e6b655" stroke-width="3.5"
                  stroke-linecap="round" stroke-dasharray="301.6" stroke-dashoffset="301.6" transform="rotate(-90 50 50)"/>
        </svg>
      </div>
      <div class="stage-tool" id="spatula" style="display:none;width:18%">
        <img src="assets/tool/spatula.png?v=5" alt="锅铲">
      </div>
      <div id="stirPanelSlot"></div>
      <div class="prep-board" id="prepBoard"></div>
      <div class="stage-tool" id="serveBowl" style="display:none;right:5%;bottom:5%;width:19%">
        <img src="assets/tool/bowl.png?v=5" alt="碗">
      </div>`;
  }

  /* ---------- 阶段：热锅备料 ---------- */
  function phaseIntro() {
    phase = "intro";
    Game.setSteps(dish().steps, 0, 0);
    Game.setHint("灶台已就绪。<em>点击炒锅开火</em>，我们先热锅。");
    const wok = stage().querySelector("#wokZone");
    wok.classList.add("droppable");
    wok.style.cursor = "pointer";
    wok.addEventListener("pointerdown", ignite, { once: true });
  }

  function ignite() {
    if (Game.paused) return;
    Sound.play("confirm");
    Sound.startLoop("sizzle");
    stage().querySelector("#heatGlow").style.opacity = ".28";
    Game.feedback("info", "锅热了，开始下料！", 1800);
    setTimeout(phaseDrop, 700);
  }

  /* ---------- 阶段：拖拽下料（PRD：向锅中推送手势 → 鼠标拖拽替代） ---------- */
  function phaseDrop() {
    phase = "drop";
    Game.setSteps(dish().steps, 1, 1);
    Game.setHint("把食材<em>按顺序拖进锅里</em>：先鸡蛋，再米饭，然后配料。");
    const board = stage().querySelector("#prepBoard");
    board.innerHTML = "";
    dish().ingredients.forEach((ing, idx) => {
      const el = Game.buildIngredientCard(ing, idx === 0 ? "next" : "");
      board.appendChild(el);
      Game.makeDraggable(el, {
        // 「一碗米」：碗固定不动，只有碗里的米可以拖
        handle: ing.bowlImg ? ".combo-pick" : null,
        ghostSrc: ing.bowlImg ? ing.img : null,
        targets: () => [stage().querySelector("#wokZone")],
        onDrop: () => onIngredientDropped(el, ing, idx),
        onMiss: () => Game.feedback("info", "要放进锅里哦", 1500),
      });
    });
  }

  function onIngredientDropped(el, ing, idx) {
    const expected = dropped.length;
    if (idx !== expected) {
      const want = dish().ingredients[expected];
      Game.feedback("info", `先放「${want.name}」比较好`, 1800);
      Sound.play("warn");
      return;
    }
    el.classList.add("used");
    dropped.push(ing.id);
    // 从「下第一个菜」起就一直是炒锅的声音，直到出锅前才停（loop 幂等，不会重头播）
    Sfx.loop("fry");
    Telemetry.log("gesture_success", { dish: "chaofan", action: "drop", item: ing.id });
    Sound.play(ing.id === "egg" ? "drop" : "drop");
    if (ing.id === "egg") Sound.play("pour");
    // 下锅视觉：堆入锅中（碗装食材用去碗版，避免整只碗掉进锅里）
    const c = stage().querySelector("#wokContents");
    const im = document.createElement("img");
    im.src = ing.potImg || ing.img;
    im.style.transform = `translate(${(Math.random() * 24 - 12).toFixed(0)}%, ${(Math.random() * 16 - 8).toFixed(0)}%) rotate(${(Math.random() * 30 - 15).toFixed(0)}deg)`;
    c.appendChild(im);
    // 气味联动（PRD：轻微蛋香/米香）
    Scent.trigger(ing.scent, 3, 1);
    // 下一步高亮
    const items = stage().querySelectorAll(".ing-item");
    items.forEach((it, i) => it.classList.toggle("next", i === dropped.length));
    Game.feedback("ok", `「${ing.name}」入锅！`, 1400);

    if (dropped.length === dish().ingredients.length) {
      setTimeout(phaseStir, 800);
    }
  }

  /* ---------- 阶段：环形翻炒（右手握拳 · 转动手腕三下） ---------- */
  function phaseStir() {
    phase = "stir";
    stirDone = false;
    Game.setSteps(dish().steps, 2, 2);
    Game.setHint("<em>开启摄像头</em>，<em>右手握拳</em>转动手腕<em>三下</em>就算翻炒完成；也可按住锅里的食材画圈。");
    cleanupStir();

    const wok = stage().querySelector("#wokZone");
    const ring = stage().querySelector("#stirRing");
    const ringFg = stage().querySelector("#stirRingFg");
    const spatula = stage().querySelector("#spatula");
    ring.style.display = "";
    // 锅铲停在锅的右方：手柄朝外、铲头朝锅内
    spatula.style.display = "";
    spatula.style.pointerEvents = "none";
    const park = parkSpatula() || { cx: 0, cy: 0 };

    /* 翻炒时锅铲绕锅心公转、铲头始终朝向锅心 —— 视觉上就是「拿铲子翻锅」。
       公转半径取停靠位到锅心的距离，绕满一整圈正好回到停靠姿态，衔接处没有跳变。 */
    const wokBox = wok.getBoundingClientRect();
    const cx = wokBox.left + wokBox.width / 2;
    const cy = wokBox.top + wokBox.height / 2;
    const A0 = Math.atan2(park.cy - cy, park.cx - cx);
    const ORBIT_R = Math.max(1, Math.hypot(park.cx - cx, park.cy - cy));
    // 铲头要指向锅心（= 方位角 + 180°）；素材铲头原始角为 HEAD_DIR_DEG
    const rotOf = (a) => (a * 180) / Math.PI + 180 - HEAD_DIR_DEG;
    const placeSpatula = (a) => {
      const dx = ORBIT_R * (Math.cos(a) - Math.cos(A0));
      const dy = ORBIT_R * (Math.sin(a) - Math.sin(A0));
      spatula.style.transform =
        `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${rotOf(a).toFixed(1)}deg)`;
    };
    placeSpatula(A0);   // 静止姿态：手柄朝外、铲头斜指着锅心

    // 备料区收起，让锅区成为唯一焦点
    const board = stage().querySelector("#prepBoard");
    board.style.display = "none";
    Scent.trigger("fryrice", 6, 2);
    Sound.startLoop("sizzle");

    /* 统一的进度量 = 锅铲公转弧度。
       鼠标画一圈 与 转腕三下 都归一到「绕锅一整圈」，两条路径进度完全对齐。 */
    const TOTAL_RAD = Math.PI * 2;
    // 转腕三下 = 240°（Wrist.TOTAL_DEG），映射成锅铲公转 360°
    const WRIST_SPIN = TOTAL_RAD / ((Wrist.TOTAL_DEG * Math.PI) / 180);
    let stirRad = 0;
    let stirSoundAt = 0;

    const setRing = (p) => {
      ringFg.style.strokeDashoffset = (301.6 * (1 - Math.max(0, Math.min(1, p)))).toFixed(1);
    };

    /** 推进翻炒进度：spin = 本次增加的锅铲公转弧度 */
    const advance = (spin, by) => {
      if (stirDone || Game.paused) return;
      if (by) stirBy = by;
      stirRad += spin;
      placeSpatula(A0 + stirRad);
      if (stirRad - stirSoundAt > 0.5) { Sound.play("stir"); stirSoundAt = stirRad; }
      setRing(stirRad / TOTAL_RAD);
      if (stirRad >= TOTAL_RAD) finishStir();
    };

    /* ---------- 降级路径：按住锅里的食材画圈 ---------- */
    let stirring = false;
    let lastAngle = null;
    const angleOf = (ev) => {
      const r = wok.getBoundingClientRect();
      return Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2));
    };
    const onDown = (ev) => {
      if (Game.paused || stirDone) return;
      stirring = true;
      lastAngle = angleOf(ev);
      wok.classList.add("stirring");
      Telemetry.log("gesture_start", { dish: "chaofan", action: "stir" });
    };
    const onMove = (ev) => {
      if (!stirring || Game.paused || stirDone) return;
      const a = angleOf(ev);
      let d = a - lastAngle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      lastAngle = a;
      advance(Math.abs(d), "mouse");
    };
    const onUp = () => { stirring = false; wok.classList.remove("stirring"); };

    wok.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    /* ---------- 摄像头路径：右手握拳转腕三下 ---------- */
    let lastPathDeg = 0;
    buildStirPanel({
      onWrist: (p) => {
        // 先结算增量再判断暂停：否则暂停期间累积的转角会在恢复瞬间一次性灌进来
        const deltaDeg = p.pathDeg - lastPathDeg;
        lastPathDeg = p.pathDeg;
        if (Game.paused) return;
        if (deltaDeg > 0) advance(((deltaDeg * Math.PI) / 180) * WRIST_SPIN, "wrist");
      },
    });

    stirCleanup = () => {
      wok.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      Wrist.stop();
    };

    function finishStir() {
      if (stirDone) return;
      stirDone = true;
      wok.classList.remove("stirring");
      setRing(1);
      cleanupStir();
      Telemetry.log("gesture_success", { dish: "chaofan", action: "stir", by: stirBy });
      Sound.play("success");
      Game.feedback("ok", "翻炒完成！米粒颗颗分明、颜色均匀。", 2200);
      setTimeout(phaseFire, 900);
    }
  }

  /** 清理翻炒阶段的监听与摄像头（重试 / 离开阶段都会调用） */
  function cleanupStir() {
    if (stirCleanup) { try { stirCleanup(); } catch (e) { /* ignore */ } stirCleanup = null; }
    Wrist.stop();
  }

  /* ---------- 摄像头面板（右手握拳转腕） ---------- */
  function buildStirPanel(hooks) {
    const slot = stage().querySelector("#stirPanelSlot");
    if (!slot) return;
    slot.innerHTML = `
      <div class="cam-overlay cam-left">
        <div class="cam-panel" id="camPanel">
          <div class="cam-head">
            <span class="cam-title">握拳转腕</span>
            <span class="cam-badge" id="camBadge">摄像头未开启</span>
          </div>
          <div class="cam-view">
            <video id="camVideo" playsinline muted></video>
            <canvas id="camOverlay"></canvas>
            <div class="cam-veil" id="camVeil">
              <div class="cam-veil-eye">右手</div>
              <div class="cam-veil-text">开启摄像头后<br>右手握拳，转动手腕</div>
            </div>
          </div>
          <div class="cam-turn-row" id="camTurnRow">
            <span class="turn-dot"></span>
            <span class="turn-dot"></span>
            <span class="turn-dot"></span>
            <span id="camTurnText">等待摄像头</span>
          </div>
          <div class="cam-actions">
            <button class="btn btn-primary btn-sm" id="btnCamStart">开启摄像头</button>
            <button class="btn btn-ghost btn-sm" id="btnCamSkip">改用鼠标画圈</button>
          </div>
          <p class="cam-privacy">画面只在本机实时识别，不上传、不录制、不保存</p>
        </div>
      </div>`;

    const badge = slot.querySelector("#camBadge");
    const veil = slot.querySelector("#camVeil");
    const turnText = slot.querySelector("#camTurnText");
    const dots = Array.prototype.slice.call(slot.querySelectorAll(".turn-dot"));
    const btnStart = slot.querySelector("#btnCamStart");
    const btnSkip = slot.querySelector("#btnCamSkip");

    const setTurns = (n) => dots.forEach((d, i) => d.classList.toggle("on", i < n));

    btnStart.addEventListener("click", async () => {
      btnStart.disabled = true;
      btnStart.textContent = "启动中…";
      const res = await Wrist.start({
        video: slot.querySelector("#camVideo"),
        overlay: slot.querySelector("#camOverlay"),
        onStatus: (status, detail, info) => {
          if (status === "requesting") { badge.textContent = "请求权限…"; turnText.textContent = "等待授权"; }
          else if (status === "loading") { badge.textContent = "加载模型…"; turnText.textContent = "加载识别模型"; }
          else if (status === "ready") {
            veil.classList.add("cam-veil-off");
            badge.textContent = "识别中";
            btnStart.classList.add("hidden");
            turnText.textContent = "右手握拳";
            Game.feedback("info", "摄像头已开启：右手握拳，转动手腕三下", 2600);
            Telemetry.log("camera_start", { dish: "chaofan", mode: Wrist.mode });
          } else if (status === "no-right") {
            if (!Wrist.isRunning) return;
            badge.textContent = "未见右手";
            turnText.textContent = "把右手伸进画面";
            setTurns(0);
          } else if (status === "open") {
            if (!Wrist.isRunning) return;
            badge.textContent = "待握拳";
            turnText.textContent = "右手握拳";
          } else if (status === "fist") {
            if (!Wrist.isRunning) return;
            badge.textContent = "已握拳";
            turnText.textContent = "转动手腕";
          } else if (status === "turn") {
            if (!Wrist.isRunning) return;
            badge.textContent = "翻炒中";
            turnText.textContent = `已转 ${info.turns} 下`;
          } else if (status === "done") {
            badge.textContent = "翻炒完成";
            turnText.textContent = "三下，转好了";
            setTurns(Wrist.TURN_COUNT);
          } else if (status === "denied" || status === "unsupported" || status === "unavailable" || status === "failed") {
            badge.textContent = status === "failed" ? "识别模型不可用"
              : status === "denied" ? "权限被拒绝"
              : status === "unsupported" ? "不支持摄像头"
              : "摄像头不可用";
            btnStart.disabled = false;
            btnStart.textContent = "重试开启摄像头";
            btnStart.classList.remove("hidden");
            turnText.textContent = "可改用鼠标画圈";
            Game.feedback("info", (detail || "摄像头不可用") + "，可改用鼠标画圈", 3200);
          }
        },
        onProgress: (p) => {
          setTurns(p.turns);
          if (p.fist && p.turns < Wrist.TURN_COUNT) turnText.textContent = `转腕中 ${p.turns}/3`;
          if (hooks.onWrist) hooks.onWrist(p);
        },
      });
      if (!res.ok) {
        btnStart.disabled = false;
        btnStart.textContent = "重试开启摄像头";
        btnStart.classList.remove("hidden");
        if (res.reason === "unsupported") {
          Game.feedback("info", "当前环境不支持摄像头（需在 localhost 或 https 下打开），可改用鼠标画圈", 3400);
        } else if (res.reason === "denied") {
          Game.feedback("info", "摄像头权限被拒绝，可改用鼠标画圈", 3000);
        } else if (res.reason === "model") {
          Game.feedback("info", (res.detail || "识别模型加载失败") + "，可改用鼠标画圈", 3600);
        }
      }
    });

    btnSkip.addEventListener("click", () => {
      Wrist.stop();
      slot.innerHTML = "";
      Game.setHint("按住<em>锅里的食材</em>，<em>画圈翻炒一圈</em>，让米饭均匀受热。");
      Game.feedback("info", "改用鼠标画圈：按住锅里的食材画一圈", 2400);
      Telemetry.log("camera_skip", { dish: "chaofan" });
    });
  }

  /* ---------- 阶段：火候阈值条（PRD F6 / 5.4 控制火候） ---------- */
  function phaseFire(fromValue = 0) {
    phase = "fire";
    cleanupStir();          // 离开翻炒阶段，确保摄像头轨道被释放
    const ring = stage().querySelector("#stirRing");
    if (ring) ring.style.display = "none";   // 收起翻炒进度环
    Game.setSteps(dish().steps, 3, 3);
    Game.setHint("盯住火候条：指针进入<em>绿色区间</em>时点击「关火」。太早夹生，太晚会糊！");
    Game.unmountFireBar();
    const glow = stage().querySelector("#heatGlow");
    const charOl = stage().querySelector("#charOverlay");
    const contents = stage().querySelector("#wokContents");
    charOl.style.opacity = "0";
    contents.style.filter = "";

    fb = Game.mountFireBar(
      { duration: 9000, good: [58, 82], labels: ["欠火", "刚刚好", "过火"], stopText: "关火！", title: "火候" },
      (value, status) => onFireStop(value, status)
    );
    fb.onTick = (v) => {
      glow.style.opacity = String(0.2 + (v / 100) * 0.75);
      // 过火预警：冒烟 + 变色
      if (v > 82) {
        contents.style.filter = "brightness(.72) sepia(.35)";
        if (!smokeTimer) {
          smokeTimer = setInterval(() => spawnPuff("smoke-puff"), 420);
        }
      }
    };
    fb.start(fromValue);
  }

  function spawnPuff(cls) {
    const wok = stage().querySelector("#wokZone");
    const p = document.createElement("div");
    p.className = cls;
    p.style.left = 25 + Math.random() * 50 + "%";
    p.style.top = 10 + Math.random() * 25 + "%";
    wok.appendChild(p);
    setTimeout(() => p.remove(), 2400);
  }

  function stopSmoke() {
    clearInterval(smokeTimer);
    smokeTimer = null;
  }

  function onFireStop(value, status) {
    stopSmoke();
    const contents = stage().querySelector("#wokContents");
    if (status === "perfect") {
      Sound.stopAllLoops();
      Sound.play("success");
      contents.style.filter = "brightness(1.06) saturate(1.25)"; // 金黄
      Game.feedback("ok", "火候刚刚好！金黄的蛋炒饭出锅在即。", 0);
      Telemetry.log("fire_judge", { result: "perfect", value });
      setTimeout(phaseServe, 1100);
    } else if (status === "under") {
      // 火候不足：不再重试，直接出结果卡，标注「没熟」
      fireAttempts++;
      mistakes++;
      Sound.play("warn");
      Game.feedback("info", "火候没到，米饭没炒透……直接出锅看看这锅夹生的样子。", 0);
      Telemetry.log("fire_judge", { result: "under", value });
      setTimeout(() => finish("under"), 1400);
    } else {
      // 火候过头：不再重试，直接出结果卡，标注「焦了」
      fireAttempts++;
      mistakes++;
      Sound.stopAllLoops();
      Sound.play("fail");
      contents.style.filter = "brightness(.5) sepia(.5)";
      stage().querySelector("#charOverlay").style.opacity = "1";
      for (let i = 0; i < 4; i++) setTimeout(() => spawnPuff("smoke-puff"), i * 200);
      Scent.trigger("burnt", 2.5, 1);   // 低强度短时焦糊（PRD F5.3）
      Game.feedback("bad", "火候过了，锅底已经焦了……直接出锅看看这锅烧焦的样子。", 0);
      Telemetry.log("fire_judge", { result: "over", value });
      setTimeout(() => finish("over"), 1600);
    }
  }

  /* ---------- 阶段：盛出装盘（盛出手势 → 拖拽锅铲到碗） ---------- */
  function phaseServe() {
    phase = "serve";
    cleanupStir();
    Sfx.stop("fry");        // 出锅了，炒菜声收尾
    Game.setSteps(dish().steps, 4, 4);
    Game.setHint("最后一步：<em>拖动锅铲</em>，把炒饭盛进碗里。");
    Game.unmountFireBar();
    stage().querySelector("#heatGlow").style.opacity = "0";
    const spatula = stage().querySelector("#spatula");
    const bowl = stage().querySelector("#serveBowl");
    // 锅铲回到锅右方的停靠位（与翻炒阶段一致），再由玩家拖进碗里
    parkSpatula();
    spatula.classList.add("stage-tool");
    spatula.style.pointerEvents = "";
    bowl.style.display = "";
    Game.makeDraggable(spatula, {
      targets: () => [bowl],
      onDrop: () => finish(),
      onMiss: () => Game.feedback("info", "盛到右边的碗里", 1600),
    });
  }

  function finish(outcome = "perfect") {
    if (outcome === "perfect") Sound.play("success");
    Scent.stop();
    cleanupStir();
    Sfx.stop("fry");        // 兜底：任何路径进结果卡都不留炒菜声
    const stars = outcome === "perfect" ? Math.max(2, 5 - mistakes) : 1;
    const stirDesc = stirBy === "wrist" ? "转腕三下" : "画圈一圈";
    const fireText = outcome === "perfect"
      ? (fireAttempts === 0
        ? "一次到位，火候大师"
        : `调整 ${fireAttempts} 次后恰到好处`)
      : (outcome === "under" ? "火候不足，米饭夹生没熟" : "火候过头，锅底烧焦");
    const summary = outcome === "perfect"
      ? `你完成了下料、翻炒与掌火的完整链路。<br>下料 ${dropped.length}/4 种 · 翻炒${stirDesc} · ${fireText}。`
      : (outcome === "under"
        ? `火候条还没进绿区就关了火。<br>下料 ${dropped.length}/4 种 · 翻炒${stirDesc}，但米饭还没炒透——这锅端上桌是夹生的。`
        : `火候条冲过头才关火，锅底已经焦了。<br>下料 ${dropped.length}/4 种 · 翻炒${stirDesc}，可惜整锅都烧成了焦炭。`);
    Game.showResult({
      dishName: "炒饭",
      title: "别把这锅炒糊了",
      img: dish().img,
      branch: "经典蛋炒饭",
      stars,
      fireText,
      memoryScent: outcome === "over" ? "焦糊味（短时低强度模拟）" : "炒饭香",
      extraLines: outcome === "perfect"
        ? (mistakes > 0 ? ["本局曾触发低强度焦糊提示（短时模拟）"] : [])
        : [outcome === "under" ? "失误记录：火候未到就关火，米饭夹生" : "失误记录：火候过头，锅底烧焦"],
      summary,
      outcome,
    });
    Telemetry.log("complete", { dish: "chaofan", mistakes, fireAttempts, outcome });
  }

  /* ---------- 对外接口 ---------- */
  return {
    start() {
      dropped = [];
      mistakes = 0;
      fireAttempts = 0;
      stirBy = "mouse";
      stopSmoke();
      cleanupStir();
      buildStage();
      phaseIntro();
    },
    retry() {
      // 顶栏「重试」：重做当前阶段
      if (phase === "fire") { stopSmoke(); phaseFire(0); }
      else if (phase === "stir") { stirBy = "mouse"; phaseStir(); }
      else if (phase === "drop") { dropped = []; phaseDrop(); }
      else if (phase === "serve") { phaseServe(); }
      else { phaseIntro(); }
    },
    /* 离开本道菜 / 暂停时被 Game.stopRunner() 调用：
       必须把摄像头轨道彻底释放，否则指示灯会一直亮着。 */
    stop() {
      cleanupStir();
      stopSmoke();
      const btn = stage().querySelector("#btnCamStart");
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("hidden");
        btn.textContent = "开启摄像头";
      }
    },
  };
})();
