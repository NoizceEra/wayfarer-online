#!/usr/bin/env python3
"""
tools/generate_projectile_sheets.py
Procedurally synthesizes authentic 16-bit Ninja Adventure / Game Boy styled
animated projectile spritesheet PNGs for Wayfarer Online.

Outputs:
  public/assets/custom/fx/proj_ice_shard.png        (96x16: 4 frames of 24x16)
  public/assets/custom/fx/proj_lightning_spear.png  (128x16: 4 frames of 32x16)
  public/assets/custom/fx/proj_void_arrow.png       (96x16: 4 frames of 24x16)
  public/assets/custom/fx/proj_nature_seed.png      (64x16: 4 frames of 16x16)
  public/assets/custom/fx/proj_holy_lance.png       (128x16: 4 frames of 32x16)
"""

import os
import math
from typing import List, Tuple
from PIL import Image

RGBA = Tuple[int, int, int, int]
TRANSPARENT: RGBA = (0, 0, 0, 0)
OUTLINE: RGBA = (26, 16, 36, 255)  # 1px Dark Outline #1a1024

class PixelCanvas:
    def __init__(self, width: int, height: int):
        self.w = width
        self.h = height
        self.grid: List[List[RGBA]] = [[TRANSPARENT for _ in range(width)] for _ in range(height)]

    def set(self, x: int, y: int, color: RGBA):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.grid[y][x] = color

    def get(self, x: int, y: int) -> RGBA:
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.grid[y][x]
        return TRANSPARENT

    def is_opaque(self, x: int, y: int) -> bool:
        return self.get(x, y)[3] > 0

    def draw_rect(self, x0: int, y0: int, w: int, h: int, fill: RGBA):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                self.set(x, y, fill)

    def draw_line(self, x0: int, y0: int, x1: int, y1: int, color: RGBA, width: int = 1):
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        r = (width - 1) // 2
        while True:
            if width == 1:
                self.set(x0, y0, color)
            else:
                for ox in range(-r, r + 1):
                    for oy in range(-r, r + 1):
                        self.set(x0 + ox, y0 + oy, color)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def draw_circle(self, cx: int, cy: int, r: int, fill: RGBA):
        r2 = r * r
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r2:
                    self.set(cx + dx, cy + dy, fill)

    def draw_ellipse(self, cx: int, cy: int, rx: float, ry: float, fill: RGBA):
        irx = int(math.ceil(rx))
        iry = int(math.ceil(ry))
        for dy in range(-iry, iry + 1):
            for dx in range(-irx, irx + 1):
                if (dx / max(0.1, rx)) ** 2 + (dy / max(0.1, ry)) ** 2 <= 1.0:
                    self.set(cx + dx, cy + dy, fill)

    def draw_ring(self, cx: int, cy: int, r_inner: float, r_outer: float, fill: RGBA):
        ir = int(math.ceil(r_outer))
        r_in2 = r_inner * r_inner
        r_out2 = r_outer * r_outer
        for dy in range(-ir, ir + 1):
            for dx in range(-ir, ir + 1):
                d2 = dx * dx + dy * dy
                if r_in2 <= d2 <= r_out2:
                    self.set(cx + dx, cy + dy, fill)

    def draw_diamond(self, cx: int, cy: int, rx: int, ry: int, fill: RGBA):
        for dy in range(-ry, ry + 1):
            for dx in range(-rx, rx + 1):
                if (abs(dx) / max(1, rx)) + (abs(dy) / max(1, ry)) <= 1.0:
                    self.set(cx + dx, cy + dy, fill)

    def draw_polygon(self, pts: List[Tuple[int, int]], fill: RGBA):
        if len(pts) < 3:
            return
        min_y = max(0, min(p[1] for p in pts))
        max_y = min(self.h - 1, max(p[1] for p in pts))
        for y in range(min_y, max_y + 1):
            nodes: List[float] = []
            j = len(pts) - 1
            for i in range(len(pts)):
                p1 = pts[i]
                p2 = pts[j]
                if (p1[1] < y and p2[1] >= y) or (p2[1] < y and p1[1] >= y):
                    x = p1[0] + (y - p1[1]) / float(p2[1] - p1[1]) * (p2[0] - p1[0])
                    nodes.append(x)
                j = i
            nodes.sort()
            for k in range(0, len(nodes), 2):
                if k + 1 < len(nodes):
                    x_start = max(0, int(math.ceil(nodes[k])))
                    x_end = min(self.w - 1, int(math.floor(nodes[k + 1])))
                    for x in range(x_start, x_end + 1):
                        self.set(x, y, fill)

    def add_outline(self, outline_color: RGBA, diagonal: bool = True):
        to_outline: List[Tuple[int, int]] = []
        for y in range(self.h):
            for x in range(self.w):
                if not self.is_opaque(x, y):
                    has_neighbor = False
                    neighbors = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
                    if diagonal:
                        neighbors += [(x + 1, y + 1), (x - 1, y + 1), (x + 1, y - 1), (x - 1, y - 1)]
                    for nx, ny in neighbors:
                        if 0 <= nx < self.w and 0 <= ny < self.h:
                            if self.is_opaque(nx, ny):
                                has_neighbor = True
                                break
                    if has_neighbor:
                        to_outline.append((x, y))
        for x, y in to_outline:
            self.set(x, y, outline_color)

    def to_image(self) -> Image.Image:
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                px[x, y] = self.grid[y][x]
        return im

