#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""预览「碗 + 米」的叠放方案，确定网页上两者的相对位置与缩放比例。"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOWL = os.path.join(ROOT, "assets", "tool", "bowl_new.png")
RICE = os.path.join(ROOT, "assets", "ing", "米_散.png")
OUT = os.path.join(ROOT, "_debug")

CARD = 320          # 预览卡片边长
STAGE = (110, 78, 52)


def compose(bowl_scale, rice_scale, rice_cx, rice_cy, name):
    """bowl_scale/rice_scale 相对卡片宽度的比例；rice_cx/cy 为米堆中心占比"""
    card = Image.new("RGBA", (CARD, CARD), STAGE + (255,))
    bw = int(CARD * bowl_scale)
    bowl = Image.open(BOWL).convert("RGBA")
    bowl = bowl.resize((bw, int(bowl.height * bw / bowl.width)), Image.LANCZOS)
    # 碗底部贴卡片底部
    card.alpha_composite(bowl, ((CARD - bowl.width) // 2, CARD - bowl.height))
    rw = int(CARD * rice_scale)
    rice = Image.open(RICE).convert("RGBA")
    rice = rice.resize((rw, int(rice.height * rw / rice.width)), Image.LANCZOS)
    card.alpha_composite(rice, (int(CARD * rice_cx) - rw // 2, int(CARD * rice_cy) - rice.height // 2))
    card.convert("RGB").save(os.path.join(OUT, name))
    print(name, "完成")


if __name__ == "__main__":
    # A：米堆居中于碗口中央
    compose(1.0, 0.62, 0.50, 0.44, "_combo_A.png")
    # B：米堆偏上（像堆在碗里，底部被碗沿挡）
    compose(1.0, 0.58, 0.50, 0.34, "_combo_B.png")
    # C：碗略小，米堆偏右下（像倒在碗边）
    compose(0.92, 0.56, 0.52, 0.52, "_combo_C.png")
