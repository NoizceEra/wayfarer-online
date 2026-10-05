#!/usr/bin/env python3
"""Biome Pack B Monster Generator — Wayfarer Online / Ninja Adventure 16-bit Pixel Art

Generates 6 brand-new, authentic 16-bit monster sprite sheets matching the Ninja Adventure CC0 aesthetic:
1. cavern_magmacrab.png    - Molten / magma crab with glowing orange/yellow magma vents, dark obsidian carapace, snapping claws
2. crypt_voidwisp.png      - Void / shadow spirit with dark violet body, glowing amethyst core, floating occult energy motes
3. forest_briarsapling.png - Briar / bark treant sapling with leafy green top, mossy wood body, walking root legs
4. desert_sandstalker.png  - Sand scorpion / stalker with warm amber/gold chitin, menacing stinger tail, scuttling legs
5. frost_rimebat.png       - Glacial rime bat / gargoyle with pale cyan crystal wings, icy white fangs, flapping anim
6. hollow_abysseye.png     - Eldritch abyss eye with deep purple sclera, pulsing crimson pupil, floating shadow tendrils

All sheets are strictly 64x64 RGBA PNGs (4 columns x 4 rows of 16x16 frames):
  Cols: 0 = Down, 1 = Up, 2 = Left, 3 = Right
  Rows: 0..3 = 4-frame animation cycle (walk/scuttle/stride/surge)
  100% hard alpha (0 or 255), 0 empty cells, 6-9 indexed palette colors per sheet strictly drawn from the Ninja Adventure master palette.
"""

import os
import sys
from PIL import Image

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       'public', 'assets', 'custom', 'monsters')


def build_frame(rows, pal, name=""):
    assert len(rows) == 16, f"Frame {name} must have 16 rows, got {len(rows)}"
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        assert len(row) == 16, f"{name} row {y} must have 16 cols, got {len(row)}: '{row}'"
        for x, ch in enumerate(row):
            c = pal.get(ch)
            if c:
                px[x, y] = c
    return im


def assemble_sheet(frames_by_col_and_row, pal, out_path):
    """frames_by_col_and_row: list of 4 columns, each containing 4 rows of 16x16 ascii matrices.
    col 0: Down (rows 0,1,2,3)
    col 1: Up (rows 0,1,2,3)
    col 2: Left (rows 0,1,2,3)
    col 3: Right (rows 0,1,2,3)
    """
    sheet = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    for col_idx in range(4):
        for row_idx in range(4):
            ascii_frame = frames_by_col_and_row[col_idx][row_idx]
            frame_img = build_frame(ascii_frame, pal, f"col{col_idx}_row{row_idx}")
            sheet.paste(frame_img, (col_idx * 16, row_idx * 16))
    
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sheet.save(out_path, format='PNG')
    print(f"Generated: {out_path} ({sheet.size})")
    return sheet


# ==============================================================================
# 1. CAVERN MAGMACRAB (cavern_magmacrab.png)
# Molten / magma crab with glowing orange/yellow magma vents, dark obsidian carapace, snapping claws
# ==============================================================================
PAL_MAGMACRAB = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b Darkest outline
    'D': (59, 54, 67, 255),       # #3b3643 Obsidian carapace shadow
    'O': (78, 72, 74, 255),       # #4e484a Obsidian carapace mid
    'S': (155, 167, 170, 255),    # #9ba7aa Obsidian carapace highlight
    'M': (209, 75, 52, 255),      # #d14b34 Magma deep red-orange
    'F': (228, 109, 58, 255),     # #e46d3a Magma fire orange
    'Y': (255, 225, 141, 255),    # #ffe18d Magma yellow vent glow
    'W': (255, 255, 255, 255),    # #ffffff White-hot core gleam
    'E': (224, 57, 76, 255),      # #e0394c Glowing eyestalk ruby
}

MAGMACRAB_D0 = [
    '....KK....KK....',
    '...KEK....KEK...',
    '..KODKKKKKKDOK..',
    '.KMFOSSSSSSOFMK.',
    '.KWFOSYWYWYSFWK.',
    'KFFOFFYWYFFOFFK.',
    'KMFODMMMMDDOFMK.',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '.KDK..KDD..KDK..',
    'KODK..KDK..KODK.',
    '.KDK..KDK..KDK..',
    '.KK....KK...KK..',
    '..KK...KK...KK..',
    '................',
]
MAGMACRAB_D1 = [
    '....KK....KK....',
    '...KEK....KEK...',
    '..KODKKKKKKDOK..',
    '..KKOSSSSSSOFMK.',
    '.KMFOSYWYWYSFWK.',
    '.KWF OFFYWYFFOFFK'.replace(' ', ''),
    'KFFODMMMMDDOFMK.',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    'KODK..KDD...KK..',
    '.KDK..KDK..KODK.',
    '..KK..KDK..KDK..',
    '......KK....KK..',
    '......KK....KK..',
    '................',
]
MAGMACRAB_D2 = [
    '....KK....KK....',
    '...KEK....KEK...',
    '..KODKKKKKKDOK..',
    '.KMFOSSSSSSOFMK.',
    '.KWFOSYWYWYSFWK.',
    'KFFOFFYWYFFOFFK.',
    'KMFODMMMMDDOFMK.',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '.KDK..KDD..KDK..',
    'KODK..KDK..KODK.',
    '.KDK..KDK..KDK..',
    '.KK....KK...KK..',
    '..KK...KK...KK..',
    '................',
]
MAGMACRAB_D3 = [
    '....KK....KK....',
    '...KEK....KEK...',
    '..KODKKKKKKDOK..',
    '.KMFOSSSSSSOKK..',
    '.KWFOSYWYWYSOFMK',
    'KFFOFFYWYFFOSFWK',
    '.KMFODMMMMDDOFFK',
    '..KKODDDDDDDOKK.',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '..KK..KDD..KODK.',
    '.KODK.KDK...KDK.',
    '.KDK..KDK...KK..',
    '.KK...KK........',
    '.KK...KK........',
    '................',
]

MAGMACRAB_U0 = [
    '....KK....KK....',
    '...KOK....KOK...',
    '..KODKKKKKKDOK..',
    '.KDOOSSSSSSOODK.',
    '.KDFOSYWYWYSOFDK',
    'KDFOFFYWYFFOFFDK',
    'KDMFFMMMMMMFFMDK',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '.KDK..KDD..KDK..',
    'KODK..KDK..KODK.',
    '.KDK..KDK..KDK..',
    '.KK....KK...KK..',
    '..KK...KK...KK..',
    '................',
]
MAGMACRAB_U1 = [
    '....KK....KK....',
    '...KOK....KOK...',
    '..KODKKKKKKDOK..',
    '..KDOOSSSSSSOODK',
    '.KDFOSYWYWYSOFDK',
    'KDFOFFYWYFFOFFDK',
    'KDMFFMMMMMMFFMDK',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    'KODK..KDD...KK..',
    '.KDK..KDK..KODK.',
    '..KK..KDK..KDK..',
    '......KK....KK..',
    '......KK....KK..',
    '................',
]
MAGMACRAB_U2 = [
    '....KK....KK....',
    '...KOK....KOK...',
    '..KODKKKKKKDOK..',
    '.KDOOSSSSSSOODK.',
    '.KDFOSYWYWYSOFDK',
    'KDFOFFYWYFFOFFDK',
    'KDMFFMMMMMMFFMDK',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '.KDK..KDD..KDK..',
    'KODK..KDK..KODK.',
    '.KDK..KDK..KDK..',
    '.KK....KK...KK..',
    '..KK...KK...KK..',
    '................',
]
MAGMACRAB_U3 = [
    '....KK....KK....',
    '...KOK....KOK...',
    '..KODKKKKKKDOK..',
    '.KDOOSSSSSSOODK.',
    '.KDFOSYWYWYSOFDK',
    'KDFOFFYWYFFOFFDK',
    'KDMFFMMMMMMFFMDK',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '..KK..KDD..KODK.',
    '.KODK.KDK...KDK.',
    '.KDK..KDK...KK..',
    '.KK...KK........',
    '.KK...KK........',
    '................',
]

