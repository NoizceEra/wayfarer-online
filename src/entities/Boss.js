import Phaser from 'phaser';
import { Enemy } from './Enemy.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';

// Mini-boss with telegraphed attacks (red ground markers you can read and dodge):
//  · Bone Slam  — circle drops on where you were standing; damage lands when it fills.
//  · Grave Charge — a lane lights up in front of him, then he barrels down it.
//  · Dirge Nova (phase 2, < 50% HP) — big ring around him; step OUT of it.
// WorldScene calls aiUpdate() instead of the generic chase AI and onSlain() on death.
export class Boss extends Enemy {
  constructor(scene, x, y, typeId) {
    super(scene, x, y, typeId);
    this.isBoss = true;
    this.engaged = false;
    this.state = 'idle';
    this.timer = 0;
    this.phase = 1;
    this.tele = scene.add.graphics().setDepth(3);
    this.plan = null;
  }

  damageToPlayer(scene, raw) {
    const p = scene.player;
    const n = Math.max(1, Math.round(raw - p.effDef() * 0.5));
    if (p.hurt(n)) {
      bus.emit(Events.PLAYER_HP, scene.hpPayload());
      audio.play('hurt');
      scene.cameras.main.shake(160, 0.005);
      scene.damageNumber(p.x, p.y, `-${n}`, '#ff6b6b');
      if (p.dead) scene.onDeath();
    }
  }

  engage(scene) {
    this.engaged = true;
    this.state = 'chase';
    this.timer = 1400;
    audio.play('roar');
    scene.cameras.main.shake(300, 0.004);
    bus.emit(Events.SYSTEM, `${this.def.name} awakens! Watch the red markers on the floor.`);
  }

  reset() {
    this.engaged = false; this.state = 'idle'; this.plan = null;
    this.hp = this.maxHp;
    this.hpbar.setDisplaySize(16, 2); this.hpbar.setFillStyle(0x2ecc71);
    this.hpbarBg.setVisible(false); this.hpbar.setVisible(false);
    this.tele.clear();
    this.body.setVelocity(0, 0);
    this.setPosition(this.home.x, this.home.y);
  }

  startAttack(scene, kind) {
    const p = scene.player;
    const fast = this.phase === 2 ? 0.78 : 1;
    if (kind === 'slam') {
      this.plan = { kind, x: p.x, y: p.y + 2, r: 40, wind: 1150 * fast, t: 0 };
      this.state = 'wind';
    } else if (kind === 'charge') {
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      this.plan = { kind, a, len: 170, wide: 28, wind: 950 * fast, t: 0, sx: this.x, sy: this.y, dashed: 0, hit: false };
      this.state = 'wind';
    } else {
      this.plan = { kind: 'nova', x: this.x, y: this.y, r: 82, wind: 1350 * fast, t: 0 };
      this.state = 'wind';
    }
    audio.play('alert', 0.6);
    this.body.setVelocity(0, 0);
  }

  drawTele() {
    const g = this.tele;
    g.clear();
    const pl = this.plan;
    if (!pl || (this.state !== 'wind' && this.state !== 'dash')) return;
    const f = Phaser.Math.Clamp(pl.t / pl.wind, 0, 1);
    const pulse = 0.16 + 0.1 * Math.sin(this.scene.time.now / 60);
    if (pl.kind === 'slam' || pl.kind === 'nova') {
      g.fillStyle(0xff2a2a, pulse).fillCircle(pl.x, pl.y, pl.r);
      g.fillStyle(0xff5a3a, 0.35).fillCircle(pl.x, pl.y, pl.r * f);
      g.lineStyle(2, 0xff3030, 0.95).strokeCircle(pl.x, pl.y, pl.r);
    } else {
      const ex = pl.sx + Math.cos(pl.a) * pl.len, ey = pl.sy + Math.sin(pl.a) * pl.len;
      const nx = -Math.sin(pl.a) * pl.wide / 2, ny = Math.cos(pl.a) * pl.wide / 2;
      const poly = [new Phaser.Geom.Point(pl.sx + nx, pl.sy + ny), new Phaser.Geom.Point(ex + nx, ey + ny), new Phaser.Geom.Point(ex - nx, ey - ny), new Phaser.Geom.Point(pl.sx - nx, pl.sy - ny)];
      g.fillStyle(0xff2a2a, pulse).fillPoints(poly, true);
      const mx = pl.sx + Math.cos(pl.a) * pl.len * f, my = pl.sy + Math.sin(pl.a) * pl.len * f;
      g.fillStyle(0xff5a3a, 0.35).fillPoints([poly[0], new Phaser.Geom.Point(mx + nx, my + ny), new Phaser.Geom.Point(mx - nx, my - ny), poly[3]], true);
      g.lineStyle(2, 0xff3030, 0.95).strokePoints(poly, true);
    }
  }

