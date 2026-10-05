#!/usr/bin/env python3
"""
tools/generate_skill_fx_sheets.py
Procedurally synthesizes authentic 16-bit Ninja Adventure / Game Boy styled
elemental FX spritesheet PNGs for Wayfarer Online.

Outputs:
  public/assets/custom/fx/frost_nova.png     (288x48: 6 frames of 48x48)
  public/assets/custom/fx/thunder_strike.png  (160x48: 5 frames of 32x48)
  public/assets/custom/fx/shadow_vortex.png   (240x40: 6 frames of 40x40)
  public/assets/custom/fx/holy_radiance.png   (288x48: 6 frames of 48x48)
  public/assets/custom/fx/poison_bloom.png    (160x32: 5 frames of 32x32)

Design Principles:
- 1-bit alpha transparency (RGBA mode, alpha is strictly 0 or 255).
- Clean pixelated geometry with no blurry sub-pixel antialiasing.
- Crisp 1px dark outlines, retro shading ramps, and top-left specular highlights.
- Multi-frame animation progression (genesis/anticipation -> expansion -> peak burst -> shatter/pop -> fade).
"""

import os
import math
from typing import List, Tuple, Optional, Set
from PIL import Image

# -----------------------------------------------------------------------------
# Core Pixel Canvas Engine
# -----------------------------------------------------------------------------

RGBA = Tuple[int, int, int, int]
TRANSPARENT: RGBA = (0, 0, 0, 0)

class PixelCanvas:
    """Integer raster grid providing pixel-perfect drawing operations."""

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
        """Bresenham line algorithm with optional square brush width."""
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
        """Fills a discrete pixel disk."""
        r2 = r * r
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r2:
                    self.set(cx + dx, cy + dy, fill)

    def draw_ellipse(self, cx: int, cy: int, rx: float, ry: float, fill: RGBA):
        """Fills a discrete pixel ellipse."""
        irx = int(math.ceil(rx))
        iry = int(math.ceil(ry))
        for dy in range(-iry, iry + 1):
            for dx in range(-irx, irx + 1):
                if (dx / max(0.1, rx)) ** 2 + (dy / max(0.1, ry)) ** 2 <= 1.0:
                    self.set(cx + dx, cy + dy, fill)

    def draw_ring(self, cx: int, cy: int, r_inner: float, r_outer: float, fill: RGBA):
        """Draws a concentric ring with crisp boundaries."""
        ir = int(math.ceil(r_outer))
        r_in2 = r_inner * r_inner
        r_out2 = r_outer * r_outer
        for dy in range(-ir, ir + 1):
            for dx in range(-ir, ir + 1):
                d2 = dx * dx + dy * dy
                if r_in2 <= d2 <= r_out2:
                    self.set(cx + dx, cy + dy, fill)

    def draw_diamond(self, cx: int, cy: int, rx: int, ry: int, fill: RGBA):
        """Draws a diamond / rhombus using Manhattan distance."""
        for dy in range(-ry, ry + 1):
            for dx in range(-rx, rx + 1):
                if (abs(dx) / max(1, rx)) + (abs(dy) / max(1, ry)) <= 1.0:
                    self.set(cx + dx, cy + dy, fill)

    def draw_polygon(self, pts: List[Tuple[int, int]], fill: RGBA):
        """Standard scanline rasterization for arbitrary convex/concave polygon."""
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
            for k in range(0, len(nodes) - 1, 2):
                x_start = max(0, int(math.ceil(nodes[k])))
                x_end = min(self.w - 1, int(math.floor(nodes[k + 1])))
                for x in range(x_start, x_end + 1):
                    self.set(x, y, fill)

    def add_outline(self, outline_color: RGBA, diagonal: bool = True):
        """
        Adds an authentic 1px pixel-art outline around all opaque pixels
        that touch transparent space.
        """
        new_grid = [row[:] for row in self.grid]
        dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        if diagonal:
            dirs += [(-1, -1), (1, -1), (-1, 1), (1, 1)]

        for y in range(self.h):
            for x in range(self.w):
                if self.grid[y][x][3] == 0:
                    # Check if adjacent to an opaque pixel
                    is_border = False
                    for dx, dy in dirs:
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < self.w and 0 <= ny < self.h:
                            if self.grid[ny][nx][3] > 0 and self.grid[ny][nx] != outline_color:
                                is_border = True
                                break
                    if is_border:
                        new_grid[y][x] = outline_color
        self.grid = new_grid

    def to_image(self) -> Image.Image:
        """Converts canvas grid to an RGBA PIL Image."""
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = img.load()
        for y in range(self.h):
            for x in range(self.w):
                px[x, y] = self.grid[y][x]
        return img


# -----------------------------------------------------------------------------
# Spritesheet Assembler Helper
# -----------------------------------------------------------------------------