MAGMACRAB_L0 = [
    '..KK............',
    '.KEK...KKKK.....',
    '.KDK.KKOSSOKK...',
    'KMFKKOSYWYSOOK..',
    'KWFOSFFYWYFFODK.',
    'KFFOMMMMMMMMODK.',
    'KMFODDDDDDDDOKK.',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '.KDK..KDD..KDK..',
    'KODK..KDK..KODK.',
    '.KDK..KDK..KDK..',
    '.KK....KK...KK..',
    '..KK...KK...KK..',
    '................',
]
MAGMACRAB_L1 = [
    '..KK............',
    '.KEK...KKKK.....',
    '.KDK.KKOSSOKK...',
    '.KKKKOSYWYSOOK..',
    'KMFOSFFYWYFFODK.',
    'KWFOMMMMMMMMODK.',
    'KFFODDDDDDDDOKK.',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    'KODK..KDD...KK..',
    '.KDK..KDK..KODK.',
    '..KK..KDK..KDK..',
    '......KK....KK..',
    '......KK....KK..',
    '................',
]
MAGMACRAB_L2 = [
    '..KK............',
    '.KEK...KKKK.....',
    '.KDK.KKOSSOKK...',
    'KMFKKOSYWYSOOK..',
    'KWFOSFFYWYFFODK.',
    'KFFOMMMMMMMMODK.',
    'KMFODDDDDDDDOKK.',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '.KDK..KDD..KDK..',
    'KODK..KDK..KODK.',
    '.KDK..KDK..KDK..',
    '.KK....KK...KK..',
    '..KK...KK...KK..',
    '................',
]
MAGMACRAB_L3 = [
    '..KK............',
    '.KEK...KKKK.....',
    '.KDK.KKOSSOKK...',
    'KMFKKOSYWYSOOK..',
    'KWFOSFFYWYFFODK.',
    'KFFOMMMMMMMMODK.',
    'KMFODDDDDDDDOKK.',
    '.KKODDDDDDDOKK..',
    '..KOODDDDDDOOK..',
    '..KKKKKKKKKKKK..',
    '..KK..KDD..KODK.',
    '.KODK.KDK...KDK.',
    '.KDK..KDK...KK..',
    '.KK...KK........',
    '.KK...KK........',
    '................',
]

MAGMACRAB_R0 = [r[::-1] for r in MAGMACRAB_L0]
MAGMACRAB_R1 = [r[::-1] for r in MAGMACRAB_L1]
MAGMACRAB_R2 = [r[::-1] for r in MAGMACRAB_L2]
MAGMACRAB_R3 = [r[::-1] for r in MAGMACRAB_L3]


# ==============================================================================
# 2. CRYPT VOIDWISP (crypt_voidwisp.png)
# Void / shadow spirit with dark violet body, glowing amethyst core, floating occult energy motes
# ==============================================================================
PAL_VOIDWISP = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b Darkest outline
    'V': (69, 40, 60, 255),       # #45283c Dark violet void shadow
    'P': (84, 60, 82, 255),       # #543c52 Purple body
    'A': (143, 62, 86, 255),      # #8f3e56 Amethyst midtone
    'L': (242, 234, 241, 255),    # #f2eaf1 Glowing lilac highlight
    'W': (255, 255, 255, 255),    # #ffffff Occult white core
    'M': (121, 184, 206, 255),    # #79b8ce Floating occult cyan mote
    'D': (74, 82, 112, 255),      # #4a5270 Occult mote deep shadow
}

VOIDWISP_D0 = [
    '.....KKKK.......',
    '....KPVVPK...KMK',
    '...KPAALAPK.KMDM',
    '..KPALLWLAPK.KMK',
    '.KPALWWWWLAPK...',
    '.KPLWWLWWLPK....',
    '.KPVALLWLAVPK...',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    'KMK.KPVVPK......',
    'KDMK.KVPK.......',
    '.KMK..KK........',
    '..KK...KK.......',
    '..KMK..KMK......',
    '...KK...KK......',
    '................',
]
VOIDWISP_D1 = [
    '.....KKKK.......',
    '....KPVVPK......',
    '...KPAALAPK..KMK',
    '..KPALLWLAPK.KDM',
    '.KPALWWWWLAPK.KK',
    '.KPLWWLWWLPK....',
    '.KPVALLWLAVPK...',
    'KMKPPAAAPPKK....',
    'KDMKPVVVPKK.....',
    '.KK.KPVVPK......',
    '.....KVPK.......',
    '......KK........',
    '..KMK..KK.......',
    '..KDMK.KMK......',
    '...KK...KK......',
    '................',
]
VOIDWISP_D2 = [
    '.....KKKK.......',
    '....KPVVPK...KMK',
    '...KPAALAPK.KMDM',
    '..KPALLWLAPK.KMK',
    '.KPALWWWWLAPK...',
    '.KPLWWLWWLPK....',
    '.KPVALLWLAVPK...',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    'KMK.KPVVPK......',
    'KDMK.KVPK.......',
    '.KMK..KK........',
    '..KK...KK.......',
    '..KMK..KMK......',
    '...KK...KK......',
    '................',
]
VOIDWISP_D3 = [
    '.....KKKK....KMK',
    '....KPVVPK..KMDM',
    '...KPAALAPK..KMK',
    '..KPALLWLAPK....',
    '.KPALWWWWLAPK...',
    '.KPLWWLWWLPK....',
    '.KPVALLWLAVPK...',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    '...KKPVVPK......',
    'KMK..KVPK.......',
    'KDMK..KK........',
    '.KK....KK.......',
    '..KMK..KMK......',
    '...KK...KK......',
    '................',
]

