/**
 * guildService.js — Server-side guild message handlers for Wayfarer Online.
 * Colyseus-compatible scaffold with no runtime dependency on Colyseus.
 * All costs are in gold only (no crypto).
 */

const { GuildCore, GUILD_CREATE_COST } = require('./guildCore.cjs');
const { GuildAuth } = require('./guildAuth.cjs');

class GuildService {
  constructor(options = {}) {
    this.core = new GuildCore();
    this.auth = new GuildAuth(this.core);
    this.broadcast = options.broadcast || (() => {});
    this.sendTo = options.sendTo || (() => {});
    this.deductGold = options.deductGold || (() => true);
    this.logger = options.logger || console;
  }

  _broadcast(guild, playerId) {
    this.broadcast('guild:state', { guildId: guild.id, guild });
    if (playerId) this.sendTo(playerId, 'guild:state', { guildId: guild.id, guild });
  }

  handleCreate(playerId, playerName, { name, tag }) {
    if (this.core.playerGuild.has(playerId)) return { error: 'already_in_guild' };
    if (!this.deductGold(playerId, GUILD_CREATE_COST)) return { error: 'not_enough_gold' };
    const result = this.core.create(playerId, playerName, { name, tag });
    if (result.error) return result;
    this.sendTo(playerId, 'guild:created', { guild: result.guild });
    this._broadcast(result.guild, playerId);
    return result;
  }

  handleLeave(playerId) {
    const guild = this.auth.assertInGuild(playerId);
    const result = this.core.leave(playerId);
    if (result.error) return result;
    this.sendTo(playerId, 'guild:left', { guildId: guild.id });
    if (!result.disbanded) this._broadcast(result.guild);
    return result;
  }

  handleInvite(playerId, { playerId: targetId }) {
    if (!targetId || targetId === playerId) return { error: 'invalid_target' };
    const guild = this.auth.assertRank(playerId, 'invite');
    const result = this.core.addInvite(guild, targetId, playerId);
    if (result.error) return result;
    this.sendTo(targetId, 'guild:invite', { guildId: guild.id, guildName: guild.name, from: playerId });
    this.sendTo(playerId, 'guild:inviteSent', { targetId });
    return result;
  }

  handleAcceptInvite(playerId, playerName, { guildId }) {
    if (this.core.playerGuild.has(playerId)) return { error: 'already_in_guild' };
    const result = this.core.acceptInvite(playerId, playerName, guildId);
    if (result.error) return result;
    this.sendTo(playerId, 'guild:joined', { guild: result.guild });
    this.sendTo(playerId, 'guild:inviteAccepted', { guildId });
    this._broadcast(result.guild);
    return result;
  }

  handleDeclineInvite(playerId, { guildId }) {
    this.core.declineInvite(playerId, guildId);
    return { ok: true };
  }

  handlePromote(playerId, { playerId: targetId }) {
    const guild = this.auth.assertRank(playerId, 'promote');
    const result = this.core.promote(guild, targetId);
    if (result.error) return result;
    this.sendTo(targetId, 'guild:promoted', { guildId: guild.id, rank: result.target.rank });
    this._broadcast(guild);
    return result;
  }

  handleDemote(playerId, { playerId: targetId }) {
    const guild = this.auth.assertRank(playerId, 'demote');
    const result = this.core.demote(guild, targetId);
    if (result.error) return result;
    this.sendTo(targetId, 'guild:demoted', { guildId: guild.id, rank: result.target.rank });
    this._broadcast(guild);
    return result;
  }

  handleKick(playerId, { playerId: targetId }) {
    const guild = this.auth.canKick(playerId, targetId);
    const result = this.core.removeMember(guild, targetId);
    if (result.error) return result;
    this.sendTo(targetId, 'guild:kicked', { guildId: guild.id });
    this._broadcast(guild);
    return result;
  }

  handleUpgradeLevel(playerId) {
    const guild = this.auth.assertRank(playerId, 'upgradeHall');
    const result = this.core.upgradeLevel(guild);
    if (result.error) return result;
    this.sendTo(playerId, 'guild:upgraded', { guild: result.guild });
    this._broadcast(result.guild);
    return result;
  }

  handleUpgradePerk(playerId, { perkId }) {
    const guild = this.auth.assertRank(playerId, 'upgradeHall');
    const result = this.core.upgradePerk(guild, perkId);
    if (result.error) return result;
    this.sendTo(playerId, 'guild:perkUpgraded', { guildId: guild.id, perkId, level: result.level });
    this._broadcast(guild);
    return result;
  }

  handleContribute(playerId, { amount }) {
    const guild = this.auth.assertInGuild(playerId);
    if (!this.deductGold(playerId, amount)) return { error: 'not_enough_gold' };
    const result = this.core.contribute(guild, playerId, amount);
    if (result.error) return result;
    this.sendTo(playerId, 'guild:contributed', {
      guildId: result.guild.id,
      playerId,
      amount,
      guild: result.guild,
      member: result.member,
    });
    this._broadcast(result.guild, playerId);
    return result;
  }

  bindToRoom(room) {
    const makeHandler = (fn) => (client, msg) => {
      try {
        const result = fn(client, msg || {});
        if (result?.error) {
          client.send('guild:error', { type: msg?.type || 'unknown', message: result.error });
        }
      } catch (err) {
        this.logger.warn('[GuildService] handler failed:', err.message);
        client.send('guild:error', { type: msg?.type || 'unknown', message: err.message });
      }
    };

    const playerName = (sid) => {
      const p = room.players?.get(sid);
      return p?.name || sid;
    };

    room.onMessage('guild:create', makeHandler((client, msg) => this.handleCreate(client.sessionId, playerName(client.sessionId), msg)));
    room.onMessage('guild:leave', makeHandler((client) => this.handleLeave(client.sessionId)));
    room.onMessage('guild:invite', makeHandler((client, msg) => this.handleInvite(client.sessionId, msg)));
    room.onMessage('guild:acceptInvite', makeHandler((client, msg) => this.handleAcceptInvite(client.sessionId, playerName(client.sessionId), msg)));
    room.onMessage('guild:declineInvite', makeHandler((client, msg) => this.handleDeclineInvite(client.sessionId, msg)));
    room.onMessage('guild:promote', makeHandler((client, msg) => this.handlePromote(client.sessionId, msg)));
    room.onMessage('guild:demote', makeHandler((client, msg) => this.handleDemote(client.sessionId, msg)));
    room.onMessage('guild:kick', makeHandler((client, msg) => this.handleKick(client.sessionId, msg)));
    room.onMessage('guild:upgradeLevel', makeHandler((client) => this.handleUpgradeLevel(client.sessionId)));
    room.onMessage('guild:upgradePerk', makeHandler((client, msg) => this.handleUpgradePerk(client.sessionId, msg)));
    room.onMessage('guild:contribute', makeHandler((client, msg) => this.handleContribute(client.sessionId, msg)));

    room.onMessage('guild:state', (client) => {
      const guildId = this.core.playerGuild.get(client.sessionId);
      if (guildId) {
        const guild = this.core.guilds.get(guildId);
        if (guild) client.send('guild:state', { guildId, guild });
      }
    });
  }
}

module.exports = { GuildService };