def assemble_sheet(frames: List[PixelCanvas]) -> Image.Image:
    """Stitches horizontal animation frames into a single spritesheet."""
    n_frames = len(frames)
    fw, fh = frames[0].w, frames[0].h
    sheet = Image.new("RGBA", (fw * n_frames, fh), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        img = frame.to_image()
        sheet.paste(img, (i * fw, 0))
    return sheet


# -----------------------------------------------------------------------------
# FX 1: Frost Nova (48x48 per frame, 6 frames -> 288x48)
# Crystalline ice spikes burst outwards + frost crystal shatter
# -----------------------------------------------------------------------------

def generate_frost_nova() -> Image.Image:
    FW, FH = 48, 48
    CX, CY = 24, 24

    # Elemental Ice Palette
    OUTLINE: RGBA = (20, 27, 43, 255)       # Dark Ice Navy
    DEEP_SHADOW: RGBA = (45, 105, 123, 255) # Deep Teal / Shadow
    MIDTONE: RGBA = (121, 184, 206, 255)    # Ice Cyan
    LIGHT: RGBA = (184, 220, 229, 255)      # Pale Cyan
    ICE_WHITE: RGBA = (227, 241, 245, 255)  # Ethereal Frost White
    WHITE: RGBA = (255, 255, 255, 255)      # Specular Core

    frames: List[PixelCanvas] = []

    def draw_faceted_spike(c: PixelCanvas, angle_rad: float, length: float,
                           shoulder_dist: float, width_left: float, width_right: float,
                           detached_dist: float = 0.0):
        """Renders an authentic 3D faceted crystal spike with light & shadow facets."""
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)
        perp_x = -sin_a
        perp_y = cos_a

        base_x = CX + detached_dist * cos_a
        base_y = CY + detached_dist * sin_a

        tip_x = CX + (detached_dist + length) * cos_a
        tip_y = CY + (detached_dist + length) * sin_a

        # Left facet shoulder point (lit)
        sh_left_x = CX + (detached_dist + shoulder_dist) * cos_a + width_left * perp_x
        sh_left_y = CY + (detached_dist + shoulder_dist) * sin_a + width_left * perp_y

        # Right facet shoulder point (shaded)
        sh_right_x = CX + (detached_dist + shoulder_dist) * cos_a - width_right * perp_x
        sh_right_y = CY + (detached_dist + shoulder_dist) * sin_a - width_right * perp_y

        p_base = (int(round(base_x)), int(round(base_y)))
        p_tip = (int(round(tip_x)), int(round(tip_y)))
        p_sh_left = (int(round(sh_left_x)), int(round(sh_left_y)))
        p_sh_right = (int(round(sh_right_x)), int(round(sh_right_y)))

        # Left facet (highlight side)
        poly_left = [p_base, p_sh_left, p_tip]
        c.draw_polygon(poly_left, LIGHT)

        # Right facet (shadow side)
        poly_right = [p_base, p_sh_right, p_tip]
        c.draw_polygon(poly_right, MIDTONE)

        # Center facet ridge line (bright specular spine)
        c.draw_line(p_base[0], p_base[1], p_tip[0], p_tip[1], ICE_WHITE, width=1)
        c.set(p_tip[0], p_tip[1], WHITE)

    # Frame 0: Inception / Freeze condensation at center
    c0 = PixelCanvas(FW, FH)
    # Frost rune ring (dashed circle)
    c0.draw_ring(CX, CY, 7.5, 8.5, MIDTONE)
    # Center crystal seed
    c0.draw_diamond(CX, CY, 4, 4, LIGHT)
    c0.draw_diamond(CX, CY, 2, 2, WHITE)
    # 4 tiny cardinal seed points
    for dx, dy in [(0, -6), (0, 6), (-6, 0), (6, 0)]:
        c0.set(CX + dx, CY + dy, ICE_WHITE)
    # 4 diagonal rune specks
    for dx, dy in [(-6, -6), (6, -6), (-6, 6), (6, 6)]:
        c0.set(CX + dx, CY + dy, DEEP_SHADOW)
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Rapid crystalline eruption (8 crystal spikes shooting outwards)
    c1 = PixelCanvas(FW, FH)
    # Inner frost ring
    c1.draw_ring(CX, CY, 11.5, 12.5, MIDTONE)
    # 4 cardinal spikes (longer)
    for ang in [0, math.pi / 2, math.pi, 3 * math.pi / 2]:
        draw_faceted_spike(c1, ang, length=14.0, shoulder_dist=7.0, width_left=3.0, width_right=2.5)
    # 4 diagonal spikes (shorter)
    for ang in [math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4]:
        draw_faceted_spike(c1, ang, length=11.0, shoulder_dist=5.5, width_left=2.5, width_right=2.0)
    # Central crystal core
    c1.draw_diamond(CX, CY, 5, 5, ICE_WHITE)
    c1.draw_diamond(CX, CY, 2, 2, WHITE)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: Peak Frost Nova! Full crystalline extension & diamond facets
    c2 = PixelCanvas(FW, FH)
    # Outer shock ring expanding
    c2.draw_ring(CX, CY, 15.0, 16.0, DEEP_SHADOW)
    # 4 cardinal spikes reach maximum radius 20px
    for ang in [0, math.pi / 2, math.pi, 3 * math.pi / 2]:
        draw_faceted_spike(c2, ang, length=19.5, shoulder_dist=10.0, width_left=3.8, width_right=3.2)
    # 4 diagonal spikes reach radius 16px
    for ang in [math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4]:
        draw_faceted_spike(c2, ang, length=15.5, shoulder_dist=8.0, width_left=3.0, width_right=2.5)
    # 8 intermediate needle crystals
    for k in range(8):
        ang = (k + 0.5) * (math.pi / 4)
        draw_faceted_spike(c2, ang, length=9.0, shoulder_dist=4.5, width_left=1.5, width_right=1.2)
    # Central faceted hexagonal core
    c2.draw_circle(CX, CY, 5, ICE_WHITE)
    c2.draw_diamond(CX, CY, 3, 3, WHITE)
    # Small detached frost glints at the very tips
    for ang in [0, math.pi / 2, math.pi, 3 * math.pi / 2]:
        gx = int(round(CX + 21.5 * math.cos(ang)))
        gy = int(round(CY + 21.5 * math.sin(ang)))
        c2.set(gx, gy, WHITE)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Shatter! Central core fractures and outer shards fly apart
    c3 = PixelCanvas(FW, FH)
    # Expanding frost dust ring (shattered center)
    c3.draw_ring(CX, CY, 7.0, 9.0, LIGHT)
    c3.draw_ring(CX, CY, 17.5, 18.5, DEEP_SHADOW)
    # 8 detached flying spike tips (traveling further out)
    for ang in [0, math.pi / 2, math.pi, 3 * math.pi / 2]:
        draw_faceted_spike(c3, ang, length=9.0, shoulder_dist=4.5, width_left=2.5, width_right=2.0, detached_dist=12.0)
    for ang in [math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4]:
        draw_faceted_spike(c3, ang, length=7.0, shoulder_dist=3.5, width_left=2.0, width_right=1.5, detached_dist=11.0)
    # Intermediate fractured crystal shards
    for k in range(8):
        ang = (k + 0.5) * (math.pi / 4)
        sx = int(round(CX + 13.0 * math.cos(ang)))
        sy = int(round(CY + 13.0 * math.sin(ang)))
        c3.draw_diamond(sx, sy, 2, 2, ICE_WHITE)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Dispersal! Flying crystal fragments spinning into smaller shards
    c4 = PixelCanvas(FW, FH)
    # Dispersed outer shards at radius 21-22px
    for i, ang in enumerate([0, math.pi / 2, math.pi, 3 * math.pi / 2]):
        # Offset angle slightly to simulate tumbling
        rot_ang = ang + 0.15 * (-1 if i % 2 == 0 else 1)
        sx = int(round(CX + 21.0 * math.cos(rot_ang)))
        sy = int(round(CY + 21.0 * math.sin(rot_ang)))
        c4.draw_diamond(sx, sy, 2, 3, ICE_WHITE)
        c4.set(sx, sy, WHITE)

    for i, ang in enumerate([math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4]):
        rot_ang = ang - 0.15 * (-1 if i % 2 == 0 else 1)
        sx = int(round(CX + 18.5 * math.cos(rot_ang)))
        sy = int(round(CY + 18.5 * math.sin(rot_ang)))
        c4.draw_diamond(sx, sy, 2, 2, LIGHT)

    # Scattered floating frost dust in mid-ring
    for ang_deg in [15, 60, 105, 150, 195, 240, 285, 330]:
        rad = math.radians(ang_deg)
        fx = int(round(CX + 12.0 * math.cos(rad)))
        fy = int(round(CY + 12.0 * math.sin(rad)))
        c4.set(fx, fy, MIDTONE)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    # Frame 5: Dissipation! Tiny residual twinkling ice diamonds fading
    c5 = PixelCanvas(FW, FH)
    glints = [
        (CX + 21, CY - 2), (CX - 21, CY + 1), (CX + 1, CY + 21), (CX - 2, CY - 21),
        (CX + 15, CY + 15), (CX - 15, CY - 15), (CX + 15, CY - 14), (CX - 14, CY + 15),
        (CX + 8, CY - 6), (CX - 7, CY + 7), (CX + 5, CY + 9), (CX - 8, CY - 8)
    ]
    for gx, gy in glints:
        c5.set(gx, gy, ICE_WHITE)
        c5.set(gx + 1, gy, LIGHT)
    for gx, gy in [(CX + 21, CY - 2), (CX - 2, CY - 21), (CX + 15, CY - 14)]:
        c5.set(gx, gy, WHITE)
    c5.add_outline(OUTLINE)
    frames.append(c5)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# FX 2: Thunder Strike (32x48 per frame, 5 frames -> 160x48)
