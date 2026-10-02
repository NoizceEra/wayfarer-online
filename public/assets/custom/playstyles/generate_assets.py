import os
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

output_dir = r"D:\ai-studio\wayfarer-online\public\assets\custom\playstyles"
os.makedirs(output_dir, exist_ok=True)
print(f"Generating playstyle assets in {output_dir}...")

# -------------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------------
def create_radial_bg(width, height, center_color, edge_color):
    img = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img)
    cx, cy = width / 2, height / 2
    max_r = math.hypot(cx, cy)
    for y in range(height):
        for x in range(width):
            r_dist = math.hypot(x - cx, y - cy) / max_r
            r = int(center_color[0] * (1 - r_dist) + edge_color[0] * r_dist)
            g = int(center_color[1] * (1 - r_dist) + edge_color[1] * r_dist)
            b = int(center_color[2] * (1 - r_dist) + edge_color[2] * r_dist)
            draw.point((x, y), fill=(r, g, b, 255))
    return img

def save_image(img, name):
    path = os.path.join(output_dir, name)
    img.save(path)
    print(f"Saved image: {name}")

# -------------------------------------------------------------------------
# 1. Badges Generation (256x256)
# -------------------------------------------------------------------------
def make_badge(filename, title, theme_color, border_color, symbol_type):
    size = (256, 256)
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Glow background
    for r in range(120, 20, -5):
        alpha = int(140 * (1 - r / 120))
        draw.ellipse([128 - r, 128 - r, 128 + r, 128 + r], fill=(*theme_color, alpha))

    # Outer Shield / Octagon Badge
    draw.polygon([(128, 16), (220, 50), (220, 180), (128, 240), (36, 180), (36, 50)],
                 fill=(20, 25, 35, 240), outline=border_color, width=6)
    
    # Inner accent border
    draw.polygon([(128, 28), (208, 58), (208, 172), (128, 226), (48, 172), (48, 58)],
                 fill=None, outline=theme_color, width=2)

    # Draw Symbol Icon
    if symbol_type == "crafter":
        # Hammer & Cauldron / Anvil
        draw.rectangle([80, 140, 176, 170], fill=(160, 170, 190), outline=border_color, width=3)
        draw.polygon([(100, 140), (120, 100), (136, 100), (156, 140)], fill=(200, 210, 230))
        # Hammer handle and head
        draw.line([(128, 70), (128, 140)], fill=(180, 120, 60), width=8)
        draw.rectangle([100, 65, 156, 95], fill=(220, 220, 240), outline=border_color, width=2)
    elif symbol_type == "trader":
        # Scales of Commerce & Gold Coin
        draw.line([(128, 70), (128, 170)], fill=(255, 215, 0), width=6)
        draw.line([(70, 95), (186, 95)], fill=(255, 215, 0), width=6)
        # Pan Left & Right
        draw.polygon([(50, 145), (90, 145), (70, 165)], fill=(240, 190, 40))
        draw.polygon([(166, 145), (206, 145), (186, 165)], fill=(240, 190, 40))
        # Coin center
        draw.ellipse([108, 108, 148, 148], fill=(255, 220, 50), outline=(200, 150, 20), width=3)
    elif symbol_type == "questseeker":
        # Parchment Scroll & Star
        draw.rectangle([76, 70, 180, 170], fill=(240, 220, 180), outline=(140, 100, 50), width=4)
        draw.line([(90, 95), (166, 95)], fill=(120, 80, 40), width=4)
        draw.line([(90, 120), (166, 120)], fill=(120, 80, 40), width=4)
        draw.line([(90, 145), (140, 145)], fill=(120, 80, 40), width=4)
        # Star seal
        draw.polygon([(128, 155), (135, 175), (155, 175), (138, 188), (145, 208), (128, 195), (111, 208), (118, 188), (101, 175), (121, 175)], fill=(0, 230, 255))
    elif symbol_type == "monsterhunter":
        # Crossed Swords & Skull Accent
        draw.line([(60, 60), (196, 196)], fill=(240, 80, 80), width=8)
        draw.line([(196, 60), (60, 196)], fill=(240, 80, 80), width=8)
        draw.line([(65, 65), (191, 191)], fill=(255, 220, 220), width=3)
        draw.line([(191, 65), (65, 191)], fill=(255, 220, 220), width=3)
        # Skull head center
        draw.ellipse([108, 100, 148, 140], fill=(240, 240, 250), outline=(100, 20, 20), width=3)

    # Text Ribbon at Bottom
    draw.rectangle([30, 195, 226, 230], fill=(15, 20, 30, 240), outline=border_color, width=2)
    # Title Text
    try:
        font = ImageFont.truetype("arialbd.ttf", 16)
    except:
        font = ImageFont.load_default()
    
    draw.text((128, 212), title, fill=(255, 255, 255), font=font, anchor="mm")

    save_image(img, filename)

