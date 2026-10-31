/* ============================================================
 * telemetry.js — 埋点与测试模式（PRD F10，附录 C 核心事件）
 * 本地记录，可导出 JSON；不采集人脸与隐私信息。
 * ============================================================ */
"use strict";

const Telemetry = (() => {
  const events = [];
  let testMode = false;
  let abMode = "B";

  function log(event, data = {}) {
    events.push({ t: new Date().toISOString(), event, ab: abMode, ...data });
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ abMode, events }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `烹香物语_测试记录_${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return {
    log,
    exportJSON,
    get events() { return events; },
    get testMode() { return testMode; },
    set testMode(v) { testMode = v; },
    get abMode() { return abMode; },
    set abMode(v) { abMode = v; },
  };
})();
