import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { net } from '../net/NetworkManager.js';
import { ENEMY_TABLE } from '../data/jobs.js';
import { RANKS } from '../data/combatMath.js';
import { audio } from './audio.js';
import { waterAt, onBridge } from '../world/waterways.js';

const ENCOUNTER_MODIFIERS = Object.freeze([
  { id: 'bulwark', name: 'BULWARK', desc: 'Reinforced guard bars. Break them for an opening.', color: '#72cfff', tint: 0x72cfff, reward: 1.3 },
  { id: 'hunters', name: 'HUNTERS', desc: 'Faster flankers take wider approach angles.', color: '#ffb04a', tint: 0xffb04a, reward: 1.25 },
  { id: 'relentless', name: 'RELENTLESS', desc: 'Harder hits and tighter attack rotations.', color: '#ff7070', tint: 0xff7070, reward: 1.35 },
]);

// Lightweight wilderness pacing. It only runs for the local area authority,
// waits for a quiet moment, then creates a short encounter from enemies that
// already belong to the current biome. This keeps travel unpredictable without
// competing with scheduled world events or boss fights.
export class EncounterDirector {
  constructor(scene) {
    this.s = scene;
    this.nextAt = scene.time.now + 55000;
    this.serial = 0;
    this.active = null;
    this.kills = 0;
    this.offKill = bus.on(Events.KILL, (e) => this.onKill(e));
  }

  destroy() {
    if (this.active) audio.encounter('end', { zone: this.active.zone });
    this.offKill?.(); this.offKill = null;
  }

