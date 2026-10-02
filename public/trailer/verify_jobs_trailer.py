import os
import re

html_path = r"D:\ai-studio\wayfarer-online\public\trailer\jobs_trailer.html"
trailer_dir = os.path.dirname(html_path)

if not os.path.exists(html_path):
    print(f"ERROR: {html_path} does not exist!")
    exit(1)

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Read {len(content)} bytes from {html_path}")

# Check for required timeline text and sections
required_strings = [
    "CHOOSE YOUR PATH: THE JOBS & LEVELING SYSTEM",
    "4 STARTER CLASSES: WAYFARER • RANGER • ARCANIST • BANDIT",
    "LEVEL UP & ALLOCATE STATS: STR • AGI • VIT • INT • DEX • LUK",
    "LEVEL 10 ADVANCED SPECIALIZATIONS: 8 EPIC PATHS",
    "Knight",
    "Lantern Warden",
    "Hunter",
    "Wildwarden",
    "Elementalist",
    "Tidecaller",
    "Shadowblade",
    "Trickster",
    "WayfarerOnline.fun",
    "mus_jobs_trailer.wav",
    "gsap.timeline",
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
