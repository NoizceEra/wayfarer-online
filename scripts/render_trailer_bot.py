#!/usr/bin/env python3
"""
KolView Bot Promo Video Generator
Renders high-quality, sleek 60fps DeFi trailers for KolView Easy Bot tracking.
Outputs:
  - public/promo/kolview-easy-bot-16x9.mp4 (1920x1080, 60fps, 8s)
  - public/promo/kolview-easy-bot-9x16.mp4 (1080x1920, 60fps, 8s)
"""

import os
import sys
import math
import time
import subprocess
from PIL import Image, ImageDraw, ImageFont

# Brand Palette (Exact KolView Specs)
BG_COLOR = (17, 19, 21)          # #111315
CARD_BG = (26, 29, 31)           # #1A1D1F
CARD_BORDER = (46, 50, 54)       # #2E3236
PRIMARY_BLUE = (0, 119, 255)     # #0077ff
TELEGRAM_BLUE = (34, 158, 217)   # #229ED9
EMERALD_GREEN = (16, 185, 129)   # #10B981
TEXT_WHITE = (248, 248, 248)     # #F8F8F8
TEXT_MUTED = (167, 167, 167)     # #A7A7A7

# Supplemental UI Accents
CARD_BG_ELEVATED = (33, 37, 41)
CARD_BG_DARK = (20, 23, 25)
USER_BUBBLE_BG = (22, 44, 70)
USER_BUBBLE_BORDER = (35, 75, 120)

CONTRACT_ADDRESS = "DvSax2Keab1potZiyrkiKdSpnmJMv6u1Z4hkqjQjpump"

FPS = 60
TOTAL_DURATION = 8.0
TOTAL_FRAMES = int(FPS * TOTAL_DURATION)  # 480 frames

# Scene Boundaries (8 seconds total)
S1_END = int(2.8 * FPS)  # 168
S2_END = int(5.5 * FPS)  # 330
S3_END = TOTAL_FRAMES    # 480

FONTS = {}
def get_font(name="segoeuib", size=24):
    key = (name, size)
    if key not in FONTS:
        path = f"C:/Windows/Fonts/{name}.ttf"
        try:
            FONTS[key] = ImageFont.truetype(path, size)
        except Exception:
            try:
                FONTS[key] = ImageFont.truetype("arial.ttf", size)
            except Exception:
                FONTS[key] = ImageFont.load_default()
    return FONTS[key]

def ease_out_cubic(t):
    t = max(0.0, min(1.0, t))
    return 1.0 - (1.0 - t) ** 3

def ease_in_cubic(t):
    t = max(0.0, min(1.0, t))
    return t ** 3

def ease_out_back(t, s=1.35):
    t = max(0.0, min(1.0, t))
    return 1.0 + (s + 1.0) * ((t - 1.0) ** 3) + s * ((t - 1.0) ** 2)

def clamp(v, mn=0.0, mx=1.0):
    return max(mn, min(mx, v))

# --- Vector Drawing Primitives ---

def draw_paper_airplane(draw, cx, cy, size, color):
    s = size / 2.0
    pts = [
        (cx + s * 0.9, cy - s * 0.8),
        (cx - s * 0.85, cy - s * 0.1),
        (cx - s * 0.1, cy + s * 0.25),
        (cx + s * 0.9, cy - s * 0.8),
    ]
    draw.polygon(pts, fill=color)
    draw.polygon([
        (cx - s * 0.1, cy + s * 0.25),
        (cx - s * 0.05, cy + s * 0.85),
        (cx + s * 0.25, cy + s * 0.45)
    ], fill=(int(color[0] * 0.72), int(color[1] * 0.72), int(color[2] * 0.72)))
    draw.polygon([
        (cx - s * 0.1, cy + s * 0.25),
        (cx + s * 0.25, cy + s * 0.45),
        (cx + s * 0.9, cy - s * 0.8)
    ], fill=(int(color[0] * 0.88), int(color[1] * 0.88), int(color[2] * 0.88)))

def draw_x_logo(draw, cx, cy, size, color):
    s = size / 2.0
    w = max(2, int(size * 0.16))
    draw.line([(cx - s * 0.8, cy - s * 0.8), (cx + s * 0.8, cy + s * 0.8)], fill=color, width=w)
    draw.line([(cx + s * 0.8, cy - s * 0.8), (cx - s * 0.8, cy + s * 0.8)], fill=color, width=w)

def draw_verified_shield(draw, cx, cy, size, bg_color=EMERALD_GREEN, check_color=TEXT_WHITE):
    s = size / 2.0
    pts = [
        (cx - s * 0.85, cy - s * 0.8),
        (cx + s * 0.85, cy - s * 0.8),
        (cx + s * 0.85, cy + s * 0.1),
        (cx, cy + s * 0.95),
        (cx - s * 0.85, cy + s * 0.1),
    ]
    draw.polygon(pts, fill=bg_color)
    cw = max(2, int(size * 0.12))
    check_pts = [
        (cx - s * 0.45, cy),
        (cx - s * 0.1, cy + s * 0.35),
        (cx + s * 0.45, cy - s * 0.35)
    ]
    draw.line(check_pts, fill=check_color, width=cw, joint="curve")

def draw_lightning(draw, cx, cy, size, color):
    s = size / 2.0
    pts = [
        (cx - s * 0.2, cy - s * 0.9),
        (cx + s * 0.7, cy - s * 0.9),
        (cx + s * 0.1, cy - s * 0.1),
        (cx + s * 0.7, cy - s * 0.1),
        (cx - s * 0.6, cy + s * 0.9),
        (cx - s * 0.1, cy + s * 0.1),
        (cx - s * 0.7, cy + s * 0.1),
    ]
    draw.polygon(pts, fill=color)

def draw_single_check(draw, cx, cy, size, color):
    s = size / 2.0
    w = max(2, int(size * 0.16))
    pts = [(cx - s * 0.6, cy), (cx - s * 0.1, cy + s * 0.5), (cx + s * 0.6, cy - s * 0.5)]
    draw.line(pts, fill=color, width=w, joint="curve")

def draw_double_checks(draw, cx, cy, size, color):
    s = size / 2.0
    w = max(2, int(size * 0.15))
    draw.line([(cx - s * 0.8, cy), (cx - s * 0.3, cy + s * 0.5), (cx + s * 0.3, cy - s * 0.5)], fill=color, width=w, joint="curve")
    draw.line([(cx - s * 0.3, cy), (cx + s * 0.2, cy + s * 0.5), (cx + s * 0.8, cy - s * 0.5)], fill=color, width=w, joint="curve")

def draw_chart_icon(draw, cx, cy, size, color):
    s = size / 2.0
    w = max(2, int(size * 0.18))
    draw.line([(cx - s * 0.6, cy + s * 0.6), (cx - s * 0.6, cy - s * 0.1)], fill=color, width=w)
    draw.line([(cx - s * 0.1, cy + s * 0.6), (cx - s * 0.1, cy - s * 0.6)], fill=color, width=w)
    draw.line([(cx + s * 0.4, cy + s * 0.6), (cx + s * 0.4, cy + s * 0.1)], fill=color, width=w)

def draw_arrow_right(draw, cx, cy, size, color):
    s = size / 2.0
    w = max(2, int(size * 0.16))
    draw.line([(cx - s * 0.7, cy), (cx + s * 0.6, cy)], fill=color, width=w)
    draw.line([(cx + s * 0.1, cy - s * 0.5), (cx + s * 0.6, cy)], fill=color, width=w)
    draw.line([(cx + s * 0.1, cy + s * 0.5), (cx + s * 0.6, cy)], fill=color, width=w)

def draw_kolview_logo(draw, cx, cy, size):
    s = size / 2.0
    r = s * 0.85
    pts = []
    for i in range(6):
        angle = math.radians(60 * i - 30)
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(pts, outline=PRIMARY_BLUE, width=max(2, int(size * 0.08)))
    draw.ellipse([cx - s * 0.35, cy - s * 0.35, cx + s * 0.35, cy + s * 0.35], fill=TELEGRAM_BLUE)
    draw.ellipse([cx - s * 0.15, cy - s * 0.15, cx + s * 0.15, cy + s * 0.15], fill=TEXT_WHITE)

def draw_copy_icon(draw, cx, cy, size, color):
    s = size / 2.0
    w = max(1, int(size * 0.12))
    draw.rounded_rectangle([cx - s * 0.8, cy - s * 0.8, cx + s * 0.3, cy + s * 0.3], radius=3, outline=color, width=w)
    draw.rounded_rectangle([cx - s * 0.3, cy - s * 0.3, cx + s * 0.8, cy + s * 0.8], radius=3, fill=CARD_BG, outline=color, width=w)

