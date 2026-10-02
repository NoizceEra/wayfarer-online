#!/usr/bin/env python3
"""Canonical headless exporter for Wayfarer Online gear icons.

AGENTS: this file IS the Ninja Adventure 16x16 Game Boy style reference.
Before generating ANY character/gear asset, read it plus:
  docs/CHARACTER_STYLE.md          (pixel rules, layering, forbidden styles)
  src/systems/iconArt.js           (runtime painters — ports here must stay verbatim)
  src/systems/heroArt.js  (ramp)   (4-tone ramp — do not re-tune)
  src/data/gear.js                 (catalog: style + main/trim per item)

Contract (enforced by tools/validate_character_assets.py, exit 1 on drift):
- 16x16 RGBA icons, 1px orthogonal outline #1a1024 (26,16,36).
- 32px files are NEAREST x2 scales of a 16x16 — never new art at 32px.
- Colours: 4-tone ramp() of the item main/trim + the fixed constants below.
- Hard alpha only (0/255). No gradients, no glow, no 300x300 promo style
  (see public/assets/custom/seasonal/generate_assets.py — that is MARKETING
  art and must never enter the character pipeline).

Adding a new wave (e.g. a new seasonal set):
  1. Add the gear rows to src/data/gear.js reusing an EXISTING style name
     (new painters are a last resort; if unavoidable, port the ICON painter
     from src/systems/iconArt.js verbatim — incl. JS Math.round half-up
     semantics, jround() below — and add the wearArt.js STYLE_DEF entry).
  2. Add a WAVES entry here: (gear_id, style, main_hex, trim_hex) per item,
     values copied from the gear.js rows.
  3. Run: python tools/export_gear_icons.py --waves <name>
     then: python tools/validate_character_assets.py  (must print OK)

Usage: python tools/export_gear_icons.py [--waves halloween,winter,everyday]
Needs Pillow (pip install pillow).
"""
import json
import math
import os
import sys

from PIL import Image

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "public", "assets", "custom")

# --- style constants (verbatim from src/systems/iconArt.js:7-9) ---
OUT = (0x1A, 0x10, 0x24, 255)
WHITE = (255, 255, 255)
GOLD = (232, 178, 42); WOOD = (138, 90, 43); WOODLO = (90, 58, 26)
STEEL = (201, 211, 220); STEELLO = (125, 138, 154)
SKIN = (240, 200, 160); CREAM = (236, 220, 190)


# --- ramp (verbatim port of src/systems/heroArt.js ramp()) ---
def hex3(n):
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)


def mix(c, t, a):
    return tuple(int(round(v + (tt - v) * a)) for v, tt in zip(c, t))


def ramp(tint):
    c = hex3(tint)
    return {"hi": mix(c, (255, 255, 255), 0.28), "mid": c,
            "lo": mix(c, (0, 0, 0), 0.3), "lo2": mix(c, (0, 0, 0), 0.5)}


def C3(c):
    if c is None:
        return None
    if isinstance(c, tuple) and len(c) == 3:
        return c
    return tuple(c[:3])


def jround(x):
    # JS Math.round (half up); Python round() is banker's — do NOT use round().
    return math.floor(float(x) + 0.5)


