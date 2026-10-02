import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

seasonal_dir = r"D:\ai-studio\wayfarer-online\public\assets\custom\seasonal"
os.makedirs(seasonal_dir, exist_ok=True)

print("Created directory:", seasonal_dir)

# Helper function to create image with gradient/glow background
def create_base(width, height, bg_center=(40, 20, 10), bg_edge=(10, 5, 15)):
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Radial background gradient
    cx, cy = width / 2, height / 2
    max_r = math.hypot(cx, cy)
    
    for y in range(height):
        for x in range(width):
            r_dist = math.hypot(x - cx, y - cy) / max_r
            r = int(bg_center[0] * (1 - r_dist) + bg_edge[0] * r_dist)
            g = int(bg_center[1] * (1 - r_dist) + bg_edge[1] * r_dist)
            b = int(bg_center[2] * (1 - r_dist) + bg_edge[2] * r_dist)
            img.putpixel((x, y), (r, g, b, 255))
            
    return img, ImageDraw.Draw(img)

# 1. Jack O'Lantern NPC (512x512)
npc_img = Image.new("RGBA", (512, 512), (0,0,0,0))
draw = ImageDraw.Draw(npc_img)

# Aura glow behind NPC
for r in range(180, 50, -5):
    alpha = int(255 * (1 - (r / 180)**1.5) * 0.4)
    draw.ellipse([256 - r, 220 - r, 256 + r, 220 + r], fill=(255, 120, 0, alpha))

# Cloak Body
draw.polygon([(180, 480), (256, 200), (332, 480)], fill=(25, 15, 35, 255))
draw.polygon([(140, 480), (256, 230), (372, 480)], fill=(45, 25, 60, 255))

# Pumpkin Head
draw.ellipse([160, 120, 352, 280], fill=(245, 110, 15, 255), outline=(140, 50, 0), width=6)
# Ribs on pumpkin
draw.ellipse([190, 120, 322, 280], fill=None, outline=(210, 90, 10), width=5)
draw.ellipse([220, 120, 292, 280], fill=None, outline=(190, 75, 5), width=5)
# Stem
draw.polygon([(240, 130), (250, 80), (265, 80), (260, 130)], fill=(40, 140, 30))

# Carved Face (Glowing Yellow)
# Eyes
draw.polygon([(200, 175), (230, 175), (215, 200)], fill=(255, 235, 50))
draw.polygon([(282, 175), (312, 175), (297, 200)], fill=(255, 235, 50))
# Nose
draw.polygon([(250, 200), (262, 200), (256, 212)], fill=(255, 235, 50))
# Mouth jagged
mouth_pts = [(200, 225), (220, 245), (240, 230), (256, 250), (272, 230), (292, 245), (312, 225),
             (295, 255), (275, 250), (256, 265), (237, 250), (217, 255)]
draw.polygon(mouth_pts, fill=(255, 235, 50))

# Add glow effect overlay
glow = npc_img.filter(ImageFilter.GaussianBlur(8))
npc_final = Image.alpha_composite(glow, npc_img)
npc_final.save(os.path.join(seasonal_dir, "jack_o_lantern_npc.png"))
print("Saved jack_o_lantern_npc.png")

# 2. Event Shop UI (800x500)
shop_img = Image.new("RGBA", (800, 500), (12, 8, 20, 240))
sdraw = ImageDraw.Draw(shop_img)
# Border
sdraw.rectangle([10, 10, 790, 490], outline=(255, 140, 0), width=4)
sdraw.rectangle([16, 16, 784, 484], outline=(80, 40, 100), width=2)
# Header
sdraw.rectangle([20, 20, 780, 80], fill=(40, 20, 60))
# Grid slots
for row in range(2):
    for col in range(3):
        x = 50 + col * 240
        y = 110 + row * 170
        sdraw.rectangle([x, y, x + 220, y + 150], fill=(25, 18, 38), outline=(255, 160, 0, 180), width=2)

shop_img.save(os.path.join(seasonal_dir, "event_shop_ui.png"))
print("Saved event_shop_ui.png")

