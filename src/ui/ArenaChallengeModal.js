import { arenaNet } from '../net/arenaNet.js';

// Solana palette: bg #1a1008, panel #2a1d10, green #9bbc0f, purple #c8a840, cyan #a0c4f0.
const C = {
  bg: 0x1a1008,
  panel: 0x2a1d10,
  green: 0x9bbc0f,
  purple: 0xc8a840,
  cyan: 0xa0c4f0,
  text: '#e8f4ff',
  dim: '#7d8db0',
};
const FONT = '"Silkscreen", monospace';

// Server expires unanswered challenges after 45s (see server/arena.js).
// Mirror PetDuelRequest's canvas-modal + Escape conventions; the modal is
// Phaser canvas (not DOM), so hudPolish.attachPanelBehavior does not apply.
export const CHALLENGE_TTL_MS = 45 * 1000;

// Phaser modal shown when another player challenges us to an arena duel.
// Expected payload: { from, fromName, rating?, expiresAt? }.
// Accept -> arena:accept { target: from }; Decline/Escape/timeout -> arena:decline.
export class ArenaChallengeModal {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.pending = null;
    this.timer = null;
    this._keyDown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation?.(); this._decline(); }
    };
  }

  get isOpen() { return !!this.container; }

  show({ from, fromName, rating, expiresAt } = {}) {
    if (!from && !fromName) return false;
    this.hide();
    this.pending = { from: from ?? fromName, fromName: fromName ?? from };
    try {
      const s = this.scene;
      if (!s?.add?.container) return false;
      const { w: W, h: H } = s.view ? s.view() : { w: s.scale.width, h: s.scale.height };
      const pw = Math.min(W - 32, 360);
      const ph = 150;

      const c = s.add.container(W / 2, H / 2 - 30).setDepth(200).setScrollFactor(0);
      const bg = s.add.rectangle(0, 0, pw, ph, C.bg, 0.97).setStrokeStyle(2, C.purple);
      const bar = s.add.rectangle(0, -ph / 2 + 14, pw - 4, 26, C.panel, 1);
      const title = s.add.text(0, -ph / 2 + 14, 'ARENA CHALLENGE', {
        fontFamily: FONT, fontSize: '12px', color: '#9bbc0f', fontStyle: 'bold',
      }).setOrigin(0.5);
      const ratingLine = Number.isFinite(+rating) ? `  ·  ${Math.round(+rating)}` : '';
      const body = s.add.text(0, -12, `${this.pending.fromName || 'Someone'}${ratingLine}\nchallenges you to a duel!`, {
        fontFamily: FONT, fontSize: '11px', color: C.text, align: 'center', lineSpacing: 4,
      }).setOrigin(0.5);
      const hint = s.add.text(0, 16, 'Expires in 45s', {
        fontFamily: FONT, fontSize: '9px', color: C.dim, align: 'center',
      }).setOrigin(0.5);

      const btnW = 110, btnH = 30, gap = 16;
      const accept = this.makeBtn(-(btnW + gap) / 2, ph / 2 - 30, btnW, btnH, 'ACCEPT', C.green, () => this._accept());
      const decline = this.makeBtn((btnW + gap) / 2, ph / 2 - 30, btnW, btnH, 'DECLINE', C.purple, () => this._decline());

      c.add([bg, bar, title, body, hint, accept.bg, accept.text, decline.bg, decline.text]);
      c.setVisible(true);
      this.container = c;
      window.addEventListener('keydown', this._keyDown);

      // Auto-dismiss on server expiry (45s) or explicit expiresAt, whichever is sooner.
      let ms = CHALLENGE_TTL_MS;
      if (Number.isFinite(+expiresAt)) ms = Math.min(ms, Math.max(0, +expiresAt - Date.now()));
      try {
        this.timer = s.time.delayedCall(ms, () => { this._decline(); });
      } catch {
        this.timer = setTimeout(() => this._decline(), ms);
      }
      return true;
    } catch (e) {
      console.warn('[ArenaChallengeModal] show no-op:', e?.message);
      return false;
    }
  }

  makeBtn(x, y, w, h, labelText, color, cb) {
    const s = this.scene;
    const bg = s.add.rectangle(x, y, w, h, color, 1).setInteractive({ useHandCursor: true });
    const text = s.add.text(x, y, labelText, {
      fontFamily: FONT, fontSize: '11px', color: '#1a1008', fontStyle: 'bold',
    }).setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(this.lighten(color)));
    bg.on('pointerout', () => bg.setFillStyle(color));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev?.stopPropagation?.(); cb(); });
    return { bg, text };
  }

  lighten(hex) {
    const r = Math.min(255, ((hex >> 16) & 0xff) + 30);
    const g = Math.min(255, ((hex >> 8) & 0xff) + 30);
    const b = Math.min(255, (hex & 0xff) + 30);
    return (r << 16) | (g << 8) | b;
  }

  _accept() {
    const target = this.pending?.from;
    this.hide();
    if (target) arenaNet.accept(target);
  }

  _decline() {
    const target = this.pending?.from;
    this.hide();
    if (target) arenaNet.decline(target);
  }

  hide() {
    if (this.timer) {
      try {
        if (typeof this.timer.remove === 'function') this.timer.remove(false);
        else clearTimeout(this.timer);
      } catch { /* gone */ }
      this.timer = null;
    }
    if (!this.container) { this.pending = null; return; }
    window.removeEventListener('keydown', this._keyDown);
    try { this.container.destroy(); } catch { /* gone */ }
    this.container = null;
    this.pending = null;
  }

  destroy() { this.hide(); }
}
