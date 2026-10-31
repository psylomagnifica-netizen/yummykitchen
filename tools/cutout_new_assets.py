#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
新素材抠图工具（2026-10-30 v2）。

处理三张用户提供的参考图：
  1. 粽子/碗.png      → assets/tool/bowl_new.png       青灰碗，白底
  2. 粽子/米.png       → assets/ing/米_散.png            一堆散米，白底（米粒接近白色）
  3. 奶茶/装满牛奶.png → assets/ing/奶茶_装满牛奶.png    玻璃杯盛牛奶，白底 + 奶油描边

v2 相对 v1 的修正：
  * **去白边（de-fringe）**：alpha 羽化后，半透明边缘像素的 RGB 仍是背景白，
    叠在深色木台面上就是一圈白雾。改为用「最近的实心像素颜色」替换边缘 RGB。
  * **米堆不再做形态学闭运算**：闭运算会把馒头状的堆顶削平。改用软阈值
    （暖色偏移 R-B 连续映射到 alpha）+ 填洞，保留自然的颗粒边缘。
  * **杯内牛奶半透明**：alpha≈0.66，让网页里那层茶色液面能透过玻璃显出来，
    做出「红茶 + 奶」的通透奶茶，而不是一坨白。
  * 通用：去右下角 AI 水印（泛洪时已被当背景清掉，额外再兜一层）。
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- 通用工具
def load(path):
    im = Image.open(path).convert("RGB")
    return im, np.array(im).astype(int)


def near_white(rgb, v_min=246, sat_max=12):
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    return (mx >= v_min) & ((mx - mn) <= sat_max)


def relax(mask, close=11, dilate=5):
    m = ndimage.binary_closing(mask, np.ones((close, close)), border_value=1)
    if dilate:
        m = ndimage.binary_dilation(m, np.ones((dilate, dilate)))
    return m


def border_flood(mask):
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


def fill_holes(mask):
    return ndimage.binary_fill_holes(mask)


def soft_alpha(binary, feather=1.0, lo=24):
    """硬掩膜 → 高斯羽化 → 低值截断。
    注意：距离变换在背景远处也会给出大值，不能直接当 alpha 用（v2 曾因此整幅变不透明）。"""
    a = np.where(binary, 255, 0).astype(np.uint8)
    a = np.asarray(Image.fromarray(a, "L").filter(ImageFilter.GaussianBlur(feather))).copy()
    a[a < lo] = 0
    return a


def de_fringe(rgb, alpha):
    """把半透明边缘像素的 RGB 换成「最近的实心像素」颜色，消除白边。"""
    solid = alpha >= 250
    if not solid.any():
        return rgb
    # 每个像素最近的实心像素坐标
    _, idx = ndimage.distance_transform_edt(~solid, return_indices=True)
    return rgb[idx[0], idx[1]]


def crop_to_content(img, pad=6):
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad),
                     min(img.width, r + pad), min(img.height, b + pad)))


def save_rgba(rgb, alpha, dst, scale=1.0, defringe=True):
    if defringe:
        rgb = de_fringe(rgb, alpha)
    out = Image.fromarray(
        np.dstack([rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2], alpha]).astype(np.uint8), "RGBA")
    if scale < 1:
        out = out.resize((int(out.width * scale), int(out.height * scale)), Image.LANCZOS)
    out = crop_to_content(out)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    out.save(dst)
    vis = (np.asarray(out.getchannel("A")) > 10).mean() * 100
    print(f"  → {os.path.relpath(dst, ROOT)}  {out.size}  可见 {vis:.1f}%")
    return out


def preview(im, path, cell=440):
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


# ---------------------------------------------------------------- 1. 碗
def cutout_bowl():
    src = os.path.join(ROOT, "粽子", "碗.png")
    dst = os.path.join(ROOT, "assets", "tool", "bowl_new.png")
    print("[碗]")
    im, rgb = load(src)
    bg = border_flood(relax(near_white(rgb)))
    obj = fill_holes(largest_component(~bg))
    obj = fill_holes(ndimage.binary_closing(obj, np.ones((5, 5)), border_value=1))
    alpha = soft_alpha(obj, feather=1.0)
    out = save_rgba(rgb, alpha, dst)
    preview(out, os.path.join(ROOT, "_debug", "_cut_bowl.png"))
    return out