def assemble_sheet(frames: List[PixelCanvas]) -> Image.Image:
    fw, fh = frames[0].w, frames[0].h
    n = len(frames)
    sheet = Image.new("RGBA", (fw * n, fh), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f.to_image(), (i * fw, 0))
    return sheet

# -----------------------------------------------------------------------------
# 1. Ice Shard (24x16, 4 frames)
# -----------------------------------------------------------------------------
def generate_proj_ice_shard() -> Image.Image:
    FW, FH = 24, 16
    ICE_ABYSS = (26, 50, 85, 255)
    ICE_DEEP = (45, 95, 155, 255)
    ICE_MID = (85, 160, 215, 255)
    ICE_LIGHT = (155, 220, 245, 255)
    ICE_HIGHLIGHT = (215, 248, 255, 255)
    WHITE = (255, 255, 255, 255)
    FROST_DUST = (185, 235, 255, 255)
    frames = []

    for frame_idx in range(4):
        c = PixelCanvas(FW, FH)
        if frame_idx == 0:
            c.draw_polygon([(5, 7), (12, 4), (20, 7), (13, 7)], ICE_LIGHT)
            c.draw_polygon([(5, 7), (13, 7), (20, 7), (12, 11)], ICE_DEEP)
            c.draw_line(5, 7, 12, 4, ICE_HIGHLIGHT)
            c.draw_line(12, 4, 20, 7, ICE_HIGHLIGHT)
            c.draw_line(5, 7, 13, 7, ICE_HIGHLIGHT)
            c.draw_line(13, 7, 20, 7, ICE_HIGHLIGHT)
            c.draw_line(5, 7, 12, 11, ICE_ABYSS)
            c.draw_line(12, 11, 20, 7, ICE_ABYSS)
            c.draw_diamond(12, 7, 2, 2, WHITE)
            c.set(20, 7, WHITE)
            c.set(2, 5, FROST_DUST)
            c.set(3, 10, FROST_DUST)
        elif frame_idx == 1:
            c.draw_polygon([(5, 7), (12, 4), (20, 7), (14, 6)], ICE_HIGHLIGHT)
            c.draw_polygon([(5, 7), (14, 6), (20, 7), (13, 9)], ICE_MID)
            c.draw_polygon([(5, 7), (13, 9), (20, 7), (12, 11)], ICE_DEEP)
            c.draw_line(5, 7, 12, 4, ICE_HIGHLIGHT)
            c.draw_line(12, 4, 20, 7, WHITE)
            c.draw_line(5, 7, 12, 11, ICE_ABYSS)
            c.draw_line(12, 11, 20, 7, ICE_ABYSS)
            c.draw_rect(10, 7, 5, 2, WHITE)
            c.draw_diamond(12, 7, 3, 2, ICE_HIGHLIGHT)
            c.set(12, 7, WHITE)
            c.set(20, 7, WHITE)
            c.set(3, 4, FROST_DUST)
            c.set(1, 9, FROST_DUST)
        elif frame_idx == 2:
            c.draw_polygon([(5, 7), (12, 4), (20, 7), (13, 7)], ICE_DEEP)
            c.draw_polygon([(5, 7), (13, 7), (20, 7), (12, 11)], ICE_LIGHT)
            c.draw_line(5, 7, 12, 4, ICE_ABYSS)
            c.draw_line(12, 4, 20, 7, ICE_ABYSS)
            c.draw_line(5, 7, 13, 7, ICE_HIGHLIGHT)
            c.draw_line(13, 7, 20, 7, WHITE)
            c.draw_line(5, 7, 12, 11, ICE_HIGHLIGHT)
            c.draw_line(12, 11, 20, 7, ICE_HIGHLIGHT)
            c.draw_diamond(13, 8, 2, 2, WHITE)
            c.set(20, 7, WHITE)
            c.set(2, 6, FROST_DUST)
            c.set(4, 9, FROST_DUST)
        else:
            c.draw_polygon([(5, 7), (12, 4), (20, 7), (13, 6)], ICE_MID)
            c.draw_polygon([(5, 7), (13, 6), (20, 7), (14, 8)], ICE_HIGHLIGHT)
            c.draw_polygon([(5, 7), (14, 8), (20, 7), (12, 11)], ICE_LIGHT)
            c.draw_line(5, 7, 12, 4, ICE_HIGHLIGHT)
            c.draw_line(12, 4, 20, 7, ICE_HIGHLIGHT)
            c.draw_line(5, 7, 12, 11, ICE_ABYSS)
            c.draw_line(12, 11, 20, 7, ICE_ABYSS)
            c.draw_diamond(12, 7, 2, 2, WHITE)
            c.set(20, 7, WHITE)
            c.set(1, 5, FROST_DUST)
            c.set(3, 10, FROST_DUST)
        c.add_outline(OUTLINE)
        frames.append(c)

    return assemble_sheet(frames)