# Vertical jagged lightning bolt + ground spark explosion
# -----------------------------------------------------------------------------

def generate_thunder_strike() -> Image.Image:
    FW, FH = 32, 48
    CX = 16
    GROUND_Y = 43

    # Elemental Thunder Palette
    OUTLINE: RGBA = (20, 27, 27, 255)       # Darkest Outline
    DEEP_AMBER: RGBA = (230, 106, 58, 255) # Deep Orange / Amber Fringe
    AMBER_LIGHT: RGBA = (255, 173, 93, 255) # Electric Amber Glow
    YELLOW: RGBA = (255, 225, 141, 255)     # Bright Electric Yellow
    WHITE: RGBA = (255, 255, 255, 255)      # Blinding White Core

    frames: List[PixelCanvas] = []

    def draw_lightning_segments(c: PixelCanvas, pts: List[Tuple[int, int]],
                                core_w: int, glow_w: int):
        """Draws multi-layered jagged electric discharge path."""
        # 1. Glow pass
        for i in range(len(pts) - 1):
            c.draw_line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], YELLOW, width=glow_w)
        # 2. White core pass
        for i in range(len(pts) - 1):
            c.draw_line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], WHITE, width=core_w)

    def draw_spark_star(c: PixelCanvas, x: int, y: int, r: int, color: RGBA):
        """Draws an authentic 4-pointed electric spark star."""
        c.draw_line(x - r, y, x + r, y, color)
        c.draw_line(x, y - r, x, y + r, color)
        c.set(x, y, WHITE)

    # Frame 0: Sky step leader descends towards ground; small ground ionization
    c0 = PixelCanvas(FW, FH)
    leader_pts = [(CX, 0), (CX - 2, 7), (CX + 2, 14), (CX - 3, 22), (CX + 1, 30)]
    draw_lightning_segments(c0, leader_pts, core_w=1, glow_w=2)
    # Ground ionization spark
    draw_spark_star(c0, CX, GROUND_Y, r=2, color=YELLOW)
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Full violent direct Thunder Strike!
    c1 = PixelCanvas(FW, FH)
    main_bolt = [
        (CX, 0), (CX - 3, 8), (CX + 3, 17), (CX - 4, 26),
        (CX + 2, 34), (CX - 1, GROUND_Y)
    ]
    # Heavy main trunk
    draw_lightning_segments(c1, main_bolt, core_w=2, glow_w=4)

    # Branch 1 (left side at y=17)
    branch1 = [(CX + 3, 17), (CX - 6, 21), (CX - 8, 29)]
    draw_lightning_segments(c1, branch1, core_w=1, glow_w=2)

    # Branch 2 (right side at y=26)
    branch2 = [(CX - 4, 26), (CX + 6, 31), (CX + 8, 38)]
    draw_lightning_segments(c1, branch2, core_w=1, glow_w=2)

    # Ground impact flash (blinding disc)
    c1.draw_ellipse(CX - 1, GROUND_Y, rx=6.0, ry=2.5, fill=YELLOW)
    c1.draw_ellipse(CX - 1, GROUND_Y, rx=3.5, ry=1.5, fill=WHITE)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: Ground impact explosion peaks + glowing ionization column
    c2 = PixelCanvas(FW, FH)
    # Residual ionization channel
    channel_pts = [
        (CX, 2), (CX - 2, 9), (CX + 2, 16), (CX - 3, 25),
        (CX + 1, 33), (CX, GROUND_Y - 2)
    ]
    for i in range(len(channel_pts) - 1):
        c2.draw_line(channel_pts[i][0], channel_pts[i][1],
                     channel_pts[i+1][0], channel_pts[i+1][1], AMBER_LIGHT, width=2)
        c2.draw_line(channel_pts[i][0], channel_pts[i][1],
                     channel_pts[i+1][0], channel_pts[i+1][1], WHITE, width=1)

    # Snapping mid-air arcs
    c2.draw_line(CX - 5, 20, CX - 9, 22, YELLOW, width=1)
    c2.draw_line(CX + 4, 28, CX + 10, 27, YELLOW, width=1)

    # Grand ground spark explosion (starburst across base)
    c2.draw_ellipse(CX, GROUND_Y, rx=11.0, ry=3.5, fill=DEEP_AMBER)
    c2.draw_ellipse(CX, GROUND_Y, rx=8.0, ry=2.5, fill=YELLOW)
    c2.draw_ellipse(CX, GROUND_Y, rx=4.0, ry=1.5, fill=WHITE)

    # Radiating electric spark rays shooting upward from ground
    c2.draw_line(CX - 8, GROUND_Y - 1, CX - 12, GROUND_Y - 6, YELLOW, width=1)
    c2.draw_line(CX - 4, GROUND_Y - 2, CX - 7, GROUND_Y - 8, WHITE, width=1)
    c2.draw_line(CX + 4, GROUND_Y - 2, CX + 7, GROUND_Y - 8, WHITE, width=1)
    c2.draw_line(CX + 8, GROUND_Y - 1, CX + 12, GROUND_Y - 6, YELLOW, width=1)
    c2.set(CX - 12, GROUND_Y - 6, WHITE)
    c2.set(CX + 12, GROUND_Y - 6, WHITE)
    c2.set(CX - 7, GROUND_Y - 8, WHITE)
    c2.set(CX + 7, GROUND_Y - 8, WHITE)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Discharging spark cluster; vertical bolt breaks into fading segments
    c3 = PixelCanvas(FW, FH)
    # Segmented fading bolt dashes
    c3.draw_line(CX - 1, 6, CX - 2, 11, AMBER_LIGHT, width=1)
    c3.draw_line(CX + 1, 18, CX + 2, 23, AMBER_LIGHT, width=1)
    c3.draw_line(CX - 2, 28, CX - 1, 33, AMBER_LIGHT, width=1)

    # Exploding spark cloud at base (8 distinct flying sparks in an arc)
    sparks = [
        (CX - 13, GROUND_Y - 4), (CX - 10, GROUND_Y - 8),
        (CX - 5, GROUND_Y - 10), (CX, GROUND_Y - 11),
        (CX + 5, GROUND_Y - 10), (CX + 10, GROUND_Y - 8),
        (CX + 13, GROUND_Y - 4), (CX, GROUND_Y - 1)
    ]
    for sx, sy in sparks:
        draw_spark_star(c3, sx, sy, r=1, color=YELLOW)

    # Scorched glowing impact spot
    c3.draw_ellipse(CX, GROUND_Y, rx=5.0, ry=1.8, fill=DEEP_AMBER)
    c3.draw_ellipse(CX, GROUND_Y, rx=2.5, ry=1.0, fill=YELLOW)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Fading electrical afterglow & ascending sparks
    c4 = PixelCanvas(FW, FH)
    ground_embers = [
        (CX - 8, GROUND_Y - 5), (CX - 3, GROUND_Y - 8),
        (CX + 2, GROUND_Y - 9), (CX + 7, GROUND_Y - 6),
        (CX, GROUND_Y - 3), (CX - 11, GROUND_Y - 2), (CX + 11, GROUND_Y - 2)
    ]
    for ex, ey in ground_embers:
        c4.set(ex, ey, YELLOW)
        c4.set(ex, ey - 1, AMBER_LIGHT)
    c4.set(CX + 2, GROUND_Y - 9, WHITE)
    c4.set(CX - 3, GROUND_Y - 8, WHITE)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# FX 3: Shadow Vortex (40x40 per frame, 6 frames -> 240x40)
