import Phaser from 'phaser';
import { Enemy } from './Enemy.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';

const ENRAGE_MS = 120000; // hard enrage after 2 minutes of fighting

// Mini-boss with telegraphed attacks (red ground markers you can read and dodge):
//  · Bone Slam  — circle drops on where you were standing; damage lands when it fills (stuns).
//  · Grave Charge — a lane lights up in front of him, then he barrels down it (bleeds).
//  · Dirge Nova (phase 2, < 50% HP) — big ring around him; step OUT of it (burns).
// Markers fill up from the centre; the rim flashes white in the last quarter = "move now".
// Hard enrage after 2 min: faster, harder hits. WorldScene/combat calls aiUpdate()
// instead of the generic AI and onSlain() on death.
export class Boss extends Enemy {
  constructor(scene, x, y, typeId, opts) {
    super(scene, x, y, typeId, opts);
    this.isBoss = true;
    this.engaged = false;
    this.state = 'idle';
    this.timer = 0;
    this.phase = 1;
    this.tele = scene.add.graphics().setDepth(3);
    this.plan = null;
    this.enrageAt = 0;
  }

  get hardEnraged() { return this.engaged && this.enrageAt && this.scene.time.now >= this.enrageAt; }
  get dmgMul() { return this.hardEnraged ? 1.5 : 1; }

  damageToPlayer(scene, raw, status) {
    if (scene.combat) { scene.combat.hitPlayerFrom(this, raw * this.dmgMul, status); return; }
    const p = scene.player;
    const n = Math.max(1, Math.round(raw - p.effDef() * 0.5));
    if (p.hurt(n)) {
      bus.emit(Events.PLAYER_HP, scene.hpPayload());
      if (p.dead) scene.onDeath();
    }
  }

  engage(scene) {
    this.engaged = true;
    this.state = 'chase';
    this.timer = 1400;
    this.enrageAt = scene.time.now + ENRAGE_MS;
    this.warned = false;
    this.showBars(true);
    audio.play('roar');
    scene.cameras.main.shake(300, 0.004);
    bus.emit(Events.SYSTEM, `${this.def.name} awakens! Watch the red markers on the floor. (Enrages in 2:00)`);
  }

  reset() {
    this.engaged = false; this.state = 'idle'; this.plan = null;
    this.enraged = false; this.enrageAt = 0;
    this.hp = this.maxHp;
    this.statuses.clear();
    this.showBars(false);
    this.restoreTint();
    this.aura?.destroy(); this.aura = null;
    this.tele.clear();
    this.body.setVelocity(0, 0);
    this.setPosition(this.home.x, this.home.y);
  }

  startAttack(scene, kind) {
    const p = scene.player;
    const fast = (this.phase === 2 ? 0.78 : 1) * (this.hardEnraged ? 0.8 : 1);
    const kit = this.def.kit || {}; // optional per-boss tuning: slamR / len / wide / novaR
    if (kind === 'slam') {
      this.plan = { kind, x: p.x, y: p.y + 2, r: kit.slamR || 40, wind: 1150 * fast, t: 0 };
    } else if (kind === 'charge') {
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      this.plan = { kind, a, len: kit.len || 170, wide: kit.wide || 28, wind: 950 * fast, t: 0, sx: this.x, sy: this.y, dashed: 0, hit: false };
    } else {
      this.plan = { kind: 'nova', x: this.x, y: this.y, r: kit.novaR || 82, wind: 1350 * fast, t: 0 };
    }
    this.state = 'wind';
    audio.play('alert', 0.6);
    this.body.setVelocity(0, 0);
  }

