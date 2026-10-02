import os
import re

html_path = r"D:\ai-studio\wayfarer-online\public\trailer\token_trailer.html"
trailer_dir = os.path.dirname(html_path)

if not os.path.exists(html_path):
    print(f"ERROR: {html_path} does not exist!")
    exit(1)

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Read {len(content)} bytes from {html_path}")

# Check for required timeline text and prompt requirements
required_strings = [
    "INTRODUCING $WAYFARER: THE ENGINE OF EMBERVALE",
    "Floating 3D Golden Token Badges & Glowing Particle Aura",
    "WHY BUY $WAYFARER? REAL GAME UTILITY & DEFLATIONARY SUPPLY",
    "trading",
    "crafting",
    "premium gear",
    "staking",
    "EARN AS YOU PLAY: BATTLES, QUESTS & MARKETPLACE TRADING",
    "Monster drops",
    "bounty claims",
    "server-wide market sales",
    "THE 360-DEGREE WIN: AUTOMATIC TOKEN BURN",
    "5% marketplace fee burned on-chain -> supply decreases -> holder value increases",
    "JOIN THE ECONOMY - BUY & EARN $WAYFARER AT WayfarerOnline.fun",
    "WayfarerOnline.fun",
    "../assets/audio/music/mus_token_trailer.wav",
    "gsap.timeline",
    "supply-curve-svg",
    "flame-canvas",
    "scanlines"
]

missing = [s for s in required_strings if s not in content]
if missing:
    print("ERROR: Missing required strings:", missing)
else:
    print("SUCCESS: All required prompt text and components found in HTML.")

# Extract all src attribute values
src_matches = re.findall(r'src=["\']([^"\']+)["\']', content)
print("\nVerifying referenced src assets:")
all_exist = True

for src in set(src_matches):
    if src.startswith("http://") or src.startswith("https://"):
        print(f" [External CDN] {src}")
        continue
    
    # Resolve relative path
    abs_asset_path = os.path.normpath(os.path.join(trailer_dir, src))
    exists = os.path.exists(abs_asset_path)
    status = "OK" if exists else "MISSING!"
    print(f" [{status}] {src} -> {abs_asset_path}")
    if not exists:
        all_exist = False

if all_exist and not missing:
    print("\nVERIFICATION COMPLETE: All asset files exist and HTML structure is valid!")
else:
    print("\nVERIFICATION FAILED: Missing strings or missing asset files!")
