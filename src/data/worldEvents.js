// Timed open-world events. The schedule is a pure function of wall-clock time, so every client in
// the public world computes the SAME events without any server support (systems/worldEvents.js).
//   · every EVENT_SLOT_MS (6 min) one event is chosen from the rotation (seeded by the slot number,
//     never the same kind twice in a row); it starts 15-60 s into the slot and runs `dur` ms.
//   · every BOSS_SLOT_MS (10 min) a world boss appears at one of the arenas for BOSS_WINDOW_MS.
// Each client simulates its own copy of the encounter (same place, same time, same loot table);
// boss HP is scaled by the number of other players nearby. Rewards are per participant.
export const EVENT_SLOT_MS = 6 * 60 * 1000;
export const BOSS_SLOT_MS = 10 * 60 * 1000;
export const BOSS_WINDOW_MS = 7 * 60 * 1000;
export const WARN_MS = 30 * 1000;

export const EVENT_TYPES = [
  {
    id: 'slime', name: 'Slime King Rampage', kind: 'boss', boss: 'slimeking', dur: 4 * 60 * 1000, at: { tx: 70, ty: 37 }, where: 'Meadowfield, north of Thistle Town',
    text: 'Slime King Gloop has burst out of the ground in Meadowfield!', hint: 'north of Thistle Town',
    reward: { xp: 380, gold: [140, 220], mats: { slime_crown_gel: 1, slime_gel: 4 }, items: { medipack: 1 } }, consolation: { xp: 90, gold: [30, 50] }, ach: 'slimeking',
  },
  {
    id: 'star', name: 'Shooting Star', kind: 'star', dur: 3.5 * 60 * 1000, at: { tx: 92, ty: 50 }, where: 'Mosswood',
    text: 'A shooting star crashed into Mosswood - star fragments litter the crater!', hint: 'in Mosswood',
    nodes: 13,
  },
  {
    id: 'caravan', name: 'Merchant Caravan', kind: 'caravan', dur: 5 * 60 * 1000, area: 'dock', at: { tx: 23, ty: 17.4 }, where: 'the Dock Town plaza',
    text: 'A merchant caravan has pulled up at the Dock Town plaza with rare wares!', hint: 'in Coastal Dock Town',
  },
  {
    id: 'raid', name: 'Rust Skull Raid', kind: 'raid', dur: 4.5 * 60 * 1000, at: { tx: 44, ty: 95 }, where: 'Tidehollow Ruins', types: ['rustskull', 'rustskull', 'bogspirit'],
    text: 'Rust Skull raiders are marching on Tidehollow Ruins!', hint: 'in Tidehollow Ruins',
    reward: { xp: 520, gold: [180, 280], mats: { rust_scrap: 6 }, gear: { rarity: 'rare', epicChance: 0.05 } }, consolation: { xp: 120, gold: [40, 70] }, ach: 'raid',
  },
];

export const BOSS_ARENAS = [
  { id: 'meadow', name: 'Meadowfield', at: { tx: 30, ty: 50 } },
  { id: 'woods', name: 'Mosswood', at: { tx: 100, ty: 44 } },
  { id: 'ruins', name: 'Tidehollow Ruins', at: { tx: 44, ty: 98 } },
];
export const WORLD_BOSS = {
  type: 'worldtitan', name: 'Ancient Thornback',
  text: 'The ground shakes - the Ancient Thornback, a world boss, has awoken!',
  reward: { xp: 1800, gold: [420, 680], mats: { titan_heartstone: 1 }, potions: 4, gear: { rarity: 'rare+', epicChance: 0.45 } },
  consolation: { xp: 240, gold: [80, 140], mats: { star_fragment: 1 } },
  minDamageFrac: 0.15, // hp fraction you must take off it to earn the consolation reward
  hpPerPlayer: 0.6,     // +60% boss HP per other player within range when it spawns
};

// ——— deterministic schedule (pure; shared by every client) ———
export const hash32 = (n) => { let h = (Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b)) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16; return h >>> 0; };

export function slotEvent(slot) {
  const n = EVENT_TYPES.length;
  let idx = hash32(slot) % n;
  const prev = hash32(slot - 1) % n;
  if (idx === prev) idx = (idx + 1) % n;
  const def = EVENT_TYPES[idx];
  const start = slot * EVENT_SLOT_MS + 15000 + (hash32(slot * 31 + 7) % 45000);
  return { key: `e${slot}`, slot, def, start, end: start + def.dur };
}
export function bossForSlot(bslot) {
  const arena = BOSS_ARENAS[hash32(bslot * 17 + 3) % BOSS_ARENAS.length];
  const start = bslot * BOSS_SLOT_MS + 45000 + (hash32(bslot * 13 + 5) % 60000);
  return { key: `b${bslot}`, slot: bslot, arena, start, end: start + BOSS_WINDOW_MS };
}
// What is live / upcoming at wall-clock `now` (ms).
export function scheduleAt(now) {
  const slot = Math.floor(now / EVENT_SLOT_MS);
  const cands = [slotEvent(slot - 1), slotEvent(slot), slotEvent(slot + 1)];
  const active = cands.find((e) => now >= e.start && now < e.end) || null;
  const next = cands.find((e) => e.start > now) || null;
  const bslot = Math.floor(now / BOSS_SLOT_MS);
  const bc = [bossForSlot(bslot - 1), bossForSlot(bslot), bossForSlot(bslot + 1)];
  const boss = bc.find((e) => now >= e.start && now < e.end) || null;
  const nextBoss = bc.find((e) => e.start > now) || null;
  return { active, next, boss, nextBoss };
}