# -----------------------------------------------------------------------------
# 2. Lightning Spear (32x16, 4 frames)
# -----------------------------------------------------------------------------
def generate_proj_lightning_spear() -> Image.Image:
    FW, FH = 32, 16
    ELEC_NAVY = (25, 25, 60, 255)
    ELEC_BLUE = (45, 90, 180, 255)
    ELEC_CYAN = (75, 210, 245, 255)
    ELEC_YELLOW = (255, 230, 65, 255)
    ELEC_PALE = (255, 250, 175, 255)
    WHITE = (255, 255, 255, 255)
    SPARK_ORANGE = (255, 140, 35, 255)
    frames = []

    for f_idx in range(4):
        c = PixelCanvas(FW, FH)
        # Javelin Shaft
        c.draw_rect(6, 7, 16, 2, WHITE)
        c.draw_line(6, 6, 21, 6, ELEC_YELLOW)
        c.draw_line(6, 9, 21, 9, ELEC_BLUE)
        # Rear Power Node
        c.draw_diamond(6, 7, 2, 2, ELEC_CYAN)
        c.set(6, 7, WHITE)
        # Barbed Spearhead
        c.draw_polygon([(21, 7), (23, 4), (28, 7), (23, 11)], ELEC_CYAN)
        c.draw_polygon([(21, 7), (24, 6), (28, 7), (24, 9)], ELEC_PALE)
        c.draw_line(21, 7, 28, 7, WHITE)
        c.set(28, 7, WHITE)

        # Dynamic crackling electric arcs per frame
        if f_idx == 0:
            c.draw_line(11, 6, 14, 3, ELEC_CYAN)
            c.draw_line(14, 3, 17, 5, WHITE)
            c.draw_line(17, 5, 20, 6, ELEC_CYAN)
            c.draw_line(6, 9, 8, 12, ELEC_CYAN)
            c.draw_line(8, 12, 11, 10, WHITE)
            c.draw_line(11, 10, 13, 9, ELEC_CYAN)
            c.draw_diamond(3, 6, 1, 1, ELEC_CYAN)
            c.set(3, 6, WHITE)
            c.set(2, 6, SPARK_ORANGE)
            c.set(2, 10, ELEC_YELLOW)
        elif f_idx == 1:
            c.draw_line(8, 6, 11, 2, ELEC_CYAN)
            c.draw_line(11, 2, 15, 4, WHITE)
            c.draw_line(15, 4, 18, 6, ELEC_YELLOW)
            c.draw_line(12, 9, 15, 13, ELEC_CYAN)
            c.draw_line(15, 13, 18, 11, WHITE)
            c.draw_line(18, 11, 21, 9, ELEC_CYAN)
            c.set(2, 4, ELEC_YELLOW)
            c.set(3, 8, SPARK_ORANGE)
            c.set(1, 7, WHITE)
        elif f_idx == 2:
            c.draw_line(13, 6, 16, 2, WHITE)
            c.draw_line(16, 2, 19, 5, ELEC_CYAN)
            c.draw_line(7, 9, 10, 13, ELEC_CYAN)
            c.draw_line(10, 13, 14, 10, WHITE)
            c.draw_diamond(25, 7, 2, 2, WHITE)
            c.set(3, 5, SPARK_ORANGE)
            c.set(2, 9, ELEC_CYAN)
        else:
            c.draw_line(7, 6, 10, 3, ELEC_CYAN)
            c.draw_line(10, 3, 13, 5, WHITE)
            c.draw_line(15, 9, 18, 12, ELEC_CYAN)
            c.draw_line(18, 12, 21, 9, WHITE)
            c.set(1, 5, ELEC_YELLOW)
            c.set(2, 8, WHITE)
            c.set(3, 11, SPARK_ORANGE)

        c.add_outline(OUTLINE)
        frames.append(c)

    return assemble_sheet(frames)

