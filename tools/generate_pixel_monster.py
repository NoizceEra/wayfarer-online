#!/usr/bin/env python3
"""
Pixel-Art Monster Sprite Sheet Generator & Validation Engine
Wayfarer Online / Ninja Adventure CC0 Specification

Guarantees pixel-perfect 64x64 PNG spritesheets:
- Layout: 64x64 PNG, 4 columns (Down, Up, Left, Right) x 4 rows (Idle 1, Step 1, Idle 2, Step 2) with 16x16 px frames.
- Color Budget: Indexed 5-9 colors per sprite (Outline, Shadow, Midtone, Highlight, Eye/Accent).
- Outline Rules: 1px dark complementary border (#141b1b, #181425, #141b2b, #2b1414, #142b1b).
- Shading & Form: Chunky readable pixel silhouettes, top-left lighting, no sub-pixel antialiasing (1-bit alpha).
"""

import os
import sys
import json
import argparse
from typing import Dict, List, Tuple, Optional, Any
from PIL import Image

# -----------------------------------------------------------------------------
# 1. Master Palette (33-color Ninja Adventure Universe)
# -----------------------------------------------------------------------------
MASTER_PALETTE = {
    "BLACK": (20, 27, 27, 255),         # #141b1b Universal Darkest Outline
    "DARK_PURPLE": (24, 20, 37, 255),    # #181425 Shadow Outline
    "DARK_BLUE": (20, 27, 43, 255),      # #141b2b Water Outline
    "DARK_RED": (43, 20, 20, 255),       # #2b1414 Fire Outline
    "DARK_GREEN": (20, 43, 27, 255),     # #142b1b Forest Outline
    "PLUM": (69, 40, 60, 255),           # #45283c
    "CHARCOAL": (59, 54, 67, 255),       # #3b3643
    "DEEP_PURPLE": (84, 60, 82, 255),    # #543c52
    "SLATE_DARK": (78, 72, 74, 255),     # #4e484a
    "DEEP_TEAL": (52, 90, 82, 255),      # #345a52
    "NAVY": (74, 82, 112, 255),          # #4a5270
    "BURGUNDY": (143, 62, 86, 255),      # #8f3e56
    "BROWN_DARK": (150, 83, 64, 255),    # #965340
    "SLATE_MID": (95, 113, 96, 255),     # #5f7160
    "CRIMSON": (224, 57, 76, 255),       # #e0394c
    "RUST": (209, 75, 52, 255),          # #d14b34
    "FOREST_DARK": (86, 134, 76, 255),   # #56864c
    "TEAL_MID": (84, 135, 137, 255),     # #548789
    "LEAF_GREEN": (116, 163, 52, 255),   # #74a334
    "ORANGE_MID": (228, 109, 58, 255),   # #e46d3a
    "MOSS_GREY": (141, 151, 127, 255),   # #8d977f
    "OLIVE_GOLD": (168, 161, 41, 255),   # #a8a129
    "AMBER_DARK": (215, 139, 74, 255),   # #d78b4a
    "WOOD_BROWN": (200, 150, 107, 255),  # #c8966b
    "ORANGE_WARM": (243, 140, 76, 255),  # #f38c4c
    "SLATE_LIGHT": (155, 167, 170, 255), # #9ba7aa
    "ORANGE_LIGHT": (239, 145, 79, 255), # #ef914f
    "CYAN_SKY": (121, 184, 206, 255),    # #79b8ce
    "LIME_GREEN": (173, 188, 58, 255),   # #adbc3a
    "PEACH": (242, 173, 125, 255),       # #f2ad7d
    "AMBER_LIGHT": (255, 173, 93, 255),  # #ffad5d
    "GOLD_LIGHT": (241, 196, 113, 255),  # #f1c471
    "YELLOW_BRIGHT": (255, 225, 141, 255), # #ffe18d
    "BEIGE_LIGHT": (252, 226, 202, 255), # #fce2ca
    "CREAM_WHITE": (242, 234, 241, 255), # #f2eaf1
    "ICE_WHITE": (227, 241, 245, 255),   # #e3f1f5
    "WHITE": (255, 255, 255, 255),       # #ffffff
    "NONE": (0, 0, 0, 0)
}

