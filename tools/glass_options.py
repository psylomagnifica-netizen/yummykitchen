#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""玻璃杯透明化方案对比：输出多种 alpha 方案的棋盘格预览"""
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = "_gen/参考图风格的手绘扁平插画_单独一只空的透明玻璃杯_奶茶杯___2026-10-29T12-58-50.png"

rgb = np.array(Image.open(SRC).convert("RGB"))
r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
sat = mx - mn

chk = (sat <= 10) & (mx >= 190)
m = ndimage.binary_closing(chk, np.ones((9, 9)), border_value=1)
m = ndimage.binary_dilation(m, np.ones((5, 5)))
lab, k = ndimage.label(m)
edge = np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])
bg = np.isin(lab, np.unique(edge[edge > 0]))
cup = ~bg

dist = ndimage.distance_transform_edt(cup)
print("cup 内 dist 分布: p50=%.0f p90=%.0f p99=%.0f max=%.0f"
      % (np.percentile(dist[cup], 50), np.percentile(dist[cup], 90),
         np.percentile(dist[cup], 99), dist[cup].max()))
h, _ = np.histogram(dist[cup], bins=40, range=(0, 240))
print("dist 直方图(6px/桶):", list(h))

# ---- 方案 A：宽色差判据（清掉所有浅色弱色偏，含玻璃高光） ----
A = cup & ~((sat <= 35) & (mx >= 140))

# ---- 方案 B：距离分层（外圈描边带 + 深色线保留，其余透明） ----
rim = dist <= 30                       # 奶油贴纸描边带
dark = cup & (mx < 150)                # 墨绿线 / 深色结构
B = cup & (rim | dark)

# ---- 方案 C：宽色差 + 距离双条件（浅色且靠近杯壁的保留成玻璃边） ----
glass_edge = cup & (sat <= 35) & (mx >= 140) & (dist <= 55)
C = (cup & ~((sat <= 35) & (mx >= 140))) | glass_edge

# ---- 方案 D：只保留墨绿线与奶油描边（暖色/深色），玻璃高光整体去掉 ----
warm = cup & ((r.astype(int) - b.astype(int)) > 28)
D = (cup & (mx < 150)) | warm

for name, mask in [("A", A), ("B", B), ("C", C), ("D", D)]:
    alpha = np.where(mask, 255, 0).astype(np.uint8)
    d = ndimage.distance_transform_edt(~bg)
    alpha = (alpha.astype(np.float64) * np.clip(d / 2.0, 0, 1)).astype(np.uint8)
    alpha = np.where(alpha < 26, 0, alpha).astype(np.uint8)
    out = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
    bb = out.getchannel("A").getbbox()
    if bb:
        out = out.crop((max(0, bb[0] - 4), max(0, bb[1] - 4),
                        min(out.size[0], bb[2] + 4), min(out.size[1], bb[3] + 4)))
    out.save(f"_debug/_glass_{name}.png")
    print(f"方案{name}: 输出 {out.size} 可见 {(np.array(out)[:, :, 3] > 10).sum() / max(1, (bb[2]-bb[0])*(bb[3]-bb[1])) * 100:.1f}%")

# 拼合预览
cells = []
for name in "ABCD":
    im = Image.open(f"_debug/_glass_{name}.png").convert("RGBA")
    im.thumbnail((300, 300))
    w, h = im.size
    chkbg = Image.new("RGBA", (w, h), (60, 60, 60, 255))
    yy, xx = np.mgrid[0:h, 0:w]
    mm = ((yy // 10 + xx // 10) % 2) == 0
    aa = np.array(chkbg)
    aa[mm] = [228, 228, 228, 255]
    aa[~mm] = [150, 150, 150, 255]
    chkbg = Image.fromarray(aa)
    chkbg.alpha_composite(im)
    cells.append((name, chkbg.convert("RGB")))

W = sum(c.size[0] for _, c in cells) + 16 * len(cells)
H = max(c.size[1] for _, c in cells) + 16
sheet = Image.new("RGB", (W, H), (35, 35, 35))
x = 0
for name, c in cells:
    sheet.paste(c, (x, 8)); x += c.size[0] + 16
sheet.save("_debug/_glass_options.png")
print("对比图 _debug/_glass_options.png  (A/B/C/D)")
