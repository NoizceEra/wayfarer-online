// Toast queue (top-centre, below the zone label): achievements, quest
// accepted/complete, recipe learned, lore unlocked. Drawn rects only.
import { label, box } from './gearUI.js';

export class Toaster {
  constructor(scene) {
    this.scene = scene;
    this.q = [];
    this.cur = null;
  }
  push(t) {
    this.q.push(t);
    if (this.q.length > 6) this.q.shift();
    if (!this.cur) this.next();
  }
  next() {
    const t = this.q.shift();
    if (!t) { this.cur = null; return; }
    const s = this.scene, W = s.scale.width;
    const w = Math.min(W - 16, 250), h = t.sub ? 50 : 38;
    const c = s.add.container(W / 2, -h - 4).setDepth(700);
    c.add(box(s, -w / 2, 0, w, h, 0x1a1408, 0.96, t.badge ? 0xffd84a : 0x8d5a2b, 2));
    const col = t.color || '#ffd84a';
    c.add(label(s, -w / 2 + 10, 5, (t.title || '').toUpperCase(), 8, col));
    c.add(label(s, -w / 2 + 10, 17, t.text || '', 11, '#fff6d8', { fontStyle: 'bold', wordWrap: { width: w - 20 } }));
    if (t.sub) c.add(label(s, -w / 2 + 10, 33, t.sub, 7, '#b9b39a', { wordWrap: { width: w - 20 } }));
    this.cur = c;
    const y = s.small ? Math.max(150, s.scale.height - 210) : 44;
    s.tweens.add({
      targets: c, y, duration: 260, ease: 'back.out',
      onComplete: () => {
        s.time.delayedCall(2400, () => s.tweens.add({ targets: c, y: -h - 6, alpha: 0, duration: 280, onComplete: () => { c.destroy(); this.cur = null; this.next(); } }));
      },
    });
  }
  destroy() { this.cur?.destroy(); this.q = []; }
}