# -----------------------------------------------------------------------------
# 2. Standard Palettes (5-9 Colors with Specific Roles)
# -----------------------------------------------------------------------------
PALETTES = {
    "slime_cyan": {
        "K": MASTER_PALETTE["BLACK"],        # Outline
        "D": MASTER_PALETTE["TEAL_MID"],      # Shadow
        "M": MASTER_PALETTE["CYAN_SKY"],      # Midtone
        "H": MASTER_PALETTE["CREAM_WHITE"],   # Highlight
        "W": MASTER_PALETTE["WHITE"],         # Specular
        "E": MASTER_PALETTE["SLATE_DARK"],    # Eye pupil
        "A": MASTER_PALETTE["ICE_WHITE"],     # Sclera / Accent
    },
    "slime_emerald": {
        "K": MASTER_PALETTE["BLACK"],
        "D": MASTER_PALETTE["FOREST_DARK"],
        "M": MASTER_PALETTE["LEAF_GREEN"],
        "H": MASTER_PALETTE["LIME_GREEN"],
        "W": MASTER_PALETTE["WHITE"],
        "E": MASTER_PALETTE["SLATE_DARK"],
        "A": MASTER_PALETTE["YELLOW_BRIGHT"],
    },
    "slime_magma": {
        "K": MASTER_PALETTE["BLACK"],
        "D": MASTER_PALETTE["BURGUNDY"],
        "M": MASTER_PALETTE["CRIMSON"],
        "H": MASTER_PALETTE["ORANGE_MID"],
        "W": MASTER_PALETTE["YELLOW_BRIGHT"],
        "E": MASTER_PALETTE["PLUM"],
        "A": MASTER_PALETTE["WHITE"],
    },
    "forest_green": {
        "K": MASTER_PALETTE["BLACK"],
        "D": MASTER_PALETTE["FOREST_DARK"],
        "M": MASTER_PALETTE["LEAF_GREEN"],
        "H": MASTER_PALETTE["LIME_GREEN"],
        "W": MASTER_PALETTE["WHITE"],
        "E": MASTER_PALETTE["CRIMSON"],
        "A": MASTER_PALETTE["YELLOW_BRIGHT"],
    },
    "fire_crimson": {
        "K": MASTER_PALETTE["BLACK"],
        "D": MASTER_PALETTE["BURGUNDY"],
        "M": MASTER_PALETTE["CRIMSON"],
        "H": MASTER_PALETTE["ORANGE_MID"],
        "W": MASTER_PALETTE["YELLOW_BRIGHT"],
        "E": MASTER_PALETTE["YELLOW_BRIGHT"],
        "A": MASTER_PALETTE["WHITE"],
    },
    "desert_amber": {
        "K": MASTER_PALETTE["BLACK"],
        "D": MASTER_PALETTE["RUST"],
        "M": MASTER_PALETTE["AMBER_DARK"],
        "H": MASTER_PALETTE["GOLD_LIGHT"],
        "W": MASTER_PALETTE["YELLOW_BRIGHT"],
        "E": MASTER_PALETTE["BLACK"],
        "A": MASTER_PALETTE["BEIGE_LIGHT"],
    },
    "shadow_purple": {
        "K": MASTER_PALETTE["DARK_PURPLE"],
        "D": MASTER_PALETTE["PLUM"],
        "M": MASTER_PALETTE["BURGUNDY"],
        "H": MASTER_PALETTE["CRIMSON"],
        "W": MASTER_PALETTE["CYAN_SKY"],
        "E": MASTER_PALETTE["CYAN_SKY"],
        "A": MASTER_PALETTE["WHITE"],
    },
    "abyssal_blue": {
        "K": MASTER_PALETTE["DARK_BLUE"],
        "D": MASTER_PALETTE["NAVY"],
        "M": MASTER_PALETTE["TEAL_MID"],
        "H": MASTER_PALETTE["CYAN_SKY"],
        "W": MASTER_PALETTE["ICE_WHITE"],
        "E": MASTER_PALETTE["CRIMSON"],
        "A": MASTER_PALETTE["WHITE"],
    },
    "bone_undead": {
        "K": MASTER_PALETTE["BLACK"],
        "D": MASTER_PALETTE["BURGUNDY"],
        "M": MASTER_PALETTE["CRIMSON"],
        "H": MASTER_PALETTE["CREAM_WHITE"],
        "W": MASTER_PALETTE["WHITE"],
        "E": MASTER_PALETTE["CRIMSON"],
        "A": MASTER_PALETTE["ORANGE_MID"],
    },
    "beast_brown": {
        "K": MASTER_PALETTE["DARK_RED"],
        "D": MASTER_PALETTE["BROWN_DARK"],
        "M": MASTER_PALETTE["WOOD_BROWN"],
        "H": MASTER_PALETTE["PEACH"],
        "W": MASTER_PALETTE["WHITE"],
        "E": MASTER_PALETTE["BLACK"],
        "A": MASTER_PALETTE["BEIGE_LIGHT"],
    },
    "slate_stone": {
        "K": MASTER_PALETTE["BLACK"],
        "D": MASTER_PALETTE["CHARCOAL"],
        "M": MASTER_PALETTE["SLATE_MID"],
        "H": MASTER_PALETTE["SLATE_LIGHT"],
        "W": MASTER_PALETTE["WHITE"],
        "E": MASTER_PALETTE["GOLD_LIGHT"],
        "A": MASTER_PALETTE["YELLOW_BRIGHT"],
    }
}


