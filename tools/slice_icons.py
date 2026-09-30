"""Slice an AI-generated icon sheet (magenta background) into game-ready icons.

usage: python3 tools/slice_icons.py <sheet.png> <out_dir> name1,name2,... [--cols 4 --rows 4 --size 32]

Per cell: trim grid lines -> chroma-key magenta to alpha -> crop to content ->
centre on a square canvas -> nearest-neighbour downscale -> hard alpha +
24-colour quantize so it sits with the rest of the pixel art.
Needs Pillow (pip install pillow).
"""
import os
import sys

from PIL import Image


def arg(flag, default):
    return int(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else default


def is_key(r, g, b):
    # magenta incl. anti-aliased fringe
    return r > 150 and b > 150 and (r - g) > 70 and (b - g) > 70


def main():
    sheet, out, names = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
    size, cols, rows = arg('--size', 32), arg('--cols', 4), arg('--rows', 4)
    os.makedirs(out, exist_ok=True)
    im = Image.open(sheet).convert('RGB')
    cw, ch = im.width / cols, im.height / rows
    for i, name in enumerate(names):
        r, c = divmod(i, cols)
        pad = 4
        cell = im.crop((int(c * cw) + pad, int(r * ch) + pad,
                        int((c + 1) * cw) - pad, int((r + 1) * ch) - pad)).convert('RGBA')
        px = cell.load()
        for y in range(cell.height):
            for x in range(cell.width):
                R, G, B, _ = px[x, y]
                edge = x < 3 or y < 3 or x > cell.width - 4 or y > cell.height - 4
                if is_key(R, G, B) or (edge and R > 225 and G > 225 and B > 225):
                    px[x, y] = (0, 0, 0, 0)
        bbox = cell.getbbox()
        if not bbox:
            continue
        cell = cell.crop(bbox)
        side = max(cell.size) + 6
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(cell, ((side - cell.width) // 2, (side - cell.height) // 2))
        small = canvas.resize((size, size), Image.NEAREST)
        alpha = small.getchannel('A').point(lambda v: 255 if v > 127 else 0)
        rgb = small.convert('RGB').quantize(colors=24, method=Image.MEDIANCUT).convert('RGB')
        final = rgb.convert('RGBA')
        final.putalpha(alpha)
        final.save(os.path.join(out, f'{name}.png'))
        print('wrote', name)


if __name__ == '__main__':
    main()
