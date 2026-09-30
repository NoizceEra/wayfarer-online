import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { ZONES } from '../data/zones.js';
import { zoneAt } from '../world/overworld.js';
import { RANKS } from '../data/combatMath.js';
import { ENEMY_TABLE } from '../data/jobs.js';
import { EXTRA_OVERWORLD_SPAWNS } from '../data/worldEnemies.js';

// Overworld population per zone: [type, cap, zoneId]. Each entry is a set of
// spawn "slots"; a slain enemy's slot respawns after a timer somewhere else in
// its zone (overworld) or back at its home (areas), never on top of the hero or
// inside / next to a safe zone.
export const OVERWORLD_SPAWNS = [
  ['dewslime', 32, 'meadow'], ['mossbat', 18, 'meadow'],
  ['thornmite', 20, 'woods'], ['capling', 14, 'woods'], ['willowisp', 12, 'woods'],
  ['bogspirit', 12, 'ruins'], ['rustskull', 12, 'ruins'], ['tideeye', 8, 'ruins'],
];

const T = CONFIG.tile;
const MIN_PLAYER_DIST = 170;

export class Spawner {
  constructor(scene) {
    this.s = scene;
    this.pending = [];
    this.checkAt = 0;
  }

  // Deterministic initial population (same seed on host + guests).
  populateOverworld(table = [...OVERWORLD_SPAWNS, ...EXTRA_OVERWORLD_SPAWNS]) {
    let seed = 987654;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const [type, n, zoneId] of table) {
      for (let i = 0; i < n; i++) {
        const pos = this.pickZonePoint(zoneId, rnd, false);
        if (!pos) continue;
        const slot = { type, zoneId, areaId: null, home: pos };
        const e = this.s.makeEnemy(pos.x, pos.y, type, null, { rnd });
        e.slot = slot;
      }
    }
  }

  nearSafe(x, y) {
    const s = this.s;
    for (const [ox, oy] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]]) if (s.zoneHere(x + ox, y + oy).safe) return true;
    return false;
  }

  pickZonePoint(zoneId, rnd = Math.random, avoidPlayer = true) {
    const z = ZONES.find((zz) => zz.id === zoneId);
    if (!z) return null;
    const p = this.s.player;
    for (let tries = 0; tries < 12; tries++) {
      const tx = z.rect.x + 1 + Math.floor(rnd() * (z.rect.w - 2));
      const ty = z.rect.y + 1 + Math.floor(rnd() * (z.rect.h - 2));
      if (zoneAt(tx, ty, ZONES).id !== zoneId) continue; // keep out of town / nested zones
      const x = tx * T + 8, y = ty * T + 8;
      if (this.nearSafe(x, y)) continue;
      if (avoidPlayer && !this.s.areas?.current && p && Phaser.Math.Distance.Between(p.x, p.y, x, y) < MIN_PLAYER_DIST) continue;
      return { x, y };
    }
    return null;
  }

  onDeath(ed) {
    const slot = ed.slot || { type: ed.typeId, zoneId: null, areaId: ed.areaId || null, home: { ...ed.home } };
    const base = ed.def.respawn || (ed.rank !== RANKS.normal ? 45000 : 20000 + Math.random() * 15000);
    this.pending.push({ slot, at: this.s.time.now + base });
  }

  update(time) {
    if (time < this.checkAt || !this.pending.length) return;
    this.checkAt = time + 1000;
    const s = this.s, p = s.player;
    const here = s.areas?.current?.id || null;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const job = this.pending[i];
      if (time < job.at) continue;
      const sl = job.slot;
      let pos = null;
      if (sl.zoneId) pos = this.pickZonePoint(sl.zoneId);
      else {
        const j = sl.home;
        pos = { x: j.x + Phaser.Math.Between(-10, 10), y: j.y + Phaser.Math.Between(-10, 10) };
        const sameSpace = (sl.areaId || null) === here;
        if ((sameSpace && Phaser.Math.Distance.Between(p.x, p.y, pos.x, pos.y) < (ENEMY_TABLE[sl.type]?.boss ? 220 : 130)) || s.zoneHere(pos.x, pos.y).safe) pos = null;
      }
      if (!pos) { job.at = time + 4000; continue; } // hero too close: try again shortly
      this.pending.splice(i, 1);
      const e = s.makeEnemy(pos.x, pos.y, sl.type, sl.areaId);
      if (sl.zoneId) e.home = { ...pos };
      e.slot = sl;
      // fade-in so respawns never pop
      e.setAlpha(0);
      s.tweens.add({ targets: e, alpha: 1, duration: 600 });
    }
  }
}