def draw_pulse_beacon(im, cx, cy, radius, color, alpha=160):
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    r = int(radius)
    c_rgba = (color[0], color[1], color[2], int(alpha))
    odraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c_rgba)
    im.alpha_composite(overlay)

def precompute_base_canvas(width, height):
    base = Image.new("RGBA", (width, height), (BG_COLOR[0], BG_COLOR[1], BG_COLOR[2], 255))
    draw = ImageDraw.Draw(base)
    
    # Subtle modern grid lines
    grid_gap = 60 if width > 1200 else 45
    for x in range(0, width, grid_gap):
        draw.line([(x, 0), (x, height)], fill=(22, 25, 27, 255), width=1)
    for y in range(0, height, grid_gap):
        draw.line([(0, y), (width, y)], fill=(22, 25, 27, 255), width=1)
        
    # Ambient glows
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    
    # Primary Blue ambient glow (top right)
    br_cx, br_cy = int(width * 0.82), int(height * 0.22)
    max_r1 = int(min(width, height) * 0.45)
    for r in range(max_r1, 30, -35):
        a = int(14 * (1.0 - r / float(max_r1)))
        gdraw.ellipse([br_cx - r, br_cy - r, br_cx + r, br_cy + r], fill=(PRIMARY_BLUE[0], PRIMARY_BLUE[1], PRIMARY_BLUE[2], a))
        
    # Emerald Green ambient glow (bottom left)
    em_cx, em_cy = int(width * 0.18), int(height * 0.82)
    max_r2 = int(min(width, height) * 0.5)
    for r in range(max_r2, 30, -35):
        a = int(12 * (1.0 - r / float(max_r2)))
        gdraw.ellipse([em_cx - r, em_cy - r, em_cx + r, em_cy + r], fill=(EMERALD_GREEN[0], EMERALD_GREEN[1], EMERALD_GREEN[2], a))
        
    base.alpha_composite(glow)
    return base

# Precomputed bases
BASE_16X9 = precompute_base_canvas(1920, 1080)
BASE_9X16 = precompute_base_canvas(1080, 1920)

