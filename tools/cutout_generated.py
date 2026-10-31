# -*- coding: utf-8 -*-
"""生成素材抠图 —— 把「棋盘格伪透明底」的真实透明底还原出来。

问题：ImageGen 声称 background=transparent，实际把棋盘格（227灰 / 255白）画进了 RGB，
       alpha 全 255。需要自己抠。

判据：
  背景 = 亮度高(>=205) 且 近乎无色(|max-min| <= 18) 的灰白像素
  主体 = 黑色锅体 + 奶油米白贴纸描边（描边带黄味，饱和度高，不会误判）

流程：
  1. 灰白判据 → 候选背景
  2. 只删「与画面边界连通」的背景（避免误伤锅内高光）
  3. 保留最大连通域（去掉孤立噪点）
  4. 擦掉右下角生成水印
  5. 羽化 + 裁剪
"""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(ROOT, "_gen")
OUT = os.path.join(ROOT, "assets", "tool")

BG_MIN_V = 205     # 背景亮度下限
BG_MAX_SAT = 20    # 背景最大色差


def load_generated(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = mx - mn
    cand = (mx >= BG_MIN_V) & (sat <= BG_MAX_SAT)
    return im, cand


def border_flood(mask):
    """返回与画面边界连通的 True 区域（用于从边界扩散的背景）。"""
    h, w = mask.shape
    seeds = np.zeros_like(mask)
    seeds[0, :] = mask[0, :]
    seeds[-1, :] = mask[-1, :]
    seeds[:, 0] = mask[:, 0]
    seeds[:, -1] = mask[:, -1]
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    keep = set(np.unique(lab[seeds & mask]))
    keep.discard(0)
    if not keep:
        return mask
    out = np.zeros_like(mask)
    for k in keep:
        out |= (lab == k)
    return out


def erase_rect(arr, box, feather=1):
    """把矩形区域的 alpha 抹掉。"""
    l, t, r, b = box
    h, w = arr.shape
    l, t = max(0, l), max(0, t)
    r, b = min(w, r), min(h, b)
    if r <= l or b <= t:
        return
    arr[t:b, l:r] = 0
    if feather > 0:
        # 用距离做羽化，避免硬边
        region = np.zeros_like(arr, dtype=bool)
        region[max(0, t - feather):min(h, b + feather), max(0, l - feather):min(w, r + feather)] = True
        dist = ndimage.distance_transform_edt(region)
        soft = np.clip(dist / (feather + 0.001), 0, 1)
        arr[region] = (arr[region] * soft[region]).astype(arr.dtype)


def cutout_wok(src, dst, max_size=760):
    im, cand = load_generated(src)
    a = np.asarray(im).astype(int)

    bg = border_flood(cand)
    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # 只保留最大连通域
    lab, n = ndimage.label(alpha > 128)
    if n > 1:
        sizes = ndimage.sum(alpha > 128, lab, index=np.arange(1, n + 1))
        alpha = np.where(lab == (int(np.argmax(sizes)) + 1), alpha, 0).astype(np.uint8)

    # 擦掉右下角生成水印
    h, w = alpha.shape
    erase_rect(alpha, (int(w * 0.76), int(h * 0.945), w, h), feather=2)

    # 羽化边缘
    alpha = np.asarray(Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.8))).copy()

    out = Image.fromarray(
        np.stack([np.asarray(im)[:, :, 0], np.asarray(im)[:, :, 1],
                  np.asarray(im)[:, :, 2], alpha], axis=-1).astype(np.uint8),
        "RGBA")

    scale = max_size / max(out.size)
    if scale < 1:
        out = out.resize((int(out.width * scale), int(out.height * scale)), Image.LANCZOS)

    # 裁到可见范围
    bbox = out.getchannel("A").getbbox()
    if bbox:
        pad = 4
        l, t, r, b = bbox
        out = out.crop((max(0, l - pad), max(0, t - pad),
                        min(out.width, r + pad), min(out.height, b + pad)))

    out.save(dst)
    vis = (np.asarray(out.getchannel("A")) > 10).sum() / out.size[0] / out.size[1] * 100
    print(f"[cutout] wok -> {dst}  {out.size}  可见={vis:.1f}%")
    return out


def preview_checker(im, path, cell=420):
    im = im.copy()
    im.thumbnail((cell, cell), Image.LANCZOS)
    w, h = im.size
    yy, xx = np.mgrid[0:h, 0:w]
    m = ((yy // 14 + xx // 14) % 2) == 0
    bg = np.zeros((h, w, 3), np.uint8)
    bg[m] = [92, 66, 44]
    bg[~m] = [74, 52, 35]
    base = Image.fromarray(bg, "RGB").convert("RGBA")
    base.alpha_composite(im)
    base.convert("RGB").save(path)
    print(f"[cutout] 预览 -> {path}")


if __name__ == "__main__":
    import glob
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    src = sorted(glob.glob(os.path.join(GEN, "*.png")))[0]
    out = cutout_wok(src, os.path.join(OUT, "wok.png"))
    preview_checker(out, os.path.join(ROOT, "_wok_check.png"))