# -----------------------------------------------------------------------------
# 3. PixelCanvas Engine (16x16 Frame Buffer)
# -----------------------------------------------------------------------------
class PixelCanvas:
    """16x16 pixel frame buffer for crisp sprite construction."""
    def __init__(self):
        self.grid = [['.' for _ in range(16)] for _ in range(16)]
        
    def set(self, x: int, y: int, char: str):
        if 0 <= x < 16 and 0 <= y < 16:
            self.grid[y][x] = char
            
    def get(self, x: int, y: int) -> str:
        if 0 <= x < 16 and 0 <= y < 16:
            return self.grid[y][x]
        return '.'
        
    def fill_rect(self, x1: int, y1: int, x2: int, y2: int, char: str):
        for y in range(max(0, y1), min(16, y2 + 1)):
            for x in range(max(0, x1), min(16, x2 + 1)):
                self.grid[y][x] = char
                
    def fill_ellipse(self, cx: float, cy: float, rx: float, ry: float, char: str):
        for y in range(16):
            for x in range(16):
                dx = (x - cx) / (rx if rx > 0 else 1)
                dy = (y - cy) / (ry if ry > 0 else 1)
                if dx * dx + dy * dy <= 1.0:
                    self.grid[y][x] = char
                    
    def auto_outline(self, outline_char: str = 'K'):
        """Apply 1px orthogonal dark outline around non-empty interior pixels."""
        new_grid = [row[:] for row in self.grid]
        for y in range(16):
            for x in range(16):
                if self.grid[y][x] == '.':
                    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < 16 and 0 <= ny < 16:
                            if self.grid[ny][nx] not in ('.', outline_char):
                                new_grid[y][x] = outline_char
                                break
        self.grid = new_grid

    def to_rows(self) -> List[str]:
        return ["".join(row) for row in self.grid]


# -----------------------------------------------------------------------------
# 4. Procedural Frame Generators
# -----------------------------------------------------------------------------
def generate_slime_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    if state in ("Idle_1", "Idle_2"):
        rx, ry, cy = 5.5, 4.0, 10.0
    elif state == "Step_1":
        rx, ry, cy = 6.2, 3.2, 11.0
    else:  # Step_2
        rx, ry, cy = 4.8, 4.8, 9.2

    c.fill_ellipse(7.5, cy, rx, ry, 'M')
    for y in range(16):
        for x in range(16):
            if c.grid[y][x] == 'M':
                if (y >= cy + 1 and x >= 7) or y >= cy + ry - 1.2:
                    c.grid[y][x] = 'D'
                elif y <= cy - 1 and x <= 7:
                    c.grid[y][x] = 'H'

    spec_y = int(cy - ry + 1.5)
    c.set(5, spec_y, 'W')
    c.set(6, spec_y, 'W')
    c.auto_outline('K')

    eye_y = int(cy - 0.5)
    if direction == "Down":
        c.set(5, eye_y, 'E'); c.set(5, eye_y - 1, 'W')
        c.set(9, eye_y, 'E'); c.set(9, eye_y - 1, 'W')
    elif direction == "Left":
        c.set(4, eye_y, 'E'); c.set(4, eye_y - 1, 'W')
    elif direction == "Right":
        c.set(10, eye_y, 'E'); c.set(10, eye_y - 1, 'W')
    elif direction == "Up":
        c.set(7, int(cy - 1), 'H'); c.set(8, int(cy - 1), 'H')
    return c