VOIDWISP_U0 = [
    '.....KKKK.......',
    '....KPVVPK...KMK',
    '...KPVVVPK..KMDM',
    '..KPVPAAPVPK.KMK',
    '.KPVPAALAPVPK...',
    '.KPVALLWLAVPK...',
    '.KPVPAALAPVPK...',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    'KMK.KPVVPK......',
    'KDMK.KVPK.......',
    '.KMK..KK........',
    '..KK...KK.......',
    '..KMK..KMK......',
    '...KK...KK......',
    '................',
]
VOIDWISP_U1 = [
    '.....KKKK.......',
    '....KPVVPK......',
    '...KPVVVPK...KMK',
    '..KPVPAAPVPK.KDM',
    '.KPVPAALAPVPK.KK',
    '.KPVALLWLAVPK...',
    '.KPVPAALAPVPK...',
    'KMKPPAAAPPKK....',
    'KDMKPVVVPKK.....',
    '.KK.KPVVPK......',
    '.....KVPK.......',
    '......KK........',
    '..KMK..KK.......',
    '..KDMK.KMK......',
    '...KK...KK......',
    '................',
]
VOIDWISP_U2 = [
    '.....KKKK.......',
    '....KPVVPK...KMK',
    '...KPVVVPK..KMDM',
    '..KPVPAAPVPK.KMK',
    '.KPVPAALAPVPK...',
    '.KPVALLWLAVPK...',
    '.KPVPAALAPVPK...',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    'KMK.KPVVPK......',
    'KDMK.KVPK.......',
    '.KMK..KK........',
    '..KK...KK.......',
    '..KMK..KMK......',
    '...KK...KK......',
    '................',
]
VOIDWISP_U3 = [
    '.....KKKK....KMK',
    '....KPVVPK..KMDM',
    '...KPVVVPK...KMK',
    '..KPVPAAPVPK....',
    '.KPVPAALAPVPK...',
    '.KPVALLWLAVPK...',
    '.KPVPAALAPVPK...',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    '...KKPVVPK......',
    'KMK..KVPK.......',
    'KDMK..KK........',
    '.KK....KK.......',
    '..KMK..KMK......',
    '...KK...KK......',
    '................',
]

VOIDWISP_L0 = [
    '....KKKK........',
    '...KPVVPK....KMK',
    '..KPAALAPK..KMDM',
    '.KPALLWLAPK..KMK',
    'KPALWWWWLAPK....',
    'KPLWWLWWLPK.....',
    'KPVALLWLAVPK....',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    '...KPVVPKK......',
    '....KVPK.KMK....',
    '.....KK..KDMK...',
    '..KMK.KK..KK....',
    '..KDMKKMK.......',
    '...KK..KK.......',
    '................',
]
VOIDWISP_L1 = [
    '....KKKK........',
    '...KPVVPK.......',
    '..KPAALAPK...KMK',
    '.KPALLWLAPK.KMDM',
    'KPALWWWWLAPK.KMK',
    'KPLWWLWWLPK.....',
    'KPVALLWLAVPK....',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    '...KPVVPKK......',
    '....KVPK........',
    'KMK..KK..KMK....',
    'KDMK..KK.KDMK...',
    '.KK...KMK.KK....',
    '.......KK.......',
    '................',
]
VOIDWISP_L2 = [
    '....KKKK........',
    '...KPVVPK....KMK',
    '..KPAALAPK..KMDM',
    '.KPALLWLAPK..KMK',
    'KPALWWWWLAPK....',
    'KPLWWLWWLPK.....',
    'KPVALLWLAVPK....',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    '...KPVVPKK......',
    '....KVPK.KMK....',
    '.....KK..KDMK...',
    '..KMK.KK..KK....',
    '..KDMKKMK.......',
    '...KK..KK.......',
    '................',
]
VOIDWISP_L3 = [
    '....KKKK.....KMK',
    '...KPVVPK...KMDM',
    '..KPAALAPK...KMK',
    '.KPALLWLAPK.....',
    'KPALWWWWLAPK....',
    'KPLWWLWWLPK.....',
    'KPVALLWLAVPK....',
    '.KKPPAAAPPKK....',
    '..KKPVVVPK......',
    '...KPVVPKK......',
    'KMK.KVPK........',
    'KDMK.KK..KMK....',
    '.KK...KK.KDMK...',
    '......KMK.KK....',
    '.......KK.......',
    '................',
]

VOIDWISP_R0 = [r[::-1] for r in VOIDWISP_L0]
VOIDWISP_R1 = [r[::-1] for r in VOIDWISP_L1]
VOIDWISP_R2 = [r[::-1] for r in VOIDWISP_L2]
VOIDWISP_R3 = [r[::-1] for r in VOIDWISP_L3]


# ==============================================================================
# 3. FOREST BRIARSAPLING (forest_briarsapling.png)
# Briar / bark treant sapling with leafy green top, mossy wood body, walking root legs
# ==============================================================================
PAL_BRIARSAPLING = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b Darkest outline
    'L': (173, 188, 58, 255),     # #adbc3a Sprout leaf lime highlight
    'G': (116, 163, 52, 255),     # #74a334 Leaf mid green
    'F': (86, 134, 76, 255),      # #56864c Foliage dark green
    'B': (200, 150, 107, 255),    # #c8966b Briar bark light
    'W': (150, 83, 64, 255),      # #965340 Wood trunk mid
    'D': (69, 40, 60, 255),       # #45283c Deep root / thorn shadow
    'Y': (255, 225, 141, 255),    # #ffe18d Sapling glowing amber eye
    'R': (209, 75, 52, 255),      # #d14b34 Amber eye core pupil
}

BRIARSAPLING_D0 = [
    '....DD..........',
    '...KDK.KKKK.....',
    '..KDLLGLLGGK....',
    '.KLLGLGGFFGGK...',
    'KLFFGGFFFFFLK...',
    'KKFBBWWWBFFKK...',
    'KBBWWDBBDWWBBK..',
    'KBWKYRWWKYRWBK..',
    'KBWBRRWWBRRWBK..',
    'KBDWWWWWWDDBK...',
    '.KBDBBWWDDDBK...',
    '..KDDDDDDDDK....',
    '..KBBDK..KBBDK..',
    '..KWDK....KWDK..',
    '..KKK......KKK..',
    '................',
]
BRIARSAPLING_D1 = [
    '....DD..........',
    '...KDK.KKKK.....',
    '..KDLLGLLGGK....',
    '.KLLGLGGFFGGK...',
    'KLFFGGFFFFFLK...',
    'KKFBBWWWBFFKK...',
    'KBBWWDBBDWWBBK..',
    'KBWKYRWWKYRWBK..',
    'KBWBRRWWBRRWBK..',
    'KBDWWWWWWDDBK...',
    '.KBDBBWWDDDBK...',
    '..KDDDDDDDDK....',
    '.KBBBDK...KDDK..',
    '.KWWDDK..KBBDK..',
    '.KKKK.....KKK...',
    '................',
]
BRIARSAPLING_D2 = [
    '....DD..........',
    '...KDK.KKKK.....',
    '..KDLLGLLGGK....',
    '.KLLGLGGFFGGK...',
    'KLFFGGFFFFFLK...',
    'KKFBBWWWBFFKK...',
    'KBBWWDBBDWWBBK..',
    'KBWKYRWWKYRWBK..',
    'KBWBRRWWBRRWBK..',
    'KBDWWWWWWDDBK...',
    '.KBDBBWWDDDBK...',
    '..KDDDDDDDDK....',
    '..KBBDK..KBBDK..',
    '..KWDK....KWDK..',
    '..KKK......KKK..',
    '................',
]
BRIARSAPLING_D3 = [
    '....DD..........',
    '...KDK.KKKK.....',
    '..KDLLGLLGGK....',
    '.KLLGLGGFFGGK...',
    'KLFFGGFFFFFLK...',
    'KKFBBWWWBFFKK...',
    'KBBWWDBBDWWBBK..',
    'KBWKYRWWKYRWBK..',
    'KBWBRRWWBRRWBK..',
    'KBDWWWWWWDDBK...',
    '.KBDBBWWDDDBK...',
    '..KDDDDDDDDK....',
    '..KDDK...KBBBDK.',
    '.KBBDK...KWWDDK.',
    '..KKK.....KKKK..',
    '................',
]

