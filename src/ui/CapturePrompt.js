// Small Phaser-object modal for the wild wisp capture prompt.
// Silkscreen font, dark panel with coloured border, matching the existing UI style.
import { box, label } from './gearUI.js';

export class CapturePrompt {
  constructor(scene, name, onAction) {
    this.scene = scene;
    this.onAction = onAction;
    this.wisp = null;

    const cam = scene.cameras.main;
    const W = 220, H = 90;
    const x = cam.midPoint.x;
    const y = cam.midPoint.y - 50;

    this.c = scene.add.container(x, y).setDepth(3000).setScrollFactor(0);

    // background + border (gearUI box is screen-space graphics)
    const bg = box(scene, -W / 2, -H / 2, W, H, 0x1a120b, 0.97, 0x6ab8ff, 2);
    this.c.add(bg);

    this.c.add(label(scene, 0, -H / 2 + 14, `A wild ${name} appeared!`, 10, '#9fd8ff').setOrigin(0.5));

    const btnW = 86, btnH = 26;
    const by = H / 2 - 20;
    const use = this._makeBtn(-48, by, btnW, btnH, 'Use Orb', 0x2a2015, 0x6ab8ff, () => this._pick('capture'));
    const letGo = this._makeBtn(48, by, btnW, btnH, 'Let Go', 0x2a2015, 0x9a9a9a, () => this._pick('letgo'));
    this.c.add([use.g, use.t, letGo.g, letGo.t]);

    // close on E / interact too (handled by caller uiLock), but also pointer blocker
    this.blocker = scene.add.rectangle(0, 0, cam.width + 200, cam.height + 200, 0x000000, 0.01)
      .setDepth(2999).setScrollFactor(0).setInteractive();
    this.blocker.on('pointerdown', () => this._pick('letgo'));
  }

  _makeBtn(x, y, w, h, text, fill, border, cb) {
    const g = this.scene.add.rectangle(x, y, w, h, fill, 1)
      .setStrokeStyle(1, border).setInteractive({ useHandCursor: true });
    const t = label(this.scene, x, y, text, 10, '#fff').setOrigin(0.5);
    g.on('pointerover', () => g.setFillStyle(0x4a3a22));
    g.on('pointerout', () => g.setFillStyle(fill));
    g.on('pointerdown', cb);
    return { g, t };
  }

  _pick(action) {
    if (this.done) return;
    this.done = true;
    if (this.onAction) this.onAction(action);
  }

  destroy() {
    this.c?.destroy();
    this.blocker?.destroy();
  }
}
