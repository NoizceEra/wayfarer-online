import os
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

output_dir = r"D:\ai-studio\wayfarer-online\public\assets\custom\jobs"
os.makedirs(output_dir, exist_ok=True)
print(f"Generating Jobs & Leveling trailer assets in {output_dir}...")

def create_gradient_bg(width, height, c1, c2):
    img = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        ratio = y / float(height)
        r = int(c1[0] * (1 - ratio) + c2[0] * ratio)
        g = int(c1[1] * (1 - ratio) + c2[1] * ratio)
        b = int(c1[2] * (1 - ratio) + c2[2] * ratio)
        draw.line([(0, y), (width, y)], fill=(r, g, b, 255))
    return img

def make_badge(filename, title, theme_color, border_color, symbol_type):
    size = (256, 256)
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Glow background
    for r in range(120, 20, -5):
        alpha = int(120 * (1 - r / 120))
        draw.ellipse([128 - r, 128 - r, 128 + r, 128 + r], fill=(*theme_color, alpha))

    # Outer Shield / Octagon Badge
    draw.polygon([(128, 16), (220, 50), (220, 180), (128, 240), (36, 180), (36, 50)],
                 fill=(15, 20, 30, 245), outline=border_color, width=6)
    
    # Inner accent border
    draw.polygon([(128, 28), (208, 58), (208, 172), (128, 226), (48, 172), (48, 58)],
                 fill=None, outline=theme_color, width=2)

    # Draw Symbol Icon
    if symbol_type == "wayfarer":
        # Sword & Lantern emblem
        draw.line([(128, 60), (128, 170)], fill=(220, 230, 240), width=8)
        draw.polygon([(128, 45), (120, 65), (136, 65)], fill=(255, 255, 255))
        draw.line([(105, 145), (151, 145)], fill=(200, 180, 100), width=6)
        # Lantern orb
        draw.ellipse([108, 100, 148, 140], fill=(255, 190, 50, 200), outline=(255, 240, 150), width=3)
    elif symbol_type == "ranger":
        # Bow & Crosshair
        draw.arc([60, 60, 180, 190], start=270, end=90, fill=(80, 220, 120), width=8)
        draw.line([(60, 60), (60, 190)], fill=(200, 200, 180), width=3)
        draw.line([(40, 125), (200, 125)], fill=(255, 220, 100), width=6)
        draw.polygon([(200, 125), (180, 115), (180, 135)], fill=(255, 240, 180))
    elif symbol_type == "arcanist":
        # Magic Staff & Celestial Rune
        draw.line([(70, 185), (170, 65)], fill=(180, 100, 240), width=7)
        draw.ellipse([150, 45, 190, 85], fill=(160, 80, 255, 220), outline=(230, 180, 255), width=4)
        draw.ellipse([160, 55, 180, 75], fill=(255, 255, 255, 255))
    elif symbol_type == "bandit":
        # Twin Daggers
        draw.line([(75, 65), (165, 175)], fill=(240, 70, 70), width=6)
        draw.line([(165, 65), (75, 175)], fill=(240, 70, 70), width=6)
        draw.ellipse([113, 113, 143, 143], fill=(255, 50, 50, 220))

    img.save(os.path.join(output_dir, filename))
    print(f"Saved badge: {filename}")

# Generate Starter Badges
make_badge("badge_wayfarer.png", "Wayfarer", (255, 180, 40), (255, 215, 0), "wayfarer")
make_badge("badge_ranger.png", "Ranger", (40, 220, 100), (100, 255, 150), "ranger")
make_badge("badge_arcanist.png", "Arcanist", (160, 80, 255), (210, 140, 255), "arcanist")
make_badge("badge_bandit.png", "Bandit", (255, 60, 80), (255, 120, 140), "bandit")

