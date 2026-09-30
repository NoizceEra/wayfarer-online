# Wayfarer Online

A cozy Game Boy-style **open-world action RPG** (new game, not Lanternfall) with
**modular characters**, **solo ↔ co-op interop**, and a HUD built for
Ragnarok Online / Heartwood Online fans: login → character creator → explore together.

## Play now

- **Game:** https://wayfarer-online.vercel.app (works solo offline; co-op via relay below)
- **Co-op relay:** `wss://wayfarer-relay-production.up.railway.app` (baked into the deploy via `VITE_SERVER_URL`)

## Quick start

```powershell
cd D:\ai-studio\wayfarer-online
npm install
npm run copy-assets   # seeds public/assets from ../rpg-foundation (already done once)
npm run dev           # http://localhost:5176
```

Online server (public world shards + private co-op, area-authority enemy sync, file-backed saves — details and env vars in [server/README.md](server/README.md)):

```powershell
cd server
npm install
npm start             # ws://localhost:2567
```

Set the client URL via `.env`: `VITE_SERVER_URL=ws://localhost:2567`
(production: your Railway URL).

## Deploy

- **Vercel (client):** import this folder, framework = Vite, build = `npm run build`, output = `dist`.
- **Railway (relay):** root `railway.json` builds/starts `server/` (healthcheck `/health`).
  `PORT` is provided by Railway; mount a **volume** and set `DATA_DIR=/data` so characters
  survive redeploys; optional `MAX_PLAYERS` (per public shard, default 40). No DB needed.
  `GET /stats` shows shards, players and anti-cheat counters.

## Controls

- Move: WASD / arrows (or touch stick) · Interact: E · Attack: J / click / ATK button
- Ability 1-4: 1-4 (clickable hotbar) · Potion: Q · Skill shortcut: SKL button casts slot 2
- Equipment: I / B or BAG button (paper doll, 8 slots, bag, dyes; drag or double-click) · Shops: Maren, Dovey (hats/capes) and Bram (arms) at the market stalls (E), buy + sell
- Gear data: `src/data/gear.js` (80 items, 4 rarities, `getEquipBonuses(equipped)` → str/agi/vit/int/dex/luk/atk/def/hp/mp/spd); worn art `src/systems/wearArt.js`, icons `src/systems/iconArt.js`
- Quests: talk to NPCs with a gold `!` (new quest) or `?` (turn-in) overhead; notice board in town posts daily bounties. Journal: L (Active / Available / Done / Lore / Bestiary / Codex / Feats; track up to 3, 8 active max). Data: `src/data/quests.js`, engine `src/systems/questSystem.js`
- Gathering: E at herbs, berry bushes, logs, ore/bone/crystal veins and fishing ripples (timing mini-game); nodes respawn. Crafting: U or E at a campfire / anvil / alchemy table (recipes in `src/systems/crafting.js`, materials in `src/data/materials.js`). Vendors buy materials and junk, keep a buy-back list and restock every 10 minutes
- Minimap: M · Sound: P · Chat: Enter · Pause: Esc · Touch: stick + ATK/SKL/E/Q/BAG buttons
- Progress (level/XP/gold/gear/position/quest) autosaves every 10s + on exit — Continue resumes it

## Gear

4 equip slots (head/chest/weapon/trinket), ~20 items across 5 tiers. Loot drops
from monsters (walk over to collect), Maren's shop in Thistle Town sells
starter gear + potions. Weapons change your attack (bows/wands shoot, blades
slash) and worn helms/hats render on your character and in co-op.

## Flow

1. **Title / Login** — enter a wayfarer name (local profile, no password in v1; ready for accounts).
2. **Creator** — job (Wayfarer/Ranger/Arcanist/Bandit), body, skin, hair style+color, top tint, accessory, weapon preview, Game Boy palette. Saved to localStorage.
3. **World** — one large open map (town → meadow → woods → ruins gate), day/night, quests,HUD: HP/MP/XP, hotbar, minimap, quest tracker, chat, party frames.
4. **Solo, Online or Co-op** — play offline any time; **Play Online** drops you into the always-on public world (Embervale-1, overflow shards when full); or Host (5-char code) / Join a private room. One player per area simulates its enemies (auto-migrates when they leave); everyone can fight, kills credit every contributor, loot is per player. Auto-reconnect, server-side character saves (anonymous device token) with localStorage fallback. Status pill (bottom-left) shows server / ping / players.

## Project layout

```
public/assets/      seeded CC0 art/audio (see CREDITS.md)
src/config.js       world/job tuning
src/core/           events, save, gameboy palette
src/data/           jobs, customization, zones
src/entities/       ModularPlayer, RemotePlayer, Enemy
src/world/          overworld map builder
src/scenes/         Boot, Title, Creator, World, UI overlay
src/systems/        audio, daynight
src/net/            NetworkManager, WorldSync (colyseus host-relay)
server/             thin Colyseus relay (Railway)
tools/copy_assets.mjs  re-seed assets from ../rpg-foundation
```
