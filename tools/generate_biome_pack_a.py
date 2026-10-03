#!/usr/bin/env python3
"""Biome Pack A Monster Generator — Wayfarer Online / Ninja Adventure 16-bit Pixel Art

Generates 6 brand-new, authentic 16-bit monster sprite sheets matching the Ninja Adventure aesthetic:
1. meadow_quillkin.png    - Spiky Meadow Quillkin / Hedgehog (rolling/bristling 4-direction walk cycle, warm amber/brown palette)
2. meadow_dewbeetle.png   - Iridescent Dew Beetle (snapping pincers and emerald shell)
3. forest_brambleboar.png - Feral Mosswood Bramble Boar (thorn tusks and dark mossy hide)
4. forest_treant.png      - Moss Treant / Bark Golem (branch arms and leafy top)
5. marsh_bogleech.png     - Segmented Mire Leech (pulsing maw and toxic green/brown tones)
6. marsh_mirelurker.png   - Mire Lurker (bipedal swamp fiend with glowing yellow eyes)

All sheets are strictly 64x64 RGBA PNGs (4 columns x 4 rows of 16x16 frames):
  Cols: 0 = Down, 1 = Up, 2 = Left, 3 = Right
  Rows: 0..3 = 4-frame animation cycle (walk/scuttle/stride/surge)
  100% hard alpha (0 or 255), 0 empty cells, 5-9 indexed palette colors per sheet.
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
# 1. MEADOW QUILLKIN (meadow_quillkin.png)
# Spiky Meadow Quillkin / Hedgehog with rolling/bristling 4-direction walk cycle, warm amber/brown palette
# ==============================================================================
PAL_QUILLKIN = {
    '.': None,
    'K': (20, 27, 27, 255),       # Darkest outline (#141b1b)
    'Q': (255, 214, 110, 255),    # Quill Gold highlight
    'A': (241, 174, 65, 255),     # Quill Amber mid
    'B': (184, 105, 36, 255),     # Quill Brown
    'D': (116, 56, 24, 255),      # Quill Shadow russet
    'F': (252, 226, 202, 255),    # Face & belly cream
    'N': (242, 173, 125, 255),    # Nose & snout peach
    'E': (32, 24, 24, 255),       # Eye / nose black
    'W': (255, 255, 255, 255),    # Eye spark white
    'P': (210, 140, 100, 255),    # Paw peach
}

QUILLKIN_D0 = [
    '.....KKKKK......',
    '...KKQAQAQKK....',
    '..KQABQABQAQK...',
    '.KQBDBDBDBDBQK..',
    '.KADKKKKKKKBDAK.',
    'KQAFFNFFNFFFAQK.',
    'KAFEWFEEFEWFFBK.',
    'KAFNFEFFEFFNBK..',
    'KQAFNNNNNNFFAQK.',
    '.KBDFPPPPFBDBK..',
    '.KQBDFFFFBDBQK..',
    '..KQBDDDBDBQK...',
    '...KQDDBDBQK....',
    '...KPFKKKPFK....',
    '....KK...KK.....',
    '................',
]
QUILLKIN_D1 = [
    '....KKKKKK......',
    '..KKQQAQAQAQK...',
    '.KQAQABQABQAQK..',
    '.KQBDBDBDBDBAQK.',
    'KQAFFNFFNFFFAQK.',
    'KAFEWFEEFEWFFBK.',
    'KAFNFEFFEFFNBK..',
    'KQAFNNNNNNFFAQK.',
    '.KBDFPPPPFBDBK..',
    '.KQBDFFFFBDBQK..',
    '..KQBDDDBDBQK...',
    '...KQDDBDBQK....',
    '..KPPFKK..KK....',
    '..KKKK...KPFK...',
    '..........KK....',
    '................',
]
QUILLKIN_D2 = [
    '.....KKKKK......',
    '...KKQAQAQKK....',
    '..KQABQABQAQK...',
    '.KQBDBDBDBDBQK..',
    '.KADKKKKKKKBDAK.',
    'KQAFFNFFNFFFAQK.',
    'KAFEWFEEFEWFFBK.',
    'KAFNFEFFEFFNBK..',
    'KQAFNNNNNNFFAQK.',
    '.KBDFPPPPFBDBK..',
    '.KQBDFFFFBDBQK..',
    '..KQBDDDBDBQK...',
    '...KQDDBDBQK....',
    '....KPFK.KPFK...',
    '....KK....KK....',
    '................',
]
QUILLKIN_D3 = [
    '......KKKKKK....',
    '...KQQAQAQAQKK..',
    '..KQAQABQABQAQK.',
    '.KQBDBDBDBDBAQK.',
    '.KQAFFNFFNFFFAQK',
    '.KAFEWFEEFEWFFBK',
    '..KAFNFEFFEFFNBK',
    '.KQAFNNNNNNFFAQK',
    '..KBDFPPPPFBDBK.',
    '..KQBDFFFFBDBQK.',
    '...KQBDDDBDBQK..',
    '....KQDDBDBQK...',
    '....KK..KPPFK...',
    '...KPFK..KKKK...',
    '....KK..........',
    '................',
]

QUILLKIN_U0 = [
    '.....KKKKK......',
    '...KKQAQAQKK....',
    '..KQABQABQAQK...',
    '.KQBDBDBDBDBQK..',
    'KQADBQAQAQABDAQK',
    'KABDBDBDBDBDBABK',
    'KQADBQAQAQABDAQK',
    'KABDBDBDBDBDBABK',
    'KQADBQAQAQABDAQK',
    '.KBDBDBDBDBDBDK.',
    '.KQBDQABQABDBQK.',
    '..KQBDDDBDBQK...',
    '...KQDDBDBQK....',
    '...KPFKKKPFK....',
    '....KK...KK.....',
    '................',
]
QUILLKIN_U1 = [
    '....KKKKKK......',
    '..KKQQAQAQAQK...',
    '.KQAQABQABQAQK..',
    '.KQBDBDBDBDBAQK.',
    'KQADBQAQAQABDAQK',
    'KABDBDBDBDBDBABK',
    'KQADBQAQAQABDAQK',
    'KABDBDBDBDBDBABK',
    'KQADBQAQAQABDAQK',
    '.KBDBDBDBDBDBDK.',
    '.KQBDQABQABDBQK.',
    '..KQBDDDBDBQK...',
    '...KQDDBDBQK....',
    '..KPPFKK..KK....',
    '..KKKK...KPFK...',
    '..........KK....',
]
QUILLKIN_U2 = [
    '.....KKKKK......',
    '...KKQAQAQKK....',
    '..KQABQABQAQK...',
    '.KQBDBDBDBDBQK..',
    'KQADBQAQAQABDAQK',
    'KABDBDBDBDBDBABK',
    'KQADBQAQAQABDAQK',
    'KABDBDBDBDBDBABK',
    'KQADBQAQAQABDAQK',
    '.KBDBDBDBDBDBDK.',
    '.KQBDQABQABDBQK.',
    '..KQBDDDBDBQK...',
    '...KQDDBDBQK....',
    '....KPFK.KPFK...',
    '....KK....KK....',
    '................',
]
QUILLKIN_U3 = [
    '......KKKKKK....',
    '...KQQAQAQAQKK..',
    '..KQAQABQABQAQK.',
    '.KQBDBDBDBDBAQK.',
    'KQADBQAQAQABDAQK',
    'KABDBDBDBDBDBABK',
    'KQADBQAQAQABDAQK',
    'KABDBDBDBDBDBABK',
    'KQADBQAQAQABDAQK',
    '.KBDBDBDBDBDBDK.',
    '.KQBDQABQABDBQK.',
    '..KQBDDDBDBQK...',
    '...KQDDBDBQK....',
    '....KK..KPPFK...',
    '...KPFK..KKKK...',
    '....KK..........',
]

QUILLKIN_L0 = [
    '.....KKKKKK.....',
    '...KKQAQAQAQKK..',
    '..KQABQABQABQAK.',
    '.KQBDBDBDBDBDBQK',
    'KQAFNKKKKKKDBDAQ',
    'KAFEWFNBQAQABDBK',
    'KNFEFFNBDBDBDBDK',
    'KNNNNFBQAQABDBQK',
    '.KFFFFBDBDBDBAQK',
    '..KFFFDBQAQABQK.',
    '...KFFDDBDBDBQK.',
    '....KDDDDBDBQK..',
    '....KPFKKDDBK...',
    '....KK..KPFK....',
    '.........KK.....',
    '................',
]
QUILLKIN_L1 = [
    '....KKKKKK......',
    '..KKQAQAQAQKK...',
    '.KQABQABQABQAK..',
    'KQBDBDBDBDBDBQK.',
    'KAFNKKKKKKDBDAQK',
    'KFEWFNBQAQABDBK.',
    'KNFEFFNBDBDBDBDK',
    'KNNNNFBQAQABDBQK',
    '.KFFFFBDBDBDBAQK',
    '..KFFFDBQAQABQK.',
    '...KFFDDBDBDBQK.',
    '...KPDDDDBDBQK..',
    '..KPPFKKDDBK....',
    '..KKKK..KPFK....',
    '.........KK.....',
    '................',
]
QUILLKIN_L2 = [
    '.....KKKKKK.....',
    '...KKQAQAQAQKK..',
    '..KQABQABQABQAK.',
    '.KQBDBDBDBDBDBQK',
    'KQAFNKKKKKKDBDAQ',
    'KAFEWFNBQAQABDBK',
    'KNFEFFNBDBDBDBDK',
    'KNNNNFBQAQABDBQK',
    '.KFFFFBDBDBDBAQK',
    '..KFFFDBQAQABQK.',
    '...KFFDDBDBDBQK.',
    '....KDDDDBDBQK..',
    '....KPFK.KPFK...',
    '....KK....KK....',
    '................',
    '................',
]
QUILLKIN_L3 = [
    '......KKKKKK....',
    '....KKQAQAQAQKK.',
    '...KQABQABQABQAK',
    '..KQBDBDBDBDBDBQ',
    '.KQAFNKKKKKKDBDA',
    '.KAFEWFNBQAQABDB',
    '.KNFEFFNBDBDBDBD',
    '.KNNNNFBQAQABDBQ',
    '..KFFFFBDBDBDBAQ',
    '...KFFFDBQAQABQK',
    '....KFFDDBDBDBQK',
    '....KDDDDBDBQK..',
    '....KK..KPPFK...',
    '...KPFK..KKKK...',
    '....KK..........',
    '................',
]
QUILLKIN_R0 = [r[::-1] for r in QUILLKIN_L0]
QUILLKIN_R1 = [r[::-1] for r in QUILLKIN_L1]
QUILLKIN_R2 = [r[::-1] for r in QUILLKIN_L2]
QUILLKIN_R3 = [r[::-1] for r in QUILLKIN_L3]


# ==============================================================================
# 2. MEADOW DEWBEETLE (meadow_dewbeetle.png)
# Iridescent Dew Beetle with snapping pincers and emerald shell
# ==============================================================================
PAL_DEWBEETLE = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b dark outline
    'W': (255, 255, 255, 255),    # Dewdrop white gleam
    'I': (160, 245, 215, 255),    # Iridescent emerald highlight
    'G': (36, 178, 122, 255),     # Emerald shell mid
    'D': (18, 108, 76, 255),      # Emerald shell deep
    'C': (68, 88, 98, 255),       # Chitin thorax / legs
    'S': (42, 54, 62, 255),       # Chitin dark
    'R': (235, 45, 65, 255),      # Ruby glowing eye
    'Y': (250, 215, 75, 255),     # Dew sparkle gold
}

DEWBEETLE_D0 = [
    '...KK......KK...',
    '..KSSK....KSSK..',
    '..KSCKK..KKCSK..',
    '...KSRKSSKRCSK..',
    '....KSSSSSSK....',
    '.CKKKIWWIGIKKKC.',
    'KCCKGIWWIGIGKCCK',
    'KSKGIIGIGIGIGKSK',
    '.KKGIGIGIDIGIKK.',
    'KCKSGGIDIDGGKSKC',
    'KSKSSGIDDGGSSKSK',
    '.KKSSKDDGGKSSKK.',
    'KC.KKKDDGGKKK.CK',
    'KS..KKDDGGKK..SK',
    'KK...KKKKKK...KK',
    '................',
]
DEWBEETLE_D1 = [
    '....KK....KK....',
    '...KSSK..KSSK...',
    '...KSCKKKKCSK...',
    '....KSRSSRCSK...',
    '....KSSSSSSK....',
    '.CKKKIWWIGIKKKC.',
    'KCCKGIWWIGIGKCCK',
    'KSKGIIGIGIGIGKSK',
    '.KKGIGIGIDIGIKK.',
    'KCKSGGIDIDGGKSKC',
    'KSKSSGIDDGGSSKSK',
    '.KKSSKDDGGKSSKK.',
    '..CKKKDDGGKKKC..',
    '.KS.KKDDGGKK.SK.',
    '.KK..KKKKKK..KK.',
    '................',
]
DEWBEETLE_D2 = [
    '...KK......KK...',
    '..KSSK....KSSK..',
    '..KSCKK..KKCSK..',
    '...KSRKSSKRCSK..',
    '....KSSSSSSK....',
    '.CKKKIWWIGIKKKC.',
    'KCCKGIWWIGIGKCCK',
    'KSKGIIGIGIGIGKSK',
    '.KKGIGIGIDIGIKK.',
    'KCKSGGIDIDGGKSKC',
    'KSKSSGIDDGGSSKSK',
    '.KKSSKDDGGKSSKK.',
    'KC.KKKDDGGKKK.CK',
    'KS..KKDDGGKK..SK',
    'KK...KKKKKK...KK',
    '................',
]
DEWBEETLE_D3 = [
    '.....KK..KK.....',
    '....KSSKKSSK....',
    '....KSCKKCSK....',
    '....KSRSSRCSK...',
    '....KSSSSSSK....',
    '.CKKKIWWIGIKKKC.',
    'KCCKGIWWIGIGKCCK',
    'KSKGIIGIGIGIGKSK',
    '.KKGIGIGIDIGIKK.',
    'KCKSGGIDIDGGKSKC',
    'KSKSSGIDDGGSSKSK',
    '.KKSSKDDGGKSSKK.',
    'KC..KKDDGGKK..CK',
    'KS.CKKDDGGKKC.SK',
    'KK.KKKKKKKKKK.KK',
    '................',
]

DEWBEETLE_U0 = [
    '..KK........KK..',
    '..KSSK....KSSK..',
    '...KCSK..KSCK...',
    '....KSSKKSSK....',
    '....KSSSSSSK....',
    '.CKKKIWWIGIKKKC.',
    'KCCKGIWWIGIGKCCK',
    'KSKGIIGIKIGIGKSK',
    '.KKGIGIKKIDGIKK.',
    'KCKSGGIDKKGGKSKC',
    'KSKSSGIDKKGGSSSK',
    '.KKSSKDDGGKSSKK.',
    'KC.KKKDDGGKKK.CK',
    'KS..KKDDGGKK..SK',
    'KK...KKKKKK...KK',
    '................',
]
DEWBEETLE_U1 = [
    '..KK........KK..',
    '..KSSK....KSSK..',
    '...KCSK..KSCK...',
    '....KSSKKSSK....',
    '....KSSSSSSK....',
    '.CKKKIWWIGIKKKC.',
    'KCCKGIWWIGIGKCCK',
    'KSKGIIGIKIGIGKSK',
    '.KKGIGIKKIDGIKK.',
    'KCKSGGIDKKGGKSKC',
    'KSKSSGIDKKGGSSSK',
    '.KKSSKDDGGKSSKK.',
    '..CKKKDDGGKKKC..',
    '.KS.KKDDGGKK.SK.',
    '.KK..KKKKKK..KK.',
    '................',
]
DEWBEETLE_U2 = [
    '..KK........KK..',
    '..KSSK....KSSK..',
    '...KCSK..KSCK...',
    '....KSSKKSSK....',
    '....KSSSSSSK....',
    '.CKKKIWWIGIKKKC.',
    'KCCKGIWWIGIGKCCK',
    'KSKGIIGIKIGIGKSK',
    '.KKGIGIKKIDGIKK.',
    'KCKSGGIDKKGGKSKC',
    'KSKSSGIDKKGGSSSK',
    '.KKSSKDDGGKSSKK.',
    'KC.KKKDDGGKKK.CK',
    'KS..KKDDGGKK..SK',
    'KK...KKKKKK...KK',
    '................',
]
DEWBEETLE_U3 = [
    '..KK........KK..',
    '..KSSK....KSSK..',
    '...KCSK..KSCK...',
    '....KSSKKSSK....',
    '....KSSSSSSK....',
    '.CKKKIWWIGIKKKC.',
    'KCCKGIWWIGIGKCCK',
    'KSKGIIGIKIGIGKSK',
    '.KKGIGIKKIDGIKK.',
    'KCKSGGIDKKGGKSKC',
    'KSKSSGIDKKGGSSSK',
    '.KKSSKDDGGKSSKK.',
    'KC..KKDDGGKK..CK',
    'KS.CKKDDGGKKC.SK',
    'KK.KKKKKKKKKK.KK',
    '................',
]

DEWBEETLE_L0 = [
    '..KK............',
    '.KSSK...KKKKK...',
    '.KSCKK.KSSSSSKS.',
    '..KSRKKSIWWIGIKK',
    '...KSSSSGIWWIGIK',
    '..KKSSSSGIIGIKIK',
    '.KCCKSSSGIGIDIKK',
    'KSSKSCKSGGIDIK..',
    'KK.KSSSSGIDDGGK.',
    '..KCCKSSKDDGGK..',
    '.KSSK.KKKDDGGK..',
    '.KK....KKKKKK...',
    '..KCCK..KCCK....',
    '..KSSK..KSSK....',
    '...KK....KK.....',
    '................',
]
DEWBEETLE_L1 = [
    '..KK............',
    '.KSSK...KKKKK...',
    '.KSCKK.KSSSSSKS.',
    '..KSRKKSIWWIGIKK',
    '...KSSSSGIWWIGIK',
    '..KKSSSSGIIGIKIK',
    '.KCCKSSSGIGIDIKK',
    'KSSKSCKSGGIDIK..',
    'KK.KSSSSGIDDGGK.',
    '..KCCKSSKDDGGK..',
    '.KSSK.KKKDDGGK..',
    '.KK....KKKKKK...',
    '...KCCK..KCCK...',
    '...KSSK..KSSK...',
    '....KK....KK....',
    '................',
]
DEWBEETLE_L2 = [
    '..KK............',
    '.KSSK...KKKKK...',
    '.KSCKK.KSSSSSKS.',
    '..KSRKKSIWWIGIKK',
    '...KSSSSGIWWIGIK',
    '..KKSSSSGIIGIKIK',
    '.KCCKSSSGIGIDIKK',
    'KSSKSCKSGGIDIK..',
    'KK.KSSSSGIDDGGK.',
    '..KCCKSSKDDGGK..',
    '.KSSK.KKKDDGGK..',
    '.KK....KKKKKK...',
    '..KCCK..KCCK....',
    '..KSSK..KSSK....',
    '...KK....KK.....',
    '................',
]
DEWBEETLE_L3 = [
    '..KK............',
    '.KSSK...KKKKK...',
    '.KSCKK.KSSSSSKS.',
    '..KSRKKSIWWIGIKK',
    '...KSSSSGIWWIGIK',
    '..KKSSSSGIIGIKIK',
    '.KCCKSSSGIGIDIKK',
    'KSSKSCKSGGIDIK..',
    'KK.KSSSSGIDDGGK.',
    '..KCCKSSKDDGGK..',
    '.KSSK.KKKDDGGK..',
    '.KK....KKKKKK...',
    '.KCCK....KCCK...',
    '.KSSK....KSSK...',
    '..KK......KK....',
    '................',
]
DEWBEETLE_R0 = [r[::-1] for r in DEWBEETLE_L0]
DEWBEETLE_R1 = [r[::-1] for r in DEWBEETLE_L1]
DEWBEETLE_R2 = [r[::-1] for r in DEWBEETLE_L2]
DEWBEETLE_R3 = [r[::-1] for r in DEWBEETLE_L3]


# ==============================================================================
# 3. FOREST BRAMBLEBOAR (forest_brambleboar.png)
# Feral Mosswood Boar with thorn tusks and dark mossy hide
# ==============================================================================
PAL_BRAMBLEBOAR = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b dark outline
    'H': (120, 152, 70, 255),     # Moss light / highlight
    'M': (68, 88, 52, 255),       # Moss hide mid
    'D': (38, 48, 32, 255),       # Moss hide dark shadow
    'B': (138, 88, 50, 255),      # Bramble bark brown
    'T': (88, 52, 28, 255),       # Bramble thorn dark
    'V': (245, 240, 215, 255),    # Ivory tusk tip
    'I': (195, 185, 155, 255),    # Ivory tusk base
    'R': (235, 45, 45, 255),      # Red feral eye
    'N': (155, 100, 90, 255),     # Snout pink/brown
    'S': (45, 30, 25, 255),       # Hoof dark
}

BRAMBLEBOAR_D0 = [
    '..T..T....T..T..',
    '.KBKKBT..TBKKBK.',
    '.KBHHBKKKKHBHK..',
    'KKBMHMHHMMHMHKK.',
    'KVMMDMMMMMMDMMVK',
    'KIMRDDMMMMDDRMIK',
    '.KIMMDNNNNDMMIK.',
    '.KIVMDNNNNDMVIK.',
    '..KMDMMMMMMDMK..',
    '..KMDDMMMMDDMK..',
    '..KDMDMDDMDMDK..',
    '..KDDDDDDDDDDK..',
    '..KSKMDDDDMKSK..',
    '..KSKMDDDDMKSK..',
    '..KKK......KKK..',
    '................',
]
BRAMBLEBOAR_D1 = [
    '..T..T....T..T..',
    '.KBKKBT..TBKKBK.',
    '.KBHHBKKKKHBHK..',
    'KKBMHMHHMMHMHKK.',
    'KVMMDMMMMMMDMMVK',
    'KIMRDDMMMMDDRMIK',
    '.KIMMDNNNNDMMIK.',
    '.KIVMDNNNNDMVIK.',
    '..KMDMMMMMMDMK..',
    '..KMDDMMMMDDMK..',
    '..KDMDMDDMDMDK..',
    '..KDDDDDDDDDDK..',
    '.KSSKMDDDDM.KK..',
    '.KSSKMDDDDM.KSK.',
    '.KKK........KKK.',
    '................',
]
BRAMBLEBOAR_D2 = [
    '..T..T....T..T..',
    '.KBKKBT..TBKKBK.',
    '.KBHHBKKKKHBHK..',
    'KKBMHMHHMMHMHKK.',
    'KVMMDMMMMMMDMMVK',
    'KIMRDDMMMMDDRMIK',
    '.KIMMDNNNNDMMIK.',
    '.KIVMDNNNNDMVIK.',
    '..KMDMMMMMMDMK..',
    '..KMDDMMMMDDMK..',
    '..KDMDMDDMDMDK..',
    '..KDDDDDDDDDDK..',
    '..KSKMDDDDMKSK..',
    '..KSKMDDDDMKSK..',
    '..KKK......KKK..',
    '................',
]
BRAMBLEBOAR_D3 = [
    '..T..T....T..T..',
    '.KBKKBT..TBKKBK.',
    '.KBHHBKKKKHBHK..',
    'KKBMHMHHMMHMHKK.',
    'KVMMDMMMMMMDMMVK',
    'KIMRDDMMMMDDRMIK',
    '.KIMMDNNNNDMMIK.',
    '.KIVMDNNNNDMVIK.',
    '..KMDMMMMMMDMK..',
    '..KMDDMMMMDDMK..',
    '..KDMDMDDMDMDK..',
    '..KDDDDDDDDDDK..',
    '..KK.MDDDDMKSSK.',
    '.KSK.MDDDDMKSSK.',
    '.KKK........KKK.',
    '................',
]

BRAMBLEBOAR_U0 = [
    '..T..T....T..T..',
    '.KBKKBT..TBKKBK.',
    '.KBHHBKKKKHBHK..',
    'KKBMHMHHMMHMHKK.',
    'KMDMMMMMMMMMMDMK',
    'KMDMDMDMDMDMDMDK',
    'KMDMMMMMMMMMMDMK',
    'KMDMDMDMDMDMDMDK',
    'KMDMMMMMMMMMMDMK',
    'KMDDMMMMMMMMDDMK',
    '.KDMDMDDDMDMDMK.',
    '..KDDDDDDDDDDK..',
    '..KSKMDDDDMKSK..',
    '..KSKMDDDDMKSK..',
    '..KKK......KKK..',
    '................',
]
BRAMBLEBOAR_U1 = [
    '..T..T....T..T..',
    '.KBKKBT..TBKKBK.',
    '.KBHHBKKKKHBHK..',
    'KKBMHMHHMMHMHKK.',
    'KMDMMMMMMMMMMDMK',
    'KMDMDMDMDMDMDMDK',
    'KMDMMMMMMMMMMDMK',
    'KMDMDMDMDMDMDMDK',
    'KMDMMMMMMMMMMDMK',
    'KMDDMMMMMMMMDDMK',
    '.KDMDMDDDMDMDMK.',
    '..KDDDDDDDDDDK..',
    '.KSSKMDDDDM.KK..',
    '.KSSKMDDDDM.KSK.',
    '.KKK........KKK.',
    '................',
]
BRAMBLEBOAR_U2 = [
    '..T..T....T..T..',
    '.KBKKBT..TBKKBK.',
    '.KBHHBKKKKHBHK..',
    'KKBMHMHHMMHMHKK.',
    'KMDMMMMMMMMMMDMK',
    'KMDMDMDMDMDMDMDK',
    'KMDMMMMMMMMMMDMK',
    'KMDMDMDMDMDMDMDK',
    'KMDMMMMMMMMMMDMK',
    'KMDDMMMMMMMMDDMK',
    '.KDMDMDDDMDMDMK.',
    '..KDDDDDDDDDDK..',
    '..KSKMDDDDMKSK..',
    '..KSKMDDDDMKSK..',
    '..KKK......KKK..',
    '................',
]
BRAMBLEBOAR_U3 = [
    '..T..T....T..T..',
    '.KBKKBT..TBKKBK.',
    '.KBHHBKKKKHBHK..',
    'KKBMHMHHMMHMHKK.',
    'KMDMMMMMMMMMMDMK',
    'KMDMDMDMDMDMDMDK',
    'KMDMMMMMMMMMMDMK',
    'KMDMDMDMDMDMDMDK',
    'KMDMMMMMMMMMMDMK',
    'KMDDMMMMMMMMDDMK',
    '.KDMDMDDDMDMDMK.',
    '..KDDDDDDDDDDK..',
    '..KK.MDDDDMKSSK.',
    '.KSK.MDDDDMKSSK.',
    '.KKK........KKK.',
    '................',
]

BRAMBLEBOAR_L0 = [
    '...T....T.......',
    '..TBKK.TBK......',
    '..KBHHBKBHK.....',
    '.KKBMHMHBMHKK...',
    'KIVMMDMMMMMMDMK.',
    'KVRMDDMMMMDMDMDK',
    'KIMMDNNMMMDDMDMK',
    '.KMDNNNMDMMDMDMK',
    '..KMMMMMDMMDMDMK',
    '..KMDDMMMMDDMDMK',
    '..KDMDDDDDDDDMK.',
    '..KDDDDDDDDDDDK.',
    '..KSKMDD..KSKMD.',
    '..KSKMDD..KSKMD.',
    '..KKK......KKK..',
    '................',
]
BRAMBLEBOAR_L1 = [
    '...T....T.......',
    '..TBKK.TBK......',
    '..KBHHBKBHK.....',
    '.KKBMHMHBMHKK...',
    'KIVMMDMMMMMMDMK.',
    'KVRMDDMMMMDMDMDK',
    'KIMMDNNMMMDDMDMK',
    '.KMDNNNMDMMDMDMK',
    '..KMMMMMDMMDMDMK',
    '..KMDDMMMMDDMDMK',
    '..KDMDDDDDDDDMK.',
    '..KDDDDDDDDDDDK.',
    '.KSSKMDD...KKMD.',
    '.KSSKMDD..KSKMD.',
    '.KKK......KKK...',
    '................',
]
BRAMBLEBOAR_L2 = [
    '...T....T.......',
    '..TBKK.TBK......',
    '..KBHHBKBHK.....',
    '.KKBMHMHBMHKK...',
    'KIVMMDMMMMMMDMK.',
    'KVRMDDMMMMDMDMDK',
    'KIMMDNNMMMDDMDMK',
    '.KMDNNNMDMMDMDMK',
    '..KMMMMMDMMDMDMK',
    '..KMDDMMMMDDMDMK',
    '..KDMDDDDDDDDMK.',
    '..KDDDDDDDDDDDK.',
    '..KSKMDD..KSKMD.',
    '..KSKMDD..KSKMD.',
    '..KKK......KKK..',
    '................',
]
BRAMBLEBOAR_L3 = [
    '...T....T.......',
    '..TBKK.TBK......',
    '..KBHHBKBHK.....',
    '.KKBMHMHBMHKK...',
    'KIVMMDMMMMMMDMK.',
    'KVRMDDMMMMDMDMDK',
    'KIMMDNNMMMDDMDMK',
    '.KMDNNNMDMMDMDMK',
    '..KMMMMMDMMDMDMK',
    '..KMDDMMMMDDMDMK',
    '..KDMDDDDDDDDMK.',
    '..KDDDDDDDDDDDK.',
    '..KKMDD..KSSKMD.',
    '.KSKMDD..KSSKMD.',
    '.KKK......KKK...',
    '................',
]
BRAMBLEBOAR_R0 = [r[::-1] for r in BRAMBLEBOAR_L0]
BRAMBLEBOAR_R1 = [r[::-1] for r in BRAMBLEBOAR_L1]
BRAMBLEBOAR_R2 = [r[::-1] for r in BRAMBLEBOAR_L2]
BRAMBLEBOAR_R3 = [r[::-1] for r in BRAMBLEBOAR_L3]


# ==============================================================================
# 4. FOREST TREANT (forest_treant.png)
# Moss Treant / Bark Golem with branch arms and leafy top
# ==============================================================================
PAL_TREANT = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b dark outline
    'L': (142, 195, 75, 255),     # Leaf light lime
    'G': (75, 138, 52, 255),      # Leaf mid green
    'F': (40, 78, 35, 255),       # Leaf dark forest
    'W': (168, 124, 78, 255),     # Wood grain light
    'B': (108, 72, 44, 255),      # Wood bark mid
    'D': (58, 38, 24, 255),       # Wood bark shadow
    'Y': (255, 220, 70, 255),     # Glowing eye amber/yellow
    'R': (220, 160, 40, 255),     # Glowing eye core
}

TREANT_D0 = [
    '....KKKKKKKK....',
    '..KKLLGLGLGGKK..',
    '.KLLGLGGFFGGLLK.',
    'KLLGGFFFFFFGGLLK',
    'KLFFFFFFFFFFFFLK',
    'KKKFFBDBBDBFFKKK',
    'KBKKYRBDDBRYKBKK',
    'KBKBRRBDBBRRBKBK',
    'KDKBWWBDDBWWBDKK',
    'KDKBDBBDDBDBBKK.',
    '.KKBDDBDDDBBDK..',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KBBDK..KBBDK..',
    '..KDDK....KDDK..',
    '..KKK......KKK..',
]
TREANT_D1 = [
    '....KKKKKKKK....',
    '..KKLLGLGLGGKK..',
    '.KLLGLGGFFGGLLK.',
    'KLLGGFFFFFFGGLLK',
    'KLFFFFFFFFFFFFLK',
    'KKKFFBDBBDBFFKKK',
    'KBKKYRBDDBRYKBKK',
    'KBKBRRBDBBRRBKBK',
    'KDKBWWBDDBWWBDKK',
    'KDKBDBBDDBDBBKK.',
    '.KKBDDBDDDBBDK..',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '.KBBBDK...KDDK..',
    '.KDDDK...KBBDK..',
    '.KKKK.....KKK...',
]
TREANT_D2 = [
    '....KKKKKKKK....',
    '..KKLLGLGLGGKK..',
    '.KLLGLGGFFGGLLK.',
    'KLLGGFFFFFFGGLLK',
    'KLFFFFFFFFFFFFLK',
    'KKKFFBDBBDBFFKKK',
    'KBKKYRBDDBRYKBKK',
    'KBKBRRBDBBRRBKBK',
    'KDKBWWBDDBWWBDKK',
    'KDKBDBBDDBDBBKK.',
    '.KKBDDBDDDBBDK..',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KBBDK..KBBDK..',
    '..KDDK....KDDK..',
    '..KKK......KKK..',
]
TREANT_D3 = [
    '....KKKKKKKK....',
    '..KKLLGLGLGGKK..',
    '.KLLGLGGFFGGLLK.',
    'KLLGGFFFFFFGGLLK',
    'KLFFFFFFFFFFFFLK',
    'KKKFFBDBBDBFFKKK',
    'KBKKYRBDDBRYKBKK',
    'KBKBRRBDBBRRBKBK',
    'KDKBWWBDDBWWBDKK',
    'KDKBDBBDDBDBBKK.',
    '.KKBDDBDDDBBDK..',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KDDK...KBBBDK.',
    '.KBBDK...KDDDK..',
    '..KKK.....KKKK..',
]

TREANT_U0 = [
    '....KKKKKKKK....',
    '..KKLLGLGLGGKK..',
    '.KLLGLGGFFGGLLK.',
    'KLLGGFFFFFFGGLLK',
    'KLFFFFFFFFFFFFLK',
    'KKKFFFFFFFFFFKKK',
    'KBKKFFBDBBFFKBKK',
    'KBKBDBBDDBDBBKBK',
    'KDKBWWBDDBWWBDKK',
    'KDKBDBBDDBDBBKK.',
    '.KKBDDBDDDBBDK..',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KBBDK..KBBDK..',
    '..KDDK....KDDK..',
    '..KKK......KKK..',
]
TREANT_U1 = [
    '....KKKKKKKK....',
    '..KKLLGLGLGGKK..',
    '.KLLGLGGFFGGLLK.',
    'KLLGGFFFFFFGGLLK',
    'KLFFFFFFFFFFFFLK',
    'KKKFFFFFFFFFFKKK',
    'KBKKFFBDBBFFKBKK',
    'KBKBDBBDDBDBBKBK',
    'KDKBWWBDDBWWBDKK',
    'KDKBDBBDDBDBBKK.',
    '.KKBDDBDDDBBDK..',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '.KBBBDK...KDDK..',
    '.KDDDK...KBBDK..',
    '.KKKK.....KKK...',
]
TREANT_U2 = [
    '....KKKKKKKK....',
    '..KKLLGLGLGGKK..',
    '.KLLGLGGFFGGLLK.',
    'KLLGGFFFFFFGGLLK',
    'KLFFFFFFFFFFFFLK',
    'KKKFFFFFFFFFFKKK',
    'KBKKFFBDBBFFKBKK',
    'KBKBDBBDDBDBBKBK',
    'KDKBWWBDDBWWBDKK',
    'KDKBDBBDDBDBBKK.',
    '.KKBDDBDDDBBDK..',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KBBDK..KBBDK..',
    '..KDDK....KDDK..',
    '..KKK......KKK..',
]
TREANT_U3 = [
    '....KKKKKKKK....',
    '..KKLLGLGLGGKK..',
    '.KLLGLGGFFGGLLK.',
    'KLLGGFFFFFFGGLLK',
    'KLFFFFFFFFFFFFLK',
    'KKKFFFFFFFFFFKKK',
    'KBKKFFBDBBFFKBKK',
    'KBKBDBBDDBDBBKBK',
    'KDKBWWBDDBWWBDKK',
    'KDKBDBBDDBDBBKK.',
    '.KKBDDBDDDBBDK..',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KDDK...KBBBDK.',
    '.KBBDK...KDDDK..',
    '..KKK.....KKKK..',
]

TREANT_L0 = [
    '...KKKKKKK......',
    '..KLLGLGGKK.....',
    '.KLLGGFFGLLK....',
    'KLLFFFFFGLLK....',
    'KLFFFFFFFFLK....',
    'KKFFBDBBFFKK....',
    'KKYRBDDBDBKK....',
    'KRRBDBBDBBKBK...',
    'KBWWBDDBWWBDKK..',
    'KBDBBDDBDBBDKK..',
    '.KBDDBDDDBBDK...',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KBBDK..KBBDK..',
    '..KDDK....KDDK..',
    '..KKK......KKK..',
]
TREANT_L1 = [
    '...KKKKKKK......',
    '..KLLGLGGKK.....',
    '.KLLGGFFGLLK....',
    'KLLFFFFFGLLK....',
    'KLFFFFFFFFLK....',
    'KKFFBDBBFFKK....',
    'KKYRBDDBDBKK....',
    'KRRBDBBDBBKBK...',
    'KBWWBDDBWWBDKK..',
    'KBDBBDDBDBBDKK..',
    '.KBDDBDDDBBDK...',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '.KBBBDK...KDDK..',
    '.KDDDK...KBBDK..',
    '.KKKK.....KKK...',
]
TREANT_L2 = [
    '...KKKKKKK......',
    '..KLLGLGGKK.....',
    '.KLLGGFFGLLK....',
    'KLLFFFFFGLLK....',
    'KLFFFFFFFFLK....',
    'KKFFBDBBFFKK....',
    'KKYRBDDBDBKK....',
    'KRRBDBBDBBKBK...',
    'KBWWBDDBWWBDKK..',
    'KBDBBDDBDBBDKK..',
    '.KBDDBDDDBBDK...',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KBBDK..KBBDK..',
    '..KDDK....KDDK..',
    '..KKK......KKK..',
]
TREANT_L3 = [
    '...KKKKKKK......',
    '..KLLGLGGKK.....',
    '.KLLGGFFGLLK....',
    'KLLFFFFFGLLK....',
    'KLFFFFFFFFLK....',
    'KKFFBDBBFFKK....',
    'KKYRBDDBDBKK....',
    'KRRBDBBDBBKBK...',
    'KBWWBDDBWWBDKK..',
    'KBDBBDDBDBBDKK..',
    '.KBDDBDDDBBDK...',
    '.KDBBDBBDBDBDK..',
    '..KDDDDDDDDDK...',
    '..KDDK...KBBBDK.',
    '.KBBDK...KDDDK..',
    '..KKK.....KKKK..',
]
TREANT_R0 = [r[::-1] for r in TREANT_L0]
TREANT_R1 = [r[::-1] for r in TREANT_L1]
TREANT_R2 = [r[::-1] for r in TREANT_L2]
TREANT_R3 = [r[::-1] for r in TREANT_L3]


# ==============================================================================
# 5. MARSH BOGLEECH (marsh_bogleech.png)
# Segmented Mire Leech with pulsing circular tooth-maw and toxic green nodules
# ==============================================================================
PAL_BOGLEECH = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b dark outline
    'T': (210, 245, 85, 255),     # Toxic pustule bright lime
    'G': (145, 195, 45, 255),     # Toxic nodule green
    'M': (86, 96, 58, 255),       # Sludge skin mid
    'D': (44, 52, 34, 255),       # Sludge skin dark
    'U': (122, 134, 84, 255),     # Belly olive
    'R': (165, 55, 65, 255),      # Maw sucker rim
    'H': (75, 25, 35, 255),       # Maw dark gullet
    'W': (245, 245, 230, 255),    # Maw teeth white
}

BOGLEECH_D0 = [
    '......KKKK......',
    '....KKMMMMKK....',
    '..KKMDGTTGDMMK..',
    '.KMMDGTTTTGDMK..',
    'KMDMRRRRRRRRMDMK',
    'KMDRWWRWRWWRDMDK',
    'KMRWHHHHHHHWRMDM',
    'KMRWHHHHHHHWRMDM',
    'KMDRWWRWRWWRDMDK',
    'KMDMRRRRRRRRMDMK',
    '.KMUDGGTTGGDUMK.',
    '.KMUUDDMMDDUMMK.',
    '..KMUDDMMDDUMK..',
    '...KMDDMMDMDMK..',
    '....KKDDDDDDK...',
    '......KKKKKK....',
]
BOGLEECH_D1 = [
    '......KKKK......',
    '....KKMMMMKK....',
    '..KKMDGTTGDMMK..',
    '.KMMDGTTTTGDMK..',
    'KMDMRRRRRRRRMDMK',
    'KMDRWWRWRWWRDMDK',
    'KMRWHHHHHHHWRMDM',
    'KMRWHHHHHHHWRMDM',
    'KMDRWWRWRWWRDMDK',
    'KMDMRRRRRRRRMDMK',
    '.KMUDGGTTGGDUMK.',
    '.KMUUDDMMDDUMMK.',
    '..KMUDDMMDDUMK..',
    '..KMDDMMDMDMK...',
    '..KKDDDDDDKK....',
    '...KKKKKK.......',
]
BOGLEECH_D2 = [
    '.....KKKKKK.....',
    '...KKMMMMMMKK...',
    '..KKMDGTTGDMMK..',
    '.KMMDGTTTTGDMK..',
    'KMDMRRRRRRRRMDMK',
    'KMDRWWWRWWWRDMDK',
    'KMRWHHHHHHHWRMDM',
    'KMRWHHHHHHHWRMDM',
    'KMDRWWWRWWWRDMDK',
    'KMDMRRRRRRRRMDMK',
    '.KMUDGGTTGGDUMK.',
    '.KMUUDDMMDDUMMK.',
    '..KMUDDMMDDUMK..',
    '...KMDDMMDMDMK..',
    '....KKDDDDDDK...',
    '......KKKKKK....',
]
BOGLEECH_D3 = [
    '......KKKK......',
    '....KKMMMMKK....',
    '..KKMDGTTGDMMK..',
    '.KMMDGTTTTGDMK..',
    'KMDMRRRRRRRRMDMK',
    'KMDRWWRWRWWRDMDK',
    'KMRWHHHHHHHWRMDM',
    'KMRWHHHHHHHWRMDM',
    'KMDRWWRWRWWRDMDK',
    'KMDMRRRRRRRRMDMK',
    '.KMUDGGTTGGDUMK.',
    '.KMUUDDMMDDUMMK.',
    '..KMUDDMMDDUMK..',
    '...KMDDMMDMDMK..',
    '....KKDDDDDDMK..',
    '.....KKKKKKKK...',
]

BOGLEECH_U0 = [
    '......KKKK......',
    '....KKMMMMKK....',
    '..KKMDGTTGDMMK..',
    '.KMMDGTTTTGDMK..',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    '.KMUDGGTTGGDUMK.',
    '.KMUUDDMMDDUMMK.',
    '..KMUDDMMDDUMK..',
    '...KMDDMMDMDMK..',
    '....KKDDDDDDK...',
    '......KKKKKK....',
]
BOGLEECH_U1 = [
    '......KKKK......',
    '....KKMMMMKK....',
    '..KKMDGTTGDMMK..',
    '.KMMDGTTTTGDMK..',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    '.KMUDGGTTGGDUMK.',
    '.KMUUDDMMDDUMMK.',
    '..KMUDDMMDDUMK..',
    '..KMDDMMDMDMK...',
    '..KKDDDDDDKK....',
    '...KKKKKK.......',
]
BOGLEECH_U2 = [
    '.....KKKKKK.....',
    '...KKMMMMMMKK...',
    '..KKMDGTTGDMMK..',
    '.KMMDGTTTTGDMK..',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    '.KMUDGGTTGGDUMK.',
    '.KMUUDDMMDDUMMK.',
    '..KMUDDMMDDUMK..',
    '...KMDDMMDMDMK..',
    '....KKDDDDDDK...',
    '......KKKKKK....',
]
BOGLEECH_U3 = [
    '......KKKK......',
    '....KKMMMMKK....',
    '..KKMDGTTGDMMK..',
    '.KMMDGTTTTGDMK..',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    'KMDMDGGTTGGMDMDM',
    'KMDMDDMMMMDDMDMD',
    '.KMUDGGTTGGDUMK.',
    '.KMUUDDMMDDUMMK.',
    '..KMUDDMMDDUMK..',
    '...KMDDMMDMDMK..',
    '....KKDDDDDDMK..',
    '.....KKKKKKKK...',
]

BOGLEECH_L0 = [
    '........KKKK....',
    '......KKMMMMKK..',
    '....KKMDGTTGDMMK',
    '..KKRMDGTTTTGDMM',
    '.KRRMRRRGGTTGGMD',
    'KRWWRWWRMMMMDDMD',
    'KRWHHHWRMMGGTTGM',
    'KRWHHHWRMMMMDDMD',
    'KRWWRWWRMMGGTTGM',
    '.KRRMRRRMMMMDDMD',
    '..KKRMDDMMGGTTGM',
    '...KKMMUDDMMDDMD',
    '....KKMUDDMMDDMK',
    '.....KKMDDMMDMD.',
    '......KKDDDDDDK.',
    '........KKKKKK..',
]
BOGLEECH_L1 = [
    '......KKKK......',
    '....KKMMMMKK....',
    '..KKMDGTTGDMMK..',
    'KKRMDGTTTTGDMMK.',
    'KRRMRRRGGTTGGMD.',
    'KRWWRWWRMMMMDDMD',
    'KRWHHHWRMMGGTTGM',
    'KRWHHHWRMMMMDDMD',
    'KRWWRWWRMMGGTTGM',
    'KRRMRRRMMMMDDMD.',
    'KKRMDDMMGGTTGM..',
    '.KKMMUDDMMDDMD..',
    '..KKMUDDMMDDMK..',
    '...KKMDDMMDMD...',
    '....KKDDDDDDK...',
    '......KKKKKK....',
]
BOGLEECH_L2 = [
    '........KKKK....',
    '......KKMMMMKK..',
    '....KKMDGTTGDMMK',
    '..KKRMDGTTTTGDMM',
    '.KRRMRRRGGTTGGMD',
    'KRWWRWWRMMMMDDMD',
    'KRWHHHWRMMGGTTGM',
    'KRWHHHWRMMMMDDMD',
    'KRWWRWWRMMGGTTGM',
    '.KRRMRRRMMMMDDMD',
    '..KKRMDDMMGGTTGM',
    '...KKMMUDDMMDDMD',
    '....KKMUDDMMDDMK',
    '.....KKMDDMMDMD.',
    '......KKDDDDDDK.',
    '........KKKKKK..',
]
BOGLEECH_L3 = [
    '..........KKKK..',
    '........KKMMMMKK',
    '......KKMDGTTGDM',
    '....KKRMDGTTTTGD',
    '..KKRMRRRGGTTGGM',
    '.KRWWRWWRMMMMDDM',
    '.KRWHHHWRMMGGTTG',
    '.KRWHHHWRMMMMDDM',
    '.KRWWRWWRMMGGTTG',
    '..KRRMRRRMMMMDDM',
    '...KKRMDDMMGGTTG',
    '....KKMMUDDMMDDM',
    '.....KKMUDDMMDDM',
    '......KKMDDMMDMD',
    '.......KKDDDDDDK',
    '.........KKKKKK.',
]
BOGLEECH_R0 = [r[::-1] for r in BOGLEECH_L0]
BOGLEECH_R1 = [r[::-1] for r in BOGLEECH_L1]
BOGLEECH_R2 = [r[::-1] for r in BOGLEECH_L2]
BOGLEECH_R3 = [r[::-1] for r in BOGLEECH_L3]


# ==============================================================================
# 6. MARSH MIRELURKER (marsh_mirelurker.png)
# Mire Lurker bipedal swamp fiend with glowing yellow eyes
# ==============================================================================
PAL_MIRELURKER = {
    '.': None,
    'K': (20, 27, 27, 255),       # #141b1b dark outline
    'Y': (255, 240, 50, 255),     # Glowing eye radiant yellow
    'O': (245, 185, 30, 255),     # Eye amber aura
    'A': (120, 150, 72, 255),     # Algae frond light
    'G': (68, 98, 52, 255),       # Algae frond mid
    'S': (46, 74, 78, 255),       # Swamp skin mid teal/bog
    'D': (24, 40, 44, 255),       # Swamp skin dark shadow
    'C': (140, 195, 175, 255),    # Webbed claw / horn tip
    'W': (255, 255, 255, 255),    # Eye spark white
}

MIRELURKER_D0 = [
    '....KKKKKKKK....',
    '..KKSDSASASDSKK.',
    '.KSDDSDSDSDSDDK.',
    'KSDKOYYDDKKOYYDK',
    'KSDKWYODDKKWYODK',
    'KKSDDSSDDDDSSDKK',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '..KSSDKK.KKSSDK.',
    '.KCSDK....KCSDK.',
    '.KSSK......KSSK.',
    '..KK........KK..',
]
MIRELURKER_D1 = [
    '....KKKKKKKK....',
    '..KKSDSASASDSKK.',
    '.KSDDSDSDSDSDDK.',
    'KSDKOYYDDKKOYYDK',
    'KSDKWYODDKKWYODK',
    'KKSDDSSDDDDSSDKK',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '.KCSSDKK..KKSSDK',
    '.KSSSK.....KCSDK',
    '..KKK.......KSSK',
    '.............KK.',
]
MIRELURKER_D2 = [
    '....KKKKKKKK....',
    '..KKSDSASASDSKK.',
    '.KSDDSDSDSDSDDK.',
    'KSDKOYYDDKKOYYDK',
    'KSDKWYODDKKWYODK',
    'KKSDDSSDDDDSSDKK',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '..KSSDKK.KKSSDK.',
    '.KCSDK....KCSDK.',
    '.KSSK......KSSK.',
    '..KK........KK..',
]
MIRELURKER_D3 = [
    '....KKKKKKKK....',
    '..KKSDSASASDSKK.',
    '.KSDDSDSDSDSDDK.',
    'KSDKOYYDDKKOYYDK',
    'KSDKWYODDKKWYODK',
    'KKSDDSSDDDDSSDKK',
    '..DDAGSDDSGADDKC',
    '..DDAGSDDSGADDKS',
    '.KDGGSDDSGGDSKCK',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    'KDSSKK..KKSDSSCK',
    'KDCSK.....KSSSK.',
    'KSSK.......KKK..',
    '.KK.............',
]

MIRELURKER_U0 = [
    '....KKKKKKKK....',
    '..KKSDSASASDSKK.',
    '.KSDDSDSDSDSDDK.',
    'KSDDDDDDDDDDDDDK',
    'KSDDDAGAGAGAGDDK',
    'KKSDDGGGGGGGGDKK',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '..KSSDKK.KKSSDK.',
    '.KCSDK....KCSDK.',
    '.KSSK......KSSK.',
    '..KK........KK..',
]
MIRELURKER_U1 = [
    '....KKKKKKKK....',
    '..KKSDSASASDSKK.',
    '.KSDDSDSDSDSDDK.',
    'KSDDDDDDDDDDDDDK',
    'KSDDDAGAGAGAGDDK',
    'KKSDDGGGGGGGGDKK',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '.KCSSDKK..KKSSDK',
    '.KSSSK.....KCSDK',
    '..KKK.......KSSK',
    '.............KK.',
]
MIRELURKER_U2 = [
    '....KKKKKKKK....',
    '..KKSDSASASDSKK.',
    '.KSDDSDSDSDSDDK.',
    'KSDDDDDDDDDDDDDK',
    'KSDDDAGAGAGAGDDK',
    'KKSDDGGGGGGGGDKK',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '..KSSDKK.KKSSDK.',
    '.KCSDK....KCSDK.',
    '.KSSK......KSSK.',
    '..KK........KK..',
]
MIRELURKER_U3 = [
    '....KKKKKKKK....',
    '..KKSDSASASDSKK.',
    '.KSDDSDSDSDSDDK.',
    'KSDDDDDDDDDDDDDK',
    'KSDDDAGAGAGAGDDK',
    'KKSDDGGGGGGGGDKK',
    '..DDAGSDDSGADDKC',
    '..DDAGSDDSGADDKS',
    '.KDGGSDDSGGDSKCK',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    'KDSSKK..KKSDSSCK',
    'KDCSK.....KSSSK.',
    'KSSK.......KKK..',
    '.KK.............',
]

MIRELURKER_L0 = [
    '...KKKKKKK......',
    '..KSDSASASDK....',
    '.KSDDSDSDSDDDK..',
    'KSDKWYODDDDDDDK.',
    'KKSDSSDDDDSSDKK.',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '..KSSDKK.KKSSDK.',
    '.KCSDK....KCSDK.',
    '.KSSK......KSSK.',
    '..KK........KK..',
    '................',
]
MIRELURKER_L1 = [
    '...KKKKKKK......',
    '..KSDSASASDK....',
    '.KSDDSDSDSDDDK..',
    'KSDKWYODDDDDDDK.',
    'KKSDSSDDDDSSDKK.',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '.KCSSDKK..KKSSDK',
    '.KSSSK.....KCSDK',
    '..KKK.......KSSK',
    '.............KK.',
    '................',
]
MIRELURKER_L2 = [
    '...KKKKKKK......',
    '..KSDSASASDK....',
    '.KSDDSDSDSDDDK..',
    'KSDKWYODDDDDDDK.',
    'KKSDSSDDDDSSDKK.',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '..KSSDKK.KKSSDK.',
    '.KCSDK....KCSDK.',
    '.KSSK......KSSK.',
    '..KK........KK..',
    '................',
]
MIRELURKER_L3 = [
    '...KKKKKKK......',
    '..KSDSASASDK....',
    '.KSDDSDSDSDDDK..',
    'KSDKWYODDDDDDDK.',
    'KKSDSSDDDDSSDKK.',
    'KCKDDAGSDDSGADD.',
    'KSKDDAGSDDSGADD.',
    'KCKSDGGSDDSGGDK.',
    '.KKSDSSDDDDSSDK.',
    '..KSDDSDDDSDDK..',
    '..KSDDSDDDSDDK..',
    '..KKSSDK.KCSSDKK',
    '..KCSDK...KSSSK.',
    '..KSSK.....KKK..',
    '...KK...........',
    '................',
]
MIRELURKER_R0 = [r[::-1] for r in MIRELURKER_L0]
MIRELURKER_R1 = [r[::-1] for r in MIRELURKER_L1]
MIRELURKER_R2 = [r[::-1] for r in MIRELURKER_L2]
MIRELURKER_R3 = [r[::-1] for r in MIRELURKER_L3]


def generate_all():
    print("Generating Biome Pack A Monster Sprite Sheets...")
    
    # 1. meadow_quillkin.png
    assemble_sheet(
        [[QUILLKIN_D0, QUILLKIN_D1, QUILLKIN_D2, QUILLKIN_D3],
         [QUILLKIN_U0, QUILLKIN_U1, QUILLKIN_U2, QUILLKIN_U3],
         [QUILLKIN_L0, QUILLKIN_L1, QUILLKIN_L2, QUILLKIN_L3],
         [QUILLKIN_R0, QUILLKIN_R1, QUILLKIN_R2, QUILLKIN_R3]],
        PAL_QUILLKIN,
        os.path.join(OUT_DIR, 'meadow_quillkin.png')
    )

    # 2. meadow_dewbeetle.png
    assemble_sheet(
        [[DEWBEETLE_D0, DEWBEETLE_D1, DEWBEETLE_D2, DEWBEETLE_D3],
         [DEWBEETLE_U0, DEWBEETLE_U1, DEWBEETLE_U2, DEWBEETLE_U3],
         [DEWBEETLE_L0, DEWBEETLE_L1, DEWBEETLE_L2, DEWBEETLE_L3],
         [DEWBEETLE_R0, DEWBEETLE_R1, DEWBEETLE_R2, DEWBEETLE_R3]],
        PAL_DEWBEETLE,
        os.path.join(OUT_DIR, 'meadow_dewbeetle.png')
    )

    # 3. forest_brambleboar.png
    assemble_sheet(
        [[BRAMBLEBOAR_D0, BRAMBLEBOAR_D1, BRAMBLEBOAR_D2, BRAMBLEBOAR_D3],
         [BRAMBLEBOAR_U0, BRAMBLEBOAR_U1, BRAMBLEBOAR_U2, BRAMBLEBOAR_U3],
         [BRAMBLEBOAR_L0, BRAMBLEBOAR_L1, BRAMBLEBOAR_L2, BRAMBLEBOAR_L3],
         [BRAMBLEBOAR_R0, BRAMBLEBOAR_R1, BRAMBLEBOAR_R2, BRAMBLEBOAR_R3]],
        PAL_BRAMBLEBOAR,
        os.path.join(OUT_DIR, 'forest_brambleboar.png')
    )

    # 4. forest_treant.png
    assemble_sheet(
        [[TREANT_D0, TREANT_D1, TREANT_D2, TREANT_D3],
         [TREANT_U0, TREANT_U1, TREANT_U2, TREANT_U3],
         [TREANT_L0, TREANT_L1, TREANT_L2, TREANT_L3],
         [TREANT_R0, TREANT_R1, TREANT_R2, TREANT_R3]],
        PAL_TREANT,
        os.path.join(OUT_DIR, 'forest_treant.png')
    )

    # 5. marsh_bogleech.png
    assemble_sheet(
        [[BOGLEECH_D0, BOGLEECH_D1, BOGLEECH_D2, BOGLEECH_D3],
         [BOGLEECH_U0, BOGLEECH_U1, BOGLEECH_U2, BOGLEECH_U3],
         [BOGLEECH_L0, BOGLEECH_L1, BOGLEECH_L2, BOGLEECH_L3],
         [BOGLEECH_R0, BOGLEECH_R1, BOGLEECH_R2, BOGLEECH_R3]],
        PAL_BOGLEECH,
        os.path.join(OUT_DIR, 'marsh_bogleech.png')
    )

    # 6. marsh_mirelurker.png
    assemble_sheet(
        [[MIRELURKER_D0, MIRELURKER_D1, MIRELURKER_D2, MIRELURKER_D3],
         [MIRELURKER_U0, MIRELURKER_U1, MIRELURKER_U2, MIRELURKER_U3],
         [MIRELURKER_L0, MIRELURKER_L1, MIRELURKER_L2, MIRELURKER_L3],
         [MIRELURKER_R0, MIRELURKER_R1, MIRELURKER_R2, MIRELURKER_R3]],
        PAL_MIRELURKER,
        os.path.join(OUT_DIR, 'marsh_mirelurker.png')
    )
    print("All 6 Biome Pack A monster sprite sheets generated successfully.")


if __name__ == '__main__':
    generate_all()
