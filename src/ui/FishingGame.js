// Fishing mini-game (screen space, lives in UIScene): cast -> wait for a bite ->
// hit E / click / tap while the marker is over the green zone. Cancel with X/Esc.
import Phaser from 'phaser';
import { audio } from '../systems/audio.js';
import { bus, Events } from '../core/events.js';
import { label, box } from './gearUI.js';

const BAR_W = 220;

export class FishingGame {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.c = null;
    this.phase = null;
    scene.input.keyboard.on('keydown-E', () => this.press());
    scene.input.keyboard.on('keydown-SPACE', () => this.press());
    scene.input.keyboard.on('keydown-X', () => this.end('cancel'));
    scene.input.keyboard.on('keydown-ESC', () => this.end('cancel'));
    this.off = bus.on(Events.FISH, (e) => this.start(e));
  }
  world() { return this.scene.world?.(); }
  get isOpen() { return this.active; }
  destroy() { this.off?.(); this.c?.destroy(); }

  start({ node, table }) {
    if (this.active) return;
    const w = this.world();
    if (!w?.player || w.player.dead) return;
    this.node = node; this.table = table; this.active = true; this.t0 = this.scene.time.now;
    this.hp0 = w.player.hp;
    w.uiLock = true; w.uiModal = true;
    w.player.body?.setVelocity(0, 0);
    this.build();
    this.setPhase('wait');
    audio.play('swing', 0.5);
  }

  build() {
    const s = this.scene, W = s.scale.width, H = s.scale.height;
    this.c?.destroy();
    const c = s.add.container(W / 2, Math.max(150, H * 0.3)).setDepth(250);
    this.c = c;
    const w = BAR_W + 40, h = 112;
    c.add(box(s, -w / 2, 0, w, h, 0x0c1a26, 0.95, 0x5ad1ff, 2));
    c.add(label(s, 0, 8, 'FISHING', 9, '#9fe8ff').setOrigin(0.5, 0));
    this.msg = label(s, 0, 26, '', 10, '#e8f4ff', { align: 'center', wordWrap: { width: w - 20 } }).setOrigin(0.5, 0);
    c.add(this.msg);
    this.bobber = s.add.circle(0, 62, 4, 0xe74c3c).setStrokeStyle(1, 0xffffff);
    this.ripple = s.add.ellipse(0, 66, 14, 5, 0xffffff, 0.3);
    c.add([this.ripple, this.bobber]);
    // timing bar
    this.barBg = s.add.rectangle(0, 82, BAR_W, 14, 0x16364a).setStrokeStyle(1, 0x5ad1ff).setVisible(false);
    this.zone = s.add.rectangle(0, 82, 50, 12, 0x3fbf6a).setVisible(false);
    this.mark = s.add.rectangle(-BAR_W / 2, 82, 4, 18, 0xffffff).setVisible(false);
    c.add([this.barBg, this.zone, this.mark]);
    c.add(label(s, 0, h - 14, 'E / click: act    X: stop', 7, '#7d98a8').setOrigin(0.5, 0));
    const hit = s.add.rectangle(0, h / 2, w, h, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', (p, lx, ly, ev) => { ev?.stopPropagation?.(); this.press(); });
    c.addAt(hit, 1);
  }

  setPhase(p) {
    const s = this.scene;
    this.phase = p; this.pt = 0;
    if (p === 'wait') {
      const luk = this.world()?.player.equipBonuses().luk || 0;
      this.dur = Phaser.Math.FloatBetween(1.2, 3.2) * Math.max(0.5, 1 - luk * 0.01);
      this.msg.setText('Line cast... waiting for a bite.');
      this.bobber.setY(62);
      s.tweens.add({ targets: this.bobber, y: 64, duration: 500, yoyo: true, repeat: -1, ease: 'sine.inout' });
    } else if (p === 'bite') {
      this.dur = 0.85;
      this.msg.setText('BITE!  Press E now!').setColor('#ffd84a');
      s.tweens.killTweensOf(this.bobber);
      this.bobber.setY(68);
      s.tweens.add({ targets: this.bobber, y: 72, duration: 80, yoyo: true, repeat: 5 });
      audio.play('alert', 0.5);
    } else if (p === 'reel') {
      this.msg.setText('Reel in! Stop the marker in the green.').setColor('#e8f4ff');
      const zw = Phaser.Math.Between(40, 62);
      this.zx = Phaser.Math.Between(-BAR_W / 2 + zw / 2 + 12, BAR_W / 2 - zw / 2 - 12);
      this.zw = zw;
      this.zone.setPosition(this.zx, 82).setSize(zw, 12).setVisible(true);
      this.barBg.setVisible(true); this.mark.setVisible(true);
      this.mx = -BAR_W / 2; this.mdir = 1;
      this.mspd = Phaser.Math.Between(170, 230);
    }
  }

  press() {
    if (!this.active || this.scene.time.now - this.t0 < 350) return;
    if (this.phase === 'wait') { this.msg.setText('Too early! You scared the fish off.'); return this.finish(false); }
    if (this.phase === 'bite') return this.setPhase('reel');
    if (this.phase === 'reel') {
      const ok = Math.abs(this.mark.x - this.zx) <= this.zw / 2;
      this.msg.setText(ok ? 'Got it!' : 'It slipped the hook...').setColor(ok ? '#9be88a' : '#ff8a7a');
      this.finish(ok);
    }
  }

  finish(ok) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.scene.tweens.killTweensOf(this.bobber);
    const w = this.world();
    if (ok && w?.gather) w.gather.onCatch(this.node, this.table);
    audio.play(ok ? 'gold' : 'error', 0.5);
    this.scene.time.delayedCall(ok ? 500 : 800, () => this.end(ok ? 'ok' : 'fail'));
  }

  end(why) {
    if (!this.active) return;
    this.active = false;
    this.scene.tweens.killTweensOf(this.bobber);
    this.c?.destroy(); this.c = null;
    const w = this.world();
    if (w) { w.uiLock = false; w.uiLockUntil = w.time.now + 240; w.uiModal = !!(this.scene.equip?.isOpen || this.scene.shop?.isOpen || this.scene.journal?.isOpen || this.scene.craftPanel?.isOpen); }
    // a good catch stirs the water: the spot is quiet for a short while (failed casts can be retried at once)
    if (why === 'ok' && this.node?.ready) w?.gather?.deplete(this.node);
  }

  update(dt) {
    if (!this.active) return;
    const w = this.world();
    if (w?.player && (w.player.hp < this.hp0 - 0.5 || w.player.dead)) { this.msg?.setText('Ouch!'); this.end('cancel'); return; }
    this.hp0 = w?.player?.hp ?? this.hp0;
    if (this.phase === 'wait') { this.pt += dt; if (this.pt >= this.dur) this.setPhase('bite'); }
    else if (this.phase === 'bite') { this.pt += dt; if (this.pt >= this.dur) { this.msg.setText('Too slow. It got away.').setColor('#ff8a7a'); this.finish(false); } }
    else if (this.phase === 'reel') {
      this.mx += this.mdir * this.mspd * dt;
      if (this.mx > BAR_W / 2) { this.mx = BAR_W / 2; this.mdir = -1; }
      if (this.mx < -BAR_W / 2) { this.mx = -BAR_W / 2; this.mdir = 1; }
      this.mark.x = this.mx;
    }
  }
}
