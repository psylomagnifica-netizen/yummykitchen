/* ============================================================
 * zongzi.js — 粽子「咸甜粽选择题」（P0 核心路径，PRD 5.2）
 * 流程：咸/甜分支 → 拖料到粽叶 → 折叠包裹手势（漏米失误）→ 蒸煮计时关火
 * ============================================================ */
"use strict";

Game.runners.zongzi = (() => {
  const dish = () => DISHES.find((d) => d.id === "zongzi");

  let phase = "branch";
  let branch = null;          // { id, name, fillings }
  let placed = [];            // 已放上粽叶的食材
  let foldStep = 0;
  let mistakes = 0;
  let steamAttempts = 0;
  let fb = null;
  let steamTimer = null;

  const stage = () => Game.stage();

  const FOLDS = [
    { dir: "up",    label: "向上折起粽叶", arrow: "↑", pos: { left: "46%", top: "78%" } },
    { dir: "left",  label: "向左折过来",   arrow: "←", pos: { left: "72%", top: "40%" } },
    { dir: "right", label: "向右包住封口", arrow: "→", pos: { left: "18%", top: "40%" } },
  ];

  /* ---------- 舞台搭建 ---------- */
  function buildStage() {
    stage().innerHTML = `
      <div class="wrap-zone" id="wrapZone" style="display:none">
        <img class="leaf-img" id="leafImg" src="${dish().leafImg}" alt="粽叶">
        <div class="on-leaf" id="onLeaf"></div>
        <div class="fold-arrow hidden" id="foldArrow"></div>
      </div>
      <div class="zongzi-done hidden" id="zongziDone">
        <img src="${dish().img}" alt="粽子" style="width:clamp(120px,18vw,200px);border-radius:16px;box-shadow:var(--shadow)">
      </div>
      <div class="steamer-wrap hidden" id="steamerWrap">
        <img src="${dish().steamerImg}" alt="蒸笼">
      </div>
      <div class="prep-board" id="prepBoard" style="display:none"></div>
      <div id="branchOverlay" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:4%;background:rgba(58,44,30,.35);backdrop-filter:blur(3px);z-index:10;padding:5%">
      </div>`;
  }

  /* ---------- 阶段：咸/甜分支选择（PRD F3.1） ---------- */
  function phaseBranch() {
    phase = "branch";
    Game.setSteps(dish().steps, 0, 0);
    Game.setHint(dish().branch.prompt);
    const ov = stage().querySelector("#branchOverlay");
    ov.style.display = "flex";
    ov.innerHTML = "";
    dish().branch.options.forEach((opt) => {
      const card = document.createElement("div");
      card.className = "paper";
      card.style.cssText = "padding:22px 26px;text-align:center;cursor:pointer;max-width:280px;transition:transform .18s";
      card.innerHTML = `
        <div style="font-family:var(--font-title);font-size:24px;color:var(--cinnabar)">${opt.name}</div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:12px">
          ${opt.fillings.map((f) => `<img src="${f.img}" alt="${f.name}" style="width:64px;height:64px;object-fit:contain">`).join("")}
        </div>
        <div style="font-size:12px;color:var(--ink-soft);margin-top:10px">${opt.fillings.map((f) => f.name).join(" + ")}</div>`;
      card.onmouseenter = () => (card.style.transform = "translateY(-5px)");
      card.onmouseleave = () => (card.style.transform = "");
      card.addEventListener("click", () => {
        Sound.play("confirm");
        branch = opt;
        Telemetry.log("select_branch", { dish: "zongzi", branch: opt.id });
        Game.feedback("ok", `选择了${opt.name}`, 1600);
        ov.style.display = "none";
        setTimeout(phasePlace, 500);
      });
      ov.appendChild(card);
    });
  }

  /* ---------- 阶段：放料到粽叶（先糯米后馅料，掉外面会“漏米”） ---------- */
  function phasePlace() {
    phase = "place";
    placed = [];
    Game.setSteps(dish().steps, 1, 1);
    Game.setHint("把<em>糯米</em>和馅料拖到粽叶上。先铺糯米，再放馅料；掉到外面会漏米！");
    stage().querySelector("#wrapZone").style.display = "";
    const board = stage().querySelector("#prepBoard");
    board.style.display = "";
    board.innerHTML = "";
    const all = [...dish().baseIngredients, ...branch.fillings];
    all.forEach((ing) => {
      const el = Game.buildIngredientCard(ing);
      board.appendChild(el);
      Game.makeDraggable(el, {
        // 「一碗糯米」：碗固定不动，只有碗里的米能拖到粽叶上
        handle: ing.bowlImg ? ".combo-pick" : null,
        ghostSrc: ing.bowlImg ? ing.img : null,
        targets: () => [stage().querySelector("#wrapZone")],
        onDrop: () => onPlaced(el, ing),
        onMiss: () => {
          mistakes++;
          Sound.play("warn");
          Game.feedback("bad", "哎呀，漏米了！食材要放在粽叶中间。", 2200);
          Telemetry.log("gesture_fail", { dish: "zongzi", action: "place", item: ing.id });
        },
      });
    });
  }

  function onPlaced(el, ing) {
    if (placed.length === 0 && ing.id !== "zongrice") {
      Game.feedback("info", "先铺一层糯米打底", 1800);
      Sound.play("warn");
      return;
    }
    el.classList.add("used");
    placed.push(ing.id);
    Telemetry.log("gesture_success", { dish: "zongzi", action: "place", item: ing.id });
    Sound.play("drop");
    const holder = stage().querySelector("#onLeaf");
    const im = document.createElement("img");
    im.src = ing.potImg || ing.img;
    im.style.transform = `translate(${(Math.random() * 30 - 15).toFixed(0)}%, ${(Math.random() * 20 - 10).toFixed(0)}%) rotate(${(Math.random() * 24 - 12).toFixed(0)}deg)`;
    holder.appendChild(im);
    if (placed.length === 1) Scent.trigger("leaf", 3, 1); // 粽叶清香
    Game.feedback("ok", `「${ing.name}」放好了`, 1300);

    const total = 1 + branch.fillings.length;
    if (placed.length === total) setTimeout(phaseFold, 700);
  }

  /* ---------- 阶段：折叠包裹手势（3 次定向拖动） ---------- */
  function phaseFold() {
    phase = "fold";
    foldStep = 0;
    Game.setHint("开始包裹：按住粽叶，<em>沿箭头方向拖动</em>，折三下把粽子包紧。");
    stage().querySelector("#prepBoard").style.display = "none";
    showFoldArrow();
  }

  function showFoldArrow() {
    const arrow = stage().querySelector("#foldArrow");
    const fold = FOLDS[foldStep];
    arrow.classList.remove("hidden");
    arrow.textContent = fold.arrow;
    arrow.style.left = fold.pos.left;
    arrow.style.top = fold.pos.top;
    Game.setHint(`包裹第 ${foldStep + 1}/3 折：<em>${fold.label}</em>（按住粽叶往箭头方向拖）`);

    const zone = stage().querySelector("#wrapZone");
    let startX = 0, startY = 0, dragging = false;

    const onDown = (ev) => {
      if (Game.paused) return;
      dragging = true;
      startX = ev.clientX; startY = ev.clientY;
      Telemetry.log("gesture_start", { dish: "zongzi", action: "fold", step: foldStep });
    };
    const onUp = (ev) => {
      if (!dragging) return;
      dragging = false;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const ok =
        (fold.dir === "up" && dy < -50) ||
        (fold.dir === "left" && dx < -50) ||
        (fold.dir === "right" && dx > 50);
      if (ok) {
        Sound.play("fold");
        Sound.play("rustle");
        Telemetry.log("gesture_success", { dish: "zongzi", action: "fold", step: foldStep });
        const leaf = stage().querySelector("#leafImg");
        const holder = stage().querySelector("#onLeaf");
        // 粽叶逐步包拢的视觉
        const scale = [0.86, 0.7, 0.55][foldStep];
        leaf.style.transform = `scale(${scale}) rotate(${(foldStep - 1) * 6}deg)`;
        leaf.style.filter = `brightness(${1 - foldStep * 0.06})`;
        holder.style.transform = `scale(${1 - (foldStep + 1) * 0.22})`;
        holder.style.opacity = String(1 - (foldStep + 1) * 0.3);
        foldStep++;
        zone.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        if (foldStep < FOLDS.length) {
          showFoldArrow();
        } else {
          stage().querySelector("#foldArrow").classList.add("hidden");
          Game.feedback("ok", "包好了！严严实实，不会漏米。", 1800);
          setTimeout(showWrapped, 600);
        }
      } else {
        Sound.play("warn");
        Game.feedback("info", `方向不对，要${fold.label}`, 1600);
      }
    };
    zone.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
  }

  function showWrapped() {
    stage().querySelector("#wrapZone").style.display = "none";
    const done = stage().querySelector("#zongziDone");
    done.classList.remove("hidden");
    Sound.play("success");
    setTimeout(() => {
      done.classList.add("hidden");
      phaseSteam(0);
    }, 1600);
  }

  /* ---------- 阶段：蒸煮计时（PRD 5.2：蒸煮过久状态变化/过火提示） ---------- */
  function phaseSteam(fromValue) {
    phase = "steam";
    Game.setSteps(dish().steps, 2, 2);
    Game.setHint("上笼蒸煮！计时进入<em>绿色区间</em>点击「起锅」：太早夹生，太久过火。");
    Game.unmountFireBar();
    const wrap = stage().querySelector("#steamerWrap");
    wrap.classList.remove("hidden");
    Sound.startLoop("boil");
    Sound.play("steam");
    Sfx.loop("boil");       // 上笼蒸煮的环境声
    Scent.trigger("steamRice", 6, 2);
    if (!steamTimer) steamTimer = setInterval(() => spawnSteam(), 600);

    fb = Game.mountFireBar(
      { duration: 12000, good: [55, 85], labels: ["夹生", "软糯刚好", "过火"], stopText: "起锅！", title: "蒸煮计时" },
      (value, status) => onSteamStop(value, status)
    );
    fb.start(fromValue || 0);
  }

  function spawnSteam() {
    if (Game.paused || phase !== "steam") return;
    const wrap = stage().querySelector("#steamerWrap");
    if (wrap.classList.contains("hidden")) return;
    const p = document.createElement("div");
    p.className = "steam-puff";
    p.style.left = 30 + Math.random() * 40 + "%";
    p.style.top = "0%";
    wrap.appendChild(p);
    setTimeout(() => p.remove(), 2800);
  }

  function stopSteamFx() {
    clearInterval(steamTimer);
    steamTimer = null;
    Sound.stopLoop("boil");
    Sfx.stop("boil");
  }

  function onSteamStop(value, status) {
    if (status === "perfect") {
      stopSteamFx();
      Sound.play("success");
      Game.feedback("ok", "软糯适中，粽香扑鼻！", 0);
      Telemetry.log("fire_judge", { dish: "zongzi", result: "perfect", value });
      setTimeout(finish, 1200);
    } else if (status === "under") {
      // 火候不足：不再重蒸，直接出结果卡，标注「没熟」
      steamAttempts++;
      mistakes++;
      Sound.play("warn");
      Game.feedback("info", "火候没到，糯米还没蒸透……直接起锅看看这锅夹生的样子。", 0);
      Telemetry.log("fire_judge", { dish: "zongzi", result: "under", value });
      setTimeout(() => finish("under"), 1400);
    } else {
      // 火候过头：不再重蒸，直接出结果卡，标注「焦了」
      steamAttempts++;
      mistakes++;
      stopSteamFx();
      Sound.play("fail");
      Scent.trigger("over", 2.5, 1);   // 低强度过火提示（PRD F6.3）
      Game.feedback("bad", "蒸过头了，粽叶发黄、米有点干……直接起锅看看这锅蒸过头的样子。", 0);
      Telemetry.log("fire_judge", { dish: "zongzi", result: "over", value });
      setTimeout(() => finish("over"), 1500);
    }
  }

  /* ---------- 完成 ---------- */
  function finish(outcome = "perfect") {
    Scent.stop();
    Sfx.stop("boil");
    const stars = outcome === "perfect" ? Math.max(2, 5 - mistakes) : 1;
    const fireText = outcome === "perfect"
      ? (steamAttempts === 0
        ? "一次起锅，软糯刚好"
        : `调整 ${steamAttempts} 次后恰到好处`)
      : (outcome === "under" ? "火候不足，糯米没蒸熟" : "火候过头，粽叶发黄干硬");
    const extra = [`你是${branch && branch.id === "salty" ? "咸粽党" : "甜粽党"}——甜咸之争，用味道表态`];
    if (outcome !== "perfect") {
      extra.push(outcome === "under" ? "失误记录：火候未到就起锅，米还是夹生的" : "失误记录：火候过头，粽叶发黄、米有点干");
    }
    Game.setSteps(dish().steps, 3, 3);
    Game.showResult({
      dishName: "粽子",
      title: "咸甜粽选择题",
      img: dish().img,
      branch: branch ? branch.name : "经典粽",
      stars,
      fireText,
      memoryScent: outcome === "over" ? "焦糊味（短时低强度模拟）" : "粽叶清香 × 糯米蒸煮香",
      extraLines: extra,
      summary: outcome === "perfect"
        ? `你选择了「${branch ? branch.name : ""}」，完成包裹三折与蒸煮掌控。<br>${fireText}。`
        : (outcome === "under"
          ? `你选择了「${branch ? branch.name : ""}」，包裹三折完成，但火候没到就起锅了。<br>糯米还夹生，这锅粽子上桌得再蒸一会儿。`
          : `你选择了「${branch ? branch.name : ""}」，包裹三折完成，但火候过了才起锅。<br>粽叶发黄、米有点干，这锅粽子有点过头了。`),
      outcome,
    });
    Telemetry.log("complete", { dish: "zongzi", branch: branch && branch.id, mistakes, steamAttempts, outcome });
  }

  /* ---------- 对外接口 ---------- */
  return {
    start() {
      branch = null;
      placed = [];
      foldStep = 0;
      mistakes = 0;
      steamAttempts = 0;
      stopSteamFx();
      buildStage();
      phaseBranch();
    },
    retry() {
      if (phase === "steam") { stopSteamFx(); phaseSteam(0); }
      else if (phase === "fold") { phaseFold(); }
      else if (phase === "place") { phasePlace(); }
      else { phaseBranch(); }
    },
  };
})();
