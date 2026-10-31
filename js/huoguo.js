/* ============================================================
 * huoguo.js — 火锅「这一锅你来配」（PRD 5.3）
 * 流程：选锅底 → 多选食材 → 拖拽下锅 → 涮煮计时（煮久仅视听提示，不焦糊）
 * ============================================================ */
"use strict";

Game.runners.huoguo = (() => {
  const dish = () => DISHES.find((d) => d.id === "huoguo");

  const BROTHS = [
    { id: "qingtang", name: "清汤", color: "#e8cf8f", scent: "allium",   sub: "鲜甜清亮 · 葱姜提香" },
    { id: "jungu",    name: "菌菇", color: "#a9824f", scent: "mushroom", sub: "山野菌香 · 越煮越鲜" },
    { id: "mala",     name: "麻辣", color: "#c0392b", scent: "hotpot",   sub: "红油翻滚 · 香辣过瘾" },
  ];

  let phase = "broth";
  let broth = null;
  let selected = [];       // 选中的食材 id
  let dropped = [];        // 已下锅
  let mistakes = 0;
  let attempts = 0;
  let fb = null;
  let steamTimer = null;

  const stage = () => Game.stage();

  function buildStage() {
    stage().innerHTML = `
      <div class="wok-zone pot-style" id="potZone">
        <img class="wok-img" id="potImg" src="assets/tool/wok.png?v=5" alt="汤锅">
        <div class="broth" id="broth" style="background:rgba(240,230,200,.55)"></div>
      </div>
      <div class="prep-board" id="prepBoard" style="display:none"></div>
      <div id="choiceSlot"></div>`;
  }

  /* ---------- 阶段 1：选锅底 ---------- */
  function phaseBroth() {
    phase = "broth";
    Game.setSteps(dish().steps, 0, 0);
    Game.setHint("先定<em>锅底</em>：清汤、菌菇还是麻辣？");
    stage().querySelector("#choiceSlot").innerHTML = `
      <div class="choice-overlay">
        <div class="choice-title">这一锅，什么底？</div>
        <div class="choice-cards">
          ${BROTHS.map((b) => `
            <div class="choice-card" data-broth="${b.id}">
              <div class="cc-name">${b.name}</div>
              <div class="cc-swatch" style="background:${b.color}"></div>
              <div class="cc-sub">${b.sub}</div>
            </div>`).join("")}
        </div>
      </div>`;
    stage().querySelectorAll(".choice-card").forEach((card) => {
      card.addEventListener("click", () => {
        broth = BROTHS.find((b) => b.id === card.dataset.broth);
        Sound.play("confirm");
        Sound.play("pour");
        Sound.startLoop("boil");
        Telemetry.log("select_branch", { dish: "huoguo", branch: broth.id });
        const bEl = stage().querySelector("#broth");
        bEl.style.background = broth.color;
        bEl.classList.add("bubbling");
        Scent.trigger(broth.scent, 4, 2);
        Game.feedback("ok", `${broth.name}锅底上桌，开始沸腾`, 2000);
        stage().querySelector("#choiceSlot").innerHTML = "";
        setTimeout(phasePick, 800);
      });
    });
  }

  /* ---------- 阶段 2：多选食材 ---------- */
  function phasePick() {
    phase = "pick";
    Game.setSteps(dish().steps, 1, 1);
    Game.setHint("挑<em>至少 2 种</em>爱吃的食材，组成你的专属火锅。");
    stage().querySelector("#choiceSlot").innerHTML = `
      <div class="choice-overlay">
        <div class="choice-title">配菜时间（已选 <span id="pickCount">0</span> 种）</div>
        <div class="choice-cards">
          ${dish().ingredients.map((ing) => `
            <div class="choice-card" data-ing="${ing.id}">
              <div class="cc-name" style="font-size:19px">${ing.name}</div>
              <img src="${ing.img}" alt="${ing.name}">
            </div>`).join("")}
        </div>
        <button class="btn btn-primary btn-big" id="btn-pick-ok" disabled>就选这些</button>
      </div>`;
    const slot = stage().querySelector("#choiceSlot");
    const okBtn = slot.querySelector("#btn-pick-ok");
    okBtn.style.opacity = ".5";
    slot.querySelectorAll(".choice-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.dataset.ing;
        if (selected.includes(id)) selected = selected.filter((x) => x !== id);
        else selected.push(id);
        card.classList.toggle("selected", selected.includes(id));
        Sound.play("click");
        slot.querySelector("#pickCount").textContent = selected.length;
        okBtn.disabled = selected.length < 2;
        okBtn.style.opacity = selected.length < 2 ? ".5" : "1";
      });
    });
    okBtn.addEventListener("click", () => {
      if (selected.length < 2) return;
      Sound.play("confirm");
      Telemetry.log("select_branch", { dish: "huoguo", items: selected.join(",") });
      slot.innerHTML = "";
      phaseDrop();
    });
  }

  /* ---------- 阶段 3：拖拽下锅 ---------- */
  function phaseDrop() {
    phase = "drop";
    dropped = [];
    Game.setHint("把食材<em>拖进锅里</em>，听着扑通声，香气就来了。");
    const board = stage().querySelector("#prepBoard");
    board.style.display = "";
    board.innerHTML = "";
    selected.forEach((id) => {
      const ing = dish().ingredients.find((i) => i.id === id);
      const el = document.createElement("div");
      el.className = "ing-item next";
      el.dataset.ing = id;
      el.innerHTML = `<img src="${ing.img}" alt="${ing.name}"><div class="ing-name">${ing.name}</div>`;
      board.appendChild(el);
      Game.makeDraggable(el, {
        targets: () => [stage().querySelector("#potZone")],
        onDrop: () => onDropped(el, ing),
        onMiss: () => Game.feedback("info", "要下锅才算哦", 1500),
      });
    });
  }

  function onDropped(el, ing) {
    el.classList.add("used");
    el.classList.remove("next");
    dropped.push(ing.id);
    Sound.play("pour");
    Sound.play("drop");
    Sfx.play("drop");       // 每拖一个食材下锅就响一次
    Scent.trigger(broth.scent, 2.5, 1);
    const b = stage().querySelector("#broth");
    const im = document.createElement("img");
    im.src = ing.img;
    im.style.transform = `translate(${(Math.random() * 40 - 20).toFixed(0)}%, ${(Math.random() * 26 - 13).toFixed(0)}%) rotate(${(Math.random() * 40 - 20).toFixed(0)}deg)`;
    b.appendChild(im);
    Game.feedback("ok", `「${ing.name}」下锅！`, 1200);
    Telemetry.log("gesture_success", { dish: "huoguo", action: "drop", item: ing.id });
    if (dropped.length === selected.length) setTimeout(phaseBoil, 800);
  }

  /* ---------- 阶段 4：涮煮计时（过久仅视听提示，PRD F6.3） ---------- */
  function phaseBoil(fromValue = 0) {
    phase = "boil";
    Game.setSteps(dish().steps, 2, 2);
    Game.setHint("涮煮中：计时进入<em>绿色区间</em>点击「捞出开吃」。煮久了口感会变老！");
    Game.unmountFireBar();
    Sfx.loop("boil");       // 涮煮环境声
    const b = stage().querySelector("#broth");
    b.style.filter = "";
    if (!steamTimer) steamTimer = setInterval(spawnSteam, 650);
    fb = Game.mountFireBar(
      { duration: 10000, good: [50, 85], labels: ["没涮熟", "鲜嫩刚好", "煮老了"], stopText: "捞出开吃！", title: "涮煮计时" },
      (value, status) => onBoilStop(value, status)
    );
    fb.onTick = (v) => {
      if (v > 85) b.style.filter = "brightness(.8) saturate(.7)";
    };
    fb.start(fromValue);
  }

  function spawnSteam() {
    if (Game.paused || phase !== "boil") return;
    const pot = stage().querySelector("#potZone");
    const p = document.createElement("div");
    p.className = "steam-puff";
    p.style.left = 30 + Math.random() * 40 + "%";
    p.style.top = "0%";
    pot.appendChild(p);
    setTimeout(() => p.remove(), 2800);
  }

  function stopSteam() { clearInterval(steamTimer); steamTimer = null; }

  function onBoilStop(value, status) {
    if (status === "perfect") {
      stopSteam();
      Sound.stopAllLoops();
      Sound.play("success");
      Game.feedback("ok", "鲜嫩刚好，开吃！", 0);
      Telemetry.log("fire_judge", { dish: "huoguo", result: "perfect", value });
      setTimeout(finish, 1100);
    } else if (status === "under") {
      // 火候不足：不再重煮，直接出结果卡，标注「没熟」
      attempts++;
      mistakes++;
      Sound.play("warn");
      Game.feedback("info", "火候没到，还没涮熟……直接捞出看看这锅夹生的样子。", 0);
      Telemetry.log("fire_judge", { dish: "huoguo", result: "under", value });
      setTimeout(() => finish("under"), 1300);
    } else {
      // 火候过头：不再重煮，直接出结果卡，标注「过了」（PRD F6.3：不触发焦糊气味）
      attempts++;
      mistakes++;
      stopSteam();
      Sound.play("fail");
      // PRD：火锅煮久以视觉/声音为主，不触发焦糊气味
      stage().querySelector("#broth").style.filter = "brightness(.62) saturate(.5)";
      Game.feedback("bad", "煮太久了，肥牛卷都老了……直接捞出看看这锅煮过头的样子。", 0);
      Telemetry.log("fire_judge", { dish: "huoguo", result: "over", value });
      setTimeout(() => finish("over"), 1400);
    }
  }

  function finish(outcome = "perfect") {
    Scent.stop();
    Sfx.stop("boil");
    const names = selected.map((id) => dish().ingredients.find((i) => i.id === id).name).join("、");
    const stars = outcome === "perfect" ? Math.max(2, 5 - mistakes) : 1;
    const fireText = outcome === "perfect"
      ? (attempts === 0 ? "一次捞出，鲜嫩刚好" : `调整 ${attempts} 次后恰到好处`)
      : (outcome === "under" ? "火候不足，食材没涮熟" : "火候过头，肉都煮老了");
    const extra = [`我的火锅搭配：${broth.name} + ${selected.length} 种食材`];
    if (outcome !== "perfect") {
      extra.push(outcome === "under" ? "失误记录：火候未到就捞出，食材还夹生" : "失误记录：火候过头，肥牛卷都煮老了");
    }
    Game.setSteps(dish().steps, 3, 3);
    Game.showResult({
      dishName: "火锅",
      title: "这一锅你来配",
      img: dish().img,
      branch: `${broth.name}锅底 · ${names}`,
      stars,
      fireText,
      memoryScent: SCENT_MODULES[broth.scent].name,
      extraLines: extra,
      summary: outcome === "perfect"
        ? `你的专属搭配：${broth.name}锅底，配${names}。<br>涮煮${attempts === 0 ? "一次到位" : `调整了 ${attempts} 次`}，鲜嫩出锅。`
        : (outcome === "under"
          ? `你的专属搭配：${broth.name}锅底，配${names}。<br>但火候没到就捞出，食材还夹生——这锅还得再涮一会儿。`
          : `你的专属搭配：${broth.name}锅底，配${names}。<br>火候过了才捞出，肥牛卷都煮老了，这锅有点过头。`),
      outcome,
    });
    Telemetry.log("complete", { dish: "huoguo", broth: broth.id, items: selected.join(","), attempts, outcome });
  }

  return {
    start() {
      broth = null; selected = []; dropped = [];
      mistakes = 0; attempts = 0;
      stopSteam();
      buildStage();
      phaseBroth();
    },
    retry() {
      if (phase === "boil") { stopSteam(); phaseBoil(0); }
      else if (phase === "drop") phaseDrop();
      else if (phase === "pick") phasePick();
      else phaseBroth();
    },
  };
})();
