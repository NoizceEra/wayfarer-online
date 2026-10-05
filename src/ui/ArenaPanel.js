import { arenaNet } from '../net/arenaNet.js';

// Solana palette: bg #1a1008, green #9bbc0f, purple #c8a840, cyan #a0c4f0.
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

// Phaser queue panel + rating display for the PvP arena.
// Graceful no-op when offline: shows OFFLINE status, buttons do nothing
// (arenaNet.send already warns + returns false). Never throws if the scene
// is gone or lacks add — every build step is guarded.
export class ArenaPanel {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.ratingText = null;
    this.recordText = null;
    this.statusText = null;
    this.queueBtn = null;
    this.queued = false;
    this.rating = { rating: 1000, wins: 0, losses: 0 };
    this.unsubs = [];
  }

  get online() { return arenaNet.isOnline(); }

  show() {
    if (this.container) return true;
    try {
      const s = this.scene;
      if (!s?.add?.container) return false;
      const { w: W, h: H } = s.view ? s.view() : { w: s.scale.width, h: s.scale.height };
      const pw = Math.min(W - 32, 300);
      const ph = 168;
      const c = s.add.container(W - pw / 2 - 12, H - ph / 2 - 12).setDepth(150).setScrollFactor(0);

      const bg = s.add.rectangle(0, 0, pw, ph, C.bg, 0.96).setStrokeStyle(2, C.purple);
      const bar = s.add.rectangle(0, -ph / 2 + 14, pw - 4, 26, C.panel, 1);
      const title = s.add.text(0, -ph / 2 + 14, 'ARENA', {
        fontFamily: FONT, fontSize: '13px', color: '#9bbc0f', fontStyle: 'bold',
      }).setOrigin(0.5);

      this.ratingText = s.add.text(0, -34, 'RATING 1000', {
        fontFamily: FONT, fontSize: '16px', color: C.text, fontStyle: 'bold',
      }).setOrigin(0.5);
      this.recordText = s.add.text(0, -12, 'W0 · L0', {
        fontFamily: FONT, fontSize: '11px', color: C.dim,
      }).setOrigin(0.5);
      this.statusText = s.add.text(0, 10, this.online ? 'Press queue to fight.' : 'OFFLINE — queue unavailable.', {
        fontFamily: FONT, fontSize: '10px', color: this.online ? '#a0c4f0' : C.dim, align: 'center',
      }).setOrigin(0.5);

      const q = this.makeBtn(0, 48, 200, 30, 'JOIN QUEUE', C.green, () => this.toggleQueue());
      this.queueBtn = q;

      c.add([bg, bar, title, this.ratingText, this.recordText, this.statusText, q.bg, q.text]);
      this.container = c;
      this.render();

      this.unsubs = [
        arenaNet.onRating((r) => { this.rating = norm(r); this.render(); }),
        arenaNet.onQueued((m) => {
          this.queued = Number(m?.position) > 0;
          this.setStatus(this.queued ? `In queue… #${m.position}` : 'Press queue to fight.');
          this.render();
        }),
        arenaNet.onMatch((m) => {
          this.queued = false;
          this.setStatus(`Match vs ${m.aName && m.bName ? foeOf(m) : 'opponent'}!`);
          this.render();
        }),
        arenaNet.onResult((m) => {
          if (m?.you) { this.rating = norm(m.you); }
          const d = m?.you?.delta;
          this.setStatus(`${m?.winnerName || 'Winner'} takes it${Number.isFinite(+d) ? ` (${d > 0 ? '+' : ''}${d})` : ''}`);
          this.render();
        }),
      ];
      if (this.online) arenaNet.refreshRating();
      return true;
    } catch (e) {
      console.warn('[ArenaPanel] show no-op:', e?.message);
      return false;
    }
  }

  makeBtn(x, y, w, h, label, color, cb) {
    const s = this.scene;
    const bg = s.add.rectangle(x, y, w, h, color, 1).setInteractive({ useHandCursor: true });
    const text = s.add.text(x, y, label, {
      fontFamily: FONT, fontSize: '11px', color: '#1a1008', fontStyle: 'bold',
    }).setOrigin(0.5);
    bg.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); cb(); });
    return { bg, text, label, color };
  }

  toggleQueue() {
    if (!this.online) { this.setStatus('OFFLINE — queue unavailable.'); return; }
    if (this.queued) arenaNet.leave();
    else arenaNet.queue();
  }

  setStatus(t) {
    try { this.statusText?.setText(String(t).slice(0, 48)); } catch { /* gone */ }
  }

  render() {
    try {
      this.ratingText?.setText(`RATING ${this.rating.rating}`);
      this.recordText?.setText(`W${this.rating.wins} · L${this.rating.losses}`);
      this.queueBtn?.text.setText(this.queued ? 'LEAVE QUEUE' : 'JOIN QUEUE');
      this.queueBtn?.bg.setFillStyle(this.queued ? C.purple : C.green);
      if (!this.online) this.setStatus('OFFLINE — queue unavailable.');
    } catch { /* gone */ }
  }

  hide() {
    for (const u of this.unsubs) { try { u(); } catch { /* done */ } }
    this.unsubs = [];
    if (!this.container) return;
    try { this.container.destroy(); } catch { /* gone */ }
    this.container = null;
    this.ratingText = this.recordText = this.statusText = this.queueBtn = null;
    this.queued = false;
  }

  destroy() { this.hide(); }
}

function norm(r) {
  return {
    rating: Number.isFinite(+r?.rating) ? Math.round(+r.rating) : 1000,
    wins: Math.max(0, +r?.wins | 0),
    losses: Math.max(0, +r?.losses | 0),
  };
}

function foeOf(m) {
  // Panel viewer is one of a/b; name the other side generically — the match
  // payload carries both names so any scene can refine this.
  return `${m.aName} vs ${m.bName}`;
}
