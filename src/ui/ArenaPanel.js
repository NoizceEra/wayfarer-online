import { arenaNet } from '../net/arenaNet.js';

// Solana palette: bg #0A0E1A, green #14F195, purple #9945FF, cyan #03E1FF.
const C = {
  bg: 0x0a0e1a,
  panel: 0x10182e,
  green: 0x14f195,
  purple: 0x9945ff,
  cyan: 0x03e1ff,
  text: '#e8f4ff',
  dim: '#7d8db0',
};
const FONT = '"Silkscreen", monospace';

// Ranked human arena HUD. Combat state and outcomes come from server events;
// this panel never submits a winner or determines combat itself.
export class ArenaPanel {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.ratingText = null;
    this.recordText = null;
    this.statusText = null;
    this.opponentText = null;
    this.youHpText = null;
    this.opponentHpText = null;
    this.youHpFill = null;
    this.opponentHpFill = null;
    this.queueBtn = null;
    this.agentQueueBtn = null;
    this.queued = false;
    this.agentQueued = false;
    this.agentQueuePending = false;
    this.rating = { rating: 1000, wins: 0, losses: 0 };
    this.match = null;
    this.lastRatingResult = null;
    this.unsubs = [];
  }

  get online() { return arenaNet.isOnline(); }

  show() {
    if (this.container) return true;
    try {
      const s = this.scene;
      if (!s?.add?.container) return false;
      const { w: W, h: H } = s.view ? s.view() : { w: s.scale.width, h: s.scale.height };
      const pw = Math.max(250, Math.min(W - 24, 330));
      const ph = 284;
      const c = s.add.container(W - pw / 2 - 12, H - ph / 2 - 12).setDepth(150).setScrollFactor(0);

      const bg = s.add.rectangle(0, 0, pw, ph, C.bg, 0.97).setStrokeStyle(2, C.purple);
      const bar = s.add.rectangle(0, -ph / 2 + 14, pw - 4, 26, C.panel, 1);
      const title = s.add.text(0, -ph / 2 + 14, 'ARENA', {
        fontFamily: FONT, fontSize: '13px', color: '#14f195', fontStyle: 'bold',
      }).setOrigin(0.5);

      this.ratingText = s.add.text(0, -89, 'RATING 1000', {
        fontFamily: FONT, fontSize: '15px', color: C.text, fontStyle: 'bold',
      }).setOrigin(0.5);
      this.recordText = s.add.text(0, -68, 'W0 · L0', {
        fontFamily: FONT, fontSize: '10px', color: C.dim,
      }).setOrigin(0.5);
      this.opponentText = s.add.text(0, -45, 'NO ACTIVE MATCH', {
        fontFamily: FONT, fontSize: '9px', color: C.cyan, align: 'center',
      }).setOrigin(0.5);

      const barW = Math.max(170, pw - 78);
      const makeHealth = (y, label, color) => {
        const text = s.add.text(-barW / 2 - 8, y - 1, label, {
          fontFamily: FONT, fontSize: '7px', color: C.dim,
        }).setOrigin(1, 0.5);
        const back = s.add.rectangle(0, y, barW, 8, C.panel, 1).setStrokeStyle(1, 0x34415d);
        const fill = s.add.rectangle(-barW / 2 + 1, y, barW - 2, 5, color, 1).setOrigin(0, 0.5);
        return { text, back, fill, width: barW - 2 };
      };
      const you = makeHealth(-25, 'YOU', C.green);
      const opponent = makeHealth(-9, 'FOE', C.purple);
      this.youHpText = you.text;
      this.youHpFill = you.fill;
      this.opponentHpText = opponent.text;
      this.opponentHpFill = opponent.fill;

      this.statusText = s.add.text(0, 17, this.online ? 'Press queue to fight.' : 'OFFLINE — queue unavailable.', {
        fontFamily: FONT, fontSize: '8px', color: this.online ? '#03e1ff' : C.dim,
        align: 'center', wordWrap: { width: pw - 26 }, lineSpacing: 3,
      }).setOrigin(0.5);

      const q = this.makeBtn(0, 58, 200, 30, 'JOIN QUEUE', C.green, () => this.toggleQueue());
      this.queueBtn = q;
      const aq = this.makeBtn(0, 94, 200, 30, 'QUEUE MY AGENT', C.purple, () => this.toggleAgentQueue());
      this.agentQueueBtn = aq;
      const rewardsNote = s.add.text(0, 127, 'TOKEN PRIZES ARE NOT LIVE', {
        fontFamily: FONT, fontSize: '8px', color: C.dim, align: 'center',
      }).setOrigin(0.5);

      c.add([bg, bar, title, this.ratingText, this.recordText, this.opponentText,
        you.back, you.fill, you.text, opponent.back, opponent.fill, opponent.text,
        this.statusText, q.bg, q.text, aq.bg, aq.text, rewardsNote]);
      this.container = c;
      this.render();

      this.unsubs = [
        arenaNet.onRating((r) => { this.rating = norm(r); this.render(); }),
        arenaNet.onQueued((m) => {
          this.queued = Number(m?.position) > 0;
          this.setStatus(this.queued ? `In queue… #${m.position}` : 'Press queue to fight.');
          this.render();
        }),
        arenaNet.onAgentQueued((m) => {
          this.agentQueuePending = false;
          this.agentQueued = Number(m?.position) > 0;
          this.setStatus(this.agentQueued ? `Your agent is in queue… #${m.position}` : 'Your agent left the queue.');
          this.render();
        }),
        arenaNet.onMatch((m) => {
          this.queued = false;
          this.agentQueued = false;
          this.agentQueuePending = false;
          this.match = { ...m, active: true, youHp: null, opponentHp: null, maxHp: null };
          this.lastRatingResult = null;
          this.setStatus('Match found. Fight in the world!');
          this.render();
        }),
        arenaNet.onCombatState((m) => this.updateCombatState(m)),
        arenaNet.onResult((m) => this.updateRatingResult(m)),
        arenaNet.onCombatResult((m) => this.showCombatResult(m)),
        arenaNet.onError((m) => this.setError(m?.msg || 'Arena is unavailable.')),
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
      fontFamily: FONT, fontSize: '11px', color: '#0a0e1a', fontStyle: 'bold',
    }).setOrigin(0.5);
    bg.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); cb(); });
    return { bg, text, label, color };
  }

  toggleQueue() {
    if (!this.online) { this.setStatus('OFFLINE — queue unavailable.'); return; }
    if (!this.queued && this.agentQueued) { this.setStatus('Leave your agent queue before queueing yourself.'); return; }
    if (this.queued) arenaNet.leave();
    else arenaNet.queue();
  }

  toggleAgentQueue() {
    if (!this.online) { this.setStatus('OFFLINE — agent queue unavailable.'); return; }
    if (!this.agentQueued && this.queued) { this.setStatus('Leave human matchmaking before queueing your agent.'); return; }
    if (this.agentQueued) arenaNet.leaveAgent();
    else {
      this.agentQueuePending = true;
      this.setStatus('Checking for an available owned agent…');
      if (!arenaNet.queueAgent()) {
        this.agentQueuePending = false;
        this.setError('The room connection is unavailable.');
      }
    }
  }

  setError(message) {
    const msg = String(message || 'Arena is unavailable.').slice(0, 110);
    const agentError = this.agentQueuePending || /agent/i.test(msg);
    this.agentQueuePending = false;
    this.setStatus(agentError ? `Agent queue unavailable: ${msg}` : `Arena: ${msg}`);
    try { this.statusText?.setColor('#ffb86b'); } catch { /* gone */ }
  }

  updateCombatState(m) {
    if (!m || !this.match || (m.matchId && m.matchId !== this.match.matchId)) return;
    const maxHp = clampInt(m.maxHp, 1, 999999, this.match.maxHp || 600);
    this.match.maxHp = maxHp;
    this.match.youHp = clampInt(m.youHp, 0, maxHp, maxHp);
    this.match.opponentHp = clampInt(m.opponentHp, 0, maxHp, maxHp);
    this.render();
  }

  updateRatingResult(m) {
    if (m?.you) this.rating = norm(m.you);
    const delta = Number.isFinite(+m?.you?.delta) ? Math.round(+m.you.delta) : null;
    this.lastRatingResult = { matchId: String(m?.matchId || ''), delta };
    this.render();
  }

  showCombatResult(m) {
    if (!m) return;
    const match = this.match;
    const matchId = String(m.matchId || '');
    if (match && matchId && match.matchId !== matchId) return;

    const sid = arenaNet.sessionId();
    const foeId = sid && m.a === sid ? m.b : sid && m.b === sid ? m.a : null;
    const isWinner = !!sid && m.winner === sid;
    const disputed = m.disputed === true || m.status === 'disputed' || m.status === 'unverified' || !m.winner;
    const foeName = opponentName(match, sid, foeId) || m.opponentName || 'opponent';
    const ratingMatch = this.lastRatingResult?.matchId === matchId ? this.lastRatingResult : null;
    const delta = Number.isFinite(+m.delta) ? Math.round(+m.delta) : ratingMatch?.delta;

    this.queued = false;
    if (match) match.active = false;
    if (disputed) {
      this.opponentText?.setText(`RESULT VS ${foeName}`);
      this.setStatus('Result disputed or unverified. No rating change applied.');
    } else {
      const outcome = isWinner ? 'VICTORY' : 'DEFEAT';
      const deltaText = delta === null || delta === undefined ? '' : ` · ${delta > 0 ? '+' : ''}${delta} rating`;
      this.opponentText?.setText(`${outcome} VS ${foeName}`);
      this.setStatus(`${outcome}${deltaText}${m.reason ? ` · ${reasonLabel(m.reason)}` : ''}`);
    }
    this.render();
  }

  setStatus(t) {
    try {
      this.statusText?.setText(String(t).slice(0, 120));
      this.statusText?.setColor(this.online ? '#03e1ff' : C.dim);
    } catch { /* gone */ }
  }

  render() {
    try {
      this.ratingText?.setText(`RATING ${this.rating.rating}`);
      this.recordText?.setText(`W${this.rating.wins} · L${this.rating.losses}`);
      this.queueBtn?.text.setText(this.queued ? 'LEAVE QUEUE' : 'JOIN QUEUE');
      this.queueBtn?.bg.setFillStyle(this.queued ? C.purple : C.green);
      this.agentQueueBtn?.text.setText(this.agentQueued ? 'LEAVE AGENT QUEUE' : 'QUEUE MY AGENT');
      this.agentQueueBtn?.bg.setFillStyle(this.agentQueued ? C.green : C.purple);
      const m = this.match;
      if (m?.active) {
        const max = m.maxHp || 600;
        const you = m.youHp ?? max;
        const foe = m.opponentHp ?? max;
        this.opponentText?.setText(`DUEL VS ${opponentName(m, arenaNet.sessionId())}`);
        this.youHpText?.setText(`YOU ${you}/${max}`);
        this.opponentHpText?.setText(`FOE ${foe}/${max}`);
        const totalWidth = this.youHpFill?.width || this.opponentHpFill?.width || 1;
        this.youHpFill?.setDisplaySize(totalWidth * you / max, 5);
        this.opponentHpFill?.setDisplaySize(totalWidth * foe / max, 5);
      } else if (m && !m.active && this.opponentText?.text === 'NO ACTIVE MATCH') {
        this.opponentText.setText('NO ACTIVE MATCH');
      }
      if (!this.online && !m?.active) this.setStatus('OFFLINE — queue unavailable.');
    } catch { /* gone */ }
  }

  hide() {
    for (const u of this.unsubs) { try { u(); } catch { /* done */ } }
    this.unsubs = [];
    if (!this.container) return;
    try { this.container.destroy(); } catch { /* gone */ }
    this.container = null;
    this.ratingText = this.recordText = this.statusText = this.opponentText = null;
    this.youHpText = this.opponentHpText = this.youHpFill = this.opponentHpFill = null;
    this.queueBtn = null;
    this.agentQueueBtn = null;
    this.queued = false;
    this.agentQueued = false;
    this.agentQueuePending = false;
    this.match = null;
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

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function opponentName(match, sessionId, opponentId) {
  if (!match) return null;
  if (opponentId && opponentId === match.a) return match.aName || 'opponent';
  if (opponentId && opponentId === match.b) return match.bName || 'opponent';
  if (sessionId && sessionId === match.a) return match.bName || 'opponent';
  if (sessionId && sessionId === match.b) return match.aName || 'opponent';
  return match.aName && match.bName ? `${match.aName} vs ${match.bName}` : null;
}

function reasonLabel(reason) {
  return ({ ko: 'K.O.', forfeit: 'forfeit' })[String(reason).toLowerCase()] || String(reason).slice(0, 20);
}
