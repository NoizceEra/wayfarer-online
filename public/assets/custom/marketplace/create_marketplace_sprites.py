import os
from PIL import Image, ImageDraw

marketplace_dir = r"D:\ai-studio\wayfarer-online\public\assets\custom\marketplace"
os.makedirs(marketplace_dir, exist_ok=True)

# Helper to draw pixel matrices
def draw_pixel_matrix(img_size, matrix, palette):
    w, h = img_size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pixels = img.load()
    for y in range(h):
        for x in range(w):
            char = matrix[y][x]
            if char in palette and palette[char] is not None:
                pixels[x, y] = palette[char]
    return img

# 1. ANVIL 16x16
anvil_16_matrix = [
    "................",
    "................",
    "................",
    "....########....",
    "...#HHHHHHHH#...",
    "..#HHHHHHHHHH#..",
    ".#HHHHHHHHHHHH#.",
    ".##############.",
    "....#SSSSSS#....",
    "....#SSSSSS#....",
    "....#SSSSSS#....",
    "...#BBBBBBBB#...",
    "..#BBBBBBBBBB#..",
    ".##############.",
    "................",
    "................",
]
anvil_16_palette = {
    '.': None,
    '#': (18, 20, 28, 255),    # Dark outline
    'H': (130, 140, 160, 255), # Metal Highlight
    'S': (70, 78, 95, 255),    # Steel Stem
    'B': (45, 50, 62, 255),    # Dark Base
}
anvil_16_img = draw_pixel_matrix((16, 16), anvil_16_matrix, anvil_16_palette)
anvil_16_img.save(os.path.join(marketplace_dir, "anvil_16.png"))

# 2. ANVIL 32x32
anvil_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
adraw = ImageDraw.Draw(anvil_32_img)
# Anvil Horn (left)
adraw.polygon([(4, 12), (10, 10), (10, 14)], fill=(110, 120, 140, 255), outline=(20, 22, 30, 255))
# Anvil Flat Face
adraw.rectangle([10, 8, 27, 14], fill=(140, 152, 175, 255), outline=(20, 22, 30, 255))
adraw.line([(11, 9), (26, 9)], fill=(210, 225, 245, 255)) # Shiny top highlight
# Waist
adraw.polygon([(12, 14), (24, 14), (22, 22), (14, 22)], fill=(65, 72, 88, 255), outline=(20, 22, 30, 255))
# Base
adraw.polygon([(9, 22), (27, 22), (30, 27), (6, 27)], fill=(40, 45, 55, 255), outline=(20, 22, 30, 255))
adraw.line([(7, 26), (29, 26)], fill=(80, 90, 110, 255))
anvil_32_img.save(os.path.join(marketplace_dir, "anvil_32.png"))

# 3. GOLD COIN 16x16
gold_16_matrix = [
    "................",
    ".....######.....",
    "...##YYYYYY##...",
    "..#YYhhhhYYhY#..",
    ".#YYhYYYYhYYhY#.",
    ".#YhYYYYYhYYYhY#",
    "#YYhYY$YYhYYYYY#",
    "#YYhYY$YYhYYYYY#",
    "#YYhYY$$YhYYYYY#",
    "#YYhYY$YYhYYYYY#",
    ".#YhYYYYYhYYYhY#",
    ".#YYhYYYYhYYhY#.",
    "..#YYhhhhYYhY#..",
    "...##YYYYYY##...",
    ".....######.....",
    "................"
]
gold_16_palette = {
    '.': None,
    '#': (90, 55, 0, 255),    # Dark bronze outline
    'Y': (230, 170, 0, 255),  # Vibrant gold
    'h': (255, 225, 90, 255), # Bright highlight
    '$': (160, 100, 0, 255),  # Coin stamp core
}
gold_16_img = draw_pixel_matrix((16, 16), gold_16_matrix, gold_16_palette)
gold_16_img.save(os.path.join(marketplace_dir, "gold_coin_16.png"))

# 4. GOLD COIN 32x32
gold_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(gold_32_img)
# Outer coin body
gdraw.ellipse([2, 2, 29, 29], fill=(235, 175, 10, 255), outline=(80, 50, 0, 255), width=2)
# Inner rim
gdraw.ellipse([5, 5, 26, 26], fill=(255, 205, 30, 255), outline=(180, 120, 0, 255), width=2)
# Coin emblem "W"
gdraw.polygon([(10, 11), (13, 11), (16, 19), (19, 11), (22, 11), (18, 22), (14, 22)], fill=(160, 95, 0, 255))
# Shiny diagonal glint
gdraw.line([(7, 7), (12, 7)], fill=(255, 245, 160, 255), width=2)
gdraw.line([(6, 10), (8, 10)], fill=(255, 245, 160, 255), width=2)
gold_32_img.save(os.path.join(marketplace_dir, "gold_coin_32.png"))

# 5. TRADE RECEIPT 16x16
receipt_16_matrix = [
    "................",
    "..############..",
    "..#PPPPPPPPPP#..",
    "..#PiiiiiiiiP#..",
    "..#PPPPPPPPPP#..",
    "..#PiiiiiiiiP#..",
    "..#PPPPPPPPPP#..",
    "..#PiiiiiiiiP#..",
    "..#PPPPPPPPPP#..",
    "..#PiiiiiiiiP#..",
    "..#PPPPPPPPPP#..",
    "..#PPP###PPPP#..",
    "..#PPP#R#PPPP#..",
    "..#PPP###PPPP#..",
    "..############..",
    "................"
]
receipt_16_palette = {
    '.': None,
    '#': (45, 30, 15, 255),   # Dark parchment border
    'P': (245, 235, 195, 255),# Aged parchment
    'i': (70, 50, 35, 255),   # Ink line
    'R': (210, 35, 25, 255),  # Red wax seal
}
receipt_16_img = draw_pixel_matrix((16, 16), receipt_16_matrix, receipt_16_palette)
receipt_16_img.save(os.path.join(marketplace_dir, "trade_receipt_16.png"))

