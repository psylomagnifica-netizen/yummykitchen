# -*- coding: utf-8 -*-
"""碗装食材 → 生成「去碗版」（只保留内容物，用于入锅显示）。

原始素材如「米饭 / 糯米 / 面粉 / 酸菜」是把食材盛在碗里的插画。
拖进锅里时连碗一起进去不合理，所以额外生成一份裁掉下半部碗体的版本，
入锅时用去碗版，备料区仍显示完整的碗装图标（更符合生活场景）。

做法：按人工指定的横向裁剪线切掉碗体，保留碗沿上方的内容物，
再用 alpha 遮罩把切口做成柔和过渡，避免生硬断边。

用法：python tools/cutout_bowl_free.py
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "ing")

# 源文件 → (裁剪线比例, 输出名)
# 裁剪线比例 = 保留内容物的纵向高度占比（在 512 归一化空间上测得）
BOWL_ITEMS = {
    "炒饭/米饭.png":   ("炒饭_米饭_散.png",   0.56),
    "粽子/糯米.png":   ("粽子_糯米_散.png",   0.50),
    "鲜花饼/面粉.png": ("鲜花饼_面粉_散.png", 0.50),
    "酸菜鱼/酸菜.png": ("酸菜鱼_酸菜_散.png", 0.42),
}


def white_to_alpha(img, tol=238):
    arr = np.asarray(img.convert("RGB")).astype(np.int16)
    mn = arr.min(axis=2)
    mx = arr.max(axis=2)
    nearwhite = (mn >= tol) & ((mx - mn) <= 30)

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
    a_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(1.0))
    return Image.fromarray(np.dstack([np.asarray(img.convert("RGB")), np.asarray(a_img)]), "RGBA")


def make_bowl_free(src_rel, dst_name, cut_ratio):
    img = Image.open(os.path.join(ROOT, src_rel)).convert("RGB")
    scale = 420 / max(img.size)
    if scale < 1:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    rgba = white_to_alpha(img)

    arr = np.asarray(rgba).astype(np.float64)
    h, w = arr.shape[:2]
    alpha = arr[:, :, 3]

    # 裁剪线以下逐渐淡出（柔和过渡）
    cut = int(h * cut_ratio)
    fade = int(h * 0.10)
    for y in range(max(0, cut - fade), h):
        t = (y - (cut - fade)) / max(1, fade)
        arr[y, :, 3] *= max(0.0, 1.0 - t)

    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    bbox = out.getchannel("A").getbbox()
    if bbox:
        l, t, r, b = bbox
        out = out.crop((max(0, l - 2), max(0, t - 2), min(w, r + 2), min(h, b + 2)))
    out.save(os.path.join(OUT, dst_name))
    print(f"[bowl-free] {src_rel} -> assets/ing/{dst_name} {out.size}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT, exist_ok=True)
    for src, (dst, ratio) in BOWL_ITEMS.items():
        make_bowl_free(src, dst, ratio)


if __name__ == "__main__":
    main()