# Helper to generate Card / Banner images
def make_class_banner(filename, title, subtitle, color_primary, color_secondary):
    img = create_gradient_bg(1280, 720, (10, 15, 25), (5, 8, 15))
    draw = ImageDraw.Draw(img)

    # Decorative grid lines
    for x in range(0, 1280, 80):
        draw.line([(x, 0), (x, 720)], fill=(color_primary[0]//4, color_primary[1]//4, color_primary[2]//4, 40), width=1)
    for y in range(0, 720, 80):
        draw.line([(0, y), (1280, y)], fill=(color_primary[0]//4, color_primary[1]//4, color_primary[2]//4, 40), width=1)

    # Frame Box
    draw.rectangle([60, 60, 1220, 660], outline=color_primary, width=4)
    draw.rectangle([70, 70, 1210, 650], outline=color_secondary, width=2)

    # Glow Center
    draw.ellipse([440, 160, 840, 560], fill=(*color_primary, 40))

    # Text Banner Box
    draw.rectangle([120, 240, 1160, 480], fill=(15, 22, 35, 230), outline=color_primary, width=3)
    
    img.save(os.path.join(output_dir, filename))
    print(f"Saved banner: {filename}")

make_class_banner("class_wayfarer.png", "WAYFARER", "SWORD & LANTERN BALANCED TRAVELER", (255, 180, 40), (255, 215, 100))
make_class_banner("class_ranger.png", "RANGER", "PRECISION BOW SKIRMISHER & TRAPPER", (40, 220, 100), (120, 255, 160))
make_class_banner("class_arcanist.png", "ARCANIST", "ELEMENTAL AoE BURST & WISP MAGIC", (160, 80, 255), (210, 150, 255))
make_class_banner("class_bandit.png", "BANDIT", "FAST TWIN FANGBADE & SHADOW TRICKS", (255, 60, 80), (255, 130, 150))

make_class_banner("levelup_showcase.png", "LEVEL UP & ALLOCATE STATS", "CUSTOMIZE STR • AGI • VIT • INT • DEX • LUK", (255, 215, 0), (0, 230, 255))
make_class_banner("specializations_grid.png", "ADVANCED SPECIALIZATIONS", "8 EPIC CLASS PATHS AT LEVEL 10", (0, 240, 200), (255, 100, 220))

# Create Video Clips using ffmpeg
def make_video_clip(filename, text, color1, color2, duration=3):
    temp_img = os.path.join(output_dir, "temp_frame.png")
    img = create_gradient_bg(1280, 720, color1, color2)
    draw = ImageDraw.Draw(img)

    # Frame overlay
    draw.rectangle([40, 40, 1240, 680], outline=(255, 255, 255, 180), width=4)
    draw.ellipse([340, 120, 940, 600], fill=(255, 255, 255, 20))
    
    img.save(temp_img)
    
    video_path = os.path.join(output_dir, filename)
    cmd = [
        "ffmpeg", "-y", "-loop", "1", "-i", temp_img,
        "-vf", "format=yuv420p,drawwheel=r=100",
        "-t", str(duration), "-r", "30",
        video_path
    ]
    # Simple fallback video generation without complex filters
    cmd_simple = [
        "ffmpeg", "-y", "-loop", "1", "-i", temp_img,
        "-c:v", "libvpx-vp9" if filename.endswith(".webm") else "libx264",
        "-t", str(duration), "-pix_fmt", "yuva420p" if filename.endswith(".webm") else "yuv420p",
        video_path
    ]
    try:
        subprocess.run(cmd_simple, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"Saved video clip: {filename}")
    except Exception as e:
        print(f"Failed to generate video {filename}: {e}")

make_video_clip("jobs_intro.webm", "CHOOSE YOUR PATH", (20, 10, 40), (40, 15, 80), 4)
make_video_clip("class_wayfarer.webm", "WAYFARER IN ACTION", (40, 30, 10), (80, 50, 15), 3)
make_video_clip("class_ranger.webm", "RANGER IN ACTION", (10, 40, 20), (20, 80, 30), 3)
make_video_clip("class_arcanist.webm", "ARCANIST IN ACTION", (30, 10, 50), (60, 20, 90), 3)
make_video_clip("class_bandit.webm", "BANDIT IN ACTION", (50, 10, 20), (90, 20, 30), 3)
make_video_clip("levelup_showcase.webm", "STAT ALLOCATION", (40, 40, 10), (80, 80, 20), 4)
make_video_clip("specializations_showcase.webm", "8 ADVANCED SPECIALIZATIONS", (10, 40, 50), (20, 80, 90), 5)
make_video_clip("jobs_outro.webm", "MASTER YOUR CLASS", (50, 10, 40), (90, 20, 70), 4)

print("All Jobs & Leveling assets successfully generated!")
