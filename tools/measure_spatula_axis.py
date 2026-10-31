#!/usr/bin/env python3
"""测量锅铲素材的轴向与朝向（供 js/friedrice.js 的常量使用）

做法：
  1. 取 alpha 通道做 PCA，得到素材长轴；
  2. 用「暖度 R-B」把木柄从金属铲头里分出来，给长轴定向；
  3. 以图片中心（= CSS transform-origin）为原点，分别算出
     「铲头侧质心」和「手柄侧质心」的指向角；
  4. 用 alpha 掩膜的凸包顶点量出铲头尖端 / 手柄末端离中心的距离比例。

输出：
  铲头指向角 HEAD_DIR_DEG（正 x 向右、正 y 向下）
  手柄指向角 HANDLE_DIR_DEG
  铲头尖端比例 HEAD_TIP_RATIO、手柄末端比例 HANDLE_TIP_RATIO

用法：python tools/measure_spatula_axis.py
"""
import os
import numpy as np
from PIL import Image
from scipy.spatial import ConvexHull

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "tool", "spatula.png")


def measure(path=SRC):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float64)
    alpha = a[..., 3] / 255.0
    W, H = im.size
    c = np.array([W / 2.0, H / 2.0])          # 图片中心 = CSS transform-origin

    ys, xs = np.nonzero(alpha > 0.5)
    pts = np.stack([xs, ys], 1).astype(np.float64)

    cov = np.cov((pts - pts.mean(0)).T)
    w, v = np.linalg.eigh(cov)
    axis = v[:, np.argmax(w)]                 # 长轴（±180° 歧义）

    warm = a[..., 0] - a[..., 2]              # 暖度：木柄是棕色，金属铲头不是
    brown = (warm > 45) & (alpha > 0.5)
    by, bx = np.nonzero(brown)
    bc = np.array([bx.mean(), by.mean()])
    if (bc - c) @ axis < 0:                   # 让 axis 正方向指向木柄
        axis = -axis

    proj = (pts - c) @ axis
    lim = np.abs(proj).max()
    head = pts[proj < -0.05 * lim]
    hand = pts[proj > 0.05 * lim]

    hv = head.mean(0) - c
    av = hand.mean(0) - c
    head_deg = np.degrees(np.arctan2(hv[1], hv[0]))
    handle_deg = np.degrees(np.arctan2(av[1], av[0]))

    # 凸包顶点：铲头最远的金属片尖角 / 手柄最远的末端
    hull = ConvexHull(pts)
    vs = pts[hull.vertices]
    d = np.linalg.norm(vs - c, axis=1)        # 各顶点到中心的距离
    side = (vs - c) @ axis                    # 沿长轴的符号：负=铲头侧
    head_tip_ratio = float(d[side < 0].max()) / W
    handle_tip_ratio = float(d[side > 0].max()) / W

    return {
        "size": (W, H),
        "HEAD_DIR_DEG": round(float(head_deg), 1),
        "HANDLE_DIR_DEG": round(float(handle_deg), 1),
        "HEAD_TIP_RATIO": round(head_tip_ratio, 3),
        "HANDLE_TIP_RATIO": round(handle_tip_ratio, 3),
    }


if __name__ == "__main__":
    m = measure()
    print("素材尺寸       :", m["size"])
    print("HEAD_DIR_DEG   :", m["HEAD_DIR_DEG"], "  (铲头指向角)")
    print("HANDLE_DIR_DEG :", m["HANDLE_DIR_DEG"], "  (手柄指向角)")
    print("HEAD_TIP_RATIO :", m["HEAD_TIP_RATIO"], " (铲头尖端离中心的比例)")
    print("HANDLE_TIP_RATIO:", m["HANDLE_TIP_RATIO"], " (手柄末端离中心的比例)")
    print()
    print("js/friedrice.js 中应写成：")
    print("  const HEAD_DIR_DEG    = %s;" % m["HEAD_DIR_DEG"])
    print("  const HANDLE_DIR_DEG  = %s;" % m["HANDLE_DIR_DEG"])
    print("  const HEAD_TIP_RATIO  = %s;" % m["HEAD_TIP_RATIO"])
    print("  const HANDLE_TIP_RATIO = %s;" % m["HANDLE_TIP_RATIO"])