# Helper for Item Cards/Icons (300x300 pixel art icons with transparent/glowing BG)
def create_item_icon(name, draw_fn):
    img = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Outer glow ring
    for r in range(120, 40, -4):
        alpha = int(180 * (1 - r/120))
        d.ellipse([150-r, 150-r, 150+r, 150+r], fill=(255, 130, 0, alpha))
    
    # Custom draw function for item graphic
    draw_fn(d)
    
    # Save
    img.save(os.path.join(seasonal_dir, f"{name}.png"))
    print(f"Saved {name}.png")

# 3. Grim Reaper Scythe
def draw_scythe(d):
    # Handle
    d.line([(80, 260), (220, 50)], fill=(90, 50, 20), width=10)
    # Blade
    d.polygon([(220, 50), (270, 70), (250, 140), (210, 130), (225, 75)], fill=(200, 220, 255), outline=(130, 70, 220), width=3)
    # Glow edge
    d.line([(220, 50), (270, 70), (250, 140)], fill=(0, 240, 255), width=4)

create_item_icon("grim_reaper_scythe", draw_scythe)

# 4. Witch's Broomstick
def draw_broom(d):
    # Handle
    d.line([(60, 240), (210, 80)], fill=(120, 70, 30), width=12)
    # Bristles
    d.polygon([(210, 80), (260, 40), (280, 90), (230, 100)], fill=(210, 170, 50))
    d.line([(210, 80), (220, 95)], fill=(150, 30, 20), width=6) # Purple ribbon
    # Magic sparkle dots
    d.ellipse([240, 30, 250, 40], fill=(255, 255, 150))
    d.ellipse([270, 70, 280, 80], fill=(255, 255, 150))

create_item_icon("witchs_broomstick", draw_broom)

# 5. Vampire Bat Wings
def draw_bat_wings(d):
    # Left Wing
    d.polygon([(150, 160), (60, 90), (90, 150), (40, 180), (110, 210), (140, 180)], fill=(40, 20, 60), outline=(220, 30, 70), width=3)
    # Right Wing
    d.polygon([(150, 160), (240, 90), (210, 150), (260, 180), (190, 210), (160, 180)], fill=(40, 20, 60), outline=(220, 30, 70), width=3)
    # Red jewel center
    d.polygon([(150, 145), (162, 160), (150, 175), (138, 160)], fill=(230, 20, 50))

create_item_icon("vampire_bat_wings", draw_bat_wings)

# 6. Pumpkin Suit
def draw_pumpkin_suit(d):
    # Armor Body
    d.polygon([(100, 100), (200, 100), (220, 230), (150, 260), (80, 230)], fill=(235, 110, 20), outline=(130, 50, 10), width=5)
    # Ribbed lines
    d.line([(130, 100), (120, 245)], fill=(190, 80, 10), width=4)
    d.line([(170, 100), (180, 245)], fill=(190, 80, 10), width=4)
    # Green Collar
    d.polygon([(100, 100), (150, 130), (200, 100), (150, 90)], fill=(40, 160, 50))

create_item_icon("pumpkin_suit", draw_pumpkin_suit)

# 7. Jack-o'-Lantern Helm
def draw_helm(d):
    # Pumpkin Helm
    d.ellipse([80, 80, 220, 220], fill=(245, 120, 15), outline=(120, 40, 5), width=6)
    # Flaming eye slits
    d.polygon([(105, 130), (135, 130), (120, 155)], fill=(255, 230, 40))
    d.polygon([(165, 130), (195, 130), (180, 155)], fill=(255, 230, 40))
    # Mouth grid
    d.polygon([(115, 175), (185, 175), (175, 195), (125, 195)], fill=(255, 230, 40))
    # Top stem
    d.polygon([(140, 85), (145, 55), (155, 55), (160, 85)], fill=(40, 150, 30))

create_item_icon("jack_o_lantern_helm", draw_helm)

print("All custom seasonal image assets created successfully.")