# ==============================================================================
# RENDER 16:9 FRAME (1920 x 1080)
# ==============================================================================
def render_frame_16x9(f):
    im = BASE_16X9.copy()
    draw = ImageDraw.Draw(im)
    
    # Persistent Top Header
    draw_kolview_logo(draw, 80, 65, 36)
    draw.text((115, 52), "KOLVIEW", font=get_font("segoeuib", 26), fill=TEXT_WHITE)
    
    # Bot pill badge
    draw.rounded_rectangle([250, 56, 380, 84], radius=6, fill=(20, 32, 45), outline=(32, 60, 90), width=1)
    draw.text((264, 62), "@KOLView_Bot", font=get_font("segoeuib", 13), fill=TELEGRAM_BLUE)
    
    # Center: Step Tracker Tabs
    active_step = 1 if f < S1_END else (2 if f < S2_END else 3)
    tab_x = 730
    tab_y = 52
    steps = [
        ("01", "PASTE ADDRESS"),
        ("02", "INSTANT INDEX"),
        ("03", "LIVE ALERTS")
    ]
    for idx, (num, label) in enumerate(steps, start=1):
        x0 = tab_x + (idx - 1) * 165
        x1 = x0 + 155
        is_active = (idx == active_step)
        if is_active:
            bg_c = PRIMARY_BLUE if idx != 2 else EMERALD_GREEN
            draw.rounded_rectangle([x0, tab_y, x1, tab_y + 32], radius=16, fill=bg_c)
            draw.text((x0 + 14, tab_y + 7), f"{num} {label}", font=get_font("segoeuib", 12), fill=TEXT_WHITE)
        else:
            draw.rounded_rectangle([x0, tab_y, x1, tab_y + 32], radius=16, fill=(20, 23, 26), outline=(36, 40, 44), width=1)
            draw.text((x0 + 14, tab_y + 7), f"{num} {label}", font=get_font("segoeuib", 12), fill=TEXT_MUTED)
            
    # Right: Network Telemetry indicator
    ping_t = (f % 60) / 60.0
    ping_r = 5 + ping_t * 12
    ping_a = int(160 * (1.0 - ping_t))
    draw_pulse_beacon(im, 1720, 68, ping_r, EMERALD_GREEN, ping_a)
    draw.ellipse([1716, 64, 1724, 72], fill=EMERALD_GREEN)
    draw.text((1735, 59), "HELIUS 42ms", font=get_font("consolab", 15), fill=EMERALD_GREEN)
    
    # Top divider
    draw.line([(0, 105), (1920, 105)], fill=(32, 36, 40), width=1)
    
    # --------------------------------------------------------------------------
    # SCENE 1 (Frames 0 to 168): STEP 1 Send Any Solana Address
    # --------------------------------------------------------------------------
    if f < S1_END:
        t_in = clamp(f / 24.0)
        p_in = ease_out_cubic(t_in)
        
        offset_x = 0
        if f > S1_END - 18:
            t_out = (f - (S1_END - 18)) / 18.0
            offset_x = int(-ease_in_cubic(t_out) * 120)
            
        y_shift = int((1.0 - p_in) * 40)
        
        # Section Header
        head_y = 145 + y_shift
        draw.rounded_rectangle([offset_x + 840, head_y, offset_x + 1080, head_y + 32], radius=16, fill=(20, 36, 54), outline=(32, 65, 100), width=1)
        draw.text((offset_x + 854, head_y + 7), "STEP 01  •  ZERO SETUP", font=get_font("segoeuib", 13), fill=TELEGRAM_BLUE)
        
        title_text = "Send Any Solana Address to Telegram @KOLView_Bot"
        tw = int(get_font("segoeuib", 38).getlength(title_text))
        draw.text((offset_x + 960 - tw // 2, head_y + 44), title_text, font=get_font("segoeuib", 38), fill=TEXT_WHITE)
        
        sub_text = "No wallet connect. No configuration. Just paste any Solana wallet into Telegram."
        sw = int(get_font("segoeui", 19).getlength(sub_text))
        draw.text((offset_x + 960 - sw // 2, head_y + 94), sub_text, font=get_font("segoeui", 19), fill=TEXT_MUTED)
        
        # Telegram App Mockup Card
        card_w = 1140
        card_h = 600
        card_x = offset_x + 960 - card_w // 2
        card_y = 290 + y_shift
        
        draw.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + card_h], radius=18, fill=CARD_BG, outline=CARD_BORDER, width=2)
        
        # Telegram Window Header Bar
        draw.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + 80], radius=18, fill=CARD_BG_DARK)
        draw.rectangle([card_x, card_y + 50, card_x + card_w, card_y + 80], fill=CARD_BG_DARK)
        draw.line([(card_x, card_y + 80), (card_x + card_w, card_y + 80)], fill=CARD_BORDER, width=1)
        
        # Bot Avatar & Info
        av_x, av_y = card_x + 55, card_y + 40
        draw.ellipse([av_x - 24, av_y - 24, av_x + 24, av_y + 24], fill=TELEGRAM_BLUE)
        draw_paper_airplane(draw, av_x, av_y, 24, TEXT_WHITE)
        
        draw.text((card_x + 95, card_y + 22), "@KOLView_Bot", font=get_font("segoeuib", 20), fill=TEXT_WHITE)
        draw.ellipse([card_x + 95, card_y + 51, card_x + 103, card_y + 59], fill=EMERALD_GREEN)
        draw.text((card_x + 110, card_y + 48), "bot • online • sub-second tracking engine", font=get_font("segoeui", 14), fill=TELEGRAM_BLUE)
        draw_verified_shield(draw, card_x + 250, card_y + 33, 18, bg_color=PRIMARY_BLUE, check_color=TEXT_WHITE)
        
        # Header Right Controls
        draw.rounded_rectangle([card_x + card_w - 220, card_y + 24, card_x + card_w - 40, card_y + 56], radius=8, fill=(25, 29, 33), outline=(40, 45, 50), width=1)
        draw_lightning(draw, card_x + card_w - 200, card_y + 40, 16, EMERALD_GREEN)
        draw.text((card_x + card_w - 186, card_y + 31), "FAST INGESTION", font=get_font("segoeuib", 12), fill=TEXT_MUTED)
        
        # Message 1: User message (Slides in at f >= 12)
        if f >= 12:
            m1_t = clamp((f - 12) / 22.0)
            m1_p = ease_out_back(m1_t, 1.2)
            m1_y_shift = int((1.0 - m1_p) * 35)
            
            ub_w = 660
            ub_h = 100
            ub_x = card_x + card_w - ub_w - 50
            ub_y = card_y + 115 + m1_y_shift
            
            draw.rounded_rectangle([ub_x, ub_y, ub_x + ub_w, ub_y + ub_h], radius=14, fill=USER_BUBBLE_BG, outline=USER_BUBBLE_BORDER, width=1)
            draw.text((ub_x + 22, ub_y + 16), "Target Solana Wallet:", font=get_font("segoeui", 14), fill=TELEGRAM_BLUE)
            draw.text((ub_x + 22, ub_y + 42), CONTRACT_ADDRESS, font=get_font("consolab", 16), fill=TEXT_WHITE)
            
            draw.text((ub_x + ub_w - 95, ub_y + 68), "12:00 PM", font=get_font("segoeui", 12), fill=TEXT_MUTED)
            if f >= 32:
                draw_double_checks(draw, ub_x + ub_w - 25, ub_y + 75, 14, TELEGRAM_BLUE)
            else:
                draw_single_check(draw, ub_x + ub_w - 25, ub_y + 75, 14, TEXT_MUTED)
                
        # Message 2: Bot Auto-reply (Slides in at f >= 48)
        if f >= 48:
            m2_t = clamp((f - 48) / 24.0)
            m2_p = ease_out_back(m2_t, 1.2)
            m2_y_shift = int((1.0 - m2_p) * 40)
            
            bb_w = 780
            bb_h = 290
            bb_x = card_x + 50
            bb_y = card_y + 245 + m2_y_shift
            
            draw.rounded_rectangle([bb_x, bb_y, bb_x + bb_w, bb_y + bb_h], radius=14, fill=CARD_BG_DARK, outline=(38, 44, 50), width=1)
            
            # Bot header pill
            draw.rounded_rectangle([bb_x + 20, bb_y + 18, bb_x + 360, bb_y + 48], radius=8, fill=(18, 38, 28), outline=(28, 62, 45), width=1)
            draw.ellipse([bb_x + 32, bb_y + 29, bb_x + 40, bb_y + 37], fill=EMERALD_GREEN)
            draw.text((bb_x + 48, bb_y + 24), "TARGET RECOGNIZED  •  SOLANA WHALE", font=get_font("segoeuib", 12), fill=EMERALD_GREEN)
            
            # Details grid
            draw.text((bb_x + 24, bb_y + 66), "Address:", font=get_font("segoeui", 14), fill=TEXT_MUTED)
            draw.text((bb_x + 100, bb_y + 66), "DvSax2...pump (High-Conviction KOL)", font=get_font("consolab", 14), fill=TEXT_WHITE)
            
            draw.text((bb_x + 24, bb_y + 98), "Holdings:", font=get_font("segoeui", 14), fill=TEXT_MUTED)
            draw.text((bb_x + 100, bb_y + 98), "1,420.5 SOL ($284,100)  •  Win Rate: 78.4%", font=get_font("segoeuib", 14), fill=EMERALD_GREEN)
            
            draw.text((bb_x + 24, bb_y + 130), "Protocols:", font=get_font("segoeui", 14), fill=TEXT_MUTED)
            draw.text((bb_x + 100, bb_y + 130), "Raydium CPMM  •  Pump.fun Bonding Curve  •  Meteora DLMM", font=get_font("segoeui", 14), fill=TEXT_WHITE)
            
            # Animated connection status bar
            bar_w = bb_w - 48
            bar_y = bb_y + 172
            draw.rounded_rectangle([bb_x + 24, bar_y, bb_x + 24 + bar_w, bar_y + 42], radius=8, fill=(24, 30, 36), outline=(40, 48, 56), width=1)
            
            load_pct = clamp((f - 55) / 45.0)
            fill_w = int(bar_w * load_pct)
            if fill_w > 0:
                draw.rounded_rectangle([bb_x + 24, bar_y, bb_x + 24 + fill_w, bar_y + 42], radius=8, fill=(16, 185, 129, 90))
            
            status_str = "Connecting Dedicated Helius WebSocket Stream..." if load_pct < 0.99 else "Stream Linked Successfully (42ms Latency)"
            draw.text((bb_x + 40, bar_y + 11), status_str, font=get_font("segoeuib", 13), fill=TEXT_WHITE)
            
            # Quick Action Button
            btn_y = bb_y + 230
            draw.rounded_rectangle([bb_x + 24, btn_y, bb_x + 360, btn_y + 42], radius=8, fill=PRIMARY_BLUE)
            draw_lightning(draw, bb_x + 44, btn_y + 21, 16, TEXT_WHITE)
            draw.text((bb_x + 60, btn_y + 11), "ZERO-SETUP STREAM ACTIVE", font=get_font("segoeuib", 13), fill=TEXT_WHITE)
            
        # Bottom Prompt Hint
        draw.ellipse([offset_x + 960 - 240, card_y + card_h + 26, offset_x + 960 - 232, card_y + card_h + 34], fill=EMERALD_GREEN)
        draw.text((offset_x + 960 - 220, card_y + card_h + 20), "No Chrome extension • No seed phrase • 100% cloud indexed", font=get_font("segoeui", 16), fill=TEXT_MUTED)
        
    # --------------------------------------------------------------------------
    # SCENE 2 (Frames 168 to 330): STEP 2 Instant Automated Indexing
    # --------------------------------------------------------------------------
    elif f < S2_END:
        t_in = clamp((f - S1_END) / 22.0)
        p_in = ease_out_cubic(t_in)
        
        offset_x = 0
        if f > S2_END - 18:
            t_out = (f - (S2_END - 18)) / 18.0
            offset_x = int(-ease_in_cubic(t_out) * 120)
            
        y_shift = int((1.0 - p_in) * 40)
        
        # Section Header
        head_y = 145 + y_shift
        draw.rounded_rectangle([offset_x + 830, head_y, offset_x + 1090, head_y + 32], radius=16, fill=(16, 42, 30), outline=(26, 75, 52), width=1)
        draw.text((offset_x + 846, head_y + 7), "STEP 02  •  AUTOMATED PIPELINE", font=get_font("segoeuib", 13), fill=EMERALD_GREEN)
        
        title_text = "Instant Automated Indexing"
        tw = int(get_font("segoeuib", 38).getlength(title_text))
        draw.text((offset_x + 960 - tw // 2, head_y + 44), title_text, font=get_font("segoeuib", 38), fill=TEXT_WHITE)
        
        sub_text = "Sub-second Helius stream connection  •  0 Configuration Required"
        sw = int(get_font("segoeui", 19).getlength(sub_text))
        draw.text((offset_x + 960 - sw // 2, head_y + 94), sub_text, font=get_font("segoeui", 19), fill=TEXT_MUTED)
        
        # Main Indexing Dashboard Card
        card_w = 1240
        card_h = 610
        card_x = offset_x + 960 - card_w // 2
        card_y = 290 + y_shift
        
        draw.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + card_h], radius=18, fill=CARD_BG, outline=CARD_BORDER, width=2)
        
        # Top Verified Badge Banner
        vbar_y = card_y + 30
        draw.rounded_rectangle([card_x + 40, vbar_y, card_x + card_w - 40, vbar_y + 76], radius=14, fill=(16, 32, 25), outline=(28, 70, 50), width=1)
        
        # Verified shield icon with soft glow
        draw_verified_shield(draw, card_x + 85, vbar_y + 38, 32, bg_color=EMERALD_GREEN, check_color=TEXT_WHITE)
        draw.text((card_x + 120, vbar_y + 26), "VERIFIED HELIUS DEDICATED WEBSOCKET", font=get_font("segoeuib", 20), fill=TEXT_WHITE)
        
        # Latency metric badge
        lat_val = max(42, int(185 - (f - S1_END) * 5.2))
        lat_str = f"{lat_val}ms LATENCY"
        draw.rounded_rectangle([card_x + card_w - 230, vbar_y + 18, card_x + card_w - 65, vbar_y + 58], radius=8, fill=(12, 50, 32))
        draw.text((card_x + card_w - 212, vbar_y + 26), lat_str, font=get_font("consolab", 16), fill=EMERALD_GREEN)
        
        # 3-Node Connected Network Visual
        node_y = card_y + 175
        node_w = 280
        node_h = 160
        
        nodes = [
            (card_x + 60, "@KOLView_Bot", "Telegram Bot Client", TELEGRAM_BLUE, "Listening for target..."),
            (card_x + 480, "Helius Dedicated RPC", "Sub-second WebSocket", EMERALD_GREEN, "42ms stream active"),
            (card_x + 900, "KOLView Parsing Core", "Whale Clustering Engine", PRIMARY_BLUE, "Instant trade classifier")
        ]
        
        # Connection laser lines
        laser_y = node_y + node_h // 2
        draw.line([(card_x + 60 + node_w, laser_y), (card_x + 480, laser_y)], fill=(35, 75, 60), width=4)
        draw.line([(card_x + 480 + node_w, laser_y), (card_x + 900, laser_y)], fill=(35, 65, 80), width=4)
        
        # Animated data packet particles
        packet_t = (f * 8) % 140
        draw.ellipse([card_x + 60 + node_w + packet_t - 6, laser_y - 6, card_x + 60 + node_w + packet_t + 6, laser_y + 6], fill=EMERALD_GREEN)
        draw.ellipse([card_x + 480 + node_w + packet_t - 6, laser_y - 6, card_x + 480 + node_w + packet_t + 6, laser_y + 6], fill=PRIMARY_BLUE)
        
        for nx, ntitle, nsub, ncolor, nstat in nodes:
            is_center = (ncolor == EMERALD_GREEN)
            bg = CARD_BG_ELEVATED if not is_center else (22, 38, 30)
            bd = CARD_BORDER if not is_center else (36, 90, 65)
            draw.rounded_rectangle([nx, node_y, nx + node_w, node_y + node_h], radius=14, fill=bg, outline=bd, width=2)
            
            draw.rounded_rectangle([nx + 18, node_y + 16, nx + node_w - 18, node_y + 44], radius=6, fill=(18, 22, 26))
            draw.ellipse([nx + 30, node_y + 26, nx + 38, node_y + 34], fill=ncolor)
            draw.text((nx + 46, node_y + 21), ntitle, font=get_font("segoeuib", 14), fill=TEXT_WHITE)
            
            draw.text((nx + 20, node_y + 62), nsub, font=get_font("segoeui", 14), fill=TEXT_MUTED)
            draw.text((nx + 20, node_y + 92), "● " + nstat, font=get_font("segoeuib", 13), fill=ncolor)
            draw.text((nx + 20, node_y + 125), "STATUS: 100% ONLINE", font=get_font("consolab", 11), fill=TEXT_MUTED)
            
        # Progress Bar & Metrics Grid
        prog_y = card_y + 375
        prog_w = card_w - 80
        draw.rounded_rectangle([card_x + 40, prog_y, card_x + 40 + prog_w, prog_y + 64], radius=10, fill=CARD_BG_DARK, outline=(38, 44, 50), width=1)
        
        idx_pct = min(100, int(ease_out_cubic(clamp((f - S1_END) / 45.0)) * 100))
        fill_pw = int(prog_w * (idx_pct / 100.0))
        if fill_pw > 0:
            draw.rounded_rectangle([card_x + 40, prog_y, card_x + 40 + fill_pw, prog_y + 64], radius=10, fill=(16, 185, 129, 65))
            
        draw.text((card_x + 65, prog_y + 20), f"AUTOMATED INDEXING ENGINE: {idx_pct}% COMPLETE", font=get_font("segoeuib", 15), fill=TEXT_WHITE)
        draw.text((card_x + card_w - 290, prog_y + 20), "ZERO SETUP REQUIRED", font=get_font("segoeuib", 14), fill=EMERALD_GREEN)
        
        # 4 Telemetry Micro-Cards
        sub_grid_y = card_y + 465
        grid_items = [
            ("DEX Liquidity", "Pump.fun + Raydium AMM", PRIMARY_BLUE),
            ("Block Latency", "42ms (Sub-second RPC)", EMERALD_GREEN),
            ("Mempool Feed", "Jito Bundles & Shreads", TELEGRAM_BLUE),
            ("Index Status", "Armed & Realtime Active", TEXT_WHITE),
        ]
        gw = (card_w - 80 - 45) // 4
        for i, (gtitle, gval, gc) in enumerate(grid_items):
            gx = card_x + 40 + i * (gw + 15)
            draw.rounded_rectangle([gx, sub_grid_y, gx + gw, sub_grid_y + 105], radius=10, fill=CARD_BG_DARK, outline=(35, 40, 46), width=1)
            draw.text((gx + 16, sub_grid_y + 18), gtitle, font=get_font("segoeui", 13), fill=TEXT_MUTED)
            draw.text((gx + 16, sub_grid_y + 44), gval, font=get_font("segoeuib", 14), fill=gc)
            draw.text((gx + 16, sub_grid_y + 74), "● VERIFIED STREAM", font=get_font("consolab", 11), fill=EMERALD_GREEN)
            
    # --------------------------------------------------------------------------
    # SCENE 3 (Frames 330 to 480): STEP 3 Live Realtime Alerts Directly In Feed
    # --------------------------------------------------------------------------
    else:
        t_in = clamp((f - S2_END) / 22.0)
        p_in = ease_out_cubic(t_in)
        y_shift = int((1.0 - p_in) * 40)
        
        # Section Header
        head_y = 135 + y_shift
        draw.rounded_rectangle([830, head_y, 1090, head_y + 32], radius=16, fill=(18, 38, 55), outline=(28, 68, 105), width=1)
        draw.text((846, head_y + 7), "STEP 03  •  TELEGRAM FEED", font=get_font("segoeuib", 13), fill=PRIMARY_BLUE)
        
        title_text = "Live Realtime Alerts Directly In Feed"
        tw = int(get_font("segoeuib", 38).getlength(title_text))
        draw.text((960 - tw // 2, head_y + 44), title_text, font=get_font("segoeuib", 38), fill=TEXT_WHITE)
        
        sub_text = "Direct push notifications the exact millisecond alpha wallets execute trades."
        sw = int(get_font("segoeui", 19).getlength(sub_text))
        draw.text((960 - sw // 2, head_y + 92), sub_text, font=get_font("segoeui", 19), fill=TEXT_MUTED)
        
        # Left Card (Whale Buy Alert Card)
        c1_w = 720
        c1_h = 625
        c1_x = 180
        c1_y = 280 + y_shift
        
        draw.rounded_rectangle([c1_x, c1_y, c1_x + c1_w, c1_y + c1_h], radius=18, fill=CARD_BG, outline=(30, 85, 60), width=2)
        
        # Alert Header Bar
        draw.rounded_rectangle([c1_x + 24, c1_y + 24, c1_x + c1_w - 24, c1_y + 80], radius=12, fill=(16, 40, 28), outline=(28, 80, 55), width=1)
        
        alert_pulse = (f % 40) / 40.0
        draw_pulse_beacon(im, c1_x + 55, c1_y + 52, 10 + alert_pulse * 10, EMERALD_GREEN, int(150 * (1 - alert_pulse)))
        draw.ellipse([c1_x + 48, c1_y + 45, c1_x + 62, c1_y + 59], fill=EMERALD_GREEN)
        
        draw.text((c1_x + 78, c1_y + 38), "WHALE BUY DETECTED  •  JUST NOW", font=get_font("segoeuib", 16), fill=TEXT_WHITE)
        draw.text((c1_x + c1_w - 145, c1_y + 40), "0.38s AGO", font=get_font("consolab", 14), fill=EMERALD_GREEN)
        
        # Token Info Row
        draw.text((c1_x + 35, c1_y + 110), "Token:", font=get_font("segoeui", 16), fill=TEXT_MUTED)
        draw.text((c1_x + 110, c1_y + 106), "$KOLV / SOL", font=get_font("segoeuib", 24), fill=TEXT_WHITE)
        draw.rounded_rectangle([c1_x + 280, c1_y + 108, c1_x + 400, c1_y + 136], radius=6, fill=(24, 32, 40))
        draw.text((c1_x + 292, c1_y + 112), "Pump.fun AMM", font=get_font("segoeui", 12), fill=TELEGRAM_BLUE)
        
        # Big Swap Card inside
        sw_y = c1_y + 160
        draw.rounded_rectangle([c1_x + 24, sw_y, c1_x + c1_w - 24, sw_y + 110], radius=12, fill=CARD_BG_DARK, outline=(38, 44, 50), width=1)
        draw.text((c1_x + 45, sw_y + 18), "SWAPPED:", font=get_font("segoeuib", 13), fill=TEXT_MUTED)
        draw.text((c1_x + 45, sw_y + 42), "+45.2 SOL ($8,950)", font=get_font("segoeuib", 28), fill=EMERALD_GREEN)
        draw.text((c1_x + 450, sw_y + 18), "RECEIVED:", font=get_font("segoeuib", 13), fill=TEXT_MUTED)
        draw.text((c1_x + 450, sw_y + 44), "+1,240,000 $KOLV", font=get_font("segoeuib", 22), fill=TEXT_WHITE)
        
        # Trader Details Grid
        td_y = c1_y + 295
        td_items = [
            ("Tracked Wallet", "Solana Whale #04 (Rank #12)"),
            ("Win Rate (30D)", "78.4% Win Rate  •  PnL: +240%"),
            ("Market Cap", "$1,240,000  •  24h Vol: $4.8M"),
            ("Tx Hash", "3vBk9x...8Fp2pump (Confirmed)"),
        ]
        for idx, (lbl, val) in enumerate(td_items):
            iy = td_y + idx * 46
            draw.text((c1_x + 35, iy), lbl + ":", font=get_font("segoeui", 15), fill=TEXT_MUTED)
            font_use = get_font("consolab", 15) if "Hash" in lbl else get_font("segoeuib", 15)
            val_col = EMERALD_GREEN if "Win Rate" in lbl else TEXT_WHITE
            draw.text((c1_x + 190, iy), val, font=font_use, fill=val_col)
            
        # Action Buttons
        btn_y = c1_y + 515
        bw = (c1_w - 48 - 30) // 3
        draw.rounded_rectangle([c1_x + 24, btn_y, c1_x + 24 + bw, btn_y + 48], radius=8, fill=PRIMARY_BLUE)
        draw_chart_icon(draw, c1_x + 45, btn_y + 24, 16, TEXT_WHITE)
        draw.text((c1_x + 60, btn_y + 14), "DEXSCREENER", font=get_font("segoeuib", 12), fill=TEXT_WHITE)
        
        draw.rounded_rectangle([c1_x + 24 + bw + 15, btn_y, c1_x + 24 + 2 * bw + 15, btn_y + 48], radius=8, fill=(24, 34, 46), outline=(36, 60, 85), width=1)
        draw_lightning(draw, c1_x + 24 + bw + 38, btn_y + 24, 16, TELEGRAM_BLUE)
        draw.text((c1_x + 24 + bw + 52, btn_y + 14), "QUICK SNIPE", font=get_font("segoeuib", 12), fill=TELEGRAM_BLUE)
        
        draw.rounded_rectangle([c1_x + 24 + 2 * bw + 30, btn_y, c1_x + c1_w - 24, btn_y + 48], radius=8, fill=(24, 30, 36), outline=(40, 48, 56), width=1)
        draw.text((c1_x + 24 + 2 * bw + 64, btn_y + 14), "SOLSCAN", font=get_font("segoeuib", 12), fill=TEXT_MUTED)
        
        # Right Card: Outro, Socials & Contract Address (Only socials shown per instructions)
        c2_w = 780
        c2_h = 625
        c2_x = 960
        c2_y = 280 + y_shift
        
        draw.rounded_rectangle([c2_x, c2_y, c2_x + c2_w, c2_y + c2_h], radius=18, fill=CARD_BG, outline=CARD_BORDER, width=2)
        
        # Outro Header
        draw.rounded_rectangle([c2_x + 35, c2_y + 35, c2_x + 320, c2_y + 68], radius=8, fill=(18, 38, 55), outline=(28, 68, 105), width=1)
        draw.text((c2_x + 50, c2_y + 42), "START TRACKING TODAY", font=get_font("segoeuib", 13), fill=PRIMARY_BLUE)
        
        draw.text((c2_x + 35, c2_y + 90), "Join @KOLView_Bot", font=get_font("segoeuib", 38), fill=TEXT_WHITE)
        draw.text((c2_x + 35, c2_y + 148), "Zero-setup Solana wallet tracking directly inside Telegram.", font=get_font("segoeui", 18), fill=TEXT_MUTED)
        
        # Big Telegram CTA Button
        cta_y = c2_y + 195
        draw.rounded_rectangle([c2_x + 35, cta_y, c2_x + c2_w - 35, cta_y + 68], radius=12, fill=TELEGRAM_BLUE)
        draw_paper_airplane(draw, c2_x + 75, cta_y + 34, 32, TEXT_WHITE)
        draw.text((c2_x + 115, cta_y + 18), "LAUNCH TELEGRAM BOT", font=get_font("segoeuib", 20), fill=TEXT_WHITE)
        draw_arrow_right(draw, c2_x + 400, cta_y + 34, 18, TEXT_WHITE)
        draw.text((c2_x + 425, cta_y + 18), "@KOLView_Bot", font=get_font("segoeuib", 20), fill=TEXT_WHITE)
        
        # Socials Row (ONLY SOCIALS SHOWN: 𝕏 @kolview • ✈ t.me/kolview)
        soc_y = c2_y + 300
        soc_w = c2_w - 70
        draw.rounded_rectangle([c2_x + 35, soc_y, c2_x + 35 + soc_w, soc_y + 80], radius=14, fill=CARD_BG_DARK, outline=(38, 45, 52), width=1)
        
        # Social item 1: X (Twitter)
        draw_x_logo(draw, c2_x + 95, soc_y + 40, 26, TEXT_WHITE)
        draw.text((c2_x + 125, soc_y + 26), "@kolview", font=get_font("segoeuib", 22), fill=TEXT_WHITE)
        
        # Divider bullet
        draw.ellipse([c2_x + 360, soc_y + 37, c2_x + 368, soc_y + 45], fill=TEXT_MUTED)
        
        # Social item 2: Telegram Channel
        draw_paper_airplane(draw, c2_x + 440, soc_y + 40, 26, TELEGRAM_BLUE)
        draw.text((c2_x + 470, soc_y + 26), "t.me/kolview", font=get_font("segoeuib", 22), fill=TELEGRAM_BLUE)
        
        # Contract Address Container
        ca_y = c2_y + 420
        draw.rounded_rectangle([c2_x + 35, ca_y, c2_x + 35 + soc_w, ca_y + 145], radius=14, fill=(18, 22, 25), outline=(38, 50, 62), width=2)
        
        draw.text((c2_x + 55, ca_y + 20), "OFFICIAL CONTRACT ADDRESS (SOLANA):", font=get_font("segoeuib", 13), fill=TELEGRAM_BLUE)
        
        # Monospace CA
        draw.text((c2_x + 55, ca_y + 55), CONTRACT_ADDRESS, font=get_font("consolab", 18), fill=TEXT_WHITE)
        
        # Copy pill
        draw.rounded_rectangle([c2_x + 55, ca_y + 95, c2_x + 220, ca_y + 128], radius=6, fill=(22, 36, 50), outline=(35, 65, 95), width=1)
        draw_copy_icon(draw, c2_x + 75, ca_y + 111, 14, TELEGRAM_BLUE)
        draw.text((c2_x + 95, ca_y + 102), "COPY ADDRESS", font=get_font("segoeuib", 12), fill=TELEGRAM_BLUE)
        
        draw.text((c2_x + 250, ca_y + 103), "Pump.fun • Raydium • Meteora", font=get_font("segoeui", 13), fill=TEXT_MUTED)
        
    return im.convert("RGB")

# ==============================================================================
# RENDER 9:16 FRAME (1080 x 1920)
# ==============================================================================
def render_frame_9x16(f):
    im = BASE_9X16.copy()
    draw = ImageDraw.Draw(im)
    
    # Persistent Top Header for Mobile Vertical Layout
    draw_kolview_logo(draw, 80, 80, 44)
    draw.text((120, 65), "KOLVIEW", font=get_font("segoeuib", 32), fill=TEXT_WHITE)
    draw.rounded_rectangle([290, 68, 430, 102], radius=8, fill=(20, 32, 45), outline=(32, 60, 90), width=1)
    draw.text((306, 75), "@KOLView_Bot", font=get_font("segoeuib", 15), fill=TELEGRAM_BLUE)
    
    # Right Live Ping
    ping_t = (f % 60) / 60.0
    ping_r = 6 + ping_t * 14
    ping_a = int(160 * (1.0 - ping_t))
    draw_pulse_beacon(im, 950, 85, ping_r, EMERALD_GREEN, ping_a)
    draw.ellipse([945, 80, 955, 90], fill=EMERALD_GREEN)
    draw.text((975, 74), "42ms", font=get_font("consolab", 18), fill=EMERALD_GREEN)
    
    draw.line([(0, 140), (1080, 140)], fill=(32, 36, 40), width=1)
    
    # 3 Steps Segmented Progress Bar (y = 160)
    active_step = 1 if f < S1_END else (2 if f < S2_END else 3)
    tab_w = 280
    tab_gap = 25
    start_tab_x = (1080 - (3 * tab_w + 2 * tab_gap)) // 2
    steps = [("01", "PASTE"), ("02", "INDEX"), ("03", "ALERTS")]
    
    for idx, (num, label) in enumerate(steps, start=1):
        tx0 = start_tab_x + (idx - 1) * (tab_w + tab_gap)
        tx1 = tx0 + tab_w
        is_active = (idx == active_step)
        if is_active:
            bg_c = PRIMARY_BLUE if idx != 2 else EMERALD_GREEN
            draw.rounded_rectangle([tx0, 160, tx1, 202], radius=12, fill=bg_c)
            draw.text((tx0 + 65, 170), f"STEP {num}  {label}", font=get_font("segoeuib", 15), fill=TEXT_WHITE)
        else:
            draw.rounded_rectangle([tx0, 160, tx1, 202], radius=12, fill=(22, 26, 30), outline=(36, 42, 48), width=1)
            draw.text((tx0 + 65, 170), f"STEP {num}  {label}", font=get_font("segoeuib", 15), fill=TEXT_MUTED)
            
    # --------------------------------------------------------------------------
    # SCENE 1 (9:16): Send Any Solana Address
    # --------------------------------------------------------------------------
    if f < S1_END:
        t_in = clamp(f / 24.0)
        p_in = ease_out_cubic(t_in)
        y_shift = int((1.0 - p_in) * 45)
        
        offset_y = 0
        if f > S1_END - 18:
            t_out = (f - (S1_END - 18)) / 18.0
            offset_y = int(-ease_in_cubic(t_out) * 120)
            
        head_y = 250 + y_shift + offset_y
        draw.rounded_rectangle([420, head_y, 660, head_y + 36], radius=18, fill=(20, 36, 54), outline=(32, 65, 100), width=1)
        draw.text((440, head_y + 8), "STEP 01  •  ZERO SETUP", font=get_font("segoeuib", 14), fill=TELEGRAM_BLUE)
        
        draw.text((70, head_y + 54), "Send Any Solana Address\nto Telegram @KOLView_Bot", font=get_font("segoeuib", 40), fill=TEXT_WHITE)
        draw.text((70, head_y + 155), "No browser extension • No API keys • Zero setup needed", font=get_font("segoeui", 20), fill=TEXT_MUTED)
        
        # Telegram App Mockup Card
        card_w = 960
        card_h = 1100
        card_x = 60
        card_y = 480 + y_shift + offset_y
        
        draw.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + card_h], radius=24, fill=CARD_BG, outline=CARD_BORDER, width=2)
        
        # Telegram Header
        draw.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + 105], radius=24, fill=CARD_BG_DARK)
        draw.rectangle([card_x, card_y + 70, card_x + card_w, card_y + 105], fill=CARD_BG_DARK)
        draw.line([(card_x, card_y + 105), (card_x + card_w, card_y + 105)], fill=CARD_BORDER, width=1)
        
        av_x, av_y = card_x + 65, card_y + 52
        draw.ellipse([av_x - 30, av_y - 30, av_x + 30, av_y + 30], fill=TELEGRAM_BLUE)
        draw_paper_airplane(draw, av_x, av_y, 30, TEXT_WHITE)
        
        draw.text((card_x + 115, card_y + 30), "@KOLView_Bot", font=get_font("segoeuib", 24), fill=TEXT_WHITE)
        draw.ellipse([card_x + 115, card_y + 68, card_x + 125, card_y + 78], fill=EMERALD_GREEN)
        draw.text((card_x + 135, card_y + 64), "bot • online • sub-second tracking engine", font=get_font("segoeui", 16), fill=TELEGRAM_BLUE)
        draw_verified_shield(draw, card_x + 300, card_y + 44, 22, bg_color=PRIMARY_BLUE)
        
        # User Message
        if f >= 12:
            m1_t = clamp((f - 12) / 22.0)
            m1_p = ease_out_back(m1_t, 1.2)
            m1_y = card_y + 150 + int((1.0 - m1_p) * 40)
            
            ub_w = 840
            ub_h = 160
            ub_x = card_x + card_w - ub_w - 50
            draw.rounded_rectangle([ub_x, m1_y, ub_x + ub_w, m1_y + ub_h], radius=18, fill=USER_BUBBLE_BG, outline=USER_BUBBLE_BORDER, width=1)
            draw.text((ub_x + 28, m1_y + 18), "Target Solana Wallet:", font=get_font("segoeui", 16), fill=TELEGRAM_BLUE)
            
            # Show full address split across 2 clean lines
            draw.text((ub_x + 28, m1_y + 48), CONTRACT_ADDRESS[:22], font=get_font("consolab", 20), fill=TEXT_WHITE)
            draw.text((ub_x + 28, m1_y + 76), CONTRACT_ADDRESS[22:], font=get_font("consolab", 20), fill=TEXT_WHITE)
            
            draw.text((ub_x + 28, m1_y + 112), "(High-Conviction KOL Wallet)", font=get_font("segoeui", 14), fill=TEXT_MUTED)
            
            draw.text((ub_x + ub_w - 110, m1_y + 122), "12:00 PM", font=get_font("segoeui", 13), fill=TEXT_MUTED)
            if f >= 32:
                draw_double_checks(draw, ub_x + ub_w - 30, ub_y_check := m1_y + 130, 15, TELEGRAM_BLUE)
            else:
                draw_single_check(draw, ub_x + ub_w - 30, ub_y_check := m1_y + 130, 15, TEXT_MUTED)
                
        # Bot Message
        if f >= 48:
            m2_t = clamp((f - 48) / 24.0)
            m2_p = ease_out_back(m2_t, 1.2)
            m2_y = card_y + 360 + int((1.0 - m2_p) * 45)
            
            bb_w = 840
            bb_h = 570
            bb_x = card_x + 50
            draw.rounded_rectangle([bb_x, m2_y, bb_x + bb_w, m2_y + bb_h], radius=18, fill=CARD_BG_DARK, outline=(38, 44, 50), width=1)
            
            draw.rounded_rectangle([bb_x + 25, m2_y + 25, bb_x + 460, m2_y + 68], radius=10, fill=(18, 40, 30), outline=(28, 70, 50), width=1)
            draw_lightning(draw, bb_x + 45, m2_y + 46, 18, EMERALD_GREEN)
            draw.text((bb_x + 65, m2_y + 35), "TARGET RECOGNIZED: SOLANA WHALE", font=get_font("segoeuib", 15), fill=EMERALD_GREEN)
            
            draw.text((bb_x + 30, m2_y + 95), "Wallet Type:", font=get_font("segoeui", 17), fill=TEXT_MUTED)
            draw.text((bb_x + 160, m2_y + 95), "High-Conviction KOL (Rank #12)", font=get_font("segoeuib", 18), fill=TEXT_WHITE)
            
            draw.text((bb_x + 30, m2_y + 145), "SOL Balance:", font=get_font("segoeui", 17), fill=TEXT_MUTED)
            draw.text((bb_x + 160, m2_y + 145), "1,420.5 SOL ($284,100)", font=get_font("segoeuib", 20), fill=EMERALD_GREEN)
            
            draw.text((bb_x + 30, m2_y + 195), "Win Rate:", font=get_font("segoeui", 17), fill=TEXT_MUTED)
            draw.text((bb_x + 160, m2_y + 195), "78.4% (30D)  •  112 Trades", font=get_font("segoeuib", 18), fill=TEXT_WHITE)
            
            draw.text((bb_x + 30, m2_y + 245), "DEXs:", font=get_font("segoeui", 17), fill=TEXT_MUTED)
            draw.text((bb_x + 160, m2_y + 245), "Pump.fun • Raydium • Meteora", font=get_font("segoeui", 18), fill=TEXT_WHITE)
            
            # Progress bar
            bar_w = bb_w - 60
            bar_y = m2_y + 315
            draw.rounded_rectangle([bb_x + 30, bar_y, bb_x + 30 + bar_w, bar_y + 60], radius=10, fill=(24, 30, 36), outline=(40, 48, 56), width=1)
            load_pct = clamp((f - 55) / 45.0)
            fill_w = int(bar_w * load_pct)
            if fill_w > 0:
                draw.rounded_rectangle([bb_x + 30, bar_y, bb_x + 30 + fill_w, bar_y + 60], radius=10, fill=(16, 185, 129, 90))
            status_str = "Connecting Helius WebSocket..." if load_pct < 0.99 else "Stream Linked (42ms Latency)"
            draw.text((bb_x + 55, bar_y + 18), status_str, font=get_font("segoeuib", 17), fill=TEXT_WHITE)
            
            # Button
            btn_y = m2_y + 420
            draw.rounded_rectangle([bb_x + 30, btn_y, bb_x + bb_w - 30, btn_y + 80], radius=14, fill=PRIMARY_BLUE)
            draw_lightning(draw, bb_x + 180, btn_y + 40, 24, TEXT_WHITE)
            draw.text((bb_x + 210, btn_y + 24), "ZERO-SETUP STREAM ACTIVE", font=get_font("segoeuib", 22), fill=TEXT_WHITE)
            
        # Bottom Hint
        draw.ellipse([140, 1672, 148, 1680], fill=EMERALD_GREEN)
        draw.text((160, 1660), "No wallet connection • Instant cloud indexed", font=get_font("segoeui", 22), fill=TEXT_MUTED)
        
    # --------------------------------------------------------------------------
    # SCENE 2 (9:16): Instant Automated Indexing
    # --------------------------------------------------------------------------
    elif f < S2_END:
        t_in = clamp((f - S1_END) / 22.0)
        p_in = ease_out_cubic(t_in)
        y_shift = int((1.0 - p_in) * 45)
        
        offset_y = 0
        if f > S2_END - 18:
            t_out = (f - (S2_END - 18)) / 18.0
            offset_y = int(-ease_in_cubic(t_out) * 120)
            
        head_y = 250 + y_shift + offset_y
        draw.rounded_rectangle([390, head_y, 690, head_y + 36], radius=18, fill=(16, 42, 30), outline=(26, 75, 52), width=1)
        draw.text((410, head_y + 8), "STEP 02  •  AUTOMATED PIPELINE", font=get_font("segoeuib", 14), fill=EMERALD_GREEN)
        
        draw.text((70, head_y + 54), "Instant Automated\nIndexing", font=get_font("segoeuib", 42), fill=TEXT_WHITE)
        draw.text((70, head_y + 165), "Sub-second Helius stream connection  •  0 Configuration", font=get_font("segoeui", 20), fill=TEXT_MUTED)
        
        card_w = 960
        card_h = 1140
        card_x = 60
        card_y = 480 + y_shift + offset_y
        draw.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + card_h], radius=24, fill=CARD_BG, outline=CARD_BORDER, width=2)
        
        # Verified Badge
        vbar_y = card_y + 35
        draw.rounded_rectangle([card_x + 35, vbar_y, card_x + card_w - 35, vbar_y + 90], radius=16, fill=(16, 32, 25), outline=(28, 70, 50), width=1)
        draw_verified_shield(draw, card_x + 85, vbar_y + 45, 36, bg_color=EMERALD_GREEN)
        draw.text((card_x + 130, vbar_y + 22), "VERIFIED HELIUS WEBSOCKET", font=get_font("segoeuib", 20), fill=TEXT_WHITE)
        lat_val = max(42, int(185 - (f - S1_END) * 5.2))
        draw.text((card_x + 130, vbar_y + 52), f"RPC Stream Latency: {lat_val}ms", font=get_font("consolab", 16), fill=EMERALD_GREEN)
        
        # 3 Vertical Pipeline Nodes
        nodes_y = card_y + 165
        node_h = 150
        gap_y = 55
        
        v_nodes = [
            ("@KOLView_Bot", "Telegram Input Handler", TELEGRAM_BLUE, "Listening on mainnet"),
            ("Helius RPC WebSocket", "Sub-Second Data Stream", EMERALD_GREEN, "42ms streaming live"),
            ("KOLView Parsing Engine", "Whale Clustering & AI", PRIMARY_BLUE, "Trade classifier armed")
        ]
        
        for i, (ntitle, nsub, ncolor, nstat) in enumerate(v_nodes):
            ny = nodes_y + i * (node_h + gap_y)
            is_center = (ncolor == EMERALD_GREEN)
            bg = CARD_BG_ELEVATED if not is_center else (22, 38, 30)
            bd = CARD_BORDER if not is_center else (36, 90, 65)
            draw.rounded_rectangle([card_x + 50, ny, card_x + card_w - 50, ny + node_h], radius=16, fill=bg, outline=bd, width=2)
            
            draw.ellipse([card_x + 85, ny + 35, card_x + 97, ny + 47], fill=ncolor)
            draw.text((card_x + 115, ny + 28), ntitle, font=get_font("segoeuib", 22), fill=TEXT_WHITE)
            draw.text((card_x + 115, ny + 65), nsub, font=get_font("segoeui", 17), fill=TEXT_MUTED)
            draw.text((card_x + 115, ny + 102), "● " + nstat, font=get_font("segoeuib", 16), fill=ncolor)
            
            if i < 2:
                line_x = card_x + card_w // 2
                draw.line([(line_x, ny + node_h), (line_x, ny + node_h + gap_y)], fill=(35, 75, 60), width=4)
                py = ny + node_h + int(((f * 7) % gap_y))
                draw.ellipse([line_x - 5, py - 5, line_x + 5, py + 5], fill=EMERALD_GREEN)
                
        # Progress Bar
        bar_y = card_y + 820
        bw = card_w - 100
        draw.rounded_rectangle([card_x + 50, bar_y, card_x + 50 + bw, bar_y + 70], radius=12, fill=CARD_BG_DARK, outline=(38, 44, 50), width=1)
        idx_pct = min(100, int(ease_out_cubic(clamp((f - S1_END) / 45.0)) * 100))
        fill_pw = int(bw * (idx_pct / 100.0))
        if fill_pw > 0:
            draw.rounded_rectangle([card_x + 50, bar_y, card_x + 50 + fill_pw, bar_y + 70], radius=12, fill=(16, 185, 129, 65))
        draw.text((card_x + 80, bar_y + 22), f"INDEXING POOLS & BLOCKS: {idx_pct}% COMPLETE", font=get_font("segoeuib", 18), fill=TEXT_WHITE)
        
        # Bottom 2x2 Telemetry Grid
        t_grid_y = card_y + 920
        sub_items = [
            ("DEX Coverage", "Pump.fun + Raydium"),
            ("Latency", "42ms Ultra-fast"),
            ("Mempool", "Jito Bundles"),
            ("Tracking Status", "Armed & Active"),
        ]
        col_w = (card_w - 100 - 20) // 2
        for i, (stitle, sval) in enumerate(sub_items):
            rx = i % 2
            ry = i // 2
            gx = card_x + 50 + rx * (col_w + 20)
            gy = t_grid_y + ry * 85
            draw.rounded_rectangle([gx, gy, gx + col_w, gy + 75], radius=10, fill=CARD_BG_DARK, outline=(35, 40, 46), width=1)
            draw.text((gx + 18, gy + 14), stitle, font=get_font("segoeui", 13), fill=TEXT_MUTED)
            draw.text((gx + 18, gy + 38), sval, font=get_font("segoeuib", 16), fill=TEXT_WHITE)
            
        draw.ellipse([200, 1692, 208, 1700], fill=EMERALD_GREEN)
        draw.text((220, 1680), "Zero manual configuration required", font=get_font("segoeui", 22), fill=TEXT_MUTED)
        
    # --------------------------------------------------------------------------
    # SCENE 3 (9:16): Live Realtime Alerts Directly In Feed
    # --------------------------------------------------------------------------
    else:
        t_in = clamp((f - S2_END) / 22.0)
        p_in = ease_out_cubic(t_in)
        y_shift = int((1.0 - p_in) * 45)
        
        head_y = 230 + y_shift
        draw.rounded_rectangle([390, head_y, 690, head_y + 36], radius=18, fill=(18, 38, 55), outline=(28, 68, 105), width=1)
        draw.text((410, head_y + 8), "STEP 03  •  TELEGRAM FEED", font=get_font("segoeuib", 14), fill=PRIMARY_BLUE)
        
        draw.text((70, head_y + 54), "Live Realtime Alerts\nDirectly In Feed", font=get_font("segoeuib", 42), fill=TEXT_WHITE)
        draw.text((70, head_y + 165), "Push notifications delivered instantly to your Telegram.", font=get_font("segoeui", 20), fill=TEXT_MUTED)
        
        # Card 1: Alert Card
        c1_w = 960
        c1_h = 560
        c1_x = 60
        c1_y = 480 + y_shift
        draw.rounded_rectangle([c1_x, c1_y, c1_x + c1_w, c1_y + c1_h], radius=20, fill=CARD_BG, outline=(30, 85, 60), width=2)
        
        # Alert Header Bar
        draw.rounded_rectangle([c1_x + 24, c1_y + 24, c1_x + c1_w - 24, c1_y + 85], radius=14, fill=(16, 40, 28), outline=(28, 80, 55), width=1)
        alert_pulse = (f % 40) / 40.0
        draw_pulse_beacon(im, c1_x + 60, c1_y + 55, 10 + alert_pulse * 10, EMERALD_GREEN, int(150 * (1 - alert_pulse)))
        draw.ellipse([c1_x + 53, c1_y + 48, c1_x + 67, c1_y + 62], fill=EMERALD_GREEN)
        draw.text((c1_x + 85, c1_y + 40), "WHALE BUY DETECTED  •  JUST NOW", font=get_font("segoeuib", 20), fill=TEXT_WHITE)
        draw.text((c1_x + c1_w - 160, c1_y + 42), "0.38s AGO", font=get_font("consolab", 16), fill=EMERALD_GREEN)
        
        # Swap info box
        sw_y = c1_y + 110
        draw.rounded_rectangle([c1_x + 24, sw_y, c1_x + c1_w - 24, sw_y + 140], radius=14, fill=CARD_BG_DARK, outline=(38, 44, 50), width=1)
        draw.text((c1_x + 45, sw_y + 20), "$KOLV / SOL  (Pump.fun AMM)", font=get_font("segoeuib", 20), fill=TEXT_WHITE)
        draw.text((c1_x + 45, sw_y + 55), "+45.2 SOL ($8,950)", font=get_font("segoeuib", 32), fill=EMERALD_GREEN)
        draw.text((c1_x + 45, sw_y + 100), "Received: +1,240,000 $KOLV", font=get_font("segoeui", 18), fill=TEXT_WHITE)
        
        # Details
        draw.text((c1_x + 35, c1_y + 280), "Trader: Solana Whale #04 (Rank #12)", font=get_font("segoeuib", 18), fill=TEXT_WHITE)
        draw.text((c1_x + 35, c1_y + 320), "30D Win Rate: 78.4%  •  Hold PnL: +240%", font=get_font("segoeuib", 18), fill=EMERALD_GREEN)
        draw.text((c1_x + 35, c1_y + 360), "Market Cap: $1.2M  •  Tx: 3vBk9x...8Fp2", font=get_font("consolab", 17), fill=TEXT_MUTED)
        
        # Buttons
        btn_y = c1_y + 440
        bw = (c1_w - 48 - 25) // 2
        draw.rounded_rectangle([c1_x + 24, btn_y, c1_x + 24 + bw, btn_y + 65], radius=10, fill=PRIMARY_BLUE)
        draw_chart_icon(draw, c1_x + 130, btn_y + 32, 20, TEXT_WHITE)
        draw.text((c1_x + 155, btn_y + 20), "DEXSCREENER", font=get_font("segoeuib", 18), fill=TEXT_WHITE)
        
        draw.rounded_rectangle([c1_x + 24 + bw + 25, btn_y, c1_x + c1_w - 24, btn_y + 65], radius=10, fill=(24, 34, 46), outline=(36, 60, 85), width=1)
        draw_lightning(draw, c1_x + 24 + bw + 150, btn_y + 32, 20, TELEGRAM_BLUE)
        draw.text((c1_x + 24 + bw + 175, btn_y + 20), "QUICK SNIPE", font=get_font("segoeuib", 18), fill=TELEGRAM_BLUE)
        
        # Card 2: Outro, Socials & Contract Address
        c2_w = 960
        c2_h = 740
        c2_x = 60
        c2_y = 1080 + y_shift
        draw.rounded_rectangle([c2_x, c2_y, c2_x + c2_w, c2_y + c2_h], radius=20, fill=CARD_BG, outline=CARD_BORDER, width=2)
        
        draw.rounded_rectangle([c2_x + 35, c2_y + 35, c2_x + 380, c2_y + 75], radius=10, fill=(18, 38, 55), outline=(28, 68, 105), width=1)
        draw.text((c2_x + 55, c2_y + 44), "START TRACKING TODAY", font=get_font("segoeuib", 16), fill=PRIMARY_BLUE)
        
        draw.text((c2_x + 35, c2_y + 100), "Join @KOLView_Bot", font=get_font("segoeuib", 44), fill=TEXT_WHITE)
        draw.text((c2_x + 35, c2_y + 165), "Zero-setup Solana tracking directly in Telegram.", font=get_font("segoeui", 22), fill=TEXT_MUTED)
        
        # CTA Button
        cta_y = c2_y + 225
        draw.rounded_rectangle([c2_x + 35, cta_y, c2_x + c2_w - 35, cta_y + 80], radius=14, fill=TELEGRAM_BLUE)
        draw_paper_airplane(draw, c2_x + 85, cta_y + 40, 36, TEXT_WHITE)
        draw.text((c2_x + 135, cta_y + 24), "LAUNCH BOT", font=get_font("segoeuib", 24), fill=TEXT_WHITE)
        draw_arrow_right(draw, c2_x + 310, cta_y + 40, 20, TEXT_WHITE)
        draw.text((c2_x + 335, cta_y + 24), "@KOLView_Bot", font=get_font("segoeuib", 24), fill=TEXT_WHITE)
        
        # Socials Row (ONLY SOCIALS SHOWN: 𝕏 @kolview • ✈ t.me/kolview)
        soc_y = c2_y + 345
        soc_w = c2_w - 70
        draw.rounded_rectangle([c2_x + 35, soc_y, c2_x + 35 + soc_w, soc_y + 90], radius=14, fill=CARD_BG_DARK, outline=(38, 45, 52), width=1)
        
        draw_x_logo(draw, c2_x + 95, soc_y + 45, 30, TEXT_WHITE)
        draw.text((c2_x + 130, soc_y + 28), "@kolview", font=get_font("segoeuib", 26), fill=TEXT_WHITE)
        
        draw.ellipse([c2_x + 440, soc_y + 42, c2_x + 450, soc_y + 52], fill=TEXT_MUTED)
        
        draw_paper_airplane(draw, c2_x + 520, soc_y + 45, 30, TELEGRAM_BLUE)
        draw.text((c2_x + 555, soc_y + 28), "t.me/kolview", font=get_font("segoeuib", 26), fill=TELEGRAM_BLUE)
        
        # Contract Address Box
        ca_y = c2_y + 475
        draw.rounded_rectangle([c2_x + 35, ca_y, c2_x + 35 + soc_w, ca_y + 210], radius=16, fill=(18, 22, 25), outline=(38, 50, 62), width=2)
        draw.text((c2_x + 55, ca_y + 24), "OFFICIAL CONTRACT ADDRESS (SOLANA):", font=get_font("segoeuib", 16), fill=TELEGRAM_BLUE)
        
        # Split CA into 2 lines for high visibility on mobile screens
        draw.text((c2_x + 55, ca_y + 65), CONTRACT_ADDRESS[:22], font=get_font("consolab", 24), fill=TEXT_WHITE)
        draw.text((c2_x + 55, ca_y + 105), CONTRACT_ADDRESS[22:], font=get_font("consolab", 24), fill=TEXT_WHITE)
        
        draw.rounded_rectangle([c2_x + 55, ca_y + 150, c2_x + 280, ca_y + 190], radius=8, fill=(22, 36, 50), outline=(35, 65, 95), width=1)
        draw_copy_icon(draw, c2_x + 80, ca_y + 170, 16, TELEGRAM_BLUE)
        draw.text((c2_x + 105, ca_y + 158), "COPY CONTRACT", font=get_font("segoeuib", 15), fill=TELEGRAM_BLUE)
        
    return im.convert("RGB")

