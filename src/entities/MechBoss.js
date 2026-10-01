import Phaser from 'phaser';
import { Boss } from './Boss.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { RANKS } from '../data/combatMath.js';

// Boss with extra, data-driven mechanics on top of Boss.js's slam / charge / nova kit.
// def.mech = one object or an array of:
//   { k:'zones',  every, n, r, wind, mul, status, color }  n telegraphed circles around the hero (first one under them)
//   { k:'beams',  every, spread:[...], len, wide, wind, mul, status, color }  lanes that fan out from the boss
//   { k:'ring',   every, r, wind, mul, status, color }      boss-centred ring: step OUT of it
//   { k:'adds',   at:[hp fractions], types:[...], n }       reinforcements at HP thresholds
//   { k:'shield', at:[hp fractions], lantern, n, ringEvery } invulnerable until every tether lantern is broken
// All telegraphs use the same red-marker language as Boss.js (fill-up + white flash in the last quarter).
const FONT = '"Silkscreen", monospace';

export class MechBoss extends Boss {
  constructor(scene, x, y, typeId, opts) {
    super(scene, x, y, typeId, opts);
    const list = Array.isArray(this.def.mech) ? this.def.mech : [this.def.mech];
    this.mechs = list.filter(Boolean).map((m) => ({ ...m, t: (m.every || 0) * 0.55, st: 'idle', plan: null, fired: new Set() }));
    this.mg = scene.add.graphics().setDepth(3);
    this.adds = [];
    this.invuln = false;
    this.lanterns = [];
  }

  get nearby() { return this.scene.player; }

  reset() {
    super.reset();
    this.clearMech();
  }

  clearMech() {
    this.mg.clear();
    for (const a of this.adds) if (a.active) { a.hp = 0; a.die?.(); }
    this.adds = []; this.lanterns = [];
    this.invuln = false;
    for (const m of this.mechs) { m.st = 'idle'; m.plan = null; m.t = (m.every || 0) * 0.55; m.fired = new Set(); }
  }

  aiUpdate(scene, delta) {
    super.aiUpdate(scene, delta);
    if (this.hp <= 0) { this.mg.clear(); return; }
    if (!this.engaged) { this.mg.clear(); return; }
    const now = scene.time.now;
    const g = this.mg;
    g.clear();
    this.adds = this.adds.filter((a) => a.active && a.alive);
    for (const m of this.mechs) this.tick(m, scene, delta, now, g);
    if (this.invuln) this.drawShield(g, now);
  }

  hpFrac() { return this.hp / this.maxHp; }

  tick(m, scene, delta, now, g) {
    const p = scene.player;
    switch (m.k) {
      case 'zones': case 'beams': case 'ring': return this.tickTele(m, scene, delta, now, g, p);
      case 'adds': {
        for (const at of m.at || []) {
          if (m.fired.has(at) || this.hpFrac() > at) continue;
          m.fired.add(at);
          this.spawnAdds(scene, m.types, m.n || 2, 70);
          bus.emit(Events.SYSTEM, `${this.def.name} calls for help!`);
          audio.play('roar', 0.7);
        }
        return null;
      }
      case 'shield': return this.tickShield(m, scene, delta, now, g, p);
      default: return null;
    }
  }