make_badge("badge_crafter.png", "THE CRAFTER", (255, 160, 40), (255, 200, 80), "crafter")
make_badge("badge_trader.png", "THE TRADER", (40, 230, 140), (100, 255, 180), "trader")
make_badge("badge_questseeker.png", "QUEST-SEEKER", (0, 200, 255), (120, 230, 255), "questseeker")
make_badge("badge_monsterhunter.png", "MONSTER HUNTER", (255, 60, 80), (255, 120, 140), "monsterhunter")

# -------------------------------------------------------------------------
# 2. UI Mockups Generation (850x550)
# -------------------------------------------------------------------------
def make_ui_mockup(filename, title, subtitle, theme_accent, items_list):
    w, h = 850, 550
    img = Image.new("RGBA", (w, h), (12, 18, 30, 245))
    draw = ImageDraw.Draw(img)

    # Border & Glowing Header
    draw.rectangle([10, 10, w - 10, h - 10], outline=theme_accent, width=4)
    draw.rectangle([16, 16, w - 16, 75], fill=(22, 32, 52, 255))
    draw.line([(16, 75), (w - 16, 75)], fill=theme_accent, width=3)

    try:
        f_head = ImageFont.truetype("arialbd.ttf", 26)
        f_sub = ImageFont.truetype("arial.ttf", 18)
        f_card = ImageFont.truetype("arialbd.ttf", 20)
        f_desc = ImageFont.truetype("arial.ttf", 15)
    except:
        f_head = f_sub = f_card = f_desc = ImageFont.load_default()

    draw.text((35, 45), title, fill=theme_accent, font=f_head, anchor="lm")
    draw.text((w - 35, 45), subtitle, fill=(200, 220, 240), font=f_sub, anchor="rm")

    # Content Cards Grid (3 columns or rows)
    card_y = 100
    for i, item in enumerate(items_list):
        y1 = card_y + i * 135
        y2 = y1 + 120
        draw.rectangle([35, y1, w - 35, y2], fill=(20, 28, 45, 230), outline=(50, 70, 100), width=2)
        draw.rectangle([35, y1, 45, y2], fill=theme_accent)  # Accent indicator strip

        # Icon box
        draw.rectangle([60, y1 + 15, 140, y1 + 105], fill=(30, 42, 68), outline=theme_accent, width=2)
        draw.text((100, y1 + 60), item["icon_char"], fill=theme_accent, font=f_head, anchor="mm")

        # Text Details
        draw.text((160, y1 + 35), item["name"], fill=(255, 255, 255), font=f_card, anchor="lm")
        draw.text((160, y1 + 68), item["desc"], fill=(170, 190, 220), font=f_desc, anchor="lm")

        # Value/Payout badge on right
        draw.rectangle([w - 240, y1 + 30, w - 50, y1 + 90], fill=(10, 20, 35), outline=theme_accent, width=2)
        draw.text((w - 145, y1 + 60), item["val"], fill=(255, 220, 80), font=f_card, anchor="mm")

    save_image(img, filename)