# --- G canvas (verbatim port of the G class in src/systems/iconArt.js:11-38) ---
class G:
    def __init__(self):
        self.p = [None] * 256

    def px(self, x, y, c):
        x, y = jround(x), jround(y)
        if c is not None and 0 <= x < 16 and 0 <= y < 16:
            self.p[y * 16 + x] = C3(c)
        return self

    def r(self, x, y, w, h, c):
        for j in range(h):
            for i in range(w):
                self.px(x + i, y + j, c)
        return self

    def rows(self, spans, c):
        for (y, x0, x1) in spans:
            for x in range(x0, x1 + 1):
                self.px(x, y, c)
        return self

    def line(self, x0, y0, x1, y1, c):
        n = max(abs(x1 - x0), abs(y1 - y0)) or 1
        for i in range(n + 1):
            self.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c)
        return self

    def disc(self, cx, cy, r, c):
        for y in range(-r, r + 1):
            for x in range(-r, r + 1):
                if x * x + y * y <= r * r + r * 0.6:
                    self.px(cx + x, cy + y, c)
        return self

    def get(self, x, y):
        if x < 0 or y < 0 or x > 15 or y > 15:
            return None
        return self.p[y * 16 + x]

    def outline(self):
        add = []
        for y in range(16):
            for x in range(16):
                if self.get(x, y):
                    continue
                if self.get(x - 1, y) or self.get(x + 1, y) or self.get(x, y - 1) or self.get(x, y + 1):
                    add.append(y * 16 + x)
        for i in add:
            self.p[i] = OUT[:3]
        return self

    def image(self):
        im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        px = im.load()
        for i, c in enumerate(self.p):
            if c:
                px[i % 16, i // 16] = (c[0], c[1], c[2], 255)
        return im


# ---------------------------------------------------------------- painters
# Verbatim ports of ICON.* in src/systems/iconArt.js. Each name matches the
# `style` field in src/data/gear.js. Do not restyle; do not add shading passes.
def p_tunic(g, a, b):
    g.r(4, 2, 8, 11, a["mid"]); g.r(0, 3, 4, 4, a["mid"]); g.r(12, 3, 4, 4, a["mid"])
    g.r(4, 2, 2, 11, a["hi"]); g.r(10, 4, 2, 9, a["lo"]); g.r(0, 6, 4, 1, a["lo"]); g.r(12, 6, 4, 1, a["lo"])
    g.r(6, 2, 4, 1, a["lo2"]); g.r(4, 9, 8, 2, b["mid"]); g.r(7, 9, 2, 2, GOLD)


def p_smock(g, a, b):
    p_tunic(g, a, a)
    g.r(5, 7, 6, 6, b["mid"]); g.r(5, 7, 6, 1, b["hi"]); g.r(9, 8, 2, 5, b["lo"]); g.px(6, 10, b["lo"])
    g.r(5, 2, 1, 5, b["mid"]); g.r(10, 2, 1, 5, b["mid"])


def p_robe(g, a, b, band=False):
    g.rows([[1, 6, 9], [2, 5, 10], [3, 4, 11], [4, 4, 11], [5, 4, 11], [6, 4, 11], [7, 4, 11],
            [8, 3, 12], [9, 3, 12], [10, 2, 13], [11, 2, 13], [12, 1, 14], [13, 1, 14]], a["mid"])
    g.r(0, 3, 4, 6, a["mid"]); g.r(12, 3, 4, 6, a["mid"]); g.r(0, 8, 4, 1, b["mid"]); g.r(12, 8, 4, 1, b["mid"])
    g.r(4, 3, 2, 10, a["hi"]); g.r(10, 5, 2, 8, a["lo"]); g.r(1, 13, 14, 1, b["mid"]); g.r(6, 1, 4, 1, b["mid"])
    g.r(7, 6, 2, 7, a["lo"])
    if band:
        g.r(7, 2, 2, 11, b["mid"]); g.r(7, 2, 1, 11, b["hi"])


def p_robe_trim(g, a, b):
    p_robe(g, a, b, True)


def p_horns(g, a, b):
    g.rows([[5, 5, 10], [6, 4, 11], [7, 3, 12], [8, 3, 12], [9, 3, 12]], a["mid"])
    g.r(3, 6, 2, 3, a["hi"]); g.r(11, 7, 2, 2, a["lo"])
    g.line(3, 6, 1, 3, b["mid"]); g.line(1, 3, 2, 1, b["hi"]); g.line(12, 6, 14, 3, b["mid"]); g.line(14, 3, 13, 1, b["lo"])
    g.r(4, 9, 8, 1, a["lo"])


def p_cone(g, a, b, stars=False):
    g.rows([[0, 9, 10], [1, 8, 10], [2, 7, 10], [3, 6, 10], [4, 6, 10], [5, 5, 10], [6, 5, 11], [7, 4, 11]], a["mid"])
    g.r(5, 5, 2, 3, a["hi"]); g.r(1, 9, 14, 2, a["hi"]); g.r(2, 11, 12, 1, a["lo"])
    g.r(5, 8, 7, 1, a["mid"] if stars else b["mid"])
    if stars:
        g.px(8, 3, b["mid"]); g.px(9, 6, b["mid"]); g.px(6, 5, b["mid"]); g.px(12, 10, b["mid"]); g.px(4, 10, b["mid"])


def p_cone_stars(g, a, b):
    p_cone(g, a, b, True)


def p_veil(g, a, b):
    g.rows([[2, 6, 9], [3, 5, 10], [4, 4, 11], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 3, 12], [10, 3, 12]], a["mid"])
    g.r(5, 3, 2, 1, a["hi"]); g.r(3, 5, 2, 5, a["hi"]); g.r(11, 4, 2, 7, a["lo"])
    g.r(5, 6, 2, 2, (0x1A, 0x10, 0x24)); g.r(9, 6, 2, 2, (0x1A, 0x10, 0x24))
    g.r(6, 9, 4, 1, a["lo"])
    g.px(4, 11, a["mid"]); g.px(7, 11, a["mid"]); g.px(10, 11, a["mid"]); g.px(7, 12, a["lo"])


