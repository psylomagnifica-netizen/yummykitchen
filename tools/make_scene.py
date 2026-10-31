# -*- coding: utf-8 -*-
"""生成「烹饪专用场景图」。

原 14_场景_厨房窗边.png 下半部自带蒸笼 / 黑锅 / 陶碗等厨具，
与游戏内叠加的锅具、蒸笼、碗重复，视觉冲突且遮挡交互元素。

处理思路：
  1. 保留原图上方的窗景、暖光与植物（美术质量最高的部分）；
  2. 下半部换成程序生成的暖色木台面：
     - 用多频正弦叠加 + 结疤模拟木纹
     - 台面上沿做厚度高光边，下方做柜体暗部
     - 叠加原图的暖光衰减，保持与窗景一致的光感
  3. 结果是一个干净、无厨具、可承载游戏元素的舞台背景。

用法：python tools/make_scene.py
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "14_场景_厨房窗边.png")
OUT = os.path.join(ROOT, "assets", "scene")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT, exist_ok=True)
    img = Image.open(SRC).convert("RGB")
    W, H = img.size
    arr = np.asarray(img).astype(float)

    # 台面上沿（窗台下方开始是灶台区）
    counter_top = int(H * 0.455)
    ch = H - counter_top

    # ---- 台面木纹 ----
    ys = np.arange(ch).reshape(-1, 1)
    t = ys / ch

    # 基础色：台面暖木 → 柜体深棕
    base_top = np.array([206.0, 160.0, 100.0])
    base_bot = np.array([118.0, 80.0, 48.0])
    # 前 26% 是台面（亮），其后是柜体（暗）
    surface = (t < 0.26).astype(float)
    ramp_s = np.clip(t / 0.26, 0, 1)
    ramp_c = np.clip((t - 0.26) / 0.74, 0, 1)
    wood = (base_top[None, :] * (1 - ramp_s) + np.array([158.0, 116.0, 72.0])[None, :] * ramp_s)
    wood = wood * (1 - surface) + (base_bot[None, :] * (1 - ramp_c) +
                                   np.array([84.0, 56.0, 34.0])[None, :] * ramp_c) * surface
    wood = np.repeat(wood[:, None, :], W, axis=1)

    # 木纹：横向多频 + 纵向 + 结疤
    rng = np.random.default_rng(23)
    grain = np.zeros((ch, W))
    for f, amp in ((0.42, 13.0), (1.15, 9.0), (2.9, 6.0), (6.7, 3.6), (15.0, 2.0)):
        wave = np.sin(np.linspace(0, f * np.pi * 2, W)[None, :]
                      + rng.random() * 6.28 + t * (1.2 + rng.random() * 3.0))
        grain += amp * wave
    for f, amp in ((1.9, 4.0), (5.3, 2.2)):
        grain += amp * np.sin(np.linspace(0, f * np.pi * 2, ch)[:, None]
                              + rng.random() * 6.28)
    for _ in range(18):
        kx = rng.integers(0, W)
        ky = rng.integers(0, int(ch * 0.26))
        krad = rng.integers(50, 150)
        d = np.sqrt(((np.arange(W) - kx)[None, :] / krad) ** 2 +
                    ((np.arange(ch) - ky)[:, None] / (krad * 0.30)) ** 2)
        grain += 20 * np.exp(-d ** 2 * 2.4)
    wood += grain[:, :, None]

    # 台面厚度高光 + 台沿下的阴影
    edge = np.zeros((ch, W))
    edge[:10, :] = np.linspace(40, 0, 10)[:, None]
    edge[10:22, :] = np.linspace(0, -34, 12)[:, None]
    wood += edge[:, :, None]

    # 光感：台面受窗光（较亮），向下进入柜体逐渐变暗
    light = np.ones(ch)
    light[:int(ch * 0.26)] = np.linspace(1.06, 0.98, int(ch * 0.26))
    light[int(ch * 0.26):] = np.linspace(0.98, 0.70, ch - int(ch * 0.26))
    wood *= light[:, None, None]

    # 暗角
    xx = np.linspace(-1, 1, W)[None, :]
    yy = np.linspace(-1, 1, ch)[:, None]
    wood *= (1 - 0.11 * (xx ** 2 + yy ** 2))[:, :, None]

    out = arr.copy()
    out[counter_top:, :, :] = wood
    result = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    path = os.path.join(OUT, "kitchen.jpg")
    result.save(path, quality=93)
    print(f"[scene] 14_场景_厨房窗边.png -> assets/scene/kitchen.jpg {result.size}")


if __name__ == "__main__":
    main()
