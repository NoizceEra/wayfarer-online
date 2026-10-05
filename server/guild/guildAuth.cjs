/**
 * guildAuth.js — Permission checks for guild actions.
 */

const { hasPermission, getMemberRank } = require('../../src/data/guilds.cjs');

class GuildAuth {
  constructor(core) {
    this.core = core;
  }

  assertInGuild(playerId) {
    const guild = this.core.getGuildFor(playerId);
    if (!guild) throw new Error('not_in_guild');
    return guild;
  }

  assertRank(playerId, permission) {
    const guild = this.assertInGuild(playerId);
    const rank = getMemberRank(guild, playerId);
    if (!hasPermission(rank, permission)) throw new Error('no_permission');
    return guild;
  }

  canKick(actorId, targetId) {
    const guild = this.assertInGuild(actorId);
    if (targetId === actorId) throw new Error('cannot_kick_self');
    if (!hasPermission(getMemberRank(guild, actorId), 'kick')) throw new Error('no_permission');
    const actorRank = getMemberRank(guild, actorId);
    const target = Object.prototype.hasOwnProperty.call(guild.members, targetId) ? guild.members[targetId] : null;
    if (!target) throw new Error('not_a_member');
    if (target.rank === 'leader') throw new Error('cannot_kick_leader');
    if (actorRank === 'officer' && target.rank === 'officer') {
      throw new Error('officer_cannot_kick_officer');
    }
    return guild;
  }
}

module.exports = { GuildAuth };