# -----------------------------------------------------------------------------
# 3. Void Arrow (24x16, 4 frames)
# -----------------------------------------------------------------------------
def generate_proj_void_arrow() -> Image.Image:
    FW, FH = 24, 16
    VOID_BLACK = (18, 10, 28, 255)
    VOID_PURPLE = (55, 20, 80, 255)
    VOID_VIOLET = (115, 38, 155, 255)
    VOID_MAGENTA = (195, 60, 210, 255)
    VOID_LILAC = (235, 155, 250, 255)
    VOID_CYAN = (110, 235, 255, 255)
    WHITE = (255, 255, 255, 255)
    frames = []

    for f_idx in range(4):
        c = PixelCanvas(FW, FH)
        # Shadow Shaft
        c.draw_rect(6, 7, 11, 2, VOID_BLACK)
        c.draw_line(6, 6, 16, 6, VOID_PURPLE)
        c.draw_line(6, 9, 16, 9, VOID_PURPLE)

        # Fletching Vanes
        c.draw_polygon([(3, 4), (6, 6), (5, 7), (2, 5)], VOID_VIOLET)
        c.draw_line(3, 4, 6, 6, VOID_LILAC)
        c.draw_polygon([(3, 11), (6, 9), (5, 8), (2, 10)], VOID_PURPLE)
        c.draw_line(3, 11, 6, 9, VOID_VIOLET)

        # Arrowhead
        c.draw_polygon([(16, 4), (21, 7), (18, 7)], VOID_VIOLET)
        c.draw_polygon([(16, 11), (21, 8), (18, 8)], VOID_PURPLE)
        c.draw_line(16, 4, 21, 7, VOID_LILAC)
        c.draw_line(16, 11, 21, 8, VOID_PURPLE)
        c.draw_line(17, 7, 20, 7, VOID_MAGENTA)
        c.set(21, 7, WHITE)
        c.set(18, 7, VOID_CYAN)  # Rift Eye

        # Undulating shadow tendrils
        if f_idx == 0:
            c.draw_line(10, 7, 12, 4, VOID_MAGENTA)
            c.draw_line(12, 4, 14, 5, VOID_LILAC)
            c.draw_line(14, 5, 15, 7, VOID_VIOLET)
            c.draw_line(6, 8, 8, 11, VOID_MAGENTA)
            c.draw_line(8, 11, 10, 10, VOID_PURPLE)
            c.set(2, 6, VOID_MAGENTA)
            c.set(1, 8, VOID_PURPLE)
        elif f_idx == 1:
            c.draw_line(8, 7, 10, 3, VOID_LILAC)
            c.draw_line(10, 3, 13, 5, VOID_MAGENTA)
            c.draw_line(11, 8, 13, 12, VOID_LILAC)
            c.draw_line(13, 12, 15, 9, VOID_MAGENTA)
            c.set(2, 4, VOID_LILAC)
            c.set(1, 9, VOID_MAGENTA)
        elif f_idx == 2:
            c.draw_line(11, 7, 13, 3, VOID_MAGENTA)
            c.draw_line(13, 3, 16, 6, VOID_LILAC)
            c.draw_line(7, 8, 9, 12, VOID_MAGENTA)
            c.draw_line(9, 12, 12, 9, VOID_PURPLE)
            c.set(18, 7, WHITE)  # Blinding eye flare
            c.set(2, 5, VOID_CYAN)
            c.set(1, 7, VOID_MAGENTA)
        else:
            c.draw_line(7, 7, 9, 4, VOID_LILAC)
            c.draw_line(9, 4, 12, 6, VOID_MAGENTA)
            c.draw_line(10, 8, 12, 11, VOID_MAGENTA)
            c.draw_line(12, 11, 14, 9, VOID_LILAC)
            c.set(3, 7, VOID_MAGENTA)
            c.set(1, 6, VOID_PURPLE)

        c.add_outline(OUTLINE)
        frames.append(c)

    return assemble_sheet(frames)

