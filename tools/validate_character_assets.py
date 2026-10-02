#!/usr/bin/env python3
"""Headless character-asset style gate for Wayfarer Online.

Enforces docs/CHARACTER_STYLE.md on our authored exports:
- icons *_16.png are exactly 16x16 RGBA, *_32.png exactly 32x32 and a
  NEAREST 2x of their *_16 sibling (32px is a scale, never new art)
- sheets *_sheet_16.png / *_sheet_32.png are exact multiples (h = 16 / 32)
- wear *_wear_<dir>.png are exactly 28x28 RGBA (wearArt.js WEAR_N)
- hard alpha only (0/255), outline present (icons #1a1024, wear #141b1b),
  <= 40 distinct RGB values per icon (pixel art, not smooth promo)
- third-party anchor public/assets/na/** is skipped (validate_sheets.py owns it)

Usage: python tools/validate_character_assets.py [--dir public/assets/custom/halloween ...]
Exit 1 with offending files listed on any violation.
"""
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_OUT = (26, 16, 36)
WEAR_OUT = (20, 27, 27)
MAX_COLORS = 40

DEFAULT_DIRS = [os.path.join(ROOT, "public", "assets", "custom", d)
              for d in ("halloween", "winter", "everyday", "novice")]


def hard_alpha(im):
    return all(v in (0, 255) for v in im.getchannel("A").getdata())


def colors(im):
    rgbs = {(p[0], p[1], p[2]) for p in im.getdata() if p[3] > 0}
    return rgbs


def fail(msg, bad):
    print("STYLE-GATE FAIL:", msg)
    for b in bad:
        print("  -", b)
    sys.exit(1)


def main():
    dirs = sys.argv[sys.argv.index("--dir") + 1:] if "--dir" in sys.argv else DEFAULT_DIRS
    icons16, icons32, bad_size, bad_alpha, bad_outline, bad_palette, bad_scale = {}, {}, [], [], [], [], []
    unknown = []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for n in sorted(os.listdir(d)):
            p = os.path.join(d, n)
            if not n.endswith(".png"):
                continue
            known = (n.endswith("_gear_sheet_16.png") or n.endswith("_gear_sheet_32.png")
                     or "_wear_" in n
                     or n.endswith("_16.png") or n.endswith("_32.png"))
            if not known:
                unknown.append(p + " (not a gated pattern: *_16.png/*_32.png/*_gear_sheet_*/*_wear_*)")
                continue
            if n.endswith("_gear_sheet_16.png") or n.endswith("_gear_sheet_32.png"):
                im = Image.open(p).convert("RGBA")
                step = 16 if n.endswith("_16.png") else 32
                if im.height != step or im.width % step:
                    bad_size.append(p)
                if not hard_alpha(im):
                    bad_alpha.append(p)
                continue
            if "_wear_" in n:
                im = Image.open(p).convert("RGBA")
                if im.size != (28, 28):
                    bad_size.append(p)
                elif not hard_alpha(im):
                    bad_alpha.append(p)
                elif WEAR_OUT not in colors(im):
                    bad_outline.append(p + " (missing wear outline #141b1b)")
                continue
            if n.endswith("_16.png"):
                im = Image.open(p).convert("RGBA")
                if im.size != (16, 16):
                    bad_size.append(p)
                    continue
                icons16[n[:-7]] = (p, im)
                if not hard_alpha(im):
                    bad_alpha.append(p)
                elif ICON_OUT not in colors(im):
                    bad_outline.append(p + " (missing icon outline #1a1024)")
                elif len(colors(im)) > MAX_COLORS:
                    bad_palette.append(p + f" ({len(colors(im))} colors)")
            elif n.endswith("_32.png"):
                im = Image.open(p).convert("RGBA")
                if im.size != (32, 32):
                    bad_size.append(p)
                    continue
                icons32[n[:-7]] = (p, im)
                if not hard_alpha(im):
                    bad_alpha.append(p)
    for stem, (p32, im32) in icons32.items():
        if stem not in icons16:
            bad_scale.append(f"{p32} (no {stem}_16.png sibling)")
            continue
        _, im16 = icons16[stem]
        if list(im32.resize((16, 16), Image.NEAREST).getdata()) != list(im16.getdata()):
            bad_scale.append(f"{p32} (not a NEAREST 2x of {stem}_16.png)")
    if bad_size:
        fail("bad canvas size (icons 16/32, wear 28, sheets multiple)", bad_size)
    if bad_alpha:
        fail("feathered alpha (must be 0/255 only — no smooth/promo art)", bad_alpha)
    if bad_outline:
        fail("missing style outline", bad_outline)
    if bad_palette:
        fail(f"too many colors (>${MAX_COLORS} — not 4-tone pixel art)", bad_palette)
    if bad_scale:
        fail("32px is not an exact 2x of its 16px (new art at 32px is forbidden)", bad_scale)
    if unknown:
        fail("ungated PNG in a character-art dir (rename to a gated pattern or move promo art out)", unknown)
    n = len(icons16)
    print(f"style-gate OK: {n} icons in Ninja Adventure 16x16 contract")


if __name__ == "__main__":
    main()
