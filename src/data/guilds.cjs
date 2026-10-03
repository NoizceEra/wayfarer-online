/**
 * guilds.js — Guild data model, ranks, permissions, EXP/level curve,
 * treasury costs, and member perks for Wayfarer Online.
 * All costs are in gold only (no crypto).
 */

const GUILD_RANKS = Object.freeze({
  MEMBER: 'member',
  OFFICER: 'officer',
  LEADER: 'leader',
});

const GUILD_PERMISSIONS = Object.freeze({
  INVITE: 'invite',
  KICK: 'kick',
  PROMOTE: 'promote',
  DEMOTE: 'demote',
  EDIT_MOTD: 'editMotd',
  UPGRADE_HALL: 'upgradeHall',
  MANAGE_TREASURY: 'manageTreasury',
});

const RANK_PERMISSIONS = Object.freeze({
  [GUILD_RANKS.MEMBER]: new Set([]),
  [GUILD_RANKS.OFFICER]: new Set([
    GUILD_PERMISSIONS.INVITE,
    GUILD_PERMISSIONS.KICK,
    GUILD_PERMISSIONS.PROMOTE,
    GUILD_PERMISSIONS.DEMOTE,
    GUILD_PERMISSIONS.EDIT_MOTD,
  ]),
  [GUILD_RANKS.LEADER]: new Set([
    GUILD_PERMISSIONS.INVITE,
    GUILD_PERMISSIONS.KICK,
    GUILD_PERMISSIONS.PROMOTE,
    GUILD_PERMISSIONS.DEMOTE,
    GUILD_PERMISSIONS.EDIT_MOTD,
    GUILD_PERMISSIONS.UPGRADE_HALL,
    GUILD_PERMISSIONS.MANAGE_TREASURY,
  ]),
});

function hasPermission(rank, permission) {
  const set = RANK_PERMISSIONS[rank];
  return Boolean(set && set.has(permission));
}

function getRankPermissions(rank) {
  return Array.from(RANK_PERMISSIONS[rank] || []);
}

const GUILD_MAX_LEVEL = 10;

function expForLevel(level) {
  if (level <= 1) return 0;
  // 500 base + quadratic growth
  return Math.floor(500 * (level - 1) ** 1.8);
}

function upgradeCostForLevel(level) {
  // cost to upgrade FROM this level to the next
  if (level >= GUILD_MAX_LEVEL) return null;
  return Math.floor(1000 * (level + 1) ** 1.6);
}

function contributionReward(exp) {
  // 1 gold => 1 guild EXP, capped daily
  return Math.max(0, Math.floor(exp));
}

const GUILD_PERKS = Object.freeze([
  {
    id: 'token_points',
    name: 'Token Insight',
    description: '+%s%% token-point earning',
    baseValue: 2,
    perLevel: 3,
    maxLevel: 3,
    cost(level) {
      return Math.floor(800 * (level + 1) ** 1.5);
    },
  },
  {
    id: 'market_fee',
    name: 'Merchant License',
    description: '-%s%% market fee',
    baseValue: 10,
    perLevel: 10,
    maxLevel: 3,
    cost(level) {
      return Math.floor(1000 * (level + 1) ** 1.6);
    },
  },
  {
    id: 'daily_gold',
    name: 'Coffers',
    description: '+%s%% daily reward gold',
    baseValue: 5,
    perLevel: 5,
    maxLevel: 3,
    cost(level) {
      return Math.floor(600 * (level + 1) ** 1.4);
    },
  },
]);

function getPerkValue(perkId, level) {
  const perk = GUILD_PERKS.find((p) => p.id === perkId);
  if (!perk || level <= 0) return 0;
  return perk.baseValue + (level - 1) * perk.perLevel;
}

function getPerkDescription(perkId, level) {
  const perk = GUILD_PERKS.find((p) => p.id === perkId);
  if (!perk) return '';
  return perk.description.replace('%s', String(getPerkValue(perkId, level)));
}

function getPerkCost(perkId, level) {
  const perk = GUILD_PERKS.find((p) => p.id === perkId);
  if (!perk || level >= perk.maxLevel) return null;
  return perk.cost(level);
}