# -----------------------------------------------------------------------------
# 4. Nature Seed (16x16, 4 frames)
# -----------------------------------------------------------------------------
def generate_proj_nature_seed() -> Image.Image:
    FW, FH = 16, 16
    BARK_DARK = (45, 26, 16, 255)
    BARK_MID = (92, 54, 28, 255)
    MOSS_SHADOW = (28, 70, 32, 255)
    MOSS_MID = (60, 140, 50, 255)
    LEAF_LIME = (130, 210, 60, 255)
    GOLD_POLLEN = (255, 210, 55, 255)
    PALE_SPORE = (255, 250, 145, 255)
    WHITE = (255, 255, 255, 255)
    frames = []

    for f_idx in range(4):
        c = PixelCanvas(FW, FH)
        if f_idx == 0:
            c.draw_polygon([(7, 5), (9, 5), (8, 2)], LEAF_LIME)
            c.draw_polygon([(7, 11), (9, 11), (8, 13)], BARK_DARK)
            c.draw_polygon([(5, 7), (5, 9), (2, 8)], MOSS_MID)
            c.draw_polygon([(11, 7), (11, 9), (14, 8)], LEAF_LIME)
            c.draw_circle(8, 8, 3, BARK_MID)
            c.draw_circle(7, 7, 2, MOSS_MID)
            c.set(7, 6, LEAF_LIME)
            c.set(8, 6, LEAF_LIME)
            c.draw_rect(7, 9, 3, 2, BARK_DARK)
            c.draw_diamond(8, 8, 1, 1, GOLD_POLLEN)
            c.set(8, 8, WHITE)
            c.set(2, 5, GOLD_POLLEN)
            c.set(1, 10, LEAF_LIME)
        elif f_idx == 1:
            c.draw_polygon([(9, 6), (10, 7), (13, 3)], LEAF_LIME)
            c.draw_polygon([(6, 9), (7, 10), (3, 13)], BARK_DARK)
            c.draw_polygon([(6, 6), (7, 5), (3, 3)], MOSS_MID)
            c.draw_polygon([(9, 9), (10, 10), (13, 13)], LEAF_LIME)
            c.draw_circle(8, 8, 3, BARK_MID)
            c.draw_circle(7, 7, 2, MOSS_MID)
            c.set(8, 6, LEAF_LIME)
            c.draw_rect(7, 9, 3, 2, BARK_DARK)
            c.draw_diamond(8, 8, 1, 1, PALE_SPORE)
            c.set(8, 8, WHITE)
            c.set(1, 6, GOLD_POLLEN)
            c.set(14, 10, PALE_SPORE)
        elif f_idx == 2:
            c.draw_polygon([(7, 5), (9, 5), (8, 2)], MOSS_MID)
            c.draw_polygon([(7, 11), (9, 11), (8, 13)], BARK_DARK)
            c.draw_polygon([(5, 7), (5, 9), (2, 8)], LEAF_LIME)
            c.draw_polygon([(11, 7), (11, 9), (14, 8)], MOSS_MID)
            c.draw_circle(8, 8, 3, BARK_MID)
            c.draw_circle(7, 7, 2, MOSS_MID)
            c.set(7, 6, LEAF_LIME)
            c.draw_rect(7, 9, 3, 2, BARK_DARK)
            c.draw_diamond(8, 8, 1, 1, GOLD_POLLEN)
            c.set(8, 8, WHITE)
            c.set(2, 4, LEAF_LIME)
            c.set(1, 9, GOLD_POLLEN)
        else:
            c.draw_polygon([(9, 6), (10, 7), (13, 3)], MOSS_MID)
            c.draw_polygon([(6, 9), (7, 10), (3, 13)], BARK_DARK)
            c.draw_polygon([(6, 6), (7, 5), (3, 3)], LEAF_LIME)
            c.draw_polygon([(9, 9), (10, 10), (13, 13)], MOSS_MID)
            c.draw_circle(8, 8, 3, BARK_MID)
            c.draw_circle(7, 7, 2, MOSS_MID)
            c.set(8, 6, LEAF_LIME)
            c.draw_rect(7, 9, 3, 2, BARK_DARK)
            c.draw_diamond(8, 8, 1, 1, PALE_SPORE)
            c.set(8, 8, WHITE)
            c.set(1, 5, PALE_SPORE)
            c.set(2, 11, LEAF_LIME)

        c.add_outline(OUTLINE)
        frames.append(c)

    return assemble_sheet(frames)

