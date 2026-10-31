/* ============================================================
 * naicha.js — 奶茶「甜度由你调」（PRD 5.1）
 * 流程：选茶底 → 加奶调甜（拖拽倒入）→ 顺时针搅拌 → 按压封杯
 * 边界：不使用焦糊味；甜度以界面呈现，不强行等同气味。
 * ============================================================ */
"use strict";

Game.runners.naicha = (() => {
  const dish = () => DISHES.find((d) => d.id === "naicha");

  const TEAS = [
    { id: "hongcha", name: "红茶", color: "#b4552d", sub: "醇厚 · 经典奶茶底" },
    { id: "wulong",  name: "乌龙", color: "#8a6d3b", sub: "回甘 · 清爽不寡淡" },
    { id: "moli",    name: "茉莉", color: "#7a8b5c", sub: "清香 · 带一点花香" },
  ];
  const MILKS = ["少", "标准", "多"];
  const SWEETS = ["三分", "五分", "七分"];

  let phase = "tea";
  let tea = null;
  let milk = "标准";
  let sweet = "五分";
  let stirAcc = 0;
  let stirHandlers = null;

  const stage = () => Game.stage();

  /* ---------- 舞台 ---------- */
  function buildStage() {
    stage().classList.remove("phase-seal");
    stage().innerHTML = `
      <div class="cup-zone" id="cupZone">
        <div class="liquid" id="liquid"></div>
        <img class="cup-img" id="cupImg" src="${dish().cupImg}" alt="茶杯">
        <div class="cup-tint" id="cupTint"></div>
        <div class="lid hidden" id="lid"></div>
        <svg class="hold-ring hidden" id="holdRing" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r="20" fill="none" stroke="rgba(255,250,240,.4)" stroke-width="4"/>
          <circle id="holdRingFg" cx="23" cy="23" r="20" fill="none" stroke="#e6b655" stroke-width="4"
                  stroke-linecap="round" stroke-dasharray="125.6" stroke-dashoffset="125.6" transform="rotate(-90 23 23)"/>
        </svg>
      </div>
      <div class="prep-board" id="prepBoard" style="display:none"></div>
      <div id="choiceSlot"></div>`;
  }

  /**
   * 加奶后：杯子素材换成「装满牛奶」版本。
   * 这张图里的牛奶是不透明的纯白，若直接换上，玩家选的茶底就完全看不见了。
   * 解法：网页上叠一层茶色（.cup-tint），用 PNG 遮罩 clip 住杯内牛奶，
   * 玻璃壁与奶油描边不受影响 —— 于是同一个杯子能呈现红茶/乌龙/茉莉三种汤色。
   */
  function switchToFullCup() {
    const cup = stage().querySelector("#cupZone");
    const img = stage().querySelector("#cupImg");
    const tint = stage().querySelector("#cupTint");
    img.src = dish().cupFullImg;
    // 遮罩（白=杯内牛奶）裁出染色范围：白 × 茶色 = 奶茶色
    const mask = `url("${dish().cupMilkMask}")`;
    tint.style.webkitMaskImage = mask;
    tint.style.maskImage = mask;
    cup.classList.add("has-milk");
  }

  function closeChoices() {
    const slot = stage().querySelector("#choiceSlot");
    slot.innerHTML = "";
  }

  /* ---------- 阶段 1：选茶底 ---------- */
  function phaseTea() {
    phase = "tea";
    Game.setSteps(dish().steps, 0, 0);
    Game.setHint("先选一个<em>茶底</em>：红茶醇厚、乌龙回甘、茉莉清香。");
    const slot = stage().querySelector("#choiceSlot");
    slot.innerHTML = `
      <div class="choice-overlay">
        <div class="choice-title">今天喝什么茶？</div>
        <div class="choice-cards">
          ${TEAS.map((t) => `
            <div class="choice-card" data-tea="${t.id}">
              <div class="cc-name">${t.name}</div>
              <div class="cc-swatch" style="background:${t.color}"></div>
              <div class="cc-sub">${t.sub}</div>
            </div>`).join("")}
        </div>
      </div>`;
    slot.querySelectorAll(".choice-card").forEach((card) => {
      card.addEventListener("click", () => {
        tea = TEAS.find((t) => t.id === card.dataset.tea);
        Sound.play("confirm");
        Sound.play("pour");
        Telemetry.log("select_branch", { dish: "naicha", branch: tea.id });
        stage().querySelector("#liquid").style.backgroundColor = tea.color;
        Scent.trigger("tea", 3, 1);
        Game.feedback("ok", `注入${tea.name}茶汤，茶香飘出来了`, 2000);
        closeChoices();
        setTimeout(phaseMilk, 800);
      });
    });
  }

  /* ---------- 阶段 2：加奶与调甜 ---------- */
  function phaseMilk() {
    phase = "milk";
    Game.setSteps(dish().steps, 1, 1);
    Game.setHint("选好<em>奶量与甜度</em>，再把牛奶瓶<em>拖到茶杯里</em>倒入。");
    const slot = stage().querySelector("#choiceSlot");
    slot.innerHTML = `
      <div class="choice-overlay milk-choices" style="background:none;backdrop-filter:none;pointer-events:none;justify-content:flex-start;padding-top:4%">
        <div class="choice-panel" style="pointer-events:auto">
          <div class="seg-row"><span class="seg-label">奶量</span>
            ${MILKS.map((m) => `<button class="seg-btn ${m === milk ? "selected" : ""}" data-milk="${m}">${m}</button>`).join("")}
          </div>
          <div class="seg-row"><span class="seg-label">甜度</span>
            ${SWEETS.map((s) => `<button class="seg-btn ${s === sweet ? "selected" : ""}" data-sweet="${s}">${s}糖</button>`).join("")}
          </div>
        </div>
      </div>`;
    slot.querySelectorAll("[data-milk]").forEach((b) => b.addEventListener("click", () => {
      milk = b.dataset.milk; Sound.play("click");
      slot.querySelectorAll("[data-milk]").forEach((x) => x.classList.toggle("selected", x === b));
    }));
    slot.querySelectorAll("[data-sweet]").forEach((b) => b.addEventListener("click", () => {
      sweet = b.dataset.sweet; Sound.play("click");
      slot.querySelectorAll("[data-sweet]").forEach((x) => x.classList.toggle("selected", x === b));
    }));

    const board = stage().querySelector("#prepBoard");
    board.style.display = "";
    board.innerHTML = `
      <div class="ing-item next" id="milkItem">
        <img src="assets/ing/奶茶_牛奶瓶.png?v=5" alt="牛奶"><div class="ing-name">牛奶</div>
      </div>
      <div class="ing-item" id="iceItem">
        <img src="assets/ing/奶茶_冰块.png?v=5" alt="冰块"><div class="ing-name">冰块（可选）</div>
      </div>`;
    Game.makeDraggable(stage().querySelector("#milkItem"), {
      targets: () => [stage().querySelector("#cupZone")],
      onDrop: onMilkPoured,
      onMiss: () => Game.feedback("info", "倒进茶杯里哦", 1500),
    });
    Game.makeDraggable(stage().querySelector("#iceItem"), {
      targets: () => [stage().querySelector("#cupZone")],
      onDrop: (el) => {
        el.classList.add("used");
        Sound.play("drop");
        Sfx.play("drop");       // 放冰块的声音
        Game.feedback("ok", "加冰！这杯是冰奶茶", 1500);
        stage().dataset.iced = "1";
      },
      onMiss: () => {},
    });
  }

  function onMilkPoured(el) {
    el.classList.add("used");
    Sound.play("pour");
    Sfx.play("milk");           // 牛奶倒进杯子的录音
    Scent.trigger("milk", 3, 2);
    // 奶量影响汤色（视觉呈现，不以气味模拟甜味）
    const lighten = { 少: 0.15, 标准: 0.32, 多: 0.5 }[milk];
    const c = tea.color;
    const mixed = mixColor(c, "#f5ead2", lighten);
    stage().querySelector("#liquid").style.backgroundColor = mixed;
    // 换成满杯素材，并把汤色投到杯内牛奶上
    switchToFullCup();
    stage().querySelector("#cupTint").style.backgroundColor = mixed;
    if (milk === "多" && sweet === "七分") {
      Game.feedback("info", "奶多糖足的醇厚路线！这杯会很甜润", 2200);
    } else {
      Game.feedback("ok", `奶量「${milk}」· ${sweet}糖，配比完成`, 1800);
    }
    Telemetry.log("gesture_success", { dish: "naicha", action: "pour", milk, sweet });
    closeChoices();
    setTimeout(phaseStir, 1000);
  }

  function mixColor(hexA, hexB, t) {
    const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
    const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
    const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
    const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
    return `rgb(${r},${g},${bl})`;
  }

  /* ---------- 阶段 3：顺时针搅拌（2 圈） ---------- */
  function phaseStir() {
    phase = "stir";
    stirAcc = 0;
    Game.setSteps(dish().steps, 2, 2);
    Game.setHint("按住茶杯里的液体，<em>画圈搅拌 2 圈</em>，让茶与奶融合。");
    const cup = stage().querySelector("#cupZone");
    Scent.trigger("tea", 4, 2);

    const TOTAL = Math.PI * 2 * 2;
    let lastAngle = null;
    let stirring = false;
    let soundAt = 0;
    const angleOf = (ev) => {
      const r = cup.getBoundingClientRect();
      return Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2));
    };
    const onDown = (ev) => {
      if (Game.paused) return;
      stirring = true;
      lastAngle = angleOf(ev);
      cup.classList.add("stirring");
      Telemetry.log("gesture_start", { dish: "naicha", action: "stir" });
    };
    const onMove = (ev) => {
      if (!stirring || Game.paused) return;
      const a = angleOf(ev);
      let d = a - lastAngle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      lastAngle = a;
      stirAcc += Math.abs(d);
      if (stirAcc - soundAt > 0.6) { Sound.play("stir"); soundAt = stirAcc; }
      const p = Math.min(1, stirAcc / TOTAL);
      Game.setHint(`搅拌中…… <em>${Math.round(p * 100)}%</em>，继续画圈`);
      if (p >= 1) finishStir();
    };
    const onUp = () => { stirring = false; cup.classList.remove("stirring"); };
    cup.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    stirHandlers = { onDown, onMove, onUp };

    function finishStir() {
      cup.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      cup.classList.remove("stirring");
      Sound.play("ding");   // 冰块轻碰
      Sound.play("success");
      Telemetry.log("gesture_success", { dish: "naicha", action: "stir" });
      Game.feedback("ok", "搅拌均匀，颜色柔顺", 1800);
      setTimeout(phaseSeal, 800);
    }
  }

  /* ---------- 阶段 4：眨眼封口（摄像头）· 长按封口为降级路径 ---------- */
  let camOpened = false;
  let sealed = false;
  let sealFinish = null;      // 由 phaseSeal 注入，供眨眼回调调用

  const EYE_OPEN_PATH = "M4 12 Q24 2 44 12 Q24 22 4 12 Z";
  const EYE_SHUT_PATH = "M5 14 Q24 20 43 14";

  function phaseSeal() {
    phase = "seal";
    sealed = false;
    camOpened = false;
    Game.setSteps(dish().steps, 3, 3);
    Game.setHint("最后一步：<em>对着摄像头眨一下眼</em>，给奶茶封口。");
    const cup = stage().querySelector("#cupZone");
    const ring = stage().querySelector("#holdRing");
    const ringFg = stage().querySelector("#holdRingFg");
    let raf = null;
    let startAt = 0;
    const HOLD = 800;

    buildCamPanel();
    stage().classList.add("phase-seal");   // 窄屏下据此隐藏备料区、给面板让位

    /* --- 降级路径：按住茶杯压紧封口 --- */
    const onDown = (ev) => {
      if (Game.paused || sealed) return;
      ev.preventDefault();
      ring.classList.remove("hidden");
      startAt = performance.now();
      const tick = () => {
        if (Game.paused || sealed) { cancelHold(); return; }
        const p = Math.min(1, (performance.now() - startAt) / HOLD);
        ringFg.style.strokeDashoffset = (125.6 * (1 - p)).toFixed(1);
        if (p >= 1) { finishSeal("hold"); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const cancelHold = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      ring.classList.add("hidden");
      ringFg.style.strokeDashoffset = "125.6";
      cup.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
    const onUp = () => {
      if (raf && phase === "seal" && !sealed) {
        Game.feedback("info", "没眨上眼也没压满，可以再试一次", 1500);
      }
      cancelHold();
      if (phase === "seal" && !sealed) {
        cup.addEventListener("pointerdown", onDown);
        window.addEventListener("pointerup", onUp);
      }
    };
    cup.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    function finishSeal(by) {
      if (sealed) return;
      sealed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      cup.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      ring.classList.add("hidden");
      Blink.stop();
      camOpened = false;
      stage().querySelector("#lid").classList.remove("hidden");
      Sound.play("drop");       // 封杯「咔哒」
      Sound.play("success");
      Scent.stop();             // 封杯后停止输出，避免残留
      Telemetry.log("gesture_success", { dish: "naicha", action: "seal", by });
      Game.feedback("ok", by === "blink" ? "眨到了！咔哒，奶茶封口" : "咔哒！封杯完成", 1600);
      setTimeout(finish, 1000);
    }
    sealFinish = finishSeal;
  }

  /* ---------- 摄像头面板 ---------- */
  function buildCamPanel() {
    const slot = stage().querySelector("#choiceSlot");
    slot.innerHTML = `
      <div class="cam-overlay">
        <div class="cam-panel" id="camPanel">
          <div class="cam-head">
            <span class="cam-title">眨眼封口</span>
            <span class="cam-badge" id="camBadge">摄像头未开启</span>
          </div>
          <div class="cam-view">
            <video id="camVideo" playsinline muted></video>
            <canvas id="camOverlay"></canvas>
            <div class="cam-veil" id="camVeil">
              <div class="cam-veil-eye">◕‿◕</div>
              <div class="cam-veil-text">开启摄像头后<br>对着镜头眨一下眼</div>
            </div>
          </div>
          <div class="cam-eye-row">
            <svg class="cam-eye" id="camEye" viewBox="0 0 48 24">
              <path id="camEyePath" d="${EYE_OPEN_PATH}" fill="#f6ecd8" stroke="#8a6d3b" stroke-width="2"/>
              <circle id="camEyePupil" cx="24" cy="12" r="5" fill="#3b2a18"/>
            </svg>
            <span id="camEyeText">等待摄像头</span>
          </div>
          <div class="cam-actions">
            <button class="btn btn-primary btn-sm" id="btnCamStart">开启摄像头</button>
            <button class="btn btn-ghost btn-sm" id="btnCamSkip">改用长按封口</button>
          </div>
          <p class="cam-privacy">画面只在本机实时识别，不上传、不录制、不保存</p>
        </div>
      </div>`;

    const badge = slot.querySelector("#camBadge");
    const veil = slot.querySelector("#camVeil");
    const eyePath = slot.querySelector("#camEyePath");
    const eyePupil = slot.querySelector("#camEyePupil");
    const eyeText = slot.querySelector("#camEyeText");
    const btnStart = slot.querySelector("#btnCamStart");

    const setEye = (open, text) => {
      eyePath.setAttribute("d", open ? EYE_OPEN_PATH : EYE_SHUT_PATH);
      eyePupil.style.opacity = open ? "1" : "0";
      if (text) eyeText.textContent = text;
    };

    btnStart.addEventListener("click", async () => {
      btnStart.disabled = true;
      btnStart.textContent = "启动中…";
      const res = await Blink.start({
        video: slot.querySelector("#camVideo"),
        overlay: slot.querySelector("#camOverlay"),
        onStatus: (status, detail) => {
          if (status === "requesting") { badge.textContent = "请求权限…"; eyeText.textContent = "等待授权"; }
          else if (status === "loading") { badge.textContent = "加载模型…"; eyeText.textContent = "加载识别模型"; }
          else if (status === "ready") {
            camOpened = true;
            veil.classList.add("cam-veil-off");
            badge.textContent = Blink.mode === "model" ? "识别中" : "近似模式";
            btnStart.classList.add("hidden");
            setEye(true, "对着镜头眨一下眼");
            Game.feedback("info", "摄像头已开启，眨一下眼就封口", 2200);
            Telemetry.log("camera_start", { dish: "naicha", mode: Blink.mode });
          } else if (status === "no-face") {
            badge.textContent = "未检测到人脸";
            setEye(true, "请正对镜头");
          } else if (status === "closed") {
            setEye(false, "眨到了…");
          } else if (status === "tracking") {
            if (!Blink.isRunning) return;   // 已被封杯流程关闭，状态不再更新
            badge.textContent = Blink.mode === "model" ? "识别中" : "近似模式";
            setEye(true, "眨一下眼封口");
          } else if (status === "denied" || status === "unsupported" || status === "unavailable") {
            badge.textContent = "摄像头不可用";
            btnStart.disabled = false;
            btnStart.textContent = "重试开启摄像头";
            btnStart.classList.remove("hidden");
            setEye(true, "可改用长按封口");
            Game.feedback("info", detail || "摄像头不可用，可按住茶杯封口", 2600);
          }
        },
        onBlink: () => {
          if (phase !== "seal" || sealed) return;
          setEye(false, "眨到了！");
          Sound.play("ding");
          Telemetry.log("blink_detected", { dish: "naicha" });
          if (sealFinish) sealFinish("blink");
        },
      });
      if (!res.ok) {
        btnStart.disabled = false;
        btnStart.textContent = "重试开启摄像头";
        btnStart.classList.remove("hidden");
        if (res.reason === "unsupported") {
          Game.feedback("info", "当前环境不支持摄像头（需在 localhost 或 https 下打开），可改用长按封口", 3400);
        } else if (res.reason === "denied") {
          Game.feedback("info", "摄像头权限被拒绝，可改用长按封口；也可在地址栏权限里重新允许", 3400);
        }
      } else {
        btnStart.disabled = false;
        btnStart.textContent = "重新开启";
      }
    });

    slot.querySelector("#btnCamSkip").addEventListener("click", () => {
      Blink.stop();
      camOpened = false;
      veil.classList.remove("cam-veil-off");
      veil.querySelector(".cam-veil-text").innerHTML = "按住茶杯不松手<br>压满一圈即可封口";
      badge.textContent = "已改用长按";
      Game.setHint("按住茶杯<em>不松手</em>，压紧封口。");
      Game.feedback("info", "改用长按封口：按住茶杯压满一圈", 2400);
    });
  }

  /* ---------- 完成 ---------- */
  function finish() {
    const iced = stage().dataset.iced ? " · 加冰" : "";
    Game.showResult({
      dishName: "奶茶",
      title: "甜度由你调",
      img: dish().img,
      branch: `${tea.name}茶底 · 奶量${milk} · ${sweet}糖${iced}`,
      stars: 5,
      fireText: "无需掌火 · 搅拌封杯一气呵成",
      memoryScent: "茶香 × 奶香",
      extraLines: ["这一杯的甜度，完全由你定义"],
      summary: `你选择了${tea.name}茶底，奶量「${milk}」、${sweet}糖${iced}。<br>顺时针搅拌 2 圈，眨一下眼封杯，出杯！`,
    });
    Telemetry.log("complete", { dish: "naicha", tea: tea.id, milk, sweet });
  }

  return {
    start() {
      tea = null; milk = "标准"; sweet = "五分";
      sealed = false; sealFinish = null; camOpened = false;
      buildStage();
      phaseTea();
    },
    retry() {
      if (phase === "stir") phaseStir();
      else if (phase === "seal") phaseSeal();
      else if (phase === "milk") phaseMilk();
      else phaseTea();
    },
    /* 离开菜品 / 暂停时释放摄像头（隐私：不留后台采集） */
    stop() {
      Blink.stop();
      camOpened = false;
      const badge = stage().querySelector("#camBadge");
      const btn = stage().querySelector("#btnCamStart");
      if (badge) badge.textContent = "摄像头已关闭";
      if (btn) {
        btn.disabled = false;
        btn.textContent = "重新开启摄像头";
        btn.classList.remove("hidden");
      }
    },
  };
})();