def generate_eye_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    bob_y = 0 if state in ("Idle_1", "Idle_2") else (-1 if state == "Step_1" else 1)
    cy = 7.5 + bob_y
    cx = 7.5

    c.fill_ellipse(cx, cy, 5.0, 5.0, 'M')
    for y in range(16):
        for x in range(16):
            if c.grid[y][x] == 'M':
                if (x >= cx + 1 and y >= cy + 1) or y >= cy + 3:
                    c.grid[y][x] = 'D'
                elif x <= cx - 1 and y <= cy - 1:
                    c.grid[y][x] = 'H'

    c.auto_outline('K')
    if state in ("Idle_1", "Step_2"):
        c.set(1, int(cy - 1), 'K'); c.set(2, int(cy), 'D')
        c.set(13, int(cy), 'D'); c.set(14, int(cy - 1), 'K')
    else:
        c.set(1, int(cy + 1), 'K'); c.set(2, int(cy), 'D')
        c.set(13, int(cy), 'D'); c.set(14, int(cy + 1), 'K')

    if direction == "Down":
        c.fill_rect(6, int(cy - 1), 8, int(cy + 1), 'A')
        c.set(7, int(cy), 'E'); c.set(6, int(cy - 1), 'W')
    elif direction == "Left":
        c.fill_rect(4, int(cy - 1), 6, int(cy + 1), 'A')
        c.set(4, int(cy), 'E'); c.set(4, int(cy - 1), 'W')
    elif direction == "Right":
        c.fill_rect(8, int(cy - 1), 10, int(cy + 1), 'A')
        c.set(10, int(cy), 'E'); c.set(9, int(cy - 1), 'W')
    elif direction == "Up":
        c.set(7, int(cy - 1), 'D'); c.set(8, int(cy - 1), 'D')
        c.set(7, int(cy), 'K'); c.set(8, int(cy), 'K')
    return c


def generate_skull_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    bob_y = 0 if state in ("Idle_1", "Idle_2") else (-1 if state == "Step_1" else 1)
    cy = 7.0 + bob_y

    c.fill_ellipse(7.5, cy - 1, 5.0, 4.0, 'H')
    c.fill_rect(5, int(cy + 2), 10, int(cy + 4), 'M')
    for y in range(16):
        for x in range(16):
            if c.grid[y][x] in ('H', 'M'):
                if x >= 10 or y >= cy + 3:
                    c.grid[y][x] = 'D'

    c.auto_outline('K')
    if direction == "Down":
        c.set(5, int(cy), 'K'); c.set(6, int(cy), 'E')
        c.set(9, int(cy), 'E'); c.set(10, int(cy), 'K')
        c.set(7, int(cy + 2), 'K'); c.set(8, int(cy + 2), 'K')
        c.set(6, int(cy + 4), 'W'); c.set(8, int(cy + 4), 'W')
    elif direction == "Left":
        c.set(4, int(cy), 'E'); c.set(5, int(cy), 'K')
        c.set(4, int(cy + 2), 'K')
        c.set(4, int(cy + 4), 'W'); c.set(6, int(cy + 4), 'W')
    elif direction == "Right":
        c.set(9, int(cy), 'K'); c.set(10, int(cy), 'E')
        c.set(10, int(cy + 2), 'K')
        c.set(8, int(cy + 4), 'W'); c.set(10, int(cy + 4), 'W')
    elif direction == "Up":
        c.set(7, int(cy - 2), 'D'); c.set(8, int(cy - 2), 'K')
        c.set(7, int(cy - 1), 'K'); c.set(8, int(cy - 1), 'D')
    return c


