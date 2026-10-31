/* ============================================================
 * mp-loader.js — MediaPipe 运行时/模型加载器（眨眼 + 双手合十 共用）
 *
 * 为什么需要这一层
 * ----------------
 * 浏览器在 file:// 协议下把页面视为 opaque origin，会禁用
 * fetch() / XMLHttpRequest / 动态 import()，于是：
 *     import(vision_bundle.mjs)   → "Failed to fetch dynamically imported module"
 *     fetch(hand_landmarker.task) → "Failed to fetch"
 * MediaPipe 的运行时、wasm、模型三样都要靠这些接口加载，
 * 所以双击 index.html 打开时必然失败（表现为「手部模型加载失败」）。
 *
 * 但 data: URL 与 blob: URL 在 file:// 下是可用的（已实测），因此做两层策略：
 *   A. 正常路径（http/https，推荐用本地服务器打开）
 *      —— 直接 import 本地 .mjs、fetch 本地 .task，最快最省。
 *   B. file:// 兜底路径
 *      —— 加载 assets/vendor/mediapipe/inline_*.js（gzip+base64 内联），
 *         运行时还原成 blob URL：
 *           bundle      → import(blobUrl)
 *           wasm loader → blobUrl 当 script src
 *           wasm 二进制 → blobUrl 当 wasmBinaryPath
 *           模型        → baseOptions.modelAssetBuffer（Uint8Array）
 *
 * 两条路径产出完全一致的 landmarker 实例，调用方无感知。
 * ============================================================ */
"use strict";

const MPLoader = (() => {
  /* ---------- 路径推导 ---------- */
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || "";
  const SCRIPT_DIR = SCRIPT_URL ? SCRIPT_URL.slice(0, SCRIPT_URL.lastIndexOf("/") + 1) : "";
  const ROOT_DIR = SCRIPT_DIR.replace(/js\/?$/, "");
  const VENDOR = `${ROOT_DIR}assets/vendor/mediapipe`;

  const INLINE_RUNTIME = `${VENDOR}/inline_runtime.js`;
  const INLINE_MODEL = {
    hand: `${VENDOR}/inline_model_hand.js`,
    face: `${VENDOR}/inline_model_face.js`,
  };

  /* file:// 下 fetch/import 被禁，只能走内联兜底 */
  const IS_FILE = location.protocol === "file:";

  /* 缓存，避免同一页面重复加载 */
  const cache = { vision: null, fileset: null };

  /* ---------- 工具 ---------- */

  /** base64 → gzip 字节 */
  function b64ToGzipBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** gzip 字节 → 原始字节（用浏览器原生 DecompressionStream） */
  async function gunzip(gzBytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("浏览器不支持 DecompressionStream，无法解内联模型");
    }
    const ds = new DecompressionStream("gzip");
    const buf = await new Response(new Blob([gzBytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }

  /** 内联 base64+gzip 字符串 → 原始字节 */
  async function decodeInline(b64) {
    return gunzip(b64ToGzipBytes(b64));
  }

  /** 用普通 <script> 标签加载一个 JS（file:// 下唯一可行的加载方式） */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`脚本加载失败：${src}`));
      document.head.appendChild(s);
    });
  }

  /* ---------- 运行时加载 ---------- */

  /** 正常路径：import 本地 .mjs + 本地 wasm 目录 */
  async function loadRuntimeNormal() {
    const vision = await import(/* webpackIgnore: true */ `${VENDOR}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${VENDOR}/wasm`);
    return { vision, fileset };
  }

  /** 兜底路径：内联资源 → blob URL */
  async function loadRuntimeInline() {
    if (!window.MPInlineRuntime) {
      await loadScript(INLINE_RUNTIME);
    }
    const R = window.MPInlineRuntime;
    if (!R) throw new Error("内联运行时资源缺失");

    const [bundleBytes, wasmJsBytes, wasmBinBytes] = await Promise.all([
      decodeInline(R.BUNDLE),
      decodeInline(R.WASM_JS),
      decodeInline(R.WASM_BIN),
    ]);

    // bundle 是 ES module，用 blob URL 动态 import（file:// 下可用）
    const bundleUrl = URL.createObjectURL(new Blob([bundleBytes], { type: "text/javascript" }));
    const vision = await import(/* webpackIgnore: true */ bundleUrl);

    // wasm：loader 当脚本用，二进制给 locateFile 用
    const fileset = {
      wasmLoaderPath: URL.createObjectURL(new Blob([wasmJsBytes], { type: "text/javascript" })),
      wasmBinaryPath: URL.createObjectURL(new Blob([wasmBinBytes], { type: "application/wasm" })),
    };
    return { vision, fileset };
  }

  /** 取得运行时（vision 模块 + fileset），带缓存 */
  async function runtime() {
    if (cache.vision && cache.fileset) return cache;
    const r = IS_FILE ? await loadRuntimeInline() : await loadRuntimeNormal();
    cache.vision = r.vision;
    cache.fileset = r.fileset;
    return cache;
  }

  /* ---------- 模型加载 ---------- */

  /** 正常路径：直接用模型文件路径 */
  function normalBaseOptions(kind, delegate) {
    const file = kind === "hand" ? "hand_landmarker.task" : "face_landmarker.task";
    return { modelAssetPath: `${VENDOR}/${file}`, delegate };
  }

  /** 兜底路径：模型字节 → modelAssetBuffer */
  async function inlineBaseOptions(kind, delegate) {
    const globalName = kind === "hand" ? "MPInlineModelHand" : "MPInlineModelFace";
    if (!window[globalName]) {
      await loadScript(INLINE_MODEL[kind]);
    }
    const M = window[globalName];
    if (!M) throw new Error("内联模型资源缺失");
    const bytes = await decodeInline(M.MODEL);
    return { modelAssetBuffer: bytes, delegate };
  }

  /**
   * 创建 landmarker。
   * @param {"hand"|"face"} kind
   * @param {object} opts
   *   - delegate: "GPU" | "CPU"（默认 GPU，失败自动退 CPU）
   *   - numHands / numFaces 等其余 createFromOptions 选项
   */
  async function create(kind, opts = {}) {
    const { vision, fileset } = await runtime();

    const make = async (delegate) => {
      const baseOptions = IS_FILE
        ? await inlineBaseOptions(kind, delegate)
        : normalBaseOptions(kind, delegate);
      const { delegate: _d, ...rest } = opts;
      return vision[kind === "hand" ? "HandLandmarker" : "FaceLandmarker"].createFromOptions(
        fileset,
        { ...rest, baseOptions }
      );
    };

    try {
      return await make(opts.delegate || "GPU");
    } catch (e) {
      // GPU 不可用（老显卡 / 驱动限制 / 软件渲染）时退到 CPU
      return await make("CPU");
    }
  }

  return {
    create,
    runtime,
    /** 当前使用的加载路径，便于界面与测试自述 */
    get mode() { return IS_FILE ? "inline" : "normal"; },
    get isFileProtocol() { return IS_FILE; },
    VENDOR,
  };
})();
