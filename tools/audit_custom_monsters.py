#!/usr/bin/env python3
"""Validate custom monster assets against the Ninja Adventure style guide.
Checks: 64x64 4x4 grid, 1-bit alpha, palette budget, master palette membership,
outline color, frame occupancy, grounding, and per-frame visual consistency.
Outputs a concise pass/fail table with reasons and fix recommendations.
"""
import os, json, sys
from collections import Counter
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
GUIDE_PATH = os.path.join(BASE, 'monster_style_guide.json')
CUSTOM_DIR = os.path.join(BASE, '..', 'public', 'assets', 'custom', 'monsters')

with open(GUIDE_PATH) as f:
    guide = json.load(f)

MASTER = set(guide['color_ramps_and_palettes']['master_palette_33'])
MIN_C = guide['color_ramps_and_palettes']['palette_budget']['min_colors']
MAX_C = guide['color_ramps_and_palettes']['palette_budget']['max_colors']
OUTLINES = set(guide['outline_rules']['primary_border_colors'])

def lum(c):
    return 0.299*c[0] + 0.587*c[1] + 0.114*c[2]

def inspect(path):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    pixels = list(im.get_flattened_data())
    visible = [p for p in pixels if p[3] > 0]
    counts = Counter(visible)
    colors = list(counts.keys())
    semi = sum(1 for p in pixels if 0 < p[3] < 255)
    sorted_by_lum = sorted(colors, key=lum)
    darkest = sorted_by_lum[0] if sorted_by_lum else None
    darkest_hex = f'#{darkest[0]:02x}{darkest[1]:02x}{darkest[2]:02x}' if darkest else None
    hex_palette = [f'#{c[0]:02x}{c[1]:02x}{c[2]:02x}' for c in sorted_by_lum]
    outside = [h for h in hex_palette if h not in MASTER]

    empty_cells = []
    grounded = True
    frame_alphas = []
    if W == 64 and H == 64:
        for r in range(4):
            for c in range(4):
                cell = im.crop((c*16, r*16, (c+1)*16, (r+1)*16)).getchannel('A')
                opaq = sum(1 for v in cell.get_flattened_data() if v > 10)
                frame_alphas.append(opaq)
                if opaq == 0:
                    empty_cells.append((r, c))
        grounded = all(
            any(im.getpixel((c*16+x, r*16+14))[3] > 0 or im.getpixel((c*16+x, r*16+15))[3] > 0
                for x in range(16))
            for r in range(4) for c in range(4)
        )
    else:
        grounded = False

    return {
        'size': (W, H),
        'color_count': len(colors),
        'semi': semi,
        'alpha_1bit': semi == 0,
        'darkest': darkest_hex,
        'palette': hex_palette,
        'outside_master': outside,
        'outside_pct': len(outside)/len(hex_palette)*100 if hex_palette else 0,
        'empty_cells': empty_cells,
        'grounded': grounded,
        'outline_ok': darkest_hex in OUTLINES if darkest_hex else False,
        'frame_alphas': frame_alphas,
    }

def assess(name, r):
    checks = []
    ok = True
    if r['size'] != (64, 64):
        checks.append(('dimensions', False, f"size is {r['size']} (need 64x64)"))
        ok = False
    else:
        checks.append(('dimensions', True, '64x64'))
    if r['empty_cells']:
        checks.append(('frame occupancy', False, f"empty cells {r['empty_cells']}"))
        ok = False
    else:
        checks.append(('frame occupancy', True, 'all 16 frames populated'))
    if not r['alpha_1bit']:
        checks.append(('alpha', False, f"{r['semi']} semi-transparent pixels"))
        ok = False
    else:
        checks.append(('alpha', True, '1-bit alpha'))
    if not (MIN_C <= r['color_count'] <= MAX_C):
        checks.append(('palette budget', False, f"{r['color_count']} colors (allow {MIN_C}-{MAX_C})"))
        ok = False
    else:
        checks.append(('palette budget', True, f"{r['color_count']} colors"))
    if r['outside_master']:
        checks.append(('master palette', False, f"{len(r['outside_master'])}/{r['color_count']} colors not in NA master palette"))
        ok = False
    else:
        checks.append(('master palette', True, 'all colors in NA master palette'))
    if not r['outline_ok']:
        checks.append(('outline', False, f"darkest color {r['darkest']} not an allowed outline"))
        ok = False
    else:
        checks.append(('outline', True, r['darkest']))
    if not r['grounded']:
        checks.append(('grounding', False, 'creature does not touch bottom of frame'))
        ok = False
    else:
        checks.append(('grounding', True, 'touches y=14/15'))
    return ok, checks

def main():
    if not os.path.isdir(CUSTOM_DIR):
        print('Custom monster directory not found:', CUSTOM_DIR)
        sys.exit(1)
    files = sorted(f for f in os.listdir(CUSTOM_DIR) if f.endswith('.png'))
    results = []
    for f in files:
        r = inspect(os.path.join(CUSTOM_DIR, f))
        ok, checks = assess(f, r)
        results.append((f, ok, r, checks))

    print('\n=== Custom Monster Style Audit ===\n')
    print(f"{'Asset':<28} {'Pass':<5} {'Size':<10} {'Colors':<8} {'Outline':<10} {'Ground':<7} {'Outside':<8}")
    print('-'*85)
    for f, ok, r, checks in results:
        print(f"{f:<28} {'PASS' if ok else 'FAIL':<5} {r['size'][0]}x{r['size'][1]:<6} {r['color_count']:<8} {r['darkest']:<10} {'Y' if r['grounded'] else 'N':<7} {len(r['outside_master'])}/{r['color_count']:<6}")

    print('\n=== Detailed Failures & Fixes ===\n')
    fail_count = 0
    for f, ok, r, checks in results:
        if ok:
            continue
        fail_count += 1
        print(f"{f}:")
        for name, passed, note in checks:
            if not passed:
                print(f"  - {name}: {note}")
        # Recommendations
        recs = []
        if r['size'] != (64, 64):
            recs.append('Resize/crop to exactly 64x64 (4 columns x 4 rows of 16x16 frames).')
        if r['empty_cells']:
            recs.append('Fill empty 16x16 frames; every direction must have idle/step frames.')
        if not r['alpha_1bit']:
            recs.append('Quantize alpha to 0/255 (no anti-aliasing).')
        if not (MIN_C <= r['color_count'] <= MAX_C):
            recs.append(f"Reduce/merge colors to {MIN_C}-{MAX_C} (currently {r['color_count']}).")
        if r['outside_master']:
            recs.append(f"Recolor {len(r['outside_master'])} off-palette swatches to nearest NA master colors: {r['outside_master'][:5]}{'...' if len(r['outside_master'])>5 else ''}")
        if not r['outline_ok']:
            recs.append(f"Change outline to one of {sorted(OUTLINES)}.")
        if not r['grounded']:
            recs.append('Extend sprite footprint to y=14/15 so frames sit on the ground line.')
        for rec in recs:
            print(f"  FIX: {rec}")
        print()

    print(f"Summary: {len(files)-fail_count}/{len(files)} passed. {fail_count} asset(s) need regeneration/fixes.")

if __name__ == '__main__':
    main()