# Dark void swirl + violet energy tendrils
# -----------------------------------------------------------------------------

def generate_shadow_vortex() -> Image.Image:
    FW, FH = 40, 40
    CX, CY = 20, 20

    # Elemental Void / Shadow Palette
    VOID_BLACK: RGBA = (18, 14, 28, 255)       # Abyss Outline
    DEEP_PLUM: RGBA = (69, 40, 60, 255)        # Shadow Underbelly
    DARK_PURPLE: RGBA = (84, 60, 82, 255)      # Deep Violet Shadow
    BURGUNDY: RGBA = (143, 62, 86, 255)        # Rich Violet Core
    VIOLET: RGBA = (155, 89, 182, 255)         # Vibrant Violet Midtone
    LILAC: RGBA = (200, 130, 245, 255)         # Luminous Lilac Highlight
    CYAN_WHITE: RGBA = (227, 241, 245, 255)    # Ethereal Glint
    WHITE: RGBA = (255, 255, 255, 255)         # Core Flash

    frames: List[PixelCanvas] = []

    def draw_spiral_tendril(c: PixelCanvas, start_angle: float, sweep: float,
                            r_start: float, r_end: float, width_start: float,
                            width_end: float, steps: int = 18):
        """Renders a dynamic curved spiral tendril tapering to a sickle tip."""
        pts_left: List[Tuple[int, int]] = []
        pts_right: List[Tuple[int, int]] = []

        for i in range(steps + 1):
            t = i / float(steps)
            angle = start_angle + sweep * t
            r = r_start + (r_end - r_start) * (t ** 0.85)
            w = width_start + (width_end - width_start) * t

            cx_t = CX + r * math.cos(angle)
            cy_t = CY + r * math.sin(angle)

            # Perpendicular vector to spiral path
            tangent_ang = angle + math.pi / 2
            px = math.cos(tangent_ang)
            py = math.sin(tangent_ang)

            # Left side (outer/leading curve - highlighted)
            lx = int(round(cx_t + (w / 2.0) * px))
            ly = int(round(cy_t + (w / 2.0) * py))
            pts_left.append((lx, ly))

            # Right side (inner/trailing curve - shaded)
            rx = int(round(cx_t - (w / 2.0) * px))
            ry = int(round(cy_t - (w / 2.0) * py))
            pts_right.append((rx, ry))

        # Fill the tendril polygon
        full_poly = pts_left + list(reversed(pts_right))
        c.draw_polygon(full_poly, VIOLET)

        # Highlight edge along leading curve
        for j in range(len(pts_left) - 1):
            c.draw_line(pts_left[j][0], pts_left[j][1],
                        pts_left[j+1][0], pts_left[j+1][1], LILAC, width=1)

        # Inner shadow along trailing curve
        for j in range(len(pts_right) - 1):
            c.draw_line(pts_right[j][0], pts_right[j][1],
                        pts_right[j+1][0], pts_right[j+1][1], DEEP_PLUM, width=1)

        # Tip glint
        if pts_left:
            tip = pts_left[-1]
            c.set(tip[0], tip[1], CYAN_WHITE)

    # Frame 0: Void rift opens in center; budding spiral tendrils
    c0 = PixelCanvas(FW, FH)
    # Outer dark energy aura
    c0.draw_ring(CX, CY, 6.0, 7.5, DARK_PURPLE)
    # 2 small spiral tendrils
    for offset in [0.0, math.pi]:
        draw_spiral_tendril(c0, start_angle=offset, sweep=1.1,
                            r_start=2.5, r_end=7.5, width_start=2.5, width_end=1.0)
    # Void singularity center
    c0.draw_circle(CX, CY, 3, VOID_BLACK)
    c0.set(CX, CY, WHITE)
    c0.add_outline(VOID_BLACK)
    frames.append(c0)

    # Frame 1: Expanding vortex disk; 3 spiral arms spinning clockwise
    c1 = PixelCanvas(FW, FH)
    c1.draw_ring(CX, CY, 9.5, 11.0, DEEP_PLUM)
    base_rot = math.pi / 4
    for i in range(3):
        ang = base_rot + i * (2 * math.pi / 3)
        draw_spiral_tendril(c1, start_angle=ang, sweep=1.5,
                            r_start=3.5, r_end=12.0, width_start=3.5, width_end=1.2)
    # Central void eye
    c1.draw_circle(CX, CY, 4, VOID_BLACK)
    c1.draw_diamond(CX, CY, 2, 2, LILAC)
    c1.set(CX, CY, WHITE)
    c1.add_outline(VOID_BLACK)
    frames.append(c1)

    # Frame 2: Maximum Void Vortex! 4 long energetic violet tendrils whipping outwards
    c2 = PixelCanvas(FW, FH)
    # Orbiting energy ring
    c2.draw_ring(CX, CY, 14.5, 15.5, DARK_PURPLE)
    base_rot = math.pi / 2
    for i in range(4):
        ang = base_rot + i * (math.pi / 2)
        draw_spiral_tendril(c2, start_angle=ang, sweep=1.8,
                            r_start=4.0, r_end=16.0, width_start=4.0, width_end=1.0)
    # Dense void core with glowing event horizon
    c2.draw_circle(CX, CY, 5, VOID_BLACK)
    c2.draw_ring(CX, CY, 3.5, 4.5, LILAC)
    c2.draw_diamond(CX, CY, 2, 2, WHITE)
    # Orbiting void motes
    for ang in [0.3, 1.8, 3.4, 5.0]:
        mx = int(round(CX + 16.5 * math.cos(ang)))
        my = int(round(CY + 16.5 * math.sin(ang)))
        c2.set(mx, my, CYAN_WHITE)
    c2.add_outline(VOID_BLACK)
    frames.append(c2)

    # Frame 3: Overcharged spiral pulse; tendrils whipping tighter & erupting
    c3 = PixelCanvas(FW, FH)
    base_rot = 3 * math.pi / 4
    # Central burst flash
    c3.draw_diamond(CX, CY, 6, 6, LILAC)
    c3.draw_diamond(CX, CY, 3, 3, WHITE)
    for i in range(4):
        ang = base_rot + i * (math.pi / 2)
        # Detaching curved sickle blades
        draw_spiral_tendril(c3, start_angle=ang, sweep=1.6,
                            r_start=7.0, r_end=16.5, width_start=3.2, width_end=1.0)
    # Radial void sparks
    for k in range(8):
        ang = k * (math.pi / 4)
        px = int(round(CX + 13.0 * math.cos(ang)))
        py = int(round(CY + 13.0 * math.sin(ang)))
        c3.set(px, py, CYAN_WHITE)
    c3.add_outline(VOID_BLACK)
    frames.append(c3)

    # Frame 4: Collapse & wisp dispersion; core implodes, wisps drift outward
    c4 = PixelCanvas(FW, FH)
    # Dying core
    c4.draw_circle(CX, CY, 3, VOID_BLACK)
    c4.set(CX, CY, DARK_PURPLE)
    # Detached swirling shadow wisps at radius 14-16px
    base_rot = math.pi
    for i in range(4):
        ang = base_rot + i * (math.pi / 2)
        # Shorter curved sickle fragments
        draw_spiral_tendril(c4, start_angle=ang + 0.3, sweep=0.8,
                            r_start=11.0, r_end=16.5, width_start=2.5, width_end=1.0, steps=10)
    # Scattered motes
    for ang in [0.7, 2.2, 3.8, 5.3]:
        mx = int(round(CX + 15.0 * math.cos(ang)))
        my = int(round(CY + 15.0 * math.sin(ang)))
        c4.set(mx, my, LILAC)
    c4.add_outline(VOID_BLACK)
    frames.append(c4)

    # Frame 5: Dissipating void embers fading into the dark ether
    c5 = PixelCanvas(FW, FH)
    embers = [
        (CX + 13, CY - 4), (CX - 12, CY + 5), (CX + 4, CY + 14), (CX - 5, CY - 13),
        (CX + 10, CY + 10), (CX - 10, CY - 11), (CX + 14, CY - 9), (CX - 13, CY + 11),
        (CX + 7, CY - 7), (CX - 6, CY + 8)
    ]
    for ex, ey in embers:
        c5.set(ex, ey, VIOLET)
        c5.set(ex + 1, ey, DARK_PURPLE)
    for ex, ey in [(CX + 13, CY - 4), (CX - 5, CY - 13), (CX + 10, CY + 10)]:
        c5.set(ex, ey, LILAC)
    c5.add_outline(VOID_BLACK)
    frames.append(c5)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# FX 4: Holy Radiance (48x48 per frame, 6 frames -> 288x48)