BRIARSAPLING_U0 = [
    '....DD..........',
    '...KDK.KKKK.....',
    '..KDLLGLLGGK....',
    '.KLLGLGGFFGGK...',
    'KLFFGGFFFFFLK...',
    'KKFBBWWWBFFKK...',
    'KBBWWDBBDWWBBK..',
    'KBWWWWWWWWWWWBK.',
    'KBWWDDWWDDWWWBK.',
    'KBDWWWWWWDDBK...',
    '.KBDBBWWDDDBK...',
    '..KDDDDDDDDK....',
    '..KBBDK..KBBDK..',
    '..KWDK....KWDK..',
    '..KKK......KKK..',
    '................',
]
BRIARSAPLING_U1 = [
    '....DD..........',
    '...KDK.KKKK.....',
    '..KDLLGLLGGK....',
    '.KLLGLGGFFGGK...',
    'KLFFGGFFFFFLK...',
    'KKFBBWWWBFFKK...',
    'KBBWWDBBDWWBBK..',
    'KBWWWWWWWWWWWBK.',
    'KBWWDDWWDDWWWBK.',
    'KBDWWWWWWDDBK...',
    '.KBDBBWWDDDBK...',
    '..KDDDDDDDDK....',
    '.KBBBDK...KDDK..',
    '.KWWDDK..KBBDK..',
    '.KKKK.....KKK...',
    '................',
]
BRIARSAPLING_U2 = [
    '....DD..........',
    '...KDK.KKKK.....',
    '..KDLLGLLGGK....',
    '.KLLGLGGFFGGK...',
    'KLFFGGFFFFFLK...',
    'KKFBBWWWBFFKK...',
    'KBBWWDBBDWWBBK..',
    'KBWWWWWWWWWWWBK.',
    'KBWWDDWWDDWWWBK.',
    'KBDWWWWWWDDBK...',
    '.KBDBBWWDDDBK...',
    '..KDDDDDDDDK....',
    '..KBBDK..KBBDK..',
    '..KWDK....KWDK..',
    '..KKK......KKK..',
    '................',
]
BRIARSAPLING_U3 = [
    '....DD..........',
    '...KDK.KKKK.....',
    '..KDLLGLLGGK....',
    '.KLLGLGGFFGGK...',
    'KLFFGGFFFFFLK...',
    'KKFBBWWWBFFKK...',
    'KBBWWDBBDWWBBK..',
    'KBWWWWWWWWWWWBK.',
    'KBWWDDWWDDWWWBK.',
    'KBDWWWWWWDDBK...',
    '.KBDBBWWDDDBK...',
    '..KDDDDDDDDK....',
    '..KDDK...KBBBDK.',
    '.KBBDK...KWWDDK.',
    '..KKK.....KKKK..',
    '................',
]

BRIARSAPLING_L0 = [
    '...DD...........',
    '..KDK.KKKK......',
    '.KDLLGLLGK......',
    'KLLGLGGFFGK.....',
    'KLFFGGFFFFLK....',
    'KKFBBWWWBFFK....',
    'KBBWKYRWWBBK....',
    'KBWBRRWWWBK.....',
    'KBDWWWWWDDK.....',
    '.KBDBBWWDDDK....',
    '..KDDDDDDDDK....',
    '..KBBDK..KBBDK..',
    '..KWDK....KWDK..',
    '..KKK......KKK..',
    '..KKK......KKK..',
    '................',
]
BRIARSAPLING_L1 = [
    '...DD...........',
    '..KDK.KKKK......',
    '.KDLLGLLGK......',
    'KLLGLGGFFGK.....',
    'KLFFGGFFFFLK....',
    'KKFBBWWWBFFK....',
    'KBBWKYRWWBBK....',
    'KBWBRRWWWBK.....',
    'KBDWWWWWDDK.....',
    '.KBDBBWWDDDK....',
    '..KDDDDDDDDK....',
    '.KBBBDK...KDDK..',
    '.KWWDDK..KBBDK..',
    '.KKKK.....KKK...',
    '..KKK......KKK..',
    '................',
]
BRIARSAPLING_L2 = [
    '...DD...........',
    '..KDK.KKKK......',
    '.KDLLGLLGK......',
    'KLLGLGGFFGK.....',
    'KLFFGGFFFFLK....',
    'KKFBBWWWBFFK....',
    'KBBWKYRWWBBK....',
    'KBWBRRWWWBK.....',
    'KBDWWWWWDDK.....',
    '.KBDBBWWDDDK....',
    '..KDDDDDDDDK....',
    '..KBBDK..KBBDK..',
    '..KWDK....KWDK..',
    '..KKK......KKK..',
    '..KKK......KKK..',
    '................',
]
BRIARSAPLING_L3 = [
    '...DD...........',
    '..KDK.KKKK......',
    '.KDLLGLLGK......',
    'KLLGLGGFFGK.....',
    'KLFFGGFFFFLK....',
    'KKFBBWWWBFFK....',
    'KBBWKYRWWBBK....',
    'KBWBRRWWWBK.....',
    'KBDWWWWWDDK.....',
    '.KBDBBWWDDDK....',
    '..KDDDDDDDDK....',
    '..KDDK...KBBBDK.',
    '.KBBDK...KWWDDK.',
    '..KKK.....KKKK..',
    '..KKK......KKK..',
    '................',
]

BRIARSAPLING_R0 = [r[::-1] for r in BRIARSAPLING_L0]
BRIARSAPLING_R1 = [r[::-1] for r in BRIARSAPLING_L1]
BRIARSAPLING_R2 = [r[::-1] for r in BRIARSAPLING_L2]
BRIARSAPLING_R3 = [r[::-1] for r in BRIARSAPLING_L3]


# ==============================================================================
# 4. DESERT SANDSTALKER (desert_sandstalker.png)
# Sand scorpion / stalker with warm amber/gold chitin, menacing stinger tail, scuttling legs
# ==============================================================================
PAL_SANDSTALKER = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b Darkest outline
    'H': (241, 196, 113, 255),    # #f1c471 Sand gold chitin highlight
    'A': (215, 139, 74, 255),     # #d78b4a Sand amber chitin midtone
    'C': (150, 83, 64, 255),      # #965340 Caramel brown chitin shadow
    'D': (69, 40, 60, 255),       # #45283c Deep chitin shadow
    'P': (173, 188, 58, 255),     # #adbc3a Poison venom barb bright lime
    'V': (86, 134, 76, 255),      # #56864c Poison venom barb dark green
    'R': (224, 57, 76, 255),      # #e0394c Ruby eyes
    'W': (255, 225, 141, 255),    # #ffe18d Chitin glint / sparkle
}

