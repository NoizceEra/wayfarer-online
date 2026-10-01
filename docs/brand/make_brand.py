import math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'assets') + '/'
rnd = random.Random(7)
def h(n, s=0):
    x = (int(n) * 374761393 + int(s) * 668265263) & 0xffffffff
    x = ((x ^ (x >> 13)) * 1274126177) & 0xffffffff
    return ((x ^ (x >> 16)) & 0xffffffff) / 4294967296

BANDS = ['#07200d', '#0a2a10', '#0d3513', '#124216', '#1a5219', '#2a6a1c', '#4a8320', '#7aa22a', '#b3b93a', '#e0c850']

def scene(W, H, horizon, sun_x, ridges):
    im = Image.new('RGBA', (W, H)); d = ImageDraw.Draw(im)
    for i, c in enumerate(BANDS):
        d.rectangle([0, int(i * horizon / len(BANDS)), W, int((i + 1) * horizon / len(BANDS)) + 1], fill=c)
    for i in range(1, len(BANDS)):  # dither seams
        y = int(i * horizon / len(BANDS))
        for x in range(0, W, 2): d.point((x + (1 if h(x, i) > .5 else 0), y - 1), fill=BANDS[i])
    for i in range(int(W * H / 140)):  # stars
        x, y = int(h(i, 3) * W), int(h(i, 9) * horizon * 0.55)
        d.point((x, y), fill='#fff6c0' if h(i, 5) > .85 else '#9fc88a')
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    for r in range(int(W * .28), 0, -3):
        gd.ellipse([sun_x - r * 1.6, horizon - r * .7 - 6, sun_x + r * 1.6, horizon + r * .7 - 6], fill=(255, 242, 160, 11))
    im.alpha_composite(glow); d = ImageDraw.Draw(im)
    d.rectangle([sun_x - 8, horizon - 8, sun_x + 8, horizon - 2], fill='#fff3b0'); d.rectangle([sun_x - 5, horizon - 11, sun_x + 5, horizon - 8], fill='#fff3b0')
    tops_all = []
    for (base, amp, freq, seed, col, rim, pines) in ridges:
        tops = []
        for x in range(W):
            y = round(base + math.sin(x * freq + seed) * amp + math.sin(x * freq * 2.3 + seed * 2) * amp * .4)
            tops.append(y); d.line([x, y, x, H], fill=col); d.point((x, y), fill=rim)
        for i in range(pines):
            x = int(h(i, seed * 10) * (W - 8)) + 4; y = tops[x]; ph = 8 + int(h(i, seed * 10 + 4) * 9)
            for k in range(ph):
                half = (ph - k) // 4
                d.line([x - half, y - k, x + half, y - k], fill=col)
        tops_all.append(tops)
    return im, tops_all

def sprite(sheet, col=0, row=0, scale=4):
    s = Image.open(A + f'na/Actor/Character/{sheet}/SpriteSheet.png').convert('RGBA').crop((col * 16, row * 16, col * 16 + 16, row * 16 + 16))
    return s.resize((16 * scale, 16 * scale), Image.NEAREST)

def lantern_glow(im, cx, cy, r):
    g = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    for k in range(r, 0, -2): d.ellipse([cx - k, cy - k, cx + k, cy + k], fill=(255, 226, 122, 9))
    im.alpha_composite(g)
    d = ImageDraw.Draw(im); d.rectangle([cx - 2, cy - 3, cx + 2, cy + 3], fill='#ffd34a'); d.rectangle([cx - 1, cy - 2, cx, cy + 1], fill='#fff6c0')

def shadow(im, cx, cy, w):
    s = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(s)
    d.ellipse([cx - w, cy - 2, cx + w, cy + 3], fill=(5, 12, 5, 110)); im.alpha_composite(s)

def frame(img, gold='#e8c64a', w=6):
    d = ImageDraw.Draw(img); W, H = img.size
    d.rectangle([0, 0, W - 1, H - 1], outline='#0a2a10', width=w)
    d.rectangle([w, w, W - 1 - w, H - 1 - w], outline=gold, width=3)