def p_mask(g, a, b):
    g.rows([[4, 1, 14], [5, 1, 14], [6, 1, 14], [7, 2, 13], [8, 3, 12]], a["mid"])
    g.r(1, 4, 14, 1, a["hi"]); g.r(3, 6, 3, 2, (0x1A, 0x10, 0x24)); g.r(10, 6, 3, 2, (0x1A, 0x10, 0x24))
    g.r(2, 8, 12, 1, a["lo"]); g.px(1, 6, a["lo"]); g.px(14, 6, a["lo"])


def p_wings_bat(g, a, b):
    g.rows([[2, 0, 2], [3, 0, 4], [4, 0, 6], [5, 1, 7], [6, 2, 7], [7, 2, 7], [8, 2, 7],
            [2, 13, 15], [3, 11, 15], [4, 9, 15], [5, 8, 14], [6, 8, 13], [7, 8, 13], [8, 8, 13]], a["mid"])
    g.line(1, 2, 6, 8, b["mid"]); g.line(14, 2, 9, 8, b["mid"])
    g.r(7, 5, 2, 6, a["lo"])
    for x in [2, 4, 6, 9, 11, 13]:
        g.px(x, 9, a["lo"])
    g.px(0, 2, b["hi"]); g.px(15, 2, b["hi"])


def p_greatsword(g, a, b):
    g.line(4, 11, 13, 2, a["mid"]); g.line(5, 11, 13, 3, a["lo"]); g.line(3, 10, 12, 2, a["hi"])
    g.line(4, 10, 12, 3, a["mid"]); g.line(3, 13, 6, 10, WOOD); g.line(5, 8, 9, 12, b["mid"])
    g.line(6, 8, 10, 12, b["lo"]); g.px(2, 14, GOLD)


def p_dagger(g, a, b):
    r = ramp(0xC9D3DC) if tuple(a["mid"]) == (255, 255, 255) else a
    g.line(5, 10, 11, 4, r["mid"]); g.line(6, 10, 11, 5, r["lo"]); g.line(5, 9, 10, 4, r["hi"])
    g.line(3, 12, 6, 9, WOOD)
    g.line(6, 8, 8, 10, GOLD if tuple(b["mid"]) == (255, 255, 255) else b["mid"])
    g.px(2, 13, GOLD); g.px(11, 3, WHITE)


def p_staff(g, a, b):
    main_hex = (a["mid"][0] << 16) | (a["mid"][1] << 8) | a["mid"][2]
    r = ramp(main_hex)
    g.line(4, 15, 10, 4, WOOD); g.line(5, 15, 11, 4, WOODLO)
    g.disc(11, 3, 2, (120, 210, 255)); g.disc(11, 3, 1, WHITE)
    g.px(9, 5, r["mid"]); g.px(13, 5, r["mid"]); g.px(10, 1, r["hi"])