SANDSTALKER_D0 = [
    '......KKPK......',
    '.....KKPVK......',
    '...KKKHAHKKK....',
    '..KAAKHAHKAAK...',
    '.KHAHKHAAKHAHK..',
    '.KACHKRWWKHHCAK.',
    '.KCDKHAAAHKDCK..',
    'KK..KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    'KCK.KCAACKK.KCK.',
    '.KK.KCDDCK..KK..',
    '..KHKKDDDDHK....',
    '..KACKKKKKCAK...',
    '..KCK.....KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_D1 = [
    '.....KKPKK......',
    '....KKPVWKK.....',
    '...KKKHAHKKK....',
    '.KKAAKHAHKAAK...',
    '.KHAHKHAAKHAHK..',
    '.KACHKRWWKHHCAK.',
    'KKCDKHAAAHKDCK..',
    'KCK.KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    '.KK.KCAACKK.KCK.',
    '..KHKCDDCK..KK..',
    '..KACKDDDDHK....',
    '..KCKKKKKKCAK...',
    '..KK......KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_D2 = [
    '......KKPK......',
    '.....KKPVK......',
    '...KKKHAHKKK....',
    '..KAAKHAHKAAK...',
    '.KHAHKHAAKHAHK..',
    '.KACHKRWWKHHCAK.',
    '.KCDKHAAAHKDCK..',
    'KK..KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    'KCK.KCAACKK.KCK.',
    '.KK.KCDDCK..KK..',
    '..KHKKDDDDHK....',
    '..KACKKKKKCAK...',
    '..KCK.....KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_D3 = [
    '......KKPKK.....',
    '.....KKWVPKK....',
    '....KKKHAHKKK...',
    '...KAAKHAHKAAKK.',
    '..KHAHKHAAKHAHK.',
    '.KACHKRWWKHHCAK.',
    '..KCDKHAAAHKDCKK',
    '.KK..KHAAAHK.KCK',
    '.KCK.KHAAAHK.KCK',
    '.KCK.KCAACKK.KK.',
    '..KK.KCDDCKHKK..',
    '....KHDDDDDKCAK.',
    '...KACCKKKKKKCK.',
    '...KCK......KK..',
    '...KK.......KK..',
    '................',
]

SANDSTALKER_U0 = [
    '......KKPK......',
    '.....KKPVK......',
    '...KKKHAHKKK....',
    '..KAAKHAHKAAK...',
    '.KHAHKHAAKHAHK..',
    '.KACHKHAAKHHCAK.',
    '.KCDKHAAAHKDCK..',
    'KK..KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    'KCK.KCAACKK.KCK.',
    '.KK.KCDDCK..KK..',
    '..KHKKDDDDHK....',
    '..KACKKKKKCAK...',
    '..KCK.....KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_U1 = [
    '.....KKPKK......',
    '....KKPVWKK.....',
    '...KKKHAHKKK....',
    '.KKAAKHAHKAAK...',
    '.KHAHKHAAKHAHK..',
    '.KACHKHAAKHHCAK.',
    'KKCDKHAAAHKDCK..',
    'KCK.KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    '.KK.KCAACKK.KCK.',
    '..KHKCDDCK..KK..',
    '..KACKDDDDHK....',
    '..KCKKKKKKCAK...',
    '..KK......KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_U2 = [
    '......KKPK......',
    '.....KKPVK......',
    '...KKKHAHKKK....',
    '..KAAKHAHKAAK...',
    '.KHAHKHAAKHAHK..',
    '.KACHKHAAKHHCAK.',
    '.KCDKHAAAHKDCK..',
    'KK..KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    'KCK.KCAACKK.KCK.',
    '.KK.KCDDCK..KK..',
    '..KHKKDDDDHK....',
    '..KACKKKKKCAK...',
    '..KCK.....KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_U3 = [
    '......KKPKK.....',
    '.....KKWVPKK....',
    '....KKKHAHKKK...',
    '...KAAKHAHKAAKK.',
    '..KHAHKHAAKHAHK.',
    '.KACHKHAAKHHCAK.',
    '..KCDKHAAAHKDCKK',
    '.KK..KHAAAHK.KCK',
    '.KCK.KHAAAHK.KCK',
    '.KCK.KCAACKK.KK.',
    '..KK.KCDDCKHKK..',
    '....KHDDDDDKCAK.',
    '...KACCKKKKKKCK.',
    '...KCK......KK..',
    '...KK.......KK..',
    '................',
]

SANDSTALKER_L0 = [
    '....KKPK........',
    '...KKPVK........',
    '..KKHAHKK.......',
    '.KKHAHKAAK......',
    'KAAKHAAKHAHK....',
    'KACHKRWWKHHCAK..',
    'KCDKHAAAHKDCK...',
    'KK..KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    'KCK.KCAACKK.KCK.',
    '.KK.KCDDCK..KK..',
    '..KHKKDDDDHK....',
    '..KACKKKKKCAK...',
    '..KCK.....KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_L1 = [
    '...KKPKK........',
    '..KKPVWKK.......',
    '..KKHAHKK.......',
    '.KKHAHKAAK......',
    'KAAKHAAKHAHK....',
    'KACHKRWWKHHCAK..',
    'KKCDKHAAAHKDCK..',
    'KCK.KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    '.KK.KCAACKK.KCK.',
    '..KHKCDDCK..KK..',
    '..KACKDDDDHK....',
    '..KCKKKKKKCAK...',
    '..KK......KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_L2 = [
    '....KKPK........',
    '...KKPVK........',
    '..KKHAHKK.......',
    '.KKHAHKAAK......',
    'KAAKHAAKHAHK....',
    'KACHKRWWKHHCAK..',
    'KCDKHAAAHKDCK...',
    'KK..KHAAAHK..KK.',
    'KCK.KHAAAHK.KCK.',
    'KCK.KCAACKK.KCK.',
    '.KK.KCDDCK..KK..',
    '..KHKKDDDDHK....',
    '..KACKKKKKCAK...',
    '..KCK.....KCK...',
    '..KK.......KK...',
    '................',
]
SANDSTALKER_L3 = [
    '.....KKPKK......',
    '....KKWVPKK.....',
    '...KKKHAHKKK....',
    '..KAAKHAHKAAKK..',
    '.KHAHKHAAKHAHK..',
    '.KACHKRWWKHHCAK.',
    '..KCDKHAAAHKDCKK',
    '.KK..KHAAAHK.KCK',
    '.KCK.KHAAAHK.KCK',
    '.KCK.KCAACKK.KK.',
    '..KK.KCDDCKHKK..',
    '....KHDDDDDKCAK.',
    '...KACCKKKKKKCK.',
    '...KCK......KK..',
    '...KK.......KK..',
    '................',
]