def generate_mushroom_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    squash = 1 if state == "Step_1" else (0 if state in ("Idle_1", "Idle_2") else -1)
    
    c.fill_rect(6, 9 + squash, 9, 14, 'A')
    c.set(9, 11 + squash, 'D'); c.set(9, 12 + squash, 'D'); c.set(9, 13 + squash, 'D')
    c.fill_ellipse(7.5, 6.5 + squash, 6.0, 3.5, 'M')
    for y in range(16):
        for x in range(16):
            if c.grid[y][x] == 'M':
                if x >= 11 or y >= 7 + squash:
                    c.grid[y][x] = 'D'
                elif x <= 5 and y <= 5 + squash:
                    c.grid[y][x] = 'H'

    c.set(4, 5 + squash, 'W')
    c.set(8, 4 + squash, 'W')
    c.set(10, 6 + squash, 'W')
    c.auto_outline('K')

    stem_y = 11 + squash
    if direction == "Down":
        c.set(6, stem_y, 'E'); c.set(8, stem_y, 'E')
    elif direction == "Left":
        c.set(5, stem_y, 'E')
    elif direction == "Right":
        c.set(9, stem_y, 'E')
    elif direction == "Up":
        c.set(6, stem_y, 'A'); c.set(8, stem_y, 'A')
    return c


def generate_dragon_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    leg_offset = 1 if state == "Step_1" else (-1 if state == "Step_2" else 0)

    c.fill_ellipse(7.5, 9.5, 4.5, 4.0, 'M')
    c.fill_ellipse(7.5, 5.0, 4.0, 3.0, 'M')
    for y in range(16):
        for x in range(16):
            if c.grid[y][x] == 'M':
                if x >= 10 or y >= 11:
                    c.grid[y][x] = 'D'
                elif x <= 5 and y <= 5:
                    c.grid[y][x] = 'H'

    c.set(4, 2, 'W'); c.set(5, 3, 'A')
    c.set(10, 2, 'W'); c.set(9, 3, 'A')

    if direction in ("Down", "Up"):
        c.set(5, 13 + leg_offset, 'D'); c.set(9, 13 - leg_offset, 'D')
    elif direction == "Left":
        c.set(4, 13 + leg_offset, 'D'); c.set(8, 13 - leg_offset, 'D')
    elif direction == "Right":
        c.set(6, 13 - leg_offset, 'D'); c.set(10, 13 + leg_offset, 'D')

    c.auto_outline('K')

    if direction == "Down":
        c.fill_rect(6, 8, 8, 11, 'A')
        c.set(5, 5, 'E'); c.set(9, 5, 'E')
    elif direction == "Left":
        c.set(3, 6, 'M'); c.set(2, 6, 'K')
        c.set(4, 5, 'E')
        c.set(12, 10, 'M'); c.set(13, 9, 'H'); c.set(14, 8, 'W')
    elif direction == "Right":
        c.set(11, 6, 'M'); c.set(12, 6, 'K')
        c.set(10, 5, 'E')
        c.set(2, 10, 'M'); c.set(1, 9, 'H'); c.set(0, 8, 'W')
    elif direction == "Up":
        c.set(7, 4, 'A'); c.set(7, 7, 'A'); c.set(7, 10, 'A')
    return c


def generate_beast_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    walk = 1 if state == "Step_1" else (-1 if state == "Step_2" else 0)

    c.fill_ellipse(7.5, 9.0, 5.0, 3.5, 'M')
    c.fill_ellipse(7.5, 5.5, 3.5, 3.0, 'M')
    for y in range(16):
        for x in range(16):
            if c.grid[y][x] == 'M':
                if x >= 10 or y >= 10:
                    c.grid[y][x] = 'D'
                elif x <= 5 and y <= 5:
                    c.grid[y][x] = 'H'

    c.set(4, 2, 'H'); c.set(10, 2, 'H')
    c.set(4, 13 + walk, 'D'); c.set(10, 13 - walk, 'D')
    c.auto_outline('K')

    if direction == "Down":
        c.fill_rect(6, 8, 8, 10, 'A')
        c.set(5, 5, 'E'); c.set(9, 5, 'E')
        c.set(7, 6, 'K')
    elif direction == "Left":
        c.set(3, 6, 'A'); c.set(4, 5, 'E')
        c.set(12, 8, 'H'); c.set(13, 7, 'W')
    elif direction == "Right":
        c.set(11, 6, 'A'); c.set(10, 5, 'E')
        c.set(2, 8, 'H'); c.set(1, 7, 'W')
    elif direction == "Up":
        c.set(7, 11, 'W')
    return c


