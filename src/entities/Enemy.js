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
    this.sprite = scene.add.sprite(0, -6, this.texKey, 0);
    // Per-type HP bar y: Slime sits only in the bottom half of the 16px frame
    // (visual top at container y≈-8), so the default y=-18 floats way above it.
    // All other monsters fill from y=0 of frame (container top ≈-14), y=-18 is fine.
    const hpBarY = (def.sprite === 'Slime') ? -12 : -18;
    this.hpbarBg = scene.add.rectangle(0, hpBarY, 18, 3, 0x000000, 0.6).setVisible(false);
    this.hpbar = scene.add.rectangle(-8, hpBarY, 16, 2, 0x2ecc71).setOrigin(0, 0.5).setVisible(false);
    this.add([this.shadow, this.sprite, this.hpbarBg, this.hpbar]);
    this.setDepth(8);
    this.aiState = 'idle'; this.stateUntil = 0; this.nextAtk = 0;
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.isSlime = def.sprite === 'Slime';
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
  get windingUp() { return this.aiState === 'windup'; }

  // Attack telegraph + idle wobble. Called every frame from WorldScene's enemy
  // AI with distance to the player. Returns true while the enemy is busy
  // (winding up / lunging / recovering) so the caller skips normal steering.
  updateFeel(time, d, player, canAttack) {
    const sp = this.sprite;
    const restY = -6, halfH = 8; // sprite centre / half frame, keeps feet planted when squashing
    let sx = 1, sy = 1;
    let busy = false;
    if (this.aiState === 'idle') {
      const amp = this.isSlime ? 0.09 : 0.03;
      const w = Math.sin(time / (this.isSlime ? 240 : 330) + this.wobblePhase);
      sy = 1 + w * amp; sx = 1 - w * amp * 0.8;
      if (canAttack && d < 30 && time >= this.nextAtk) {
        this.aiState = 'windup'; this.stateUntil = time + 380;
        this.body.setVelocity(0, 0);
        this.showBang(true);
      }
    }
    if (this.aiState === 'windup') {
      busy = true;
      const t = 1 - (this.stateUntil - time) / 380;
      this.body.setVelocity(0, 0);
      sy = 1 - 0.22 * t; sx = 1 + 0.18 * t;           // crouch / coil
      if (Math.floor(time / 70) % 2) sp.setTintFill(0xff6655); else sp.clearTint();
      if (player) { // lean away from the player
        const a = Math.atan2(player.y - this.y, player.x - this.x);
        sp.x = -Math.cos(a) * 2 * t;
        this.lungeAngle = a;
      }
      if (time >= this.stateUntil) {
        this.aiState = 'lunge'; this.stateUntil = time + 170;
        sp.clearTint(); sp.x = 0; this.showBang(false);
        this.body.setVelocity(Math.cos(this.lungeAngle) * 150, Math.sin(this.lungeAngle) * 150);
      }
    } else if (this.aiState === 'lunge') {
      busy = true;
      sx = 1.25; sy = 0.8;
      if (time >= this.stateUntil) {
        this.aiState = 'recover'; this.stateUntil = time + 450;
        this.body.setVelocity(0, 0);
        this.nextAtk = time + 1500;
      }
    } else if (this.aiState === 'recover') {
      busy = true;
      this.body.setVelocity(0, 0);
      if (time >= this.stateUntil) this.aiState = 'idle';
    }
    sp.setScale(sx, sy);
    sp.y = (this.aiState === 'idle' || this.aiState === 'windup' || this.aiState === 'lunge' || this.aiState === 'recover')
      ? (restY + halfH) - halfH * sy : restY;
    return busy;
  }

  showBang(on) {
    if (on && !this.bang) {
      this.bang = this.scene.add.text(0, -24, '!', {
        fontFamily: '"Silkscreen", monospace', fontSize: '12px', color: '#ffe14a', stroke: '#b3261e', strokeThickness: 3,
      }).setOrigin(0.5);
      this.add(this.bang);
    }
    if (!this.bang) return;
    this.bang.setVisible(on);
    if (on) {
      this.bang.setScale(0.4);
      this.scene.tweens.add({ targets: this.bang, scale: 1.2, duration: 120, yoyo: true, ease: 'back.out' });
    }
  }

  hurt(n) {
    this.hp -= n;
    if (this.aiState === 'windup' || this.aiState === 'lunge') { // getting hit interrupts the attack
      this.aiState = 'recover'; this.stateUntil = this.scene.time.now + 250; this.nextAtk = this.scene.time.now + 900;
      this.sprite.x = 0; this.showBang(false);
    }
    this.hpbarBg.setVisible(true); this.hpbar.setVisible(true);
    const frac = Math.max(0, this.hp / this.maxHp);
    this.hpbar.setDisplaySize(16 * frac, 2);
    this.hpbar.setFillStyle(frac > 0.5 ? 0x2ecc71 : frac > 0.25 ? 0xf39c12 : 0xe74c3c);
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => this.sprite.clearTint());
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