SANDSTALKER_R0 = [r[::-1] for r in SANDSTALKER_L0]
SANDSTALKER_R1 = [r[::-1] for r in SANDSTALKER_L1]
SANDSTALKER_R2 = [r[::-1] for r in SANDSTALKER_L2]
SANDSTALKER_R3 = [r[::-1] for r in SANDSTALKER_L3]


# ==============================================================================
# 5. FROST RIMEBAT (frost_rimebat.png)
# Glacial rime bat / gargoyle with pale cyan crystal wings, icy white fangs, flapping anim
# ==============================================================================
PAL_RIMEBAT = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b Darkest outline
    'W': (255, 255, 255, 255),    # #ffffff Ice white fangs / frost tips
    'C': (227, 241, 245, 255),    # #e3f1f5 Pale cyan crystal wing highlight
    'I': (121, 184, 206, 255),    # #79b8ce Crystal azure midtone
    'D': (84, 135, 137, 255),     # #548789 Glacial blue shadow
    'N': (74, 82, 112, 255),      # #4a5270 Midnight gargoyle body
    'S': (59, 54, 67, 255),       # #3b3643 Gargoyle body deep shadow
    'R': (224, 57, 76, 255),      # #e0394c Glowing ruby eyes
}

RIMEBAT_D0 = [
    '..KK........KK..',
    '.KCKK......KKCK.',
    '.KCICKKKKKKCICK.',
    'KCICINNNNNNICICK',
    'KCIKNNRRRRNNKICK',
    'KCDKNWWSSWWNKCDK',
    'KCDKNNSSSSNNKCDK',
    '.KCKDNNNNDDKCK..',
    '..KKCDNNNDCKK...',
    '...KKDDDDDKK....',
    '....KCDDDCK.....',
    '....KNNNNK......',
    '....KWKKWK......',
    '....KK..KK......',
    '....KK..KK......',
    '................',
]
RIMEBAT_D1 = [
    '.KCKK......KKCK.',
    'KCICIKKKKKKCICKK',
    'KCICKNNNNNNKCICK',
    'KCKNNRRRRNNKCK..',
    '.KKNWWSSWWNKK...',
    '..KNNSSSSNNK....',
    '..KDNNNNDDK.....',
    '..KCDNNNDCK.....',
    '..KKDDDDDKK.....',
    '...KCDDDCK......',
    '...KNNNNK.......',
    '...KWKKWK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '................',
]
RIMEBAT_D2 = [
    '..KK........KK..',
    '.KCKK......KKCK.',
    '.KCICKKKKKKCICK.',
    'KCICINNNNNNICICK',
    'KCIKNNRRRRNNKICK',
    'KCDKNWWSSWWNKCDK',
    'KCDKNNSSSSNNKCDK',
    '.KCKDNNNNDDKCK..',
    '..KKCDNNNDCKK...',
    '...KKDDDDDKK....',
    '....KCDDDCK.....',
    '....KNNNNK......',
    '....KWKKWK......',
    '....KK..KK......',
    '....KK..KK......',
    '................',
]
RIMEBAT_D3 = [
    '..KK........KK..',
    '.KCKK......KKCK.',
    '.KKKKKNNNNKKKKK.',
    '..KNNRRRRNNK....',
    '..KNWWSSWWNK....',
    'KCICNNSSSSNCICK.',
    'KCDKNNNNDDKCDK..',
    'KCDKCDNNNDKCDK..',
    '.KCKDDDDDDDKCK..',
    '..KKCDDDCK.KK...',
    '....KNNNNK......',
    '....KWKKWK......',
    '....KK..KK......',
    '....KK..KK......',
    '....KK..KK......',
    '................',
]

RIMEBAT_U0 = [
    '..KK........KK..',
    '.KCKK......KKCK.',
    '.KCICKKKKKKCICK.',
    'KCICINNNNNNICICK',
    'KCIKNNSSSSNNKICK',
    'KCDKNNSSSSNNKCDK',
    'KCDKNNSSSSNNKCDK',
    '.KCKDNNNNDDKCK..',
    '..KKCDNNNDCKK...',
    '...KKDDDDDKK....',
    '....KCDDDCK.....',
    '....KNNNNK......',
    '....KWKKWK......',
    '....KK..KK......',
    '....KK..KK......',
    '................',
]
RIMEBAT_U1 = [
    '.KCKK......KKCK.',
    'KCICIKKKKKKCICKK',
    'KCICKNNNNNNKCICK',
    'KCKNNSSSSNNKCK..',
    '.KKNNSSSSNNKK...',
    '..KNNSSSSNNK....',
    '..KDNNNNDDK.....',
    '..KCDNNNDCK.....',
    '..KKDDDDDKK.....',
    '...KCDDDCK......',
    '...KNNNNK.......',
    '...KWKKWK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '................',
]
RIMEBAT_U2 = [
    '..KK........KK..',
    '.KCKK......KKCK.',
    '.KCICKKKKKKCICK.',
    'KCICINNNNNNICICK',
    'KCIKNNSSSSNNKICK',
    'KCDKNNSSSSNNKCDK',
    'KCDKNNSSSSNNKCDK',
    '.KCKDNNNNDDKCK..',
    '..KKCDNNNDCKK...',
    '...KKDDDDDKK....',
    '....KCDDDCK.....',
    '....KNNNNK......',
    '....KWKKWK......',
    '....KK..KK......',
    '....KK..KK......',
    '................',
]
RIMEBAT_U3 = [
    '..KK........KK..',
    '.KCKK......KKCK.',
    '.KKKKKNNNNKKKKK.',
    '..KNNSSSSNNK....',
    '..KNNSSSSNNK....',
    'KCICNNSSSSNCICK.',
    'KCDKNNNNDDKCDK..',
    'KCDKCDNNNDKCDK..',
    '.KCKDDDDDDDKCK..',
    '..KKCDDDCK.KK...',
    '....KNNNNK......',
    '....KWKKWK......',
    '....KK..KK......',
    '....KK..KK......',
    '....KK..KK......',
    '................',
]

RIMEBAT_L0 = [
    '..KK............',
    '.KCKK...KKKK....',
    '.KCICKKNNNNKK...',
    'KCICINNRRRRNK...',
    'KCIKNNWSSWWNK...',
    'KCDKNNSSSSNNK...',
    'KCDKCDNNNNDDK...',
    '.KCKCDNNNDCKK...',
    '..KKDDDDDKK.....',
    '...KCDDDCK......',
    '...KNNNNK.......',
    '...KWKKWK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '................',
]
RIMEBAT_L1 = [
    '.KCKK...........',
    'KCICIKKKKKKK....',
    'KCICKNNNNNNKK...',
    'KCKNNRRRRNNK....',
    '.KKNWWSSWWNK....',
    '..KNNSSSSNNK....',
    '..KDNNNNDDK.....',
    '..KCDNNNDCK.....',
    '..KKDDDDDKK.....',
    '...KCDDDCK......',
    '...KNNNNK.......',
    '...KWKKWK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '................',
]
RIMEBAT_L2 = [
    '..KK............',
    '.KCKK...KKKK....',
    '.KCICKKNNNNKK...',
    'KCICINNRRRRNK...',
    'KCIKNNWSSWWNK...',
    'KCDKNNSSSSNNK...',
    'KCDKCDNNNNDDK...',
    '.KCKCDNNNDCKK...',
    '..KKDDDDDKK.....',
    '...KCDDDCK......',
    '...KNNNNK.......',
    '...KWKKWK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '................',
]
RIMEBAT_L3 = [
    '..KK............',
    '.KCKK...KKKK....',
    '.KKKKKNNNNKKK...',
    '..KNNRRRRNNK....',
    '..KNWWSSWWNK....',
    'KCICNNSSSSNNK...',
    'KCDKNNNNDDKK....',
    'KCDKCDNNNDK.....',
    '.KCKDDDDDDDK....',
    '..KKCDDDCK......',
    '...KNNNNK.......',
    '...KWKKWK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '...KK..KK.......',
    '................',
]

