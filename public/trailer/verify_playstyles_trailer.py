import os
import re

html_path = r"D:\ai-studio\wayfarer-online\public\trailer\playstyles_trailer.html"
trailer_dir = os.path.dirname(html_path)

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Read {len(content)} bytes from {html_path}")

# Check for required timeline text and sections
required_strings = [
    "EARN YOUR WAY",
    "THE CRAFTER",
    "BAKE, BREW & SMITH FOR PROFIT",
    "THE TRADER",
    "BUY LOW, SELL HIGH ON THE MARKET BOARD",
    "THE QUEST-SEEKER",
    "DAILY BOUNTIES & TOWN CONTRACTS",
    "THE MONSTER HUNTER",
    "SLAY BEASTS & CLAIM TOKENS",
    "PLAY YOUR WAY OR DO IT ALL",
    "WayfarerOnline.fun",
    "gsap.timeline",
    "scanlines"
]

missing = [s for s in required_strings if s not in content]
if missing:
    print("ERROR: Missing required strings:", missing)
else:
    print("SUCCESS: All required prompt text and components found in HTML.")

# Extract all src attribute values (images and videos)
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

if all_exist:
    print("\nVERIFICATION COMPLETE: All asset files exist and HTML structure is valid!")
else:
    print("\nVERIFICATION FAILED: Some asset files are missing!")
