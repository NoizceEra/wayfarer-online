import { marks, COSMETICS, COSMETIC_BY_ID } from '../net/marksNet.js';
import { SOURCES, MARKS_CFG } from '../data/marksRules.js';
import { el, escapeHtml } from './econDom.js';
import { socialRoot } from './socialDom.js';
import { WalletPanel } from './WalletPanel.js';
import { input } from '../core/input.js';

function injectCss() {
  if (document.getElementById('wf-marks-css')) return;
  const s = el('style'); s.id = 'wf-marks-css';
  s.textContent = `
#wf-social .wf-marks{left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,calc(100vw - 16px));max-height:86vh;display:flex;flex-direction:column}
#wf-social .wf-marks .ec-body{padding:8px 10px;overflow-y:auto;flex:1;min-height:0}
#wf-social .mk-bal{font-size:16px;color:#ffd84a;margin:2px 0 8px}
#wf-social .mk-bar{height:8px;background:#1a1024;border:1px solid #3a2410;margin:4px 0 8px;position:relative}
#wf-social .mk-bar>i{display:block;height:100%;background:#9bbc0f}
#wf-social .mk-cap{display:flex;justify-content:space-between;font-size:8px;color:#b8a888}
#wf-social .mk-src{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid #2a1a0c;font-size:9px}
#wf-social .mk-src .n{color:#f4f0dc}
#wf-social .mk-hist{font-size:9px;color:#c8b890;padding:2px 0}
#wf-social .mk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:6px;margin:6px 0}
#wf-social .mk-card{background:#120c06;border:1px solid #8a5a2b;padding:6px;cursor:pointer;min-height:72px}
#wf-social .mk-card:hover{border-color:#ffd84a}
#wf-social .mk-card.on{border-color:#9bbc0f;box-shadow:inset 0 0 0 1px #9bbc0f}
#wf-social .mk-card .nm{color:#ffe8a0;font-size:9px}
#wf-social .mk-card .cs{color:#9bbc0f;font-size:8px;margin-top:4px}
#wf-social .mk-card .lk{color:#8a7a60;font-size:8px;margin-top:4px}
#wf-social .mk-prev{margin:8px 0;padding:8px;background:#0a1e0a;border:1px solid #306230;text-align:center}
#wf-social .mk-plate{display:inline-block;padding:4px 10px;font-size:11px;border:2px solid #306230;background:#00000088;color:#fff}
#wf-social .mk-dim{color:#8a7a60;font-size:9px}
#wf-social .mk-pill{position:fixed;left:6px;bottom:22px;pointer-events:auto;z-index:50;background:#0a1e0acc;border:1px solid #306230;color:#ffd84a;font:9px Silkscreen,monospace;padding:2px 6px;cursor:pointer;opacity:.9}
#wf-social .mk-pill:hover{border-color:#ffd84a}
#wf-social .mk-board .r{display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #2a1a0c;font-size:9px}
#wf-social .mk-board .r.me{color:#ffd84a}
#wf-social .mk-opt{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0}
#wf-social .wf-marks .ec-grow{flex:1}
`;
  document.head.appendChild(s);
}

export class MarksPanel {
  constructor(walletPanel) {
    injectCss();
    const root = socialRoot();
    const p = el('div', 'wf-panel wf-marks'); p.style.display = 'none';
    const t = el('div', 'wf-title', '<span>WAYFARER MARKS</span>');
    const x = el('button', 'wf-ghost wf-x', '✕'); x.addEventListener('click', () => this.close());
    t.appendChild(x);
    this.tabsBar = el('div', 'wf-tabs');
    this.body = el('div', 'ec-body');
    this.foot = el('div', 'wf-foot');
    p.append(t, this.tabsBar, this.body, this.foot);
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.appendChild(p);
    this.el = p; this.titleEl = t.querySelector('span');
    this.tab = 'earn';
    this.preview = null;
    this.walletPanel = walletPanel || new WalletPanel();
    this.nameIn = '';
    this.showBoard = false;
    this.showAddr = false;
    for (const [id, label] of [['earn', 'Earn'], ['shop', 'Shop'], ['board', 'Board'], ['wallet', 'Wallet']]) {
      const b = el('button', '', label);
      b.addEventListener('click', () => { this.tab = id; this.render(); });
      this.tabsBar.appendChild(b);
    }
    this.offs = [
      marks.on('state', () => { if (this.isOpen) this.render(); this.drawPill(); }),
      marks.on('award', () => { if (this.isOpen) this.render(); this.drawPill(); }),
      marks.on('board', () => { if (this.isOpen && this.tab === 'board') this.render(); }),
    ];
    this.pill = el('button', 'mk-pill', 'Marks 0');
    this.pill.title = `Wayfarer Marks (${input.labelFor('marks') || 'Z'}) — cosmetics only`;
    this.pill.addEventListener('click', () => this.toggle());
    root.appendChild(this.pill);
    this.drawPill();
  }

