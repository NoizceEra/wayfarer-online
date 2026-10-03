/**
 * worldBosses.js — World boss definitions and spawn-window rules for Wayfarer Online.
 * Imported by server scheduler and client UI. All times are expressed in UTC minutes
 * so windows stay consistent for a global player base.
 */

export const WORLD_BOSS_TYPES = Object.freeze({
  VOID_LEVIATHAN: 'void_leviathan',
  SOLAR_PHOENIX: 'solar_phoenix',
  GLITCH_TITAN: 'glitch_titan',
});

export const WORLD_BOSS_STATES = Object.freeze({
  DORMANT: 'dormant',
  ANNOUNCED: 'announced',
  SPAWNING: 'spawning',
  ALIVE: 'alive',
  DEFEATED: 'defeated',
  DESPAWNED: 'despawned',
});

export const LOOT_TYPES = Object.freeze({
  GOLD: 'gold',
  TOKEN: 'token',
  GEAR: 'gear',
  COSMETIC: 'cosmetic',
});

export const RARITIES = Object.freeze({
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
});

const RARITY_WEIGHTS = Object.freeze({
  [RARITIES.COMMON]: 50,
  [RARITIES.UNCOMMON]: 30,
  [RARITIES.RARE]: 14,
  [RARITIES.EPIC]: 5,
  [RARITIES.LEGENDARY]: 1,
});

function weightedPick(table, luck = 0) {
  if (!table || table.length === 0) return null;
  const total = table.reduce((sum, entry) => sum + (entry.weight || 0) + luck, 0);
  if (total <= 0) return table[0];
  let roll = Math.random() * total;
  for (const entry of table) {
    roll -= (entry.weight || 0) + luck;
    if (roll <= 0) return entry;
  }
  return table[table.length - 1];
}

export function rollWorldBossLoot(bossDef, participationTier = 'participant', luck = 0) {
  const rewards = [];
  const base = bossDef?.rewards || {};

  // Gold reward scaled by participation tier.
  const goldScale = { participant: 1, combatant: 1.35, slayer: 1.8 };
  const scale = goldScale[participationTier] || 1;
  if (base.goldMin != null && base.goldMax != null) {
    const amount = Math.floor(
      (base.goldMin + Math.random() * (base.goldMax - base.goldMin + 1)) * scale
    );
    rewards.push({ type: LOOT_TYPES.GOLD, amount });
  }

  // Token points reward.
  if (base.tokenMin != null && base.tokenMax != null) {
    const amount = Math.floor(
      base.tokenMin + Math.random() * (base.tokenMax - base.tokenMin + 1)
    );
    rewards.push({ type: LOOT_TYPES.TOKEN, amount });
  }

  // Chance at a gear drop.
  if (base.gear && Math.random() < (base.gear.chance || 0)) {
    const entry = weightedPick(base.gear.items, luck);
    if (entry) {
      rewards.push({
        ...entry,
        type: LOOT_TYPES.GEAR,
        uid: `${entry.id}_${Math.random().toString(36).slice(2, 9)}`,
        rarityScore: RARITY_WEIGHTS[entry.rarity] || 1,
      });
    }
  }

  // Chance at a cosmetic drop.
  if (base.cosmetic && Math.random() < (base.cosmetic.chance || 0)) {
    const entry = weightedPick(base.cosmetic.items, luck);
    if (entry) {
      rewards.push({
        ...entry,
        type: LOOT_TYPES.COSMETIC,
        uid: `${entry.id}_${Math.random().toString(36).slice(2, 9)}`,
        rarityScore: RARITY_WEIGHTS[entry.rarity] || 1,
      });
    }
  }

  return rewards;
}

export function getWorldBossById(id) {
  return WORLD_BOSSES.find((b) => b.id === id) || null;
}

export function getNextBossInRotation(afterId = null) {
  const ids = WORLD_BOSSES.map((b) => b.id);
  const idx = ids.indexOf(afterId);
  const nextIdx = idx >= 0 ? (idx + 1) % ids.length : 0;
  return WORLD_BOSSES[nextIdx];
}

// Spawn windows are expressed in minutes-of-day UTC for deterministic rotation.
export const SPAWN_WINDOWS = Object.freeze([
  { start: 60, end: 180 },   // 01:00–03:00 UTC
  { start: 420, end: 540 },  // 07:00–09:00 UTC
  { start: 780, end: 900 },  // 13:00–15:00 UTC
  { start: 1140, end: 1320 },// 19:00–22:00 UTC
]);

export function pickSpawnWindow(seedDate = new Date()) {
  const minutesOfDay = (seedDate.getUTCHours() * 60) + seedDate.getUTCMinutes();
  // Select the next window whose start is after the current time; otherwise wrap to first window tomorrow.
  for (const w of SPAWN_WINDOWS) {
    if (w.start > minutesOfDay) return { ...w, dayOffset: 0 };
  }
  return { ...SPAWN_WINDOWS[0], dayOffset: 1 };
}

