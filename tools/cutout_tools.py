# -*- coding: utf-8 -*-
"""厨具素材重制 —— v2（基于「做法/厨具拆分」单件源图）。

与 v1 的差别：
  v1 用泛洪去白底 / 黄底，结果保留了原插画的「奶油白高光描边」。
      这些厨具放大摆在深色木台面上时，白边会变成刺眼光晕
      （鲜花饼案板最明显）。
  v2 额外做一次「白高光剥离」：只削掉轮廓外缘若干像素内、
      近白且低饱和的高光环，内侧奶油描边保留，主体零损伤。

用法：python tools/cutout_tools.py
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "tool")
SRC = os.path.join(ROOT, "..", "做法", "厨具拆分")

# 单件源图 → 输出名
SOURCES = {
    "wok":     "01_炒锅.png",
    "steamer": "02_蒸笼.png",
    "spatula": "03_锅铲.png",
    "board":   "04_案板.png",
    "bowl":    "05_陶碗.png",
}
MAX_SIZE = {"wok": 640, "steamer": 560, "spatula": 520, "board": 560, "bowl": 460}

# 白高光剥离强度（像素）；越大切得越深
HALO_DEPTH = 5
HALO_MX = 200      # 亮度下限
HALO_SAT = 45      # 饱和度上限

# 原插画在厨具底部画了一圈暖金色「地面反光」。它属于画师语言而非抠图残留，
# 但在深色木台面上过于抢眼 —— 这里只把底部该区域的金黄像素淡化，
# 保留一点点暖意，不动主体（木材 / 陶釉 / 竹篾都在暖色区但不满足金黄角度判据）。
FADE_BOTTOM = {"board": 0.64, "wok": 0.62, "bowl": 0.64}
FADE_KEEP = 0.12


def fade_warm_halo(alpha, rgb, ratio):
    """把图像下方指定比例区域内的高饱和金黄像素淡化。"""
    if ratio is None:
        return alpha
    h, w = alpha.shape
    y0 = int(h * ratio)
    region = np.zeros_like(alpha, dtype=bool)
    region[y0:, :] = True

    r = rgb[:, :, 0].astype(float)
    g = rgb[:, :, 1].astype(float)
    b = rgb[:, :, 2].astype(float)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn + 1e-6
    hue = np.zeros_like(mx)
    m = mx == r; hue[m] = ((g - b)[m] / d[m]) % 6
    m = mx == g; hue[m] = ((b - r)[m] / d[m]) + 2
    m = mx == b; hue[m] = ((r - g)[m] / d[m]) + 4
    hue = hue * 60
    sat = np.where(mx > 0, d / np.maximum(mx, 1), 0)
    val = mx / 255.0

    golden = (hue >= 33) & (hue <= 62) & (sat > 0.40) & (val > 0.66) & (alpha > 8)
    hit = golden & region
    if hit.any():
        alpha = alpha.copy()
        alpha[hit] = (alpha[hit] * FADE_KEEP).astype(alpha.dtype)
    return alpha


def strip_halo(alpha, rgb):
    """削掉轮廓外缘的白色高光环。"""
    mx = np.maximum(np.maximum(rgb[:, :, 0], rgb[:, :, 1]), rgb[:, :, 2])
    mn = np.minimum(np.minimum(rgb[:, :, 0], rgb[:, :, 1]), rgb[:, :, 2])
    sat = mx - mn
    halo = (mx > HALO_MX) & (sat < HALO_SAT) & (alpha > 10)

    solid = alpha > 8
    if not solid.any():
        return alpha
    dist = ndimage.distance_transform_edt(solid)   # 像素到最近透明处的距离
    alpha = alpha.copy()
    alpha[halo & (dist <= HALO_DEPTH)] = 0
    return alpha


def largest_component(mask):
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, index=np.arange(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)


def process(name, fname):
    src_path = os.path.join(SRC, fname)
    if not os.path.exists(src_path):
        print(f"[skip] 缺少源文件 {src_path}")
        return None
    img = Image.open(src_path).convert("RGBA")
    scale = MAX_SIZE[name] / max(img.size)
    if scale < 1:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)

    rgb = np.asarray(img.convert("RGB")).astype(int)
    alpha = np.asarray(img)[:, :, 3].copy()

    # 1) 剥白高光
    alpha = strip_halo(alpha, rgb)

    # 2) 淡化底部暖金反光
    alpha = fade_warm_halo(alpha, rgb, FADE_BOTTOM.get(name))

    # 3) 只保留最大连通域，去掉零散残点
    keep = largest_component(alpha > 8)
    alpha = alpha * keep

    # 4) 羽化边缘
    alpha_img = Image.fromarray(alpha.astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.7))
    alpha = np.asarray(alpha_img).copy()

    out = Image.fromarray(
        np.dstack([np.asarray(img.convert("RGB")), alpha]), "RGBA")

    # 4) 裁到可见范围
    bbox = Image.fromarray(alpha, "L").getbbox()
    if bbox:
        pad = 2
        l, t, r, b = bbox
        out = out.crop((max(0, l - pad), max(0, t - pad),
                        min(out.width, r + pad), min(out.height, b + pad)))

    out.save(os.path.join(OUT, f"{name}.png"))
    vis = (alpha > 10).sum() / alpha.size * 100
    print(f"[cutout] {name:8s} -> assets/tool/{name}.png  {out.size}  可见={vis:.1f}%")
    return out


def preview(items, out_path):
    """在木台面棋盘格上并排预览。"""
    cell = 300
    cells = []
    for name, im in items:
        im = im.copy()
        im.thumbnail((cell, cell), Image.LANCZOS)
        w, h = im.size
        bg = np.zeros((h, w, 4), np.uint8)
        yy, xx = np.mgrid[0:h, 0:w]
        m = ((yy // 16 + xx // 16) % 2) == 0
        bg[m] = [92, 66, 44, 255]
        bg[~m] = [74, 52, 35, 255]
        base = Image.fromarray(bg, "RGBA")
        base.alpha_composite(im)
        cells.append((name, base.convert("RGB")))

    from PIL import ImageDraw
    W = sum(c.size[0] for _, c in cells) + 16 * (len(cells) + 1)
    H = max(c.size[1] for _, c in cells) + 30
    sheet = Image.new("RGB", (W, H), (30, 26, 22))
    d = ImageDraw.Draw(sheet)
    x = 16
    for name, c in cells:
        sheet.paste(c, (x, 22))
        d.text((x + 4, 5), name, fill=(240, 230, 210))
        x += c.size[0] + 16
    sheet.save(out_path)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT, exist_ok=True)
    items = []
    for name, fname in SOURCES.items():
        im = process(name, fname)
        if im is not None:
            items.append((name, im))
    preview(items, os.path.join(ROOT, "_tools_checker.png"))
    print("[cutout] 预览 -> _tools_checker.png")


if __name__ == "__main__":
    main()
