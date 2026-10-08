/**
 * guildCore.js — Core guild state helpers shared by server handlers.
 */

const {
  createGuild,
  contributeGold,
  upgradeGuildLevel,
  getPerkCost,
  GUILD_PERKS,
  GUILD_RANKS,
  GUILD_MAX_LEVEL,
} = require('../shared/guilds.cjs');

const GUILD_CREATE_COST = 2000;
const MAX_MEMBERS = 50;

class GuildCore {
  constructor() {
    this.guilds = new Map();
    this.playerGuild = new Map();
  }

  getGuildFor(playerId) {
    const guildId = this.playerGuild.get(playerId);
    return guildId ? this.guilds.get(guildId) : null;
  }

  getMemberCount(guild) {
    return Object.keys(guild?.members || {}).length;
  }

  create(playerId, playerName, { name, tag }) {
    if (!name || !tag || String(tag).length < 2 || String(tag).length > 4) {
      return { error: 'invalid_name_or_tag' };
    }
    if (this.playerGuild.has(playerId)) return { error: 'already_in_guild' };

    const guild = createGuild({ name, tag, leaderId: playerId, leaderName: playerName });
    this.guilds.set(guild.id, guild);
    this.playerGuild.set(playerId, guild.id);
    return { ok: true, guild };
  }

  leave(playerId) {
    const guild = this.getGuildFor(playerId);
    if (!guild) return { error: 'not_in_guild' };
    const member = guild.members[playerId];
    if (!member) return { error: 'not_a_member' };

    delete guild.members[playerId];
    this.playerGuild.delete(playerId);

    const remaining = Object.keys(guild.members);
    if (remaining.length === 0) {
      this.guilds.delete(guild.id);
      return { ok: true, disbanded: true, guildId: guild.id };
    }

    if (member.rank === GUILD_RANKS.LEADER) {
      const sorted = Object.values(guild.members).sort((a, b) => a.joinedAt - b.joinedAt);
      const successor = sorted.find((m) => m.rank === GUILD_RANKS.OFFICER) || sorted[0];
      if (successor) successor.rank = GUILD_RANKS.LEADER;
    }

    return { ok: true, guild };
  }

  addInvite(guild, targetId, fromId) {
    if (this.getMemberCount(guild) >= MAX_MEMBERS) return { error: 'guild_full' };
    guild.invites[targetId] = {
      guildId: guild.id,
      guildName: guild.name,
      from: fromId,
      sentAt: Date.now(),
    };
    this.guilds.set(guild.id, guild);
    return { ok: true };
  }

  acceptInvite(playerId, playerName, guildId) {
    const guild = this.guilds.get(guildId);
    if (!guild) return { error: 'guild_not_found' };
    if (this.playerGuild.has(playerId)) return { error: 'already_in_guild' };
    if (!guild.invites[playerId]) return { error: 'no_invite' };
    if (this.getMemberCount(guild) >= MAX_MEMBERS) return { error: 'guild_full' };

    delete guild.invites[playerId];
    guild.members[playerId] = {
      playerId,
      name: playerName || playerId,
      rank: GUILD_RANKS.MEMBER,
      joinedAt: Date.now(),
      contributionToday: 0,
      contributionTotal: 0,
    };
    this.playerGuild.set(playerId, guild.id);
    return { ok: true, guild };
  }

  declineInvite(playerId, guildId) {
    const guild = this.guilds.get(guildId);
    if (guild && guild.invites[playerId]) {
      delete guild.invites[playerId];
      this.guilds.set(guild.id, guild);
    }
    return { ok: true };
  }

  removeMember(guild, targetId) {
    if (!guild.members[targetId]) return { error: 'not_a_member' };
    delete guild.members[targetId];
    this.playerGuild.delete(targetId);
    return { ok: true, guild };
  }

  promote(guild, targetId) {
    const target = guild.members[targetId];
    if (!target) return { error: 'not_a_member' };
    if (target.rank === GUILD_RANKS.LEADER) return { error: 'cannot_promote_leader' };
    if (target.rank === GUILD_RANKS.OFFICER) return { error: 'already_officer' };
    target.rank = GUILD_RANKS.OFFICER;
    return { ok: true, guild, target };
  }

  demote(guild, targetId) {
    const target = guild.members[targetId];
    if (!target) return { error: 'not_a_member' };
    if (target.rank !== GUILD_RANKS.OFFICER) return { error: 'not_an_officer' };
    target.rank = GUILD_RANKS.MEMBER;
    return { ok: true, guild, target };
  }

  upgradeLevel(guild) {
    if (guild.level >= GUILD_MAX_LEVEL) return { error: 'max_level' };
    const upgraded = upgradeGuildLevel(guild);
    if (upgraded === guild) return { error: 'not_enough_treasury' };
    this.guilds.set(upgraded.id, upgraded);
    return { ok: true, guild: this.guilds.get(upgraded.id) };
  }

  upgradePerk(guild, perkId) {
    const perk = GUILD_PERKS.find((p) => p.id === perkId);
    if (!perk) return { error: 'invalid_perk' };
    const current = guild.perks[perkId] || 0;
    if (current >= perk.maxLevel) return { error: 'perk_maxed' };
    const cost = getPerkCost(perkId, current);
    if ((guild.treasury || 0) < cost) return { error: 'not_enough_treasury' };

    guild.treasury -= cost;
    guild.perks[perkId] = current + 1;
    this.guilds.set(guild.id, guild);
    return { ok: true, guild, level: guild.perks[perkId] };
  }

  contribute(guild, playerId, amount) {
    const next = contributeGold(guild, playerId, amount);
    if (next === guild) return { error: 'contribution_failed' };
    this.guilds.set(next.id, next);
    return { ok: true, guild: next, member: next.members[playerId] };
  }
}

module.exports = { GuildCore, GUILD_CREATE_COST, MAX_MEMBERS };
