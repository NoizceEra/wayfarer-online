import os
import re

html_path = r"D:\ai-studio\wayfarer-online\public\trailer\marketplace_trailer.html"
trailer_dir = os.path.dirname(html_path)

if not os.path.exists(html_path):
    print(f"ERROR: HTML file not found at {html_path}")
    exit(1)

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Read {len(content)} bytes from {html_path}")

# Required strings matching prompt requirements & timeline
required_strings = [
    "THE WAYFARER MARKETPLACE: TRADE, EARN & BURN",
    "TRADE SEASONAL & CRAFTED GEAR",
    "Halloween scythes",
    "winter robes",
    "everyday gear",
    "SUPPLY NEW PLAYERS & PROFIT",
    "Crafters smith high-tier gear",
    "sell to new adventurers",
    "EVERY TRADE BURNS $WAYFARER TOKENS",
    "Marketplace transaction fee burned permanently on-chain",
    "A 360-DEGREE WIN FOR EVERY HOLDER",
    "Decreasing token supply increases holder value",
    "TRADE & EARN NOW AT WayfarerOnline.fun",
    "WayfarerOnline.fun",
    "gsap.timeline",
    "scanlines"
]

missing = [s for s in required_strings if s not in content]
if missing:
    print("ERROR: Missing required strings:", missing)
else:
    print("SUCCESS: All required prompt text and components found in HTML.")

# Extract all src attribute values from <img>, <video>, <source> tags
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

if not missing and all_exist:
    print("\nVERIFICATION COMPLETE: All asset files exist and HTML structure is valid!")
else:
    print("\nVERIFICATION FAILED: Missing strings or missing asset files!")
