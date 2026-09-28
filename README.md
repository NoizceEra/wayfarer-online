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

Co-op server (thin relay, host-authoritative — same model as Lanternfall):

```powershell
cd server
npm install
npm start             # ws://localhost:2567
```

Set the client URL via `.env`: `VITE_SERVER_URL=ws://localhost:2567`
(production: your Railway URL).

## Deploy

- **Vercel (client):** import this folder, framework = Vite, build = `npm run build`, output = `dist`.
- **Railway (co-op relay):** deploy `server/` (railway.json at root points at it).
  Set `PORT` (provided by Railway) — no DB needed for v1.

## Controls

- Move: WASD / arrows (or touch stick) · Interact: E · Attack: J / click / ATK button
- Ability 1-4: 1-4 (clickable hotbar) · Potion: Q · Skill shortcut: SKL button casts slot 2
- Gear: I or BAG button (equip from loot/shop) · Shop: talk to Maren (E)
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
4. **Solo or Co-op** — play offline any time. Host (5-char code) or Join from Title → Co-op; host is authoritative for enemies/flags, guests keep their own XP/gold.

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
