/* ============================================================
 * game.js — 状态机路由 + 共享交互组件
 * 状态流（PRD 3.2）：启动/提示 → 菜单 → 菜品说明 → 烹饪步骤循环
 *   （分支选择 → 手势 → 火候判断）→ 结果卡 → 分享/反馈
 * 全局：暂停、气味关闭/跳过（任意时刻可用）
 * ============================================================ */
"use strict";

const Game = (() => {
  const $ = (id) => document.getElementById(id);
  const app = {
    currentDish: null,
    runner: null,       // 当前菜品玩法模块（friedrice.js / zongzi.js 注册）
    paused: false,
    result: null,
  };
  const runners = {};   // dishId -> { start(), retry() }

  /* ---------- 路由 ---------- */
  function show(screenId) {
    clearPicked();                      // 换页时清掉「拾起」状态
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
    window.scrollTo(0, 0);
  }

  /* ---------- 提示与反馈 ---------- */
  function setHint(html) { $("hint-text").innerHTML = html; }

  let fbTimer = null;
  function feedback(type, text, hold = 2600) {
    const el = $("feedback-banner");
    el.className = `feedback-banner ${type}`;
    el.textContent = text;
    clearTimeout(fbTimer);
    if (hold) fbTimer = setTimeout(() => el.classList.add("hidden"), hold);
  }
  function clearFeedback() { $("feedback-banner").classList.add("hidden"); }

  /* ---------- 步骤指示 ---------- */
  function setSteps(steps, activeIdx = 0, doneCount = 0) {
    $("step-pills").innerHTML = steps
      .map((_, i) => `<span class="step-pill ${i < doneCount ? "done" : i === activeIdx ? "doing" : ""}">${i + 1}</span>`)
      .join("");
    $("step-list").innerHTML = steps
      .map((s, i) => `<li class="${i < doneCount ? "done" : i === activeIdx ? "doing" : ""}">${s}</li>`)
      .join("");
  }

  /* ---------- 拖拽助手（指针事件，鼠标/触屏通用） ---------- */
  function pointInRect(x, y, r) {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /**
   * 让元素可拖拽。opts:
   *  targets: () => HTMLElement[]   放置目标
   *  onDrop(el, target)             成功放入
   *  onMiss(el)                     未放入目标
   *
   * 拖不动时的「点选替代路径」（PRD F4.3 替代操作）：
   * 轻点一下即拾起该食材（高亮），再点一下目标容器即可放入；
   * 再次轻点该食材或点击空白处取消。
   */
  let picked = null;      // 当前被「拾起」的元素
  let pickedTargets = [];

  function clearPicked() {
    if (picked) picked.classList.remove("picked");
    picked = null;
    pickedTargets.forEach((t) => t.classList.remove("droppable"));
    pickedTargets = [];
  }

  /**
   * 渲染一张备料卡片。
   *
   * 普通食材：一张图 + 名称。
   * 组合食材（ing.bowlImg 存在，如「一碗米」）：
   *   碗作为固定底层铺在卡片里（pointer-events:none，不可拖、不可点），
   *   只有碗里的内容物（.combo-pick）是可拖拽把手。
   *   → 满足「碗固定不动，只能拖动米」的交互要求。
   *
   * @param ing        食材配置对象
   * @param extraClass 追加到 .ing-item 上的 class（如 "next"）
   */
  function buildIngredientCard(ing, extraClass) {
    const el = document.createElement("div");
    el.className = "ing-item" + (extraClass ? " " + extraClass : "");
    el.dataset.ing = ing.id;
    if (ing.bowlImg) {
      el.classList.add("combo");
      el.innerHTML = `
        <div class="combo-stage">
          <img class="combo-bowl" src="${ing.bowlImg}" alt="碗">
          <div class="combo-pick" title="拖动${ing.name}">
            <img src="${ing.img}" alt="${ing.name}">
          </div>
        </div>
        <div class="ing-name">${ing.name}</div>`;
      // 碗是固定的：玩家按在碗上时给出提示，避免以为没反应
      el.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".combo-pick")) return;   // 拖米，走正常流程
        e.preventDefault();                            // 阻止浏览器进入文本选中模式
        feedback("info", "碗是固定的，拖碗里的" + ing.name + "哦", 1800);
      });
    } else {
      el.innerHTML = `<img src="${ing.img}" alt="${ing.name}"><div class="ing-name">${ing.name}</div>`;
    }
    return el;
  }

  /**
   * 让元素可拖拽。
   * opts:
   *   targets()   → 可放置的目标元素数组
   *   onDrop(el)  → 放置成功
   *   onMiss(el)  → 放错地方
   *   handle      → 可选，真正的「拖拽把手」元素；只有按住它才能拖。
   *                 用于「碗固定不动、只能拖米」这类组合素材：
   *                 外层容器负责命中测试与状态，把手负责跟随手指。
   *   ghostSrc    → 可选，拖拽幽灵图；默认取把手里的第一张 img。
   */
  function makeDraggable(el, opts) {
    el.__dragOpts = opts;
    const handle = opts.handle ? el.querySelector(opts.handle) : el;
    if (!handle) return;
    // 同一元素重复注册（例如「重试」回到同一阶段）时先解绑旧监听，
    // 否则一次按压会触发多套拖拽逻辑（双幽灵图 / 重复 onDrop）。
    if (handle.__dragHandler) handle.removeEventListener("pointerdown", handle.__dragHandler);
    const onPointerDown = (e) => {
      if (app.paused || el.classList.contains("used") || el.dataset.locked) return;
      e.preventDefault();
      e.stopPropagation();
      Sound.unlock();
      const startX = e.clientX, startY = e.clientY, startT = performance.now();
      const img = handle.querySelector ? handle.querySelector("img") : null;
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost" + (opts.handle ? " drag-ghost-wide" : "");
      ghost.innerHTML = `<img src="${opts.ghostSrc || (img ? img.src : "")}" alt="">`;
      document.body.appendChild(ghost);
      const moveGhost = (ev) => {
        ghost.style.left = ev.clientX + "px";
        ghost.style.top = ev.clientY + "px";
      };
      moveGhost(e);
      const targets = opts.targets().filter(Boolean);
      targets.forEach((t) => t.classList.add("droppable"));
      // 组合素材：只让「把手」（碗里的米）变透明，碗保持原样不动；
      // 普通素材：整张卡片半透明，保持原有观感。
      const dimTarget = opts.handle ? handle : el;
      dimTarget.style.opacity = opts.handle ? "0" : ".45";

      const onMove = (ev) => moveGhost(ev);
      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        targets.forEach((t) => t.classList.remove("droppable"));
        dimTarget.style.opacity = "";
        const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        const hit = targets.find((t) => pointInRect(ev.clientX, ev.clientY, t.getBoundingClientRect()));

        // —— 轻点（几乎没移动）：进入「点选替代」模式，不算拖拽失败 ——
        if (moved < 8 && !hit && performance.now() - startT < 600) {
          ghost.remove();
          togglePicked(el, opts);
          return;
        }
        if (hit) {
          const r = hit.getBoundingClientRect();
          ghost.style.transition = "left .28s ease, top .28s ease, transform .28s ease, opacity .3s";
          ghost.style.left = r.left + r.width / 2 + "px";
          ghost.style.top = r.top + r.height / 2 + "px";
          ghost.style.transform = "translate(-50%,-50%) scale(.35)";
          ghost.style.opacity = "0";
          setTimeout(() => ghost.remove(), 320);
          clearPicked();
          opts.onDrop && opts.onDrop(el, hit);
        } else {
          ghost.remove();
          opts.onMiss && opts.onMiss(el);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
    handle.__dragHandler = onPointerDown;
    handle.addEventListener("pointerdown", onPointerDown);
  }

  /* ---------- 点选替代路径 ---------- */
  function togglePicked(el, opts) {
    if (picked === el) {                 // 再次轻点 → 取消
      clearPicked();
      feedback("info", "已取消选择", 1200);
      return;
    }
    clearPicked();
    picked = el;
    el.classList.add("picked");
    pickedTargets = (opts.targets() || []).filter(Boolean);
    pickedTargets.forEach((t) => t.classList.add("droppable"));
    Sound.play("click");
    feedback("info", "已拿起「" + labelOf(el) + "」，再点一下目标即可放入", 2600);
    Telemetry.log("gesture_pick", { action: "tap_pick", item: el.dataset.ing || "" });
  }

  function labelOf(el) {
    const n = el.querySelector(".ing-name");
    return n ? n.textContent.trim() : "它";
  }

  // 点击已拾起的食材所在的目标容器 → 完成放置
  document.addEventListener("pointerdown", (e) => {
    if (!picked) return;
    const target = pickedTargets.find((t) => pointInRect(e.clientX, e.clientY, t.getBoundingClientRect()));
    if (target) {
      const el = picked;
      const opts = el.__dragOpts;
      clearPicked();
      if (opts && opts.onDrop) opts.onDrop(el, target);
      e.stopPropagation();
    } else if (!picked.contains(e.target)) {
      // 点空白处不取消，避免误触；改为保留选中，仅给出提示
      feedback("info", "再点一下锅 / 容器就能放入", 1600);
    }
  }, true);


  /* ---------- 火候 / 计时阈值条（PRD F6.1） ---------- */
  class FireBar {
    /**
     * cfg: { duration, good: [lo, hi], labels:[l,c,r], stopText, title }
     * onStop(value, status) status: 'under' | 'perfect' | 'over'
     */
    constructor(slot, cfg) {
      this.cfg = cfg;
      this.value = 0;
      this.running = false;
      this.raf = null;
      slot.innerHTML = `
        <div class="firebar">
          <div class="firebar-track">
            <div class="firebar-zone z-under" style="left:0%;width:${cfg.good[0]}%"></div>
            <div class="firebar-zone z-good" style="left:${cfg.good[0]}%;width:${cfg.good[1] - cfg.good[0]}%"></div>
            <div class="firebar-zone z-over" style="left:${cfg.good[1]}%;width:${100 - cfg.good[1]}%"></div>
            <div class="firebar-fill"></div>
            <div class="firebar-needle" style="left:0%"></div>
          </div>
          <div class="firebar-labels">
            <span>${cfg.labels[0]}</span><span>${cfg.labels[1]}（绿色区间）</span><span>${cfg.labels[2]}</span>
          </div>
          <button class="btn-fire" disabled>${cfg.stopText}</button>
        </div>`;
      this.fill = slot.querySelector(".firebar-fill");
      this.needle = slot.querySelector(".firebar-needle");
      this.btn = slot.querySelector(".btn-fire");
      this.btn.addEventListener("click", () => {
        if (!this.running || app.paused) return;
        const v = this.value;
        this.stop();
        const status = v < cfg.good[0] ? "under" : v > cfg.good[1] ? "over" : "perfect";
        Telemetry.log("fire_stop", { value: v.toFixed(1), status });
        this.onStop && this.onStop(v, status);
      });
    }
    start(fromValue = 0) {
      this.value = fromValue;
      this.running = true;
      this.btn.disabled = false;
      let last = performance.now();
      const tick = (now) => {
        if (!this.running) return;
        if (!app.paused) {
          const dt = now - last;
          // 略微加速，越往后越紧张
          this.value = Math.min(100, this.value + (dt / this.cfg.duration) * 100 * (1 + this.value / 140));
          this.render();
          this.onTick && this.onTick(this.value);
          if (this.value >= 100) {
            this.stop();
            this.onStop && this.onStop(100, "over");
            return;
          }
        }
        last = now;
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
    render() {
      this.fill.style.width = this.value + "%";
      this.needle.style.left = this.value + "%";
    }
    stop() {
      this.running = false;
      this.btn.disabled = true;
      if (this.raf) cancelAnimationFrame(this.raf);
    }
    destroy() { this.stop(); }
  }

  function mountFireBar(cfg, onStop) {
    $("firebar-block").classList.remove("hidden");
    $("firebar-title").textContent = cfg.title || "火候";
    const fb = new FireBar($("firebar-slot"), cfg);
    fb.onStop = onStop;
    return fb;
  }
  function unmountFireBar() {
    $("firebar-block").classList.add("hidden");
    $("firebar-slot").innerHTML = "";
  }

  /* ---------- 菜单页 ---------- */
  function buildMenu() {
    const grid = $("menu-grid");
    grid.innerHTML = "";
    DISHES.forEach((d) => {
      const card = document.createElement("div");
      card.className = "dish-card";
      card.innerHTML = `
        <span class="card-badge ${d.core ? "" : "ext"}">${d.core ? "可下厨实操" : "体验脚本"}</span>
        <span class="card-steps">约 ${d.stepCount} 步</span>
        <img src="${d.img}" alt="${d.name}">
        <div class="card-body">
          <div class="card-name">${d.name}</div>
          <div class="card-title">「${d.title}」</div>
          <div class="tag-row">${d.scentTags.map((t) => `<span class="tag scent">气味 · ${t}</span>`).join("")}</div>
        </div>`;
      card.addEventListener("click", () => {
        Sound.unlock(); Sound.play("click");
        Telemetry.log("select_dish", { dish: d.id });
        openDishIntro(d);
      });
      grid.appendChild(card);
    });
  }

  /* ---------- 菜品说明页 ---------- */
  function openDishIntro(d) {
    app.currentDish = d;
    const el = $("dish-intro");
    const ingHtml = d.ingredients || d.baseIngredients
      ? `<div class="intro-section"><h3>所需食材</h3><div class="intro-ing">
          ${(d.ingredients || d.baseIngredients.concat(d.branch ? d.branch.options[0].fillings : []))
            .map((i) => `<div class="ing-chip"><img src="${i.img}" alt="${i.name}"><div>${i.name}</div></div>`).join("")}
        </div></div>` : "";
    const branchHtml = d.branch
      ? `<div class="intro-section"><h3>分支选择</h3><p class="intro-steps">${d.branch.prompt}<br>${d.branch.options.map((o) => "· " + o.name).join("<br>")}</p></div>` : "";
    el.innerHTML = `
      <div class="intro-head">
        <img class="intro-img" src="${d.img}" alt="${d.name}">
        <div>
          <h2>${d.name}</h2>
          <div class="intro-title">「${d.title}」</div>
          <p class="intro-steps">${d.desc}</p>
          <div class="tag-row">${d.scentTags.map((t) => `<span class="tag scent">气味 · ${t}</span>`).join("")}</div>
        </div>
      </div>
      ${ingHtml}
      ${branchHtml}
      <div class="intro-section"><h3>体验步骤</h3>
        <p class="intro-steps">${d.steps.map((s, i) => `${i + 1}. ${s}`).join("　→　")}</p>
      </div>
      <div class="intro-actions">
        ${d.core
          ? `<button class="btn btn-primary btn-big" id="btn-cook-this">开始烹饪</button>`
          : `<button class="btn btn-primary" id="btn-view-script">查看完整体验脚本</button>`}
        <button class="btn btn-ghost" id="btn-intro-back">返回菜单</button>
      </div>`;
    show("screen-dish");
    $("btn-intro-back").addEventListener("click", () => { Sound.play("click"); show("screen-menu"); });
    if (d.core) {
      $("btn-cook-this").addEventListener("click", () => { Sound.play("confirm"); startCook(d); });
    } else {
      $("btn-view-script").addEventListener("click", () => openScriptModal(d));
    }
  }

  /* ---------- 扩展菜品脚本弹窗 ---------- */
  function openScriptModal(d) {
    Sound.play("click");
    $("script-modal-body").innerHTML = `
      <h2 style="font-family:var(--font-title);color:var(--cinnabar)">${d.name} ·「${d.title}」</h2>
      <p style="color:var(--ink-soft);margin:8px 0 14px">P1 扩展体验样本：完整“操作—视觉—听觉—嗅觉”脚本如下，原型阶段暂不可实操。</p>
      <table class="script-table">
        <tr><th>步骤</th><th>用户操作/选择</th><th>视觉</th><th>听觉</th><th>嗅觉</th><th>分支/失误</th></tr>
        ${d.script.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}
      </table>`;
    $("script-modal").classList.remove("hidden");
  }

  /* ---------- 烹饪流程 ---------- */

  /* 释放当前菜品玩法模块持有的资源（摄像头、计时器、事件监听）。
     菜品 runner 若提供 stop()，在切换菜品 / 暂停 / 返回菜单 / 出结果时调用。 */
  function stopRunner() {
    if (app.runner && typeof app.runner.stop === "function") {
      try { app.runner.stop(); } catch (e) { /* ignore */ }
    }
  }

  function startCook(dish) {
    stopRunner();
    Sfx.stopAll();          // 换菜时把上一道菜的录音素材（含出锅音乐）收干净
    app.currentDish = dish;
    app.paused = false;
    $("cook-dish-name").textContent = dish.name;
    $("cook-stage").innerHTML = "";
    unmountFireBar();
    clearFeedback();
    Scent.stop();
    Scent.syncPanelVisibility();
    show("screen-cook");
    const runner = runners[dish.id];
    app.runner = runner || null;
    if (runner) runner.start();
  }

  /* ---------- 结果卡 ---------- */

  /* 结局元信息：成功 / 欠火（没熟） / 过火（焦了）
     依据 PRD F6.2「失误时提示调整或重试」与 F7.1 结果卡需含「火候掌控」，
     失误直接进入结果卡并明确标注没熟 / 焦了。 */
  const OUTCOME_META = {
    perfect: {
      badge: null,
      stamp: null,
      tint: null,
      titleTpl: "出锅啦！",
      fireNote: null,
    },
    under: {
      badge: "没熟",
      stamp: "夹生未熟",
      tint: "rgba(120,150,175,.34)",      // 冷灰蓝：寡淡未熟
      titleTpl: "火候没到，这锅没熟",
      fireNote: "火候不足，没熟透",
    },
    over: {
      badge: "焦了",
      stamp: "已烧焦",
      tint: "rgba(132,66,22,.18)",        // 轻暖调：焦褐（换焦糊图后不宜过暗）
      titleTpl: "火候过了，焦了",
      fireNote: "火候过头，已烧焦",
    },
  };

  // 火候过火时，结果卡统一使用「炒焦」实拍图（所有带火候的菜品共用）
  const BURNT_IMG = "assets/ing/烧焦.png?v=5";

  function buildResultCard(data) {
    // data: { dishName, title, img, branch, stars, fireText, memoryScent, extraLines[], outcome }
    app.result = data;
    const outcome = OUTCOME_META[data.outcome] ? data.outcome : "perfect";
    const meta = OUTCOME_META[outcome];
    const cv = $("result-canvas");
    const W = cv.width, H = cv.height;
    const ctx = cv.getContext("2d");
    const img = new Image();
    // 过火（烧焦）统一换成焦糊实拍图；欠火仍用原菜品图 + 冷色调
    img.src = (outcome === "over" && data.useBurnt !== false) ? BURNT_IMG : data.img;
    img.onload = () => {
      // 背景
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#fdf6e7");
      bg.addColorStop(1, "#f3e2c2");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      // 顶部竹帘装饰
      ctx.fillStyle = "#c9a86a";
      for (let i = 0; i < 14; i++) ctx.fillRect(0, 26 + i * 7, W, 2.5);
      // 标题
      ctx.textAlign = "center";
      ctx.fillStyle = "#c0392b";
      ctx.font = "700 64px KaiTi, STKaiti, serif";
      ctx.fillText("烹香物语", W / 2, 210);
      ctx.fillStyle = "#7a6a58";
      ctx.font = "28px sans-serif";
      ctx.fillText("—— 我的中式料理实验 ——", W / 2, 258);
      // 菜品图（圆角方形）
      const ix = 110, iy = 300, is = W - 220;
      ctx.save();
      roundRect(ctx, ix, iy, is, is, 28);
      ctx.clip();
      // 失误态：给菜品图加色调（欠火发寡、过火发焦）
      if (meta.tint) {
        try { ctx.filter = outcome === "over" ? "saturate(.92) brightness(1.02)" : "saturate(.55) brightness(1.06)"; } catch (e) { /* 老浏览器忽略 */ }
      }
      ctx.drawImage(img, ix, iy, is, is);
      ctx.filter = "none";
      if (meta.tint) {
        ctx.fillStyle = meta.tint;
        ctx.fillRect(ix, iy, is, is);
      }
      ctx.restore();
      ctx.strokeStyle = "#c9a86a";
      ctx.lineWidth = 4;
      roundRect(ctx, ix, iy, is, is, 28);
      ctx.stroke();
      // 失误印章（压在菜品图右下角）
      if (meta.stamp) drawStamp(ctx, ix + is - 150, iy + is - 150, meta.stamp, outcome);
      // 菜品名
      ctx.fillStyle = "#4a3b2a";
      ctx.font = "700 52px KaiTi, STKaiti, serif";
      ctx.fillText(`${data.dishName} · ${data.title}`, W / 2, iy + is + 82);
      // 信息行
      const stars = meta.stamp ? Math.min(data.stars, 1) : data.stars;
      const rows = [
        ["口味路线", data.branch || "经典原味"],
        ["完成度", "★".repeat(stars) + "☆".repeat(5 - stars)],
        ["火候掌控", meta.fireNote || data.fireText],
        ["最有记忆点的气味", data.memoryScent],
      ];
      ctx.textAlign = "left";
      let ry = iy + is + 150;
      rows.forEach(([k, v]) => {
        ctx.fillStyle = "#8b5e34";
        ctx.font = "600 26px sans-serif";
        ctx.fillText(k, 120, ry);
        ctx.fillStyle = "#4a3b2a";
        ctx.font = "28px sans-serif";
        ctx.fillText(fitText(ctx, String(v), W - 120 - 330), 330, ry);
        ry += 60;
      });
      (data.extraLines || []).forEach((line) => {
        ctx.fillStyle = "#7a6a58";
        ctx.font = "24px sans-serif";
        ctx.fillText(fitText(ctx, line, W - 240), 120, ry);
        ry += 46;
      });
      // 底部话题：位置固定在画布底部；若信息行变长（失误态多一行说明）则整体下移避让
      const topicY = Math.max(H - 74, ry + 46);
      ctx.textAlign = "center";
      ctx.fillStyle = "#7a8b5c";
      ctx.font = "600 26px sans-serif";
      ctx.fillText("#烹香物语 #中式料理多感官游戏", W / 2, topicY);
      ctx.fillStyle = "#a3927c";
      ctx.font = "20px sans-serif";
      ctx.fillText(new Date().toLocaleDateString("zh-CN") + " · 小厨房出品", W / 2, topicY + 38);
    };
  }

  /* 失误印章：旋转的圆角方章 */
  function drawStamp(ctx, cx, cy, text, outcome) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.22);
    ctx.globalAlpha = 0.88;
    const w = 210, h = 92;
    ctx.fillStyle = outcome === "over" ? "rgba(120,32,16,.9)" : "rgba(58,84,110,.9)";
    roundRect(ctx, -w / 2, -h / 2, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,245,225,.92)";
    ctx.lineWidth = 4;
    roundRect(ctx, -w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 9);
    ctx.stroke();
    ctx.fillStyle = "#fff6e4";
    ctx.textAlign = "center";
    ctx.font = "700 46px KaiTi, STKaiti, serif";
    ctx.fillText(text, 0, 16);
    ctx.restore();
  }

  /* 文本超出可用宽度时按像素裁剪并加省略号 */
  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + "…";
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function showResult(data) {
    Sound.stopAllLoops();
    Sfx.stopAll();           // 先停掉炒菜 / 蒸煮等环境声，避免和出锅音乐叠在一起
    Scent.stop();
    stopRunner();
    const outcome = OUTCOME_META[data.outcome] ? data.outcome : "perfect";
    const meta = OUTCOME_META[outcome];
    buildResultCard(data);
    $("result-title").textContent = data.resultTitle || meta.titleTpl;
    $("result-summary").innerHTML = data.summary;
    $("btn-export-log").classList.toggle("hidden", !Telemetry.testMode);
    Telemetry.log("result_card", { dish: app.currentDish.id, stars: data.stars, outcome });
    show("screen-result");
    // 成功出锅才放「成功出锅」音乐；做砸了只留提示音，不庆功
    if (outcome === "perfect") Sfx.play("done");
  }

  /* ---------- 暂停 ---------- */
  function setPaused(v) {
    app.paused = v;
    $("pause-overlay").classList.toggle("hidden", !v);
    if (v) { Sound.stopAllLoops(); Sfx.pauseAll(); Scent.stop(); stopRunner(); Telemetry.log("pause"); }
    else { Sfx.resumeAll(); }
  }

  /* ---------- 环境自检 ----------
   * file:// 下浏览器禁用 fetch / XHR / 动态 import，MediaPipe 的运行时与
   * 模型加载不到（曾表现为「手部模型加载失败」）。
   * 游戏已内置内联兜底，双击 index.html 仍可用，但 HTTP 环境更快更稳，
   * 所以在这里主动提示用户改用一键启动脚本。
   */
  function checkEnvironment() {
    const notice = $("envNotice");
    if (!notice) return;
    const isFile = location.protocol === "file:";
    const insecure = !window.isSecureContext;
    if (!isFile && !insecure) { notice.classList.add("hidden"); return; }

    const why = isFile
      ? "当前是<b>直接双击 HTML 文件</b>打开的。浏览器在 file:// 下会拦截识别模型的加载，摄像头手势可能启动失败。"
      : "当前不是安全上下文（需要 http://localhost 或 https），浏览器会禁用摄像头。";
    notice.innerHTML = `
      <strong>${why}</strong>
      <p>建议改用项目根目录的 <code>start-server.bat</code>（Windows）或
         <code>python serve.py</code>（跨平台）启动，它会自动开本地服务器并打开浏览器。</p>
      <p class="env-note">直接双击打开也能玩：识别模型已内置内联兜底，
         只是首次加载会慢几秒。</p>`;
    notice.classList.remove("hidden");
  }

  /* ---------- 全局绑定 ---------- */
  function bind() {
    // 启动页
    checkEnvironment();
    $("opt-test-mode").addEventListener("change", (e) => {
      $("opt-ab").disabled = !e.target.checked;
      Telemetry.testMode = e.target.checked;
    });
    $("opt-ab").addEventListener("change", (e) => {
      Telemetry.abMode = e.target.value;
      Scent.abMode = e.target.value;
    });
    $("btn-start").addEventListener("click", () => {
      Sound.unlock(); Sound.play("confirm");
      Scent.skipped = $("opt-skip-scent").checked;
      if ($("opt-skip-scent").checked) Telemetry.log("scent_skip");
      else Telemetry.log("scent_notice_ack");
      Telemetry.log("enter");
      buildMenu();
      show("screen-menu");
    });

    // 烹饪页顶栏
    $("btn-back-menu").addEventListener("click", () => {
      Sound.play("click"); Sound.stopAllLoops(); Sfx.stopAll(); Scent.stop(); stopRunner(); show("screen-menu");
    });
    $("btn-retry").addEventListener("click", () => {
      if (app.runner && app.runner.retry) { Sound.play("click"); app.runner.retry(); }
    });
    $("btn-scent-toggle").addEventListener("click", () => {
      const nowOn = $("btn-scent-toggle").textContent.includes("开");
      Scent.setEnabled(!nowOn);
      Scent.syncPanelVisibility();
    });
    // 跳过嗅觉（PRD F8.2 / F1.2：任意时刻可跳过嗅觉环节）
    $("btn-scent-skip").addEventListener("click", () => {
      Scent.skipped = !Scent.skipped;
      $("btn-scent-skip").textContent = Scent.skipped ? "已跳过嗅觉" : "跳过嗅觉";
      $("btn-scent-skip").classList.toggle("active", Scent.skipped);
      Scent.syncPanelVisibility();
      Game.feedback("info", Scent.skipped
        ? "已跳过嗅觉环节，视觉与听觉反馈照常进行。"
        : "已恢复嗅觉环节。", 2200);
      Telemetry.log(Scent.skipped ? "scent_skip" : "scent_resume", { scope: "cook" });
    });
    $("btn-pause").addEventListener("click", () => setPaused(true));
    $("btn-resume").addEventListener("click", () => setPaused(false));
    $("btn-restart-dish").addEventListener("click", () => {
      setPaused(false);
      Telemetry.log("retry", { dish: app.currentDish.id, scope: "dish" });
      startCook(app.currentDish);
    });
    $("btn-quit-menu").addEventListener("click", () => { setPaused(false); Sfx.stopAll(); stopRunner(); show("screen-menu"); });

    // 弹窗
    $("btn-close-modal").addEventListener("click", () => $("script-modal").classList.add("hidden"));
    $("script-modal").addEventListener("click", (e) => {
      if (e.target.id === "script-modal") $("script-modal").classList.add("hidden");
    });

    // 结果页
    $("btn-download-card").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = $("result-canvas").toDataURL("image/png");
      a.download = `烹香物语_${app.currentDish.name}_结果卡.png`;
      a.click();
      Telemetry.log("share_click", { kind: "download" });
    });
    $("btn-copy-share").addEventListener("click", async () => {
      const r = app.result;
      const text = `我在《烹香物语》做了一锅${r.dishName}（${r.branch || "经典路线"}），火候掌控：${r.fireText}，最有记忆点的气味是「${r.memoryScent}」。#烹香物语 #中式料理多感官游戏`;
      try {
        await navigator.clipboard.writeText(text);
        feedback("ok", "分享文案已复制");
      } catch (e) {
        prompt("复制以下文案：", text);
      }
      Telemetry.log("share_click", { kind: "copy" });
    });
    $("btn-cook-again").addEventListener("click", () => { Sound.play("confirm"); startCook(app.currentDish); });
    $("btn-result-menu").addEventListener("click", () => { Sound.play("click"); Sfx.stopAll(); show("screen-menu"); });

    // 反馈星级（F7.4）
    const starRow = $("star-row");
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement("button");
      b.className = "star";
      b.textContent = "★";
      b.addEventListener("click", () => {
        starRow.querySelectorAll(".star").forEach((s, j) => s.classList.toggle("lit", j < i));
        $("feedback-thanks").classList.remove("hidden");
        Telemetry.log("feedback_submit", { score: i });
        Sound.play("ding");
      });
      starRow.appendChild(b);
    }
    $("btn-export-log").addEventListener("click", () => Telemetry.exportJSON());
  }

  document.addEventListener("DOMContentLoaded", bind);

  return {
    show, setHint, feedback, clearFeedback, setSteps,
    makeDraggable, pointInRect, clearPicked, buildIngredientCard,
    mountFireBar, unmountFireBar,
    startCook, showResult, setPaused,
    runners,
    get paused() { return app.paused; },
    get currentDish() { return app.currentDish; },
    stage: () => $("cook-stage"),
  };
})();