# Golden cross burst + expanding radiant circle
# -----------------------------------------------------------------------------

def generate_holy_radiance() -> Image.Image:
    FW, FH = 48, 48
    CX, CY = 24, 24

    # Sacred / Holy Palette
    OUTLINE: RGBA = (43, 20, 20, 255)       # Dark Bronze / Deep Chestnut
    AMBER_DARK: RGBA = (215, 139, 74, 255)  # Rich Amber Gold (Shadow)
    GOLD: RGBA = (241, 196, 113, 255)       # Radiant Gold (Midtone)
    YELLOW: RGBA = (255, 225, 141, 255)     # Luminous Bright Yellow
    CREAM: RGBA = (252, 226, 202, 255)      # Warm Cream Highlight
    WHITE: RGBA = (255, 255, 255, 255)      # Holy Pure White

    frames: List[PixelCanvas] = []

    def draw_beveled_cross_arm(c: PixelCanvas, dir_x: int, dir_y: int,
                              length: int, thickness: int, detached: int = 0):
        """Draws one arm of a beveled 3D holy cross with diamond crosshead tip."""
        perp_x = -dir_y
        perp_y = dir_x
        ht = thickness // 2

        start_dist = detached
        end_dist = detached + length

        # Arm body quad
        for d in range(start_dist, end_dist):
            px = CX + d * dir_x
            py = CY + d * dir_y
            # Lit half (top/left)
            for w in range(1, ht + 1):
                c.set(px + w * perp_x, py + w * perp_y, YELLOW)
            # Center spine
            c.set(px, py, WHITE)
            # Shaded half (bottom/right)
            for w in range(1, ht + 1):
                c.set(px - w * perp_x, py - w * perp_y, GOLD)

        # Diamond point tip at end
        tip_x = CX + (end_dist + ht + 1) * dir_x
        tip_y = CY + (end_dist + ht + 1) * dir_y
        poly_tip = [
            (CX + end_dist * dir_x + ht * perp_x, CY + end_dist * dir_y + ht * perp_y),
            (tip_x, tip_y),
            (CX + end_dist * dir_x - ht * perp_x, CY + end_dist * dir_y - ht * perp_y),
        ]
        c.draw_polygon(poly_tip, YELLOW)
        c.set(tip_x, tip_y, WHITE)

    # Frame 0: Sacred genesis / diamond star glint at center
    c0 = PixelCanvas(FW, FH)
    # Halo dots
    for ang in [0, math.pi / 2, math.pi, 3 * math.pi / 2]:
        hx = int(round(CX + 7.0 * math.cos(ang)))
        hy = int(round(CY + 7.0 * math.sin(ang)))
        c0.set(hx, hy, GOLD)
    # Diagonal glints
    for ang in [math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4]:
        hx = int(round(CX + 6.0 * math.cos(ang)))
        hy = int(round(CY + 6.0 * math.sin(ang)))
        c0.set(hx, hy, AMBER_DARK)
    # Central diamond star
    c0.draw_diamond(CX, CY, 4, 4, YELLOW)
    c0.draw_diamond(CX, CY, 2, 2, WHITE)
    # 4 small cardinal ray spikes
    c0.set(CX, CY - 6, WHITE)
    c0.set(CX, CY + 6, WHITE)
    c0.set(CX - 6, CY, WHITE)
    c0.set(CX + 6, CY, WHITE)
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Manifestation of golden cross & inner radiant halo ring
    c1 = PixelCanvas(FW, FH)
    # Halo ring
    c1.draw_ring(CX, CY, 9.5, 10.5, GOLD)
    # Cross arms
    draw_beveled_cross_arm(c1, 0, -1, length=10, thickness=3) # Up
    draw_beveled_cross_arm(c1, 0, 1, length=10, thickness=3)  # Down
    draw_beveled_cross_arm(c1, -1, 0, length=10, thickness=3) # Left
    draw_beveled_cross_arm(c1, 1, 0, length=10, thickness=3)  # Right
    # Center intersection jewel
    c1.draw_diamond(CX, CY, 4, 4, WHITE)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: Peak Holy Radiance! Grand golden cross + ornate radiant halo
    c2 = PixelCanvas(FW, FH)
    # Expanding radiant halo ring with ornate rays
    c2.draw_ring(CX, CY, 14.5, 15.5, YELLOW)
    # 8 ray flares along the halo ring
    for k in range(8):
        ang = k * (math.pi / 4)
        rx = int(round(CX + 17.5 * math.cos(ang)))
        ry = int(round(CY + 17.5 * math.sin(ang)))
        c2.draw_diamond(rx, ry, 1, 1, CREAM)
    # 4 magnificent cross arms reaching radius 19px
    draw_beveled_cross_arm(c2, 0, -1, length=15, thickness=4)
    draw_beveled_cross_arm(c2, 0, 1, length=15, thickness=4)
    draw_beveled_cross_arm(c2, -1, 0, length=15, thickness=4)
    draw_beveled_cross_arm(c2, 1, 0, length=15, thickness=4)
    # 4 diagonal ray beams extending to radius 12px
    for dx, dy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        c2.draw_line(CX, CY, CX + 10 * dx, CY + 10 * dy, GOLD, width=1)
        c2.set(CX + 11 * dx, CY + 11 * dy, WHITE)
    # Center intersection glint
    c2.draw_diamond(CX, CY, 6, 6, CREAM)
    c2.draw_diamond(CX, CY, 3, 3, WHITE)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Shockwave burst & beam detachment! Cross arms launch outward
    c3 = PixelCanvas(FW, FH)
    # Radiant shockwave ring expands to radius 19-20px
    c3.draw_ring(CX, CY, 18.5, 19.5, GOLD)
    # Halo beads on the ring
    for k in range(12):
        ang = k * (math.pi / 6)
        bx = int(round(CX + 19.0 * math.cos(ang)))
        by = int(round(CY + 19.0 * math.sin(ang)))
        c3.set(bx, by, WHITE)
    # Detached cross arms flying outward (detached=6, length=12)
    draw_beveled_cross_arm(c3, 0, -1, length=11, thickness=3, detached=7)
    draw_beveled_cross_arm(c3, 0, 1, length=11, thickness=3, detached=7)
    draw_beveled_cross_arm(c3, -1, 0, length=11, thickness=3, detached=7)
    draw_beveled_cross_arm(c3, 1, 0, length=11, thickness=3, detached=7)
    # Center dissolves into a sacred diamond spark
    c3.draw_diamond(CX, CY, 4, 4, YELLOW)
    c3.draw_diamond(CX, CY, 2, 2, WHITE)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Halo expansion & constellation of holy stars
    c4 = PixelCanvas(FW, FH)
    # Fracturing outer ring at radius 22px
    for k in range(16):
        ang = k * (math.pi / 8)
        rx = int(round(CX + 22.0 * math.cos(ang)))
        ry = int(round(CY + 22.0 * math.sin(ang)))
        c4.set(rx, ry, GOLD)
    # Constellation of 5 holy 4-point stars
    star_positions = [
        (CX, CY), (CX, CY - 14), (CX, CY + 14), (CX - 14, CY), (CX + 14, CY)
    ]
    for sx, sy in star_positions:
        c4.draw_diamond(sx, sy, 2, 2, YELLOW)
        c4.set(sx, sy, WHITE)
        c4.set(sx, sy - 3, CREAM)
        c4.set(sx, sy + 3, CREAM)
        c4.set(sx - 3, sy, CREAM)
        c4.set(sx + 3, sy, CREAM)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    # Frame 5: Ascending divine light motes fading into the heavens
    c5 = PixelCanvas(FW, FH)
    motes = [
        (CX + 2, CY - 18), (CX - 8, CY - 15), (CX + 12, CY - 12), (CX - 15, CY - 8),
        (CX + 16, CY - 6), (CX - 4, CY - 5), (CX + 7, CY - 2), (CX - 11, CY + 3),
        (CX + 14, CY + 6), (CX, CY + 10), (CX - 13, CY + 14), (CX + 9, CY + 16),
        (CX - 5, CY + 18), (CX + 3, CY + 20)
    ]
    for mx, my in motes:
        c5.set(mx, my, YELLOW)
        c5.set(mx, my - 1, CREAM)
    for mx, my in [(CX + 2, CY - 18), (CX - 8, CY - 15), (CX + 7, CY - 2), (CX, CY + 10)]:
        c5.set(mx, my, WHITE)
    c5.add_outline(OUTLINE)
    frames.append(c5)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# FX 5: Poison Bloom (32x32 per frame, 5 frames -> 160x32)