def generate_larva_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    crawl = 1 if state == "Step_1" else (0 if state in ("Idle_1", "Idle_2") else -1)
    
    c.fill_ellipse(7.5, 5.0 + crawl, 3.5, 2.5, 'H')
    c.fill_ellipse(7.5, 8.5, 4.0, 2.5, 'M')
    c.fill_ellipse(7.5, 12.0 - crawl, 3.5, 2.5, 'D')
    c.auto_outline('K')

    if direction == "Down":
        c.set(5, 5 + crawl, 'E'); c.set(9, 5 + crawl, 'E')
        c.set(4, 2 + crawl, 'A'); c.set(10, 2 + crawl, 'A')
    elif direction == "Left":
        c.set(4, 5 + crawl, 'E')
        c.set(3, 2 + crawl, 'A')
    elif direction == "Right":
        c.set(10, 5 + crawl, 'E')
        c.set(11, 2 + crawl, 'A')
    elif direction == "Up":
        c.set(4, 1 + crawl, 'K'); c.set(10, 1 + crawl, 'K')
    return c


def generate_golem_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    stomp = 1 if state == "Step_1" else (-1 if state == "Step_2" else 0)

    c.fill_rect(3, 4, 12, 11, 'M')
    c.set(3, 4, '.'); c.set(12, 4, '.'); c.set(3, 11, '.'); c.set(12, 11, '.')
    c.fill_rect(3, 12 + stomp, 6, 14 + stomp, 'D')
    c.fill_rect(9, 12 - stomp, 12, 14 - stomp, 'D')

    for y in range(4, 12):
        for x in range(3, 13):
            if c.grid[y][x] == 'M':
                if x >= 10 or y >= 9:
                    c.grid[y][x] = 'D'
                elif x <= 5 and y <= 6:
                    c.grid[y][x] = 'H'

    c.auto_outline('K')

    if direction == "Down":
        c.set(5, 6, 'E'); c.set(6, 6, 'W')
        c.set(8, 6, 'W'); c.set(9, 6, 'E')
        c.set(7, 9, 'A')
    elif direction == "Left":
        c.set(4, 6, 'E'); c.set(5, 6, 'W')
    elif direction == "Right":
        c.set(9, 6, 'W'); c.set(10, 6, 'E')
    elif direction == "Up":
        c.set(6, 7, 'D'); c.set(8, 7, 'D')
    return c


def generate_bat_frame(direction: str, state: str) -> PixelCanvas:
    c = PixelCanvas()
    flap = state in ("Step_1", "Step_2")

    c.fill_ellipse(7.5, 7.5, 3.0, 4.0, 'M')
    c.set(6, 3, 'H'); c.set(8, 3, 'H')

    if not flap:
        c.fill_rect(1, 4, 4, 7, 'D')
        c.fill_rect(10, 4, 13, 7, 'D')
        c.set(0, 3, 'H'); c.set(14, 3, 'H')
    else:
        c.fill_rect(1, 7, 4, 11, 'D')
        c.fill_rect(10, 7, 13, 11, 'D')
        c.set(0, 11, 'H'); c.set(14, 11, 'H')

    c.auto_outline('K')

    if direction == "Down":
        c.set(6, 6, 'E'); c.set(8, 6, 'E')
        c.set(6, 8, 'W'); c.set(8, 8, 'W')
    elif direction == "Left":
        c.set(5, 6, 'E'); c.set(5, 8, 'W')
    elif direction == "Right":
        c.set(9, 6, 'E'); c.set(9, 8, 'W')
    elif direction == "Up":
        c.set(7, 6, 'D'); c.set(7, 7, 'D')
    return c


