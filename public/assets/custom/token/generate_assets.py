import os
import shutil
from PIL import Image, ImageDraw, ImageFilter, ImageFont

token_dir = r"D:\ai-studio\wayfarer-online\public\assets\custom\token"
music_dir = r"D:\ai-studio\wayfarer-online\public\assets\audio\music"
os.makedirs(token_dir, exist_ok=True)
os.makedirs(music_dir, exist_ok=True)

print("Target directory:", token_dir)

# 1. Copy background music mus_token_trailer.wav
music_src = os.path.join(music_dir, "mus_synthwave_sunset.wav")
music_dst = os.path.join(music_dir, "mus_token_trailer.wav")
if os.path.exists(music_src):
    shutil.copy2(music_src, music_dst)
    print(f"Copied audio: {music_src} -> {music_dst}")
else:
    print(f"Warning: Audio source {music_src} missing!")

# 2. Copy background videos for token trailer
video_copies = [
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\playstyles\playstyle_intro.webm", "token_intro.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\marketplace\marketplace_crafting.webm", "token_utility.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\earn\earn_1_combat.webm", "token_earn.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\marketplace\marketplace_burn.webm", "token_burn.webm"),
    (r"D:\ai-studio\wayfarer-online\public\assets\custom\marketplace\marketplace_cta.webm", "token_cta.webm"),
]

for src, dst_name in video_copies:
    dst_path = os.path.join(token_dir, dst_name)
    if os.path.exists(src):
        shutil.copy2(src, dst_path)
        print(f"Copied video: {dst_name}")
    else:
        print(f"Warning: Source video {src} not found!")

# 3. Generate Golden 3D Token Badge (512x512)
img_size = (512, 512)
token_img = Image.new("RGBA", img_size, (0, 0, 0, 0))
draw = ImageDraw.Draw(token_img)

cx, cy = 256, 256
r_outer = 220

# Outer glowing aura
for i in range(250, 200, -5):
    alpha = int(80 * ((250 - i) / 50))
    draw.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(255, 170, 0, alpha))

# Outer gold rim (3D bevel)
draw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=(212, 147, 10))
draw.ellipse([cx - r_outer + 12, cy - r_outer + 12, cx + r_outer - 12, cy + r_outer - 12], fill=(255, 215, 0))
draw.ellipse([cx - r_outer + 24, cy - r_outer + 24, cx + r_outer - 24, cy + r_outer - 24], fill=(180, 110, 5))

# Inner token face
r_inner = 175
draw.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=(26, 16, 4))
draw.ellipse([cx - r_inner + 8, cy - r_inner + 8, cx + r_inner - 8, cy + r_inner - 8], fill=(45, 28, 8))

# Draw $WAYFARER Symbol in center ($ W)
try:
    font_large = ImageFont.truetype("arial.ttf", 160)
except Exception:
    font_large = ImageFont.load_default()

# Draw shiny emblem
draw.text((cx - 85, cy - 110), "$W", fill=(255, 215, 0), font=font_large)
draw.text((cx - 89, cy - 114), "$W", fill=(255, 255, 200), font=font_large)

# Highlights & sparkles
draw.ellipse([cx - 150, cy - 150, cx - 70, cy - 70], fill=(255, 255, 255, 90))

token_badge_path = os.path.join(token_dir, "wayfarer_golden_token_3d.png")
token_img.save(token_badge_path)
print(f"Generated 3D Token Badge: {token_badge_path}")

# 4. Generate Utility Badges (128x128)
def create_icon_badge(name, color_theme, symbol):
    badge = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(badge)
    # Circle base
    d.ellipse([4, 4, 124, 124], fill=(20, 25, 40, 230), outline=color_theme, width=4)
    d.ellipse([12, 12, 116, 116], fill=(10, 15, 25, 200))
    # Symbol
    try:
        font_ic = ImageFont.truetype("arial.ttf", 54)
    except Exception:
        font_ic = ImageFont.load_default()
    d.text((40, 32), symbol, fill=color_theme, font=font_ic)
    out_path = os.path.join(token_dir, f"token_badge_{name}.png")
    badge.save(out_path)
    print(f"Generated badge: {out_path}")

create_icon_badge("trading", (0, 230, 255), "⚖")
create_icon_badge("crafting", (255, 170, 0), "🔨")
create_icon_badge("gear", (220, 100, 255), "⚔")
create_icon_badge("staking", (0, 255, 150), "🔒")
create_icon_badge("burn", (255, 70, 30), "🔥")

print("Asset generation complete!")
