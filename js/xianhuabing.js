/* ============================================================
 * xianhuabing.js — 鲜花饼「烤到花香刚刚好」（PRD 5.6）
 * 流程：选花馅+饼皮厚度 → 包馅整形（拖馅+两折+轻压）→ 推入烤箱 → 烘烤阈值条
 * ============================================================ */
"use strict";

Game.runners.xianhuabing = (() => {
  const dish = () => DISHES.find((d) => d.id === "xianhuabing");

  let phase = "filling";
  let crust = "适中";
  let hasFilling = false;
  let foldStep = 0;          // 0/1 = 两折；2 = 轻压
  let pressed = false;
  let mistakes = 0;
  let attempts = 0;
  let fb = null;
  let camOn = false;         // 摄像头是否已开启
  let pressBy = null;        // "hands" | "hold"：本次定形是靠哪种方式完成的
  let pressFinish = null;    // 供摄像头回调触发的完成函数
  let pressRingApi = null;   // 进度环控制（show / set）

  const stage = () => Game.stage();

  const FOLDS = [
    { dir: "up",   label: "向上折起饼皮", arrow: "↑", pos: { left: "44%", top: "70%" } },
    { dir: "left", label: "向左折过来",   arrow: "←", pos: { left: "66%", top: "30%" } },
  ];

  function buildStage() {
    stage().classList.remove("phase-press");
    stage().innerHTML = `
      <div class="board-zone" id="boardZone" style="display:none">
        <img class="board-img" src="${dish().boardImg}" alt="案板">
        <div class="dough-wrap" id="doughWrap">
          <img class="dough-img" id="doughImg" src="${dish().doughImg}" alt="面团">
          <div class="on-dough" id="onDough"></div>
          <div class="fold-arrow hidden" id="foldArrow"></div>
          <svg class="press-ring hidden" id="pressRing" viewBox="0 0 46 46">
            <circle cx="23" cy="23" r="20" fill="none" stroke="rgba(255,250,240,.45)" stroke-width="4"/>
            <circle id="pressRingFg" cx="23" cy="23" r="20" fill="none" stroke="#e6b655" stroke-width="4"
                    stroke-linecap="round" stroke-dasharray="125.6" stroke-dashoffset="125.6" transform="rotate(-90 23 23)"/>
          </svg>
        </div>
      </div>
      <div class="oven hidden" id="oven">
        <div class="oven-window" id="ovenWindow"></div>
        <div class="oven-lamp"></div>
      </div>
      <div class="prep-board" id="prepBoard" style="display:none"></div>
      <div id="choiceSlot"></div>`;
  }

  /* ---------- 阶段 1：选花馅与饼皮厚度 ---------- */
  function phaseFilling() {
    phase = "filling";
    Game.setSteps(dish().steps, 0, 0);
    Game.setHint("今天做<em>玫瑰鲜花饼</em>。选个饼皮厚度，决定了口感。");
    Scent.trigger("floral", 3, 1);   // 开场短暂淡花香提示
    stage().querySelector("#choiceSlot").innerHTML = `
      <div class="choice-overlay">
        <div class="choice-title">玫瑰馅 · 饼皮多厚？</div>
        <div class="choice-panel" style="text-align:center">
          <img src="assets/ing/鲜花饼_玫瑰花瓣.png?v=5" alt="玫瑰花瓣" style="width:84px;height:64px;object-fit:contain">
          <div class="seg-row" style="justify-content:center"><span class="seg-label">饼皮</span>
            ${["薄", "适中", "厚"].map((c) => `<button class="seg-btn ${c === crust ? "selected" : ""}" data-crust="${c}">${c}${c === "薄" ? " · 酥" : c === "厚" ? " · 软" : ""}</button>`).join("")}
          </div>
          <button class="btn btn-primary" id="btn-crust-ok" style="margin-top:8px">开始包饼</button>
        </div>
      </div>`;
    const slot = stage().querySelector("#choiceSlot");
    slot.querySelectorAll("[data-crust]").forEach((b) => b.addEventListener("click", () => {
      crust = b.dataset.crust; Sound.play("click");
      slot.querySelectorAll("[data-crust]").forEach((x) => x.classList.toggle("selected", x === b));
    }));
    slot.querySelector("#btn-crust-ok").addEventListener("click", () => {
      Sound.play("confirm");
      Telemetry.log("select_branch", { dish: "xianhuabing", filling: "rose", crust });
      slot.innerHTML = "";
      setTimeout(phaseWrap, 400);
    });
  }

  /* ---------- 阶段 2：包馅整形 ---------- */
  function phaseWrap() {
    phase = "wrap";
    Hands.stop();            // 重进阶段时先释放可能残留的摄像头
    camOn = false;
    pressFinish = null;
    pressRingApi = null;
    pressBy = null;
    hasFilling = false;
    foldStep = 0;
    pressed = false;
    Game.setSteps(dish().steps, 1, 1);
    Game.setHint("先把<em>玫瑰花瓣馅</em>拖到面团上。");
    stage().querySelector("#boardZone").style.display = "";
    const board = stage().querySelector("#prepBoard");
    board.style.display = "";
    board.innerHTML = `
      <div class="ing-item next" id="roseItem">
        <img src="assets/ing/鲜花饼_玫瑰花瓣.png?v=5" alt="玫瑰花瓣"><div class="ing-name">玫瑰馅</div>
      </div>`;
    Game.makeDraggable(stage().querySelector("#roseItem"), {
      targets: () => [stage().querySelector("#boardZone")],
      onDrop: (el) => {
        el.classList.add("used");
        hasFilling = true;
        Sound.play("drop");
        const holder = stage().querySelector("#onDough");
        const im = document.createElement("img");
        im.src = "assets/ing/鲜花饼_玫瑰花瓣.png?v=5";
        holder.appendChild(im);
        Game.feedback("ok", "馅料放好，开始包！", 1400);
        Telemetry.log("gesture_success", { dish: "xianhuabing", action: "fill" });
        setTimeout(showFold, 600);
      },
      onMiss: () => {
        mistakes++;
        Sound.play("warn");
        Game.feedback("info", "馅料要放在面团中间", 1600);
      },
    });
  }

  function showFold() {
    if (foldStep < FOLDS.length) {
      const fold = FOLDS[foldStep];
      Game.setHint(`包饼第 ${foldStep + 1}/2 折：<em>${fold.label}</em>（按住面团往箭头方向拖）`);
      const arrow = stage().querySelector("#foldArrow");
      arrow.classList.remove("hidden");
      arrow.textContent = fold.arrow;
      arrow.style.left = fold.pos.left;
      arrow.style.top = fold.pos.top;
      bindFoldDrag(fold);
    } else {
      stage().querySelector("#foldArrow").classList.add("hidden");
      phasePress();
    }
  }

  function bindFoldDrag(fold) {
    const zone = stage().querySelector("#doughWrap");
    let sx = 0, sy = 0, dragging = false;
    const onDown = (ev) => {
      if (Game.paused) return;
      dragging = true; sx = ev.clientX; sy = ev.clientY;
      Telemetry.log("gesture_start", { dish: "xianhuabing", action: "fold", step: foldStep });
    };
    const onUp = (ev) => {
      if (!dragging) return;
      dragging = false;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      const ok = (fold.dir === "up" && dy < -50) || (fold.dir === "left" && dx < -50);
      zone.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      if (ok) {
        Sound.play("fold");
        Sound.play("rustle");
        const dough = stage().querySelector("#doughImg");
        dough.style.transform = `scale(${[0.85, 0.7][foldStep]}) rotate(${foldStep * -6}deg)`;
        const holder = stage().querySelector("#onDough");
        holder.style.transform = `scale(${1 - (foldStep + 1) * 0.3})`;
        holder.style.opacity = String(1 - (foldStep + 1) * 0.45);
        foldStep++;
        Telemetry.log("gesture_success", { dish: "xianhuabing", action: "fold", step: foldStep });
        showFold();
      } else {
        Sound.play("warn");
        Game.feedback("info", `方向不对，要${fold.label}`, 1500);
        showFold();
      }
    };
    zone.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
  }

  /* ---------- 轻压定型（摄像头「双手合十」为主路径，长按为降级路径） ---------- */
  function phasePress() {
    phase = "press";
    pressed = false;
    pressBy = null;
    Game.setHint("最后一步：<em>双手合十</em>对着摄像头轻压定型，或<em>按住面团</em>长按。");
    const zone = stage().querySelector("#doughWrap");
    const ring = stage().querySelector("#pressRing");
    const ringFg = stage().querySelector("#pressRingFg");
    let raf = null;
    let startAt = 0;
    let ringOwner = null;            // "hold" | "cam"：进度环当前由谁驱动
    const HOLD = 600;

    buildPressPanel();
    stage().classList.add("phase-press");   // 窄屏下据此给摄像头面板让位

    /* ---------- 进度环 ---------- */
    const showRing = (owner) => {
      ringOwner = owner;
      ring.classList.remove("hidden");
    };
    const setRing = (p) => {
      ringFg.style.strokeDashoffset = (125.6 * (1 - Math.max(0, Math.min(1, p)))).toFixed(1);
    };
    const clearHold = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      if (ringOwner === "hold") {
        ring.classList.add("hidden");
        setRing(0);
        ringOwner = null;
      }
    };

    /* ---------- 降级路径：按住面团长按 600ms ---------- */
    const onDown = (ev) => {
      if (Game.paused || pressed) return;
      ev.preventDefault();
      startAt = performance.now();
      showRing("hold");
      const tick = () => {
        if (Game.paused || pressed) { clearHold(); return; }
        const p = Math.min(1, (performance.now() - startAt) / HOLD);
        setRing(p);
        if (p >= 1) { finishPress("hold"); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const onUp = () => {
      if (!pressed && raf) Game.feedback("info", "还没压满，再按住久一点", 1400);
      clearHold();
    };
    zone.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    /* ---------- 完成 ---------- */
    function finishPress(by) {
      if (pressed) return;
      pressed = true;
      pressBy = by;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      ring.classList.add("hidden");
      zone.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      Hands.stop();                   // 定形完成立刻关闭摄像头
      camOn = false;
      stage().querySelector("#doughImg").style.transform = "scale(.76,.62)";
      Sound.play("fold");
      Sound.play("success");
      Telemetry.log("gesture_success", { dish: "xianhuabing", action: "press", by });
      Game.feedback("ok", by === "hands" ? "合十压住了！饼胚成型" : "饼胚成型！接下来进烤箱", 1600);
      setTimeout(phaseOven, 900);
    }

    /* ---------- 摄像头路径：双手合十 ---------- */
    pressFinish = finishPress;
    pressRingApi = { show: showRing, set: setRing };
  }

  /* ---------- 摄像头面板（双手合十） ---------- */
  function buildPressPanel() {
    const slot = stage().querySelector("#choiceSlot");
    slot.innerHTML = `
      <div class="cam-overlay">
        <div class="cam-panel" id="camPanel">
          <div class="cam-head">
            <span class="cam-title">双手合十</span>
            <span class="cam-badge" id="camBadge">摄像头未开启</span>
          </div>
          <div class="cam-view">
            <video id="camVideo" playsinline muted></video>
            <canvas id="camOverlay"></canvas>
            <div class="cam-veil" id="camVeil">
              <div class="cam-veil-eye">合十</div>
              <div class="cam-veil-text">开启摄像头后<br>把两只手合到一起</div>
            </div>
          </div>
          <div class="cam-hand-row" id="camHandRow">
            <span class="gh gh-l"><i></i><i></i><i></i><i></i><b></b></span>
            <span class="gh gh-r"><i></i><i></i><i></i><i></i><b></b></span>
            <span id="camHandText">等待摄像头</span>
          </div>
          <div class="cam-actions">
            <button class="btn btn-primary btn-sm" id="btnCamStart">开启摄像头</button>
            <button class="btn btn-ghost btn-sm" id="btnCamSkip">改用长按轻压</button>
          </div>
          <p class="cam-privacy">画面只在本机实时识别，不上传、不录制、不保存</p>
        </div>
      </div>`;

    const badge = slot.querySelector("#camBadge");
    const veil = slot.querySelector("#camVeil");
    const handRow = slot.querySelector("#camHandRow");
    const handText = slot.querySelector("#camHandText");
    const btnStart = slot.querySelector("#btnCamStart");
    const btnSkip = slot.querySelector("#btnCamSkip");

    /* 手势文字与图形提示 */
    const setHand = (state, text) => {
      handRow.classList.toggle("on", state === "on");
      handRow.classList.toggle("near", state === "near");
      if (text) handText.textContent = text;
    };

    btnStart.addEventListener("click", async () => {
      btnStart.disabled = true;
      btnStart.textContent = "启动中…";
      const res = await Hands.start({
        video: slot.querySelector("#camVideo"),
        overlay: slot.querySelector("#camOverlay"),
        onStatus: (status, detail, info) => {
          if (status === "requesting") { badge.textContent = "请求权限…"; setHand("idle", "等待授权"); }
          else if (status === "loading") { badge.textContent = "加载模型…"; setHand("idle", "加载识别模型"); }
          else if (status === "ready") {
            camOn = true;
            veil.classList.add("cam-veil-off");
            badge.textContent = "识别中";
            btnStart.classList.add("hidden");
            setHand("idle", "把双手合到一起");
            Game.feedback("info", "摄像头已开启，把两只手合在一起", 2400);
            Telemetry.log("camera_start", { dish: "xianhuabing", mode: Hands.mode });
          } else if (status === "no-hand") {
            if (!Hands.isRunning) return;
            badge.textContent = "未检测到手";
            setHand("idle", "把手抬进画面");
          } else if (status === "one-hand") {
            if (!Hands.isRunning) return;
            badge.textContent = "只看到一只手";
            setHand("idle", "还要另一只手");
          } else if (status === "two-hand") {
            if (!Hands.isRunning) return;
            badge.textContent = "识别中";
            setHand("near", "两只手还没合到一起");
          } else if (status === "prayer") {
            if (!Hands.isRunning) return;
            badge.textContent = "合十了";
            setHand("on", "合十了，别动");
            if (pressRingApi) {
              pressRingApi.show("cam");
              pressRingApi.set(info.progress || 0);
            }
            Game.setHint("合十了，保持住…… <em>轻压定型中</em>");
          } else if (status === "stopped") {
            camOn = false;
          } else if (status === "denied" || status === "unsupported" || status === "unavailable" || status === "failed") {
            camOn = false;
            // 不同失败原因给不同的徽章文案，别一律显示「摄像头不可用」
            badge.textContent = status === "failed" ? "识别模型不可用"
              : status === "denied" ? "权限被拒绝"
              : status === "unsupported" ? "不支持摄像头"
              : "摄像头不可用";
            btnStart.disabled = false;
            btnStart.textContent = "重试开启摄像头";
            btnStart.classList.remove("hidden");
            setHand("idle", "可改用长按轻压");
            Game.feedback("info", (detail || "摄像头不可用") + "，可改用长按轻压", 3200);
          }
        },
        onPress: () => {
          if (phase !== "press" || pressed) return;
          Sound.play("ding");
          Telemetry.log("gesture_detected", { dish: "xianhuabing", gesture: "palms_together" });
          if (pressFinish) pressFinish("hands");
        },
      });
      if (!res.ok) {
        btnStart.disabled = false;
        btnStart.textContent = "重试开启摄像头";
        btnStart.classList.remove("hidden");
        if (res.reason === "unsupported") {
          Game.feedback("info", "当前环境不支持摄像头（需在 localhost 或 https 下打开），可改用长按轻压", 3400);
        } else if (res.reason === "denied") {
          Game.feedback("info", "摄像头权限被拒绝，可改用长按轻压", 3000);
        } else if (res.reason === "model") {
          Game.feedback("info", (res.detail || "识别模型加载失败") + "，可改用长按轻压", 3600);
        }
      }
    });

    btnSkip.addEventListener("click", () => {
      Hands.stop();
      camOn = false;
      slot.innerHTML = "";
      Game.setHint("按住<em>面团</em>轻压定型，压满一圈就好。");
      Game.feedback("info", "改用长按轻压：按住面团别松手", 2400);
      Telemetry.log("camera_skip", { dish: "xianhuabing" });
    });
  }

  /* ---------- 阶段 3：推入烤箱 ---------- */
  function phaseOven() {
    phase = "oven";
    Hands.stop();            // 离开定形阶段，确保摄像头轨道被释放
    camOn = false;
    pressFinish = null;
    pressRingApi = null;
    Game.setSteps(dish().steps, 2, 2);
    Game.setHint("把饼胚<em>拖进烤箱</em>，准备烘烤。");
    const oven = stage().querySelector("#oven");
    oven.classList.remove("hidden");
    const zone = stage().querySelector("#doughWrap");
    zone.style.cursor = "grab";
    Game.makeDraggable(zone, {
      targets: () => [oven],
      onDrop: () => {
        Sound.play("drop");
        Sound.play("ding");
        stage().querySelector("#boardZone").style.display = "none";
        oven.classList.add("on");
        const win = stage().querySelector("#ovenWindow");
        win.innerHTML = `<img id="bakingImg" src="${dish().doughImg}" alt="烘烤中的鲜花饼">`;
        Scent.trigger("bake", 4, 1);
        Game.feedback("ok", "烤箱灯亮了，开始烘烤", 1600);
        Telemetry.log("gesture_success", { dish: "xianhuabing", action: "oven" });
        setTimeout(() => phaseBake(0), 900);
      },
      onMiss: () => Game.feedback("info", "推进右上角的烤箱里", 1500),
    });
  }

  /* ---------- 阶段 4：烘烤阈值条（上色 / 过火低强度焦糊） ---------- */
  function phaseBake(fromValue) {
    phase = "bake";
    Game.setSteps(dish().steps, 3, 3);
    Game.setHint("盯住饼面上色：进入<em>绿色区间</em>点击「出炉」。金黄刚好，过深就糊了！");
    Game.unmountFireBar();
    const img = stage().querySelector("#bakingImg");
    fb = Game.mountFireBar(
      { duration: 11000, good: [55, 85], labels: ["没烤透", "金黄刚好", "烤糊了"], stopText: "出炉！", title: "烘烤" },
      (value, status) => onBakeStop(value, status)
    );
    fb.onTick = (v) => {
      const t = Math.min(1, v / 100);
      // 上色：明亮 → 金黄 → 深褐
      img.style.filter = `sepia(${t * 0.7}) saturate(${1 + t * 0.6}) brightness(${1.05 - t * 0.45})`;
    };
    fb.start(fromValue || 0);
  }

  function onBakeStop(value, status) {
    const img = stage().querySelector("#bakingImg");
    if (status === "perfect") {
      Sound.play("success");
      Scent.trigger("bake", 3, 2);
      Game.feedback("ok", "金黄酥香，花香与烘焙香正好！", 0);
      Telemetry.log("fire_judge", { dish: "xianhuabing", result: "perfect", value });
      setTimeout(finish, 1100);
    } else if (status === "under") {
      // 火候不足：不再复烤，直接出结果卡，标注「没熟」
      attempts++;
      mistakes++;
      Sound.play("warn");
      Game.feedback("info", "火候没到，饼面还是白的……直接出炉看看这夹生的样子。", 0);
      Telemetry.log("fire_judge", { dish: "xianhuabing", result: "under", value });
      setTimeout(() => finish("under"), 1300);
    } else {
      // 火候过头：不再复烤，直接出结果卡，标注「焦了」
      attempts++;
      mistakes++;
      Sound.play("fail");
      img.style.filter = "brightness(.4) sepia(.6)";
      Scent.trigger("burnt", 2.5, 1);   // 低强度短时焦糊
      Game.feedback("bad", "火候过了，饼面已经烤糊……直接出炉看看这烤焦的样子。", 0);
      Telemetry.log("fire_judge", { dish: "xianhuabing", result: "over", value });
      setTimeout(() => finish("over"), 1400);
    }
  }

  function finish(outcome = "perfect") {
    Scent.stop();
    const stars = outcome === "perfect" ? Math.max(2, 5 - mistakes) : 1;
    const fireText = outcome === "perfect"
      ? (attempts === 0 ? "一炉金黄，火候正好" : `调整 ${attempts} 次后恰到好处`)
      : (outcome === "under" ? "火候不足，饼皮没烤透" : "火候过头，饼皮烤糊了");
    const extra = [`${crust}饼皮的玫瑰鲜花饼，酥香出炉`];
    if (pressBy === "hands") extra.push("定形手法：对着摄像头双手合十，把饼胚压出酥皮");
    else if (pressBy === "hold") extra.push("定形手法：按住面团一点点压出酥皮");
    if (outcome !== "perfect") {
      extra.push(outcome === "under" ? "失误记录：火候未到就出炉，饼面还是发白" : "失误记录：火候过头，饼面烤得发黑发苦");
    }
    Game.showResult({
      dishName: "鲜花饼",
      title: "烤到花香刚刚好",
      img: dish().img,
      branch: `玫瑰馅 · ${crust}饼皮`,
      stars,
      fireText,
      memoryScent: outcome === "over" ? "焦糊味（短时低强度模拟）" : "花香 × 烘焙香",
      extraLines: extra,
      summary: outcome === "perfect"
        ? `玫瑰馅配${crust}饼皮，两折一压包成型。<br>${attempts === 0 ? "一炉烤到金黄刚好" : `调整 ${attempts} 次后烤到金黄`}，花香四溢。`
        : (outcome === "under"
          ? `玫瑰馅配${crust}饼皮，两折一压包成型。<br>但火候没到就出炉了，饼面还是白的——这炉得再烤一会儿。`
          : `玫瑰馅配${crust}饼皮，两折一压包成型。<br>火候过了才出炉，饼面已经烤得发黑发苦，这炉废了。`),
      outcome,
    });
    Telemetry.log("complete", { dish: "xianhuabing", crust, attempts, outcome });
  }

  return {
    start() {
      crust = "适中";
      hasFilling = false;
      foldStep = 0; pressed = false;
      mistakes = 0; attempts = 0;
      pressBy = null; pressFinish = null; pressRingApi = null;
      buildStage();
      phaseFilling();
    },
    retry() {
      if (phase === "bake") phaseBake(0);
      else if (phase === "oven") phaseOven();
      else if (phase === "wrap" || phase === "press") phaseWrap();
      else phaseFilling();
    },
    /* 离开菜品 / 暂停时释放摄像头（隐私：不留后台采集） */
    stop() {
      Hands.stop();
      camOn = false;
      pressFinish = null;
      pressRingApi = null;
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
