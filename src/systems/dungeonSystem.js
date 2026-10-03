/**
 * dungeonSystem.js — Client-side dungeon/LFG coordinator for Wayfarer Online.
 * Bridges the LFGPanel UI to (optional) server queue messages.
 */

import { DUNGEONS, getDungeonById, expandPack, rollLoot } from '../data/dungeons.js';

// Simple EventEmitter stub for node --check / tests; Phaser provides a real one in the client.
const StubEmitter = class {
  constructor() { this._ev = {}; }
  on(ev, fn) { (this._ev[ev] ||= []).push(fn); return () => { const i = this._ev[ev]?.indexOf(fn); if (i >= 0) this._ev[ev].splice(i, 1); }; }
  emit(ev, ...args) { (this._ev[ev] || []).forEach((fn) => fn(...args)); }
  removeAllListeners() { this._ev = {}; }
};
const EventEmitter = (typeof Phaser !== 'undefined' && Phaser.Events?.EventEmitter) || StubEmitter;

export const DUNGEON_EVENTS = Object.freeze({
  QUEUED: 'dungeon:queued',
  MATCH_READY: 'dungeon:matchReady',
  ENTERED: 'dungeon:entered',
  WAVE_START: 'dungeon:waveStart',
  ENCOUNTER_END: 'dungeon:encounterEnd',
  COMPLETE: 'dungeon:complete',
  FAILED: 'dungeon:failed',
  LOOT_REWARDED: 'dungeon:lootRewarded',
});

export default class DungeonSystem extends EventEmitter {
  constructor(scene, net = null) {
    super();
    this.scene = scene;
    this.net = net;
    this.run = null;
    this.queueTicket = null;
    this.state = 'idle';

    if (this.net && typeof this.net.on === 'function') {
      this.net.on('dungeon:match', (payload) => this.handleMatch(payload));
      this.net.on('dungeon:enter', (payload) => this.handleEnter(payload));
      this.net.on('dungeon:wave', (payload) => this.handleWave(payload));
      this.net.on('dungeon:complete', (payload) => this.handleComplete(payload));
    }
  }

  /**
   * Build a local run instance without server validation.
   * Useful for solo/offline prototypes.
   */
  startLocal(dungeonId, playerCount = 1) {
    const dungeon = getDungeonById(dungeonId);
    if (!dungeon) return null;

    this.run = {
      dungeonId,
      dungeon,
      playerCount,
      players: [],
      waveIndex: -1,
      waves: this.generateWaves(dungeon),
      completed: false,
      failed: false,
      rewards: [],
    };
    this.state = 'running';
    this.emit(DUNGEON_EVENTS.ENTERED, { dungeonId, playerCount });
    this.nextWave();
    return this.run;
  }

  generateWaves(dungeon) {
    const waves = [];
    for (const pack of dungeon.trashPacks) {
      waves.push({ type: 'trash', pack: expandPack(pack, 't') });
    }
    waves.push({ type: 'miniBoss', boss: { ...dungeon.miniBoss, uid: 'mb_0', alive: true } });
    waves.push({ type: 'finalBoss', boss: { ...dungeon.finalBoss, uid: 'fb_0', alive: true } });
    return waves;
  }

  nextWave() {
    if (!this.run || this.run.completed || this.run.failed) return;
    this.run.waveIndex += 1;
    const wave = this.run.waves[this.run.waveIndex];
    if (!wave) {
      this.complete();
      return;
    }
    this.emit(DUNGEON_EVENTS.WAVE_START, { index: this.run.waveIndex, wave });
  }

  resolveWave(victory = true) {
    if (!this.run || this.run.completed || this.run.failed) return;
    if (!victory) {
      this.fail();
      return;
    }
    this.emit(DUNGEON_EVENTS.ENCOUNTER_END, { index: this.run.waveIndex });
    this.nextWave();
  }

  complete() {
    if (!this.run) return;
    this.run.completed = true;
    this.state = 'completed';
    const luck = this.sumLuck();
    this.run.rewards = rollLoot(this.run.dungeon, luck, 3 + this.run.playerCount);
    this.emit(DUNGEON_EVENTS.COMPLETE, { rewards: this.run.rewards });
    this.emit(DUNGEON_EVENTS.LOOT_REWARDED, { rewards: this.run.rewards });
  }

  fail() {
    if (!this.run) return;
    this.run.failed = true;
    this.state = 'failed';
    this.emit(DUNGEON_EVENTS.FAILED, { waveIndex: this.run.waveIndex });
  }

  sumLuck() {
    // Placeholder: read equipped gear / cosmetics from registry later.
    return 0;
  }

  /**
   * Network queue flow stubs.
   */
  queue(dungeonId, role = 'any', groupMode = 'solo') {
    this.state = 'queued';
    this.queueTicket = `${dungeonId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.emit(DUNGEON_EVENTS.QUEUED, { dungeonId, role, groupMode, ticket: this.queueTicket });
    if (this.net && this.net.send) {
      this.net.send('lfg:queue', { dungeonId, role, groupMode, ticket: this.queueTicket });
    }
    return this.queueTicket;
  }

  cancelQueue() {
    this.state = 'idle';
    if (this.net && this.net.send) {
      this.net.send('lfg:cancel', { ticket: this.queueTicket });
    }
    this.queueTicket = null;
  }

  acceptMatch() {
    if (this.state !== 'ready') return;
    this.state = 'entering';
    this.emit(DUNGEON_EVENTS.MATCH_READY, { accepted: true, ticket: this.queueTicket });
    if (this.net && this.net.send) {
      this.net.send('lfg:accept', { ticket: this.queueTicket });
    }
  }

  handleMatch(payload) {
    this.state = 'ready';
    this.emit(DUNGEON_EVENTS.MATCH_READY, payload);
  }

  handleEnter(payload) {
    const { dungeonId, playerCount } = payload || {};
    this.startLocal(dungeonId, playerCount);
  }

  handleWave(payload) {
    if (payload && payload.index !== undefined) {
      this.run.waveIndex = payload.index - 1;
      this.nextWave();
    }
  }

  handleComplete(payload) {
    if (!this.run) return;
    this.run.completed = true;
    this.state = 'completed';
    this.run.rewards = payload?.rewards || [];
    this.emit(DUNGEON_EVENTS.COMPLETE, payload);
  }

  getCurrentRun() {
    return this.run;
  }

  getState() {
    return this.state;
  }

  getAvailableDungeons(level = 1) {
    return DUNGEONS.filter((d) => d.level <= level + 5);
  }
}
