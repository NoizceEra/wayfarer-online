/**
 * dungeons.js — Dungeon definitions for Wayfarer Online LFG instances.
 * Contains metadata, mob packs, mini/final bosses, and weighted loot tables.
 */

export const LOOT_TYPES = Object.freeze({
  GEAR: 'gear',
  COSMETIC: 'cosmetic',
  GOLD: 'gold',
  TOKEN: 'token',
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

export function expandPack(pack, prefix = 'e') {
  const out = [];
  for (let i = 0; i < pack.count; i += 1) {
    const base = pack.enemies[i % pack.enemies.length];
    out.push({
      uid: `${prefix}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      id: base.id,
      name: base.name,
      hp: base.hp,
      maxHp: base.hp,
      damage: base.damage,
      texture: base.texture,
      alive: true,
    });
  }
  return out;
}

export function rollLoot(dungeon, luck = 0, rolls = 2) {
  const loot = [];
  const table = dungeon?.lootTable || [];
  for (let i = 0; i < rolls; i += 1) {
    const entry = weightedPick(table, luck);
    if (!entry) continue;
    if (entry.type === LOOT_TYPES.GOLD) {
      const amount = Math.floor(
        (entry.amountMin || 0) + Math.random() * ((entry.amountMax || entry.amountMin || 0) - (entry.amountMin || 0) + 1)
      );
      loot.push({ ...entry, amount });
    } else if (entry.type === LOOT_TYPES.TOKEN) {
      const amount = Math.floor(
        (entry.amountMin || 0) + Math.random() * ((entry.amountMax || entry.amountMin || 0) - (entry.amountMin || 0) + 1)
      );
      loot.push({ ...entry, amount });
    } else {
      const rarity = entry.rarity || RARITIES.COMMON;
      loot.push({
        ...entry,
        uid: `${entry.id}_${Math.random().toString(36).slice(2, 9)}`,
        rarityScore: RARITY_WEIGHTS[rarity] || 1,
      });
    }
  }
  return loot;
}

export function getDungeonById(id) {
  return DUNGEONS.find((d) => d.id === id) || null;
}

export const DUNGEONS = Object.freeze([
  {
    id: 'ruins_of_nebula',
    name: 'Ruins of Nebula',
    description: 'Collapsed Solana validator outpost overrun by glitch-mobs and rogue security.',
    level: 5,
    minPlayers: 1,
    maxPlayers: 4,
    durationMin: 8,
    trashPacks: [
      {
        name: 'Shard Crawlers',
        count: 3,
        enemies: [
          { id: 'glitch_mite', name: 'Glitch Mite', hp: 45, damage: 8, texture: 'mob.mite' },
        ],
      },
      {
        name: 'Nebula Bats',
        count: 2,
        enemies: [
          { id: 'nebula_bat', name: 'Nebula Bat', hp: 60, damage: 10, texture: 'mob.bat' },
        ],
      },
    ],
    miniBoss: {
      id: 'corrupt_warden',
      name: 'Corrupt Warden',
      hp: 280,
      damage: 18,
      texture: 'mob.warden',
      abilities: ['shield_pulse'],
    },
    finalBoss: {
      id: 'nebula_colossus',
      name: 'Nebula Colossus',
      hp: 600,
      damage: 28,
      texture: 'mob.colossus',
      abilities: ['nova_beam', 'glitch_field'],
    },
    lootTable: [
      { id: 'nebula_blade', name: 'Nebula Blade', type: LOOT_TYPES.GEAR, rarity: RARITIES.RARE, slot: 'weapon', stats: { atk: 12, crit: 3 }, weight: 15 },
      { id: 'warden_helm', name: 'Warden Helm', type: LOOT_TYPES.GEAR, rarity: RARITIES.UNCOMMON, slot: 'head', stats: { def: 8, hp: 20 }, weight: 25 },
      { id: 'mite_glow_cape', name: 'Mite-Glow Cape', type: LOOT_TYPES.COSMETIC, rarity: RARITIES.RARE, slot: 'back', weight: 10 },
      { id: 'nebula_gold', name: 'Gold', type: LOOT_TYPES.GOLD, amountMin: 120, amountMax: 240, weight: 50 },
    ],
  },
  {
    id: 'solar_forge',
    name: 'Solar Forge',
    description: 'Molten minting halls where flame constructs guard forgotten private keys.',
    level: 12,
    minPlayers: 1,
    maxPlayers: 3,
    durationMin: 10,
    trashPacks: [
      {
        name: 'Ember Golems',
        count: 2,
        enemies: [
          { id: 'ember_golem', name: 'Ember Golem', hp: 120, damage: 16, texture: 'mob.golem' },
        ],
      },
      {
        name: 'Spark Swarm',
        count: 4,
        enemies: [
          { id: 'spark_sprite', name: 'Spark Sprite', hp: 40, damage: 12, texture: 'mob.spark' },
        ],
      },
    ],
    miniBoss: {
      id: 'forge_keeper',
      name: 'Forge Keeper',
      hp: 500,
      damage: 26,
      texture: 'mob.forge_keeper',
      abilities: ['molten_armor', 'heat_wave'],
    },
    finalBoss: {
      id: 'solar_serpent',
      name: 'Solar Serpent',
      hp: 950,
      damage: 36,
      texture: 'mob.serpent',
      abilities: ['solar_flare', 'tail_sweep', 'inferno_rush'],
    },
    lootTable: [
      { id: 'solar_saber', name: 'Solar Saber', type: LOOT_TYPES.GEAR, rarity: RARITIES.EPIC, slot: 'weapon', stats: { atk: 22, crit: 6 }, weight: 8 },
      { id: 'forge_plate', name: 'Forge Plate', type: LOOT_TYPES.GEAR, rarity: RARITIES.RARE, slot: 'chest', stats: { def: 18, hp: 40 }, weight: 18 },
      { id: 'ember_aura', name: 'Ember Aura', type: LOOT_TYPES.COSMETIC, rarity: RARITIES.EPIC, slot: 'aura', weight: 6 },
      { id: 'forge_gold', name: 'Gold', type: LOOT_TYPES.GOLD, amountMin: 280, amountMax: 520, weight: 45 },
      { id: 'forge_token', name: 'Wayfarer Token', type: LOOT_TYPES.TOKEN, amountMin: 1, amountMax: 3, weight: 23 },
    ],
  },
  {
    id: 'vault_of_shadows',
    name: 'Vault of Shadows',
    description: 'Deep cold-storage vault haunted by phisher wraiths and ledger revenants.',
    level: 18,
    minPlayers: 1,
    maxPlayers: 4,
    durationMin: 12,
    trashPacks: [
      {
        name: 'Phisher Wraiths',
        count: 3,
        enemies: [
          { id: 'phisher_wraith', name: 'Phisher Wraith', hp: 110, damage: 22, texture: 'mob.wraith' },
        ],
      },
      {
        name: 'Ledger Revenants',
        count: 2,
        enemies: [
          { id: 'ledger_revenant', name: 'Ledger Revenant', hp: 180, damage: 20, texture: 'mob.revenant' },
        ],
      },
    ],
    miniBoss: {
      id: 'vault_sentinel',
      name: 'Vault Sentinel',
      hp: 750,
      damage: 34,
      texture: 'mob.sentinel',
      abilities: ['shadow_bind', 'drain_life'],
    },
    finalBoss: {
      id: 'void_whale',
      name: 'Void Whale',
      hp: 1400,
      damage: 48,
      texture: 'mob.void_whale',
      abilities: ['abyssal_gaze', 'phantom_breach', 'cold_storage'],
    },
    lootTable: [
      { id: 'void_scythe', name: 'Void Scythe', type: LOOT_TYPES.GEAR, rarity: RARITIES.LEGENDARY, slot: 'weapon', stats: { atk: 36, crit: 10, lifesteal: 5 }, weight: 3 },
      { id: 'shadow_cloak', name: 'Shadow Cloak', type: LOOT_TYPES.GEAR, rarity: RARITIES.EPIC, slot: 'chest', stats: { def: 24, evasion: 8 }, weight: 12 },
      { id: 'wraith_mask', name: 'Wraith Mask', type: LOOT_TYPES.COSMETIC, rarity: RARITIES.LEGENDARY, slot: 'head', weight: 4 },
      { id: 'abyss_gold', name: 'Gold', type: LOOT_TYPES.GOLD, amountMin: 500, amountMax: 900, weight: 40 },
      { id: 'abyss_token', name: 'Wayfarer Token', type: LOOT_TYPES.TOKEN, amountMin: 2, amountMax: 6, weight: 41 },
    ],
  },
]);