# -----------------------------------------------------------------------------
# 5. Holy Lance (32x16, 4 frames)
# -----------------------------------------------------------------------------
def generate_proj_holy_lance() -> Image.Image:
    FW, FH = 32, 16
    SACRED_BROWN = (68, 40, 18, 255)
    SACRED_GOLD_DARK = (150, 95, 25, 255)
    SACRED_GOLD = (215, 160, 35, 255)
    SACRED_YELLOW = (255, 215, 65, 255)
    HOLY_LIGHT = (255, 245, 140, 255)
    DIVINE_AURA = (210, 235, 255, 255)
    WHITE = (255, 255, 255, 255)
    SACRED_DUST = (255, 235, 150, 255)
    frames = []

    for f_idx in range(4):
        c = PixelCanvas(FW, FH)
        # Spear Shaft
        c.draw_line(6, 7, 20, 7, SACRED_YELLOW)
        c.draw_line(6, 8, 20, 8, SACRED_GOLD)
        c.draw_line(8, 7, 18, 7, HOLY_LIGHT)

        # Pommel Jewel
        c.draw_diamond(5, 7, 2, 2, SACRED_GOLD)
        c.set(5, 7, SACRED_YELLOW)
        c.draw_line(4, 7, 3, 7, SACRED_GOLD_DARK)

        # Crossguard
        c.draw_line(19, 4, 19, 11, SACRED_GOLD)
        c.draw_line(20, 5, 20, 10, SACRED_YELLOW)
        c.set(19, 4, HOLY_LIGHT)
        c.set(19, 11, SACRED_GOLD_DARK)

        # Rotating/Pulsing Divine Halo
        if f_idx == 0:
            c.draw_ring(19, 7, 3.2, 4.2, DIVINE_AURA)
        elif f_idx == 1:
            c.draw_ring(19, 7, 4.0, 5.2, DIVINE_AURA)
            c.set(19, 2, WHITE)
            c.set(19, 13, WHITE)
        elif f_idx == 2:
            c.draw_ring(19, 7, 3.2, 4.2, HOLY_LIGHT)
            c.draw_diamond(24, 7, 2, 2, WHITE)
        else:
            c.draw_ring(19, 7, 2.5, 3.5, DIVINE_AURA)
            c.set(19, 3, WHITE)
            c.set(19, 12, WHITE)

        # Spearhead Beveled Crystal
        c.draw_polygon([(20, 7), (24, 4), (28, 7), (24, 7)], HOLY_LIGHT)
        c.draw_polygon([(20, 8), (24, 8), (28, 8), (24, 11)], SACRED_GOLD)
        c.draw_line(20, 7, 28, 7, WHITE)
        c.draw_line(20, 8, 24, 11, SACRED_GOLD_DARK)
        c.draw_line(24, 11, 28, 8, SACRED_GOLD_DARK)
        c.draw_line(20, 7, 24, 4, WHITE)
        c.draw_line(24, 4, 28, 7, WHITE)
        c.draw_diamond(24, 7, 1, 1, WHITE)
        c.set(28, 7, WHITE)

        # Trailing Sacred Dust
        if f_idx == 0:
            c.set(2, 6, SACRED_DUST)
            c.set(3, 10, SACRED_DUST)
        elif f_idx == 1:
            c.set(1, 5, SACRED_DUST)
            c.set(2, 8, SACRED_YELLOW)
            c.set(3, 11, SACRED_DUST)
        elif f_idx == 2:
            c.set(2, 4, SACRED_DUST)
            c.set(1, 7, WHITE)
            c.set(3, 9, SACRED_DUST)
        else:
            c.set(3, 6, SACRED_DUST)
            c.set(1, 8, SACRED_DUST)
            c.set(2, 10, SACRED_YELLOW)

        c.add_outline(OUTLINE)
        frames.append(c)

    return assemble_sheet(frames)