export const WORLD_BOSSES = Object.freeze([
  {
    id: WORLD_BOSS_TYPES.VOID_LEVIATHAN,
    name: 'Void Leviathan',
    title: 'Devourer of Blocks',
    description: 'A colossal serpent that swims through empty mempool depths and breaches into the world when congestion fades.',
    level: 20,
    hp: 250000,
    damage: 55,
    texture: 'boss.void_leviathan',
    abilities: ['abyssal_maw', 'mempool_drain', 'tidal_void'],
    spawnLocation: { zone: 'twilight_atoll', x: 1620, y: 840 },
    announceLeadMs: 15 * 60 * 1000, // 15 minutes public warning
    spawnWindowMin: 15,
    despawnMin: 60,
    rewards: {
      goldMin: 800,
      goldMax: 1400,
      tokenMin: 5,
      tokenMax: 12,
      gear: {
        chance: 0.35,
        items: [
          { id: 'leviathan_fang', name: 'Leviathan Fang', rarity: RARITIES.EPIC, slot: 'weapon', stats: { atk: 30, crit: 7, lifesteal: 4 }, weight: 6 },
          { id: 'abyssal_plate', name: 'Abyssal Plate', rarity: RARITIES.RARE, slot: 'chest', stats: { def: 22, hp: 55 }, weight: 18 },
        ],
      },
      cosmetic: {
        chance: 0.12,
        items: [
          { id: 'void_fin_cape', name: 'Void Fin Cape', rarity: RARITIES.LEGENDARY, slot: 'back', weight: 3 },
          { id: 'leviathan_aura', name: 'Leviathan Aura', rarity: RARITIES.EPIC, slot: 'aura', weight: 8 },
        ],
      },
    },
  },
  {
    id: WORLD_BOSS_TYPES.SOLAR_PHOENIX,
    name: 'Solar Phoenix',
    title: 'Minting Flame',
    description: 'A blazing wyrm born from the first genesis block. Its arrival heralds brief, fiery bull runs.',
    level: 20,
    hp: 220000,
    damage: 62,
    texture: 'boss.solar_phoenix',
    abilities: ['solar_flare', 'minting_rush', 'rebirth'],
    spawnLocation: { zone: 'solar_citadel', x: 3020, y: 1240 },
    announceLeadMs: 15 * 60 * 1000,
    spawnWindowMin: 15,
    despawnMin: 60,
    rewards: {
      goldMin: 900,
      goldMax: 1500,
      tokenMin: 6,
      tokenMax: 14,
      gear: {
        chance: 0.35,
        items: [
          { id: 'phoenix_talon', name: 'Phoenix Talon', rarity: RARITIES.EPIC, slot: 'weapon', stats: { atk: 28, crit: 9 }, weight: 7 },
          { id: 'solar_crown', name: 'Solar Crown', rarity: RARITIES.RARE, slot: 'head', stats: { def: 16, hp: 35 }, weight: 20 },
        ],
      },
      cosmetic: {
        chance: 0.12,
        items: [
          { id: 'ash_wings', name: 'Ash Wings', rarity: RARITIES.LEGENDARY, slot: 'back', weight: 3 },
          { id: 'ember_aura', name: 'Ember Aura', rarity: RARITIES.EPIC, slot: 'aura', weight: 9 },
        ],
      },
    },
  },
  {
    id: WORLD_BOSS_TYPES.GLITCH_TITAN,
    name: 'Glitch Titan',
    title: 'Consensus Error',
    description: 'A malformed golem assembled from failed transactions. Its presence corrupts terrain and distorts hit feedback.',
    level: 20,
    hp: 300000,
    damage: 48,
    texture: 'boss.glitch_titan',
    abilities: ['fork_split', 'reorg_stomp', 'transaction_spike'],
    spawnLocation: { zone: 'corrupted_foundry', x: 1180, y: 2100 },
    announceLeadMs: 15 * 60 * 1000,
    spawnWindowMin: 15,
    despawnMin: 60,
    rewards: {
      goldMin: 750,
      goldMax: 1300,
      tokenMin: 5,
      tokenMax: 12,
      gear: {
        chance: 0.35,
        items: [
          { id: 'glitch_greatsword', name: 'Glitch Greatsword', rarity: RARITIES.EPIC, slot: 'weapon', stats: { atk: 32, crit: 5 }, weight: 7 },
          { id: 'corrupt_gauntlets', name: 'Corrupt Gauntlets', rarity: RARITIES.RARE, slot: 'hands', stats: { def: 12, atk: 8 }, weight: 19 },
        ],
      },
      cosmetic: {
        chance: 0.12,
        items: [
          { id: 'glitch_shell', name: 'Glitch Shell', rarity: RARITIES.LEGENDARY, slot: 'aura', weight: 3 },
          { id: 'corrupt_mask', name: 'Corrupt Mask', rarity: RARITIES.RARE, slot: 'head', weight: 11 },
        ],
      },
    },
  },
]);
