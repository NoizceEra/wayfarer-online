/**
 * seasons.js — Season pass data for Wayfarer Online.
 * Defines the 50-tier reward track, XP sources, premium upgrade cost,
 * and anti-farm caps. Imported by both client and server.
 */

export const SEASON_CONFIG = Object.freeze({
  id: 'season_01_remnant',
  name: 'Remnant Rising',
  premiumCostGold: 2500,
  xpPerTier: 1500,
  maxTier: 50,
  dailyXpCap: 6500,
  sources: {
    dailyLogin: { base: 500, label: 'Daily Login' },
    kill: { base: 25, label: 'Monster Kill' },
    quest: { base: 400, label: 'Quest Complete' },
    dungeonClear: { base: 1200, label: 'Dungeon Clear' },
    pvpDuel: { base: 300, label: 'PvP Duel' },
  },
  // Per-source daily caps to resist bot farming.
  sourceCaps: {
    dailyLogin: 500,
    kill: 2000,
    quest: 3000,
    dungeonClear: 2400,
    pvpDuel: 1500,
  },
});

export const REWARD_TYPES = Object.freeze({
  GOLD: 'gold',
  TOKEN_POINTS: 'token_points',
  PREMIUM_REVIVE_TOKENS: 'premium_revive_tokens',
  PET_RENAME_TAG: 'pet_rename_tag',
  STASH_EXPANDER: 'stash_expander',
  COSMETIC: 'cosmetic',
});

export const COSMETICS = Object.freeze({
  aurora_cape: { id: 'aurora_cape', name: 'Aurora Cape', slot: 'back' },
  void_halo: { id: 'void_halo', name: 'Void Halo', slot: 'head' },
  ember_blade: { id: 'ember_blade', name: 'Ember Blade FX', slot: 'weapon_fx' },
  glitch_aura: { id: 'glitch_aura', name: 'Glitch Aura', slot: 'aura' },
  solana_trail: { id: 'solana_trail', name: 'Solana Trail', slot: 'trail' },
  remnant_title: { id: 'remnant_title', name: 'Remnant', slot: 'title' },
});

// Reward table factory helpers
function gold(amount) {
  return { type: REWARD_TYPES.GOLD, amount };
}
function tokens(amount) {
  return { type: REWARD_TYPES.TOKEN_POINTS, amount };
}
function revives(amount) {
  return { type: REWARD_TYPES.PREMIUM_REVIVE_TOKENS, amount };
}
function renameTag(amount = 1) {
  return { type: REWARD_TYPES.PET_RENAME_TAG, amount };
}
function stashSlots(amount) {
  return { type: REWARD_TYPES.STASH_EXPANDER, amount };
}
function cosmetic(id) {
  return { type: REWARD_TYPES.COSMETIC, cosmeticId: id, ...COSMETICS[id] };
}

export const SEASON_TIERS = Object.freeze((() => {
  const tiers = [];
  for (let tier = 1; tier <= 50; tier += 1) {
    tiers.push({
      tier,
      free: buildFreeReward(tier),
      premium: buildPremiumReward(tier),
    });
  }
  return tiers;
})());

function buildFreeReward(tier) {
  if (tier === 1) return gold(250);
  if (tier === 5) return tokens(25);
  if (tier === 10) return stashSlots(5);
  if (tier === 15) return gold(600);
  if (tier === 20) return tokens(50);
  if (tier === 25) return cosmetic('aurora_cape');
  if (tier === 30) return gold(1000);
  if (tier === 35) return tokens(75);
  if (tier === 40) return stashSlots(10);
  if (tier === 45) return gold(1500);
  if (tier === 50) return cosmetic('remnant_title');
  if (tier % 5 === 0) return tokens(15 + Math.floor(tier / 5) * 5);
  return gold(100 + tier * 10);
}

function buildPremiumReward(tier) {
  if (tier === 1) return cosmetic('void_halo');
  if (tier === 5) return revives(1);
  if (tier === 10) return cosmetic('ember_blade');
  if (tier === 15) return revives(2);
  if (tier === 20) return cosmetic('glitch_aura');
  if (tier === 25) return renameTag(1);
  if (tier === 30) return revives(3);
  if (tier === 35) return cosmetic('solana_trail');
  if (tier === 40) return renameTag(2);
  if (tier === 45) return revives(5);
  if (tier === 50) return cosmetic('remnant_title');
  if (tier % 5 === 0) return tokens(40 + Math.floor(tier / 5) * 10);
  if (tier % 2 === 0) return gold(200 + tier * 15);
  return revives(1);
}

export function getTier(tier) {
  return SEASON_TIERS[tier - 1] || null;
}

export function getRewardsForTier(tier, isPremium) {
  const t = getTier(tier);
  if (!t) return [];
  return isPremium ? [t.free, t.premium] : [t.free];
}

export function xpForTier(tier) {
  return Math.min(tier, SEASON_CONFIG.maxTier) * SEASON_CONFIG.xpPerTier;
}

export function tierForXp(xp) {
  return Math.min(
    SEASON_CONFIG.maxTier,
    Math.floor((xp || 0) / SEASON_CONFIG.xpPerTier)
  );
}

export function getProgressToNextTier(xp) {
  const tier = tierForXp(xp);
  if (tier >= SEASON_CONFIG.maxTier) return 1;
  const prev = tier * SEASON_CONFIG.xpPerTier;
  const next = (tier + 1) * SEASON_CONFIG.xpPerTier;
  return Math.min(1, Math.max(0, (xp - prev) / (next - prev)));
}

export default SEASON_TIERS;