make_ui_mockup("crafter_showcase.png", "CRAFTING BENCH: PROFIT & GEAR", "BAKE • BREW • SMITH", (255, 180, 40), [
    {"icon_char": "🥖", "name": "Golden Loaf Baking", "desc": "Restores 150 HP + 20% Stamina Regeneration", "val": "+450 GOLD"},
    {"icon_char": "🧪", "name": "Elixir of Vitality", "desc": "Brewed in Cauldron: +40% Mana & Speed Boost", "val": "+1,200 GOLD"},
    {"icon_char": "⚔️", "name": "Forged Mithril Sword", "desc": "Smithed at Anvil: Tier-4 Elemental Damage", "val": "+8,500 GOLD"}
])

make_ui_mockup("trader_showcase.png", "POSEY'S MARKET BOARD", "BUY LOW • SELL HIGH", (40, 230, 150), [
    {"icon_char": "📈", "name": "Market Listing #8402", "desc": "Sold 50x Mana Potions @ 120 Gold each", "val": "+6,000 GOLD"},
    {"icon_char": "📫", "name": "Posey Mail Payout", "desc": "Server-wide Auction House Order Fulfilled", "val": "+18,400 GOLD"},
    {"icon_char": "⚖️", "name": "Arbitrage Trade Deal", "desc": "Bought Low in Town A, Sold High in Town B", "val": "+12,500 GOLD"}
])

make_ui_mockup("questseeker_showcase.png", "TOWN NOTICE BOARD", "DAILY BOUNTIES & CONTRACTS", (0, 210, 255), [
    {"icon_char": "📜", "name": "Bounty: Forest Patrol", "desc": "Clear 10 Dew Slimes in Meadowfield", "val": "500 XP + TOKENS"},
    {"icon_char": "🛡️", "name": "Town Escort Contract", "desc": "Protect Supply Merchant Posey to City Gates", "val": "1,500 XP + REWARD"},
    {"icon_char": "🏆", "name": "Weekly Guild Milestone", "desc": "Complete 5 Town Contracts for Guild Chest", "val": "RARE LOOT CHEST"}
])

make_ui_mockup("monsterhunter_showcase.png", "BEAST HUNTER COMBAT", "SLAY BEASTS & CLAIM TOKENS", (255, 70, 90), [
    {"icon_char": "🐲", "name": "Tide Eye Slain!", "desc": "Boss Defeated in Tidehollow Depths", "val": "+250 TOKENS"},
    {"icon_char": "💎", "name": "Legendary Beast Drop", "desc": "Obtained: Dragon Heart & Mithril Ore", "val": "RARE DROP!"},
    {"icon_char": "🪙", "name": "WAYFARER Token Payout", "desc": "Combat Victory Staking & Kill Bonus", "val": "+1,000 TOKENS"}
])

