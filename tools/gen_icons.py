#!/usr/bin/env python3
"""Generate PWA icons (192/512, plus maskable + apple-touch) from public/favicon.svg's pixel rects.
Usage: python3 tools/gen_icons.py   (needs pillow)"""
import re, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
svg = open(os.path.join(ROOT, 'public', 'favicon.svg')).read()
rects = [dict(re.findall(r'(\w+)="([^"]+)"', m)) for m in re.findall(r'<rect [^>]*/>', svg)]
BG = '#0f380f'


def render(size, art_frac=1.0, pad_bg=True):
    img = Image.new('RGBA', (size, size), BG if pad_bg else (0, 0, 0, 0))
    art = int(size * art_frac) // 16 * 16 or 16  # integer pixel scale keeps it crisp
    k = art // 16
    off = (size - art) // 2
    d = ImageDraw.Draw(img)
    for r in rects:
        x, y = int(r.get('x', 0)), int(r.get('y', 0))
        w, h = int(r['width']), int(r['height'])
        d.rectangle([off + x * k, off + y * k, off + (x + w) * k - 1, off + (y + h) * k - 1], fill=r['fill'])
    return img


out = os.path.join(ROOT, 'public', 'icons')
os.makedirs(out, exist_ok=True)
render(192).save(os.path.join(out, 'icon-192.png'))
render(512).save(os.path.join(out, 'icon-512.png'))
# maskable: art kept inside the ~80% safe zone on a full-bleed background
render(192, 0.72).save(os.path.join(out, 'maskable-192.png'))
render(512, 0.72).save(os.path.join(out, 'maskable-512.png'))
render(180).save(os.path.join(out, 'apple-touch-icon.png'))
print('icons written to', out)
