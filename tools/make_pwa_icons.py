#!/usr/bin/env python3
"""Generate the Wayfarer Online PWA icons (192/512 "any" + maskable, plus apple-touch).

Reproducible source of truth for public/icons/*.png. Precedent: tools/make_pet_egg_icons.py.

Design (pixel-art, matches the live title screen's Solana-inspired palette):
  * full-bleed navy field              #0A0E1A
  * 8-point "wayfarer" compass rose    long cardinal arms green #14F195,
                                       short diagonal arms purple #9945FF
  * cyan hub #03E1FF with a white #E1E8F0 core
  * "any" icons carry a thin green pixel frame; maskable icons are full-bleed with the
    art kept inside the ~80% circular safe zone so OS masks never clip it.

Arms are blunt-topped trapezoids (not needle points) so every arm stays orthogonally
connected on the coarse grid -- sharp apexes rasterise to corner-only "floating" pixels.
The whole mark is decided on a 32x32 master grid, mirrored about a pixel corner
(centre = 16.0) for exact 4-fold symmetry, then scaled by an integer factor with NEAREST
(192 = 32*6, 512 = 32*16) so the pixel edges stay razor-crisp.

Run from the repo root:  python tools/make_pwa_icons.py
"""

import math
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "icons")

GRID = 32

# Solana-inspired palette lifted from src/scenes/TitleScene.js (SOL constants).
BG = (0x0A, 0x0E, 0x1A)        # #0A0E1A  app background
GREEN = (0x14, 0xF1, 0x95)     # #14F195  primary accent  (cardinal arms)
PURPLE = (0x99, 0x45, 0xFF)    # #9945FF  secondary accent (diagonal arms)
CYAN = (0x03, 0xE1, 0xFF)      # #03E1FF  highlight (hub)
WHITE = (0xE1, 0xE8, 0xF0)     # #E1E8F0  core spark


def _in_poly(x, y, verts):
    """Ray-cast point-in-polygon for a pixel centre (x, y)."""
    inside = False
    n = len(verts)
    j = n - 1
    for i in range(n):
        xi, yi = verts[i]
        xj, yj = verts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _arm(cx, cy, angle_deg, r_in, r_out, w_in, w_out):
    """Quad for one blunt-topped (trapezoid) compass arm, tapering r_in -> r_out."""
    a = math.radians(angle_deg)
    ux, uy = math.cos(a), math.sin(a)
    vx, vy = -uy, ux  # perpendicular
    bx, by = cx + ux * r_in, cy + uy * r_in
    tx, ty = cx + ux * r_out, cy + uy * r_out
    return [
        (bx + vx * w_in, by + vy * w_in),
        (tx + vx * w_out, ty + vy * w_out),
        (tx - vx * w_out, ty - vy * w_out),
        (bx - vx * w_in, by - vy * w_in),
    ]


def _master(maskable):
    """Return the 32x32 RGBA master image."""
    c = GRID / 2.0  # 16.0 -> centre on a pixel corner => exact mirror symmetry
    s = 0.80 if maskable else 1.0
    r_in, r_card, r_diag = 1.8 * s, 13.0 * s, 9.6 * s
    w_in, w_card, w_diag = 2.8 * s, 1.6 * s, 1.5 * s
    hub = 3.4 * s

    polys = []
    for ang in (-90.0, 0.0, 90.0, 180.0):                      # cardinal arms -> green
        polys.append((_arm(c, c, ang, r_in, r_card, w_in, w_card), GREEN))
    for ang in (-45.0, 45.0, 135.0, 225.0):                    # diagonal arms -> purple
        polys.append((_arm(c, c, ang, r_in, r_diag, w_in, w_diag), PURPLE))

    img = Image.new("RGBA", (GRID, GRID), BG + (255,))
    out = img.load()
    for gy in range(GRID):
        for gx in range(GRID):
            x, y = gx + 0.5, gy + 0.5
            d = math.hypot(x - c, y - c)
            col = None
            if d <= hub:                                        # hub sits on top
                col = WHITE if d <= hub * 0.42 else CYAN
            else:
                for verts, cc in polys:
                    if _in_poly(x, y, verts):
                        col = cc
                        break
            if col:
                out[gx, gy] = col + (255,)

    if not maskable:                                            # thin green frame (skipped on maskable)
        lo, hi = 0, GRID - 1
        for i in range(GRID):
            out[lo, i] = GREEN + (255,)
            out[hi, i] = GREEN + (255,)
            out[i, lo] = GREEN + (255,)
            out[i, hi] = GREEN + (255,)
    return img


def _scaled(master, size):
    """Integer-NEAREST upscale; non-multiples of the grid (180) are centred on navy."""
    k = max(1, size // GRID)
    base = k * GRID
    img = master.resize((base, base), Image.NEAREST)
    if base != size:
        canvas = Image.new("RGBA", (size, size), BG + (255,))
        off = (size - base) // 2
        canvas.paste(img, (off, off))
        img = canvas
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    any_master = _master(maskable=False)
    mask_master = _master(maskable=True)

    jobs = [
        ("icon-192.png", any_master, 192),
        ("icon-512.png", any_master, 512),
        ("maskable-192.png", mask_master, 192),
        ("maskable-512.png", mask_master, 512),
        ("apple-touch-icon.png", any_master, 180),
    ]
    for name, master, size in jobs:
        path = os.path.join(OUT_DIR, name)
        _scaled(master, size).save(path, "PNG", optimize=True)
        with Image.open(path) as chk:
            w, h = chk.size
        print(f"wrote {name}: {w}x{h} {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
