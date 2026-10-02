import os
import shutil
import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

marketplace_dir = r"D:\ai-studio\wayfarer-online\public\assets\custom\marketplace"
os.makedirs(marketplace_dir, exist_ok=True)
print("Marketplace directory ready:", marketplace_dir)

# 1. Copy webm background videos for smooth trailer playback
video_copies = [
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\playstyles\playstyle_intro.webm", "marketplace_intro.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\playstyles\playstyle_2_trading.webm", "marketplace_trading.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\playstyles\playstyle_1_crafting.webm", "marketplace_crafting.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\earn\earn_4_payout.webm", "marketplace_burn.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\earn\earn_3_staking.webm", "marketplace_holders.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\playstyles\playstyle_outro.webm", "marketplace_cta.webm"),
]

for src, dst_name in video_copies:
    dst_path = os.path.join(marketplace_dir, dst_name)
    if os.path.exists(src):
        shutil.copy2(src, dst_path)
        print(f"Copied {src} -> {dst_path}")
    else:
        print(f"Warning: Source video {src} not found!")

# Helper functions for PIL graphics
def create_glow_circle(draw, center, radius, color_rgba):
    cx, cy = center
    r, g, b, a = color_rgba
    for i in range(radius, 0, -4):
        alpha = int(a * (i / radius)**1.5)
        draw.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(r, g, b, alpha))

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

# ==============================================================================
# PIXEL-ART SPRITE ASSETS GENERATION (16x16 and 32x32)
# ==============================================================================

# 1. ANVIL 16x16 & 32x32
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
    '#': (18, 20, 28, 255),
    'H': (130, 140, 160, 255),
    'S': (70, 78, 95, 255),
    'B': (45, 50, 62, 255),
}
anvil_16_img = draw_pixel_matrix((16, 16), anvil_16_matrix, anvil_16_palette)
anvil_16_img.save(os.path.join(marketplace_dir, "anvil_16.png"))

anvil_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
adraw = ImageDraw.Draw(anvil_32_img)
adraw.polygon([(4, 12), (10, 10), (10, 14)], fill=(110, 120, 140, 255), outline=(20, 22, 30, 255))
adraw.rectangle([10, 8, 27, 14], fill=(140, 152, 175, 255), outline=(20, 22, 30, 255))
adraw.line([(11, 9), (26, 9)], fill=(210, 225, 245, 255))
adraw.polygon([(12, 14), (24, 14), (22, 22), (14, 22)], fill=(65, 72, 88, 255), outline=(20, 22, 30, 255))
adraw.polygon([(9, 22), (27, 22), (30, 27), (6, 27)], fill=(40, 45, 55, 255), outline=(20, 22, 30, 255))
adraw.line([(7, 26), (29, 26)], fill=(80, 90, 110, 255))
anvil_32_img.save(os.path.join(marketplace_dir, "anvil_32.png"))

# 2. GOLD COIN 16x16 & 32x32
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
    '#': (90, 55, 0, 255),
    'Y': (230, 170, 0, 255),
    'h': (255, 225, 90, 255),
    '$': (160, 100, 0, 255),
}
gold_16_img = draw_pixel_matrix((16, 16), gold_16_matrix, gold_16_palette)
gold_16_img.save(os.path.join(marketplace_dir, "gold_coin_16.png"))

gold_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(gold_32_img)
gdraw.ellipse([2, 2, 29, 29], fill=(235, 175, 10, 255), outline=(80, 50, 0, 255), width=2)
gdraw.ellipse([5, 5, 26, 26], fill=(255, 205, 30, 255), outline=(180, 120, 0, 255), width=2)
gdraw.polygon([(10, 11), (13, 11), (16, 19), (19, 11), (22, 11), (18, 22), (14, 22)], fill=(160, 95, 0, 255))
gdraw.line([(7, 7), (12, 7)], fill=(255, 245, 160, 255), width=2)
gdraw.line([(6, 10), (8, 10)], fill=(255, 245, 160, 255), width=2)
gold_32_img.save(os.path.join(marketplace_dir, "gold_coin_32.png"))

# 3. TRADE RECEIPT 16x16 & 32x32
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
    '#': (45, 30, 15, 255),
    'P': (245, 235, 195, 255),
    'i': (70, 50, 35, 255),
    'R': (210, 35, 25, 255),
}
receipt_16_img = draw_pixel_matrix((16, 16), receipt_16_matrix, receipt_16_palette)
receipt_16_img.save(os.path.join(marketplace_dir, "trade_receipt_16.png"))

receipt_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
rdraw = ImageDraw.Draw(receipt_32_img)
rdraw.rectangle([5, 3, 26, 28], fill=(245, 235, 195, 255), outline=(50, 35, 20, 255), width=2)
for y in range(7, 21, 3):
    rdraw.line([(8, y), (23, y)], fill=(80, 55, 35, 255), width=1)
