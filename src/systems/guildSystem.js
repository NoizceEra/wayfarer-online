/**
 * guildSystem.js — Client-side guild coordinator for Wayfarer Online.
 * Wires GuildNet to the save/registry and exposes bonuses to other systems.
 */

import { GuildNet, GUILD_EVENTS } from '../net/guildNet.js';
import { getGuildBonuses, computeTokenPoints, computeMarketFee, computeDailyGold } from '../data/guilds.cjs';

export default class GuildSystem extends Phaser.Events.EventEmitter {
  constructor(scene, options = {}) {
    super();
    this.scene = scene;
    this.net = new GuildNet(scene);
    this.saveManager = options.saveManager || scene.registry?.get('saveManager') || null;
    this.playerId = options.playerId || this.loadPlayerId();

    if (options.send && options.onBroadcast) {
      this.net.bindTransport(options.send, options.onBroadcast);
    }

    this.net.on(GUILD_EVENTS.STATE, ({ guild }) => this.persist(guild));
    this.net.on(GUILD_EVENTS.CREATED, ({ guild }) => this.persist(guild));
    this.net.on(GUILD_EVENTS.JOINED, ({ guild }) => this.persist(guild));
    this.net.on(GUILD_EVENTS.LEFT, () => this.persist(null));
    this.net.on(GUILD_EVENTS.UPGRADED, ({ guild }) => this.persist(guild));
    this.net.on(GUILD_EVENTS.PERK_UPGRADED, ({ guildId }) => {
      if (this.net.guild?.id === guildId) this.persist(this.net.guild);
    });
    this.net.on(GUILD_EVENTS.CONTRIBUTED, ({ guild }) => this.persist(guild));
  }

  loadPlayerId() {
    try {
      const saved = localStorage.getItem('wayfarer.playerId');
      if (saved) return saved;
    } catch (e) { /* ignore */ }
    const generated = `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    try {
      localStorage.setItem('wayfarer.playerId', generated);
    } catch (e) { /* ignore */ }
    return generated;
  }

  persist(guild) {
    try {
      const save = this.saveManager?.data || this.scene.registry?.get('gameSave') || {};
      save.guild = guild
        ? { id: guild.id, name: guild.name, tag: guild.tag, perks: guild.perks, level: guild.level }
        : null;
      this.scene.registry?.set('gameSave', save);
      this.saveManager?.save?.();
    } catch (e) {
      console.warn('GuildSystem persist failed:', e);
    }
    this.emit('guild:changed', guild);
  }

  getGuild() {
    return this.net.getGuild();
  }

  getBonuses() {
    return getGuildBonuses(this.getGuild());
  }

  applyTokenPoints(base) {
    return computeTokenPoints(base, this.getGuild());
  }

  applyMarketFee(baseRate) {
    return computeMarketFee(baseRate, this.getGuild());
  }

  applyDailyGold(base) {
    return computeDailyGold(base, this.getGuild());
  }

  create(name, tag) {
    this.net.createGuild(name, tag);
  }

  leave() {
    this.net.leaveGuild();
  }

  invite(playerId) {
    this.net.invitePlayer(playerId);
  }

  acceptInvite(guildId) {
    this.net.acceptInvite(guildId);
  }

  declineInvite(guildId) {
    this.net.declineInvite(guildId);
  }

  promote(playerId) {
    this.net.promote(playerId);
  }

  demote(playerId) {
    this.net.demote(playerId);
  }

  kick(playerId) {
    this.net.kick(playerId);
  }

  upgradeLevel() {
    this.net.upgradeLevel();
  }

  upgradePerk(perkId) {
    this.net.upgradePerk(perkId);
  }

  contribute(amount) {
    this.net.contributeGold(amount);
  }

  destroy() {
    this.net.destroy();
    this.removeAllListeners();
  }
}
