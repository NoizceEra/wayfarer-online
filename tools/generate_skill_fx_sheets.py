import os
import math
from typing import List, Tuple
from PIL import Image

RGBA = Tuple[int, int, int, int]
TRANSPARENT: RGBA = (0, 0, 0, 0)

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
            for k in range(0, len(nodes) - 1, 2):
                x_start = max(0, int(math.ceil(nodes[k])))
                x_end = min(self.w - 1, int(math.floor(nodes[k + 1])))
                for x in range(x_start, x_end + 1):
                    self.set(x, y, fill)

    def add_outline(self, outline_color: RGBA, diagonal: bool = True):
        new_grid = [row[:] for row in self.grid]
        dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        if diagonal:
            dirs += [(-1, -1), (1, -1), (-1, 1), (1, 1)]
        for y in range(self.h):
            for x in range(self.w):
                if self.grid[y][x][3] == 0:
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
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = img.load()
        for y in range(self.h):
            for x in range(self.w):
                px[x, y] = self.grid[y][x]
        return img

def assemble_sheet(frames: List[PixelCanvas]) -> Image.Image:
    n_frames = len(frames)
    fw, fh = frames[0].w, frames[0].h
    sheet = Image.new("RGBA", (fw * n_frames, fh), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        img = frame.to_image()
        sheet.paste(img, (i * fw, 0))
    return sheet


# -----------------------------------------------------------------------------
# FX 6: Whirlwind Slash (48x48 per frame, 6 frames -> 288x48)
# Sweeping 360-degree rotating dual crescent wind/steel blades with dust motes
# -----------------------------------------------------------------------------

def generate_whirlwind_slash() -> Image.Image:
    FW, FH = 48, 48
    CX, CY = 24, 24

    OUTLINE: RGBA = (26, 16, 36, 255)         # 1px Dark Outline #1a1024
    DEEP_SLATE: RGBA = (50, 65, 85, 255)      # Deep Steel Shadow
    STEEL_BLUE: RGBA = (95, 130, 160, 255)    # Blade Steel Midtone
    WIND_CYAN: RGBA = (165, 215, 230, 255)    # Wind Cutting Edge / Highlight
    PALE_AERO: RGBA = (220, 245, 252, 255)    # Bright Aerodynamic Sheen
    WHITE: RGBA = (255, 255, 255, 255)        # Specular Razor Edge
    DUST_DARK: RGBA = (145, 115, 75, 255)     # Swirling Dust Shadow
    DUST_LIGHT: RGBA = (215, 190, 135, 255)   # Sandy Dust Mote

    frames: List[PixelCanvas] = []

    def draw_crescent_blade(c: PixelCanvas, start_ang: float, sweep: float,
                           r_start: float, r_end: float, max_w: float,
                           detached_r: float = 0.0, steps: int = 24):
        """Draws a sweeping curved crescent slash blade with razor cutting edge."""
        pts_out: List[Tuple[int, int]] = []
        pts_in: List[Tuple[int, int]] = []
        pts_mid: List[Tuple[int, int]] = []

        for i in range(steps + 1):
            t = i / float(steps)
            ang = start_ang + sweep * t
            r = detached_r + (r_start + (r_end - r_start) * (t ** 0.85))
            w = max_w * math.sin(math.pi * (t ** 0.7))

            cos_a = math.cos(ang)
            sin_a = math.sin(ang)

            # Centerline
            mx = int(round(CX + r * cos_a))
            my = int(round(CY + r * sin_a))
            pts_mid.append((mx, my))

            # Outer blade edge (radially outward)
            r_out = r + w * 0.55
            ox = int(round(CX + r_out * cos_a))
            oy = int(round(CY + r_out * sin_a))
            pts_out.append((ox, oy))

            # Inner blade edge (radially inward)
            r_in = r - w * 0.45
            ix = int(round(CX + r_in * cos_a))
            iy = int(round(CY + r_in * sin_a))
            pts_in.append((ix, iy))

        # Fill blade polygon
        poly = pts_out + list(reversed(pts_in))
        c.draw_polygon(poly, STEEL_BLUE)

        # Highlight along outer cutting edge
        for j in range(len(pts_out) - 1):
            c.draw_line(pts_out[j][0], pts_out[j][1], pts_out[j+1][0], pts_out[j+1][1], WIND_CYAN, width=1)

        # Aerodynamic sheen along mid spine
        for j in range(len(pts_mid) - 1):
            c.draw_line(pts_mid[j][0], pts_mid[j][1], pts_mid[j+1][0], pts_mid[j+1][1], PALE_AERO, width=1)

        # Trailing edge shadow
        for j in range(len(pts_in) - 1):
            c.draw_line(pts_in[j][0], pts_in[j][1], pts_in[j+1][0], pts_in[j+1][1], DEEP_SLATE, width=1)

        # Razor sharp tip
        if pts_out:
            tip = pts_out[-1]
            c.set(tip[0], tip[1], WHITE)

    def draw_dust(c: PixelCanvas, x: int, y: int, size: int = 1):
        c.set(x, y, DUST_LIGHT)
        if size > 1:
            c.set(x + 1, y, DUST_DARK)
            c.set(x, y + 1, DUST_DARK)

    # Frame 0: Genesis - initial spin and dual blade wind draw
    c0 = PixelCanvas(FW, FH)
    c0.draw_ring(CX, CY, 6.5, 7.5, DEEP_SLATE)
    c0.draw_circle(CX, CY, 3, STEEL_BLUE)
    c0.set(CX, CY, WHITE)
    # 2 initiating crescent blades (sweeping ~80 deg)
    for offset in [0.0, math.pi]:
        draw_crescent_blade(c0, start_ang=offset + 0.2, sweep=1.4,
                            r_start=4.0, r_end=11.5, max_w=2.6)
    # Initial kicked-up dust motes at base
    draw_dust(c0, CX - 10, CY + 12, size=2)
    draw_dust(c0, CX + 11, CY + 13, size=2)
    draw_dust(c0, CX - 6, CY + 15, size=1)
    draw_dust(c0, CX + 5, CY - 12, size=1)
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Acceleration - blades elongate and sweep 130 deg
    c1 = PixelCanvas(FW, FH)
    c1.draw_ring(CX, CY, 9.5, 10.5, STEEL_BLUE)
    c1.draw_circle(CX, CY, 4, DEEP_SLATE)
    c1.draw_diamond(CX, CY, 2, 2, WIND_CYAN)
    c1.set(CX, CY, WHITE)
    for offset in [0.0, math.pi]:
        draw_crescent_blade(c1, start_ang=offset + 1.2, sweep=2.2,
                            r_start=5.5, r_end=16.0, max_w=3.6)
    # Orbiting dust motes
    draw_dust(c1, CX - 15, CY + 8, size=2)
    draw_dust(c1, CX + 14, CY - 9, size=2)
    draw_dust(c1, CX - 8, CY - 14, size=1)
    draw_dust(c1, CX + 9, CY + 15, size=1)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: Peak Whirlwind Slash! Full 360 hurricane coverage
    c2 = PixelCanvas(FW, FH)
    c2.draw_ring(CX, CY, 13.5, 14.5, WIND_CYAN)
    c2.draw_ring(CX, CY, 18.0, 19.0, DEEP_SLATE)
    for offset in [0.0, math.pi]:
        draw_crescent_blade(c2, start_ang=offset + 2.5, sweep=2.9,
                            r_start=6.5, r_end=20.0, max_w=4.4)
    # Hurricane eye center
    c2.draw_diamond(CX, CY, 3, 3, WHITE)
    c2.draw_diamond(CX, CY, 5, 5, PALE_AERO)
    c2.draw_diamond(CX, CY, 2, 2, WHITE)
    # Violent swirling dust ring
    dust_pts = [
        (CX - 19, CY - 4), (CX + 19, CY + 5), (CX - 5, CY + 19),
        (CX + 6, CY - 19), (CX + 16, CY - 13), (CX - 15, CY + 14)
    ]
    for dx, dy in dust_pts:
        draw_dust(c2, dx, dy, size=2)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Blade Overshoot & Detachment - blades fly outward into sonic arcs
    c3 = PixelCanvas(FW, FH)
    c3.draw_ring(CX, CY, 11.0, 12.5, PALE_AERO)
    c3.draw_ring(CX, CY, 16.5, 17.5, DEEP_SLATE)
    for offset in [0.0, math.pi]:
        draw_crescent_blade(c3, start_ang=offset + 4.0, sweep=2.4,
                            r_start=11.5, r_end=21.5, max_w=3.4)
    # Expanding shockwave core
    c3.draw_diamond(CX, CY, 4, 4, WIND_CYAN)
    c3.draw_diamond(CX, CY, 2, 2, WHITE)
    # Dispersing dust particles
    for k in range(8):
        ang = k * (math.pi / 4) + 0.2
        dx = int(round(CX + 21.0 * math.cos(ang)))
        dy = int(round(CY + 21.0 * math.sin(ang)))
        draw_dust(c3, dx, dy, size=1)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Dispersal - crescent blades break into 4 flying wind ribbons
    c4 = PixelCanvas(FW, FH)
    for k in range(4):
        ang = 5.2 + k * (math.pi / 2)
        draw_crescent_blade(c4, start_ang=ang, sweep=1.0,
                            r_start=16.0, r_end=22.0, max_w=2.6, steps=10)
    # Scattered wind motes
    for ang in [0.4, 1.9, 3.5, 5.1]:
        wx = int(round(CX + 14.0 * math.cos(ang)))
        wy = int(round(CY + 14.0 * math.sin(ang)))
        c4.set(wx, wy, PALE_AERO)
        c4.set(wx + 1, wy, WHITE)
    # Outer dust ring
    for ang in [0.8, 2.3, 3.9, 5.5]:
        dx = int(round(CX + 22.0 * math.cos(ang)))
        dy = int(round(CY + 22.0 * math.sin(ang)))
        draw_dust(c4, dx, dy, size=1)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    # Frame 5: Dissipation - residual twinkling wind sparks and settling dust
    c5 = PixelCanvas(FW, FH)
    sparks = [
        (CX + 16, CY - 8), (CX - 15, CY + 7), (CX + 7, CY + 16), (CX - 8, CY - 15),
        (CX + 12, CY + 11), (CX - 11, CY - 12), (CX + 20, CY + 2), (CX - 19, CY - 3)
    ]
    for sx, sy in sparks:
        c5.set(sx, sy, WIND_CYAN)
        c5.set(sx + 1, sy, PALE_AERO)
    for sx, sy in [(CX + 16, CY - 8), (CX - 8, CY - 15), (CX + 20, CY + 2)]:
        c5.set(sx, sy, WHITE)
    # Lingering ground dust motes
    draw_dust(c5, CX - 12, CY + 14, size=1)
    draw_dust(c5, CX + 13, CY + 13, size=1)
    draw_dust(c5, CX - 4, CY + 17, size=1)
    draw_dust(c5, CX + 5, CY + 18, size=1)
    c5.add_outline(OUTLINE)
    frames.append(c5)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# FX 7: Earth Shatter (48x48 per frame, 6 frames -> 288x48)
# Seismic jagged ground rupture, rising rock spikes, and flying earthen debris
# -----------------------------------------------------------------------------

def generate_earth_shatter() -> Image.Image:
    FW, FH = 48, 48
    CX = 24
    GROUND_Y = 37

    OUTLINE: RGBA = (26, 16, 36, 255)         # 1px Dark Outline #1a1024
    CHASM_BLACK: RGBA = (38, 24, 22, 255)     # Deep Fissure Abyss
    ROCK_SHADOW: RGBA = (82, 58, 48, 255)     # Shaded Rock Facet
    ROCK_MID: RGBA = (135, 102, 78, 255)      # Earth Stone Midtone
    ROCK_LIT: RGBA = (188, 155, 120, 255)     # Lit Rock Facet
    ROCK_HIGHLIGHT: RGBA = (228, 205, 175, 255)# Crisp Stone Edge
    FISSURE_GLOW: RGBA = (255, 140, 40, 255)  # Magma / Seismic Flare
    FISSURE_CORE: RGBA = (255, 225, 120, 255) # Blinding Seismic Energy
    WHITE: RGBA = (255, 255, 255, 255)        # Specular Crack

    frames: List[PixelCanvas] = []

    def draw_rock_spike(c: PixelCanvas, bx: int, by: int, tx: int, ty: int,
                        w_left: int, w_right: int, sh_ratio: float = 0.55):
        """Draws a 3D faceted jagged stone monolith with lit & shadow facets."""
        sh_y = int(round(by - (by - ty) * sh_ratio))
        sh_lx = bx - w_left
        sh_rx = bx + w_right

        p_base = (bx, by)
        p_tip = (tx, ty)
        p_sh_left = (sh_lx, sh_y)
        p_sh_right = (sh_rx, sh_y)

        # Left facet (illuminated face)
        c.draw_polygon([p_base, p_sh_left, p_tip], ROCK_LIT)
        # Right facet (shaded face)
        c.draw_polygon([p_base, p_sh_right, p_tip], ROCK_SHADOW)

        # Center ridge spine
        c.draw_line(bx, by, tx, ty, ROCK_HIGHLIGHT, width=1)
        # Left edge highlight
        c.draw_line(sh_lx, sh_y, tx, ty, ROCK_HIGHLIGHT, width=1)
        # Tip glint
        c.set(tx, ty, WHITE)

    def draw_ground_fissure(c: PixelCanvas, x_start: int, x_end: int, y_mid: int,
                            width_y: int = 3, core: bool = True):
        # Draw dark chasm cavity
        c.draw_rect(x_start, y_mid, x_end - x_start + 1, width_y, CHASM_BLACK)
        # Jagged lava / energy seams
        pts = [
            (x_start, y_mid + 1),
            (x_start + 6, y_mid),
            (x_start + 14, y_mid + 2),
            (CX, y_mid + 1),
            (x_end - 14, y_mid),
            (x_end - 6, y_mid + 2),
            (x_end, y_mid + 1)
        ]
        for i in range(len(pts) - 1):
            c.draw_line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], FISSURE_GLOW, width=2)
            if core:
                c.draw_line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], FISSURE_CORE, width=1)

    def draw_flying_rock(c: PixelCanvas, cx: int, cy: int, size: int):
        c.draw_diamond(cx, cy, size, size, ROCK_MID)
        c.draw_diamond(cx - 1, cy - 1, max(1, size - 1), max(1, size - 1), ROCK_LIT)
        c.set(cx - 1, cy - 1, ROCK_HIGHLIGHT)
        c.set(cx + size - 1, cy + size - 1, ROCK_SHADOW)

    def draw_earthen_dust(c: PixelCanvas, cx: int, cy: int, r: int):
        c.draw_circle(cx, cy, r, ROCK_SHADOW)
        c.draw_circle(cx - 1, cy - 1, max(1, r - 1), ROCK_MID)
        c.set(cx - 1, cy - 1, ROCK_LIT)

    # Frame 0: Seismic Genesis - ground fracture opening and small rock teeth
    c0 = PixelCanvas(FW, FH)
    draw_ground_fissure(c0, 14, 34, GROUND_Y, width_y=2, core=True)
    # Small rock teeth emerging
    draw_rock_spike(c0, bx=CX, by=GROUND_Y, tx=CX, ty=31, w_left=3, w_right=3)
    draw_rock_spike(c0, bx=18, by=GROUND_Y, tx=17, ty=33, w_left=2, w_right=2)
    draw_rock_spike(c0, bx=30, by=GROUND_Y, tx=31, ty=33, w_left=2, w_right=2)
    # Dust puffs at ends
    draw_earthen_dust(c0, 12, GROUND_Y, r=2)
    draw_earthen_dust(c0, 36, GROUND_Y, r=2)
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Tectonic Eruption - 3 jagged rock spikes surging upward
    c1 = PixelCanvas(FW, FH)
    draw_ground_fissure(c1, 9, 39, GROUND_Y, width_y=3, core=True)
    draw_rock_spike(c1, bx=CX, by=GROUND_Y, tx=CX, ty=20, w_left=5, w_right=4, sh_ratio=0.55)
    draw_rock_spike(c1, bx=16, by=GROUND_Y, tx=14, ty=25, w_left=3, w_right=3, sh_ratio=0.5)
    draw_rock_spike(c1, bx=32, by=GROUND_Y, tx=34, ty=24, w_left=3, w_right=3, sh_ratio=0.5)
    # Flying pebble debris
    draw_flying_rock(c1, 19, 18, size=2)
    draw_flying_rock(c1, 28, 17, size=2)
    draw_flying_rock(c1, 11, 22, size=1)
    draw_flying_rock(c1, 37, 21, size=1)
    # Dust at base
    draw_earthen_dust(c1, 8, GROUND_Y, r=3)
    draw_earthen_dust(c1, 40, GROUND_Y, r=3)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: PEAK EARTH SHATTER! 5 colossal rock spikes + maximum debris
    c2 = PixelCanvas(FW, FH)
    draw_ground_fissure(c2, 5, 43, GROUND_Y, width_y=4, core=True)
    # 5 towering spikes
    draw_rock_spike(c2, bx=CX, by=GROUND_Y + 1, tx=CX, ty=10, w_left=6, w_right=5, sh_ratio=0.6) # Colossal Center
    draw_rock_spike(c2, bx=16, by=GROUND_Y + 1, tx=13, ty=16, w_left=4, w_right=3, sh_ratio=0.55) # Inner Left
    draw_rock_spike(c2, bx=32, by=GROUND_Y + 1, tx=35, ty=15, w_left=3, w_right=4, sh_ratio=0.55) # Inner Right
    draw_rock_spike(c2, bx=8, by=GROUND_Y + 1, tx=5, ty=24, w_left=3, w_right=2, sh_ratio=0.5)   # Outer Left
    draw_rock_spike(c2, bx=40, by=GROUND_Y + 1, tx=43, ty=23, w_left=2, w_right=3, sh_ratio=0.5)  # Outer Right
    # Airborne boulders blasted skyward
    draw_flying_rock(c2, 20, 7, size=3)
    draw_flying_rock(c2, 29, 6, size=2)
    draw_flying_rock(c2, 10, 11, size=2)
    draw_flying_rock(c2, 38, 10, size=2)
    draw_flying_rock(c2, 24, 4, size=1)
    # Billowing dust shockwave at perimeter
    draw_earthen_dust(c2, 4, GROUND_Y - 1, r=4)
    draw_earthen_dust(c2, 44, GROUND_Y - 1, r=4)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Faultline Fracture & Debris Blast - tips shatter into flying boulders
    c3 = PixelCanvas(FW, FH)
    draw_ground_fissure(c3, 6, 42, GROUND_Y, width_y=3, core=False)
    # Fractured spike bodies (tips sheared off)
    draw_rock_spike(c3, bx=CX, by=GROUND_Y, tx=CX + 1, ty=18, w_left=5, w_right=5, sh_ratio=0.5)
    draw_rock_spike(c3, bx=16, by=GROUND_Y, tx=15, ty=22, w_left=4, w_right=3, sh_ratio=0.5)
    draw_rock_spike(c3, bx=32, by=GROUND_Y, tx=33, ty=21, w_left=3, w_right=4, sh_ratio=0.5)
    draw_rock_spike(c3, bx=8, by=GROUND_Y, tx=6, ty=27, w_left=2, w_right=2, sh_ratio=0.5)
    draw_rock_spike(c3, bx=40, by=GROUND_Y, tx=42, ty=26, w_left=2, w_right=2, sh_ratio=0.5)
    # Horizontal glowing fault cracks across the fractured rock
    c3.draw_line(CX - 4, 18, CX + 4, 18, FISSURE_CORE, width=1)
    c3.draw_line(13, 22, 18, 22, FISSURE_GLOW, width=1)
    c3.draw_line(30, 21, 35, 21, FISSURE_GLOW, width=1)
    # Detached boulders flying in trajectory
    draw_flying_rock(c3, CX - 2, 8, size=3)
    draw_flying_rock(c3, CX + 7, 7, size=2)
    draw_flying_rock(c3, 11, 14, size=2)
    draw_flying_rock(c3, 37, 13, size=2)
    draw_flying_rock(c3, 5, 19, size=2)
    draw_flying_rock(c3, 43, 18, size=2)
    # Dust cloud rolling over base
    draw_earthen_dust(c3, 6, GROUND_Y - 2, r=4)
    draw_earthen_dust(c3, 42, GROUND_Y - 2, r=4)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Collapse & Tumbling Boulders - spikes crumble to stumps, boulders descend
    c4 = PixelCanvas(FW, FH)
    draw_ground_fissure(c4, 10, 38, GROUND_Y, width_y=2, core=False)
    # Craggy rock stumps
    draw_rock_spike(c4, bx=CX, by=GROUND_Y, tx=CX, ty=25, w_left=5, w_right=4, sh_ratio=0.5)
    draw_rock_spike(c4, bx=15, by=GROUND_Y, tx=14, ty=28, w_left=3, w_right=3, sh_ratio=0.5)
    draw_rock_spike(c4, bx=33, by=GROUND_Y, tx=34, ty=27, w_left=3, w_right=3, sh_ratio=0.5)
    # Boulders falling back down
    draw_flying_rock(c4, CX - 5, 17, size=2)
    draw_flying_rock(c4, CX + 6, 16, size=2)
    draw_flying_rock(c4, 9, 21, size=2)
    draw_flying_rock(c4, 39, 20, size=2)
    # Dense ground dust
    draw_earthen_dust(c4, 12, GROUND_Y - 1, r=4)
    draw_earthen_dust(c4, 36, GROUND_Y - 1, r=4)
    draw_earthen_dust(c4, CX, GROUND_Y - 1, r=3)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    # Frame 5: Settled Ruin & Dust Haze - rugged rubble chunks and floating dust
    c5 = PixelCanvas(FW, FH)
    # Ground chasm remnants
    c5.draw_rect(12, GROUND_Y, 25, 2, CHASM_BLACK)
    # Craggy rocky boulders resting on ground
    draw_flying_rock(c5, CX - 6, GROUND_Y - 1, size=3)
    draw_flying_rock(c5, CX + 5, GROUND_Y - 1, size=3)
    draw_flying_rock(c5, 12, GROUND_Y, size=2)
    draw_flying_rock(c5, 36, GROUND_Y, size=2)
    # Lingering floating dust motes
    dust_motes = [
        (CX - 8, 20), (CX + 8, 19), (CX - 14, 25), (CX + 14, 24),
        (CX - 3, 27), (CX + 4, 26), (10, 30), (38, 29)
    ]
    for mx, my in dust_motes:
        c5.set(mx, my, ROCK_MID)
        c5.set(mx, my - 1, ROCK_LIT)
    c5.add_outline(OUTLINE)
    frames.append(c5)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# FX 8: Arcane Beam (32x64 per frame, 5 frames -> 160x64)