def vignette(img, strength=120):
    W, H = img.size; v = Image.new('L', (W, H), 0); d = ImageDraw.Draw(v)
    for i in range(0, 60):
        a = int(strength * (i / 60) ** 3); d.rectangle([i * W // 240, i * H // 240, W - i * W // 240, H - i * H // 240], outline=0)
    mask = Image.new('L', (W, H), 255)
    big = Image.radial_gradient('L').resize((W, H))  # center black -> edge white
    big = big.point(lambda p: int(p * strength / 255 * 0.9))
    shade = Image.new('RGBA', (W, H), (4, 10, 6, 0)); shade.putalpha(big)
    img.alpha_composite(shade)

# ---------- PROFILE 512x512 (pixel grid 128, x4) ----------
def profile():
    W = H = 128
    im, tops = scene(W, H, 84, 92, [(86, 6, .05, 1.3, '#16401a', '#2e6a24', 14), (100, 6, .035, 4.1, '#0f3014', '#1f5220', 10), (112, 5, .03, 7.7, '#092410', '#16411a', 6)])
    near = tops[2]
    hx = 40; gy = near[hx + 24] + 1
    hero = sprite('Hunter', 0, 0, 3)           # 48x48 on the 128 grid
    shadow(im, hx + 24, gy, 18)
    lantern_glow(im, hx + 56, gy - 14, 24)
    im.alpha_composite(hero, (hx, gy - 46))
    sl = Image.open(A + 'na/Actor/Monster/Slime/Slime.png').convert('RGBA').crop((0, 0, 16, 16)).resize((24, 24), Image.NEAREST)
    shadow(im, 100, gy + 1, 9); im.alpha_composite(sl, (88, gy - 21))
    big = im.resize((512, 512), Image.NEAREST)
    vignette(big, 150); frame(big)
    # tiny slime companion
    return big.convert('RGB')

# ---------- BANNER 1500x500 (pixel grid 300x100, x5) ----------
def banner():
    W, H = 300, 100
    im, tops = scene(W, H, 62, 215, [(60, 4, .03, 1.3, '#16401a', '#2e6a24', 26), (72, 5, .022, 4.1, '#0f3014', '#1f5220', 28), (86, 4, .018, 7.7, '#092410', '#16411a', 22)])
    near = tops[2]
    cast = [('Woman', 205, 3), ('Villager', 232, 4), ('Knight', 256, 4), ('Monk', 282, 3)]
    for name, x, sc in cast[:0]: pass
    # party walking on the far-right ridge, hero in front with lantern
    party = [('ManGreen', 156, 2), ('Woman', 182, 2), ('SorcererOrange', 262, 2)]
    for name, x, sc in party:
        sp = sprite(name, 0, 0, sc); gy = near[min(W - 1, x + 12)] + 2
        shadow(im, x + 8 * sc, gy, 10 * sc); im.alpha_composite(sp, (x, gy - 15 * sc))
    hero = sprite('Hunter', 0, 0, 3); hx = 212; gy = near[hx + 24] + 2
    shadow(im, hx + 24, gy, 16); lantern_glow(im, hx + 52, gy - 14, 20); im.alpha_composite(hero, (hx, gy - 46))
    sl = Image.open(A + 'na/Actor/Monster/Slime/Slime.png').convert('RGBA').crop((0, 0, 16, 16)).resize((16, 16), Image.NEAREST)
    shadow(im, 140, near[140] + 3, 8); im.alpha_composite(sl, (132, near[140] - 12))
    big = im.resize((1500, 500), Image.NEAREST)
    vignette(big, 110)
    # title (final-resolution text so the blackletter stays crisp)
    d = ImageDraw.Draw(big)
    f = ImageFont.truetype(A + 'fonts/jacquard12/Jacquard12-Regular.ttf', 170)
    f2 = ImageFont.truetype(A + 'fonts/silkscreen/Silkscreen-Bold.ttf', 30)
    title = 'WAYFARER ONLINE'
    tw = d.textlength(title, font=f); tx = 60 + 360; ty = 105
    tx = 400 - 0
    # shrink to fit left/center region (avoid profile pic overlap at bottom-left)
    while d.textlength(title, font=f) > 900 and f.size > 40:
        f = ImageFont.truetype(A + 'fonts/jacquard12/Jacquard12-Regular.ttf', f.size - 4)
    tw = d.textlength(title, font=f); tx = 120 + (900 - tw) / 2 + 160 if False else 140
    ty = 95
    glow = Image.new('RGBA', big.size, (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    gd.text((tx, ty), title, font=f, fill=(255, 220, 90, 140)); glow = glow.filter(ImageFilter.GaussianBlur(14)); big.alpha_composite(glow.convert('RGBA')) if big.mode == 'RGBA' else None
    return big, f, tx, ty, title, f2

def finish_banner():
    big, f, tx, ty, title, f2 = banner()
    big = big.convert('RGBA'); d = ImageDraw.Draw(big)
    glow = Image.new('RGBA', big.size, (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    gd.text((tx, ty), title, font=f, fill=(255, 214, 80, 150)); glow = glow.filter(ImageFilter.GaussianBlur(16)); big.alpha_composite(glow)
    d = ImageDraw.Draw(big)
    for dx, dy in [(-4, 0), (4, 0), (0, -4), (0, 4), (-3, -3), (3, 3), (-3, 3), (3, -3), (6, 6)]:
        d.text((tx + dx, ty + dy), title, font=f, fill='#05140a')
    d.text((tx, ty), title, font=f, fill='#c8e025')
    d.text((tx, ty - 3), title, font=f, fill='#e6f060')
    tag = 'a cozy open world  •  solo or together'
    tw = d.textlength(tag, font=f2); gx = tx + 8
    for dx, dy in [(-2, 0), (2, 0), (0, 2), (0, -2)]: d.text((gx + dx, ty + f.size - 8 + dy), tag, font=f2, fill='#05140a')
    d.text((gx, ty + f.size - 8), tag, font=f2, fill='#f4d35e')
    d.rectangle([0, 0, 1499, 499], outline='#0a2a10', width=8); d.rectangle([8, 8, 1491, 491], outline='#e8c64a', width=3)
    return big.convert('RGB')

profile().save('wayfarer_profile_512.png')
finish_banner().save('wayfarer_banner_1500x500.png')
print('done')
