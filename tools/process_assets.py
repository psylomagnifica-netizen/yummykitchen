# -*- coding: utf-8 -*-
"""资产预处理：白底转透明（边界洪水填充，保留内部白色）、裁剪、缩放。
输出到 assets/ 供网页使用。运行一次即可，可重复执行。
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")


def white_to_alpha(img: Image.Image, tol=238, max_size=512) -> Image.Image:
    """把与图像边缘相连的接近白色的区域变为透明，保留内部白色内容。"""
    img = img.convert("RGB")
    w, h = img.size
    scale = max_size / max(w, h)
    if scale < 1:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    arr = np.asarray(img).astype(np.int16)
    mn = arr.min(axis=2)
    mx = arr.max(axis=2)
    nearwhite = (mn >= tol) & ((mx - mn) <= 28)

    # 从边界开始的连通白色区域（迭代膨胀法）
    connected = np.zeros(nearwhite.shape, dtype=bool)
    connected[0, :] = nearwhite[0, :]
    connected[-1, :] = nearwhite[-1, :]
    connected[:, 0] = nearwhite[:, 0]
    connected[:, -1] = nearwhite[:, -1]
    while True:
        grown = connected.copy()
        grown[1:, :] |= connected[:-1, :]
        grown[:-1, :] |= connected[1:, :]
        grown[:, 1:] |= connected[:, :-1]
        grown[:, :-1] |= connected[:, 1:]
        grown &= nearwhite
        if (grown == connected).all():
            break
        connected = grown

    alpha = np.where(connected, 0, 255).astype(np.uint8)
    a_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(1.2))
    alpha = np.asarray(a_img)

    rgba = np.dstack([np.asarray(img), alpha])
    out = Image.fromarray(rgba, "RGBA")
    # 裁剪到非透明包围盒
    bbox = Image.fromarray(alpha).getbbox()
    if bbox:
        pad = 4
        l, t, r, b = bbox
        out = out.crop((max(0, l - pad), max(0, t - pad), min(out.width, r + pad), min(out.height, b + pad)))
    return out


def save_cutout(src, dst, crop=None, tol=238, max_size=512):
    img = Image.open(os.path.join(ROOT, src))
    if crop:
        img = img.crop(crop)
    out = white_to_alpha(img, tol=tol, max_size=max_size)
    path = os.path.join(OUT, dst)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)
    print(f"[cutout] {src} -> assets/{dst} {out.size}")


def save_scaled(src, dst, max_size=900, quality=88):
    img = Image.open(os.path.join(ROOT, src)).convert("RGB")
    w, h = img.size
    scale = max_size / max(w, h)
    if scale < 1:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    path = os.path.join(OUT, dst)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, quality=quality)
    print(f"[scaled] {src} -> assets/{dst} {img.size}")


def main():
    os.makedirs(OUT, exist_ok=True)

    # ---- 食材（全部六道菜文件夹）----
    folders = ["炒饭", "粽子", "火锅", "奶茶", "酸菜鱼", "鲜花饼"]
    for folder in folders:
        d = os.path.join(ROOT, folder)
        for fn in sorted(os.listdir(d)):
            if fn.lower().endswith(".png"):
                name = os.path.splitext(fn)[0]
                save_cutout(os.path.join(folder, fn), f"ing/{folder}_{name}.png", max_size=420)

    # ---- 厨具 ----
    # 炒锅：从 13_厨具_厨具组图.png 裁剪（原图 2048x2048，锅在左上区域）
    save_cutout("13_厨具_厨具组图.png", "tool/wok.png", crop=(300, 60, 1450, 950), max_size=640)
    save_cutout("_chk_02_蒸笼.png", "tool/steamer.png", max_size=560)
    save_cutout("_chk_03_锅铲.png", "tool/spatula.png", max_size=560)
    save_cutout("_dbg_bowl_alpha.png", "tool/bowl.png", max_size=480)
    save_cutout("_dbg_board_full.png", "tool/board.png", max_size=560)

    # ---- 菜品成品大图（菜单卡 / 结果卡用，保留原背景）----
    dishes = ["01_菜品_奶茶", "02_菜品_粽子", "03_菜品_火锅", "04_菜品_炒饭", "05_菜品_酸菜鱼", "06_菜品_鲜花饼"]
    for nm in dishes:
        save_scaled(f"{nm}.png", f"dish/{nm}.jpg", max_size=860)

    # ---- 场景背景 ----
    save_scaled("14_场景_厨房窗边.png", "scene/kitchen.jpg", max_size=1600)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
