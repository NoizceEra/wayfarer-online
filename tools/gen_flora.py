"""Generate flora sprites derived from the game's own CC0 pixels.

Reads the Ninja Adventure flower-dirt speck + plant palettes and authors
matching single-flower / grass-tuft / sand-patch variants with the EXACT
same colors, so style match is by construction (no diffusion drift).

Outputs (transparent PNG, native pixel size):
  public/assets/custom/flora/flowerA.png   12x12 daisy (white/yellow/olive)
  public/assets/custom/flora/flowerB.png   10x12 closed bud
  public/assets/custom/flora/tuft.png      12x16 tall meadow grass
  public/assets/custom/flora/sandpatch.png 16x16 sandy decal (town colors)

Usage: python3 tools/gen_flora.py
Deterministic: fixed seeds, no randomness between runs.
"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'public', 'assets', 'custom', 'flora')

K = (20, 27, 27, 255)      # outline (from env.plant)
W = (255, 255, 255, 255)   # petal white
Y = (255, 225, 102, 255)   # flower center yellow
O = (241, 174, 65, 255)    # orange accent
G = (173, 188, 58, 255)    # olive leaf
GD = (74, 127, 75, 255)    # dark leaf
MB = (126, 200, 80, 255)   # meadow base #7ec850
MF = (109, 184, 68, 255)   # meadow fleck #6db844
SB = (201, 180, 88, 255)   # sand base #c9b458
SD = (187, 159, 69, 255)   # sand dark #bb9f45

PAL = {'.': None, 'K': K, 'W': W, 'Y': Y, 'O': O, 'G': G,
       'D': GD, 'M': MB, 'F': MF, 'S': SB, 'd': SD}


def build(name, rows, w, h):
    assert len(rows) == h, f'{name}: {len(rows)} rows != {h}'
    for r in rows:
        assert len(r) == w, f'{name}: row {r!r} len {len(r)} != {w}'
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            c = PAL[ch]
            if c:
                px[x, y] = c
    return im


FLOWER_A = [
    '....KKKK....',
    '...KWWWWK...',
    '..KWYYYYWK..',
    '..KWYOOYWK..',
    '...KWWWWK...',
    '....KGGK....',
    '....KGGK....',
    '....KGGK....',
    '...KGGGGK...',
    '..KGKGGKGK..',
    '............',
    '............',
]

FLOWER_B = [
    '...KKKK...',
    '..KWWWWK..',
    '..KWYYWK..',
    '..KWYYWK..',
    '..KWWWWK..',
    '...KGGK...',
    '...KGGK...',
    '...KGGK...',
    '..KGKKGK..',
    '..........',
    '..........',
    '..........',
]

TUFT = [
    '.....M......',
    '.....MM.....',
    '..M..MM..M..',
    '..MM.MM.MM..',
    '..MMMMMMMM..',
    '..MMMMMMMM..',
    '.MMMMMMMMMM.',
    '.MMFMMMMMFM.',
    '.MMMFMMMFMM.',
    '.MFMMMMMMFM.',
    '.MFMMFMMFMM.',
    '.MFMFMMFMFM.',
    '.KKKKKKKKKK.',
    '............',
    '............',
    '............',
]


def sandpatch():
    # 16x16 rounded sand decal: sand base, dark edge where it meets
    # transparency, deterministic speckle. Mirrors tile.town colors.
    w, h = 16, 16
    spans = [0, 10, 14, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 14, 10, 0]
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = im.load()
    s = 987654321

    def rnd():
        nonlocal s
        s = (s * 16807) % 2147483647
        return s / 2147483647

    for y in range(h):
        n = spans[y]
        x0 = (w - n) // 2
        for x in range(x0, x0 + n):
            edge = (x == x0 or x == x0 + n - 1)
            r = rnd()
            if edge:
                px[x, y] = SD
            elif r < 0.22:
                px[x, y] = SD
            elif r < 0.30:
                px[x, y] = K if rnd() < 0.25 else SD  # rare pebble grit
            else:
                px[x, y] = SB
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ('flowerA.png', build('flowerA', FLOWER_A, 12, 12)),
        ('flowerB.png', build('flowerB', FLOWER_B, 10, 12)),
        ('tuft.png', build('tuft', TUFT, 12, 16)),
        ('sandpatch.png', sandpatch()),
    ]
    for name, im in jobs:
        p = os.path.join(OUT, name)
        im.save(p)
        print('wrote', p, im.size)


if __name__ == '__main__':
    main()