# -------------------------------------------------------------------------
# 3. Video Background Clips Generation (FFmpeg)
# -------------------------------------------------------------------------
def make_video_clip(filename, duration, bg_color1, bg_color2, accent_color, pattern_type):
    temp_frames_dir = os.path.join(output_dir, f"frames_{pattern_type}")
    os.makedirs(temp_frames_dir, exist_ok=True)
    fps = 30
    total_frames = int(duration * fps)
    w, h = 1920, 1080

    print(f"Rendering {total_frames} frames for {filename}...")

    for f in range(total_frames):
        t = f / fps
        img = Image.new("RGB", (w, h), bg_color1)
        draw = ImageDraw.Draw(img)

        # Dynamic animated background elements
        cx, cy = w / 2, h / 2

        if pattern_type == "intro":
            # Grid lines + expanding concentric rings
            for ring in range(1, 8):
                r = (ring * 120 + t * 150) % 900
                draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=accent_color, width=2)
            # Grid lines
            for x in range(0, w, 120):
                draw.line([(x, 0), (x, h)], fill=(20, 30, 50), width=1)
            for y in range(0, h, 120):
                draw.line([(0, y), (w, y)], fill=(20, 30, 50), width=1)

        elif pattern_type == "crafter":
            # Rising sparks & heat waves
            for i in range(40):
                px = (i * 47 + int(t * 100)) % w
                py = h - ((i * 31 + int(t * 220)) % h)
                rad = 3 + (i % 6)
                draw.ellipse([px - rad, py - rad, px + rad, py + rad], fill=(255, 160 + (i * 5) % 90, 40))

        elif pattern_type == "trader":
            # Falling gold coins particle matrix
            for i in range(50):
                px = (i * 39) % w
                py = (i * 83 + int(t * 300)) % h
                draw.ellipse([px - 6, py - 6, px + 6, py + 6], fill=(255, 215, 0), outline=(200, 150, 0), width=2)
            # Ticker lines
            for y in [200, 540, 880]:
                offset = int(t * 200) % 400
                draw.line([(0, y), (w, y)], fill=(40, 200, 120), width=2)

        elif pattern_type == "questseeker":
            # Radiant quest compass beams
            for deg in range(0, 360, 30):
                rad_angle = math.radians(deg + t * 40)
                ex = cx + math.cos(rad_angle) * 1000
                ey = cy + math.sin(rad_angle) * 1000
                draw.line([(cx, cy), (ex, ey)], fill=(0, 180, 240), width=2)

        elif pattern_type == "monsterhunter":
            # Slash waves and crimson sparks
            for i in range(30):
                sx = (i * 65 + int(t * 400)) % (w + 400) - 200
                draw.line([(sx, 0), (sx - 300, h)], fill=(255, 50 + (i * 10) % 150, 70), width=4)

        elif pattern_type == "outro":
            # Radial burst finale
            for i in range(60):
                rad_angle = math.radians(i * 6 + t * 90)
                dist = 200 + math.sin(t * 5 + i) * 150 + (t * 100) % 600
                px = cx + math.cos(rad_angle) * dist
                py = cy + math.sin(rad_angle) * dist
                draw.ellipse([px - 8, py - 8, px + 8, py + 8], fill=(255, 220, 80))

        frame_path = os.path.join(temp_frames_dir, f"frame_{f:04d}.png")
        img.save(frame_path)

    clip_output_path = os.path.join(output_dir, filename)
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", os.path.join(temp_frames_dir, "frame_%04d.png"),
        "-c:v", "libvpx-vp9",
        "-deadline", "realtime",
        "-cpu-used", "8",
        "-b:v", "2M",
        "-r", str(fps),
        "-vf", "scale=1920:1080,format=yuv420p",
        clip_output_path
    ]
    print(f"Encoding WebM clip: {filename}...")
    subprocess.run(cmd, check=True)
    print(f"Generated WebM clip: {filename}")

    # Cleanup frame images
    for f in os.listdir(temp_frames_dir):
        os.remove(os.path.join(temp_frames_dir, f))
    os.rmdir(temp_frames_dir)

make_video_clip("playstyle_intro.webm", 4.0, (10, 15, 25), (5, 8, 15), (0, 200, 255), "intro")
make_video_clip("playstyle_1_crafter.webm", 4.0, (25, 15, 10), (12, 6, 4), (255, 160, 40), "crafter")
make_video_clip("playstyle_2_trader.webm", 4.0, (8, 22, 15), (4, 12, 8), (40, 230, 140), "trader")
make_video_clip("playstyle_3_questseeker.webm", 4.0, (10, 20, 30), (5, 10, 18), (0, 200, 255), "questseeker")
make_video_clip("playstyle_4_monsterhunter.webm", 4.0, (30, 10, 15), (15, 4, 8), (255, 60, 80), "monsterhunter")
make_video_clip("playstyle_outro.webm", 5.0, (15, 10, 30), (8, 5, 18), (255, 215, 0), "outro")

print("\nALL PLAYSTYLE ASSETS GENERATED SUCCESSFULLY!")
