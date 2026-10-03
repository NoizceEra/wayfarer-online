import { bus, Events } from '../core/events.js';

// Small top-centre popup card for a world boss spawn. Auto-dismiss after 8s
// or on click. The "Warp" button is a placeholder: the game has no single-
// click warp to an arbitrary world coordinate, and implementing a safe warp
// path requires changes outside this module's scope (AreaManager/WorldScene).
//
// Usage: const t = new WorldBossToast(scene, { area, x, y, name }); t.destroy();
const FONT = '"Silkscreen", monospace';
const W = 260;
const PAD = 10;

export class WorldBossToast {
  constructor(scene, { area = 'ruins', name = 'World Boss', x = 0, y = 0 }) {
    this.scene = scene;
    this.destroyed = false;
    const cam = scene.cameras.main;
    const cx = cam.width / 2;
    const top = 28;

    this.container = scene.add.container(cx, top - 40).setDepth(3900);

    const bg = scene.add.rectangle(0, 0, W, 60, 0x1a1510, 0.95)
      .setStrokeStyle(2, 0xff9a3a).setOrigin(0.5, 0);

    const title = scene.add.text(0, PAD, 'WORLD BOSS', {
      fontFamily: FONT, fontSize: '10px', color: '#ff9a3a', fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    const sub = scene.add.text(0, PAD + 14, `${name} in ${(area || 'ruins').toUpperCase()}`, {
      fontFamily: FONT, fontSize: '9px', color: '#f4ecd8',
    }).setOrigin(0.5, 0);

    const btn = scene.add.rectangle(0, PAD + 32, 90, 16, 0xc0392b).setOrigin(0.5, 0);
    const btnText = scene.add.text(0, PAD + 34, 'Warp to fight', {
      fontFamily: FONT, fontSize: '8px', color: '#fff',
    }).setOrigin(0.5, 0);

    this.container.add([bg, title, sub, btn, btnText]);
    this.container.setSize(W, 60);

    // slide in
    scene.tweens.add({ targets: this.container, y: top, duration: 280, ease: 'back.out' });

    this.dismissTimer = scene.time.delayedCall(8000, () => this.destroy());

    const click = () => {
      // PLACEHOLDER: safe zone warp to the boss coordinates is not implemented here.
      // To wire this, call scene.areas.warp(null, x, y, { label: 'Warping to World Boss...' })
      // after verifying the player can leave their current area.
      bus.emit(Events.SYSTEM, `Warp to ${name} is not yet implemented.`);
      this.destroy();
    };
    btn.setInteractive();
    btnText.setInteractive();
    btn.on('pointerdown', click);
    btnText.on('pointerdown', click);
    bg.setInteractive();
    bg.on('pointerdown', click);

    this.objs = [this.container, bg, title, sub, btn, btnText];
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.dismissTimer) this.dismissTimer.remove();
    this.scene.tweens.add({
      targets: this.container, alpha: 0, y: this.container.y - 20,
      duration: 220, ease: 'quad.in',
      onComplete: () => {
        this.container?.destroy();
      },
    });
  }
}