# 6. TRADE RECEIPT 32x32
receipt_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
rdraw = ImageDraw.Draw(receipt_32_img)
# Parchment paper with jagged edges
rdraw.rectangle([5, 3, 26, 28], fill=(245, 235, 195, 255), outline=(50, 35, 20, 255), width=2)
# Ink lines
for y in range(7, 21, 3):
    rdraw.line([(8, y), (23, y)], fill=(80, 55, 35, 255), width=1)
# Red wax seal at bottom right
rdraw.ellipse([18, 20, 25, 26], fill=(210, 35, 25, 255), outline=(130, 15, 10, 255), width=1)
rdraw.polygon([(20, 22), (23, 22), (21.5, 25)], fill=(255, 100, 80, 255))
receipt_32_img.save(os.path.join(marketplace_dir, "trade_receipt_32.png"))

# 7. MARKET LEDGER 16x16
ledger_16_matrix = [
    "................",
    "..############..",
    "..#LLLLLLLLLL#..",
    "..#LGGLLLLLLg#..",
    "..#LGGLLLLLLg#..",
    "..#LLLLLLLLLL#..",
    "..#LBBBBBBBBg#..",
    "..#LBBBBBBBBg#..",
    "..#LLLLLLLLLL#..",
    "..#LGGLLLLLLg#..",
    "..#LGGLLLLLLg#..",
    "..#LLLLLLLLLL#..",
    "..#LLLLLLLLLL#..",
    "..############..",
    "................",
    "................"
]
ledger_16_palette = {
    '.': None,
    '#': (35, 15, 5, 255),    # Dark tome outline
    'L': (85, 40, 18, 255),   # Leather brown
    'G': (220, 175, 40, 255), # Gold clasp
    'B': (30, 110, 200, 255), # Blue ribbon bookmark
    'g': (230, 210, 140, 255),# Gold page edge
}
ledger_16_img = draw_pixel_matrix((16, 16), ledger_16_matrix, ledger_16_palette)
ledger_16_img.save(os.path.join(marketplace_dir, "market_ledger_16.png"))

# 8. MARKET LEDGER 32x32
ledger_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
ldraw = ImageDraw.Draw(ledger_32_img)
# Leather Cover
ldraw.rectangle([4, 4, 27, 27], fill=(85, 38, 16, 255), outline=(30, 12, 4, 255), width=2)
# Spine (left)
ldraw.rectangle([4, 4, 8, 27], fill=(55, 24, 10, 255))
ldraw.line([(8, 4), (8, 27)], fill=(30, 12, 4, 255), width=1)
# Gold Corners
ldraw.polygon([(4, 4), (9, 4), (4, 9)], fill=(230, 180, 30, 255))
ldraw.polygon([(27, 4), (22, 4), (27, 9)], fill=(230, 180, 30, 255))
ldraw.polygon([(4, 27), (9, 27), (4, 22)], fill=(230, 180, 30, 255))
ldraw.polygon([(27, 27), (22, 27), (27, 22)], fill=(230, 180, 30, 255))
# Gold Buckle Clasp
ldraw.rectangle([13, 13, 19, 18], fill=(240, 190, 40, 255), outline=(130, 90, 10, 255), width=1)
# Blue Ribbon
ldraw.rectangle([15, 19, 17, 29], fill=(20, 120, 230, 255))
ledger_32_img.save(os.path.join(marketplace_dir, "market_ledger_32.png"))

# 9. BURN FLAME 16x16
flame_16_matrix = [
    "................",
    ".......#........",
    "......#F#.......",
    ".....#FFF#......",
    ".....#FFFF#.....",
    "....#FFFFF#.....",
    "....#FYYFFF#....",
    "...#FYYYYFFF#...",
    "...#FYYhYYFF#...",
    "..#FFYYhYYFFF#..",
    "..#FFFYYYYFFF#..",
    "..#FFFFFFFFFF#..",
    "...#FFFFFFFF#...",
    "....########....",
    "................",
    "................"
]
flame_16_palette = {
    '.': None,
    '#': (120, 20, 0, 255),   # Crimson fire border
    'F': (240, 70, 0, 255),   # Bright flame orange
    'Y': (255, 190, 0, 255),  # Yellow flame
    'h': (255, 255, 180, 255),# White hot core
}
flame_16_img = draw_pixel_matrix((16, 16), flame_16_matrix, flame_16_palette)
flame_16_img.save(os.path.join(marketplace_dir, "burn_flame_16.png"))

# 10. BURN FLAME 32x32
flame_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
fldraw = ImageDraw.Draw(flame_32_img)
# Outer Flame
fldraw.polygon([(16, 2), (22, 10), (26, 18), (24, 28), (8, 28), (6, 18), (10, 10)], fill=(235, 60, 0, 255), outline=(130, 10, 0, 255))
# Inner Yellow Flame
fldraw.polygon([(16, 8), (20, 14), (22, 26), (10, 26), (12, 14)], fill=(255, 180, 0, 255))
# White-hot Core
fldraw.polygon([(16, 14), (18, 18), (19, 25), (13, 25), (14, 18)], fill=(255, 255, 200, 255))
flame_32_img.save(os.path.join(marketplace_dir, "burn_flame_32.png"))

print("Created 16x16 and 32x32 pixel art sprite assets successfully!")
