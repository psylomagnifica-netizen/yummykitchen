/* ============================================================
 * scent.js — 气味适配层（PRD 第 8 节）
 * 统一接口 triggerScent(moduleId, duration, intensity)，
 * 原型无气味硬件 → 「手动控制台 / 模拟输出」模式，界面明确标注“模拟输出”。
 * 支持：暂停、关闭、跳过嗅觉（F5.4 / F8.2）；A/B 条件（F10.2）。
 * ============================================================ */
"use strict";

const Scent = (() => {
  const state = {
    enabled: true,    // 气味开关（烹饪页可切换）
    skipped: false,   // 启动页勾选“跳过嗅觉环节”
    abMode: "B",      // A = 视听 only；B = 视听 + 气味
    active: null,     // { moduleId, name, intensity, until, timer }
  };

  const $ = (id) => document.getElementById(id);

  function outputAllowed() {
    return state.enabled && !state.skipped && state.abMode === "B";
  }

  /**
   * 触发气味模块（统一接口，PRD 8.2）
   * @param {string} moduleId SCENT_MODULES 键
   * @param {number} duration 释放时长（秒）
   * @param {1|2|3} intensity 强度档位
   */
  function trigger(moduleId, duration = 4, intensity = 2) {
    Telemetry.log("scent_trigger", { moduleId, duration, intensity, mode: outputAllowed() ? "simulated" : "suppressed" });
    const mod = SCENT_MODULES[moduleId];
    if (!mod) return;
    stop(false);
    if (!outputAllowed()) return;

    const until = performance.now() + duration * 1000;
    state.active = { moduleId, name: mod.name, note: mod.note, intensity, duration, until };

    // 侧栏面板
    $("scent-name").textContent = `${mod.name} · ${mod.note}`;
    $("scent-intensity").textContent = "●".repeat(intensity) + "○".repeat(3 - intensity);
    // 浮动提示（标注“模拟输出”）
    const toast = $("scent-toast");
    toast.innerHTML = `气味模块触发：<strong>${mod.name}</strong><span class="sim-tag">模拟输出</span><br><small>${mod.note} · 约 ${duration}s</small>`;
    toast.classList.remove("hidden");

    tick();
  }

  function tick() {
    const a = state.active;
    if (!a) return;
    const remain = (a.until - performance.now()) / 1000;
    if (remain <= 0) { stop(); return; }
    $("scent-timer").textContent = `剩余 ${remain.toFixed(1)}s`;
    $("scent-bar-fill").style.width = `${(remain / a.duration) * 100}%`;
    a.timer = requestAnimationFrame(tick);
  }

  function stop(clearPanel = true) {
    const a = state.active;
    if (a && a.timer) cancelAnimationFrame(a.timer);
    state.active = null;
    if (clearPanel) {
      $("scent-name").textContent = "— 暂无输出 —";
      $("scent-intensity").textContent = "";
      $("scent-timer").textContent = "";
      $("scent-bar-fill").style.width = "0%";
      $("scent-toast").classList.add("hidden");
    }
  }

  function setEnabled(v) {
    state.enabled = v;
    if (!v) stop();
    Telemetry.log(v ? "scent_on" : "scent_off");
  }

  function syncPanelVisibility() {
    const off = state.skipped || state.abMode === "A";
    document.getElementById("scent-block").classList.toggle("off", off);
    document.getElementById("btn-scent-toggle").textContent = state.enabled && !off ? "气味：开" : "气味：关";
  }

  return {
    trigger, stop, setEnabled, syncPanelVisibility,
    set skipped(v) { state.skipped = v; syncPanelVisibility(); },
    get skipped() { return state.skipped; },
    set abMode(v) { state.abMode = v; syncPanelVisibility(); },
    get outputAllowed() { return outputAllowed(); },
  };
})();