def p_gem(g, a, b):
    g.rows([[2, 5, 10], [3, 3, 12], [4, 2, 13], [5, 2, 13], [6, 3, 12], [7, 4, 11], [8, 5, 10], [9, 6, 9], [10, 7, 8]], a["mid"])
    g.r(3, 3, 3, 3, a["hi"]); g.r(9, 5, 4, 3, a["lo"]); g.r(6, 2, 4, 1, b["mid"])
    g.px(5, 4, WHITE); g.px(4, 3, b["hi"]); g.line(7, 0, 7, 1, GOLD); g.line(8, 0, 8, 1, GOLD)


def p_locket(g, a, b):
    g.line(4, 0, 7, 4, (200, 190, 160)); g.line(11, 0, 8, 4, (200, 190, 160))
    g.disc(8, 9, 4, a["mid"]); g.disc(8, 9, 3, a["hi"]); g.disc(8, 9, 2, b["mid"])
    g.px(7, 8, WHITE); g.r(10, 10, 2, 3, a["lo"]); g.px(8, 4, a["lo"]); g.px(8, 5, a["mid"])


def p_cap(g, a, b):
    g.rows([[4, 4, 11], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12]], a["mid"])
    g.r(4, 4, 3, 1, a["hi"]); g.r(3, 5, 2, 3, a["hi"]); g.r(10, 6, 3, 3, a["lo"])
    g.r(2, 9, 9, 2, a["lo"]); g.r(7, 5, 1, 3, a["lo2"])


def p_hood(g, a, b):
    g.rows([[2, 6, 9], [3, 5, 10], [4, 4, 11], [5, 3, 12], [6, 3, 12], [7, 3, 12],
            [8, 3, 12], [9, 3, 12], [10, 4, 11], [11, 4, 11]], a["mid"])
    g.r(5, 3, 2, 1, a["hi"]); g.r(4, 4, 2, 1, a["hi"]); g.r(3, 5, 2, 5, a["hi"])
    g.r(11, 5, 2, 6, a["lo"]); g.r(6, 6, 4, 4, OUT[:3]); g.r(6, 6, 4, 1, a["lo2"])
    g.px(7, 9, SKIN); g.px(8, 9, SKIN); g.px(7, 7, SKIN); g.px(8, 7, SKIN)
    g.px(7, 8, SKIN); g.px(8, 8, SKIN)


def p_band(g, a, b):
    g.r(2, 6, 12, 3, a["mid"]); g.r(2, 6, 12, 1, a["hi"]); g.r(2, 8, 12, 1, a["lo"])
    for x in range(4, 13, 3):
        g.px(x, 7, b["mid"])
    g.r(12, 9, 3, 2, a["mid"]); g.px(14, 11, a["lo"]); g.px(13, 12, a["lo"]); g.r(11, 9, 2, 1, a["hi"])


def p_vest(g, a, b):
    g.r(4, 2, 8, 11, CREAM); g.r(0, 3, 4, 4, CREAM); g.r(12, 3, 4, 4, CREAM)
    g.r(4, 2, 3, 11, a["mid"]); g.r(9, 2, 3, 11, a["mid"]); g.r(4, 2, 1, 11, a["hi"]); g.r(11, 4, 1, 9, a["lo"])
    for y in range(3, 12, 2):
        g.px(7, y, b["mid"]); g.px(8, y + 1, b["mid"])


def p_cape(g, a, b, o=None):
    g.rows([[1, 4, 11], [2, 4, 11], [3, 3, 12], [4, 3, 12], [5, 2, 13], [6, 2, 13], [7, 2, 13],
            [8, 1, 14], [9, 1, 14], [10, 1, 14], [11, 0, 15], [12, 0, 15], [13, 0, 15]], a["mid"])
    g.r(3, 3, 3, 10, a["hi"]); g.r(11, 6, 4, 8, a["lo"]); g.r(5, 1, 6, 1, b["mid"])
    g.px(7, 1, GOLD); g.px(8, 1, GOLD); g.r(7, 4, 2, 9, a["lo"])
    if o:
        g.r(0, 13, 16, 1, b["mid"])
        if o == "royal":
            for x in range(0, 16, 2):
                g.px(x, 13, WHITE)