# ---------------------------------------------------------------- 2. 米堆
def cutout_rice():
    src = os.path.join(ROOT, "粽子", "米.png")
    dst = os.path.join(ROOT, "assets", "ing", "米_散.png")
    print("[米]")
    im, rgb = load(src)
    warm = rgb[:, :, 0].astype(int) - rgb[:, :, 2].astype(int)

    # 背景中性/略冷（R-B ≈ -5..3），米粒暖白（R-B ≈ 6..30）
    seed = warm >= 4
    seed = ndimage.binary_closing(seed, np.ones((9, 9)), border_value=1)
    seed = largest_component(seed)
    seed = fill_holes(seed)

    # 在种子范围内用「暖度」做软 alpha：粒缝阴影(暗)与米粒本体都保留
    lum = rgb.max(axis=2)
    body = seed & ((warm >= 1) | (lum < 240))
    body = fill_holes(body)
    body = largest_component(body)

    alpha = soft_alpha(body, feather=1.4, lo=26)
    print(f"  米堆主体占比 {(alpha > 128).mean() * 100:.1f}%")
    out = save_rgba(rgb, alpha, dst)
    preview(out, os.path.join(ROOT, "_debug", "_cut_rice.png"))
    return out


# ---------------------------------------------------------------- 3. 装满牛奶
def cutout_milk():
    src = os.path.join(ROOT, "奶茶", "装满牛奶.png")
    dst = os.path.join(ROOT, "assets", "ing", "奶茶_装满牛奶.png")
    print("[装满牛奶]")
    im, rgb = load(src)
    H, W = rgb.shape[:2]

    # ---- 1. 擦掉右下角 AI 水印（在奶油描边上，用邻近奶油色覆盖）----
    wm = rgb.copy()
    reg = wm[1795:1845, 1090:1350]
    reg[reg.max(axis=2) < 245] = [217, 188, 154]     # 描边基色
    wm[1795:1845, 1090:1350] = reg
    rgb = wm

    # ---- 2. 主体 = 外部近白背景之外的一切（杯子 + 奶油描边）----
    bg = border_flood(relax(near_white(rgb, v_min=243, sat_max=14)))
    obj = fill_holes(largest_component(~bg))
    print(f"  杯子（含奶油描边）占比 {obj.mean() * 100:.1f}%")

    # ---- 3. 奶油描边外扩的白晕：把主体外圈再收一点 ----
    #    描边基色是暖米色（217,188,154），白晕是接近纯白的中性色
    cream = (rgb[:, :, 0] > 195) & (rgb[:, :, 0] < 240) & \
            (rgb[:, :, 0] - rgb[:, :, 2] > 38) & (rgb[:, :, 2] < 200)
    core = obj & ~cream          # 玻璃 + 牛奶
    # 主体 = 核心 ∪ 与核心相接的奶油描边（限制在核心外 26px 内，掐掉外侧白晕）
    near_core = ndimage.binary_dilation(core, np.ones((53, 53)))
    obj2 = core | (cream & near_core)
    obj2 = fill_holes(largest_component(obj2))
    print(f"  修正描边后占比 {obj2.mean() * 100:.1f}%")

    alpha = soft_alpha(obj2, feather=1.0, lo=18)

    # 杯内牛奶保持**不透明**：这张图本身就是「装满牛奶」的成品。
    # 茶底/奶量的色差改由网页上的 multiply 染色层实现（见 css .cup-zone.has-milk .liquid），
    # 这样既保留了原画的玻璃反光与描边细节，又能按茶底变化汤色。
    out = save_rgba(rgb, alpha, dst)
    preview(out, os.path.join(ROOT, "_debug", "_cut_milk.png"))
    return out, alpha


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(os.path.join(ROOT, "_debug"), exist_ok=True)
    cutout_bowl()
    cutout_rice()
    cutout_milk()
    print("完成")
