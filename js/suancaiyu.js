/* ============================================================
 * suancaiyu.js — 酸菜鱼「酸爽值正在加载」（PRD 5.5）
 * 流程：酸度/辣度/花椒分支 → 拖料备汤底 → 轻推鱼片 → 火候条
 * 边界：不以气味模拟酸味，不以气味作鱼片熟度检测（熟度由视觉呈现）。
 * ============================================================ */
"use strict";

Game.runners.suancaiyu = (() => {
  const dish = () => DISHES.find((d) => d.id === "suancaiyu");

  let phase = "taste";
  let sour = "标准";
  let spicy = "微辣";
  let huajiao = false;
  let basePlaced = [];      // 汤底配料
  let fishCount = 0;        // 已下鱼片（共 3 片）
  let mistakes = 0;
  let attempts = 0;
  let fb = null;
  let steamTimer = null;

  const stage = () => Game.stage();
  const BASE_ITEMS = [
    { id: "pickle", name: "酸菜", img: "assets/ing/酸菜鱼_酸菜.png?v=5", potImg: "assets/ing/酸菜鱼_酸菜_散.png?v=5" },
    { id: "ginger", name: "姜片", img: "assets/ing/酸菜鱼_姜片.png?v=5" },
    { id: "scallion", name: "葱段", img: "assets/ing/酸菜鱼_葱段.png?v=5" },
  ];

  function buildStage() {
    stage().innerHTML = `
      <div class="wok-zone pot-style" id="potZone">
        <img class="wok-img" id="potImg" src="assets/tool/wok.png?v=5" alt="汤锅">
        <div class="broth" id="broth" style="background:rgba(238,214,152,.92)"></div>
      </div>
      <div class="prep-board" id="prepBoard" style="display:none"></div>
      <div id="choiceSlot"></div>`;
  }

  /* ---------- 阶段 1：口味分支 ---------- */
  function phaseTaste() {
    phase = "taste";
    Game.setSteps(dish().steps, 0, 0);
    Game.setHint("先调口味：<em>酸度、辣度</em>，要不要来点花椒？");
    stage().querySelector("#choiceSlot").innerHTML = `
      <div class="choice-overlay">
        <div class="choice-title">酸爽值自定义</div>
        <div class="choice-panel">
          <div class="seg-row"><span class="seg-label">酸度</span>
            ${["微酸", "标准", "特酸"].map((s) => `<button class="seg-btn ${s === sour ? "selected" : ""}" data-sour="${s}">${s}</button>`).join("")}
          </div>
          <div class="seg-row"><span class="seg-label">辣度</span>
            ${["不辣", "微辣", "重辣"].map((s) => `<button class="seg-btn ${s === spicy ? "selected" : ""}" data-spicy="${s}">${s}</button>`).join("")}
          </div>
          <div class="seg-row"><span class="seg-label">花椒</span>
            <button class="seg-btn ${huajiao ? "selected" : ""}" id="btn-huajiao">${huajiao ? "加花椒 ✓" : "不加"}</button>
            <img src="assets/ing/酸菜鱼_花椒.png?v=5" alt="花椒" style="width:34px;height:34px;object-fit:contain">
          </div>
          <button class="btn btn-primary" id="btn-taste-ok" style="margin-top:6px">就这么吃</button>
        </div>
      </div>`;
    const slot = stage().querySelector("#choiceSlot");
    slot.querySelectorAll("[data-sour]").forEach((b) => b.addEventListener("click", () => {
      sour = b.dataset.sour; Sound.play("click");
      slot.querySelectorAll("[data-sour]").forEach((x) => x.classList.toggle("selected", x === b));
    }));
    slot.querySelectorAll("[data-spicy]").forEach((b) => b.addEventListener("click", () => {
      spicy = b.dataset.spicy; Sound.play("click");
      slot.querySelectorAll("[data-spicy]").forEach((x) => x.classList.toggle("selected", x === b));
    }));
    slot.querySelector("#btn-huajiao").addEventListener("click", () => {
      huajiao = !huajiao; Sound.play("click");
      const b = slot.querySelector("#btn-huajiao");
      b.textContent = huajiao ? "加花椒 ✓" : "不加";
      b.classList.toggle("selected", huajiao);
    });
    slot.querySelector("#btn-taste-ok").addEventListener("click", () => {
      Sound.play("confirm");
      Telemetry.log("select_branch", { dish: "suancaiyu", sour, spicy, huajiao });
      slot.innerHTML = "";
      Game.feedback("ok", `${sour} · ${spicy}${huajiao ? " · 加花椒" : ""}，本局香气路线已定`, 2000);
      setTimeout(phaseBase, 600);
    });
  }

  /* ---------- 阶段 2：备酸菜汤底 ---------- */
  function phaseBase() {
    phase = "base";
    basePlaced = [];
    Game.setSteps(dish().steps, 1, 1);
    Game.setHint("把<em>酸菜、姜片、葱段</em>拖进锅里，炒出汤底香气。");
    const board = stage().querySelector("#prepBoard");
    board.style.display = "";
    board.innerHTML = "";
    BASE_ITEMS.forEach((ing) => {
      const el = document.createElement("div");
      el.className = "ing-item next";
      el.innerHTML = `<img src="${ing.img}" alt="${ing.name}"><div class="ing-name">${ing.name}</div>`;
      board.appendChild(el);
      Game.makeDraggable(el, {
        targets: () => [stage().querySelector("#potZone")],
        onDrop: () => {
          el.classList.add("used");
          el.classList.remove("next");
          basePlaced.push(ing.id);
          Sound.play("drop");
          Sfx.play("drop");        // 拖一个进锅响一次
          Scent.trigger("allium", 3, 2);
          const b = stage().querySelector("#broth");
          b.style.background = "#d9b25f";   // 金黄酸汤
          b.classList.add("bubbling");
          const im = document.createElement("img");
          im.src = ing.potImg || ing.img;
          im.style.transform = `translate(${(Math.random() * 40 - 20).toFixed(0)}%, ${(Math.random() * 26 - 13).toFixed(0)}%) rotate(${(Math.random() * 40 - 20).toFixed(0)}deg)`;
          b.appendChild(im);
          Game.feedback("ok", `「${ing.name}」入锅，汤色渐黄`, 1400);
          Telemetry.log("gesture_success", { dish: "suancaiyu", action: "base", item: ing.id });
          if (basePlaced.length === BASE_ITEMS.length) setTimeout(phaseFish, 800);
        },
        onMiss: () => Game.feedback("info", "放进汤锅里哦", 1500),
      });
    });
    Sound.startLoop("boil");
    Sfx.loop("boil");        // 酸汤开煮的环境声
  }

  /* ---------- 阶段 3：轻推鱼片（3 片） ---------- */
  function phaseFish() {
    phase = "fish";
    fishCount = 0;
    Game.setSteps(dish().steps, 2, 2);
    Game.setHint("汤底好了！把<em>鱼片轻轻拖进汤里</em>，一片一片来（共 3 片）。");
    const board = stage().querySelector("#prepBoard");
    board.innerHTML = "";
    const el = document.createElement("div");
    el.className = "ing-item next";
    el.id = "fishItem";
    el.innerHTML = `<img src="assets/ing/酸菜鱼_鱼片.png?v=5" alt="鱼片"><div class="ing-name">鱼片 <span id="fishLeft">3</span> 片</div>`;
    board.appendChild(el);
    Game.makeDraggable(el, {
      targets: () => [stage().querySelector("#potZone")],
      onDrop: onFishDropped,
      onMiss: () => Game.feedback("info", "鱼片要滑进汤里", 1500),
    });
  }

  function onFishDropped(el) {
    fishCount++;
    Sound.play("pour");
    Sfx.play("drop");            // 鱼片滑进汤里也响一次
    Scent.trigger("soup", 2.5, 1);   // 热汤香气
    const b = stage().querySelector("#broth");
    const im = document.createElement("img");
    im.src = "assets/ing/酸菜鱼_鱼片.png?v=5";
    im.className = "fish-slice";
    im.style.transform = `translate(${(Math.random() * 46 - 23).toFixed(0)}%, ${(Math.random() * 26 - 13).toFixed(0)}%) rotate(${(Math.random() * 60 - 30).toFixed(0)}deg)`;
    b.appendChild(im);
    Telemetry.log("gesture_success", { dish: "suancaiyu", action: "fish", count: fishCount });
    Game.feedback("ok", `第 ${fishCount} 片鱼片滑入汤中`, 1200);
    if (fishCount >= 3) {
      el.classList.add("used");
      setTimeout(phaseFire, 900);
    } else {
      el.querySelector("#fishLeft").textContent = 3 - fishCount;
    }
  }

  /* ---------- 阶段 4：火候（鱼片由半透明转熟成） ---------- */
  function phaseFire(fromValue = 0) {
    phase = "fire";
    Game.setSteps(dish().steps, 3, 3);
    Game.setHint("看鱼片状态掌火：进入<em>绿色区间</em>点击「出锅」。鱼片变白变实就是熟了！");
    Game.unmountFireBar();
    const b = stage().querySelector("#broth");
    b.style.filter = "";
    if (!steamTimer) steamTimer = setInterval(spawnSteam, 650);
    fb = Game.mountFireBar(
      { duration: 10000, good: [60, 85], labels: ["未熟", "鲜嫩刚好", "煮老了"], stopText: "出锅！", title: "火候" },
      (value, status) => onFireStop(value, status)
    );
    fb.onTick = (v) => {
      // 熟度以视觉呈现：半透明 → 熟成（不作气味检测）
      const t = Math.min(1, v / 70);
      b.querySelectorAll(".fish-slice").forEach((f) => {
        f.style.opacity = String(0.65 + t * 0.35);
        f.style.filter = `brightness(${1.35 - t * 0.35}) drop-shadow(0 2px 4px rgba(0,0,0,.3))`;
      });
      if (v > 85) b.style.filter = "brightness(.82)";
    };
    fb.start(fromValue);
  }

  function spawnSteam() {
    if (Game.paused || phase !== "fire") return;
    const pot = stage().querySelector("#potZone");
    const p = document.createElement("div");
    p.className = "steam-puff";
    p.style.left = 30 + Math.random() * 40 + "%";
    p.style.top = "0%";
    pot.appendChild(p);
    setTimeout(() => p.remove(), 2800);
  }

  function stopSteam() { clearInterval(steamTimer); steamTimer = null; }

  function onFireStop(value, status) {
    if (status === "perfect") {
      stopSteam();
      Sound.stopAllLoops();
      Sound.play("success");
      Game.feedback("ok", "鱼片鲜嫩、酸汤开胃，出锅！", 0);
      Telemetry.log("fire_judge", { dish: "suancaiyu", result: "perfect", value });
      setTimeout(finish, 1100);
    } else if (status === "under") {
      // 火候不足：不再重煮，直接出结果卡，标注「没熟」
      attempts++;
      mistakes++;
      Sound.play("warn");
      Game.feedback("info", "火候没到，鱼片还半透明……直接出锅看看这锅夹生的样子。", 0);
      Telemetry.log("fire_judge", { dish: "suancaiyu", result: "under", value });
      setTimeout(() => finish("under"), 1300);
    } else {
      // 火候过头：不再重煮，直接出结果卡，标注「过了」
      attempts++;
      mistakes++;
      stopSteam();
      Sound.play("fail");
      stage().querySelector("#broth").style.filter = "brightness(.65)";
      Game.feedback("bad", "煮过头了，鱼片都散了……直接出锅看看这锅煮过头的样子。", 0);
      Telemetry.log("fire_judge", { dish: "suancaiyu", result: "over", value });
      setTimeout(() => finish("over"), 1400);
    }
  }

  function finish(outcome = "perfect") {
    Scent.stop();
    Sfx.stop("boil");
    const stars = outcome === "perfect" ? Math.max(2, 5 - mistakes) : 1;
    const route = `${sour} · ${spicy}${huajiao ? " · 加花椒" : ""}`;
    const fireText = outcome === "perfect"
      ? (attempts === 0 ? "一次出锅，鱼片鲜嫩" : `调整 ${attempts} 次后恰到好处`)
      : (outcome === "under" ? "火候不足，鱼片没煮熟" : "火候过头，鱼片都煮散了");
    const extra = [`酸爽值：${sour} / ${spicy}${huajiao ? " / 麻香加持" : ""}`];
    if (outcome !== "perfect") {
      extra.push(outcome === "under" ? "失误记录：火候未到就出锅，鱼片还半透明" : "失误记录：火候过头，鱼片都散了");
    }
    Game.showResult({
      dishName: "酸菜鱼",
      title: "酸爽值正在加载",
      img: dish().img,
      branch: route,
      stars,
      fireText,
      memoryScent: "酸菜与葱姜香",
      extraLines: extra,
      summary: outcome === "perfect"
        ? `你的口味路线：${route}。<br>备好酸汤、滑入 3 片鱼片，${attempts === 0 ? "一次掌火到位" : `调整 ${attempts} 次后出锅`}。`
        : (outcome === "under"
          ? `你的口味路线：${route}。<br>酸汤备好、鱼片也滑进去了，但火候没到就出锅——鱼片还半透明，这锅得再煮一会儿。`
          : `你的口味路线：${route}。<br>火候过了才出锅，鱼片都煮散了，这锅酸汤白费了功夫。`),
      outcome,
    });
    Telemetry.log("complete", { dish: "suancaiyu", sour, spicy, huajiao, attempts, outcome });
  }

  return {
    start() {
      sour = "标准"; spicy = "微辣"; huajiao = false;
      basePlaced = []; fishCount = 0;
      mistakes = 0; attempts = 0;
      stopSteam();
      buildStage();
      phaseTaste();
    },
    retry() {
      if (phase === "fire") { stopSteam(); phaseFire(0); }
      else if (phase === "fish") phaseFish();
      else if (phase === "base") phaseBase();
      else phaseTaste();
    },
  };
})();