RIMEBAT_R0 = [r[::-1] for r in RIMEBAT_L0]
RIMEBAT_R1 = [r[::-1] for r in RIMEBAT_L1]
RIMEBAT_R2 = [r[::-1] for r in RIMEBAT_L2]
RIMEBAT_R3 = [r[::-1] for r in RIMEBAT_L3]


# ==============================================================================
# 6. HOLLOW ABYSSEYE (hollow_abysseye.png)
# Eldritch abyss eye with deep purple sclera, pulsing crimson pupil, floating shadow tendrils
# ==============================================================================
PAL_ABYSSEYE = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b Darkest outline
    'V': (69, 40, 60, 255),       # #45283c Void deep shadow
    'P': (84, 60, 82, 255),       # #543c52 Deep purple sclera
    'S': (143, 62, 86, 255),      # #8f3e56 Sclera midtone / wine
    'L': (242, 234, 241, 255),    # #f2eaf1 Sclera lavender highlight
    'R': (224, 57, 76, 255),      # #e0394c Crimson iris
    'C': (209, 75, 52, 255),      # #d14b34 Crimson glowing pupil rim
    'W': (255, 255, 255, 255),    # #ffffff Specular eye gleam
    'T': (121, 184, 206, 255),    # #79b8ce Ethereal tendril tip cyan glow
}

ABYSSEYE_D0 = [
    '.....KKKKKK.....',
    '...KKPLLSSPKK...',
    '..KPLLSSSSSSPK..',
    '.KPLSSRRRRSSSPK.',
    '.KLSCRRCWRRCSPK.',
    'KLSSCRKKKKCSSPK.',
    'KLSSCRKKKKCSSPK.',
    '.KLSCRRCWRRCSPK.',
    '.KPSSSRRRRSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '.KKTVKK..KKVTKK.',
    'KTTK........KTKK',
    '.KK..........KK.',
    '..KK........KK..',
    '................',
]
ABYSSEYE_D1 = [
    '.....KKKKKK.....',
    '...KKPLLSSPKK...',
    '..KPLLSSSSSSPK..',
    '.KPLSSRRRRSSSPK.',
    '.KLSCKKKKKKCSPK.',
    'KLSSCKKWWKKCSSPK',
    'KLSSCKKWWKKCSSPK',
    '.KLSCKKKKKKCSPK.',
    '.KPSSSRRRRSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    'KKTVKK....KKVTKK',
    '.KTTK......KTKK.',
    '..KK........KK..',
    '..KK........KK..',
    '................',
]
ABYSSEYE_D2 = [
    '.....KKKKKK.....',
    '...KKPLLSSPKK...',
    '..KPLLSSSSSSPK..',
    '.KPLSSRRRRSSSPK.',
    '.KLSCRRCWRRCSPK.',
    'KLSSCRKKKKCSSPK.',
    'KLSSCRKKKKCSSPK.',
    '.KLSCRRCWRRCSPK.',
    '.KPSSSRRRRSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '.KKTVKK..KKVTKK.',
    'KTTK........KTKK',
    '.KK..........KK.',
    '..KK........KK..',
    '................',
]
ABYSSEYE_D3 = [
    '.....KKKKKK.....',
    '...KKPLLSSPKK...',
    '..KPLLSSSSSSPK..',
    '.KPLSSRRRRSSSPK.',
    '.KLSRRRRRRRRSPK.',
    'KLSSRCWRRCWRSSPK',
    'KLSSRCWRRCWRSSPK',
    '.KLSRRRRRRRRSPK.',
    '.KPSSSRRRRSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '..KKTVKKKKVTKK..',
    '..KTTK....KTKK..',
    '...KK......KK...',
    '...KK......KK...',
    '................',
]

ABYSSEYE_U0 = [
    '.....KKKKKK.....',
    '...KKPVVSSPKK...',
    '..KPVVSSSSSSPK..',
    '.KPVSSSSSSSSSPK.',
    '.KPVSSPPSSPPSSPK',
    'KPVSSPPSSPPSSSPK',
    'KPVSSSSSSSSSSSPK',
    '.KPVSSPPSSPPSSPK',
    '.KPVSSSSSSSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '.KKTVKK..KKVTKK.',
    'KTTK........KTKK',
    '.KK..........KK.',
    '..KK........KK..',
    '................',
]
ABYSSEYE_U1 = [
    '.....KKKKKK.....',
    '...KKPVVSSPKK...',
    '..KPVVSSSSSSPK..',
    '.KPVSSSSSSSSSPK.',
    '.KPVSSPPSSPPSSPK',
    'KPVSSPPSSPPSSSPK',
    'KPVSSSSSSSSSSSPK',
    '.KPVSSPPSSPPSSPK',
    '.KPVSSSSSSSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    'KKTVKK....KKVTKK',
    '.KTTK......KTKK.',
    '..KK........KK..',
    '..KK........KK..',
    '................',
]
ABYSSEYE_U2 = [
    '.....KKKKKK.....',
    '...KKPVVSSPKK...',
    '..KPVVSSSSSSPK..',
    '.KPVSSSSSSSSSPK.',
    '.KPVSSPPSSPPSSPK',
    'KPVSSPPSSPPSSSPK',
    'KPVSSSSSSSSSSSPK',
    '.KPVSSPPSSPPSSPK',
    '.KPVSSSSSSSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '.KKTVKK..KKVTKK.',
    'KTTK........KTKK',
    '.KK..........KK.',
    '..KK........KK..',
    '................',
]
ABYSSEYE_U3 = [
    '.....KKKKKK.....',
    '...KKPVVSSPKK...',
    '..KPVVSSSSSSPK..',
    '.KPVSSSSSSSSSPK.',
    '.KPVSSPPSSPPSSPK',
    'KPVSSPPSSPPSSSPK',
    'KPVSSSSSSSSSSSPK',
    '.KPVSSPPSSPPSSPK',
    '.KPVSSSSSSSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '..KKTVKKKKVTKK..',
    '..KTTK....KTKK..',
    '...KK......KK...',
    '...KK......KK...',
    '................',
]