# Vertical celestial arcane energy pillar + ground focusing rune
# -----------------------------------------------------------------------------

def generate_arcane_beam() -> Image.Image:
    FW, FH = 32, 64
    CX = 16
    GROUND_Y = 55

    OUTLINE: RGBA = (26, 16, 36, 255)         # 1px Dark Outline #1a1024
    ABYSS_PURPLE: RGBA = (45, 18, 65, 255)    # Outer Arcane Corona / Aura
    VIOLET_DEEP: RGBA = (95, 35, 140, 255)    # Arcane Violet Midtone
    MAGENTA_ARCANE: RGBA = (175, 65, 215, 255)# Radiant Arcane Glow
    CYAN_CELESTIAL: RGBA = (80, 205, 245, 255)# Celestial Cyan Energy
    PALE_CYAN: RGBA = (185, 240, 255, 255)    # Celestial White-Cyan
    WHITE: RGBA = (255, 255, 255, 255)        # Pure Blinding Core
    GOLD_RUNE: RGBA = (255, 215, 100, 255)    # Mystic Gold Glyphs

    frames: List[PixelCanvas] = []

    def draw_ground_rune(c: PixelCanvas, rx: float, ry: float, power: float):
        """Renders an intricate ground focusing rune seal."""
        # Outer celestial ellipse ring
        c.draw_ellipse(CX, GROUND_Y, rx=rx, ry=ry, fill=VIOLET_DEEP)
        c.draw_ellipse(CX, GROUND_Y, rx=max(1.0, rx - 1.2), ry=max(1.0, ry - 1.2), fill=TRANSPARENT)
        # Inner magenta ring
        c.draw_ellipse(CX, GROUND_Y, rx=rx * 0.7, ry=ry * 0.7, fill=MAGENTA_ARCANE)
        c.draw_ellipse(CX, GROUND_Y, rx=max(1.0, rx * 0.7 - 1.0), ry=max(1.0, ry * 0.7 - 1.0), fill=TRANSPARENT)
        # 8 cardinal & diagonal rune glyphs
        for k in range(8):
            ang = k * (math.pi / 4)
            gx = int(round(CX + rx * math.cos(ang)))
            gy = int(round(GROUND_Y + ry * math.sin(ang)))
            c.set(gx, gy, GOLD_RUNE if k % 2 == 0 else PALE_CYAN)
        # Central diamond seal
        c.draw_diamond(CX, GROUND_Y, int(round(rx * 0.35)), int(round(ry * 0.35)), CYAN_CELESTIAL)
        c.set(CX, GROUND_Y, WHITE)

    def draw_vertical_pillar(c: PixelCanvas, y_top: int, y_bottom: int,
                             w_corona: int, w_magenta: int, w_cyan: int,
                             w_pale: int, w_white: int):
        """Draws concentric vertical arcane beam layers."""
        for y in range(y_top, y_bottom + 1):
            # Outer corona
            if w_corona > 0:
                c.draw_line(CX - w_corona // 2, y, CX + w_corona // 2, y, ABYSS_PURPLE)
            if w_magenta > 0:
                c.draw_line(CX - w_magenta // 2, y, CX + w_magenta // 2, y, MAGENTA_ARCANE)
            if w_cyan > 0:
                c.draw_line(CX - w_cyan // 2, y, CX + w_cyan // 2, y, CYAN_CELESTIAL)
            if w_pale > 0:
                c.draw_line(CX - w_pale // 2, y, CX + w_pale // 2, y, PALE_CYAN)
            if w_white > 0:
                c.draw_line(CX - w_white // 2, y, CX + w_white // 2, y, WHITE)

    def draw_orbital_ring(c: PixelCanvas, cy: int, rx: float, ry: float):
        """Draws a 3D tilted celestial energy ring wrapping around the pillar."""
        # Back half
        irx = int(math.ceil(rx))
        for dx in range(-irx, irx + 1):
            if abs(dx) <= rx:
                dy = -int(round(ry * math.sqrt(max(0.0, 1.0 - (dx / rx) ** 2))))
                c.set(CX + dx, cy + dy, VIOLET_DEEP)
        # Front half (brighter)
        for dx in range(-irx, irx + 1):
            if abs(dx) <= rx:
                dy = int(round(ry * math.sqrt(max(0.0, 1.0 - (dx / rx) ** 2))))
                c.set(CX + dx, cy + dy, PALE_CYAN)
                if abs(dx) <= rx * 0.5:
                    c.set(CX + dx, cy + dy, WHITE)

    def draw_celestial_star(c: PixelCanvas, x: int, y: int, size: int):
        c.draw_line(x - size, y, x + size, y, CYAN_CELESTIAL)
        c.draw_line(x, y - size, x, y + size, CYAN_CELESTIAL)
        c.set(x, y, WHITE)

    # Frame 0: Inception - Ground focusing rune ignites + sky tracer laser
    c0 = PixelCanvas(FW, FH)
    draw_ground_rune(c0, rx=9.5, ry=3.5, power=0.5)
    # Narrow descending tracer beam
    draw_vertical_pillar(c0, y_top=0, y_bottom=44,
                         w_corona=4, w_magenta=2, w_cyan=2, w_pale=1, w_white=1)
    # Ground focus spark
    draw_celestial_star(c0, CX, GROUND_Y, size=2)
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Pillar Surge - beam impacts ground rune and flares
    c1 = PixelCanvas(FW, FH)
    draw_ground_rune(c1, rx=12.0, ry=4.5, power=0.8)
    # Medium vertical beam
    draw_vertical_pillar(c1, y_top=0, y_bottom=GROUND_Y,
                         w_corona=10, w_magenta=8, w_cyan=6, w_pale=4, w_white=2)
    # Ground impact disc
    c1.draw_ellipse(CX, GROUND_Y, rx=6.0, ry=2.2, fill=WHITE)
    # 2 orbital rings
    draw_orbital_ring(c1, cy=22, rx=7.0, ry=2.5)
    draw_orbital_ring(c1, cy=38, rx=7.0, ry=2.5)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: PEAK ARCANE PILLAR! Full titanic celestial beam + maximum rune flare
    c2 = PixelCanvas(FW, FH)
    draw_ground_rune(c2, rx=14.5, ry=5.5, power=1.0)
    # Massive vertical beam
    draw_vertical_pillar(c2, y_top=0, y_bottom=GROUND_Y,
                         w_corona=18, w_magenta=14, w_cyan=10, w_pale=6, w_white=4)
    # Ground impact flash starburst
    c2.draw_ellipse(CX, GROUND_Y, rx=10.0, ry=3.0, fill=WHITE)
    c2.draw_line(CX - 12, GROUND_Y, CX + 12, GROUND_Y, WHITE, width=1)
    # 3 orbital rings
    draw_orbital_ring(c2, cy=14, rx=9.5, ry=3.0)
    draw_orbital_ring(c2, cy=28, rx=9.5, ry=3.0)
    draw_orbital_ring(c2, cy=42, rx=9.5, ry=3.0)
    # Orbiting celestial stars
    draw_celestial_star(c2, CX - 9, 20, size=2)
    draw_celestial_star(c2, CX + 9, 34, size=2)
    draw_celestial_star(c2, CX - 8, 46, size=1)
    draw_celestial_star(c2, CX + 8, 12, size=1)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Harmonic Pulse & Detachment - beam breaks into vertical streaming ribbons
    c3 = PixelCanvas(FW, FH)
    # Expanding ground shockwave ring
    c3.draw_ellipse(CX, GROUND_Y, rx=15.0, ry=5.0, fill=MAGENTA_ARCANE)
    c3.draw_ellipse(CX, GROUND_Y, rx=13.5, ry=4.0, fill=TRANSPARENT)
    # Segmented pulsing beam dashes
    for y_seg in [2, 12, 22, 32, 42]:
        draw_vertical_pillar(c3, y_top=y_seg, y_bottom=y_seg + 6,
                             w_corona=12, w_magenta=8, w_cyan=6, w_pale=3, w_white=1)
    # Ascending celestial diamond sparks
    for sy in [8, 18, 28, 38, 48]:
        draw_celestial_star(c3, CX + (-3 if sy % 20 == 8 else 3), sy, size=2)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Celestial Fallout / Dissipation - column of ascending sparks and fading rune
    c4 = PixelCanvas(FW, FH)
    # Fading ground rune embers
    c4.draw_ellipse(CX, GROUND_Y, rx=8.0, ry=3.0, fill=VIOLET_DEEP)
    c4.set(CX, GROUND_Y, GOLD_RUNE)
    for k in range(6):
        ang = k * (math.pi / 3)
        gx = int(round(CX + 8.0 * math.cos(ang)))
        gy = int(round(GROUND_Y + 3.0 * math.sin(ang)))
        c4.set(gx, gy, GOLD_RUNE)
    # Column of ascending celestial diamond stars and particles
    motes = [
        (CX - 4, 8), (CX + 3, 13), (CX - 2, 19), (CX + 5, 25),
        (CX - 5, 31), (CX + 2, 37), (CX - 3, 43), (CX + 4, 49)
    ]
    for mx, my in motes:
        draw_celestial_star(c4, mx, my, size=1)
        c4.set(mx, my, WHITE)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# FX 9: Void Cleave (40x40 per frame, 5 frames -> 200x40)
# Dark shadow crescent slash tearing through dimensional fabric
# -----------------------------------------------------------------------------

def generate_void_cleave() -> Image.Image:
    FW, FH = 40, 40
    CX, CY = 20, 20

    OUTLINE: RGBA = (26, 16, 36, 255)         # 1px Dark Outline #1a1024
    VOID_PITCH: RGBA = (18, 12, 28, 255)      # Abyss / Spatial Tear Interior
    DARK_NETHER: RGBA = (65, 20, 75, 255)     # Deep Nether Underbelly
    SHADOW_CRIMSON: RGBA = (135, 30, 85, 255) # Nether Rim Shadow
    MAGENTA_WARP: RGBA = (215, 45, 145, 255)  # Radiant Spatial Tear Edge
    NEON_VIOLET: RGBA = (180, 95, 245, 255)   # Dimensional Bleed
    CYAN_RIFT: RGBA = (150, 240, 255, 255)    # Rift Seam Glint
    WHITE: RGBA = (255, 255, 255, 255)        # Pure Reality Fracture

    frames: List[PixelCanvas] = []

    def draw_dimensional_tear(c: PixelCanvas, p0: Tuple[int, int], p1: Tuple[int, int],
                              p2: Tuple[int, int], max_w: float, steps: int = 24):
        """Draws a sweeping curved dimensional tear with pitch black abyss interior."""
        pts_up: List[Tuple[int, int]] = []
        pts_down: List[Tuple[int, int]] = []
        pts_spine: List[Tuple[int, int]] = []

        for i in range(steps + 1):
            t = i / float(steps)
            # Quadratic Bezier
            bx = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
            by = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
            pts_spine.append((int(round(bx)), int(round(by))))

            # Tangent
            tx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
            ty = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
            length = math.sqrt(tx * tx + ty * ty) + 1e-5
            nx = -ty / length
            ny = tx / length

            w = max_w * math.sin(math.pi * (t ** 0.8))

            ux = int(round(bx + (w * 0.55) * nx))
            uy = int(round(by + (w * 0.55) * ny))
            pts_up.append((ux, uy))

            dx = int(round(bx - (w * 0.45) * nx))
            dy = int(round(by - (w * 0.45) * ny))
            pts_down.append((dx, dy))

        # Fill tear interior with void pitch
        poly = pts_up + list(reversed(pts_down))
        c.draw_polygon(poly, VOID_PITCH)

        # Upper radiant magenta event horizon
        for j in range(len(pts_up) - 1):
            c.draw_line(pts_up[j][0], pts_up[j][1], pts_up[j+1][0], pts_up[j+1][1], MAGENTA_WARP, width=1)

        # Lower dark nether rim
        for j in range(len(pts_down) - 1):
            c.draw_line(pts_down[j][0], pts_down[j][1], pts_down[j+1][0], pts_down[j+1][1], SHADOW_CRIMSON, width=1)

        # Cutting reality fracture spine
        for j in range(len(pts_spine) - 1):
            c.draw_line(pts_spine[j][0], pts_spine[j][1], pts_spine[j+1][0], pts_spine[j+1][1], CYAN_RIFT, width=1)

        # Tips glint
        if pts_spine:
            c.set(pts_spine[0][0], pts_spine[0][1], WHITE)
            c.set(pts_spine[-1][0], pts_spine[-1][1], WHITE)

    def draw_crack(c: PixelCanvas, pts: List[Tuple[int, int]]):
        """Draws a jagged reality fracture line."""
        for i in range(len(pts) - 1):
            c.draw_line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], NEON_VIOLET, width=1)
        if pts:
            c.set(pts[-1][0], pts[-1][1], CYAN_RIFT)

    # Frame 0: Incision - sharp void blade draws diagonal fracture line
    c0 = PixelCanvas(FW, FH)
    draw_dimensional_tear(c0, p0=(30, 8), p1=(22, 15), p2=(14, 26), max_w=2.8)
    # Center incision flash
    c0.draw_diamond(22, 17, 2, 2, WHITE)
    # 2 tiny reality fracture cracks
    draw_crack(c0, [(22, 17), (26, 13), (28, 10)])
    draw_crack(c0, [(18, 22), (16, 26), (12, 27)])
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Tearing Spacetime - dimensional rift rips open
    c1 = PixelCanvas(FW, FH)
    draw_dimensional_tear(c1, p0=(34, 6), p1=(19, 17), p2=(8, 32), max_w=5.5)
    # Magenta warp aura
    c1.draw_line(30, 4, 35, 7, MAGENTA_WARP, width=1)
    c1.draw_line(6, 30, 9, 34, MAGENTA_WARP, width=1)
    # 3 reality cracks
    draw_crack(c1, [(25, 12), (28, 8), (32, 6)])
    draw_crack(c1, [(19, 18), (22, 23), (25, 27)])
    draw_crack(c1, [(13, 26), (9, 24), (6, 26)])
    # Spatial distortion motes
    c1.set(16, 12, CYAN_RIFT)
    c1.set(24, 25, CYAN_RIFT)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: PEAK VOID CLEAVE! Grand dimensional rupture + branching reality lightning
    c2 = PixelCanvas(FW, FH)
    # Massive sweeping dimensional tear
    draw_dimensional_tear(c2, p0=(37, 4), p1=(17, 18), p2=(4, 36), max_w=8.5)
    # Central blinding rupture core
    c2.draw_line(18, 16, 22, 20, WHITE, width=2)
    # 6 jagged reality fracture branches tearing outward into space
    draw_crack(c2, [(28, 11), (32, 7), (35, 4)])
    draw_crack(c2, [(24, 15), (28, 16), (32, 14)])
    draw_crack(c2, [(20, 20), (25, 26), (28, 31)])
    draw_crack(c2, [(16, 24), (12, 27), (8, 30)])
    draw_crack(c2, [(12, 28), (9, 33), (5, 36)])
    draw_crack(c2, [(17, 18), (13, 14), (9, 12)])
    # Flying void shards
    for sx, sy in [(30, 18), (14, 10), (24, 30), (10, 22)]:
        c2.draw_diamond(sx, sy, 1, 1, MAGENTA_WARP)
        c2.set(sx, sy, CYAN_RIFT)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Spacetime Snapping & Collapse - tear fractures into collapsing sickle segments
    c3 = PixelCanvas(FW, FH)
    # 3 collapsing sickle segments
    draw_dimensional_tear(c3, p0=(35, 6), p1=(29, 11), p2=(24, 16), max_w=4.0, steps=10)
    draw_dimensional_tear(c3, p0=(22, 18), p1=(17, 22), p2=(13, 27), max_w=4.5, steps=10)
    draw_dimensional_tear(c3, p0=(11, 29), p1=(7, 33), p2=(4, 36), max_w=3.5, steps=10)
    # Expanding spatial distortion shockwave ring
    c3.draw_ring(CX, CY, 13.5, 14.5, DARK_NETHER)
    # High-energy snap sparks at fracture joints
    c3.draw_diamond(23, 17, 2, 2, WHITE)
    c3.draw_diamond(12, 28, 2, 2, WHITE)
    # Scattered void wisps
    for ang in [0.5, 2.1, 3.6, 5.2]:
        wx = int(round(CX + 15.0 * math.cos(ang)))
        wy = int(round(CY + 15.0 * math.sin(ang)))
        c3.set(wx, wy, NEON_VIOLET)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Dimensional Scar & Dissipation - lingering spatial seam and void embers
    c4 = PixelCanvas(FW, FH)
    # Fading jagged scar line
    scar_pts = [(33, 7), (27, 13), (21, 19), (15, 25), (9, 31), (5, 35)]
    for i in range(len(scar_pts) - 1):
        c4.draw_line(scar_pts[i][0], scar_pts[i][1], scar_pts[i+1][0], scar_pts[i+1][1], DARK_NETHER, width=1)
        c4.set(scar_pts[i][0], scar_pts[i][1], MAGENTA_WARP)
    # Dissipating void embers
    embers = [
        (30, 14), (25, 9), (18, 27), (12, 22), (23, 23),
        (28, 25), (14, 16), (8, 28), (34, 10)
    ]
    for ex, ey in embers:
        c4.set(ex, ey, NEON_VIOLET)
        c4.set(ex + 1, ey, CYAN_RIFT)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    return assemble_sheet(frames)


# -----------------------------------------------------------------------------
# FX 10: Healing Bloom (32x32 per frame, 5 frames -> 160x32)
# Blossoming radiant lotus flower opening + sparkling holy pollen motes
# -----------------------------------------------------------------------------

def generate_healing_bloom() -> Image.Image:
    FW, FH = 32, 32
    CX = 16
    BASE_Y = 22

    OUTLINE: RGBA = (26, 16, 36, 255)         # 1px Dark Outline #1a1024
    DEEP_EMERALD: RGBA = (32, 75, 45, 255)    # Sepal / Leaf Shadow
    LEAF_GREEN: RGBA = (65, 145, 75, 255)     # Sacred Lotus Pad Midtone
    LIGHT_JADE: RGBA = (120, 205, 130, 255)   # Leaf Highlight
    ROSE_SHADOW: RGBA = (130, 38, 80, 255)    # Petal Underbelly Shadow
    LOTUS_PINK: RGBA = (215, 75, 135, 255)    # Lotus Petal Midtone
    BLUSH_LIGHT: RGBA = (250, 155, 195, 255)  # Radiant Petal Face
    GOLD_POLLEN: RGBA = (255, 205, 60, 255)   # Holy Pollen / Stamen
    HOLY_YELLOW: RGBA = (255, 245, 130, 255)  # Radiant Holy Glow
    WHITE: RGBA = (255, 255, 255, 255)        # Sacred Core Sparkle

    frames: List[PixelCanvas] = []

    def draw_sepal_pad(c: PixelCanvas, width: int):
        """Draws sacred emerald jade lily pad / calyx beneath the lotus."""
        hw = width // 2
        # Base leaf ellipse
        c.draw_ellipse(CX, BASE_Y + 1, rx=hw, ry=2.5, fill=DEEP_EMERALD)
        c.draw_ellipse(CX, BASE_Y, rx=hw - 1, ry=1.8, fill=LEAF_GREEN)
        c.draw_line(CX - hw + 2, BASE_Y, CX + hw - 2, BASE_Y, LIGHT_JADE, width=1)

    def draw_lotus_petal(c: PixelCanvas, bx: int, by: int, tx: int, ty: int,
                         w_left: int, w_right: int):
        """Draws a delicate pointed lotus petal with radiant blush shading."""
        sh_y = int(round(by + (ty - by) * 0.5))
        p_base = (bx, by)
        p_tip = (tx, ty)
        p_sh_left = (bx - w_left, sh_y)
        p_sh_right = (bx + w_right, sh_y)

        # Left petal half (illuminated)
        c.draw_polygon([p_base, p_sh_left, p_tip], BLUSH_LIGHT)
        # Right petal half (shaded)
        c.draw_polygon([p_base, p_sh_right, p_tip], LOTUS_PINK)
        # Petal base underbelly shadow
        c.set(bx, by, ROSE_SHADOW)
        c.set(bx, by - 1, ROSE_SHADOW)
        # Center spine highlight
        c.draw_line(bx, by - 1, tx, ty, BLUSH_LIGHT, width=1)
        c.set(tx, ty, WHITE)

    def draw_pollen_mote(c: PixelCanvas, x: int, y: int, size: int = 1):
        """Draws a sparkling 4-pointed holy pollen star."""
        c.set(x, y, GOLD_POLLEN)
        if size > 1:
            c.set(x - 1, y, HOLY_YELLOW)
            c.set(x + 1, y, HOLY_YELLOW)
            c.set(x, y - 1, HOLY_YELLOW)
            c.set(x, y + 1, HOLY_YELLOW)
            c.set(x, y, WHITE)

    # Frame 0: Sacred Lotus Bud - tightly closed glowing bud on jade calyx
    c0 = PixelCanvas(FW, FH)
    # Holy ground halo
    c0.draw_ring(CX, BASE_Y, 7.5, 8.5, DEEP_EMERALD)
    draw_sepal_pad(c0, width=10)
    # Closed bud (tall central teardrop)
    draw_lotus_petal(c0, bx=CX, by=BASE_Y, tx=CX, ty=12, w_left=3, w_right=3)
    # Golden seed glow at bud tip
    c0.set(CX, 12, WHITE)
    c0.set(CX, 13, GOLD_POLLEN)
    c0.set(CX, 14, HOLY_YELLOW)
    c0.add_outline(OUTLINE)
    frames.append(c0)

    # Frame 1: Bud Awakening - outer petals unfurl outward, revealing golden stamen
    c1 = PixelCanvas(FW, FH)
    # Expanding halo ring
    c1.draw_ring(CX, BASE_Y, 9.5, 10.5, LEAF_GREEN)
    draw_sepal_pad(c1, width=14)
    # 3 unfurling petals
    draw_lotus_petal(c1, bx=CX - 2, by=BASE_Y, tx=10, ty=14, w_left=3, w_right=2) # Left
    draw_lotus_petal(c1, bx=CX + 2, by=BASE_Y, tx=22, ty=14, w_left=2, w_right=3) # Right
    draw_lotus_petal(c1, bx=CX, by=BASE_Y, tx=CX, ty=10, w_left=3, w_right=3)     # Center tall
    # Glowing golden stamen at heart
    c1.draw_diamond(CX, 18, 2, 2, GOLD_POLLEN)
    c1.set(CX, 18, WHITE)
    # First 3 rising pollen sparks
    draw_pollen_mote(c1, CX - 4, 9, size=1)
    draw_pollen_mote(c1, CX + 5, 8, size=1)
    draw_pollen_mote(c1, CX, 6, size=2)
    c1.add_outline(OUTLINE)
    frames.append(c1)

    # Frame 2: PEAK RADIANT BLOOM! Majestic lotus fully opened in divine glory
    c2 = PixelCanvas(FW, FH)
    # Holy radiance halo ring
    c2.draw_ring(CX, BASE_Y, 12.5, 13.5, HOLY_YELLOW)
    draw_sepal_pad(c2, width=18)
    # Rear petals
    draw_lotus_petal(c2, bx=CX, by=BASE_Y, tx=CX, ty=7, w_left=4, w_right=4)      # Center spire
    draw_lotus_petal(c2, bx=CX - 2, by=BASE_Y, tx=11, ty=11, w_left=3, w_right=3) # Inner left
    draw_lotus_petal(c2, bx=CX + 2, by=BASE_Y, tx=21, ty=11, w_left=3, w_right=3) # Inner right
    # Wide arching outer petals
    draw_lotus_petal(c2, bx=CX - 4, by=BASE_Y, tx=5, ty=16, w_left=3, w_right=2)  # Outer left
    draw_lotus_petal(c2, bx=CX + 4, by=BASE_Y, tx=27, ty=16, w_left=2, w_right=3) # Outer right
    # Front cupped petals
    c2.draw_ellipse(CX, BASE_Y - 2, rx=4.5, ry=2.5, fill=BLUSH_LIGHT)
    c2.draw_line(CX - 3, BASE_Y - 2, CX + 3, BASE_Y - 2, WHITE, width=1)
    # Blinding golden stamen jewel at heart
    c2.draw_diamond(CX, 17, 3, 3, GOLD_POLLEN)
    c2.draw_diamond(CX, 17, 1, 1, WHITE)
    # Radiant 4-point holy light rays emanating from heart
    c2.draw_line(CX - 7, 17, CX + 7, 17, HOLY_YELLOW, width=1)
    c2.draw_line(CX, 12, CX, 20, HOLY_YELLOW, width=1)
    c2.set(CX, 17, WHITE)
    # Rising golden pollen motes
    pollen_burst = [(8, 9), (24, 8), (12, 5), (20, 5), (CX, 3), (16, 10)]
    for px, py in pollen_burst:
        draw_pollen_mote(c2, px, py, size=2 if py <= 5 else 1)
    c2.add_outline(OUTLINE)
    frames.append(c2)

    # Frame 3: Spiritual Release - cloud of holy pollen canopy ascending in arc
    c3 = PixelCanvas(FW, FH)
    c3.draw_ring(CX, BASE_Y, 14.5, 15.5, LEAF_GREEN)
    draw_sepal_pad(c3, width=16)
    # Lotus petals bathed in light
    draw_lotus_petal(c3, bx=CX, by=BASE_Y, tx=CX, ty=9, w_left=3, w_right=3)
    draw_lotus_petal(c3, bx=CX - 3, by=BASE_Y, tx=6, ty=16, w_left=3, w_right=2)
    draw_lotus_petal(c3, bx=CX + 3, by=BASE_Y, tx=26, ty=16, w_left=2, w_right=3)
    draw_lotus_petal(c3, bx=CX - 2, by=BASE_Y, tx=11, ty=12, w_left=3, w_right=2)
    draw_lotus_petal(c3, bx=CX + 2, by=BASE_Y, tx=21, ty=12, w_left=2, w_right=3)
    # Center golden heart
    c3.draw_diamond(CX, 18, 2, 2, GOLD_POLLEN)
    c3.set(CX, 18, WHITE)
    # Canopy cloud of sparkling holy pollen motes ascending in an arc
    canopy = [
        (4, 12), (28, 12), (7, 8), (25, 8), (11, 4), (21, 4),
        (CX, 2), (14, 9), (18, 9), (CX - 5, 14), (CX + 5, 14)
    ]
    for mx, my in canopy:
        draw_pollen_mote(c3, mx, my, size=2 if my <= 4 else 1)
    c3.add_outline(OUTLINE)
    frames.append(c3)

    # Frame 4: Golden Shower & Ascension - lotus resting as holy pollen stars drift upward
    c4 = PixelCanvas(FW, FH)
    draw_sepal_pad(c4, width=14)
    # Resting lotus flower
    draw_lotus_petal(c4, bx=CX, by=BASE_Y, tx=CX, ty=11, w_left=3, w_right=3)
    draw_lotus_petal(c4, bx=CX - 2, by=BASE_Y, tx=9, ty=16, w_left=3, w_right=2)
    draw_lotus_petal(c4, bx=CX + 2, by=BASE_Y, tx=23, ty=16, w_left=2, w_right=3)
    c4.set(CX, 18, GOLD_POLLEN)
    # Ascending heavenly pollen stars and healing dust
    celestial_pollen = [
        (6, 6), (26, 5), (10, 2), (22, 2), (CX, 1),
        (8, 11), (24, 10), (13, 7), (19, 7), (CX - 3, 13), (CX + 3, 13)
    ]
    for px, py in celestial_pollen:
        draw_pollen_mote(c4, px, py, size=2 if py <= 2 else 1)
        if py <= 2:
            c4.set(px, py, WHITE)
    c4.add_outline(OUTLINE)
    frames.append(c4)

    return assemble_sheet(frames)


root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(root_dir, "public", "assets", "custom", "fx")
os.makedirs(out_dir, exist_ok=True)

fx_specs = [
    ("whirlwind_slash.png", generate_whirlwind_slash, (288, 48), 6, 48, 48),
    ("earth_shatter.png", generate_earth_shatter, (288, 48), 6, 48, 48),
    ("arcane_beam.png", generate_arcane_beam, (160, 64), 5, 32, 64),
    ("void_cleave.png", generate_void_cleave, (200, 40), 5, 40, 40),
    ("healing_bloom.png", generate_healing_bloom, (160, 32), 5, 32, 32),
]

for filename, generator_fn, expected_size, n_frames, fw, fh in fx_specs:
    img = generator_fn()
    assert img.size == expected_size, f"{filename}: size {img.size} != {expected_size}"
    assert img.mode == "RGBA", f"{filename}: mode {img.mode} != RGBA"
    alphas = set(img.split()[3].get_flattened_data())
    assert alphas.issubset({0, 255}), f"{filename}: non-binary alpha found: {alphas}"
    out_path = os.path.join(out_dir, filename)
    img.save(out_path, format="PNG")
    print(f"Generated and saved {filename:<20} Size: {img.size[0]}x{img.size[1]} ({n_frames} frames of {fw}x{fh}) -> {out_path}")

print("All 5 new FX generators successfully tested, validated, and saved!")