def p_cape_trim(g, a, b):
    p_cape(g, a, b, "trim")


def p_pack(g, a, b):
    g.r(3, 3, 10, 11, a["mid"]); g.r(3, 3, 10, 2, a["hi"]); g.r(11, 5, 2, 9, a["lo"])
    g.r(3, 7, 10, 2, b["mid"]); g.r(6, 7, 4, 3, b["hi"]); g.px(7, 8, GOLD); g.px(8, 8, GOLD)
    g.r(5, 1, 6, 2, WOOD); g.px(6, 1, WOODLO); g.r(1, 6, 2, 5, a["lo"]); g.r(13, 6, 2, 5, a["lo"])


def p_sword(g, a, b):
    c = STEEL if tuple(a["mid"]) == (255, 255, 255) else a["mid"]
    r = ramp((c[0] << 16) | (c[1] << 8) | c[2])
    g.line(3, 12, 12, 3, r["mid"]); g.line(4, 12, 12, 4, r["lo"]); g.line(3, 11, 11, 3, r["hi"])
    g.line(2, 13, 5, 10, WOOD)
    g.line(5, 8, 8, 11, GOLD if tuple(b["mid"]) == (255, 255, 255) else b["mid"])
    g.px(1, 14, GOLD); g.px(12, 2, WHITE)


def p_bow(g, a, b):
    w = (196, 140, 70)
    g.line(11, 1, 14, 8, w); g.line(14, 8, 11, 14, w)
    g.line(10, 1, 13, 8, (150, 100, 50)); g.line(13, 8, 10, 14, (150, 100, 50))
    g.line(11, 1, 11, 14, (230, 230, 230)); g.line(2, 7, 12, 8, STEEL)
    g.px(2, 7, WHITE); g.px(3, 6, (200, 60, 60)); g.px(3, 8, (200, 60, 60))
    if tuple(a["mid"]) != (255, 255, 255):
        g.px(12, 3, a["hi"]); g.px(13, 12, a["hi"]); g.px(14, 8, a["mid"])


def p_boots(g, a, b):
    for x0 in (2, 9):
        g.r(x0, 3, 5, 7, a["mid"]); g.r(x0, 3, 5, 2, b["mid"]); g.r(x0, 10, 7, 3, a["mid"])
        g.r(x0, 3, 2, 10, a["hi"]); g.r(x0, 12, 7, 1, a["lo2"]); g.r(x0 + 4, 6, 1, 6, a["lo"])


def p_orb(g, a, b):
    g.disc(8, 8, 5, a["mid"]); g.disc(7, 7, 3, a["hi"]); g.r(10, 10, 3, 3, a["lo"])
    g.px(6, 6, WHITE); g.px(7, 6, WHITE)
    g.px(2, 3, b["mid"]); g.px(14, 12, b["mid"]); g.px(13, 2, b["mid"]); g.px(3, 13, b["mid"])


def p_feather(g, a, b):
    g.line(3, 13, 12, 2, a["mid"]); g.line(4, 13, 13, 3, a["lo"]); g.line(3, 12, 11, 2, a["hi"])
    g.line(5, 11, 9, 11, a["mid"]); g.line(6, 9, 10, 9, a["hi"]); g.line(7, 7, 11, 7, a["mid"])
    g.line(8, 5, 12, 5, a["hi"]); g.px(2, 14, b["mid"])


def p_glasses(g, a, b):
    for x0 in (1, 9):
        g.r(x0, 5, 6, 1, a["mid"]); g.r(x0, 9, 6, 1, a["mid"]); g.r(x0, 5, 1, 5, a["mid"]); g.r(x0 + 5, 5, 1, 5, a["mid"])
        g.r(x0 + 1, 6, 4, 3, (190, 230, 255)); g.px(x0 + 1, 6, WHITE)
    g.r(7, 6, 2, 1, a["mid"])


def p_wand(g, a, b):
    g.line(3, 13, 10, 6, WOOD); g.line(4, 13, 11, 6, WOODLO)
    g.disc(11, 4, 2, a["mid"]); g.disc(11, 4, 1, a["hi"])
    g.px(10, 3, WHITE); g.px(14, 1, a["hi"]); g.px(14, 7, a["hi"]); g.px(8, 1, a["hi"])