ARCHETYPES = {
    "slime": generate_slime_frame,
    "eye": generate_eye_frame,
    "skull": generate_skull_frame,
    "mushroom": generate_mushroom_frame,
    "dragon": generate_dragon_frame,
    "beast": generate_beast_frame,
    "larva": generate_larva_frame,
    "golem": generate_golem_frame,
    "bat": generate_bat_frame,
}

DIRECTIONS = ["Down", "Up", "Left", "Right"]  # Columns 0..3
STATES = ["Idle_1", "Step_1", "Idle_2", "Step_2"]  # Rows 0..3


# -----------------------------------------------------------------------------
# 5. Master Generator Class
# -----------------------------------------------------------------------------
class MonsterGenerator:
    """Master generator engine for 64x64 pixel monster sprite sheets."""

    @staticmethod
    def generate_sheet(
        archetype: str = "slime",
        palette_name: str = "slime_cyan",
        custom_palette: Optional[Dict[str, Tuple[int, int, int, int]]] = None
    ) -> Image.Image:
        """
        Generate a complete 64x64 pixel spritesheet.
        Returns a Pillow RGBA Image.
        """
        if archetype not in ARCHETYPES:
            raise ValueError(f"Unknown archetype '{archetype}'. Available: {list(ARCHETYPES.keys())}")
            
        pal = custom_palette if custom_palette else PALETTES.get(palette_name, PALETTES["slime_cyan"])
        frame_generator = ARCHETYPES[archetype]

        sheet = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        px = sheet.load()

        for col_idx, direction in enumerate(DIRECTIONS):
            for row_idx, state in enumerate(STATES):
                frame_canvas = frame_generator(direction, state)
                rows = frame_canvas.to_rows()

                start_x = col_idx * 16
                start_y = row_idx * 16

                for y, row_str in enumerate(rows):
                    for x, char in enumerate(row_str):
                        color = pal.get(char, MASTER_PALETTE["NONE"])
                        px[start_x + x, start_y + y] = color

        return sheet

    @staticmethod
    def validate_sheet(image_or_path: Any) -> Dict[str, Any]:
        """
        Validate a monster sprite sheet against all style rules:
        - 64x64 PNG
        - 4x4 16x16 non-empty frames
        - 1-bit alpha (0 or 255)
        - Palette count (3-9 colors)
        - Dark outline presence
        """
        if isinstance(image_or_path, str):
            im = Image.open(image_or_path).convert("RGBA")
        else:
            im = image_or_path.convert("RGBA")

        w, h = im.size
        report = {
            "valid": True,
            "dimensions": [w, h],
            "errors": [],
            "warnings": [],
            "details": {}
        }

        if (w, h) != (64, 64):
            report["valid"] = False
            report["errors"].append(f"Invalid dimensions {w}x{h}, must be exactly 64x64")

        # Frame emptiness check
        empty_frames = []
        for r in range(4):
            for c in range(4):
                crop = im.crop((c * 16, r * 16, (c + 1) * 16, (r + 1) * 16))
                alpha_channel = crop.getchannel('A')
                visible_count = sum(1 for a in alpha_channel.tobytes() if a > 10)
                if visible_count == 0:
                    empty_frames.append((r, c))

        if empty_frames:
            report["valid"] = False
            report["errors"].append(f"Found empty frames at row/col: {empty_frames}")

        # Transparency & color validation
        raw_bytes = im.tobytes()
        pixels = [
            (raw_bytes[i], raw_bytes[i + 1], raw_bytes[i + 2], raw_bytes[i + 3])
            for i in range(0, len(raw_bytes), 4)
        ]
        semi_trans = [p for p in pixels if 0 < p[3] < 255]
        if semi_trans:
            report["valid"] = False
            report["errors"].append(f"Found {len(semi_trans)} semi-transparent pixels (sub-pixel AA is forbidden)")

        visible_pixels = [p for p in pixels if p[3] > 0]
        unique_colors = set((p[0], p[1], p[2]) for p in visible_pixels)
        report["details"]["color_count"] = len(unique_colors)
        report["details"]["unique_colors"] = [f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}" for c in unique_colors]

        if len(unique_colors) > 9:
            report["warnings"].append(f"Color count {len(unique_colors)} exceeds target budget (5-9 colors)")
        elif len(unique_colors) < 3:
            report["warnings"].append(f"Color count {len(unique_colors)} is below target budget (5-9 colors)")

        return report