  canDirect() {
    const s = this.s, p = s.player;
    const area = s.areas?.current?.id || null;
    if (!p || p.dead || s.transitioning || area || s.zoneHere(p.x, p.y).safe) return false;
    if (s.worldEvents?.boss?.e?.alive || s.areas?.boss?.alive) return false;
    if (net.connected && !net.isAuthority(area)) return false;
    const nearby = s.combat?.enemiesHere?.().filter((e) => Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y) < 150).length || 0;
    return nearby <= 3 && !s.combat?.inCombat;
  }

  enemyPool(zoneId) {
    return Object.entries(ENEMY_TABLE)
      .filter(([, d]) => !d.boss && (d.zones || []).includes(zoneId))
      .map(([id]) => id);
  }

  spawnPoint(index, total) {
    const s = this.s, p = s.player;
    for (let tries = 0; tries < 12; tries++) {
      const a = (index / Math.max(1, total)) * Math.PI * 2 + tries * 0.63;
      const r = 82 + tries * 5;
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (s.zoneHere(x, y).safe || s.areas?.blockedAt?.(x, y) || waterAt(x, y, 10) || onBridge(x, y, 18)) continue;
      return { x, y };
    }
    return null;
  }

  start() {
    const s = this.s, p = s.player, zone = s.zoneHere(p.x, p.y);
    const pool = this.enemyPool(zone.id);
    if (!pool.length) { this.nextAt = s.time.now + 30000; return; }
    const strong = (s.combat?.combo.best || 0) >= 10 && p.hp / p.effMaxHp() > 0.65;
    const kind = strong || Math.random() < 0.32 ? 'elite' : 'ambush';
    const modifier = ENCOUNTER_MODIFIERS[Math.floor(Math.random() * ENCOUNTER_MODIFIERS.length)];
    const modifiers = [modifier];
    if (strong && p.level >= 5 && Math.random() < 0.28) {
      const extra = ENCOUNTER_MODIFIERS.filter((m) => m.id !== modifier.id);
      modifiers.push(extra[Math.floor(Math.random() * extra.length)]);
    }
    const total = kind === 'elite' ? 2 : 3 + Math.floor(Math.random() * 2);
    const id = `director-${++this.serial}`;
    let spawned = 0, captain = null;
    for (let i = 0; i < total; i++) {
      const pos = this.spawnPoint(i, total); if (!pos) continue;
      const wantsMeleeRole = i > 0 && i < total - 1;
      const rolePool = wantsMeleeRole ? pool.filter((id) => ENEMY_TABLE[id]?.ai !== 'ranged') : pool;
      const choices = rolePool.length ? rolePool : pool;
      const type = choices[Math.floor(Math.random() * choices.length)];
      const rank = kind === 'elite' && i === 0 ? RANKS.champion : kind === 'elite' || i === 0 ? RANKS.elite : RANKS.normal;
      const e = s.makeEnemy(pos.x, pos.y, type, null, { eo: { level: Math.max(1, p.level + (rank === RANKS.champion ? 1 : 0)), rank } });
      e.encounterId = id; e.squadId = id; e.squadSide = i % 2 ? 1 : -1;
      e.squadRole = rank === RANKS.champion || i === 0 || (total >= 4 && i === 1) ? 'vanguard'
        : i === total - 1 ? 'support' : 'flanker';
      if (!captain) {
        captain = e; e.isSquadCaptain = true; e.squadRole = 'vanguard';
        e.displayName = `Captain ${e.displayName}`;
      }
      e.encounterModifier = modifiers.map((m) => m.id).join('+');
      e.encounterTint = modifier.tint;
      for (const mod of modifiers) {
        if (mod.id === 'bulwark') {
          e.guardMax = Math.max(e.guardMax, Math.round(e.maxHp * 0.22)); e.guard = e.guardMax;
        } else if (mod.id === 'hunters' && e.squadRole === 'flanker') {
          e.spdMul *= 1.12; e.flankOffset = 48;
        } else if (mod.id === 'relentless') {
          e.hitDmg *= 1.12; e.squadGapMul = 0.82;
        }
      }
      if (e.squadRole === 'support') e.supportReadyAt = s.time.now + 3600 + i * 400;
      if (e.squadRole === 'flanker') e.pincerReadyAt = s.time.now + 3000 + i * 350;
      if (e.squadRole === 'vanguard' && !e.isSquadCaptain) {
        e.guardMax = Math.max(e.guardMax || 0, Math.round(e.maxHp * 0.28));
        e.guard = e.guardMax; e.interceptReadyAt = s.time.now + 1800;
      }
      e.noRespawn = true; e.mode = 'chase'; e.nextAtk = s.time.now + 900 + i * 180; e.showBars(true);
      e.setAlpha(0); s.tweens.add({ targets: e, alpha: 1, duration: 360 + i * 80 });
      spawned += 1;
    }
    if (!spawned) { this.nextAt = s.time.now + 20000; return; }
    this.active = { id, kind, left: spawned, total: spawned, zone: zone.id, modifier, modifiers, mythic: modifiers.length > 1, captain, captainAlive: !!captain, moraleBrokenUntil: 0 };
    this.kills = 0;
    audio.encounter('start', { zone: zone.id, mythic: modifiers.length > 1, intensity: kind === 'elite' ? 0.68 : 0.45 });
    const modifierNames = modifiers.map((m) => m.name).join(' + ');
    s.scene.get('overlay')?.warn?.(`${modifiers.length > 1 ? 'MYTHIC PACK' : kind === 'elite' ? 'ELITE HUNT' : 'AMBUSH'} · ${modifierNames}`);
    bus.emit(Events.TOAST, {
      title: `${modifiers.length > 1 ? 'Mythic pack' : kind === 'elite' ? 'Elite hunt' : 'Wilderness ambush'} · ${modifierNames}`,
      text: modifiers.map((m) => m.desc).join(' '),
      color: modifier.color,
    });
  }

  onKill(e) {
    if (!this.active || e?.encounterId !== this.active.id) return;
    this.active.left -= 1; this.kills += 1;
    if (e.isSquadCaptain && this.active.left > 0) this.breakMorale(this.active);
    if (this.active.left > 0) {
      const cleared = 1 - this.active.left / Math.max(1, this.active.total);
      audio.encounter('intensity', { value: Math.min(1, 0.48 + cleared * 0.42) });
      return;
    }
    const s = this.s, p = s.player;
    const rewardMul = Math.min(1.75, (this.active.modifiers || [this.active.modifier]).reduce((n, m) => n * (m?.reward || 1), 1));
    const reward = Math.round((this.active.kind === 'elite' ? 32 : 18) * rewardMul);
    for (let i = 0; i < 4; i++) s.combat?.spawnCoin(p.x + (i - 1.5) * 5, p.y, Math.ceil(reward / 4), null);
    s.combat?.gainResource?.(18);
    bus.emit(Events.TOAST, { title: `${this.active.mythic ? 'Mythic pack' : this.active.modifier?.name || 'Encounter'} cleared`, text: `Field cache: ${reward} gold · +18 ${s.combat?.classResource?.name || 'power'}`, color: '#14f195' });
    audio.encounter('victory', { zone: this.active.zone });
    s.combat?.squadAttackAt?.delete(this.active.id);
    this.active = null;
    this.nextAt = s.time.now + 80000 + Math.random() * 45000;
  }

  breakMorale(active) {
    const s = this.s, now = s.time.now;
    active.captainAlive = false;
    active.moraleBrokenUntil = now + 6000;
    s.enemies.children.each((e) => {
      if (!e.alive || e.encounterId !== active.id || e.isSquadCaptain) return true;
      e.moraleBrokenUntil = active.moraleBrokenUntil;
      e.statuses.apply('stun', now, { secs: 1.1, dmg: 0 });
      e.cancelAttack?.(now, 1300);
      s.combat?.floatText?.(e.x, e.y - 26, 'MORALE BROKEN', '#7dffcf', 'small');
      return true;
    });
    s.combat?.squadAttackAt?.set(active.id, now + 1000);
    s.combat?.gainResource?.(10);
    audio.encounter('intensity', { value: 0.86 });
    s.scene.get('overlay')?.warn?.('CAPTAIN DOWN · SQUAD MORALE BROKEN');
    bus.emit(Events.TOAST, { title: 'Captain defeated', text: `Squad weakened for 6s · +10 ${s.combat?.classResource?.name || 'power'}`, color: '#7dffcf' });
    audio.play('slam', 0.45);
  }

  update(time) {
    if (this.active || time < this.nextAt) return;
    if (!this.canDirect()) { this.nextAt = time + 12000; return; }
    this.start();
  }
}