def p_round(g, a, b):
    g.disc(8, 8, 6, a["mid"]); g.disc(8, 8, 5, a["mid"])
    g.rows([[3, 6, 9], [4, 4, 5], [5, 3, 4], [6, 3, 3]], a["hi"])
    g.r(11, 8, 3, 4, a["lo"]); g.disc(8, 8, 2, b["mid"]); g.px(7, 7, b["hi"])
    for (x, y) in ((8, 3), (8, 13), (3, 8), (13, 8)):
        g.px(x, y, b["mid"])


def p_leaf(g, a, b):
    g.rows([[2, 8, 9], [3, 7, 11], [4, 6, 12], [5, 5, 12], [6, 5, 11], [7, 5, 10], [8, 5, 9], [9, 6, 8]], a["mid"])
    g.line(4, 12, 11, 4, b["mid"])
    g.px(8, 3, a["hi"]); g.px(7, 4, a["hi"]); g.px(6, 5, a["hi"])
    g.line(3, 13, 6, 9, b["lo"])


PAINTERS = {
    "horns": p_horns, "cone_stars": p_cone_stars, "veil": p_veil, "mask": p_mask,
    "robe_trim": p_robe_trim, "robe": p_robe, "smock": p_smock, "tunic": p_tunic,
    "vest": p_vest, "wings_bat": p_wings_bat, "staff": p_staff, "greatsword": p_greatsword,
    "dagger": p_dagger, "sword": p_sword, "bow": p_bow, "gem": p_gem, "locket": p_locket,
    "cap": p_cap, "hood": p_hood, "band": p_band, "cape_trim": p_cape_trim,
    "cape": p_cape,
    "pack": p_pack, "boots": p_boots, "orb": p_orb, "feather": p_feather,
    "glasses": p_glasses, "wand": p_wand, "round": p_round, "leaf": p_leaf,
}


# ---------------------------------------------------------------- waves
# (gear_id, style, main, trim) — values MUST match the rows in src/data/gear.js.
WAVES = {
    "halloween": [  # src/data/gear.js: HALLOWEEN FESTIVE COLLECTION
        ("jacko_helm", "horns", 0xE67E22, 0x27AE60),
        ("witch_hat", "cone_stars", 0x5B2D9E, 0xFFE066),
        ("vampire_cowl", "veil", 0xC0392B, 0x1A1A22),
        ("ghost_mask", "mask", 0xECF0F1, 0x34495E),
        ("vampire_coat", "robe_trim", 0x78281F, 0xF4C542),
        ("pumpkin_suit", "smock", 0xD35400, 0x27AE60),
        ("halloween_bat_wings", "wings_bat", 0x2C3E50, 0xC0392B),
        ("witch_broom", "staff", 0x7E5109, 0xF1C40F),
        ("reaper_scythe", "greatsword", 0x27AE60, 0x1A1A22),
        ("phantom_dagger", "dagger", 0x5DADE2, 0xFFFFFF),
        ("candy_pouch", "gem", 0xF39C12, 0xE74C3C),
        ("bat_charm", "locket", 0x34495E, 0x8E44AD),
    ],
    "winter": [  # src/data/gear.js: WINTER COLLECTION
        ("frost_hood", "hood", 0x7FB8D6, 0xF1F3F5),
        ("knit_cap", "cap", 0xA93226, 0xF1F3F5),
        ("winter_coat", "robe", 0x1F5F5B, 0xF1F3F5),
        ("frost_cloak", "cape_trim", 0x2E86C1, 0xAED6F1),
        ("icicle_dagger", "dagger", 0xAED6F1, 0xFFFFFF),
        ("snow_orb", "orb", 0xAED6F1, 0xFFFFFF),
        ("fur_boots", "boots", 0x7A4A22, 0xF1F3F5),
        ("snowflake_charm", "feather", 0xD6EAF8, 0x7FB8D6),
    ],
    "everyday": [  # src/data/gear.js: EVERYDAY COLLECTION
        ("oiled_bandana", "band", 0x5D6D7E, 0xD9C08A),
        ("patchwork_tunic", "tunic", 0x6E7B5A, 0x4E2E10),
        ("canvas_vest", "vest", 0x9C8A6A, 0x5A3A1E),
        ("trail_pack", "pack", 0x6E5636, 0x3E2E14),
        ("training_sword", "sword", 0xFFFFFF, 0xFFFFFF),
        ("apprentice_bow", "bow", 0xFFFFFF, 0xFFFFFF),
        ("work_boots", "boots", 0x5A3A1E, 0x2E1E0C),
        ("lucky_button", "locket", 0x8D6E3F, 0x5A3A1E),
    ],
    "novice": [  # src/data/gear.js: NOVICE COLLECTION
        ("novice_cap", "cap", 0x5D7A4A, 0x7A4A22),
        ("novice_lenses", "glasses", 0x6B5A3E, 0xD6F3FF),
        ("novice_garb", "tunic", 0x5D7A4A, 0x7A4A22),
        ("novice_cloak", "cape", 0x5D7A4A, 0x3C5230),
        ("novice_blade", "sword", 0xFFFFFF, 0xFFFFFF),
        ("novice_bow", "bow", 0xFFFFFF, 0xFFFFFF),
        ("novice_wand", "wand", 0xFF8D5A, 0xFF8D5A),
        ("novice_fang", "dagger", 0xFFFFFF, 0xFFFFFF),
        ("novice_buckler", "round", 0x7A5A34, 0xB08D3E),
        ("novice_boots", "boots", 0x6B4A2A, 0x3E2E14),
        ("novice_charm", "leaf", 0x6AA84A, 0x3C7A30),
    ],
}


