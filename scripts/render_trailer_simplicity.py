import os
import sys
import math
import time
import argparse
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# -----------------------------------------------------------------------------
# Color Palette (EXACT KolView Aesthetic)
# -----------------------------------------------------------------------------
COLOR_BG = (17, 19, 21)             # #111315
COLOR_CARD = (26, 29, 31)           # #1A1D1F
COLOR_CARD_HOVER = (34, 38, 41)     # Slightly elevated card
COLOR_CARD_SUB = (34, 38, 41)       # #222629
COLOR_BORDER = (46, 50, 54)         # #2E3236
COLOR_PRIMARY = (0, 119, 255)       # #0077ff Primary Blue
COLOR_PRIMARY_DIM = (0, 70, 160)
COLOR_EMERALD = (16, 185, 129)      # #10B981 Emerald Green
COLOR_EMERALD_DIM = (10, 100, 70)
COLOR_TEXT_WHITE = (248, 248, 248)  # #F8F8F8
COLOR_TEXT_MUTED = (167, 167, 167)  # #A7A7A7
COLOR_GOLD = (245, 158, 11)         # Gold accent for #1 rank

# -----------------------------------------------------------------------------
# Fonts (Windows system fonts)
# -----------------------------------------------------------------------------
FONT_REG_PATH = "C:/Windows/Fonts/segoeui.ttf"
FONT_BOLD_PATH = "C:/Windows/Fonts/segoeuib.ttf"
FONT_SB_PATH = "C:/Windows/Fonts/seguisb.ttf"
FONT_MONO_PATH = "C:/Windows/Fonts/consola.ttf"
FONT_MONOB_PATH = "C:/Windows/Fonts/consolab.ttf"

_font_cache = {}

def get_font(path, size):
    key = (path, size)
    if key not in _font_cache:
        try:
            _font_cache[key] = ImageFont.truetype(path, size)
        except Exception:
            _font_cache[key] = ImageFont.load_default()
    return _font_cache[key]

def font_reg(size):
    return get_font(FONT_REG_PATH, size)

def font_bold(size):
    return get_font(FONT_BOLD_PATH, size)

def font_sb(size):
    return get_font(FONT_SB_PATH, size)

def font_mono(size):
    return get_font(FONT_MONO_PATH, size)

def font_monob(size):
    return get_font(FONT_MONOB_PATH, size)

# -----------------------------------------------------------------------------
# Animation Easing Utilities
# -----------------------------------------------------------------------------
def clamp(val, min_val=0.0, max_val=1.0):
    return max(min_val, min(max_val, val))

def ease_out_cubic(t):
    t = clamp(t)
    return 1.0 - (1.0 - t) ** 3

def ease_in_out_cubic(t):
    t = clamp(t)
    if t < 0.5:
        return 4.0 * t * t * t
    else:
        return 1.0 - (-2.0 * t + 2.0) ** 3 / 2.0

def ease_out_back(t, s=1.4):
    t = clamp(t)
    t -= 1.0
    return t * t * ((s + 1.0) * t + s) + 1.0

def lerp(a, b, t):
    return a + (b - a) * t

def color_lerp(c1, c2, t):
    t = clamp(t)
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t),
    )

# -----------------------------------------------------------------------------
# Vector Icon Drawing Helpers (100% reliable, no square font boxes)
# -----------------------------------------------------------------------------
def draw_x_logo(draw, cx, cy, size=24, color=COLOR_TEXT_WHITE):
    """Draws crisp geometric Twitter/X logo."""
    s = size / 2.0
    # Diagonal 1
    draw.polygon([
        (cx - s, cy - s),
        (cx - s + 4, cy - s),
        (cx + s, cy + s),
        (cx + s - 4, cy + s)
    ], fill=color)
    # Diagonal 2
    draw.polygon([
        (cx + s, cy - s),
        (cx + s - 3, cy - s),
        (cx - s, cy + s),
        (cx - s + 3, cy + s)
    ], fill=color)

def draw_telegram_logo(draw, cx, cy, size=24, color=COLOR_TEXT_WHITE):
    """Draws crisp Telegram paper airplane logo."""
    s = size / 2.0
    # Wing body
    poly_plane = [
        (cx - s, cy + s * 0.1),
        (cx + s, cy - s * 0.75),
        (cx + s * 0.35, cy + s * 0.95),
        (cx + s * 0.05, cy + s * 0.3)
    ]
    draw.polygon(poly_plane, fill=color)
    # Inner wing shadow fold
    draw.polygon([
        (cx + s * 0.05, cy + s * 0.3),
        (cx + s, cy - s * 0.75),
        (cx - s * 0.25, cy + s * 0.2)
    ], fill=color_lerp(color, (0, 0, 0), 0.3))

def draw_lightning_bolt(draw, cx, cy, size=16, color=COLOR_PRIMARY):
    """Draws sleek lightning bolt."""
    s = size / 2.0
    poly = [
        (cx + s * 0.25, cy - s),
        (cx - s * 0.7, cy + s * 0.05),
        (cx - s * 0.05, cy + s * 0.05),
        (cx - s * 0.25, cy + s),
        (cx + s * 0.7, cy - s * 0.05),
        (cx + s * 0.05, cy - s * 0.05)
    ]
    draw.polygon(poly, fill=color)

def draw_check_icon(draw, cx, cy, size=14, color=COLOR_EMERALD):
    """Draws clean checkmark icon."""
    s = size / 2.0
    draw.line([(cx - s * 0.8, cy), (cx - s * 0.1, cy + s * 0.7)], fill=color, width=2)
    draw.line([(cx - s * 0.1, cy + s * 0.7), (cx + s * 0.8, cy - s * 0.7)], fill=color, width=2)

def draw_arrow_right(draw, cx, cy, size=14, color=COLOR_TEXT_WHITE):
    """Draws sleek right-pointing arrow."""
    s = size / 2.0
    draw.line([(cx - s, cy), (cx + s * 0.6, cy)], fill=color, width=2)
    draw.polygon([(cx + s * 0.4, cy - s * 0.6), (cx + s, cy), (cx + s * 0.4, cy + s * 0.6)], fill=color)