# ==============================================================================
# ENCODING & MAIN EXECUTION
# ==============================================================================
def render_video(aspect="16x9", output_file="output.mp4"):
    is_16x9 = (aspect == "16x9")
    width, height = (1920, 1080) if is_16x9 else (1080, 1920)
    render_fn = render_frame_16x9 if is_16x9 else render_frame_9x16
    
    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)
    
    print(f"\n[Starting Render] Aspect: {aspect} ({width}x{height}) -> {output_file}")
    t_start = time.time()
    
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{width}x{height}",
        "-pix_fmt", "rgb24",
        "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "18",
        output_file
    ]
    
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    for f in range(TOTAL_FRAMES):
        frame_img = render_fn(f)
        proc.stdin.write(frame_img.tobytes())
        if f % 60 == 0 or f == TOTAL_FRAMES - 1:
            sec = f / float(FPS)
            pct = (f / float(TOTAL_FRAMES)) * 100
            print(f"  Frame {f:03d}/{TOTAL_FRAMES} ({sec:.1f}s / {TOTAL_DURATION}s) - {pct:.1f}%")
            
    proc.stdin.close()
    proc.wait()
    
    elapsed = time.time() - t_start
    size_mb = os.path.getsize(output_file) / (1024 * 1024)
    print(f"[Finished Render] {output_file} ({size_mb:.2f} MB in {elapsed:.1f}s)\n")

def export_test_frames():
    os.makedirs("public/promo/test_frames", exist_ok=True)
    test_indices = [
        ("scene1", 80),
        ("scene2", 240),
        ("scene3", 410)
    ]
    for name, f in test_indices:
        img_16x9 = render_frame_16x9(f)
        img_16x9.save(f"public/promo/test_frames/16x9_{name}.png")
        img_9x16 = render_frame_9x16(f)
        img_9x16.save(f"public/promo/test_frames/9x16_{name}.png")
    print("Test frames exported to public/promo/test_frames/")

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        export_test_frames()
        return
        
    out_16x9 = "public/promo/kolview-easy-bot-16x9.mp4"
    out_9x16 = "public/promo/kolview-easy-bot-9x16.mp4"
    
    render_video("16x9", out_16x9)
    render_video("9x16", out_9x16)
    print("All trailers rendered successfully!")

if __name__ == "__main__":
    main()
