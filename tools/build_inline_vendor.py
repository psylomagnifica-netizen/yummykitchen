"""生成 file:// 兜底用的内联资源包（gzip + base64 的 JS）。

为什么需要它
------------
浏览器在 file:// 协议下把页面视为 opaque origin，会禁用
fetch() / XMLHttpRequest / 动态 import()，导致 MediaPipe 的
运行时、wasm 与模型文件一个都加载不到（实测报
"Failed to fetch dynamically imported module"）。

但 data: URL 与 blob: URL 在 file:// 下不受此限制（实测可用），
所以把资源 gzip + base64 内联成 JS，运行时再还原成 blob URL 喂给 MediaPipe：

    bundle      → import(blobUrl)
    wasm loader → blobUrl 当 script src
    wasm 二进制 → blobUrl 当 wasmBinaryPath
    模型        → baseOptions.modelAssetBuffer（Uint8Array，免掉模型文件请求）

拆成三个文件按需加载：
    inline_runtime.js      运行时（bundle + wasm loader + wasm 二进制）
    inline_model_hand.js   手部模型（鲜花饼「双手合十」）
    inline_model_face.js   人脸模型（奶茶「眨眼封口」）

用法：python tools/build_inline_vendor.py
"""
import base64
import gzip
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, "assets", "vendor", "mediapipe")

# (输出文件名, 全局变量名, [(输出键, 源文件相对路径)])
BUNDLES = [
    (
        "inline_runtime.js",
        "MPInlineRuntime",
        [
            ("BUNDLE", "vision_bundle.mjs"),
            ("WASM_JS", "wasm/vision_wasm_internal.js"),
            ("WASM_BIN", "wasm/vision_wasm_internal.wasm"),
        ],
    ),
    (
        "inline_model_hand.js",
        "MPInlineModelHand",
        [("MODEL", "hand_landmarker.task")],
    ),
    (
        "inline_model_face.js",
        "MPInlineModelFace",
        [("MODEL", "face_landmarker.task")],
    ),
]

HEADER = """/* ============================================================
 * {fname} — file:// 协议下的 MediaPipe 兜底资源（自动生成，勿手改）
 *
 * 浏览器在 file:// 下把页面视为 opaque origin，禁用 fetch / XHR / 动态 import，
 * 导致 MediaPipe 的运行时与模型无法加载。这里把资源 gzip+base64 内联，
 * 运行时还原成 blob URL 即可绕过该限制。
 *
 * 生成方式：python tools/build_inline_vendor.py
 * ============================================================ */
"use strict";
window.{var_name} = (function () {{
"""


def b64_gzip(path: str) -> str:
    with open(path, "rb") as f:
        raw = f.read()
    return base64.b64encode(gzip.compress(raw, 9)).decode("ascii")


def main() -> None:
    total = 0
    for fname, var_name, items in BUNDLES:
        out = os.path.join(VENDOR, fname)
        parts = [HEADER.format(fname=fname, var_name=var_name)]
        for key, rel in items:
            src = os.path.join(VENDOR, rel)
            parts.append(f'  const {key} = "{b64_gzip(src)}";\n')
        parts.append("  return {\n")
        for key, _ in items:
            parts.append(f'    {key}: {key},\n')
        parts.append("  };\n")
        parts.append("})();\n")

        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write("".join(parts))

        size = os.path.getsize(out)
        total += size
        raw = sum(os.path.getsize(os.path.join(VENDOR, rel)) for _, rel in items)
        print(f"已生成 {fname:24} 原始 {raw / 1048576:5.2f} MB → 内联 {size / 1048576:5.2f} MB")

    print(f"合计 {total / 1048576:.1f} MB（仅在 file:// 协议下按需加载）")


if __name__ == "__main__":
    main()
