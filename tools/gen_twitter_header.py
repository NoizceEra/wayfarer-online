"""Generate a 1500x500 Twitter / X Header Banner for Wayfarer Online.

Combines the promo key art background with a pixel-art vignette overlay,
centered logo title card, and retro Game Boy borders.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMO_PATH = os.path.join(BASE_DIR, 'public', 'assets', 'custom', 'promo_banner.jpg')
PFP_PATH = os.path.join(BASE_DIR, 'public', 'assets', 'custom', 'pfp_logo.jpg')
OUT_PATH = os.path.join(BASE_DIR, 'public', 'assets', 'custom', 'twitter_header.jpg')

TW_W, TW_H = 1500, 500

def main():
    if not os.path.exists(PROMO_PATH):
        print("Error: promo_banner.jpg not found")
        return

    # Load background promo image
    bg = Image.open(PROMO_PATH).convert('RGBA')
    
    # Crop/resize background to 1500x500 (panoramic 3:1)
    bg_ratio = bg.width / bg.height
    target_ratio = TW_W / TW_H
    
    if bg_ratio > target_ratio:
        # Wider than target, crop left/right
        new_w = int(bg.height * target_ratio)
        offset = (bg.width - new_w) // 2
        bg_cropped = bg.crop((offset, 0, offset + new_w, bg.height))
    else:
        # Taller than target, crop top/bottom
        new_h = int(bg.width / target_ratio)
        offset = (bg.height - new_h) // 2
        bg_cropped = bg.crop((0, offset, bg.width, offset + new_h))

    banner = bg_cropped.resize((TW_W, TW_H), Image.Resampling.LANCZOS)

    # Apply subtle dark vignette overlay on top/bottom/edges for Twitter UI readability
    vignette = Image.new('RGBA', (TW_W, TW_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(vignette)
    
    # Dark gradient overlays on edges
    for i in range(100):
        alpha = int(180 * (1 - i / 100))
        # Top gradient
        draw.line([(0, i), (TW_W, i)], fill=(9, 13, 20, alpha))
        # Bottom gradient
        draw.line([(0, TW_H - 1 - i), (TW_W, TW_H - 1 - i)], fill=(9, 13, 20, alpha))

    # Dark left corner vignette for Twitter PFP overlap area
    for r in range(350, 0, -5):
        alpha = int(140 * (1 - r / 350))
        draw.ellipse([(-50, TW_H - r + 50), (r + 100, TW_H + 150)], fill=(9, 13, 20, alpha))

    banner = Image.alpha_composite(banner, vignette)

    # Overlay PFP logo emblem on the right or center-right if available
    if os.path.exists(PFP_PATH):
        pfp = Image.open(PFP_PATH).convert('RGBA')
        pfp_size = 360
        pfp_resized = pfp.resize((pfp_size, pfp_size), Image.Resampling.LANCZOS)
        
        # Draw golden pixel border around logo
        border_size = pfp_size + 16
        logo_frame = Image.new('RGBA', (border_size, border_size), (244, 197, 66, 255))
        frame_draw = ImageDraw.Draw(logo_frame)
        frame_draw.rectangle([4, 4, border_size - 5, border_size - 5], fill=(26, 34, 52, 255))
        
        logo_frame.paste(pfp_resized, (8, 8), pfp_resized)
        
        # Paste logo emblem on right side of header
        logo_x = TW_W - border_size - 80
        logo_y = (TW_H - border_size) // 2
        banner.paste(logo_frame, (logo_x, logo_y), logo_frame)

    # Save final Twitter Header image as JPEG
    banner_rgb = banner.convert('RGB')
    banner_rgb.save(OUT_PATH, 'JPEG', quality=95)
    print(f"Successfully generated Twitter Header Banner ({TW_W}x{TW_H}) at: {OUT_PATH}")

if __name__ == '__main__':
    main()