ABYSSEYE_L0 = [
    '.....KKKKKK.....',
    '...KKPLLSSPKK...',
    '..KPLLSSSSSSPK..',
    '.KPLSRRRSSSSSPK.',
    '.KLSCRWRCSSSPK..',
    'KLSSCKKKCSSSPK..',
    'KLSSCKKKCSSSPK..',
    '.KLSCRWRCSSSPK..',
    '.KPSSRRRSSSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '.KKTVKK..KKVTKK.',
    'KTTK........KTKK',
    '.KK..........KK.',
    '..KK........KK..',
    '................',
]
ABYSSEYE_L1 = [
    '.....KKKKKK.....',
    '...KKPLLSSPKK...',
    '..KPLLSSSSSSPK..',
    '.KPLSRRRSSSSSPK.',
    '.KLSCKKKCSSSPK..',
    'KLSSCKWWKSSSPK..',
    'KLSSCKWWKSSSPK..',
    '.KLSCKKKCSSSPK..',
    '.KPSSRRRSSSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    'KKTVKK....KKVTKK',
    '.KTTK......KTKK.',
    '..KK........KK..',
    '..KK........KK..',
    '................',
]
ABYSSEYE_L2 = [
    '.....KKKKKK.....',
    '...KKPLLSSPKK...',
    '..KPLLSSSSSSPK..',
    '.KPLSRRRSSSSSPK.',
    '.KLSCRWRCSSSPK..',
    'KLSSCKKKCSSSPK..',
    'KLSSCKKKCSSSPK..',
    '.KLSCRWRCSSSPK..',
    '.KPSSRRRSSSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '.KKTVKK..KKVTKK.',
    'KTTK........KTKK',
    '.KK..........KK.',
    '..KK........KK..',
    '................',
]
ABYSSEYE_L3 = [
    '.....KKKKKK.....',
    '...KKPLLSSPKK...',
    '..KPLLSSSSSSPK..',
    '.KPLSRRRSSSSSPK.',
    '.KLSRRRRCSSSPK..',
    'KLSSRCWRKSSSPK..',
    'KLSSRCWRKSSSPK..',
    '.KLSRRRRCSSSPK..',
    '.KPSSRRRSSSSVPK.',
    '..KPVSSSSSSVPK..',
    '..KKPVVVVVVPKK..',
    '..KKTVKKKKVTKK..',
    '..KTTK....KTKK..',
    '...KK......KK...',
    '...KK......KK...',
    '................',
]

ABYSSEYE_R0 = [r[::-1] for r in ABYSSEYE_L0]
ABYSSEYE_R1 = [r[::-1] for r in ABYSSEYE_L1]
ABYSSEYE_R2 = [r[::-1] for r in ABYSSEYE_L2]
ABYSSEYE_R3 = [r[::-1] for r in ABYSSEYE_L3]


def generate_all():
    print("Generating Biome Pack B Monster Sprite Sheets...")
    
    # 1. cavern_magmacrab.png
    assemble_sheet(
        [[MAGMACRAB_D0, MAGMACRAB_D1, MAGMACRAB_D2, MAGMACRAB_D3],
         [MAGMACRAB_U0, MAGMACRAB_U1, MAGMACRAB_U2, MAGMACRAB_U3],
         [MAGMACRAB_L0, MAGMACRAB_L1, MAGMACRAB_L2, MAGMACRAB_L3],
         [MAGMACRAB_R0, MAGMACRAB_R1, MAGMACRAB_R2, MAGMACRAB_R3]],
        PAL_MAGMACRAB,
        os.path.join(OUT_DIR, 'cavern_magmacrab.png')
    )

    # 2. crypt_voidwisp.png
    assemble_sheet(
        [[VOIDWISP_D0, VOIDWISP_D1, VOIDWISP_D2, VOIDWISP_D3],
         [VOIDWISP_U0, VOIDWISP_U1, VOIDWISP_U2, VOIDWISP_U3],
         [VOIDWISP_L0, VOIDWISP_L1, VOIDWISP_L2, VOIDWISP_L3],
         [VOIDWISP_R0, VOIDWISP_R1, VOIDWISP_R2, VOIDWISP_R3]],
        PAL_VOIDWISP,
        os.path.join(OUT_DIR, 'crypt_voidwisp.png')
    )

    # 3. forest_briarsapling.png
    assemble_sheet(
        [[BRIARSAPLING_D0, BRIARSAPLING_D1, BRIARSAPLING_D2, BRIARSAPLING_D3],
         [BRIARSAPLING_U0, BRIARSAPLING_U1, BRIARSAPLING_U2, BRIARSAPLING_U3],
         [BRIARSAPLING_L0, BRIARSAPLING_L1, BRIARSAPLING_L2, BRIARSAPLING_L3],
         [BRIARSAPLING_R0, BRIARSAPLING_R1, BRIARSAPLING_R2, BRIARSAPLING_R3]],
        PAL_BRIARSAPLING,
        os.path.join(OUT_DIR, 'forest_briarsapling.png')
    )

    # 4. desert_sandstalker.png
    assemble_sheet(
        [[SANDSTALKER_D0, SANDSTALKER_D1, SANDSTALKER_D2, SANDSTALKER_D3],
         [SANDSTALKER_U0, SANDSTALKER_U1, SANDSTALKER_U2, SANDSTALKER_U3],
         [SANDSTALKER_L0, SANDSTALKER_L1, SANDSTALKER_L2, SANDSTALKER_L3],
         [SANDSTALKER_R0, SANDSTALKER_R1, SANDSTALKER_R2, SANDSTALKER_R3]],
        PAL_SANDSTALKER,
        os.path.join(OUT_DIR, 'desert_sandstalker.png')
    )

    # 5. frost_rimebat.png
    assemble_sheet(
        [[RIMEBAT_D0, RIMEBAT_D1, RIMEBAT_D2, RIMEBAT_D3],
         [RIMEBAT_U0, RIMEBAT_U1, RIMEBAT_U2, RIMEBAT_U3],
         [RIMEBAT_L0, RIMEBAT_L1, RIMEBAT_L2, RIMEBAT_L3],
         [RIMEBAT_R0, RIMEBAT_R1, RIMEBAT_R2, RIMEBAT_R3]],
        PAL_RIMEBAT,
        os.path.join(OUT_DIR, 'frost_rimebat.png')
    )

    # 6. hollow_abysseye.png
    assemble_sheet(
        [[ABYSSEYE_D0, ABYSSEYE_D1, ABYSSEYE_D2, ABYSSEYE_D3],
         [ABYSSEYE_U0, ABYSSEYE_U1, ABYSSEYE_U2, ABYSSEYE_U3],
         [ABYSSEYE_L0, ABYSSEYE_L1, ABYSSEYE_L2, ABYSSEYE_L3],
         [ABYSSEYE_R0, ABYSSEYE_R1, ABYSSEYE_R2, ABYSSEYE_R3]],
        PAL_ABYSSEYE,
        os.path.join(OUT_DIR, 'hollow_abysseye.png')
    )
    print("All 6 Biome Pack B monster sprite sheets generated successfully.")


if __name__ == '__main__':
    generate_all()