function createGuild({ id, name, tag, leaderId, leaderName }) {
  return {
    id: id || `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: String(name || 'Unnamed Guild'),
    tag: String(tag || 'TAG').toUpperCase().slice(0, 4),
    level: 1,
    exp: 0,
    treasury: 0,
    motd: 'Welcome to the guild!',
    hallLevel: 1,
    perks: {
      token_points: 0,
      market_fee: 0,
      daily_gold: 0,
    },
    members: {
      [leaderId]: {
        playerId: leaderId,
        name: leaderName || 'Leader',
        rank: GUILD_RANKS.LEADER,
        joinedAt: Date.now(),
        contributionToday: 0,
        contributionTotal: 0,
      },
    },
    invites: {},
    createdAt: Date.now(),
  };
}

function addGuildExp(guild, amount) {
  if (!guild || amount <= 0 || guild.level >= GUILD_MAX_LEVEL) return guild;
  let exp = guild.exp + amount;
  let level = guild.level;
  while (level < GUILD_MAX_LEVEL && exp >= expForLevel(level + 1)) {
    level += 1;
  }
  return { ...guild, exp, level };
}

function getNextLevelCost(guild) {
  return upgradeCostForLevel(guild?.level || 1);
}

function getProgressToNextLevel(guild) {
  if (!guild || guild.level >= GUILD_MAX_LEVEL) return 1;
  const prev = expForLevel(guild.level);
  const next = expForLevel(guild.level + 1);
  return typeof Phaser !== 'undefined' && Phaser?.Math?.Clamp
    ? Phaser.Math.Clamp((guild.exp - prev) / (next - prev), 0, 1)
    : Math.min(1, Math.max(0, (guild.exp - prev) / (next - prev)));
}

function canAffordUpgrade(guild) {
  const cost = getNextLevelCost(guild);
  if (cost == null) return false;
  return (guild?.treasury || 0) >= cost;
}

function upgradeGuildLevel(guild) {
  const cost = getNextLevelCost(guild);
  if (cost == null || (guild.treasury || 0) < cost) return guild;
  const upgraded = addGuildExp(guild, expForLevel(guild.level + 1) - guild.exp);
  return { ...upgraded, treasury: upgraded.treasury - cost };
}

function getMemberCount(guild) {
  return Object.keys(guild?.members || {}).length;
}

function getMemberRank(guild, playerId) {
  return guild?.members?.[playerId]?.rank || null;
}

const DAILY_CONTRIBUTION_CAP = 5000;

function contributeGold(guild, playerId, amount) {
  if (!guild || !guild.members[playerId] || amount <= 0) return guild;
  const member = guild.members[playerId];
  const remaining = Math.max(0, DAILY_CONTRIBUTION_CAP - member.contributionToday);
  const applied = Math.min(amount, remaining);
  if (applied <= 0) return guild;
  const next = typeof structuredClone === 'function' ? structuredClone(guild) : JSON.parse(JSON.stringify(guild));
  next.members[playerId].contributionToday += applied;
  next.members[playerId].contributionTotal += applied;
  next.treasury += applied;
  return addGuildExp(next, contributionReward(applied));
}

function getGuildBonuses(guild) {
  if (!guild) return { tokenPoints: 0, marketFeeDiscount: 0, dailyGoldBonus: 0 };
  return {
    tokenPoints: getPerkValue('token_points', guild.perks?.token_points || 0),
    marketFeeDiscount: getPerkValue('market_fee', guild.perks?.market_fee || 0),
    dailyGoldBonus: getPerkValue('daily_gold', guild.perks?.daily_gold || 0),
  };
}

function computeTokenPoints(basePoints, guild) {
  const bonus = getGuildBonuses(guild).tokenPoints;
  return Math.floor(basePoints * (1 + bonus / 100));
}

function computeMarketFee(baseRate, guild) {
  const discount = getGuildBonuses(guild).marketFeeDiscount;
  return Math.max(0, baseRate - discount / 100);
}

function computeDailyGold(baseGold, guild) {
  const bonus = getGuildBonuses(guild).dailyGoldBonus;
  return Math.floor(baseGold * (1 + bonus / 100));
}

module.exports = {
  GUILD_RANKS,
  GUILD_PERMISSIONS,
  GUILD_MAX_LEVEL,
  GUILD_PERKS,
  DAILY_CONTRIBUTION_CAP,
  hasPermission,
  getRankPermissions,
  expForLevel,
  upgradeCostForLevel,
  contributionReward,
  getPerkValue,
  getPerkDescription,
  getPerkCost,
  createGuild,
  addGuildExp,
  getNextLevelCost,
  getProgressToNextLevel,
  canAffordUpgrade,
  upgradeGuildLevel,
  getMemberCount,
  getMemberRank,
  contributeGold,
  getGuildBonuses,
  computeTokenPoints,
  computeMarketFee,
  computeDailyGold,
};