# Bubbling venom spore explosion + toxic mist
# -----------------------------------------------------------------------------

def generate_poison_bloom() -> Image.Image:
    FW, FH = 32, 32
    CX, CY = 16, 17

    # Nature / Toxic / Venom Palette
    OUTLINE: RGBA = (20, 43, 27, 255)       # Dark Forest Black / Outline
    DEEP_TEAL: RGBA = (52, 90, 82, 255)     # Deep Murk / Underbelly
    FOREST_DARK: RGBA = (86, 134, 76, 255)  # Dark Toxic Shade
    LEAF_GREEN: RGBA = (116, 163, 52, 255)  # Toxic Midtone
    LIME: RGBA = (173, 188, 58, 255)        # Vibrant Acid Lime
    ACID_YELLOW: RGBA = (220, 235, 80, 255) # Pale Toxic Highlight
    WHITE: RGBA = (255, 255, 255, 255)      # Specular Bubble Glint

    frames: List[PixelCanvas] = []

    def draw_toxic_lobe(c: PixelCanvas, lx: int, ly: int, r: int):
        """Renders an organic rounded cloud lobe with retro shading & top-left glint."""
        # Main body
        c.draw_circle(lx, ly, r, LEAF_GREEN)
        # Bottom/right shadow
        r2 = r * r
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r2:
                    if dy > 0 or dx > 0:
                        c.set(lx + dx, ly + dy, FOREST_DARK)
                    if dy > r // 2 and dx > r // 2:
                        c.set(lx + dx, ly + dy, DEEP_TEAL)
        # Top-left lime highlight
        for dy in range(-r + 1, 1):
            for dx in range(-r + 1, 1):
                if dx * dx + dy * dy <= (r - 1) ** 2:
                    c.set(lx + dx, ly + dy, LIME)
        # Specular glint dot
        c.set(lx - max(1, r // 2), ly - max(1, r // 2), ACID_YELLOW)
        c.set(lx - max(1, r // 2), ly - max(1, r // 2) - 1, WHITE)

    def draw_venom_bubble(c: PixelCanvas, bx: int, by: int, r: int):
        """Renders a round liquid acid droplet."""
        c.draw_circle(bx, by, r, LIME)
        c.set(bx, by + r, FOREST_DARK)
        c.set(bx - 1, by - 1, ACID_YELLOW)
        c.set(bx - 1, by - 2, WHITE)

    # Frame 0: Swollen venom spore pod swelling on ground with rising blisters
    c0 = PixelCanvas(FW, FH)
    # Ground roots / thorn base
    c0.draw_rect(CX - 5, CY + 7, 10, 2, FOREST_DARK)
    # Swollen pod base
    c0.draw_ellipse(CX, CY + 4, rx=6.0, ry=4.5, fill=LEAF_GREEN)
    c0.draw_ellipse(CX - 2, CY + 3, rx=4.0, ry=3.0, fill=LIME)
    # 2 bubbling surface blisters on top of pod
    draw_venom_bubble(c0, CX - 2, CY - 1, r=3)
    draw_venom_bubble(c0, CX + 3, CY, r=2)
    # Oozing droplet
    c0.set(CX + 4, CY - 4, ACID_YELLOW)
    c0.set(CX + 4, CY - 5, WHITE)
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Spore pod ruptures open! 3 venom droplets shoot upward/outward
    c1 = PixelCanvas(FW, FH)
    # Torn pod husk at base
    c1.draw_rect(CX - 6, CY + 7, 12, 2, DEEP_TEAL)
    c1.draw_ellipse(CX, CY + 5, rx=5.5, ry=3.0, fill=FOREST_DARK)
    # Puff of toxic gas erupting from tear
    draw_toxic_lobe(c1, CX, CY + 1, r=5)
    # 3 flying venom droplets in an arc
    draw_venom_bubble(c1, CX - 8, CY - 6, r=2) # Left
    draw_venom_bubble(c1, CX, CY - 10, r=3)    # Center high
    draw_venom_bubble(c1, CX + 8, CY - 5, r=2) # Right
    # Flying acid splatters
    c1.set(CX - 5, CY - 8, ACID_YELLOW)
    c1.set(CX + 5, CY - 7, ACID_YELLOW)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: Peak Bloom! Billowing cloud of 5 toxic lobes + exploding droplet cluster
    c2 = PixelCanvas(FW, FH)
    # 5 overlapping rounded billowing cloud lobes
    draw_toxic_lobe(c2, CX, CY, r=6)           # Center lobe
    draw_toxic_lobe(c2, CX - 6, CY - 4, r=5)   # Top-left lobe
    draw_toxic_lobe(c2, CX + 6, CY - 3, r=5)   # Top-right lobe
    draw_toxic_lobe(c2, CX - 5, CY + 4, r=4)   # Bottom-left lobe
    draw_toxic_lobe(c2, CX + 5, CY + 4, r=4)   # Bottom-right lobe

    # 4 flying venom droplets at outer perimeter
    draw_venom_bubble(c2, CX - 11, CY - 8, r=2)
    draw_venom_bubble(c2, CX + 11, CY - 7, r=2)
    draw_venom_bubble(c2, CX - 11, CY + 7, r=1)
    draw_venom_bubble(c2, CX + 11, CY + 6, r=1)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Mist expansion & bubble popping; toxic cloud billows wide & diffuses
    c3 = PixelCanvas(FW, FH)
    # Expanded looser cloud lobes
    draw_toxic_lobe(c3, CX - 7, CY - 5, r=4)
    draw_toxic_lobe(c3, CX + 7, CY - 4, r=4)
    draw_toxic_lobe(c3, CX, CY - 7, r=5)
    draw_toxic_lobe(c3, CX - 6, CY + 4, r=3)
    draw_toxic_lobe(c3, CX + 6, CY + 4, r=3)

    # Rising vapor bubbles popping into acid splatter
    for sx, sy in [(CX - 12, CY - 10), (CX + 12, CY - 9), (CX - 3, CY - 13), (CX + 4, CY - 12)]:
        c3.set(sx, sy, LIME)
        c3.set(sx, sy - 1, ACID_YELLOW)

    # Porous dissipation holes in cloud center
    c3.set(CX - 1, CY, TRANSPARENT)
    c3.set(CX, CY, TRANSPARENT)
    c3.set(CX + 1, CY, TRANSPARENT)
    c3.set(CX, CY - 1, TRANSPARENT)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Fading noxious haze; dissolving vapor puffs drifting upward
    c4 = PixelCanvas(FW, FH)
    # 3 dissolving vapor puffs
    draw_toxic_lobe(c4, CX - 6, CY - 8, r=3)
    draw_toxic_lobe(c4, CX + 6, CY - 7, r=3)
    draw_toxic_lobe(c4, CX, CY - 10, r=3)

    # Dissipating floating venom motes
    drift_motes = [
        (CX - 10, CY - 12), (CX + 9, CY - 13), (CX - 2, CY - 15),
        (CX - 8, CY - 3), (CX + 8, CY - 2), (CX, CY - 4)
    ]
    for mx, my in drift_motes:
        c4.set(mx, my, LIME)
        c4.set(mx, my - 1, ACID_YELLOW)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# Main Execution Pipeline
# -----------------------------------------------------------------------------

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root_dir, "public", "assets", "custom", "fx")
    os.makedirs(out_dir, exist_ok=True)

    fx_specs = [
        ("frost_nova.png", generate_frost_nova, (288, 48), 6, 48, 48),
        ("thunder_strike.png", generate_thunder_strike, (160, 48), 5, 32, 48),
        ("shadow_vortex.png", generate_shadow_vortex, (240, 40), 6, 40, 40),
        ("holy_radiance.png", generate_holy_radiance, (288, 48), 6, 48, 48),
        ("poison_bloom.png", generate_poison_bloom, (160, 32), 5, 32, 32),
    ]

    print("======================================================================")
    print(" Wayfarer Online - 16-Bit Elemental Skill FX Spritesheet Generator")
    print("======================================================================")

    for filename, generator_fn, expected_size, n_frames, fw, fh in fx_specs:
        out_path = os.path.join(out_dir, filename)
        img = generator_fn()

        # Validate size and mode
        assert img.size == expected_size, f"{filename}: size {img.size} != {expected_size}"
        assert img.mode == "RGBA", f"{filename}: mode {img.mode} != RGBA"

        # Validate 1-bit alpha transparency
        alphas = set(img.split()[3].get_flattened_data())
        assert alphas.issubset({0, 255}), f"{filename}: non-binary alpha found: {alphas}"

        # Save PNG
        img.save(out_path, format="PNG")
        print(f" Generated {filename:<20} Size: {img.size[0]}x{img.size[1]} ({n_frames} frames of {fw}x{fh}) -> {out_path}")

    print("======================================================================")
    print("All skill FX sheets successfully generated and validated!")
    print("======================================================================")


if __name__ == "__main__":
    main()
