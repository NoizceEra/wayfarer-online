import Phaser from 'phaser';
import { ENEMY_TABLE } from '../data/jobs.js';

export class Enemy extends Phaser.GameObjects.Container {
  constructor(scene, x, y, typeId) {
    super(scene, x, y);
    const def = ENEMY_TABLE[typeId] || ENEMY_TABLE.dewslime;
    this.def = def; this.typeId = typeId;
    this.maxHp = def.hp; this.hp = def.hp;
    this.home = { x, y };
    this.facing = 'down';
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setSize(14, 12);
    this.shadow = scene.add.image(0, 3, 'char.shadow').setScale(1.2, 1);
    this.texKey = `mon.${def.sprite}`;
    if (!scene.textures.exists(this.texKey)) this.texKey = 'mon.Slime';
    this.sprite = scene.add.sprite(0, -6 * (def.scale || 1), this.texKey, 0);
    if (def.scale) { this.sprite.setScale(def.scale); this.shadow.setScale(1.2 * def.scale, def.scale); this.body.setSize(14 * def.scale, 12 * def.scale); }
    if (def.tint) this.sprite.setTint(def.tint);
    // Per-type HP bar y: Slime sits only in the bottom half of the 16px frame
    // (visual top at container y≈-8), so the default y=-18 floats way above it.
    // All other monsters fill from y=0 of frame (container top ≈-14), y=-18 is fine.
    const sc = def.scale || 1;
    const hpBarY = (def.sprite === 'Slime') ? -12 : -18 - Math.round(8 * (sc - 1));
    this.hpbarBg = scene.add.rectangle(0, hpBarY, 18, 3, 0x000000, 0.6).setVisible(false);
    this.hpbar = scene.add.rectangle(-8, hpBarY, 16, 2, 0x2ecc71).setOrigin(0, 0.5).setVisible(false);
    this.add([this.shadow, this.sprite, this.hpbarBg, this.hpbar]);
    this.setDepth(8);
    this.playMove();
  }
  playMove() {
    const key = `${this.texKey}.move.${this.facing}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
  }
  setFacingByVelocity(vx, vy) {
    let dir = this.facing;
    if (Math.abs(vx) > Math.abs(vy)) dir = vx > 0 ? 'right' : 'left';
    else if (Math.abs(vy) > 0.5) dir = vy > 0 ? 'down' : 'up';
    if (dir !== this.facing) { this.facing = dir; this.playMove(); }
  }
  hurt(n) {
    this.hp -= n;
    this.hpbarBg.setVisible(true); this.hpbar.setVisible(true);
    const frac = Math.max(0, this.hp / this.maxHp);
    this.hpbar.setDisplaySize(16 * frac, 2);
    this.hpbar.setFillStyle(frac > 0.5 ? 0x2ecc71 : frac > 0.25 ? 0xf39c12 : 0xe74c3c);
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => { this.sprite.clearTint(); if (this.def.tint) this.sprite.setTint(this.def.tint); });
    // knockback away from player
    const p = this.scene.player;
    if (p) {
      const a = Math.atan2(this.y - p.y, this.x - p.x);
      this.body.setVelocity(Math.cos(a) * 160, Math.sin(a) * 160);
      this.scene.time.delayedCall(120, () => { if (this.active) this.body.setVelocity(0, 0); });
    }
    return this.hp <= 0;
  }
}
