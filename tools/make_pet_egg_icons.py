"""Generate the three pet-egg item icons.

These were referenced by data/items.js as 'Other/Egg', a file that does not
exist in the Ninja Adventure pack, so all three eggs (and both orbs, which
pointed at a missing Object/Crystal) logged loaderror and rendered as blanks
in shops / the pet UI.

32x32 RGBA to match the item-icon pipeline: loader.makeItemIcons() draws a
source at min(2, floor(32/max(w,h))) scale, so a 32px source renders 1:1 as a
32px icon (the same size the generated custom/icons_ai/*.png art uses).

Run from the repo root:  python tools/make_pet_egg_icons.py
"""
import os

from PIL import Image

OUT_DIR = "public/assets/na/Items/Other"
SIZE = 32

# (name, body, shadow, highlight, speckle)
VARIANTS = [
    ("EggEmber", (226, 106, 44), (150, 52, 24), (255, 214, 160), (255, 240, 200)),
    ("EggDew", (90, 175, 240), (40, 100, 170), (208, 240, 255), (240, 252, 255)),
    ("EggSprig", (127, 210, 106), (46, 130, 70), (214, 255, 200), (240, 255, 225)),
]


def egg(body, shadow, highlight, speckle):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    px = img.load()
    cx, cy = 15.5, 17.0
    rx, ry = 9.5, 12.5

    for y in range(SIZE):
        for x in range(SIZE):
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            d = dx * dx + dy * dy
            if d > 1.0:
                continue
            # egg taper: narrower toward the top
            if dy < 0 and abs(dx) > 0.55 + 0.45 * (dy + 1.0):
                continue
            if d > 0.86:
                px[x, y] = shadow + (255,)
            elif d > 0.30:
                px[x, y] = body + (255,)
            else:
                px[x, y] = highlight + (255,)

    # speckles: deterministic, so re-running the script is idempotent
    for sx, sy in ((11, 14), (19, 12), (14, 22), (21, 20), (12, 18), (18, 25)):
        if 0 <= sx < SIZE and 0 <= sy < SIZE and px[sx, sy][3]:
            px[sx, sy] = speckle + (255,)

    # one-pixel outline so the icon reads on any panel background
    for y in range(SIZE):
        for x in range(SIZE):
            if px[x, y][3]:
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < SIZE and 0 <= ny < SIZE and not px[nx, ny][3]:
                        px[nx, ny] = shadow + (200,)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, *cols in VARIANTS:
        path = os.path.join(OUT_DIR, f"{name}.png")
        egg(*cols).save(path)
        print(f"wrote {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