  drawTele() {
    const g = this.tele;
    g.clear();
    const pl = this.plan;
    if (!pl || (this.state !== 'wind' && this.state !== 'dash')) return;
    const now = this.scene.time.now;
    const f = Phaser.Math.Clamp(pl.t / pl.wind, 0, 1);
    const late = this.state === 'wind' && f > 0.75;
    const pulse = 0.16 + 0.1 * Math.sin(now / 60);
    const rim = late && Math.floor(now / 80) % 2 ? 0xffffff : 0xff3030;
    if (pl.kind === 'slam' || pl.kind === 'nova') {
      g.fillStyle(0xff2a2a, pulse).fillCircle(pl.x, pl.y, pl.r);
      g.fillStyle(0xff5a3a, 0.4).fillCircle(pl.x, pl.y, pl.r * f);
      g.lineStyle(late ? 3 : 2, rim, 0.95).strokeCircle(pl.x, pl.y, pl.r);
      // dashed outer guide: the safe edge
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2 + now / 900;
        g.lineStyle(1, 0xffd0c0, 0.6).beginPath().arc(pl.x, pl.y, pl.r + 4, a0, a0 + 0.2).strokePath();
      }
    } else {
      const ex = pl.sx + Math.cos(pl.a) * pl.len, ey = pl.sy + Math.sin(pl.a) * pl.len;
      const nx = -Math.sin(pl.a) * pl.wide / 2, ny = Math.cos(pl.a) * pl.wide / 2;
      const poly = [new Phaser.Geom.Point(pl.sx + nx, pl.sy + ny), new Phaser.Geom.Point(ex + nx, ey + ny), new Phaser.Geom.Point(ex - nx, ey - ny), new Phaser.Geom.Point(pl.sx - nx, pl.sy - ny)];
      g.fillStyle(0xff2a2a, pulse).fillPoints(poly, true);
      const ff = this.state === 'dash' ? 1 : f;
      const mx = pl.sx + Math.cos(pl.a) * pl.len * ff, my = pl.sy + Math.sin(pl.a) * pl.len * ff;
      g.fillStyle(0xff5a3a, 0.4).fillPoints([poly[0], new Phaser.Geom.Point(mx + nx, my + ny), new Phaser.Geom.Point(mx - nx, my - ny), poly[3]], true);
      g.lineStyle(late ? 3 : 2, rim, 0.95).strokePoints(poly, true);
      // chevrons pointing down the lane
      for (let i = 1; i <= 4; i++) {
        const cx = pl.sx + Math.cos(pl.a) * pl.len * (i / 5), cy = pl.sy + Math.sin(pl.a) * pl.len * (i / 5);
        const bx = cx - Math.cos(pl.a) * 6, by = cy - Math.sin(pl.a) * 6;
        g.lineStyle(2, 0xffd0c0, 0.7).lineBetween(bx + nx * 0.5, by + ny * 0.5, cx, cy).lineBetween(bx - nx * 0.5, by - ny * 0.5, cx, cy);
      }
    }
  }

  impactRing(scene, x, y, r) {
    const ring = scene.add.circle(x, y, r * 0.4, 0xff8a5a, 0).setStrokeStyle(3, 0xffc0a0, 0.9).setDepth(3);
    scene.tweens.add({ targets: ring, radius: r * 1.1, alpha: 0, duration: 320, ease: 'quad.out', onComplete: () => ring.destroy() });
  }

  aiUpdate(scene, delta) {
    if (this.hp <= 0) { this.tele.clear(); return; }
    const p = scene.player;
    const now = scene.time.now;
    const d = Phaser.Math.Distance.Between(p.x, p.y, this.x, this.y);
    if (!this.engaged) {
      this.body.setVelocity(0, 0);
      if (!p.dead && d < 150) this.engage(scene);
      this.applyFeel(now);
      return;
    }
    if (p.dead || d > 380) { this.reset(); return; }
    this.phase = this.hp < this.maxHp * 0.5 ? 2 : 1;
    if (this.phase === 2 && !this.enraged) {
      this.enraged = true;
      this.baseTint = 0xff9a9a; this.restoreTint();
      audio.play('roar');
      scene.cameras.main.shake(260, 0.004);
      bus.emit(Events.SYSTEM, `${this.def.name} is enraged! Dirge Nova incoming - step out of the ring.`);
    }
    if (!this.warned && now > this.enrageAt - 30000) {
      this.warned = true;
      bus.emit(Events.SYSTEM, `${this.def.name} grows restless... 30s until he goes berserk!`);
    }
    if (this.hardEnraged && !this.aura) {
      this.aura = scene.add.ellipse(0, 3, 40, 16, 0xff2a2a, 0.45);
      this.addAt(this.aura, 0);
      scene.tweens.add({ targets: this.aura, alpha: 0.12, scaleX: 1.4, scaleY: 1.4, duration: 380, yoyo: true, repeat: -1 });
      audio.play('roar');
      scene.cameras.main.shake(400, 0.006);
      bus.emit(Events.SYSTEM, `${this.def.name} goes BERSERK! (+50% damage, faster attacks)`);
    }
    const slowMul = this.statuses.has('slow', now) ? 0.6 : 1;
    const dx = p.x - this.x, dy = p.y - this.y;
    switch (this.state) {
      case 'chase': {
        const sp = (this.phase === 2 ? 50 : 36) * (this.hardEnraged ? 1.4 : 1) * slowMul;
        if (d > 46) this.body.setVelocity((dx / d) * sp, (dy / d) * sp); else this.body.setVelocity(0, 0);
        this.setFacingByVelocity(dx, dy);
        this.timer -= delta;
        if (this.timer <= 0) {
          const r = Math.random();
          const kind = this.phase === 2 && r < 0.3 ? 'nova' : (d > 90 || r < 0.35) ? 'charge' : 'slam';
          this.startAttack(scene, kind);
        }
        break;
      }
      case 'wind': {
        const pl = this.plan;
        pl.t += delta;
        this.body.setVelocity(0, 0);
        if (pl.kind === 'slam' && pl.t < pl.wind * 0.6) { // marker tracks you for the first part, then locks
          pl.x = Phaser.Math.Linear(pl.x, p.x, 0.06); pl.y = Phaser.Math.Linear(pl.y, p.y + 2, 0.06);
        }
        if (pl.t >= pl.wind) {
          if (pl.kind === 'charge') { this.state = 'dash'; pl.t = 0; pl.wind = 420; this.body.setVelocity(Math.cos(pl.a) * 330, Math.sin(pl.a) * 330); audio.play('dash'); }
          else {
            audio.play('slam');
            scene.spawnFx(pl.x, pl.y - 6, 'fx.explosion', pl.kind === 'nova' ? 3.2 : 2);
            this.impactRing(scene, pl.x, pl.y, pl.r);
            scene.cameras.main.shake(180, 0.006);
            if (Phaser.Math.Distance.Between(p.x, p.y, pl.x, pl.y) < pl.r) {
              this.damageToPlayer(scene, this.atk + (pl.kind === 'nova' ? 4 : 8), pl.kind === 'nova' ? { id: 'burn' } : { id: 'stun', secs: 0.8 });
            }
            this.state = 'recover'; this.timer = this.phase === 2 ? 650 : 950; this.plan = null;
          }
        }
        break;
      }
      case 'dash': {
        const pl = this.plan;
        pl.t += delta;
        if (!pl.hit) {
          const vx = this.x - pl.sx, vy = this.y - pl.sy;
          const L2 = vx * vx + vy * vy || 1;
          const tt = Phaser.Math.Clamp(((p.x - pl.sx) * vx + (p.y - pl.sy) * vy) / L2, 0, 1);
          const dd = Math.hypot(p.x - (pl.sx + vx * tt), p.y - (pl.sy + vy * tt));
          if (dd < pl.wide / 2 + 6 && Math.hypot(p.x - this.x, p.y - this.y) < 26) { pl.hit = true; this.damageToPlayer(scene, this.atk + 6, { id: 'bleed' }); }
        }
        if (pl.t >= pl.wind) {
          this.body.setVelocity(0, 0);
          scene.spawnFx(this.x, this.y - 4, 'fx.dust', 1.6);
          this.state = 'recover'; this.timer = this.phase === 2 ? 700 : 1100; this.plan = null;
        }
        break;
      }
      case 'recover': {
        this.body.setVelocity(0, 0);
        this.timer -= delta;
        if (this.timer <= 0) { this.state = 'chase'; this.timer = (this.phase === 2 ? 900 : 1700) * (this.hardEnraged ? 0.7 : 1); }
        break;
      }
      default: break;
    }
    this.applyFeel(now);
    this.drawTele();
  }

  onSlain(scene) {
    this.tele.clear();
    audio.play('quest');
    bus.emit(Events.SYSTEM, this.def.slainMsg || `${this.def.name} crumbles! The crypt falls quiet.`);
    scene.cameras.main.shake(400, 0.006);
    scene.spawnFx(this.x, this.y - 8, 'fx.explosion', 3);
    scene.combat?.hitStop(120);
    // signature loot on top of the generic roll: fans out around the corpse
    (this.def.drops || []).forEach((dr, i) => {
      if (Math.random() < dr.chance) scene.time.delayedCall(250 + i * 220, () => scene.spawnDrop(this.x + (i - 1) * 14, this.y + 6, dr.id));
    });
    scene.player.potions += 2;
    bus.emit(Events.SYSTEM, this.def.hoardMsg || 'Loot: +2 potions from the Warden\'s hoard.');
  }

  destroy(fromScene) {
    this.tele?.destroy();
    super.destroy(fromScene);
  }
}