# -----------------------------------------------------------------------------
# Base Backgrounds & Cursors
# -----------------------------------------------------------------------------
def make_base_background(width, height):
    base = Image.new("RGB", (width, height), COLOR_BG)
    draw = ImageDraw.Draw(base)
    
    # Grid dots
    grid_spacing = 48
    dot_color = (25, 28, 32)
    for x in range(grid_spacing // 2, width, grid_spacing):
        for y in range(grid_spacing // 2, height, grid_spacing):
            draw.point((x, y), fill=dot_color)
            draw.point((x + 1, y), fill=dot_color)
            
    # Soft radial ambient blue glow at top center
    glow_size = int(min(width, height) * 0.9)
    glow_img = Image.new("RGBA", (glow_size, glow_size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    cx, cy = glow_size // 2, glow_size // 2
    for r in range(cx, 0, -6):
        pct = 1.0 - r / cx
        alpha = int(22 * (pct ** 1.8))
        glow_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(0, 119, 255, alpha))
    
    gx = (width - glow_size) // 2
    gy = -glow_size // 3
    base.paste(glow_img, (gx, gy), glow_img)
    return base

def make_cursor_image():
    cur = Image.new("RGBA", (36, 44), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cur)
    # shadow
    poly_shadow = [(5, 5), (5, 33), (12, 26), (19, 39), (24, 36), (17, 23), (27, 23)]
    cd.polygon(poly_shadow, fill=(0, 0, 0, 100))
    # outer dark stroke
    poly_dark = [(3, 3), (3, 31), (10, 24), (17, 37), (22, 34), (15, 21), (25, 21)]
    cd.polygon(poly_dark, fill=(10, 10, 10, 255))
    # inner bright fill
    poly_white = [(4, 4), (4, 28), (10, 22), (16, 34), (19, 32), (13, 20), (22, 20)]
    cd.polygon(poly_white, fill=(255, 255, 255, 255))
    return cur

CURSOR_IMG = make_cursor_image()

# -----------------------------------------------------------------------------
# Step Pills
# -----------------------------------------------------------------------------
def draw_step_pills_16x9(draw, current_scene_float, center_x=960, y=42):
    steps = [
        ("01", "SEARCH WALLET"),
        ("02", "INSTANT AUDIT"),
        ("03", "CATCH THE PUMP")
    ]
    f_num = font_bold(13)
    f_txt = font_sb(13)
    
    pill_w = 175
    pill_h = 32
    gap = 14
    total_w = len(steps) * pill_w + (len(steps) - 1) * gap
    start_x = center_x - total_w // 2
    
    for i, (num, label) in enumerate(steps):
        px = start_x + i * (pill_w + gap)
        dist = abs(current_scene_float - (i + 1))
        active_t = clamp(1.0 - dist * 1.5)
        
        bg_col = color_lerp(COLOR_CARD, COLOR_PRIMARY, active_t)
        border_col = color_lerp(COLOR_BORDER, COLOR_PRIMARY, active_t)
        txt_col = color_lerp(COLOR_TEXT_MUTED, COLOR_TEXT_WHITE, active_t)
        
        draw.rounded_rectangle([px, y, px + pill_w, y + pill_h], radius=16, fill=bg_col, outline=border_col, width=1)
        draw.text((px + 14, y + 8), num, font=f_num, fill=COLOR_TEXT_WHITE if active_t > 0.4 else COLOR_TEXT_MUTED)
        draw.text((px + 38, y + 8), label, font=f_txt, fill=txt_col)

def draw_step_pills_9x16(draw, current_scene_float, center_x=540, y=170):
    steps = [
        ("01", "SEARCH"),
        ("02", "AUDIT"),
        ("03", "CATCH PUMP")
    ]
    f_num = font_bold(14)
    f_txt = font_sb(14)
    
    pill_w = 135
    pill_h = 36
    gap = 12
    total_w = len(steps) * pill_w + (len(steps) - 1) * gap
    start_x = center_x - total_w // 2
    
    for i, (num, label) in enumerate(steps):
        px = start_x + i * (pill_w + gap)
        dist = abs(current_scene_float - (i + 1))
        active_t = clamp(1.0 - dist * 1.5)
        
        bg_col = color_lerp(COLOR_CARD, COLOR_PRIMARY, active_t)
        border_col = color_lerp(COLOR_BORDER, COLOR_PRIMARY, active_t)
        txt_col = color_lerp(COLOR_TEXT_MUTED, COLOR_TEXT_WHITE, active_t)
        
        draw.rounded_rectangle([px, y, px + pill_w, y + pill_h], radius=18, fill=bg_col, outline=border_col, width=1)
        draw.text((px + 12, y + 9), num, font=f_num, fill=COLOR_TEXT_WHITE if active_t > 0.4 else COLOR_TEXT_MUTED)
        draw.text((px + 36, y + 9), label, font=f_txt, fill=txt_col)

# -----------------------------------------------------------------------------
# 16x9 Frame Renderer (1920x1080)
# -----------------------------------------------------------------------------
BASE_16X9 = make_base_background(1920, 1080)

def render_frame_16x9(frame_idx):
    t_sec = frame_idx / 60.0
    im = BASE_16X9.copy()
    draw = ImageDraw.Draw(im)
    
    # ---------------- Top Navigation Bar ----------------
    # Logo
    draw.rounded_rectangle([80, 42, 114, 74], radius=8, fill=COLOR_PRIMARY)
    draw.polygon([(97, 48), (105, 59), (97, 68), (89, 59)], fill=COLOR_TEXT_WHITE)
    draw.text((126, 44), "KOL", font=font_bold(22), fill=COLOR_TEXT_WHITE)
    bbox_k = font_bold(22).getbbox("KOL")
    draw.text((126 + bbox_k[2] - bbox_k[0] + 2, 44), "VIEW", font=font_bold(22), fill=COLOR_PRIMARY)
    draw.text((126, 68), "SOLANA ALPHA TERMINAL", font=font_bold(10), fill=COLOR_TEXT_MUTED)
    
    # Right status indicator
    pulse = 0.5 + 0.5 * math.sin(t_sec * 6.0)
    draw.ellipse([1710, 52, 1720, 62], fill=COLOR_EMERALD)
    draw.text((1728, 50), "LIVE STREAMING", font=font_bold(12), fill=COLOR_EMERALD)
    draw.rounded_rectangle([1832, 46, 1880, 68], radius=6, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
    draw.text((1840, 50), "SOL", font=font_bold(11), fill=COLOR_PRIMARY)
    
    # Scene transitions
    if frame_idx < 210:
        scene_float = 1.0
        if frame_idx > 195:
            scene_float = 1.0 + (frame_idx - 195) / 15.0
    elif frame_idx < 420:
        scene_float = 2.0
        if frame_idx > 405:
            scene_float = 2.0 + (frame_idx - 405) / 15.0
    else:
        scene_float = 3.0
        
    draw_step_pills_16x9(draw, scene_float, center_x=960, y=42)
    
    # =========================================================================
    # SCENE 1: STEP 1 (0.0s - 3.5s | f: 0 - 210)
    # =========================================================================
    if frame_idx < 210:
        h_enter = ease_out_cubic(clamp(t_sec / 0.5))
        h_y = lerp(80, 115, h_enter)
        
        # Step tag
        draw.text((960, int(h_y)), "STEP 01  //  DISCOVERY", font=font_bold(13), fill=COLOR_PRIMARY, anchor="mm")
        # Main Title
        draw.text((960, int(h_y + 30)), "Search Any Wallet or Pick From Leaderboard", font=font_bold(34), fill=COLOR_TEXT_WHITE, anchor="mm")
        # Subtitle
        draw.text((960, int(h_y + 64)), "Real-time performance tracking across 12,000+ Solana smart money traders", font=font_reg(16), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        # Search Bar
        sb_enter = ease_out_cubic(clamp((t_sec - 0.2) / 0.5))
        sb_y = lerp(175, 215, sb_enter)
        sb_box = [540, int(sb_y), 1380, int(sb_y + 54)]
        draw.rounded_rectangle(sb_box, radius=14, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        
        # Search Icon (Lens)
        draw.ellipse([562, int(sb_y + 18), 578, int(sb_y + 34)], outline=COLOR_PRIMARY, width=2)
        draw.line([574, int(sb_y + 30), 582, int(sb_y + 38)], fill=COLOR_PRIMARY, width=2)
        
        # Typing text: "SolSniper.sol" from t=0.5s to t=1.6s
        type_str = "SolSniper.sol"
        type_progress = clamp((t_sec - 0.5) / 1.1)
        chars_shown = int(len(type_str) * type_progress)
        typed_text = type_str[:chars_shown]
        
        draw.text((596, int(sb_y + 27)), typed_text, font=font_sb(18), fill=COLOR_TEXT_WHITE, anchor="lm")
        # Blinking cursor
        if int(t_sec * 3.5) % 2 == 0:
            c_bbox = font_sb(18).getbbox(typed_text)
            c_x = 596 + (c_bbox[2] - c_bbox[0] if typed_text else 0) + 2
            draw.line([c_x, int(sb_y + 16), c_x, int(sb_y + 38)], fill=COLOR_PRIMARY, width=2)
            
        # Search button
        draw.rounded_rectangle([1230, int(sb_y + 12), 1362, int(sb_y + 42)], radius=8, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
        draw.text((1296, int(sb_y + 27)), "[ ENTER SEARCH ]", font=font_sb(12), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        # Quick filter pills below search bar
        filter_y = int(sb_y + 68)
        draw.text((545, filter_y + 10), "QUICK FILTERS:", font=font_bold(11), fill=COLOR_TEXT_MUTED)
        filters = [("TOP PnL", True), ("FAST SCALPERS", False), ("HIGH CONVICTION", False), ("WHALE TRACKERS", False)]
        fx = 645
        for f_label, is_act in filters:
            bg_c = COLOR_PRIMARY if is_act else COLOR_CARD
            tx_c = COLOR_TEXT_WHITE if is_act else COLOR_TEXT_MUTED
            draw.rounded_rectangle([fx, filter_y, fx + 130, filter_y + 26], radius=13, fill=bg_c, outline=COLOR_BORDER if not is_act else COLOR_PRIMARY, width=1)
            draw.text((fx + 65, filter_y + 13), f_label, font=font_sb(11), fill=tx_c, anchor="mm")
            fx += 142
            
        # 3 Trader Cards
        cards_data = [
            {
                "rank": "#1",
                "name": "0xSun.sol",
                "addr": "7xKt...9pQr",
                "winrate": "91.2%",
                "pnl": "+$418,200",
                "roi": "+340.5%",
                "top": "$BONK / $WIF",
                "tag": "WHALE TRADER"
            },
            {
                "rank": "#2",
                "name": "SolSniper.sol",
                "addr": "5q9e...X4mW",
                "winrate": "84.2%",
                "pnl": "+$294,120",
                "roi": "+215.4%",
                "top": "$AI16Z / $GRIFFA",
                "tag": "SMART MONEY"
            },
            {
                "rank": "#3",
                "name": "AlphaChad.sol",
                "addr": "9y2P...Lm7x",
                "winrate": "78.6%",
                "pnl": "+$182,400",
                "roi": "+148.0%",
                "top": "$POPCAT / $ACT",
                "tag": "EARLY SCALPER"
            }
        ]
        
        cur_active = t_sec >= 1.6
        c_progress = clamp((t_sec - 1.6) / 1.0)
        c_ease = ease_out_cubic(c_progress)
        cur_x = lerp(1550, 960, c_ease)
        cur_y = lerp(980, 580, c_ease)
        is_clicked = frame_idx >= 171
        click_flash = clamp(1.0 - (frame_idx - 171) / 30.0) if is_clicked else 0.0
            
        card_base_y = 350
        card_h = 490
        
        for i, cd in enumerate(cards_data):
            c_delay = 0.4 + i * 0.12
            c_enter = ease_out_back(clamp((t_sec - c_delay) / 0.55))
            c_y = lerp(900, card_base_y, c_enter)
            
            cx1 = 160 + i * 550
            cx2 = cx1 + 500
            
            is_c2 = (i == 1)
            scale_offset = 0
            border_c = COLOR_BORDER
            border_w = 1
            fill_c = COLOR_CARD
            
            if is_c2 and is_clicked:
                scale_offset = int(6 * ease_out_cubic(click_flash))
                border_c = color_lerp(COLOR_PRIMARY, (100, 200, 255), click_flash)
                border_w = 2 + int(2 * click_flash)
                fill_c = color_lerp(COLOR_CARD, COLOR_CARD_HOVER, 0.5)
                
            box = [cx1 - scale_offset, int(c_y) - scale_offset, cx2 + scale_offset, int(c_y + card_h) + scale_offset]
            draw.rounded_rectangle(box, radius=18, fill=fill_c, outline=border_c, width=border_w)
            
            # Rank badge
            rank_bg = COLOR_GOLD if i == 0 else (COLOR_PRIMARY if i == 1 else COLOR_CARD_SUB)
            draw.rounded_rectangle([box[0] + 24, box[1] + 24, box[0] + 68, box[1] + 62], radius=10, fill=rank_bg)
            draw.text((box[0] + 46, box[1] + 43), cd["rank"], font=font_bold(16), fill=COLOR_TEXT_WHITE, anchor="mm")
            
            # Avatar & Name
            draw.text((box[0] + 82, box[1] + 34), cd["name"], font=font_bold(20), fill=COLOR_TEXT_WHITE)
            draw.text((box[0] + 82, box[1] + 58), cd["addr"], font=font_mono(12), fill=COLOR_TEXT_MUTED)
            
            # Tag pill top right
            draw.rounded_rectangle([box[2] - 140, box[1] + 26, box[2] - 24, box[1] + 52], radius=8, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
            draw.text((box[2] - 82, box[1] + 39), cd["tag"], font=font_bold(10), fill=COLOR_PRIMARY if is_c2 else COLOR_TEXT_MUTED, anchor="mm")
            
            # Divider line
            draw.line([box[0] + 24, box[1] + 84, box[2] - 24, box[1] + 84], fill=COLOR_BORDER, width=1)
            
            # Big Metric: 7D Realized PnL
            draw.text((box[0] + 28, box[1] + 104), "7D REALIZED PROFIT", font=font_bold(11), fill=COLOR_TEXT_MUTED)
            draw.text((box[0] + 28, box[1] + 138), cd["pnl"], font=font_bold(34), fill=COLOR_EMERALD)
            draw.text((box[0] + 240, box[1] + 144), cd["roi"], font=font_bold(16), fill=COLOR_EMERALD)
            
            # Win-rate Section Box
            m_box = [box[0] + 24, box[1] + 190, box[2] - 24, box[1] + 280]
            draw.rounded_rectangle(m_box, radius=12, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
            draw.text((m_box[0] + 20, m_box[1] + 22), "WIN-RATE (30D)", font=font_bold(11), fill=COLOR_TEXT_MUTED)
            draw.text((m_box[0] + 20, m_box[1] + 54), cd["winrate"], font=font_bold(26), fill=COLOR_EMERALD)
            
            # Progress bar for winrate
            pb_x = m_box[0] + 150
            pb_w = m_box[2] - pb_x - 20
            pb_y = m_box[1] + 46
            draw.rounded_rectangle([pb_x, pb_y, pb_x + pb_w, pb_y + 10], radius=5, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
            win_pct = float(cd["winrate"].replace("%", "")) / 100.0
            draw.rounded_rectangle([pb_x, pb_y, pb_x + int(pb_w * win_pct), pb_y + 10], radius=5, fill=COLOR_EMERALD)
            draw.text((pb_x, pb_y + 18), "HIGH CONVICTION", font=font_bold(10), fill=COLOR_TEXT_MUTED)
            
            # Top trades
            t_box = [box[0] + 24, box[1] + 296, box[2] - 24, box[1] + 376]
            draw.rounded_rectangle(t_box, radius=12, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
            draw.text((t_box[0] + 20, t_box[1] + 20), "TOP PERFORMING PLAYS", font=font_bold(11), fill=COLOR_TEXT_MUTED)
            draw.text((t_box[0] + 20, t_box[1] + 48), cd["top"], font=font_sb(16), fill=COLOR_TEXT_WHITE)
            
            # Action button at card bottom
            btn_box = [box[0] + 24, box[1] + 398, box[2] - 24, box[1] + 458]
            btn_bg = COLOR_PRIMARY if is_c2 else COLOR_CARD_SUB
            btn_border = COLOR_PRIMARY if is_c2 else COLOR_BORDER
            draw.rounded_rectangle(btn_box, radius=12, fill=btn_bg, outline=btn_border, width=1)
            
            bx_mid = (btn_box[0] + btn_box[2]) // 2
            by_mid = (btn_box[1] + btn_box[3]) // 2
            if not (is_c2 and is_clicked):
                draw_arrow_right(draw, bx_mid - 65, by_mid, size=12, color=COLOR_TEXT_WHITE)
                draw.text((bx_mid - 45, by_mid), "AUDIT WALLET", font=font_bold(14), fill=COLOR_TEXT_WHITE, anchor="lm")
            else:
                draw_lightning_bolt(draw, bx_mid - 78, by_mid, size=16, color=COLOR_TEXT_WHITE)
                draw.text((bx_mid - 55, by_mid), "AUDITING WALLET...", font=font_bold(14), fill=COLOR_TEXT_WHITE, anchor="lm")
            
        # Draw animated cursor
        if cur_active and frame_idx < 195:
            im.paste(CURSOR_IMG, (int(cur_x), int(cur_y)), CURSOR_IMG)
            if is_clicked:
                ripple_r = int((frame_idx - 171) * 3.5)
                if ripple_r < 80:
                    r_alpha = int(255 * (1.0 - ripple_r / 80.0))
                    r_img = Image.new("RGBA", (ripple_r * 2 + 4, ripple_r * 2 + 4), (0,0,0,0))
                    r_draw = ImageDraw.Draw(r_img)
                    r_draw.ellipse([2, 2, ripple_r * 2 + 2, ripple_r * 2 + 2], outline=(0, 119, 255, r_alpha), width=2)
                    im.paste(r_img, (int(cur_x) - ripple_r, int(cur_y) - ripple_r), r_img)

    # =========================================================================
    # SCENE 2: STEP 2 (3.5s - 7.0s | f: 210 - 420)
    # =========================================================================
    elif frame_idx < 420:
        s2_frame = frame_idx - 210
        s2_t = s2_frame / 210.0
        
        # Header enter
        h_enter = ease_out_cubic(clamp(s2_t / 0.15))
        h_y = lerp(80, 115, h_enter)
        
        draw.text((960, int(h_y)), "STEP 02  //  ON-CHAIN AUDIT", font=font_bold(13), fill=COLOR_PRIMARY, anchor="mm")
        draw.text((960, int(h_y + 30)), "Instant On-Chain Audit", font=font_bold(34), fill=COLOR_TEXT_WHITE, anchor="mm")
        draw.text((960, int(h_y + 64)), "100% verified Solana transaction history, realized PnL & live token holdings", font=font_reg(16), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        # Profile header pill
        prof_y = 205
        prof_box = [520, prof_y, 1400, prof_y + 48]
        draw.rounded_rectangle(prof_box, radius=24, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        
        # Avatar
        draw.ellipse([536, prof_y + 10, 564, prof_y + 38], fill=COLOR_PRIMARY)
        draw.text((550, prof_y + 24), "S", font=font_bold(14), fill=COLOR_TEXT_WHITE, anchor="mm")
        draw.text((576, prof_y + 24), "SolSniper.sol", font=font_bold(16), fill=COLOR_TEXT_WHITE, anchor="lm")
        draw.text((700, prof_y + 24), "5q9e...X4mW", font=font_mono(13), fill=COLOR_TEXT_MUTED, anchor="lm")
        
        # Audited pill
        draw.rounded_rectangle([860, prof_y + 10, 1070, prof_y + 38], radius=8, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
        draw_check_icon(draw, 880, prof_y + 24, size=12, color=COLOR_EMERALD)
        draw.text((975, prof_y + 24), "AUDITED BY KOLVIEW", font=font_bold(11), fill=COLOR_EMERALD, anchor="mm")
        
        draw.rounded_rectangle([1084, prof_y + 10, 1260, prof_y + 38], radius=8, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
        draw.text((1172, prof_y + 24), "SOLANA MAINNET", font=font_bold(11), fill=COLOR_PRIMARY, anchor="mm")
        
        draw.ellipse([1285, prof_y + 20, 1293, prof_y + 28], fill=COLOR_EMERALD)
        draw.text((1302, prof_y + 24), "LIVE SYNC", font=font_bold(11), fill=COLOR_EMERALD, anchor="lm")
        
        count_t = ease_out_cubic(clamp(s2_t / 0.35))
        
        # Card A: SOL Balance
        ca_box = [160, 275, 880, 440]
        draw.rounded_rectangle(ca_box, radius=16, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((ca_box[0] + 28, ca_box[1] + 26), "TOTAL SOL BALANCE", font=font_bold(12), fill=COLOR_TEXT_MUTED)
        
        sol_val = count_t * 1452.8
        draw.text((ca_box[0] + 28, ca_box[1] + 62), f"{sol_val:,.1f} SOL", font=font_bold(38), fill=COLOR_TEXT_WHITE)
        usd_val = sol_val * 150.4
        draw.text((ca_box[0] + 360, ca_box[1] + 74), f"~ ${usd_val:,.0f} USD", font=font_sb(18), fill=COLOR_TEXT_MUTED)
        
        draw.rounded_rectangle([ca_box[0] + 28, ca_box[1] + 116, ca_box[0] + 250, ca_box[1] + 144], radius=6, fill=COLOR_CARD_SUB)
        draw.text((ca_box[0] + 38, ca_box[1] + 130), "+48.5 SOL (24h Net Flow)", font=font_bold(11), fill=COLOR_EMERALD, anchor="lm")
        
        # Card B: WIN-RATE
        cb_box = [160, 460, 880, 645]
        draw.rounded_rectangle(cb_box, radius=16, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((cb_box[0] + 28, cb_box[1] + 24), "HISTORICAL WIN-RATE (30-DAY AUDIT)", font=font_bold(12), fill=COLOR_TEXT_MUTED)
        
        wr_val = count_t * 84.2
        draw.text((cb_box[0] + 28, cb_box[1] + 62), f"{wr_val:.1f}%", font=font_bold(44), fill=COLOR_EMERALD)
        
        gw = 360
        gx = cb_box[0] + 240
        gy = cb_box[1] + 72
        draw.rounded_rectangle([gx, gy, gx + gw, gy + 16], radius=8, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
        fill_gw = int(gw * (wr_val / 100.0))
        draw.rounded_rectangle([gx, gy, gx + fill_gw, gy + 16], radius=8, fill=COLOR_EMERALD)
        
        draw.text((cb_box[0] + 28, cb_box[1] + 138), "142 Wins / 26 Losses  •  0 Rugpulls  •  Average Hold: 4.2 Hours", font=font_sb(14), fill=COLOR_TEXT_WHITE)
        
        # Card C: 7D REALIZED PnL
        cc_box = [160, 665, 880, 850]
        draw.rounded_rectangle(cc_box, radius=16, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((cc_box[0] + 28, cc_box[1] + 24), "7D REALIZED PROFIT & LOSS", font=font_bold(12), fill=COLOR_TEXT_MUTED)
        
        pnl_num = count_t * 294120.5
        draw.text((cc_box[0] + 28, cc_box[1] + 62), f"+${pnl_num:,.2f}", font=font_bold(42), fill=COLOR_EMERALD)
        
        draw.rounded_rectangle([cc_box[0] + 28, cc_box[1] + 132, cc_box[0] + 200, cc_box[1] + 164], radius=6, fill=COLOR_CARD_SUB)
        draw.text((cc_box[0] + 40, cc_box[1] + 148), "+215.4% ROI", font=font_bold(13), fill=COLOR_EMERALD, anchor="lm")
        draw.text((cc_box[0] + 220, cc_box[1] + 148), "Verified by On-Chain Solana RPC Signatures", font=font_sb(13), fill=COLOR_TEXT_MUTED, anchor="lm")
        
        # Right Column: Chart & Holdings
        ch_box = [920, 275, 1760, 535]
        draw.rounded_rectangle(ch_box, radius=16, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((ch_box[0] + 28, ch_box[1] + 24), "CUMULATIVE PnL GROWTH (7-DAY TRAJECTORY)", font=font_bold(12), fill=COLOR_TEXT_MUTED)
        draw.text((ch_box[2] - 28, ch_box[1] + 24), "PEAK: +$294,120", font=font_bold(12), fill=COLOR_EMERALD, anchor="rm")
        
        chart_pts = [
            (0.0, 0.15), (0.12, 0.18), (0.22, 0.32), (0.35, 0.28),
            (0.48, 0.52), (0.62, 0.48), (0.75, 0.78), (0.88, 0.85), (1.0, 0.96)
        ]
        cx_start = ch_box[0] + 40
        cx_w = (ch_box[2] - ch_box[0]) - 80
        cy_base = ch_box[1] + 215
        cy_h = 135
        
        chart_draw_t = ease_out_cubic(clamp(s2_t / 0.5))
        drawn_pixels = []
        for (px, py) in chart_pts:
            if px <= chart_draw_t:
                cur_x = cx_start + px * cx_w
                cur_y = cy_base - py * cy_h
                drawn_pixels.append((cur_x, cur_y))
                
        if len(drawn_pixels) >= 2:
            poly = [(drawn_pixels[0][0], cy_base)] + drawn_pixels + [(drawn_pixels[-1][0], cy_base)]
            chart_layer = Image.new("RGBA", (1920, 1080), (0,0,0,0))
            cl_draw = ImageDraw.Draw(chart_layer)
            cl_draw.polygon(poly, fill=(16, 185, 129, 35))
            for j in range(len(drawn_pixels) - 1):
                cl_draw.line([drawn_pixels[j], drawn_pixels[j+1]], fill=(16, 185, 129, 255), width=3)
            last_p = drawn_pixels[-1]
            cl_draw.ellipse([last_p[0]-6, last_p[1]-6, last_p[0]+6, last_p[1]+6], fill=(255, 255, 255, 255))
            cl_draw.ellipse([last_p[0]-10, last_p[1]-10, last_p[0]+10, last_p[1]+10], outline=(16, 185, 129, 180), width=2)
            im.paste(chart_layer, (0,0), chart_layer)
            
        # Live Holdings Table
        ht_box = [920, 555, 1760, 850]
        draw.rounded_rectangle(ht_box, radius=16, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((ht_box[0] + 28, ht_box[1] + 24), "LIVE ACTIVE HOLDINGS (TOP 3 POSITIONS)", font=font_bold(12), fill=COLOR_TEXT_MUTED)
        draw.text((ht_box[2] - 28, ht_box[1] + 24), "TOTAL UNREALIZED: +$114,750", font=font_bold(12), fill=COLOR_EMERALD, anchor="rm")
        
        th_y = ht_box[1] + 62
        draw.text((ht_box[0] + 28, th_y), "ASSET", font=font_bold(11), fill=COLOR_TEXT_MUTED)
        draw.text((ht_box[0] + 190, th_y), "ENTRY", font=font_bold(11), fill=COLOR_TEXT_MUTED)
        draw.text((ht_box[0] + 320, th_y), "CURRENT", font=font_bold(11), fill=COLOR_TEXT_MUTED)
        draw.text((ht_box[0] + 470, th_y), "UNREALIZED PnL", font=font_bold(11), fill=COLOR_TEXT_MUTED)
        draw.text((ht_box[2] - 28, th_y), "HOLDING SIZE", font=font_bold(11), fill=COLOR_TEXT_MUTED, anchor="rm")
        draw.line([ht_box[0] + 24, th_y + 18, ht_box[2] - 24, th_y + 18], fill=COLOR_BORDER, width=1)
        
        holdings = [
            {"sym": "$AI16Z", "entry": "$0.082", "cur": "$0.361", "pnl": "+340.2%", "amt": "+$64,200", "size": "180.0 SOL"},
            {"sym": "$GRIFFA", "entry": "$0.014", "cur": "$0.039", "pnl": "+185.0%", "amt": "+$32,150", "size": "95.0 SOL"},
            {"sym": "$ACT", "entry": "$0.190", "cur": "$0.365", "pnl": "+92.4%", "amt": "+$18,400", "size": "60.0 SOL"},
        ]
        
        row_y = th_y + 36
        for r_i, h in enumerate(holdings):
            draw.text((ht_box[0] + 28, row_y), h["sym"], font=font_bold(16), fill=COLOR_TEXT_WHITE)
            draw.text((ht_box[0] + 190, row_y), h["entry"], font=font_mono(14), fill=COLOR_TEXT_MUTED)
            draw.text((ht_box[0] + 320, row_y), h["cur"], font=font_mono(14), fill=COLOR_TEXT_WHITE)
            draw.text((ht_box[0] + 470, row_y), f"{h['pnl']} ({h['amt']})", font=font_bold(14), fill=COLOR_EMERALD)
            draw.text((ht_box[2] - 28, row_y), h["size"], font=font_bold(14), fill=COLOR_PRIMARY, anchor="rm")
            if r_i < 2:
                draw.line([ht_box[0] + 24, row_y + 28, ht_box[2] - 24, row_y + 28], fill=COLOR_BORDER, width=1)
            row_y += 48
            
        # Alert banner
        if frame_idx >= 370:
            al_t = ease_out_back(clamp((frame_idx - 370) / 25.0))
            al_y = lerp(1100, 890, al_t)
            al_box = [420, int(al_y), 1500, int(al_y + 76)]
            draw.rounded_rectangle(al_box, radius=16, fill=(15, 30, 48), outline=COLOR_PRIMARY, width=2)
            draw_lightning_bolt(draw, 455, int(al_y + 38), size=24, color=COLOR_PRIMARY)
            draw.text((490, int(al_y + 26)), "REAL-TIME ALPHA DETECTED: SolSniper bought 120 SOL of $ALPHA at $0.0024", font=font_bold(16), fill=COLOR_TEXT_WHITE, anchor="lm")
            draw.text((490, int(al_y + 50)), "0.4s block latency  •  Simulating 10x copy-trade route", font=font_sb(12), fill=COLOR_TEXT_MUTED, anchor="lm")

    # =========================================================================
    # SCENE 3: STEP 3 (7.0s - 10.0s | f: 420 - 600)
    # =========================================================================
    else:
        s3_frame = frame_idx - 420
        s3_t = s3_frame / 180.0
        
        h_enter = ease_out_cubic(clamp(s3_t / 0.15))
        h_y = lerp(80, 115, h_enter)
        
        draw.text((960, int(h_y)), "STEP 03  //  ALPHA EXECUTION", font=font_bold(13), fill=COLOR_PRIMARY, anchor="mm")
        draw.text((960, int(h_y + 30)), "Catch The Moves Before They Pump", font=font_bold(34), fill=COLOR_TEXT_WHITE, anchor="mm")
        draw.text((960, int(h_y + 64)), "Direct on-chain signals & copy-trading intelligence before tokens trend", font=font_reg(16), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        # 1. Real-time Alert Card
        card1_enter = ease_out_cubic(clamp(s3_t / 0.2))
        c1_y = lerp(270, 215, card1_enter)
        c1_box = [380, int(c1_y), 1540, int(c1_y + 170)]
        draw.rounded_rectangle(c1_box, radius=18, fill=COLOR_CARD, outline=COLOR_PRIMARY, width=2)
        
        draw.ellipse([c1_box[0] + 32, c1_box[1] + 28, c1_box[0] + 46, c1_box[1] + 42], fill=COLOR_PRIMARY)
        draw.text((c1_box[0] + 56, c1_box[1] + 35), "ON-CHAIN ALPHA ALERT  •  0.3s EXECUTION", font=font_bold(13), fill=COLOR_PRIMARY, anchor="lm")
        draw.rounded_rectangle([c1_box[2] - 160, c1_box[1] + 24, c1_box[2] - 32, c1_box[1] + 48], radius=8, fill=COLOR_CARD_SUB)
        draw.text((c1_box[2] - 96, c1_box[1] + 36), "CONFIDENCE: 99.4%", font=font_bold(10), fill=COLOR_EMERALD, anchor="mm")
        
        draw.text((c1_box[0] + 32, c1_box[1] + 80), "SolSniper swapped 120 SOL for $ALPHA at $0.0024", font=font_bold(26), fill=COLOR_TEXT_WHITE)
        draw.text((c1_box[0] + 32, c1_box[1] + 128), "Initial Market Cap: $180K  ->  Target: $2.5M+  |  Front-run Raydium & DexScreener trending", font=font_sb(15), fill=COLOR_TEXT_MUTED)
        
        # 2. Big KolView Brand Centerpiece
        c2_box = [380, 415, 1540, 635]
        draw.rounded_rectangle(c2_box, radius=18, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        
        logo_y = c2_box[1] + 65
        draw.rounded_rectangle([805, logo_y - 28, 855, logo_y + 22], radius=10, fill=COLOR_PRIMARY)
        draw.polygon([(830, logo_y - 18), (843, logo_y - 2), (830, logo_y + 12), (817, logo_y - 2)], fill=COLOR_TEXT_WHITE)
        
        draw.text((875, logo_y - 4), "KOL", font=font_bold(44), fill=COLOR_TEXT_WHITE, anchor="lm")
        bbox_kl = font_bold(44).getbbox("KOL")
        draw.text((875 + bbox_kl[2] - bbox_kl[0] + 4, logo_y - 4), "VIEW", font=font_bold(44), fill=COLOR_PRIMARY, anchor="lm")
        
        draw.text((960, c2_box[1] + 125), "The Ultimate Solana Intelligence Terminal", font=font_bold(18), fill=COLOR_TEXT_WHITE, anchor="mm")
        
        # Feature tags with custom icons
        tags = [
            ("Track 12,000+ Wallets", "lightning"),
            ("Spot 100x Pumps Early", "star"),
            ("100% On-Chain Verified", "check"),
            ("Anti-Rug Filters Active", "shield")
        ]
        tx_start = 450
        for tag_text, icon_type in tags:
            tag_box = [tx_start, c2_box[1] + 158, tx_start + 230, c2_box[1] + 192]
            draw.rounded_rectangle(tag_box, radius=17, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
            # icon
            if icon_type == "lightning":
                draw_lightning_bolt(draw, tx_start + 20, c2_box[1] + 175, size=12, color=COLOR_PRIMARY)
            elif icon_type == "check":
                draw_check_icon(draw, tx_start + 20, c2_box[1] + 175, size=11, color=COLOR_EMERALD)
            else:
                draw.ellipse([tx_start + 16, c2_box[1] + 171, tx_start + 24, c2_box[1] + 179], fill=COLOR_PRIMARY)
            draw.text((tx_start + 36, c2_box[1] + 175), tag_text, font=font_sb(11), fill=COLOR_TEXT_MUTED, anchor="lm")
            tx_start += 250
            
        # 3. Socials Card (Explicit instruction: ONLY socials shown: 𝕏 @kolview • ✈ t.me/kolview)
        c3_box = [380, 665, 1540, 761]
        draw.rounded_rectangle(c3_box, radius=18, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        
        # Clean custom vector rendering for X and Telegram
        draw_x_logo(draw, 750, 713, size=24, color=COLOR_TEXT_WHITE)
        draw.text((772, 713), "@kolview", font=font_bold(26), fill=COLOR_TEXT_WHITE, anchor="lm")
        
        # Bullet separator
        draw.ellipse([956, 709, 964, 717], fill=COLOR_TEXT_MUTED)
        
        # Telegram logo + text
        draw_telegram_logo(draw, 1070, 713, size=24, color=COLOR_TEXT_WHITE)
        draw.text((1094, 713), "t.me/kolview", font=font_bold(26), fill=COLOR_TEXT_WHITE, anchor="lm")
        
        # 4. Contract Address Card
        c4_box = [380, 785, 1540, 920]
        pulse_ca = 0.5 + 0.5 * math.sin(t_sec * 4.0)
        ca_border = color_lerp(COLOR_PRIMARY, (100, 200, 255), pulse_ca * 0.5)
        draw.rounded_rectangle(c4_box, radius=18, fill=COLOR_CARD, outline=ca_border, width=2)
        
        draw.text((960, 816), "OFFICIAL TOKEN CONTRACT ADDRESS (CA)", font=font_bold(12), fill=COLOR_TEXT_MUTED, anchor="mm")
        ca_str = "DvSax2Keab1potZiyrkiKdSpnmJMv6u1Z4hkqjQjpump"
        draw.text((960, 856), ca_str, font=font_monob(23), fill=COLOR_TEXT_WHITE, anchor="mm")
        
        # Verified badge pill
        draw.rounded_rectangle([860, 882, 1060, 906], radius=6, fill=COLOR_CARD_SUB)
        draw_check_icon(draw, 876, 894, size=11, color=COLOR_EMERALD)
        draw.text((970, 894), "VERIFIED SOLANA MINT", font=font_bold(10), fill=COLOR_EMERALD, anchor="mm")

    return im

# -----------------------------------------------------------------------------
# 9x16 Frame Renderer (1080x1920)
# -----------------------------------------------------------------------------
BASE_9X16 = make_base_background(1080, 1920)

def render_frame_9x16(frame_idx):
    t_sec = frame_idx / 60.0
    im = BASE_9X16.copy()
    draw = ImageDraw.Draw(im)
    
    # ---------------- Top Navigation Bar ----------------
    draw.rounded_rectangle([80, 80, 118, 118], radius=8, fill=COLOR_PRIMARY)
    draw.polygon([(99, 87), (108, 99), (99, 110), (90, 99)], fill=COLOR_TEXT_WHITE)
    draw.text((132, 84), "KOL", font=font_bold(24), fill=COLOR_TEXT_WHITE)
    bbox_k = font_bold(24).getbbox("KOL")
    draw.text((132 + bbox_k[2] - bbox_k[0] + 2, 84), "VIEW", font=font_bold(24), fill=COLOR_PRIMARY)
    draw.text((132, 112), "SOLANA ALPHA TERMINAL", font=font_bold(11), fill=COLOR_TEXT_MUTED)
    
    draw.ellipse([920, 95, 932, 107], fill=COLOR_EMERALD)
    draw.text((940, 93), "LIVE", font=font_bold(13), fill=COLOR_EMERALD)
    draw.rounded_rectangle([980, 88, 1020, 114], radius=6, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
    draw.text((987, 93), "SOL", font=font_bold(11), fill=COLOR_PRIMARY)
    
    if frame_idx < 210:
        scene_float = 1.0
        if frame_idx > 195:
            scene_float = 1.0 + (frame_idx - 195) / 15.0
    elif frame_idx < 420:
        scene_float = 2.0
        if frame_idx > 405:
            scene_float = 2.0 + (frame_idx - 405) / 15.0
    else:
        scene_float = 3.0
        
    draw_step_pills_9x16(draw, scene_float, center_x=540, y=170)
    
    # =========================================================================
    # SCENE 1: STEP 1 (0.0s - 3.5s | f: 0 - 210)
    # =========================================================================
    if frame_idx < 210:
        h_enter = ease_out_cubic(clamp(t_sec / 0.5))
        h_y = lerp(210, 255, h_enter)
        
        draw.text((540, int(h_y)), "STEP 01  //  DISCOVERY", font=font_bold(14), fill=COLOR_PRIMARY, anchor="mm")
        draw.text((540, int(h_y + 40)), "Search Any Wallet\nor Pick From Leaderboard", font=font_bold(38), fill=COLOR_TEXT_WHITE, anchor="mm")
        draw.text((540, int(h_y + 104)), "Track the top 1% smart money traders on Solana", font=font_reg(18), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        # Search Box
        sb_box = [80, 410, 1000, 480]
        draw.rounded_rectangle(sb_box, radius=16, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        
        draw.ellipse([110, 432, 130, 452], outline=COLOR_PRIMARY, width=2)
        draw.line([125, 447, 135, 457], fill=COLOR_PRIMARY, width=2)
        
        type_str = "SolSniper.sol"
        type_progress = clamp((t_sec - 0.5) / 1.1)
        chars_shown = int(len(type_str) * type_progress)
        typed_text = type_str[:chars_shown]
        
        draw.text((152, 445), typed_text, font=font_sb(22), fill=COLOR_TEXT_WHITE, anchor="lm")
        if int(t_sec * 3.5) % 2 == 0:
            c_bbox = font_sb(22).getbbox(typed_text)
            c_x = 152 + (c_bbox[2] - c_bbox[0] if typed_text else 0) + 2
            draw.line([c_x, 430, c_x, 460], fill=COLOR_PRIMARY, width=2)
            
        draw.rounded_rectangle([850, 424, 980, 466], radius=8, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
        draw.text((915, 445), "Search", font=font_bold(14), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        # Filter pills below search
        draw.text((85, 508), "FILTERS:", font=font_bold(12), fill=COLOR_TEXT_MUTED)
        f_x = 165
        for flabel, is_a in [("TOP PnL", True), ("FAST SCALPERS", False), ("SMART MONEY", False)]:
            bg_c = COLOR_PRIMARY if is_a else COLOR_CARD
            tx_c = COLOR_TEXT_WHITE if is_a else COLOR_TEXT_MUTED
            draw.rounded_rectangle([f_x, 498, f_x + 130, 528], radius=15, fill=bg_c, outline=COLOR_BORDER if not is_a else COLOR_PRIMARY, width=1)
            draw.text((f_x + 65, 513), flabel, font=font_sb(11), fill=tx_c, anchor="mm")
            f_x += 142
            
        # 3 Leaderboard Cards
        cards_data = [
            {
                "rank": "#1",
                "name": "0xSun.sol",
                "addr": "7xKt...9pQr",
                "winrate": "91.2%",
                "pnl": "+$418,200",
                "roi": "+340%",
                "top": "$BONK"
            },
            {
                "rank": "#2",
                "name": "SolSniper.sol",
                "addr": "5q9e...X4mW",
                "winrate": "84.2%",
                "pnl": "+$294,120",
                "roi": "+215%",
                "top": "$AI16Z"
            },
            {
                "rank": "#3",
                "name": "AlphaChad.sol",
                "addr": "9y2P...Lm7x",
                "winrate": "78.6%",
                "pnl": "+$182,400",
                "roi": "+148%",
                "top": "$POPCAT"
            }
        ]
        
        cur_active = t_sec >= 1.6
        c_progress = clamp((t_sec - 1.6) / 1.0)
        c_ease = ease_out_cubic(c_progress)
        cur_x = lerp(850, 540, c_ease)
        cur_y = lerp(1600, 1000, c_ease)
        is_clicked = frame_idx >= 171
        click_flash = clamp(1.0 - (frame_idx - 171) / 30.0) if is_clicked else 0.0
        
        y_positions = [560, 860, 1190]
        h_sizes = [270, 300, 270]
        
        for i, cd in enumerate(cards_data):
            c_y = y_positions[i]
            c_h = h_sizes[i]
            is_c2 = (i == 1)
            
            border_c = COLOR_BORDER
            border_w = 1
            fill_c = COLOR_CARD
            scale_offset = 0
            if is_c2 and is_clicked:
                scale_offset = int(6 * ease_out_cubic(click_flash))
                border_c = color_lerp(COLOR_PRIMARY, (100, 200, 255), click_flash)
                border_w = 3
                fill_c = color_lerp(COLOR_CARD, COLOR_CARD_HOVER, 0.5)
                
            box = [80 - scale_offset, c_y - scale_offset, 1000 + scale_offset, c_y + c_h + scale_offset]
            draw.rounded_rectangle(box, radius=18, fill=fill_c, outline=border_c, width=border_w)
            
            rank_bg = COLOR_GOLD if i == 0 else (COLOR_PRIMARY if i == 1 else COLOR_CARD_SUB)
            draw.rounded_rectangle([box[0] + 24, box[1] + 24, box[0] + 72, box[1] + 68], radius=10, fill=rank_bg)
            draw.text((box[0] + 48, box[1] + 46), cd["rank"], font=font_bold(18), fill=COLOR_TEXT_WHITE, anchor="mm")
            
            draw.text((box[0] + 90, box[1] + 36), cd["name"], font=font_bold(22), fill=COLOR_TEXT_WHITE)
            draw.text((box[0] + 90, box[1] + 64), cd["addr"], font=font_mono(14), fill=COLOR_TEXT_MUTED)
            
            draw.rounded_rectangle([box[2] - 160, box[1] + 24, box[2] - 24, box[1] + 58], radius=8, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
            draw.text((box[2] - 92, box[1] + 41), "7D PnL", font=font_bold(11), fill=COLOR_TEXT_MUTED, anchor="mm")
            
            draw.text((box[0] + 28, box[1] + 115), cd["pnl"], font=font_bold(38), fill=COLOR_EMERALD)
            draw.text((box[0] + 320, box[1] + 124), cd["roi"], font=font_bold(18), fill=COLOR_EMERALD)
            
            draw.rounded_rectangle([box[0] + 24, box[1] + 175, box[2] - 24, box[1] + 235], radius=10, fill=COLOR_CARD_SUB)
            draw.text((box[0] + 44, box[1] + 205), f"WIN-RATE: {cd['winrate']}", font=font_bold(16), fill=COLOR_EMERALD, anchor="lm")
            draw.text((box[2] - 44, box[1] + 205), f"TOP PLAY: {cd['top']}", font=font_bold(14), fill=COLOR_TEXT_WHITE, anchor="rm")
            
            if is_c2:
                btn_txt = "AUDIT WALLET" if not is_clicked else "AUDITING ON-CHAIN..."
                bx_mid = (box[0] + box[2]) // 2
                by_mid = box[1] + 268
                if not is_clicked:
                    draw_arrow_right(draw, bx_mid - 75, by_mid, size=12, color=COLOR_PRIMARY)
                    draw.text((bx_mid - 55, by_mid), btn_txt, font=font_bold(15), fill=COLOR_PRIMARY, anchor="lm")
                else:
                    draw_lightning_bolt(draw, bx_mid - 85, by_mid, size=16, color=COLOR_TEXT_WHITE)
                    draw.text((bx_mid - 65, by_mid), btn_txt, font=font_bold(15), fill=COLOR_TEXT_WHITE, anchor="lm")
                
        # Draw Cursor
        if cur_active and frame_idx < 195:
            im.paste(CURSOR_IMG, (int(cur_x), int(cur_y)), CURSOR_IMG)
            if is_clicked:
                ripple_r = int((frame_idx - 171) * 3.5)
                if ripple_r < 90:
                    r_alpha = int(255 * (1.0 - ripple_r / 90.0))
                    r_img = Image.new("RGBA", (ripple_r * 2 + 4, ripple_r * 2 + 4), (0,0,0,0))
                    r_draw = ImageDraw.Draw(r_img)
                    r_draw.ellipse([2, 2, ripple_r * 2 + 2, ripple_r * 2 + 2], outline=(0, 119, 255, r_alpha), width=3)
                    im.paste(r_img, (int(cur_x) - ripple_r, int(cur_y) - ripple_r), r_img)

    # =========================================================================
    # SCENE 2: STEP 2 (3.5s - 7.0s | f: 210 - 420)
    # =========================================================================
    elif frame_idx < 420:
        s2_frame = frame_idx - 210
        s2_t = s2_frame / 210.0
        
        h_enter = ease_out_cubic(clamp(s2_t / 0.15))
        h_y = lerp(210, 255, h_enter)
        
        draw.text((540, int(h_y)), "STEP 02  //  ON-CHAIN AUDIT", font=font_bold(14), fill=COLOR_PRIMARY, anchor="mm")
        draw.text((540, int(h_y + 40)), "Instant On-Chain Audit", font=font_bold(38), fill=COLOR_TEXT_WHITE, anchor="mm")
        draw.text((540, int(h_y + 82)), "SolSniper.sol (5q9e...X4mW) • 100% Verified", font=font_reg(18), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        count_t = ease_out_cubic(clamp(s2_t / 0.35))
        
        # Card 1: SOL BALANCE
        c1_box = [80, 375, 1000, 550]
        draw.rounded_rectangle(c1_box, radius=18, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((c1_box[0] + 28, c1_box[1] + 26), "TOTAL SOL BALANCE", font=font_bold(13), fill=COLOR_TEXT_MUTED)
        sol_val = count_t * 1452.8
        draw.text((c1_box[0] + 28, c1_box[1] + 66), f"{sol_val:,.1f} SOL", font=font_bold(44), fill=COLOR_TEXT_WHITE)
        usd_val = sol_val * 150.4
        draw.text((c1_box[0] + 360, c1_box[1] + 78), f"~ ${usd_val:,.0f} USD", font=font_sb(20), fill=COLOR_TEXT_MUTED)
        draw.text((c1_box[0] + 28, c1_box[1] + 132), "+48.5 SOL (last 24h net flow)", font=font_bold(14), fill=COLOR_EMERALD)
        
        # Card 2: WIN-RATE
        c2_box = [80, 575, 1000, 780]
        draw.rounded_rectangle(c2_box, radius=18, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((c2_box[0] + 28, c2_box[1] + 24), "WIN-RATE (30-DAY ON-CHAIN)", font=font_bold(13), fill=COLOR_TEXT_MUTED)
        wr_val = count_t * 84.2
        draw.text((c2_box[0] + 28, c2_box[1] + 64), f"{wr_val:.1f}%", font=font_bold(50), fill=COLOR_EMERALD)
        
        gw = 460
        gx = c2_box[0] + 240
        gy = c2_box[1] + 78
        draw.rounded_rectangle([gx, gy, gx + gw, gy + 18], radius=9, fill=COLOR_CARD_SUB, outline=COLOR_BORDER, width=1)
        fill_gw = int(gw * (wr_val / 100.0))
        draw.rounded_rectangle([gx, gy, gx + fill_gw, gy + 18], radius=9, fill=COLOR_EMERALD)
        draw.text((c2_box[0] + 28, c2_box[1] + 152), "142 Wins / 26 Losses  •  0 Rugpulls  •  Avg Hold: 4.2h", font=font_sb(16), fill=COLOR_TEXT_WHITE)
        
        # Card 3: 7D REALIZED PnL
        c3_box = [80, 805, 1000, 1010]
        draw.rounded_rectangle(c3_box, radius=18, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((c3_box[0] + 28, c3_box[1] + 24), "7D REALIZED PROFIT & LOSS", font=font_bold(13), fill=COLOR_TEXT_MUTED)
        pnl_num = count_t * 294120.5
        draw.text((c3_box[0] + 28, c3_box[1] + 64), f"+${pnl_num:,.2f}", font=font_bold(46), fill=COLOR_EMERALD)
        draw.text((c3_box[0] + 28, c3_box[1] + 152), "+215.4% ROI on Capital  •  48 Trades Audited", font=font_bold(16), fill=COLOR_EMERALD)
        
        # Card 4: LIVE HOLDINGS
        c4_box = [80, 1035, 1000, 1575]
        draw.rounded_rectangle(c4_box, radius=18, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        draw.text((c4_box[0] + 28, c4_box[1] + 28), "LIVE ACTIVE POSITIONS (3 TOKENS)", font=font_bold(14), fill=COLOR_TEXT_MUTED)
        draw.text((c4_box[2] - 28, c4_box[1] + 28), "+$114,750 UNREALIZED", font=font_bold(14), fill=COLOR_EMERALD, anchor="rm")
        
        holdings = [
            {"sym": "$AI16Z", "entry": "$0.082", "cur": "$0.361", "pnl": "+340.2%", "amt": "+$64,200", "size": "180.0 SOL"},
            {"sym": "$GRIFFA", "entry": "$0.014", "cur": "$0.039", "pnl": "+185.0%", "amt": "+$32,150", "size": "95.0 SOL"},
            {"sym": "$ACT", "entry": "$0.190", "cur": "$0.365", "pnl": "+92.4%", "amt": "+$18,400", "size": "60.0 SOL"},
        ]
        
        h_y = c4_box[1] + 80
        for hi, h in enumerate(holdings):
            draw.rounded_rectangle([c4_box[0] + 20, h_y, c4_box[2] - 20, h_y + 130], radius=12, fill=COLOR_CARD_SUB)
            draw.text((c4_box[0] + 40, h_y + 24), h["sym"], font=font_bold(22), fill=COLOR_TEXT_WHITE)
            draw.text((c4_box[0] + 40, h_y + 60), f"Entry: {h['entry']} -> {h['cur']}", font=font_mono(14), fill=COLOR_TEXT_MUTED)
            draw.text((c4_box[0] + 40, h_y + 92), f"Position Size: {h['size']}", font=font_bold(14), fill=COLOR_PRIMARY)
            
            draw.text((c4_box[2] - 40, h_y + 36), h["pnl"], font=font_bold(26), fill=COLOR_EMERALD, anchor="rm")
            draw.text((c4_box[2] - 40, h_y + 76), f"({h['amt']})", font=font_bold(16), fill=COLOR_EMERALD, anchor="rm")
            h_y += 148
            
        # Alert banner
        if frame_idx >= 370:
            al_t = ease_out_back(clamp((frame_idx - 370) / 25.0))
            al_y = lerp(1750, 1610, al_t)
            al_box = [80, int(al_y), 1000, int(al_y + 110)]
            draw.rounded_rectangle(al_box, radius=18, fill=(15, 30, 48), outline=COLOR_PRIMARY, width=2)
            draw_lightning_bolt(draw, 120, int(al_y + 55), size=28, color=COLOR_PRIMARY)
            draw.text((160, int(al_y + 40)), "NEW ACCUMULATION: SolSniper bought $ALPHA", font=font_bold(18), fill=COLOR_TEXT_WHITE, anchor="lm")
            draw.text((160, int(al_y + 74)), "120 SOL swap at $0.0024  •  0.4s block latency", font=font_sb(14), fill=COLOR_TEXT_MUTED, anchor="lm")

    # =========================================================================
    # SCENE 3: STEP 3 (7.0s - 10.0s | f: 420 - 600)
    # =========================================================================
    else:
        s3_frame = frame_idx - 420
        s3_t = s3_frame / 180.0
        
        h_enter = ease_out_cubic(clamp(s3_t / 0.15))
        h_y = lerp(210, 255, h_enter)
        
        draw.text((540, int(h_y)), "STEP 03  //  ALPHA EXECUTION", font=font_bold(14), fill=COLOR_PRIMARY, anchor="mm")
        draw.text((540, int(h_y + 44)), "Catch The Moves\nBefore They Pump", font=font_bold(42), fill=COLOR_TEXT_WHITE, anchor="mm")
        draw.text((540, int(h_y + 114)), "Direct copy-trading signals before tokens trend", font=font_reg(18), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        # 1. Alert Card (Y: 430, H: 230, X: 80 to 1000)
        c1_box = [80, 430, 1000, 660]
        draw.rounded_rectangle(c1_box, radius=18, fill=COLOR_CARD, outline=COLOR_PRIMARY, width=2)
        draw.ellipse([c1_box[0] + 32, c1_box[1] + 28, c1_box[0] + 46, c1_box[1] + 42], fill=COLOR_PRIMARY)
        draw.text((c1_box[0] + 56, c1_box[1] + 35), "ON-CHAIN ALPHA ALERT  •  0.3s LATENCY", font=font_bold(13), fill=COLOR_PRIMARY, anchor="lm")
        draw.text((c1_box[0] + 32, c1_box[1] + 92), "SolSniper swapped 120 SOL for $ALPHA", font=font_bold(26), fill=COLOR_TEXT_WHITE)
        draw.text((c1_box[0] + 32, c1_box[1] + 138), "Price: $0.0024  •  Initial MC: $180K -> Target: $2.5M+", font=font_sb(16), fill=COLOR_TEXT_MUTED)
        draw.text((c1_box[0] + 32, c1_box[1] + 184), "Signal Confidence: 99.4%  •  Raydium Liquidity Locked", font=font_bold(15), fill=COLOR_EMERALD)
        
        # 2. KolView Brand Showcase (Y: 690, H: 410, X: 80 to 1000)
        c2_box = [80, 690, 1000, 1100]
        draw.rounded_rectangle(c2_box, radius=18, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        
        logo_y = c2_box[1] + 95
        draw.rounded_rectangle([420, logo_y - 36, 476, logo_y + 20], radius=12, fill=COLOR_PRIMARY)
        draw.polygon([(448, logo_y - 25), (462, logo_y - 8), (448, logo_y + 9), (434, logo_y - 8)], fill=COLOR_TEXT_WHITE)
        
        draw.text((495, logo_y - 8), "KOL", font=font_bold(54), fill=COLOR_TEXT_WHITE, anchor="lm")
        bbox_kl = font_bold(54).getbbox("KOL")
        draw.text((495 + bbox_kl[2] - bbox_kl[0] + 4, logo_y - 8), "VIEW", font=font_bold(54), fill=COLOR_PRIMARY, anchor="lm")
        
        draw.text((540, c2_box[1] + 180), "The Ultimate Solana Intelligence Terminal", font=font_bold(23), fill=COLOR_TEXT_WHITE, anchor="mm")
        draw.text((540, c2_box[1] + 242), "Track Wallets  •  Copy Signals  •  Front-run Trends", font=font_sb(18), fill=COLOR_TEXT_MUTED, anchor="mm")
        
        draw.rounded_rectangle([180, c2_box[1] + 300, 480, c2_box[1] + 355], radius=12, fill=COLOR_CARD_SUB)
        draw_lightning_bolt(draw, 220, c2_box[1] + 327, size=15, color=COLOR_PRIMARY)
        draw.text((345, c2_box[1] + 327), "12,000+ WALLETS", font=font_bold(14), fill=COLOR_PRIMARY, anchor="mm")
        
        draw.rounded_rectangle([520, c2_box[1] + 300, 820, c2_box[1] + 355], radius=12, fill=COLOR_CARD_SUB)
        draw_check_icon(draw, 560, c2_box[1] + 327, size=15, color=COLOR_EMERALD)
        draw.text((685, c2_box[1] + 327), "100% ON-CHAIN", font=font_bold(14), fill=COLOR_EMERALD, anchor="mm")
        
        # 3. Socials Card (Y: 1130, H: 160, X: 80 to 1000)
        c3_box = [80, 1130, 1000, 1290]
        draw.rounded_rectangle(c3_box, radius=18, fill=COLOR_CARD, outline=COLOR_BORDER, width=1)
        
        draw_x_logo(draw, 280, 1210, size=30, color=COLOR_TEXT_WHITE)
        draw.text((310, 1210), "@kolview", font=font_bold(30), fill=COLOR_TEXT_WHITE, anchor="lm")
        
        draw.ellipse([536, 1206, 544, 1214], fill=COLOR_TEXT_MUTED)
        
        draw_telegram_logo(draw, 630, 1210, size=30, color=COLOR_TEXT_WHITE)
        draw.text((660, 1210), "t.me/kolview", font=font_bold(30), fill=COLOR_TEXT_WHITE, anchor="lm")
        
        # 4. Contract Address Card (Y: 1320, H: 270, X: 80 to 1000)
        c4_box = [80, 1320, 1000, 1590]
        pulse_ca = 0.5 + 0.5 * math.sin(t_sec * 4.0)
        ca_border = color_lerp(COLOR_PRIMARY, (100, 200, 255), pulse_ca * 0.5)
        draw.rounded_rectangle(c4_box, radius=18, fill=COLOR_CARD, outline=ca_border, width=2)
        
        draw.text((540, 1365), "OFFICIAL TOKEN CONTRACT ADDRESS (CA)", font=font_bold(14), fill=COLOR_TEXT_MUTED, anchor="mm")
        ca_str = "DvSax2Keab1potZiyrkiKdSpnmJMv6u1Z4hkqjQjpump"
        draw.text((540, 1425), ca_str, font=font_monob(22), fill=COLOR_TEXT_WHITE, anchor="mm")
        
        draw.rounded_rectangle([390, 1485, 690, 1530], radius=8, fill=COLOR_CARD_SUB)
        draw_check_icon(draw, 415, 1507, size=14, color=COLOR_EMERALD)
        draw.text((550, 1507), "VERIFIED SOLANA MAINNET", font=font_bold(13), fill=COLOR_EMERALD, anchor="mm")

    return im

# -----------------------------------------------------------------------------
# Video Encoding Loop with ffmpeg pipe
# -----------------------------------------------------------------------------
def render_video(render_fn, out_path, width, height, total_frames=600, fps=60):
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        out_path
    ]
    
    print(f"\n=======================================================")
    print(f"Starting Video Render: {out_path}")
    print(f"Resolution: {width}x{height} | FPS: {fps} | Frames: {total_frames}")
    print(f"=======================================================")
    
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    
    start_time = time.time()
    for f in range(total_frames):
        im = render_fn(f)
        proc.stdin.write(im.tobytes())
        
        if (f + 1) % 60 == 0 or f == total_frames - 1:
            elapsed = time.time() - start_time
            cur_fps = (f + 1) / max(0.001, elapsed)
            eta = (total_frames - (f + 1)) / max(0.001, cur_fps)
            pct = ((f + 1) / total_frames) * 100.0
            print(f"[{pct:5.1f}%] Frame {f + 1:3d}/{total_frames} | Speed: {cur_fps:5.1f} fps | ETA: {eta:4.1f}s")
            
    proc.stdin.close()
    proc.wait()
    
    if proc.returncode != 0:
        err = proc.stderr.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ffmpeg error (code {proc.returncode}):\n{err}")
        
    total_time = time.time() - start_time
    file_size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"SUCCESS: Rendered {out_path} ({file_size_mb:.2f} MB) in {total_time:.2f}s")

# -----------------------------------------------------------------------------
# Main CLI & Dispatcher
# -----------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Render KolView Simplicity DeFi Trailer")
    parser.add_argument("--preview", action="store_true", help="Export preview snapshot frames as PNG")
    parser.add_argument("--video-16x9", action="store_true", help="Render 16x9 video only")
    parser.add_argument("--video-9x16", action="store_true", help="Render 9x16 video only")
    args = parser.parse_args()
    
    out_16x9 = os.path.abspath("public/promo/kolview-easy-alpha-16x9.mp4")
    out_9x16 = os.path.abspath("public/promo/kolview-easy-alpha-9x16.mp4")
    
    if args.preview:
        preview_dir = os.path.abspath("public/promo/preview")
        os.makedirs(preview_dir, exist_ok=True)
        sample_frames = [
            (90, "scene1"),
            (180, "scene1_click"),
            (290, "scene2_stats"),
            (380, "scene2_alert"),
            (500, "scene3_finale"),
        ]
        print(f"Generating preview frames in {preview_dir}...")
        for fid, name in sample_frames:
            im16 = render_frame_16x9(fid)
            im16.save(os.path.join(preview_dir, f"16x9_{name}.png"))
            im9 = render_frame_9x16(fid)
            im9.save(os.path.join(preview_dir, f"9x16_{name}.png"))
        print("Previews generated successfully.")
        return
        
    render_both = not (args.video_16x9 or args.video_9x16)
    
    if render_both or args.video_16x9:
        render_video(render_frame_16x9, out_16x9, 1920, 1080, total_frames=600, fps=60)
        
    if render_both or args.video_9x16:
        render_video(render_frame_9x16, out_9x16, 1080, 1920, total_frames=600, fps=60)
        
    print("\nAll trailer videos rendered successfully!")

if __name__ == "__main__":
    main()
