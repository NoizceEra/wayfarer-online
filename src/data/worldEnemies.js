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

// Combat behaviour for every enemy (base table in jobs.js + the ones above).
//  lv      — level the base stats are tuned for (instances roll lv..lv+2 within the zone range)
//  ai      — hopper (slow lunge) | swarm (fast darting, circles) | charger (long wind-up dash)
//            | ranged (kites + fires orbs) | melee (standard lunge)
//  aggro   — proactive aggro radius (px); social — pulls nearby kin into the fight
//  flee    — HP fraction below which it runs away (then returns when healed a bit)
//  inflict — status applied on hit {id, chance}; spd — move speed multiplier
const BEHAVIOUR = {
  dewslime:     { lv: 1,  ai: 'hopper',  aggro: 70,  social: true,  spd: 0.8 },
  mossbat:      { lv: 2,  ai: 'swarm',   aggro: 95,  social: true,  spd: 1.35, flee: 0.2 },
  thornmite:    { lv: 4,  ai: 'charger', aggro: 90,  inflict: { id: 'poison', chance: 0.35 } },
  capling:      { lv: 5,  ai: 'melee',   aggro: 70,  flee: 0.25, inflict: { id: 'slow', chance: 0.3 } },
  willowisp:    { lv: 6,  ai: 'ranged',  aggro: 115, inflict: { id: 'burn', chance: 0.4 }, shot: 0xa6ff6a },
  bogspirit:    { lv: 9,  ai: 'melee',   aggro: 95,  social: true, inflict: { id: 'slow', chance: 0.35 } },
  rustskull:    { lv: 8,  ai: 'charger', aggro: 100, social: true, inflict: { id: 'bleed', chance: 0.35 } },
  tideeye:      { lv: 10, ai: 'ranged',  aggro: 130, inflict: { id: 'stun', chance: 0.18 }, shot: 0x6ad8ff },
  shorecrab:    { lv: 3,  ai: 'melee',   aggro: 75,  social: true, flee: 0.2, inflict: { id: 'bleed', chance: 0.25 } },
  bonesentinel: { lv: 10, ai: 'melee',   aggro: 100, social: true, spd: 0.85, inflict: { id: 'stun', chance: 0.15 } },
  gravebat:     { lv: 9,  ai: 'swarm',   aggro: 120, social: true, spd: 1.4, inflict: { id: 'bleed', chance: 0.3 } },
  gravemaw:     { lv: 13, ai: 'boss' },
  frostwisp:    { lv: 12, ai: 'ranged',  aggro: 125, inflict: { id: 'slow', chance: 0.5 }, shot: 0xbfe8ff },
  rimecrawler:  { lv: 13, ai: 'charger', aggro: 95,  social: true, inflict: { id: 'poison', chance: 0.3 } },
};
for (const [id, b] of Object.entries(BEHAVIOUR)) if (ENEMY_TABLE[id]) Object.assign(ENEMY_TABLE[id], b);

// Roll a def-level gear drop (for enemies not listed in gear.js drop tables).
export function rollDefDrop(typeId, gearById) {
  const def = ENEMY_TABLE[typeId];
  if (!def || !def.drops) return null;
  for (const d of def.drops) {
    if (gearById(d.id) && Math.random() < d.chance) return d.id;
  }
  return null;
}
