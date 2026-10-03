#!/usr/bin/env python3
"""Build tools/monster_style_guide.json from auditing public/assets/na/Actor/Monster/"""
import os
import json
from collections import Counter
from PIL import Image

NA_MONSTER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'na', 'Actor', 'Monster')
GUIDE_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'monster_style_guide.json')

def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

def build_style_guide():
    monsters_data = {}
    master_palette = set()
    
    for root, dirs, files in os.walk(NA_MONSTER):
        for f in files:
            if f.endswith('.png') and not f.startswith('Faceset'):
                path = os.path.join(root, f)
                rel = os.path.relpath(path, NA_MONSTER).replace('\\', '/')
                monster_name = rel.split('/')[0]
                im = Image.open(path).convert('RGBA')
                
                pixels = [im.getpixel((x, y)) for y in range(im.height) for x in range(im.width)]
                visible = [p for p in pixels if p[3] > 0]
                counts = Counter(visible)
                
                for p in visible:
                    master_palette.add((p[0], p[1], p[2]))
                    
                sorted_by_lum = sorted(counts.keys(), key=lum)
                darkest = sorted_by_lum[0] if sorted_by_lum else None
                darkest_hex = f"#{darkest[0]:02x}{darkest[1]:02x}{darkest[2]:02x}" if darkest else "#141b1b"
                
                hex_palette = [f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}" for c in sorted_by_lum]
                
                monsters_data[monster_name] = {
                    "file": rel,
                    "color_count": len(counts),
                    "darkest_outline": darkest_hex,
                    "palette": hex_palette,
                    "dimensions": list(im.size)
                }

    sorted_master = sorted(list(master_palette), key=lum)
    master_hex = [f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}" for c in sorted_master]
    
    guide = {
        "metadata": {
            "title": "Ninja Adventure / Wayfarer Online Monster Sprite Style Guide",
            "version": "1.0.0",
            "target_engine": "Phaser 3 / Canvas Pixel Art",
            "source_asset_pack": "Ninja Adventure (CC0) Monster Roster",
            "audited_sprite_count": len(monsters_data)
        },
        "dimensions_and_layout": {
            "sheet_dimensions": {
                "width": 64,
                "height": 64,
                "units": "pixels"
            },
            "frame_dimensions": {
                "width": 16,
                "height": 16,
                "units": "pixels"
            },
            "grid": {
                "columns": 4,
                "rows": 4,
                "total_frames": 16
            },
            "column_mapping": {
                "0": {"direction": "Down", "facing": "South", "x_range": [0, 15], "description": "Front-facing / facing camera downward"},
                "1": {"direction": "Up", "facing": "North", "x_range": [16, 31], "description": "Back-facing / facing away upward"},
                "2": {"direction": "Left", "facing": "West", "x_range": [32, 47], "description": "Side-profile / facing left"},
                "3": {"direction": "Right", "facing": "East", "x_range": [48, 63], "description": "Side-profile / facing right (mirrored/lighting adapted)"}
            },
            "row_mapping": {
                "0": {"state": "Idle_1", "description": "Idle neutral base stance"},
                "1": {"state": "Step_1", "description": "Walk frame 1 / squash down or left foot forward"},
                "2": {"state": "Idle_2", "description": "Idle neutral return stance"},
                "3": {"state": "Step_2", "description": "Walk frame 2 / stretch up or right foot forward"}
            },
            "phaser_frame_indices": {
                "down": [0, 4, 8, 12],
                "up": [1, 5, 9, 13],
                "left": [2, 6, 10, 14],
                "right": [3, 7, 11, 15]
            },
            "animation_properties": {
                "default_framerate": 6,
                "repeat": -1,
                "bob_distance_px": [0, 1, 0, -1]
            }
        },
        "color_ramps_and_palettes": {
            "palette_budget": {
                "min_colors": 4,
                "max_colors": 9,
                "target_colors": 6,
                "roles": [
                    "Outline (Darkest)",
                    "Shadow / Dark Tone",
                    "Midtone / Base Body",
                    "Highlight / Rim Light",
                    "Eye / Pupil Accent",
                    "Sclera / Teeth / Horns / Belly / Secondary Accent"
                ]
            },
            "master_palette_33": master_hex,
            "standard_ramps": {
                "slime_cyan": {
                    "outline": "#141b1b",
                    "shadow": "#548789",
                    "midtone": "#79b8ce",
                    "highlight": "#f2eaf1",
                    "specular": "#ffffff",
                    "accent_dark": "#4e484a"
                },
                "forest_green": {
                    "outline": "#141b1b",
                    "shadow_deep": "#345a52",
                    "shadow": "#56864c",
                    "midtone": "#74a334",
                    "highlight": "#adbc3a",
                    "accent_warm": "#ffe18d",
                    "specular": "#ffffff"
                },
                "fire_crimson": {
                    "outline": "#141b1b",
                    "shadow_deep": "#45283c",
                    "shadow": "#8f3e56",
                    "midtone": "#e0394c",
                    "highlight": "#e46d3a",
                    "glow": "#ef914f",
                    "bright": "#ffad5d"
                },
                "desert_amber": {
                    "outline": "#141b1b",
                    "shadow": "#d14b34",
                    "midtone": "#d78b4a",
                    "highlight": "#f1c471",
                    "bright": "#ffe18d",
                    "accent": "#fce2ca"
                },
                "shadow_purple": {
                    "outline": "#181425",
                    "outline_alt": "#141b1b",
                    "shadow_deep": "#45283c",
                    "shadow": "#543c52",
                    "midtone": "#8f3e56",
                    "highlight": "#e0394c",
                    "accent": "#79b8ce"
                },
                "abyssal_blue": {
                    "outline": "#141b2b",
                    "outline_alt": "#141b1b",
                    "shadow_deep": "#4a5270",
                    "shadow": "#548789",
                    "midtone": "#79b8ce",
                    "highlight": "#e3f1f5",
                    "specular": "#ffffff"
                },
                "bone_undead": {
                    "outline": "#141b1b",
                    "shadow": "#e0394c",
                    "shadow_warm": "#e46d3a",
                    "midtone": "#f2eaf1",
                    "highlight": "#ffffff"
                },
                "beast_fur_brown": {
                    "outline": "#2b1414",
                    "outline_alt": "#141b1b",
                    "shadow": "#965340",
                    "midtone": "#c8966b",
                    "highlight": "#f2ad7d",
                    "belly": "#fce2ca",
                    "specular": "#ffffff"
                },
                "slate_stone": {
                    "outline": "#141b1b",
                    "shadow_deep": "#3b3643",
                    "shadow": "#4e484a",
                    "midtone": "#5f7160",
                    "highlight": "#9ba7aa",
                    "specular": "#ffffff"
                }
            }
        },
        "outline_rules": {
            "border_width_px": 1,
            "style": "Continuous 1px outer silhouette contour",
            "corner_rule": "Avoid unnecessary orphan pixels / chunky 2x2 corners (clean single-pixel diagonals or right angles)",
            "primary_border_colors": [
                "#141b1b",
                "#181425",
                "#141b2b",
                "#2b1414",
                "#142b1b"
            ],
            "internal_details": {
                "use_for": ["Eye contours", "Mouth / Teeth separation", "Limb / Horn seams", "Shell / segmentation grooves"],
                "rule": "Internal line work should use the shadow tone or 1px outline selectively without breaking silhouette clarity"
            }
        },
        "shading_and_form": {
            "light_source": {
                "vector": [-1, -1, 0],
                "direction": "Top-Left lighting",
                "highlight_placement": "Top and Left facing exterior edges and crown surfaces",
                "shadow_placement": "Bottom and Right facing interior surfaces, underbelly, and ground contact"
            },
            "silhouette": {
                "rule": "Chunky readable pixel silhouette within 14x14 interior box of 16x16 tile, leaving 1-2px boundary margin for clean animation frames",
                "readability": "Read clearly at native 1x (16x16) and 2x/3x scale against light and dark terrain",
                "grounding": "Bottom-most row of creature sits near y=14..15 of the frame with a flat or grounded footprint for shadow alignment"
            },
            "antialiasing": {
                "subpixel_antialiasing": False,
                "alpha_channel": "Strictly 1-bit alpha (0 for transparent, 255 for opaque pixels; 0 semi-transparent pixels permitted)",
                "dithering": "Minimal to none; prefer solid cell-shaded geometric color bands (1-2px wide) over noisy dithering"
            },
            "eyes_and_expression": {
                "size": "1x1, 1x2, or 2x2 pixels",
                "contrast": "Maximum contrast against face color",
                "pupil_highlight": "Bright sclera/iris with dark pupil or glow accent"
            }
        },
        "audited_monster_roster": monsters_data
    }

    with open(GUIDE_OUT, 'w') as f:
        json.dump(guide, f, indent=2)
    print(f"Wrote {GUIDE_OUT} with {len(monsters_data)} audited monsters.")

if __name__ == '__main__':
    build_style_guide()