  aiUpdate(scene, delta) {
    if (this.hp <= 0) { this.tele.clear(); return; }
    const p = scene.player;
    const d = Phaser.Math.Distance.Between(p.x, p.y, this.x, this.y);
    if (!this.engaged) {
      this.body.setVelocity(0, 0);
      if (!p.dead && d < 150) this.engage(scene);
      return;
    }
    if (p.dead || d > 380) { this.reset(); return; }
    this.phase = this.hp < this.maxHp * 0.5 ? 2 : 1;
    if (this.phase === 2 && !this.enraged) {
      this.enraged = true;
      this.sprite.setTint(0xff9a9a);
      audio.play('roar');
      scene.cameras.main.shake(260, 0.004);
      bus.emit(Events.SYSTEM, `${this.def.name} is enraged! Dirge Nova incoming - step out of the ring.`);
    }
    const dx = p.x - this.x, dy = p.y - this.y;
    switch (this.state) {
      case 'chase': {
        const sp = this.phase === 2 ? 50 : 36;
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
            // impact
            audio.play('slam');
            scene.spawnFx(pl.x, pl.y - 6, 'fx.explosion', pl.kind === 'nova' ? 3.2 : 2);
            scene.cameras.main.shake(180, 0.006);
            if (Phaser.Math.Distance.Between(p.x, p.y, pl.x, pl.y) < pl.r) this.damageToPlayer(scene, this.def.atk + (pl.kind === 'nova' ? 4 : 8));
            this.state = 'recover'; this.timer = this.phase === 2 ? 650 : 950; this.plan = null;
          }
        }
        break;
      }
      case 'dash': {
        const pl = this.plan;
        pl.t += delta;
        if (!pl.hit) {
          // distance from player to the dash lane segment (sx,sy)->(boss)
          const vx = this.x - pl.sx, vy = this.y - pl.sy;
          const L2 = vx * vx + vy * vy || 1;
          const tt = Phaser.Math.Clamp(((p.x - pl.sx) * vx + (p.y - pl.sy) * vy) / L2, 0, 1);
          const dd = Math.hypot(p.x - (pl.sx + vx * tt), p.y - (pl.sy + vy * tt));
          if (dd < pl.wide / 2 + 6 && Math.hypot(p.x - this.x, p.y - this.y) < 26) { pl.hit = true; this.damageToPlayer(scene, this.def.atk + 6); }
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
        if (this.timer <= 0) { this.state = 'chase'; this.timer = this.phase === 2 ? 900 : 1700; }
        break;
      }
      default: break;
    }
    this.drawTele();
  }

  onSlain(scene) {
    this.tele.clear();
    audio.play('quest');
    bus.emit(Events.SYSTEM, `${this.def.name} crumbles! The crypt falls quiet.`);
    scene.cameras.main.shake(400, 0.006);
    scene.spawnFx(this.x, this.y - 8, 'fx.explosion', 3);
    // bonus loot beyond the single generic roll
    const extras = (this.def.drops || []).slice(1);
    extras.forEach((dr, i) => {
      if (Math.random() < dr.chance) scene.time.delayedCall(250 + i * 200, () => scene.spawnDrop(this.x + (i - 0.5) * 18, this.y + 10, dr.id));
    });
    scene.player.potions += 2;
  }

  destroy(fromScene) {
    this.tele?.destroy();
    super.destroy(fromScene);
  }
}
