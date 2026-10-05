// Onboarding hint card: bottom-center progress card for first-time players.
import { bus, Events } from '../core/events.js';

const FONT = '"Silkscreen", monospace';
const GREEN = 0x14F195;
const PURPLE = 0x9945FF;
const MUTED = 0x6B7A99;
const WHITE = 0xE1E8F0;
const DARK = 0x0A0E1A;

export class OnboardingHint {
  constructor(scene, { steps, step = 0, onSkip }) {
    this.scene = scene;
    this.steps = steps;
    this.total = steps.length;
    this.step = step;
    this.onSkip = onSkip;
    this.active = true;

    this.container = scene.add.container(0, 0).setDepth(4000).setScrollFactor(0);
    this.bg = scene.add.rectangle(0, 0, 1, 1, DARK, 0.95).setStrokeStyle(2, PURPLE);
    this.title = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#E1E8F0' }).setOrigin(0.5);
    this.sub = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '9px', color: '#9FB0D0', align: 'center', wordWrap: { width: 280 } }).setOrigin(0.5, 0);
    this.dots = [];
    this.skipBtn = scene.add.text(0, 0, 'SKIP X', { fontFamily: FONT, fontSize: '9px', color: '#6B7A99' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.skipBtn.on('pointerdown', () => { if (this.onSkip) this.onSkip(); });
    this.skipBtn.on('pointerover', () => this.skipBtn.setColor('#FFFFFF'));
    this.skipBtn.on('pointerout', () => this.skipBtn.setColor('#6B7A99'));

    this.flash = scene.add.rectangle(0, 0, 1, 1, GREEN, 0).setOrigin(0.5);

    this.container.add([this.bg, this.title, this.sub, ...this.dots, this.skipBtn, this.flash]);

    this.borderPulse = scene.tweens.add({
      targets: this.bg,
      strokeAlpha: { from: 1, to: 0.4 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inout',
    });

    this.render(step);
    scene.scale.on('resize', this.layout, this);
    scene.registry?.events?.on('changedata-worldZoom', this.layout, this); // - / = keys, auto-fit
    this._offResize = () => { scene.scale.off('resize', this.layout, this); scene.registry?.events?.off('changedata-worldZoom', this.layout, this); };
    this.scene.events.once('shutdown', () => this.destroy());
  }

  // The hint lives in WorldScene, whose camera is zoomed (integer zoom 1-4).
  // A scrollFactor-0 object is still scaled about the camera centre, so lay the
  // card out in SCREEN pixels and counter-scale the container: screen = (o - c)*Z + c
  // with o = c*(1 - 1/Z) puts container-local (0,0) on screen (0,0) at 1:1.
  layout() {
    if (!this.active) return;
    const cam = this.scene.cameras.main;
    const Z = cam.zoom || 1;
    const sw = cam.width, sh = cam.height;
    this.container.setScale(1 / Z).setPosition((sw / 2) * (1 - 1 / Z), (sh / 2) * (1 - 1 / Z));
    const W = Math.min(320, sw - 24);
    const H = 70;
    const cx = sw / 2;
    const cy = sh - 124; // above the skill bar, clear of the chat (left) and minimap (right)

    this.bg.setPosition(cx, cy).setSize(W, H);
    this.title.setPosition(cx, cy - 22);
    this.sub.setPosition(cx, cy - 4).setWordWrapWidth(W - 20);
    this.skipBtn.setPosition(cx + W / 2 - 34, cy - 22);
    this.flash.setPosition(cx, cy).setSize(W, H);

    const dotY = cy + 24;
    const startX = cx - ((this.total - 1) * 14) / 2;
    for (let i = 0; i < this.total; i++) {
      const dot = this.dots[i];
      if (dot) dot.setPosition(startX + i * 14, dotY);
    }
  }

  render(step) {
    this.step = step;
    const def = this.steps[Math.min(step, this.total - 1)];
    this.title.setText(def ? `${def.title}` : 'Done');
    this.sub.setText(def ? def.hint : '');

    // Build / refresh dots
    while (this.dots.length < this.total) {
      const d = this.scene.add.circle(0, 0, 4, GREEN, 0.35).setStrokeStyle(1, GREEN);
      this.dots.push(d);
      this.container.addAt(d, 3);
    }
    for (let i = 0; i < this.dots.length; i++) {
      const on = i < step;
      this.dots[i].setFillStyle(GREEN, on ? 1 : 0.35);
      this.dots[i].setScale(on ? 1.2 : 1);
    }
    this.layout();
  }

  setStep(step, flash = true) {
    this.render(step);
    if (flash) {
      this.scene.tweens.killTweensOf(this.flash);
      this.flash.setAlpha(0.55);
      this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 380, ease: 'quad.out' });
    }
  }

  showDone() {
    this.title.setText('Ready!');
    this.sub.setText('Q potion  |  C stats  |  L journal  |  H all controls');
    this.skipBtn.setVisible(false);
    for (const d of this.dots) d.setFillStyle(GREEN, 1);
    this.layout();
  }

  destroy() {
    if (!this.active) return;
    this.active = false;
    this._offResize?.();
    this.borderPulse?.stop();
    this.scene.tweens.killTweensOf(this.bg);
    this.scene.tweens.killTweensOf(this.flash);
    this.container.destroy();
  }
}
