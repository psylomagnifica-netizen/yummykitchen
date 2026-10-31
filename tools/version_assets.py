# -*- coding: utf-8 -*-
"""素材引用版本化 —— 给所有 assets/xxx.png 追加 ?v=N 查询串。

浏览器对同名图片会走启发式缓存（If-Modified-Since → 304），
导致「素材已重新生成，但页面里看到的还是旧图」。
给引用加版本参数后，URL 变化即强制重新下载，
同时以后更新素材只需把版本号 +1。

用法：python tools/version_assets.py [版本号]
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = [
    os.path.join(ROOT, "index.html"),
    os.path.join(ROOT, "css", "style.css"),
]
JS_DIR = os.path.join(ROOT, "js")

PATTERN = re.compile(r"(\.\./)?(assets/[A-Za-z0-9_/\u4e00-\u9fa5\-]+\.(?:png|jpg|jpeg|webp))(\?v=\d+)?")


def bump(version: int):
    n = 0
    files = list(TARGETS) + [os.path.join(JS_DIR, f) for f in sorted(os.listdir(JS_DIR)) if f.endswith(".js")]
    for path in files:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            src = f.read()
        out = PATTERN.sub(lambda m: f"{m.group(1) or ''}{m.group(2)}?v={version}", src)
        if out != src:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(out)
            cnt = len(PATTERN.findall(src))
            n += cnt
            print(f"  [v] {os.path.relpath(path, ROOT):28s} {cnt} 处")
    print(f"[version] 共更新 {n} 处引用 -> ?v={version}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    v = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    bump(v)
