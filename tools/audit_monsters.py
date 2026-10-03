#!/usr/bin/env python3
"""Audit monster sprite sheets in public/assets/na/Actor/Monster/"""
import os
import json
from collections import Counter
from PIL import Image

NA_MONSTER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'na', 'Actor', 'Monster')

def rgb_to_hex(c):
    return f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"

def luminance(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

def audit():
    monsters = {}
    sizes = Counter()
    outline_candidates = Counter()
    palette_sizes = []
    
    all_colors = Counter()

    for root, dirs, files in os.walk(NA_MONSTER):
        for f in files:
            if f.endswith('.png') and not f.startswith('Faceset'):
                path = os.path.join(root, f)
                rel = os.path.relpath(path, NA_MONSTER).replace('\\', '/')
                im = Image.open(path).convert('RGBA')
                sizes[im.size] += 1
                
                # Analyze color palette
                pixels = list(im.getdata())
                visible = [p for p in pixels if p[3] > 0]
                color_counts = Counter(visible)
                
                # Check for semi-transparency / alpha antialiasing
                semi_transparent = sum(1 for p in pixels if 0 < p[3] < 255)
                
                # Sort colors by luminance
                sorted_by_lum = sorted(color_counts.keys(), key=luminance)
                darkest = sorted_by_lum[0] if sorted_by_lum else None
                darkest_hex = rgb_to_hex(darkest) if darkest else None
                
                if darkest_hex:
                    outline_candidates[darkest_hex] += 1
                    
                for c in color_counts.keys():
                    all_colors[rgb_to_hex(c)] += color_counts[c]
                
                palette_sizes.append(len(color_counts))
                
                # Classify colors by luminance
                hex_palette = [rgb_to_hex(c) for c in sorted_by_lum]
                
                monsters[rel] = {
                    "size": list(im.size),
                    "color_count": len(color_counts),
                    "semi_transparent_pixels": semi_transparent,
                    "darkest_outline": darkest_hex,
                    "palette_by_lum": hex_palette,
                    "color_frequencies": {rgb_to_hex(c): count for c, count in color_counts.most_common()}
                }

    print(f"Total monster spritesheets scanned: {len(monsters)}")
    print(f"Sizes distribution: {dict(sizes)}")
    print(f"Palette size range: min={min(palette_sizes)}, max={max(palette_sizes)}, avg={sum(palette_sizes)/len(palette_sizes):.1f}")
    print(f"Semi-transparency found in any sheets: {sum(1 for m in monsters.values() if m['semi_transparent_pixels'] > 0)}")
    print("\nMost common dark outline colors:")
    for col, count in outline_candidates.most_common(12):
        print(f"  {col}: used as darkest color in {count} sheets")
        
    print("\nMost frequent colors overall across all sheets:")
    for col, count in all_colors.most_common(20):
        print(f"  {col}: {count} pixels")

    # Let's inspect some notable monsters specifically
    key_monsters = ['Slime/Slime.png', 'Eye/Eye.png', 'Beast/SpriteSheet.png', 'Dragon/SpriteSheet.png', 
                    'Lizard/SpriteSheet.png', 'Mushroom/mushroom.png', 'Larva/SpriteSheet.png', 
                    'Axolot/SpriteSheet.png', 'Skull/SpriteSheet.png', 'Owl/SpriteSheet.png']
    print("\n--- Deep Dive on Key Monsters ---")
    for km in key_monsters:
        if km in monsters:
            m = monsters[km]
            print(f"\nMonster: {km}")
            print(f"  Colors ({m['color_count']}): {m['palette_by_lum']}")
            print(f"  Darkest Outline: {m['darkest_outline']}")
            print(f"  Top frequencies: {list(m['color_frequencies'].items())[:6]}")

    return monsters

if __name__ == '__main__':
    audit()
