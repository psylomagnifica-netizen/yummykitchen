#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
奶茶「装满牛奶」素材：生成牛奶遮罩（供网页 multiply 染色用）。

原图是一杯不透明白牛奶。玩家选的茶底（红茶/乌龙/茉莉）需要体现在杯中，
做法是网页上叠一层茶色并用本遮罩 clip 住 —— 只染牛奶，玻璃壁与奶油描边不动。

牛奶区判定（原图里牛奶是**大面积平滑暖白**，玻璃与描边都不是）：
  1. 排除奶油描边：饱和度高 + 明显偏暖
  2. 排除玻璃壁/杯口深色线稿：亮度低，或偏青（暖度为负）
  3. 剩余候选里，从牛奶中心做连通域泛洪 → 得到完整的牛奶主体
  4. 填洞 + 闭运算 + 羽化，得到柔和的遮罩

遮罩与成品图同尺寸同裁剪，网页上两者盒子重合即可对齐。
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUP = os.path.join(ROOT, "assets", "ing", "奶茶_装满牛奶.png")
MASK = os.path.join(ROOT, "assets", "ing", "奶茶_牛奶遮罩.png")


def main():
    im = Image.open(CUP).convert("RGBA")
    a = np.array(im).astype(int)
    H, W = a.shape[:2]
    rgb, alpha = a[:, :, :3], a[:, :, 3]

    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = mx - mn
    warm = rgb[:, :, 0] - rgb[:, :, 2]

    cream = (sat > 38) & (warm > 38)      # 奶油描边
    dark = mx < 195                        # 玻璃线稿 / 杯口深色边
    teal = warm < -2                       # 青绿色玻璃反光
    cand = (alpha > 128) & ~cream & ~dark & ~teal
    print(f"候选像素 {cand.mean() * 100:.1f}%")

    # 牛奶被杯口那条青蓝色高光线分成两块：上方的液面椭圆 + 下方的杯内奶体。
    # 两次都从各自中心泛洪取连通域，再合并。
    def flood(seed_y, seed_x, limit_y=None):
        if limit_y is None:
            m = cand
        else:
            m = cand.copy()
            m[limit_y:] = False
        lab, n = ndimage.label(m)
        if n == 0:
            return np.zeros_like(m)
        s = lab[seed_y, seed_x]
        if s == 0:
            return np.zeros_like(m)
        out = lab == s
        out = ndimage.binary_fill_holes(out)
        out = ndimage.binary_closing(out, np.ones((13, 13)), border_value=1)
        return ndimage.binary_fill_holes(out)

    # 下半部分：透过杯壁看到的奶体
    body = flood(int(H * 0.60), int(W * 0.40))
    # 上半部分：液面椭圆（被青蓝高光线隔开，单独取）
    top = flood(int(H * 0.25), int(W * 0.50), limit_y=int(H * 0.35))
    milk = body | top
    print(f"奶体 {body.mean() * 100:.1f}%  液面 {top.mean() * 100:.1f}%"
          f"  合计 {milk.mean() * 100:.1f}%")

    for y in range(0, H, 160):
        xs = np.where(milk[y])[0]
        if len(xs):
            print(f"  y={y:4d} ({y / H * 100:4.1f}%)  x {xs.min():4d}~{xs.max():4d}"
                  f"  ({xs.min() / W * 100:4.1f}%~{xs.max() / W * 100:4.1f}%)")

    # 存成 RGBA：RGB 全白，alpha = 牛奶区。CSS mask-image 默认用 alpha 通道。
    mk = Image.fromarray((milk * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(4.0))
    rgba = Image.merge("RGBA", (
        Image.new("L", (W, H), 255), Image.new("L", (W, H), 255),
        Image.new("L", (W, H), 255), mk))
    rgba.save(MASK)
    print("遮罩 →", os.path.relpath(MASK, ROOT), rgba.size)

    # 预览：茶色 multiply 到牛奶上
    base = Image.new("RGBA", (W, H), (74, 54, 38, 255))
    base.alpha_composite(im)
    tint = Image.new("RGBA", (W, H), (180, 85, 45, 255))
    tint.putalpha(mk)
    base.alpha_composite(tint)
    base.convert("RGB").resize((380, 514)).save(os.path.join(ROOT, "_debug", "_milk_multiply.png"))
    print("预览 _debug/_milk_multiply.png")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