  get isOpen() { return this.el.style.display !== 'none'; }
  open(tab) {
    if (tab) this.tab = tab;
    this.el.style.display = 'flex';
    const st = marks.state;
    this.showBoard = !!st.board?.show;
    this.nameIn = st.board?.name || '';
    this.showAddr = !!st.board?.showAddr;
    this.render();
    if (this.tab === 'board') marks.send('marks-board', {});
  }
  close() { this.el.style.display = 'none'; this.walletPanel.close(); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  destroy() { this.offs.forEach((o) => { try { o(); } catch { /* ignore */ } }); this.el.remove(); this.pill.remove(); }

  drawPill() {
    const n = marks.state?.balance | 0;
    this.pill.textContent = `Marks ${n}`;
    this.pill.style.display = marks.state?.enabled === false ? 'none' : 'block';
  }

  render() {
    const st = marks.state || {};
    this.titleEl.textContent = `WAYFARER MARKS · ${st.balance | 0}`;
    for (const b of this.tabsBar.querySelectorAll('button')) b.classList.toggle('wf-on', b.textContent.toLowerCase() === this.tab);
    this.body.innerHTML = ''; this.foot.innerHTML = '';
    if (this.tab === 'wallet') { this.renderWallet(); return; }
    if (this.tab === 'shop') { this.renderShop(st); return; }
    if (this.tab === 'board') { this.renderBoard(st); return; }
    this.renderEarn(st);
  }

  renderEarn(st) {
    const b = this.body;
    b.appendChild(el('div', 'mk-bal', `${st.balance | 0} marks`));
    b.appendChild(el('div', 'mk-dim', 'Off-chain progress currency. Every wayfarer earns them (no wallet needed). They buy titles and nameplate frames — never gold, XP or power.'));
    const today = st.today || { total: 0, cap: MARKS_CFG.DAILY_CAP, src: {} };
    const pct = Math.min(100, Math.round((today.total / (today.cap || 1)) * 100));
    const bar = el('div', 'mk-bar'); bar.appendChild(el('i')); bar.firstChild.style.width = `${pct}%`;
    b.appendChild(el('div', 'mk-cap', `<span>Today</span><span>${today.total || 0} / ${today.cap || MARKS_CFG.DAILY_CAP}</span>`));
    b.appendChild(bar);
    if (!today.variety) b.appendChild(el('div', 'mk-dim', 'Variety bonus: earn from two different kinds of feat today to lift repeatable caps.'));
    if (today.activeMin != null) b.appendChild(el('div', 'mk-dim', `Active minutes today: ${today.activeMin || 0} / 5 for the daily login award${today.daily ? ' (claimed)' : ''}.`));
    b.appendChild(el('div', 'ec-h', 'SOURCES'));
    const src = today.src || {};
    for (const [k, s] of Object.entries(SOURCES)) {
      const row = src[k] || { n: 0, cap: s.cap, label: s.label };
      b.appendChild(el('div', 'mk-src', `<span class="n">${escapeHtml(row.label || s.label)}</span><span>${row.n || 0} / ${row.cap || s.cap}</span>`));
    }
    b.appendChild(el('div', 'ec-h', 'RECENT'));
    const hist = st.history || [];
    if (!hist.length) b.appendChild(el('div', 'mk-dim', 'Play to earn. First clears, achievements, questlines, events, level milestones.'));
    for (const h of hist.slice(0, 12)) {
      const when = h.t ? new Date(h.t).toLocaleTimeString() : '';
      b.appendChild(el('div', 'mk-hist', `+${h.n}  ${escapeHtml(h.label || h.src)}  <span class="mk-dim">${escapeHtml(when)}</span>`));
    }
    this.foot.appendChild(el('span', 'mk-dim', st.online ? 'Server is counting.' : 'Solo: accruing on this device, syncs when you Play Online.'));
  }

  renderShop(st) {
    const b = this.body;
    b.appendChild(el('div', 'mk-dim', 'Cosmetics only. Equipping a title or frame never changes stats.'));
    this.drawPreview(b, this.preview || equippedLook(st));
    for (const kind of ['title', 'frame', 'color']) {
      b.appendChild(el('div', 'ec-h', kind.toUpperCase()));
      const g = el('div', 'mk-grid');
      for (const c of COSMETICS.filter((x) => x.kind === kind)) {
        const owned = !!(st.owned?.includes(c.id) || st.badges?.includes(c.id));
        const on = st.equipped?.[kind] === c.id;
        const card = el('div', `mk-card${on ? ' on' : ''}`);
        card.innerHTML = `<div class="nm">${escapeHtml(c.name)}</div>${c.color ? swatch(c) : ''}<div class="${owned ? 'cs' : 'lk'}">${c.badge ? (owned ? 'badge' : 'linked wallet') : owned ? (on ? 'equipped' : 'owned') : `${c.cost} marks`}</div>`;
        card.addEventListener('mouseenter', () => { this.preview = c; this.drawPreview(b.querySelector('.mk-prev') || b, c); });
        card.addEventListener('click', () => {
          this.preview = c;
          if (owned) marks.send('marks-equip', { kind, id: on ? null : c.id });
          else if (!c.badge) marks.send('marks-buy', { id: c.id });
        });
        g.appendChild(card);
      }
      b.appendChild(g);
    }
    this.foot.appendChild(el('span', 'mk-dim', 'Click a locked card to unlock · click an owned card to equip'));
  }

  drawPreview(parent, c) {
    let box = parent.classList?.contains('mk-prev') ? parent : parent.querySelector?.('.mk-prev');
    if (!box) { box = el('div', 'mk-prev'); parent.insertBefore(box, parent.firstChild?.nextSibling || null); }
    const name = (typeof window !== 'undefined' && window.__wayfarer?.scene?.getScene?.('world')?.pname) || 'Wayfarer';
    const eq = marks.state.equipped || {};
    const title = (c?.kind === 'title' ? c : COSMETIC_BY_ID[eq.title])?.name;
    const frame = c?.kind === 'frame' ? c : COSMETIC_BY_ID[eq.frame];
    const color = c?.kind === 'color' ? c : COSMETIC_BY_ID[eq.color];
    const plate = el('span', 'mk-plate', `${escapeHtml(name)}${title ? ` · ${escapeHtml(title)}` : ''}`);
    plate.style.color = color?.color || '#fff';
    plate.style.borderColor = frame?.color || '#306230';
    plate.style.background = frame?.bg || '#00000088';
    box.innerHTML = ''; box.appendChild(plate);
    box.appendChild(el('div', 'mk-dim', c ? `Preview: ${escapeHtml(c.name)}` : 'Your nameplate'));
  }

  renderBoard(st) {
    const b = this.body;
    if (!st.flags?.leaderboard) { b.appendChild(el('div', 'mk-dim', 'The seasonal board is turned off on this relay.')); return; }
    b.appendChild(el('div', 'mk-dim', `Season ${escapeHtml(st.season?.id || 's1')} — display names only. Your wallet address stays private unless you tick the box.`));
    const opt = el('div', 'mk-opt');
    const name = el('input'); name.placeholder = 'display name'; name.maxLength = 16; name.value = this.nameIn;
    name.addEventListener('input', () => { this.nameIn = name.value; });
    const show = el('button', this.showBoard ? '' : 'wf-ghost', this.showBoard ? 'On the board' : 'Join the board');
    show.addEventListener('click', () => {
      this.showBoard = !this.showBoard;
      marks.send('marks-optin', { show: this.showBoard, name: this.nameIn, showAddr: this.showAddr });
      this.render();
    });
    const addr = el('button', this.showAddr ? '' : 'wf-ghost', this.showAddr ? 'Address visible' : 'Keep address private');
    addr.addEventListener('click', () => {
      this.showAddr = !this.showAddr;
      if (this.showBoard) marks.send('marks-optin', { show: true, name: this.nameIn, showAddr: this.showAddr });
      this.render();
    });
    opt.append(name, show, addr);
    b.appendChild(opt);
    const board = marks.board;
    if (!board) { b.appendChild(el('div', 'mk-dim', 'Loading…')); marks.send('marks-board', {}); return; }
    if (board.offline || board.disabled) { b.appendChild(el('div', 'mk-dim', 'Play Online to see the seasonal board. Solo Marks still accrue on this device.')); return; }
    const wrap = el('div', 'mk-board');
    if (!board.rows?.length) wrap.appendChild(el('div', 'mk-dim', 'No opted-in wayfarers yet this season.'));
    for (const r of board.rows || []) {
      const me = board.me && r.rank === board.me.rank && r.name === board.me.name;
      wrap.appendChild(el('div', `r${me ? ' me' : ''}`, `<span>#${r.rank}</span><span>${escapeHtml(r.name)}${r.founder ? ' ★' : ''}</span><span>${r.marks}</span>${r.addr ? `<span class="mk-dim">${escapeHtml(r.addr)}</span>` : ''}`));
    }
    if (board.me && !(board.rows || []).some((r) => r.rank === board.me.rank && r.name === board.me.name)) {
      wrap.appendChild(el('div', 'r me', `<span>#${board.me.rank}</span><span>${escapeHtml(board.me.name)} (you)</span><span>${board.me.marks}</span>`));
    }
    b.appendChild(wrap);
    const ref = el('button', '', 'Refresh'); ref.addEventListener('click', () => marks.send('marks-board', {}));
    this.foot.append(el('span', 'mk-dim', `${board.total || 0} on the board`), el('span', 'ec-grow'), ref);
  }

  renderWallet() {
    // Reuse the wallet overlay body in-place so title + HUD share one panel class.
    this.walletPanel.open();
    this.close();
  }
}

function swatch(c) {
  return `<div style="margin-top:6px;height:10px;background:${c.bg || '#1a1024'};border:2px solid ${c.color || '#9bbc0f'}"></div>`;
}
function equippedLook(st) {
  const e = st.equipped || {};
  return COSMETIC_BY_ID[e.frame] || COSMETIC_BY_ID[e.title] || COSMETIC_BY_ID[e.color] || null;
}