def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root_dir, "public", "assets", "custom", "fx")
    os.makedirs(out_dir, exist_ok=True)

    specs = [
        ("proj_ice_shard.png", generate_proj_ice_shard, (96, 16), 4, 24, 16),
        ("proj_lightning_spear.png", generate_proj_lightning_spear, (128, 16), 4, 32, 16),
        ("proj_void_arrow.png", generate_proj_void_arrow, (96, 16), 4, 24, 16),
        ("proj_nature_seed.png", generate_proj_nature_seed, (64, 16), 4, 16, 16),
        ("proj_holy_lance.png", generate_proj_holy_lance, (128, 16), 4, 32, 16),
    ]

    for filename, generator_fn, expected_size, n_frames, fw, fh in specs:
        img = generator_fn()
        assert img.size == expected_size, f"{filename}: size {img.size} != {expected_size}"
        assert img.mode == "RGBA", f"{filename}: mode {img.mode} != RGBA"
        alphas = set(img.split()[3].get_flattened_data())
        assert alphas.issubset({0, 255}), f"{filename}: non-binary alpha found: {alphas}"
        out_path = os.path.join(out_dir, filename)
        img.save(out_path, format="PNG")
        print(f"Generated {filename:<25} Size: {img.size[0]}x{img.size[1]} ({n_frames} frames of {fw}x{fh}) -> {out_path}")

    print("\nAll 5 projectile FX spritesheets successfully generated and validated!")

if __name__ == "__main__":
    main()
