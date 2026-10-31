#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
焦糊菜品图处理：
  1. 抹掉右下角「豆包AI生成」水印（用水平线性插值还原背景）
  2. 输出为结果卡可直接使用的方形素材 assets/ing/烧焦.png
"""
import os
from PIL import Image
import numpy as np

SRC = "生成炒焦菜品图片_AI看图.png"
DST = "assets/ing/烧焦.png"

# 水印包围盒（含 4px 余量）
WX0, WY0, WX1, WY1 = 1248, 1442, 1516, 1516


def patch_watermark(arr: np.ndarray) -> np.ndarray:
    """把水印区域用左右外侧像素做水平线性插值填充。"""
    out = arr.copy()
    h, w, _ = arr.shape
    y0, y1 = max(0, WY0), min(h, WY1)
    x0, x1 = max(0, WX0), min(w, WX1)
    # 取水印区左右各 12px 作为插值端点（这些列是干净背景）
    lx, rx = max(0, x0 - 12), min(w - 1, x1 + 12)
    left = arr[y0:y1, lx:lx + 12].astype(np.float64)   # (h', 12, 3)
    right = arr[y0:y1, rx:rx + 12].astype(np.float64)
    # 每行的两端基准色取该 12px 窗口的中位数，避免噪点
    lmed = np.median(left, axis=1)            # (h', 3)
    rmed = np.median(right, axis=1)
    n = x1 - x0
    t = np.arange(n) / max(1, n - 1)               # (n,)
    tt = t[None, :, None]                          # (1, n, 1)
    ramp = lmed[:, None, :] * (1 - tt) + rmed[:, None, :] * tt   # (h', n, 3)
    out[y0:y1, x0:x1] = np.clip(ramp, 0, 255)
    return out


def main():
    im = Image.open(SRC).convert("RGB")
    arr = np.array(im)
    print("原图", im.size)

    arr = patch_watermark(arr)

    # 结果卡里菜品图是正方形，这里取中心正方形并输出 900×900
    w, h = arr.shape[1], arr.shape[0]
    side = min(w, h)
    x0 = (w - side) // 2
    y0 = (h - side) // 2
    cropped = arr[y0:y0 + side, x0:x0 + side]
    out = Image.fromarray(cropped).resize((900, 900), Image.LANCZOS)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    out.save(DST)
    print("已保存", DST, out.size)

    # 预览：右下角放大
    prev = out.crop((520, 640, 900, 880)).resize((760, 480), Image.LANCZOS)
    prev.save("_debug/_burnt_corner.png")


if __name__ == "__main__":
    main()
