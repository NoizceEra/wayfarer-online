// Onboarding hint card: top-centre progress card for first-time players (first slot of the shared HUD stack, ui/hudLayout.js).
import { bus, Events } from '../core/events.js';
import { stackY, setStackH } from './hudLayout.js';
import { calmMotion } from './theme.js';

const FONT = '"Silkscreen", monospace';
const GREEN = 0x9bbc0f;
const PURPLE = 0xc8a840;
const MUTED = 0xa89a7e;
const WHITE = 0xf4f0dc;
const DARK = 0x1a1008;

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
    this.title = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#f4f0dc' }).setOrigin(0.5);
    this.sub = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '10px', color: '#f4f0dc', align: 'center' }).setOrigin(0.5);
    this.dots = [];
    this.skipBtn = scene.add.text(0, 0, 'SKIP', { fontFamily: FONT, fontSize: '10px', color: '#ffe8a0', padding: { x: 8, y: 6 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.skipBtn.on('pointerdown', () => { if (this.onSkip) this.onSkip(); });
    this.skipBtn.on('pointerover', () => this.skipBtn.setColor('#FFFFFF'));
    this.skipBtn.on('pointerout', () => this.skipBtn.setColor('#ffe8a0'));

    this.flash = scene.add.rectangle(0, 0, 1, 1, GREEN, 0).setOrigin(0.5);

    this.container.add([this.bg, this.title, this.sub, ...this.dots, this.skipBtn, this.flash]);

    // border pulse is decorative: steady border with Reduce motion
    this.borderPulse = calmMotion() ? null : scene.tweens.add({
      targets: this.bg,
      strokeAlpha: { from: 1, to: 0.4 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inout',
    });

    this.render(step);
    scene.scale.on('resize', this.layout, this);
    this._tick = () => this.layout(); // world zoom (+/-) moves the camera transform: keep the card on the HUD grid
    scene.events.on('update', this._tick);
    this._offResize = () => scene.scale.off('resize', this.layout, this);
    this.scene.events.once('shutdown', () => this.destroy());
  }

  layout() {
    // This card lives in the (zoomed) world camera but must sit on the HUD grid: convert the HUD slot
    // (logical px, UI zoom) to world-camera coordinates (zoom is about the viewport centre), and
    // counter-scale so it is 1x on screen.
    const cam = this.scene.cameras.main;
    const z = cam.zoom || 1;
    const uz = this.scene.scene.get('ui')?.uiZoom || 1;
    const Wl = cam.width / uz;
    const W = Math.min(260, Wl - 16);
    const H = 66;
    setStackH('hint', H);
    const sx = cam.width / 2, sy = (stackY('hint', Wl) + H / 2) * uz;
    this.container.setPosition((sx - cam.width / 2) / z + cam.width / 2, (sy - cam.height / 2) / z + cam.height / 2).setScale(uz / z);

    this.bg.setPosition(0, 0).setSize(W, H);
    this.title.setPosition(0, -18);
    this.sub.setWordWrapWidth?.(W - 16);
    this.sub.setStyle({ wordWrap: { width: W - 16 } });
    this.sub.setPosition(0, -2);
    this.skipBtn.setPosition(W / 2 - 26, -18);
    this.flash.setPosition(0, 0).setSize(W, H);

    const dotY = 22;
    const startX = -((this.total - 1) * 14) / 2;
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
    if (flash && !calmMotion()) {
      this.scene.tweens.killTweensOf(this.flash);
      this.flash.setAlpha(0.55);
      this.scene.tweens.add({ targets: this.flash, alpha: 0, duration: 380, ease: 'quad.out' });
    }
  }

  showDone() {
    this.title.setText('Ready!');
    this.sub.setText('Quests await at the notice board.');
    this.skipBtn.setVisible(false);
    for (const d of this.dots) d.setFillStyle(GREEN, 1);
    this.layout();
  }

  destroy() {
    if (!this.active) return;
    this.active = false;
    this._offResize?.();
    setStackH('hint', 0);
    this.scene.events.off('update', this._tick);
    this.borderPulse?.stop();
    this.scene.tweens.killTweensOf(this.bg);
    this.scene.tweens.killTweensOf(this.flash);
    this.container.destroy();
  }
}
