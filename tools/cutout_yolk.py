#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
炒饭「鸡蛋」新素材抠图（2026-10-30）。

源图：炒饭/蛋黄.png（1536×1536，豆包AI生成）
  * 背景是暖白色（RGB≈252,248,245，暖度 R−B ≈ 8）
  * 主体是金黄蛋黄 + 一圈半透明蛋白（暖度 R−B 40~240）
  * 右下角有「豆包AI生成」水印

做法：
  1. 用「亮度高 + 暖度低」作为背景种子，从画面四边泛洪出背景；
     蛋白边缘（暖度 23~40）会挡住泛洪，因此保留在主体里，轮廓不糊。
  2. 泛洪背景的补集取最大连通域 → 蛋黄+蛋白整体轮廓；
     蛋黄上的白色高光（暖度低但被蛋黄包住）靠填洞补回。
  3. 用到背景的距离变换做 3px 羽化，得到柔边 alpha。
  4. 去白边（de-fringe）：半透明边缘像素的 RGB 换成最近的实心像素颜色，
     避免叠在深色锅底上出现一圈白雾。
  5. 裁到内容并输出 assets/ing/炒饭_鸡蛋_蛋黄.png。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "炒饭", "蛋黄.png")
DST = os.path.join(ROOT, "assets", "ing", "炒饭_鸡蛋_蛋黄.png")
PREVIEW = os.path.join(ROOT, "_debug", "_cut_yolk.png")


# ---------------------------------------------------------------- 工具
def border_flood(mask):
    """只保留与画面边缘连通的连通域。"""
    lab, n = ndimage.label(mask)
    if n == 0:
        return np.zeros_like(mask)
    edge = np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])
    keep = np.unique(edge[edge > 0])
    if keep.size == 0:
        return np.zeros_like(mask)
    return np.isin(lab, keep)


def largest_component(mask):
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, index=np.arange(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)


def de_fringe(rgb, alpha):
    """半透明边缘像素的 RGB → 最近的实心像素颜色，消除白边。"""
    solid = alpha >= 250
    if not solid.any():
        return rgb
    _, idx = ndimage.distance_transform_edt(~solid, return_indices=True)
    return rgb[idx[0], idx[1]]


def crop_to_content(img, pad=6):
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad),
                     min(img.width, r + pad), min(img.height, b + pad)))


def preview(im, path, cell=460):
    im = im.copy()
    im.thumbnail((cell, cell), Image.LANCZOS)
    w, h = im.size
    yy, xx = np.mgrid[0:h, 0:w]
    m = ((yy // 12 + xx // 12) % 2) == 0
    bg = np.zeros((h, w, 3), np.uint8)
    bg[m] = [110, 78, 52]
    bg[~m] = [86, 60, 40]
    base = Image.fromarray(bg, "RGB").convert("RGBA")
    base.alpha_composite(im)
    base.convert("RGB").save(path)
    print(f"  预览 {os.path.relpath(path, ROOT)}")


# ---------------------------------------------------------------- 主流程
def cutout_yolk():
    print("[炒饭_鸡蛋_蛋黄]")
    im = Image.open(SRC).convert("RGB")
    rgb = np.array(im).astype(int)
    H, W = rgb.shape[:2]

    lum = rgb.max(axis=2)
    warm = rgb[:, :, 0] - rgb[:, :, 2]

    # 1) 背景种子：亮 + 不暖
    seed = (lum >= 236) & (warm <= 22)
    bg = border_flood(seed)
    print(f"  背景占比 {bg.mean() * 100:.1f}%")

    # 2) 主体 = 背景补集的最大连通域 + 填洞（蛋黄上的高光）
    obj = largest_component(~bg)
    obj = ndimage.binary_fill_holes(obj)
    print(f"  主体占比 {obj.mean() * 100:.1f}%")

    # 3) 柔边 alpha：到背景的距离 1→4px 渐变
    dist = ndimage.distance_transform_edt(obj)
    alpha = np.clip((dist - 1.0) / 3.0, 0, 1) * 255.0

    # 右下角水印：明确清零（它本来就在裁切区外，双保险）
    watermark = (rgb[:, :, 0] < 235) & (np.arange(H)[:, None] > H * 0.86) & \
                (np.arange(W)[None, :] > W * 0.80)
    alpha[watermark] = 0
    # 水印周围一圈浅灰也不留
    alpha = np.where(watermark, 0, alpha)

    # 4) 去白边
    rgb2 = de_fringe(rgb, alpha.astype(np.uint8))

    out = Image.fromarray(
        np.dstack([rgb2[:, :, 0], rgb2[:, :, 1], rgb2[:, :, 2],
                   np.clip(alpha, 0, 255)]).astype(np.uint8), "RGBA")
    out = crop_to_content(out)
    # 缩到合理分辨率：备料卡最大 84px、锅内宽度 46%，560px 宽绰绰有余，
    # 但原图 1536px 直接存会有 800KB+ 的 PNG
    if out.width > 560:
        out = out.resize((560, round(out.height * 560 / out.width)), Image.LANCZOS)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    out.save(DST, optimize=True)
    print(f"  → {os.path.relpath(DST, ROOT)}  {out.size}  "
          f"可见 {(np.array(out.getchannel('A')) > 10).mean() * 100:.1f}%")

    preview(out, PREVIEW)
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(os.path.join(ROOT, "_debug"), exist_ok=True)
    cutout_yolk()
    print("完成")