rdraw.ellipse([18, 20, 25, 26], fill=(210, 35, 25, 255), outline=(130, 15, 10, 255), width=1)
rdraw.polygon([(20, 22), (23, 22), (21.5, 25)], fill=(255, 100, 80, 255))
receipt_32_img.save(os.path.join(marketplace_dir, "trade_receipt_32.png"))

# 4. MARKET LEDGER 16x16 & 32x32
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
    '#': (35, 15, 5, 255),
    'L': (85, 40, 18, 255),
    'G': (220, 175, 40, 255),
    'B': (30, 110, 200, 255),
    'g': (230, 210, 140, 255),
}
ledger_16_img = draw_pixel_matrix((16, 16), ledger_16_matrix, ledger_16_palette)
ledger_16_img.save(os.path.join(marketplace_dir, "market_ledger_16.png"))

ledger_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
ldraw = ImageDraw.Draw(ledger_32_img)
ldraw.rectangle([4, 4, 27, 27], fill=(85, 38, 16, 255), outline=(30, 12, 4, 255), width=2)
ldraw.rectangle([4, 4, 8, 27], fill=(55, 24, 10, 255))
ldraw.line([(8, 4), (8, 27)], fill=(30, 12, 4, 255), width=1)
ldraw.polygon([(4, 4), (9, 4), (4, 9)], fill=(230, 180, 30, 255))
ldraw.polygon([(27, 4), (22, 4), (27, 9)], fill=(230, 180, 30, 255))
ldraw.polygon([(4, 27), (9, 27), (4, 22)], fill=(230, 180, 30, 255))
ldraw.polygon([(27, 27), (22, 27), (27, 22)], fill=(230, 180, 30, 255))
ldraw.rectangle([13, 13, 19, 18], fill=(240, 190, 40, 255), outline=(130, 90, 10, 255), width=1)
ldraw.rectangle([15, 19, 17, 29], fill=(20, 120, 230, 255))
ledger_32_img.save(os.path.join(marketplace_dir, "market_ledger_32.png"))

# 5. BURN FLAME 16x16 & 32x32
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
    '#': (120, 20, 0, 255),
    'F': (240, 70, 0, 255),
    'Y': (255, 190, 0, 255),
    'h': (255, 255, 180, 255),
}
flame_16_img = draw_pixel_matrix((16, 16), flame_16_matrix, flame_16_palette)
flame_16_img.save(os.path.join(marketplace_dir, "burn_flame_16.png"))

flame_32_img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
fldraw = ImageDraw.Draw(flame_32_img)
fldraw.polygon([(16, 2), (22, 10), (26, 18), (24, 28), (8, 28), (6, 18), (10, 10)], fill=(235, 60, 0, 255), outline=(130, 10, 0, 255))
fldraw.polygon([(16, 8), (20, 14), (22, 26), (10, 26), (12, 14)], fill=(255, 180, 0, 255))
fldraw.polygon([(16, 14), (18, 18), (19, 25), (13, 25), (14, 18)], fill=(255, 255, 200, 255))
flame_32_img.save(os.path.join(marketplace_dir, "burn_flame_32.png"))

print("Saved all 10 crisp 16x16 and 32x32 pixel art sprite assets!")

# ==============================================================================
# TOKEN AURA & ITEMS GENERATION
# ==============================================================================

# Token Aura Burning (512x512)
token_img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
tdraw = ImageDraw.Draw(token_img)
for r in range(240, 60, -6):
    alpha = int(220 * (1 - (r / 240)**1.2))
    if r > 160:
        col = (200, 40, 10, int(alpha * 0.4))
    elif r > 100:
        col = (255, 120, 0, int(alpha * 0.6))
    else:
        col = (255, 200, 30, int(alpha * 0.8))
    tdraw.ellipse([256 - r, 256 - r, 256 + r, 256 + r], fill=col)

tdraw.ellipse([106, 106, 406, 406], fill=(240, 180, 40, 255), outline=(255, 220, 100, 255), width=8)
tdraw.ellipse([120, 120, 392, 392], fill=(180, 110, 15, 255), outline=(255, 160, 20, 255), width=4)
tdraw.ellipse([136, 136, 376, 376], fill=(25, 12, 35, 255), outline=(220, 140, 20, 255), width=6)

tdraw.polygon([(256, 145), (280, 195), (260, 200), (290, 240), (256, 215), (222, 240), (252, 200), (232, 195)], fill=(255, 140, 0, 255))
tdraw.polygon([(256, 165), (270, 200), (256, 208), (242, 200)], fill=(255, 230, 80, 255))

w_pts = [
    (170, 230), (200, 230), (225, 310), (256, 260), (287, 310), (312, 230), (342, 230),
    (302, 350), (272, 350), (256, 290), (240, 350), (210, 350)
]
tdraw.polygon(w_pts, fill=(255, 215, 0, 255), outline=(255, 255, 180, 255), width=3)

glow = token_img.filter(ImageFilter.GaussianBlur(10))
token_final = Image.alpha_composite(glow, token_img)
token_final.save(os.path.join(marketplace_dir, "token_aura_burning.png"))
print("Saved token_aura_burning.png")

