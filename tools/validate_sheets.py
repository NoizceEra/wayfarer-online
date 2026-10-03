#!/usr/bin/env python3
"""Validate Ninja Adventure sheets before the loader registers them.
Characters: 64x112 (4 cols x 7 rows; rows 0-3 = walk cycle, row 4 = attack) or 64x32 (4x2).
Monsters: 64x64 (4x4, rows = frames, cols = down/up/left/right).
Prints usable sheets + anything bad. Usage: python3 tools/validate_sheets.py [--json out.json]"""
import json, os, sys
from PIL import Image

NA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'na')


def cells(path, fw, fh):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    grid = []
    for r in range(H // fh):
        row = []
        for c in range(W // fw):
            a = im.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)).getchannel('A')
            row.append(sum(1 for v in a.getdata() if v > 10))
        grid.append(row)
    return (W, H), grid


out = {'char': {}, 'mon': {}, 'bad': []}
cd = os.path.join(NA, 'Actor', 'Character')
for n in sorted(os.listdir(cd)):
    d = os.path.join(cd, n)
    if not os.path.isdir(d):
        continue
    f = next((x for x in ('SpriteSheet.png', 'redsamurai.png') if os.path.exists(os.path.join(d, x))), None)
    if not f:
        out['bad'].append(f'char {n}: no sheet')
        continue
    size, g = cells(os.path.join(d, f), 16, 16)
    if size not in ((64, 112), (64, 32)):
        out['bad'].append(f'char {n}: odd size {size}')
        continue
    empty = [(r, c) for r in range(min(4, len(g))) for c in range(4) if g[r][c] == 0]
    face = next((x for x in ('Faceset.png', 'Faceset1.png') if os.path.exists(os.path.join(d, x))), None)
    if empty:
        out['bad'].append(f'char {n}: empty walk cells {empty}')
    else:
        out['char'][n] = {'file': f, 'face': face, 'rows': len(g)}
md = os.path.join(NA, 'Actor', 'Monster')
for n in sorted(os.listdir(md)):
    d = os.path.join(md, n)
    pngs = [x for x in os.listdir(d) if x.endswith('.png') and not x.startswith('Faceset')]
    if len(pngs) != 1:
        out['bad'].append(f'mon {n}: sheets {pngs}')
        continue
    size, g = cells(os.path.join(d, pngs[0]), 16, 16)
    if size != (64, 64):
        out['bad'].append(f'mon {n}: odd size {size}')
        continue
    empty = [(r, c) for r in range(4) for c in range(4) if g[r][c] == 0]
    if empty:
        out['bad'].append(f'mon {n}: empty cells {empty}')
    else:
        out['mon'][n] = {'file': f'{n}/{pngs[0]}'}

CUSTOM_MON = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'custom', 'monsters')
out['custom_mon'] = {}
if os.path.isdir(CUSTOM_MON):
    for f in sorted(os.listdir(CUSTOM_MON)):
        if not f.endswith('.png'):
            continue
        size, g = cells(os.path.join(CUSTOM_MON, f), 16, 16)
        if size != (64, 64):
            out['bad'].append(f'custom mon {f}: odd size {size}')
            continue
        empty = [(r, c) for r in range(4) for c in range(4) if g[r][c] == 0]
        if empty:
            out['bad'].append(f'custom mon {f}: empty cells {empty}')
        else:
            out['custom_mon'][f] = {'file': f}

if '--emit-catalog' in sys.argv:
    path = sys.argv[sys.argv.index('--emit-catalog') + 1]
    with open(path, 'w') as f:
        f.write('// GENERATED: python3 tools/validate_sheets.py --emit-catalog src/assets/catalog.js\n')
        f.write('// Every sheet listed passed frame-layout validation (no empty walk/idle cells).\n')
        f.write('// CHAR_SHEETS: Actor/Character folder -> [sheet file, faceset file|null, rows] (16x16 frames, 4 cols)\n')
        f.write('export const CHAR_SHEETS = {\n')
        for n, v in out['char'].items():
            f.write("  %s: ['%s', %s, %d],\n" % (n, v['file'], json.dumps(v['face']), v['rows']))
        f.write('};\n// MONSTER_FILES: Actor/Monster folder -> sheet path (64x64, 4x4 frames: cols = down/up/left/right)\n')
        f.write('export const MONSTER_FILES = {\n')
        for n, v in out['mon'].items():
            f.write("  %s: '%s',\n" % (n, v['file']))
        f.write('};\n// CUSTOM_MONSTER_FILES: public/assets/custom/monsters -> sheet file (64x64, 4x4 frames)\n')
        f.write('export const CUSTOM_MONSTER_FILES = {\n')
        for f_name, v in out['custom_mon'].items():
            k = f_name.replace('.png', '')
            f.write("  %s: '%s',\n" % (k, v['file']))
        f.write('};\n')
if '--json' in sys.argv:
    json.dump(out, open(sys.argv[sys.argv.index('--json') + 1], 'w'), indent=1)
custom_count_str = f", {len(out['custom_mon'])} custom monsters" if out['custom_mon'] else ""
print(f"usable: {len(out['char'])} characters, {len(out['mon'])} monsters{custom_count_str}")
print('BAD:', *out['bad'], sep='\n  ')

