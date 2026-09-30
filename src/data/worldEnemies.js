// Enemy defs for the expansion maps (Driftwood Beach, Crypt, Frostpeak).
// Merged into the shared ENEMY_TABLE (read lazily by Enemy.js) so the original
// jobs.js table stays untouched. Extra optional fields understood by Enemy /
// WorldScene: scale, tint, dmg (contact damage override), drops [{id,chance}]
// (existing gear ids), boss, respawn (ms).
import { ENEMY_TABLE } from './jobs.js';

Object.assign(ENEMY_TABLE, {
  // — Driftwood Beach (Dock Town) —
  shorecrab: {
    name: 'Shore Crab', sprite: 'YellowsBat', hp: 44, atk: 8, xp: 15, gold: [3, 8], dmg: 3, zones: ['dock_beach'],
    drops: [{ id: 'feather_charm', chance: 0.04 }, { id: 'leather_cap', chance: 0.03 }],
  },
  // — Crypt of Ashenmoor —
  bonesentinel: {
    name: 'Bone Sentinel', sprite: 'SkullBlue', hp: 105, atk: 19, xp: 44, gold: [6, 14], dmg: 7, zones: ['crypt'],
    drops: [{ id: 'iron_helm', chance: 0.06 }, { id: 'iron_greatblade', chance: 0.04 }, { id: 'bone_veil', chance: 0.05 }],
  },
  gravebat: {
    name: 'Grave Bat', sprite: 'Owl2', hp: 72, atk: 17, xp: 38, gold: [5, 12], dmg: 6, zones: ['crypt'],
    drops: [{ id: 'mage_hat', chance: 0.05 }, { id: 'tide_pearl', chance: 0.04 }],
  },
  // Mini-boss: telegraphed Bone Slam / Grave Charge / (phase 2) Dirge Nova — see entities/Boss.js
  gravemaw: {
    name: 'Warden Gravemaw', sprite: 'Grey_Trex', hp: 640, atk: 26, xp: 420, gold: [140, 220], dmg: 10,
    scale: 2.1, boss: true, respawn: 90000, zones: ['crypt'],
    drops: [{ id: 'tide_plate', chance: 1 }, { id: 'tidebrand', chance: 0.4 }, { id: 'tide_crown', chance: 0.35 }],
  },
  // — Frostpeak Pass —
  frostwisp: {
    name: 'Frost Wisp', sprite: 'Flam2', hp: 88, atk: 20, xp: 46, gold: [7, 15], dmg: 8, zones: ['frost'],
    drops: [{ id: 'mage_robe', chance: 0.05 }, { id: 'ember_wand', chance: 0.04 }, { id: 'tide_pearl', chance: 0.04 }],
  },
  rimecrawler: {
    name: 'Rime Crawler', sprite: 'Larva2', hp: 130, atk: 22, xp: 54, gold: [8, 18], dmg: 9, zones: ['frost'],
    drops: [{ id: 'iron_mail', chance: 0.06 }, { id: 'iron_greatblade', chance: 0.05 }, { id: 'ember_charm', chance: 0.04 }],
  },
});

// Roll a def-level gear drop (for enemies not listed in gear.js drop tables).
export function rollDefDrop(typeId, gearById) {
  const def = ENEMY_TABLE[typeId];
  if (!def || !def.drops) return null;
  for (const d of def.drops) {
    if (gearById(d.id) && Math.random() < d.chance) return d.id;
  }
  return null;
}
