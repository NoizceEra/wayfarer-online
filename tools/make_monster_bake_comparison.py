#!/usr/bin/env python3
"""Build an 8x-zoom comparison PNG: old bake | new bake | hand-drawn, per creature.

Usage:
  python3 tools/make_monster_bake_comparison.py <out.png>
Sheets are 64x64; each is nearest-upscaled 8x (512x512) and laid out in a grid with
per-column and per-row labels so a human can judge the style gap in one image.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = os.path.join(ROOT, '.scratch-blender', 'hd', 'old')
NEW = os.path.join(ROOT, '.scratch-blender', 'hd', 'final')
DRAWN = os.path.join(ROOT, 'public', 'assets', 'custom', 'monsters')

ZOOM = 8
CELL = 64 * ZOOM           # 512
PAD = 16
LABEL_H = 34
HEADER_H = 44

# (row label, old bake, new bake, hand-drawn reference)
ROWS = [
    ('Crystal Gem Golem', 'cavern_gemgolem.png', 'cavern_gemgolem.png', 'frost_icegolem.png'),
    ('Magma Emberling',   'cavern_emberling.png', 'cavern_emberling.png', 'cavern_magmacrab.png'),
]
COLS = ['OLD bake (before)', 'NEW bake (HD pipeline)', 'HAND-DRAWN reference']


def load(path):
    return Image.open(path).convert('RGBA').resize((CELL, CELL), Image.NEAREST)


def font(size):
    for name in ('arial.ttf', 'segoeui.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def checker(size, sq=CELL // 16):
    """Light checkerboard so transparent sprite pixels are visible."""
    bg = Image.new('RGB', size, (232, 232, 236))
    d = ImageDraw.Draw(bg)
    for y in range(0, size[1], sq):
        for x in range(0, size[0], sq):
            if ((x // sq) + (y // sq)) % 2:
                d.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(206, 206, 212))
    return bg


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'monster_bake_comparison_hd.png')
    W = PAD + len(COLS) * (CELL + PAD)
    H = HEADER_H + LABEL_H + len(ROWS) * (CELL + LABEL_H + PAD) + PAD
    canvas = Image.new('RGB', (W, H), (28, 30, 36))
    d = ImageDraw.Draw(canvas)
    f_title = font(26)
    f_lab = font(20)
    f_row = font(22)

    d.text((PAD, 10), 'Blender bake vs hand-drawn - 8x zoom (64x64 sheets, 4x4 of 16x16 frames)',
           fill=(240, 240, 245), font=f_title)

    for ci, col in enumerate(COLS):
        x = PAD + ci * (CELL + PAD)
        d.text((x + 4, HEADER_H), col, fill=(255, 214, 140), font=f_lab)

    for ri, (rowlab, oldf, newf, drawnf) in enumerate(ROWS):
        y0 = HEADER_H + LABEL_H + ri * (CELL + LABEL_H + PAD)
        d.text((PAD, y0), rowlab, fill=(180, 230, 180), font=f_row)
        y = y0 + LABEL_H
        sources = [os.path.join(OLD, oldf), os.path.join(NEW, newf), os.path.join(DRAWN, drawnf)]
        for ci, src in enumerate(sources):
            x = PAD + ci * (CELL + PAD)
            bg = checker((CELL, CELL))
            spr = load(src)
            bg.paste(spr, (0, 0), spr)
            canvas.paste(bg, (x, y))
            d.rectangle([x - 1, y - 1, x + CELL, y + CELL], outline=(90, 90, 100))

    canvas.save(out)
    print('COMPARISON=' + out + ' size=' + str(canvas.size))


if __name__ == '__main__':
    main()