def icon_image(style, main, trim):
    a, b = ramp(main), ramp(trim)
    g = G()
    PAINTERS[style](g, a, b)
    g.outline()
    return g.image()


def export_wave(name, items):
    outdir = os.path.join(BASE, name)
    os.makedirs(outdir, exist_ok=True)
    manifest = {
        "source": "tools/export_gear_icons.py (ports of src/systems/iconArt.js + heroArt.js ramp) + src/data/gear.js",
        "style": "16x16 procedural, OUT #1a1024, 4-tone ramp; 32px = NEAREST x2, no new painters",
        "items": [],
    }
    for gid, style, main, trim in items:
        im16 = icon_image(style, main, trim)
        im16.save(os.path.join(outdir, gid + "_16.png"))
        im16.resize((32, 32), Image.NEAREST).save(os.path.join(outdir, gid + "_32.png"))
        manifest["items"].append({"id": gid, "style": style,
                                  "colors": {"main": hex(main), "trim": hex(trim)},
                                  "files": [gid + "_16.png", gid + "_32.png"]})
        print("wrote", name, gid)
    sheet16 = Image.new("RGBA", (16 * len(items), 16), (0, 0, 0, 0))
    sheet32 = Image.new("RGBA", (32 * len(items), 32), (0, 0, 0, 0))
    for i, (gid, _, _, _) in enumerate(items):
        a = Image.open(os.path.join(outdir, gid + "_16.png"))
        b = Image.open(os.path.join(outdir, gid + "_32.png"))
        sheet16.paste(a, (i * 16, 0), a)
        sheet32.paste(b, (i * 32, 0), b)
    sheet16.save(os.path.join(outdir, name + "_gear_sheet_16.png"))
    sheet32.save(os.path.join(outdir, name + "_gear_sheet_32.png"))
    with open(os.path.join(outdir, name + "_gear.json"), "w") as f:
        json.dump(manifest, f, indent=2)


def main():
    names = WAVES
    if "--waves" in sys.argv:
        want = sys.argv[sys.argv.index("--waves") + 1].split(",")
        unknown = [w for w in want if w not in WAVES]
        if unknown:
            print("unknown waves:", ", ".join(unknown))
            sys.exit(1)
        names = {w: WAVES[w] for w in want}
    for name, items in names.items():
        export_wave(name, items)
    print("OK")


if __name__ == "__main__":
    main()
