# -*- coding: utf-8 -*-
"""厨具素材「白高光描边」剥离实验 —— 参数扫描预览。

背景：原插画的厨具是「奶油白描边贴纸」风格。直接摆在深色木台面上时，
     那一圈白色高光会变成刺眼白边（鲜花饼案板最明显）。
     这里做参数扫描，找出「剥离最外圈白色高光、保留内侧奶油描边」的强度。

判据：
  halo  = 近白且低饱和（mx 高、sat 低）
  带域  = 只处理靠近轮廓外缘 D 像素内的像素（dist_to_transparent <= D）
剥离：带域内且属于 halo 的像素 → alpha = 0

用法：python tools/strip_halo.py
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "做法", "厨具拆分")

FILES = {
    "wok":     "01_炒锅.png",
    "steamer": "02_蒸笼.png",
    "spatula": "03_锅铲.png",
    "board":   "04_案板.png",
    "bowl":    "05_陶碗.png",
}
MAX_SIZE = {"wok": 640, "steamer": 560, "spatula": 520, "board": 560, "bowl": 460}
DEPTHS = [0, 4, 7, 10]


def strip_halo(img, depth, mx_thr=200, sat_thr=45):
    """剥离轮廓外缘 depth 像素内的白色高光。"""
    arr = np.asarray(img.convert("RGB")).astype(int)
    alpha = np.asarray(img.convert("RGBA"))[:, :, 3].copy()

    mx = np.maximum(np.maximum(arr[:, :, 0], arr[:, :, 1]), arr[:, :, 2])
    mn = np.minimum(np.minimum(arr[:, :, 0], arr[:, :, 1]), arr[:, :, 2])
    sat = mx - mn
    halo = (mx > mx_thr) & (sat < sat_thr) & (alpha > 10)

    if depth <= 0:
        return alpha

    # 到最近透明像素的距离（像素在轮廓内的「深度」）
    solid = alpha > 8
    if not solid.any():
        return alpha
    dist = ndimage.distance_transform_edt(solid)

    kill = halo & (dist <= depth)
    alpha[kill] = 0
    return alpha


def build_preview(entries, out_path, dark=True):
    """entries: [(label, rgba_image)]"""
    cell_w = 300
    cells = []
    for label, im in entries:
        im = im.copy()
        im.thumbnail((cell_w, cell_w), Image.LANCZOS)
        w, h = im.size
        if dark:
            bg_a = np.zeros((h, w, 4), np.uint8)
            yy, xx = np.mgrid[0:h, 0:w]
            m = ((yy // 16 + xx // 16) % 2) == 0
            bg_a[m] = [92, 66, 44, 255]      # 木台面色
            bg_a[~m] = [74, 52, 35, 255]
        else:
            bg_a = np.full((h, w, 4), 255, np.uint8)
        base = Image.fromarray(bg_a, "RGBA")
        base.alpha_composite(im)
        cells.append((label, base.convert("RGB")))

    W = sum(c.size[0] for _, c in cells) + 16 * (len(cells) + 1)
    H = max(c.size[1] for _, c in cells) + 34
    sheet = Image.new("RGB", (W, H), (30, 26, 22))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    x = 16
    for label, c in cells:
        sheet.paste(c, (x, 26))
        d.text((x + 4, 6), label, fill=(240, 230, 210))
        x += c.size[0] + 16
    sheet.save(out_path)
    return sheet.size


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(os.path.join(ROOT, "tools"), exist_ok=True)

    for name, fname in FILES.items():
        p = os.path.join(SRC, fname)
        if not os.path.exists(p):
            print(f"[skip] 源文件不存在: {p}")
            continue
        src = Image.open(p).convert("RGBA")
        scale = MAX_SIZE[name] / max(src.size)
        if scale < 1:
            src = src.resize((int(src.width * scale), int(src.height * scale)), Image.LANCZOS)

        entries = []
        for d in DEPTHS:
            a = strip_halo(src, d)
            a_img = Image.fromarray(a, "L").filter(ImageFilter.GaussianBlur(0.6))
            out = Image.fromarray(np.dstack([np.asarray(src.convert("RGB")), np.asarray(a_img)]), "RGBA")
            entries.append((f"{name} D={d}", out))
        size = build_preview(entries, os.path.join(ROOT, f"_halo_{name}.png"))
        print(f"[halo] {name}: {size}  (D = {DEPTHS})")


if __name__ == "__main__":
    main()
