# Wayfarer Online — Asset Credits

All third-party art/audio/fonts are **CC0 1.0** (public domain) or **SIL OFL 1.1** (fonts).
No attribution is legally required; it is listed here anyway. This is a **new game** —
not Lanternfall — but it starts from the same CC0 anchor and expands it.

## Seed pack (copied from Lanternfall curation into `public/assets/`)

| Pack | Author | License | Used for |
|---|---|---|---|
| **Ninja Adventure Asset Pack** | Pixel-boy & AAA (https://pixel-boy.itch.io/ninja-adventure-asset-pack) | CC0 1.0 | Art anchor: 16×16 characters, monsters, tiles, props, FX, UI |
| **Kenney Particle Pack 1.1** | Kenney (https://kenney.nl/assets/particle-pack) | CC0 1.0 | Soft glow textures (`public/assets/light/`, 128×128) |
| **RPG Sound Pack** | artisticdude (OpenGameArt) | CC0 1.0 | Swing/magic/door/potion SFX |
| **80 CC0 RPG SFX** | rubberduck (OpenGameArt) | CC0 1.0 | Creature hurt/die/roar, chest SFX |
| **Loopable Dungeon Ambience** | JaggedStone (OpenGameArt) | CC0 1.0 | Ambient bed |
| **Kenney RPG Audio** | Kenney | CC0 1.0 | Footsteps |
| **Kenney Interface Sounds** | Kenney | CC0 1.0 | UI click/hover/error |
| **Jacquard 12 / Pixelify Sans / Jersey 10 / Silkscreen** | Google Fonts | SIL OFL 1.1 | Titles, body, numbers, labels |

Full source packs live in `../rpg-foundation/asset-staging/` (not copied). Run
`npm run copy-assets` to re-seed `public/assets/` from that folder (see `tools/copy_assets.mjs`).

## Recommended matching expansion packs (CC0, pull when needed)

These were **not** bundled yet — they match the 16×16 Game Boy look and can be
dropped into `public/assets/` + registered in `src/world/overworld.js` /
`src/data/customization.js` without code changes to the layer system:

| Pack | Where | Why it matches |
|---|---|---|
| Kenney Tiny Dungeon | https://kenney.nl/assets/tiny-dungeon | 16×16 tiles/props, same footprint, CC0 |
| Kenney Tiny Town | https://kenney.nl/assets/tiny-town | Village expansion tiles, CC0 |
| Kenney Pixel UI Pack | https://kenney.nl/assets/pixel-ui-pack | Cursor/HUD frames already partially used, CC0 |
| Liberated Pixel Cup (LPC) base bodies / hair | https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-48-pixel-tile | Modular hair/clothes layers for deeper Creator options, CC-BY-SA/GPL — **check license per file**, keep CC0-only files |
| itch.io "Modular RPG Heroes" free samples | https://itch.io (search "modular rpg hero cc0") | Hair/armor overlay sheets, per-author CC0 |

Rule: **CC0-only** in `public/assets/`. If a pack is CC-BY or GPL, either skip it
or put it in `asset-staging/` and do not ship it until relicensed/redrawn.

## What Wayfarer Online authors itself

- Thistle Town + Meadowfield + Mosswood + Tidehollow gate layouts (`src/world/overworld.js`)
- 4 job definitions, ability list, enemy table (`src/data/jobs.js`)
- 6 hair styles / 8 hair colors / 5 skin tones / accessory overlays (`src/data/customization.js` + `src/entities/ModularPlayer.js`) — procedural tints/overlays, no new art files
- **Gear system art (`src/systems/gearArt.js`, catalog `src/data/gear.js`): all worn head overlays (straw hat, leather cap, iron helm, mage hat, tide crown) and all item icons, generated at runtime in matching 16×16 pixel style — CC0, ours**
- Game Boy palettes + scanline overlay (`src/core/palette.js`)
- Title → Creator → World flow, HUD (HP/MP/XP, minimap, hotbar, chat, party frames), day/night cycle
- Host-relay co-op (`server/` + `src/net/`): solo simulation is authoritative, host relays to guests