# Items
scythe_img = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
sdraw = ImageDraw.Draw(scythe_img)
create_glow_circle(sdraw, (150, 150), 130, (255, 110, 0, 180))
sdraw.rectangle([20, 20, 280, 280], outline=(255, 140, 0, 255), width=4)
sdraw.line([(60, 250), (220, 50)], fill=(90, 45, 15), width=12)
sdraw.polygon([(220, 50), (275, 75), (255, 150), (210, 135)], fill=(220, 240, 255), outline=(160, 50, 255), width=3)
sdraw.line([(220, 50), (275, 75), (255, 150)], fill=(0, 240, 255), width=5)
scythe_img.save(os.path.join(marketplace_dir, "halloween_scythe_item.png"))

robe_img = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
rdraw = ImageDraw.Draw(robe_img)
create_glow_circle(rdraw, (150, 150), 130, (0, 180, 255, 180))
rdraw.rectangle([20, 20, 280, 280], outline=(0, 200, 255, 255), width=4)
rdraw.polygon([(100, 70), (200, 70), (240, 250), (60, 250)], fill=(30, 70, 130), outline=(200, 240, 255), width=4)
rdraw.polygon([(120, 70), (180, 70), (190, 250), (110, 250)], fill=(220, 245, 255))
rdraw.polygon([(90, 70), (150, 120), (210, 70)], fill=(240, 250, 255))
robe_img.save(os.path.join(marketplace_dir, "winter_robe_item.png"))

sword_img = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
swdraw = ImageDraw.Draw(sword_img)
create_glow_circle(swdraw, (150, 150), 130, (255, 215, 0, 180))
swdraw.rectangle([20, 20, 280, 280], outline=(255, 215, 0, 255), width=4)
swdraw.line([(70, 230), (210, 90)], fill=(220, 225, 235), width=10)
swdraw.line([(60, 240), (75, 225)], fill=(180, 120, 40), width=14)
swdraw.line([(45, 255), (60, 240)], fill=(90, 50, 20), width=8)
sword_img.save(os.path.join(marketplace_dir, "everyday_sword_item.png"))

# Pixel-Art Composed Showcase Sprites (For standalone fallback)
forge_img = Image.new("RGBA", (600, 400), (15, 10, 25, 255))
fdraw = ImageDraw.Draw(forge_img)
fdraw.rectangle([10, 10, 590, 390], outline=(255, 140, 0), width=4)
create_glow_circle(fdraw, (300, 260), 180, (255, 90, 0, 200))
# Embed pixel-art anvil sprite onto forge image
anvil_scaled = anvil_32_img.resize((160, 160), Image.NEAREST)
forge_img.paste(anvil_scaled, (220, 200), anvil_scaled)
forge_img.save(os.path.join(marketplace_dir, "crafter_smithing_showcase.png"))

buyer_img = Image.new("RGBA", (600, 400), (10, 20, 35, 255))
bdraw = ImageDraw.Draw(buyer_img)
bdraw.rectangle([10, 10, 590, 390], outline=(0, 230, 180), width=4)
create_glow_circle(bdraw, (300, 200), 160, (0, 200, 255, 150))
coin_scaled = gold_32_img.resize((96, 96), Image.NEAREST)
receipt_scaled = receipt_32_img.resize((96, 96), Image.NEAREST)
ledger_scaled = ledger_32_img.resize((96, 96), Image.NEAREST)
buyer_img.paste(ledger_scaled, (120, 200), ledger_scaled)
buyer_img.paste(receipt_scaled, (252, 200), receipt_scaled)
buyer_img.paste(coin_scaled, (384, 200), coin_scaled)
buyer_img.save(os.path.join(marketplace_dir, "adventurer_buyer_showcase.png"))

trans_img = Image.new("RGBA", (800, 450), (18, 12, 30, 245))
td = ImageDraw.Draw(trans_img)
td.rectangle([10, 10, 790, 440], outline=(255, 140, 0), width=5)
flame_scaled = flame_32_img.resize((128, 128), Image.NEAREST)
trans_img.paste(flame_scaled, (336, 160), flame_scaled)
trans_img.save(os.path.join(marketplace_dir, "trade_burn_transaction_ui.png"))

chart_img = Image.new("RGBA", (700, 400), (12, 16, 32, 255))
cd = ImageDraw.Draw(chart_img)
cd.rectangle([10, 10, 690, 390], outline=(0, 230, 200), width=4)
for y in range(80, 340, 60):
    cd.line([(60, y), (640, y)], fill=(30, 50, 80), width=2)
cd.line([(80, 100), (220, 140), (360, 220), (500, 290), (620, 320)], fill=(255, 60, 30), width=6)
cd.line([(80, 320), (220, 280), (360, 200), (500, 120), (620, 80)], fill=(0, 240, 150), width=6)
chart_img.paste(flame_scaled, (560, 260), flame_scaled)
chart_img.paste(coin_scaled, (560, 40), coin_scaled)
chart_img.save(os.path.join(marketplace_dir, "token_supply_chart.png"))

print("All marketplace assets & pixel-art sprites generated successfully!")