  tickTele(m, scene, delta, now, g, p) {
    const slow = this.invuln && m.k === 'ring' ? 1 : 1;
    if (m.st === 'idle') {
      if (m.k === 'ring' && m.onlyShield && !this.invuln) return;
      m.t += delta * slow;
      if (m.t >= m.every) {
        m.t = 0; m.st = 'wind';
        const wind = (m.wind || 1300) * (this.hardEnraged ? 0.8 : 1);
        if (m.k === 'zones') {
          const spots = [{ x: p.x, y: p.y + 2 }];
          for (let i = 1; i < (m.n || 3); i++) { const a = Math.random() * 6.283, d = 30 + Math.random() * 90; spots.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }); }
          m.plan = { wind, t: 0, spots };
        } else if (m.k === 'beams') {
          const a0 = Math.atan2(p.y - this.y, p.x - this.x);
          m.plan = { wind, t: 0, sx: this.x, sy: this.y, lanes: (m.spread || [0]).map((o) => a0 + o) };
        } else m.plan = { wind, t: 0, x: this.x, y: this.y };
        audio.play('alert', 0.5);
      }
      return;
    }
    const pl = m.plan;
    pl.t += delta;
    const f = Phaser.Math.Clamp(pl.t / pl.wind, 0, 1), late = f > 0.75;
    const col = m.color || 0xff3030;
    const pulse = 0.16 + 0.1 * Math.sin(now / 60);
    const rim = late && Math.floor(now / 80) % 2 ? 0xffffff : col;
    if (m.k === 'zones') {
      for (const s of pl.spots) {
        g.fillStyle(col, pulse).fillCircle(s.x, s.y, m.r || 28);
        g.fillStyle(col, 0.38).fillCircle(s.x, s.y, (m.r || 28) * f);
        g.lineStyle(late ? 3 : 2, rim, 0.95).strokeCircle(s.x, s.y, m.r || 28);
      }
    } else if (m.k === 'ring') {
      g.fillStyle(col, pulse).fillCircle(pl.x, pl.y, m.r);
      g.fillStyle(col, 0.38).fillCircle(pl.x, pl.y, m.r * f);
      g.lineStyle(late ? 3 : 2, rim, 0.95).strokeCircle(pl.x, pl.y, m.r);
    } else {
      const len = m.len || 220, wide = m.wide || 22;
      for (const a of pl.lanes) {
        const ex = pl.sx + Math.cos(a) * len, ey = pl.sy + Math.sin(a) * len, nx = -Math.sin(a) * wide / 2, ny = Math.cos(a) * wide / 2;
        const poly = [new Phaser.Geom.Point(pl.sx + nx, pl.sy + ny), new Phaser.Geom.Point(ex + nx, ey + ny), new Phaser.Geom.Point(ex - nx, ey - ny), new Phaser.Geom.Point(pl.sx - nx, pl.sy - ny)];
        g.fillStyle(col, pulse).fillPoints(poly, true);
        const mx = pl.sx + Math.cos(a) * len * f, my = pl.sy + Math.sin(a) * len * f;
        g.fillStyle(col, 0.38).fillPoints([poly[0], new Phaser.Geom.Point(mx + nx, my + ny), new Phaser.Geom.Point(mx - nx, my - ny), poly[3]], true);
        g.lineStyle(late ? 3 : 2, rim, 0.95).strokePoints(poly, true);
      }
    }
    if (pl.t < pl.wind) return;
    // strike
    m.st = 'idle'; m.plan = null;
    audio.play('slam', 0.8);
    scene.cameras.main.shake(140, 0.005);
    const dmg = this.atk * (m.mul || 0.7);
    const st = m.status || null;
    if (m.k === 'zones') {
      let hit = false;
      for (const s of pl.spots) {
        scene.spawnFx(s.x, s.y - 6, 'fx.explosion', 1.6);
        this.impactRing(scene, s.x, s.y, m.r || 28);
        if (!hit && Phaser.Math.Distance.Between(p.x, p.y, s.x, s.y) < (m.r || 28)) { hit = true; this.damageToPlayer(scene, dmg, st); }
      }
    } else if (m.k === 'ring') {
      scene.spawnFx(pl.x, pl.y - 6, 'fx.explosion', 2.6);
      this.impactRing(scene, pl.x, pl.y, m.r);
      if (Phaser.Math.Distance.Between(p.x, p.y, pl.x, pl.y) < m.r) this.damageToPlayer(scene, dmg, st);
    } else {
      const len = m.len || 220, wide = m.wide || 22;
      let hit = false;
      for (const a of pl.lanes) {
        const ex = pl.sx + Math.cos(a) * len, ey = pl.sy + Math.sin(a) * len;
        scene.spawnFx((pl.sx + ex) / 2, (pl.sy + ey) / 2 - 6, 'fx.explosion', 1.2);
        const vx = ex - pl.sx, vy = ey - pl.sy, l2 = vx * vx + vy * vy || 1;
        const tt = Phaser.Math.Clamp(((p.x - pl.sx) * vx + (p.y - pl.sy) * vy) / l2, 0, 1);
        if (!hit && Math.hypot(p.x - (pl.sx + vx * tt), p.y - (pl.sy + vy * tt)) < wide / 2 + 5) { hit = true; this.damageToPlayer(scene, dmg, st); }
      }
    }
  }

  spawnAdds(scene, types, n, radius) {
    const rnd = Math.random;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rnd(), d = radius * (0.7 + rnd() * 0.6);
      const x = this.x + Math.cos(a) * d, y = this.y + Math.sin(a) * d;
      const type = types[i % types.length];
      const e = scene.makeEnemy(x, y, type, this.areaId, { local: true, eo: { level: Math.max(1, this.level - 1), rank: RANKS.normal } });
      e.noRespawn = true; e.isAdd = true;
      scene.combat?.aggro(e, false);
      scene.spawnFx(x, y - 6, 'fx.smoke', 1.2);
      this.adds.push(e);
    }
  }

  tickShield(m, scene, delta, now, g) {
    if (!this.invuln) {
      for (const at of m.at || []) {
        if (m.fired.has(at) || this.hpFrac() > at) continue;
        m.fired.add(at);
        this.invuln = true;
        const n = m.n || 3;
        this.lanterns = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.283 + 0.5, d = 92;
          const x = this.x + Math.cos(a) * d, y = this.y + Math.sin(a) * d;
          const e = scene.makeEnemy(x, y, m.lantern || 'hlantern', this.areaId, { local: true, eo: { level: Math.max(1, this.level - 2), rank: RANKS.normal } });
          e.noRespawn = true; e.isAdd = true; e.xpValue = 0;
          this.lanterns.push(e); this.adds.push(e);
          scene.spawnFx(x, y - 6, 'fx.circleOrange', 1.2);
        }
        this.ringT = 0;
        audio.play('roar');
        scene.cameras.main.shake(260, 0.004);
        bus.emit(Events.SYSTEM, `${this.def.name} is shielded! Break the ${n} Soul Lanterns.`);
        scene.combat?.floatText(this.x, this.y - 40, 'SHIELDED', '#d0a0ff', 'big');
        break;
      }
      return;
    }
    // shielded: lanterns tether to the boss; he keeps pressing with rings
    const alive = this.lanterns.filter((e) => e.active && e.alive);
    for (const e of alive) g.lineStyle(2, 0xd0a0ff, 0.45 + 0.25 * Math.sin(now / 120)).lineBetween(this.x, this.y - 6, e.x, e.y - 6);
    this.ringT = (this.ringT || 0) + delta;
    if (this.ringT > (m.ringEvery || 5200) && this.state !== 'wind') {
      this.ringT = 0;
      this.startAttack(scene, 'nova');
    }
    if (!alive.length) {
      this.invuln = false; this.lanterns = [];
      audio.play('quest', 0.8);
      bus.emit(Events.SYSTEM, `${this.def.name}'s shield shatters - he is staggered!`);
      scene.combat?.floatText(this.x, this.y - 40, 'STAGGERED', '#ffe14a', 'big');
      scene.spawnFx(this.x, this.y - 8, 'fx.explosion', 2.4);
      this.state = 'recover'; this.timer = 3200; this.plan = null; this.body.setVelocity(0, 0);
    }
  }

  drawShield(g, now) {
    const r = 26 * this.vscale + Math.sin(now / 140) * 2;
    g.lineStyle(3, 0xd0a0ff, 0.85).strokeCircle(this.x, this.y - 6, r);
    g.fillStyle(0xb080ff, 0.16 + 0.06 * Math.sin(now / 200)).fillCircle(this.x, this.y - 6, r);
  }

  onSlain(scene) {
    this.mg.clear();
    for (const a of this.adds) if (a.active) { a.hp = 0; a.die?.(); }
    this.adds = []; this.lanterns = [];
    super.onSlain(scene);
  }

  destroy(fromScene) {
    this.mg?.destroy();
    super.destroy(fromScene);
  }
}
void FONT;
