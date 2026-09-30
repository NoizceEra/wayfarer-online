# Wayfarer Online — asset shortlist & MMO systems roadmap

> Status: the asset list below is from web search snippets + prior knowledge. The
> build sandbox blocks kenney.nl / opengameart.org / itch.io, so **licences and
> download links are NOT verified** — confirm each licence on the source page
> before bundling, and add it to CREDITS.md.

## Asset candidates (prefer CC0; avoid CC-BY-SA/GPL unless attribution is acceptable)
| Need | Candidate | Licence (verify) | Notes |
|---|---|---|---|
| Tiles / towns / interiors | Kenney *Tiny Town*, *Tiny Dungeon*, *Roguelike RPG Pack*, *RPG Urban Pack* | CC0 | 16px, matches current look; enables interiors, more maps |
| Extra characters / NPC variety | Kenney *Roguelike Characters*, *Tiny Dungeon* heroes | CC0 | hundreds of 16px bodies; good NPC crowd |
| Wearables (paper doll) | Ninja Adventure (already bundled) + OpenGameArt "Top Down 2D JRPG 16x16 Characters" collection | check per-asset | need layered hair/hats/armour sheets; LPC is CC-BY-SA (attribution required) |
| Monsters / dungeon | 0x72 *DungeonTileset II* | CC0 | dungeon interiors, more enemy types |
| UI | Kenney *UI Pack – RPG Expansion*, *Game Icons* | CC0 | unified icon sheet for gear/skills |
| Icons (gear/skills) | game-icons.net | CC-BY 3.0 (attribution) | thousands of item icons |
| Music / SFX | Kenney audio packs, OpenGameArt CC0 music | CC0 | more zone themes |

## Reference-game systems to borrow (Ragnarok Online; Heartwood Online details unverified)
- **Stats (RO):** STR (melee atk/weight), AGI (attack speed/dodge), VIT (HP/def), INT (magic atk/SP), DEX (accuracy/cast), LUK (crit). Points per level, cost rises with stat value.
- **Jobs:** Novice → 1st jobs (Swordsman/Archer/Mage/Thief/Acolyte/Merchant) → 2nd jobs; job level gives skill points.
- **MMO feel:** party + shared XP, chat channels, shops/trade, storage, refine/upgrade gear, cards/sockets, pets, quest boards, towns + warps, PvE dungeons, world bosses.

## Planned build order
1. Stat allocation + level curve + derived stats (STR/AGI/VIT/INT/DEX/LUK).
2. Classes (extend jobs.js): base class → specialisation at Lv10, per-class skill trees.
3. Equipment slots (head/face/body/back/weapon/off-hand) with stat bonuses + layered art; shop + drops + inventory UI.
4. More maps: interiors (inn/shop), a dungeon, a coast/dock town, warps between maps.
5. MMO polish: party UI, emotes, trade, bosses.