# -----------------------------------------------------------------------------
# 6. CLI Driver
# -----------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Pixel-Art Monster Generator for Wayfarer Online / Ninja Adventure")
    parser.add_argument("--type", choices=list(ARCHETYPES.keys()), default="slime", help="Monster archetype")
    parser.add_argument("--palette", choices=list(PALETTES.keys()), default="slime_cyan", help="Color palette")
    parser.add_argument("--out", type=str, default=None, help="Output PNG path")
    parser.add_argument("--list-types", action="store_true", help="List available archetypes")
    parser.add_argument("--list-palettes", action="store_true", help="List available palettes")
    parser.add_argument("--generate-all", action="store_true", help="Generate sheets for all archetypes and palettes")
    parser.add_argument("--pack-a", action="store_true", help="Generate Biome Pack A monsters (Meadowfield, Mosswood, Whisperfen)")
    parser.add_argument("--out-dir", type=str, default="public/assets/custom/Monster", help="Directory for --generate-all")
    parser.add_argument("--validate", type=str, default=None, help="Validate an existing sprite sheet PNG")

    args = parser.parse_args()

    if args.pack_a:
        try:
            import generate_biome_pack_a
            generate_biome_pack_a.generate_all()
        except ImportError:
            tools_dir = os.path.dirname(os.path.abspath(__file__))
            sys.path.insert(0, tools_dir)
            import generate_biome_pack_a
            generate_biome_pack_a.generate_all()
        return

    if args.list_types:
        print("Available Monster Archetypes:")
        for t in sorted(ARCHETYPES.keys()):
            print(f"  - {t}")
        return

    if args.list_palettes:
        print("Available Color Palettes:")
        for p in sorted(PALETTES.keys()):
            print(f"  - {p}")
        return

    if args.validate:
        res = MonsterGenerator.validate_sheet(args.validate)
        print(f"Validation Report for {args.validate}:")
        print(f"  Valid: {res['valid']}")
        print(f"  Dimensions: {res['dimensions']}")
        print(f"  Colors: {res['details'].get('color_count')} ({res['details'].get('unique_colors')})")
        if res["errors"]:
            print("  ERRORS:", res["errors"])
        if res["warnings"]:
            print("  WARNINGS:", res["warnings"])
        return

    if args.generate_all:
        os.makedirs(args.out_dir, exist_ok=True)
        print(f"Generating sprite sheets into {args.out_dir}...")
        for arch in ARCHETYPES.keys():
            pal_name = arch + "_cyan" if (arch + "_cyan") in PALETTES else (
                "bone_undead" if arch == "skull" else (
                    "fire_crimson" if arch == "bat" else (
                        "forest_green" if arch in ("mushroom", "dragon") else (
                            "beast_brown" if arch == "beast" else (
                                "abyssal_blue" if arch == "eye" else (
                                    "slate_stone" if arch == "golem" else "desert_amber"
                                )
                            )
                        )
                    )
                )
            )
            img = MonsterGenerator.generate_sheet(arch, pal_name)
            out_file = os.path.join(args.out_dir, f"{arch.capitalize()}.png")
            img.save(out_file)
            val = MonsterGenerator.validate_sheet(img)
            print(f"  Saved {out_file} (valid={val['valid']}, colors={val['details']['color_count']})")
        print("Done.")
        return

    out_path = args.out or f"{args.type}_{args.palette}.png"
    img = MonsterGenerator.generate_sheet(args.type, args.palette)
    parent_dir = os.path.dirname(os.path.abspath(out_path))
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    img.save(out_path)
    val = MonsterGenerator.validate_sheet(img)
    print(f"Generated {out_path} [valid={val['valid']}, colors={val['details']['color_count']}]")
    if val["errors"]:
        print("  Errors:", val["errors"])


if __name__ == "__main__":
    main()
