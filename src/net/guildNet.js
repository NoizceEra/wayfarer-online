/**
 * guildNet.js — Client-side guild network layer for Wayfarer Online.
 * Bridges GuildPanel and GuildHallScene to server guild messages.
 */

export const GUILD_EVENTS = Object.freeze({
  STATE: 'guild:state',
  CREATED: 'guild:created',
  JOINED: 'guild:joined',
  LEFT: 'guild:left',
  INVITE_SENT: 'guild:inviteSent',
  INVITE_RECEIVED: 'guild:inviteReceived',
  INVITE_ACCEPTED: 'guild:inviteAccepted',
  MEMBER_UPDATED: 'guild:memberUpdated',
  MEMBER_REMOVED: 'guild:memberRemoved',
  PROMOTED: 'guild:promoted',
  DEMOTED: 'guild:demoted',
  UPGRADED: 'guild:upgraded',
  PERK_UPGRADED: 'guild:perkUpgraded',
  CONTRIBUTED: 'guild:contributed',
  ERROR: 'guild:error',
});

export class GuildNet extends Phaser.Events.EventEmitter {
  constructor(scene) {
    super();
    this.scene = scene;
    this.guildId = null;
    this.guild = null;
    this.invites = [];
  }

  bindTransport(send, onBroadcast) {
    this.send = send;
    this.unbind?.();

    const handler = (type, payload) => {
      switch (type) {
        case 'guild:state':
          this.guild = payload.guild || null;
          this.guildId = this.guild?.id || null;
          this.emit(GUILD_EVENTS.STATE, payload);
          break;
        case 'guild:created':
          this.guild = payload.guild;
          this.guildId = payload.guild.id;
          this.emit(GUILD_EVENTS.CREATED, payload);
          break;
        case 'guild:joined':
          this.guild = payload.guild;
          this.guildId = payload.guild.id;
          this.emit(GUILD_EVENTS.JOINED, payload);
          break;
        case 'guild:left':
          this.guild = null;
          this.guildId = null;
          this.emit(GUILD_EVENTS.LEFT, payload);
          break;
        case 'guild:invite':
          this.invites.push(payload);
          this.emit(GUILD_EVENTS.INVITE_RECEIVED, payload);
          break;
        case 'guild:inviteSent':
          this.emit(GUILD_EVENTS.INVITE_SENT, payload);
          break;
        case 'guild:inviteAccepted':
          this.emit(GUILD_EVENTS.INVITE_ACCEPTED, payload);
          break;
        case 'guild:memberUpdated':
          if (this.guild && this.guild.id === payload.guildId) {
            this.guild.members[payload.playerId] = payload.member;
          }
          this.emit(GUILD_EVENTS.MEMBER_UPDATED, payload);
          break;
        case 'guild:memberRemoved':
          if (this.guild && this.guild.id === payload.guildId) {
            delete this.guild.members[payload.playerId];
          }
          this.emit(GUILD_EVENTS.MEMBER_REMOVED, payload);
          break;
        case 'guild:upgraded':
          if (this.guild && this.guild.id === payload.guild.id) {
            this.guild.level = payload.guild.level;
            this.guild.exp = payload.guild.exp;
            this.guild.treasury = payload.guild.treasury;
          }
          this.emit(GUILD_EVENTS.UPGRADED, payload);
          break;
        case 'guild:perkUpgraded':
          if (this.guild && this.guild.id === payload.guildId) {
            this.guild.perks = { ...this.guild.perks, [payload.perkId]: payload.level };
          }
          this.emit(GUILD_EVENTS.PERK_UPGRADED, payload);
          break;
        case 'guild:contributed':
          if (this.guild && this.guild.id === payload.guildId) {
            this.guild.exp = payload.guild.exp;
            this.guild.level = payload.guild.level;
            this.guild.treasury = payload.guild.treasury;
            this.guild.members[payload.playerId] = payload.member;
          }
          this.emit(GUILD_EVENTS.CONTRIBUTED, payload);
          break;
        case 'guild:error':
          this.emit(GUILD_EVENTS.ERROR, payload);
          break;
        default:
          break;
      }
    };
    this.unbind = onBroadcast(handler);
    if (typeof this.unbind !== 'function') this.unbind = () => {};
    return this.unbind;
  }

  createGuild(name, tag) {
    this.send?.('guild:create', { name: String(name).trim(), tag: String(tag).trim().toUpperCase() });
  }

  leaveGuild() {
    this.send?.('guild:leave', {});
  }

  invitePlayer(playerId) {
    if (!playerId) return;
    this.send?.('guild:invite', { playerId: String(playerId).trim() });
  }

  acceptInvite(guildId) {
    this.send?.('guild:acceptInvite', { guildId });
  }

  declineInvite(guildId) {
    this.invites = this.invites.filter((i) => i.guildId !== guildId);
    this.send?.('guild:declineInvite', { guildId });
  }

  promote(playerId) {
    this.send?.('guild:promote', { playerId });
  }

  demote(playerId) {
    this.send?.('guild:demote', { playerId });
  }

  kick(playerId) {
    this.send?.('guild:kick', { playerId });
  }

  upgradeLevel() {
    this.send?.('guild:upgradeLevel', {});
  }

  upgradePerk(perkId) {
    this.send?.('guild:upgradePerk', { perkId });
  }

  contributeGold(amount) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (value > 0) this.send?.('guild:contribute', { amount: value });
  }

  getGuild() {
    return this.guild;
  }

  getGuildId() {
    return this.guildId;
  }

  getInvites() {
    return this.invites;
  }

  destroy() {
    this.unbind?.();
    this.removeAllListeners();
  }
}

export default GuildNet;
