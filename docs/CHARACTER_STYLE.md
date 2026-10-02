# Wayfarer Online — character-asset style contract (hard gate)

All character/gear assets MUST be Ninja Adventure 16x16 Game Boy style.
Nothing smooth, nothing 300x300 promo, nothing Puny-32px. This doc + 
`python tools/validate_character_assets.py` enforce it (exit non-zero on drift).

## 1. Sources of truth (read these before authoring)

| Concern | File |
|---|---|
| Body palette-swap + `ramp()` | `src/systems/heroArt.js:9-12` |
| Inventory icons (16x16 painters) | `src/systems/iconArt.js` |
| Worn overlays (28x28 per-facing) | `src/systems/wearArt.js` |
| Gear catalog (style + main/trim) | `src/data/gear.js` |
| Draw order / facing rules | `src/entities/ModularPlayer.js:23-27` |
| NA sheet layouts | `python tools/validate_sheets.py` |
| Licences (CC0-only in `public/assets/`) | `CREDITS.md` |

## 2. Pixel rules

- Grid: icons **16x16**; 32px files are **NEAREST x2** of a 16x16 only.
  Wear overlays **28x28** (sprite coords +6). Sheets are exact multiples.
- Outline: icons `#1a1024` `(26,16,36)` orthogonal (`iconArt.js:7,23-31`);
  wear `#141b1b` `(20,27,27)` (`wearArt.js:15,28-36`).
- Colour: 4-tone `ramp(main/trim)` — hi = mix-to-white 0.28, lo = mix-to-black
  0.3, lo2 = mix-to-black 0.5 (`heroArt.js:9-12`) + the fixed constants in
  `iconArt.js:9` (WHITE/GOLD/WOOD/WOODLO/STEEL/STEELLO). No gradients.
- Alpha: hard only (0 or 255). Any feathered/anti-aliased edge FAILS.
- Palette size: <= 40 distinct RGB values per icon (pixel art, not paintings).
- New visuals reuse existing `STYLE_DEF` / `ICON` families. A brand-new
  painter must copy the `G`/`PX` helpers verbatim (round-half-up, orthogonal
  outline, no diagonals in the outline pass).

## 3. Layering (ModularPlayer)

- `down/left/right`: back, [offhand], body, bodyGear, feet, acc, charm, face,
  hair, faceGear, headGear, [offhand if down], weapon.
- `up`: offhand + weapon + back go BEHIND the body; cape covers the back.
- `right` = `left` mirrored. Never author a separate right-facing sheet.

## 4. Forbidden

- `public/assets/custom/seasonal/generate_assets.py` style (300x300 smooth
  polygons + glow) for anything in the character pipeline — promo only.
- `openworld-mmo` Puny style (32x32 freehand, outline `(26,32,44)`).
- AI-slice output that is not hard-alpha + <= 24 colours
  (`tools/slice_icons.py:51-54`). Non-conforming slices are rejected.
- Any non-CC0 file under `public/assets/` (record in CREDITS.md first).

## 5. Commands

```bash
python tools/validate_sheets.py            # NA anchor still valid
python tools/validate_character_assets.py  # our exports still in style (this gate)
python tools/export_gear_icons.py          # regenerate all gear icon waves
python tools/export_gear_icons.py --waves winter   # one wave only
```

Reference exporter: `tools/export_gear_icons.py` is the hardcoded
Ninja Adventure 16x16 painter set (verbatim ports of `ICON.*` + `ramp()`).
Future agents: extend it, do not freehand new gear art.
