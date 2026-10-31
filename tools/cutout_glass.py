#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
空玻璃杯抠图（半透明材质专用）。

生成图的背景是白/浅灰棋盘格，但杯身是半透明玻璃，杯内也透出了棋盘格。
处理思路：
  1. 用「中性灰白」判据标出棋盘格像素（r≈g≈b 且亮度高）
  2. 从图像四边泛洪 → 得到「外部背景」mask（杯壁阻隔，泛洪进不去杯内）
  3. 杯子 = 非外部背景 的最大连通域
  4. 杯内透出的棋盘格像素 → alpha 归零（真正透明，让场景与液面透出来）
  5. 杯壁描边 / 奶油贴纸描边 / 玻璃高光 → 保留
"""
import os
import sys
from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage

SRC = sys.argv[1] if len(sys.argv) > 1 else (
    "_gen/参考图风格的手绘扁平插画_单独一只空的透明玻璃杯_奶茶杯___2026-10-29T12-58-50.png")
DST = "assets/ing/奶茶_玻璃杯.png"
PREVIEW = "_debug/_glass_check.png"

# 棋盘格判据阈值
MIN_LUM = 190        # 亮度下限
NEUTRAL = 10         # 通道最大差
FEATHER = 0.8       # 边缘羽化半径


def checker_mask(rgb: np.ndarray) -> np.ndarray:
    """中性灰白 = 棋盘格背景（白格 255 / 灰格 ~225）"""
    r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    neutral = (mx - mn) <= NEUTRAL
    return neutral & (mx >= MIN_LUM)

def relax(mask: np.ndarray) -> np.ndarray:
    """放宽判据：形态学闭运算补上抗锯齿过渡带，让泛洪能连通
    border_value=1：闭运算的腐蚀阶段默认按 0 填充，会把图像四周清空"""
    m = ndimage.binary_closing(mask, np.ones((9, 9)), border_value=1)
    m = ndimage.binary_dilation(m, np.ones((5, 5)))
    return m


def flood_from_border(mask: np.ndarray) -> np.ndarray:
    """从图像四边泛洪：找出所有与边界连通的棋盘格区域"""
    lab, k = ndimage.label(mask)
    if k == 0:
        return np.zeros_like(mask)
    edge = np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])
    edge = edge[edge > 0]
    if edge.size == 0:
        return np.zeros_like(mask)
    keep = np.unique(edge)
    return np.isin(lab, keep)


def main():
    im = Image.open(SRC).convert("RGB")
    rgb = np.array(im)
    H, W = rgb.shape[:2]
    print("原图", im.size)

    chk = checker_mask(rgb)
    print("棋盘格候选像素 %.1f%%" % (chk.sum() / chk.size * 100))

    _r = rgb[:, :, 0].astype(int); _g = rgb[:, :, 1].astype(int); _b = rgb[:, :, 2].astype(int)
    mx = np.maximum(np.maximum(_r, _g), _b)
    mn = np.minimum(np.minimum(_r, _g), _b)
    sat = mx - mn

    bg = flood_from_border(relax(chk))
    print("外部背景泛洪 %.1f%%" % (bg.sum() / bg.size * 100))

    # 杯子 = 非外部背景
    obj = ~bg
    lab, k = ndimage.label(obj)
    sizes = ndimage.sum(obj, lab, index=np.arange(1, k + 1))
    main_lab = int(np.argmax(sizes)) + 1
    cup = (lab == main_lab)
    print("杯子主体占比 %.1f%%" % (cup.sum() / cup.size * 100))

    # ---- 透明化方案（对比 4 版后选定 C）----
    # 浅色弱色偏像素 = 杯内折射变形的棋盘格 + 玻璃高光，整体置透明；
    # 靠杯壁的一条玻璃体保留，维持玻璃杯的通透体量感。
    pale = (sat <= 35) & (mx >= 140)
    dist = ndimage.distance_transform_edt(cup)
    glass_edge = cup & pale & (dist <= 55)
    keep = (cup & ~pale) | glass_edge
    alpha = np.where(keep, 255, 0).astype(np.uint8)

    # 边缘羽化：按到外部背景的距离做 2px 柔和过渡，消除抗锯齿白边
    d2 = ndimage.distance_transform_edt(~bg)
    alpha = (alpha.astype(np.float64) * np.clip(d2 / 2.0, 0, 1)).astype(np.uint8)
    alpha = np.where(alpha < 26, 0, alpha).astype(np.uint8)

    # 羽化边缘
    a = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(FEATHER))
    alpha = np.asarray(a).copy()

    # 输出：RGB 保留原样（杯壁颜色），A 用抠出的通道
    out = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")

    # 去掉右下角生成水印（限定右下角区域，避免误伤杯壁高光）
    a2 = np.array(out)
    al = a2[:, :, 3]
    r, g, b = a2[:, :, 0].astype(int), a2[:, :, 1].astype(int), a2[:, :, 2].astype(int)
    region = np.zeros(al.shape, bool)
    region[int(al.shape[0] * 0.86):, int(al.shape[1] * 0.70):] = True
    wm = (al > 10) & (r > 235) & (g > 235) & (b > 235) & region
    if wm.sum() > 20:
        ys, xs = np.where(wm)
        print("发现右下角水印 %d px，bbox x:%d-%d y:%d-%d（清除）"
              % (wm.sum(), xs.min(), xs.max(), ys.min(), ys.max()))
        a2[wm] = [0, 0, 0, 0]
        out = Image.fromarray(a2, "RGBA")

    # 贴纸描边压暗：奶油米白描边（RGB≈206,190,155）放在深色木台面上过于刺眼，
    # 外圈整体压暗一档并保持暖调，与场景的暖棕木色协调
    a3 = np.array(out)
    solid = a3[:, :, 3] > 20
    d3 = ndimage.distance_transform_edt(solid)
    rim = solid & (d3 <= 30)
    px = a3[:, :, :3].astype(np.float64)
    px[rim] *= 0.84
    a3[:, :, :3] = np.clip(px, 0, 255).astype(np.uint8)
    out = Image.fromarray(a3, "RGBA")

    # 裁到内容 bbox + 留 4px 余量
    bbox = out.getchannel("A").getbbox()
    if bbox:
        x0 = max(0, bbox[0] - 4); y0 = max(0, bbox[1] - 4)
        x1 = min(out.size[0], bbox[2] + 4); y1 = min(out.size[1], bbox[3] + 4)
        out = out.crop((x0, y0, x1, y1))
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    out.save(DST)
    print("已保存", DST, out.size)

    # 棋盘格预览
    prev = out.copy()
    pw, ph = prev.size
    prev.thumbnail((420, 420))
    w2, h2 = prev.size
    bgc = Image.new("RGBA", (w2, h2), (60, 60, 60, 255))
    yy, xx = np.mgrid[0:h2, 0:w2]
    m = ((yy // 12 + xx // 12) % 2) == 0
    a = np.array(bgc)
    a[m] = [225, 225, 225, 255]
    a[~m] = [160, 160, 160, 255]
    bgc = Image.fromarray(a)
    bgc.alpha_composite(prev)
    bgc.convert("RGB").save(PREVIEW)
    print("预览", PREVIEW)


if __name__ == "__main__":
    main()
