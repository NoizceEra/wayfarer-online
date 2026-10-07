import { fetchAgentBoard } from '../net/agentBoardNet.js';
import { el, escapeHtml, socialRoot } from './socialDom.js';

// PUBLIC 'World Agents' board — a live view of the autonomous agents currently
// in the world (docs/AGENT_BOARD.md). DOM overlay in the shared social idiom
// (src/ui/LeaderboardPanel.js is the closest sibling): #wf-social root, plain
// elements, a periodic refresh, and a bright empty state.
//
// HONESTY:
//   • It renders ONLY what GET /agents returns. No price, no SOL, no wallet,
//     no owner identity — nothing is inferred or invented client-side.
//   • Zero agents is a normal state and reads as such ("No agents in the world
//     right now."), never as an error or a spinner stuck forever.
//   • A failed fetch says the board is unreachable; it never fabricates rows.
const REFRESH_MS = 5000;

const fmtDuration = (ms) => {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
};
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

export class AgentBoardPanel {
  constructor() {
    injectCss();
    this.visible = false;
    this.loading = false;
    this.error = null;
    this.data = null;
    this.timer = null;
    this._inflight = false;

    const root = socialRoot();
    this.el = el('div', 'ab-panel');
    this.el.style.display = 'none';
    // Swallow world pointers while open, like the other DOM panels.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

    const t = el('div', 'ab-title');
    const title = el('span', '', 'WORLD AGENTS');
    const sub = el('span', 'ab-sub', 'live');
    const x = el('button', 'ab-x', '✕');
    x.setAttribute('aria-label', 'Close world agents board');
    x.addEventListener('click', () => this.close());
    t.append(title, sub, x);

    this.summary = el('div', 'ab-summary');
    this.body = el('div', 'ab-body');
    this.foot = el('div', 'ab-foot');

    this.el.append(t, this.summary, this.body, this.foot);
    root.appendChild(this.el);
    this.render();
  }

  open() {
    if (this.visible) return;
    this.visible = true;
    this.el.style.display = 'flex';
    this.refresh();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  close() {
    this.visible = false;
    this.el.style.display = 'none';
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  toggle() { if (this.visible) this.close(); else this.open(); }

  destroy() {
    this.close();
    try { this.el?.remove(); } catch { /* gone */ }
    this.el = null;
  }

  async refresh() {
    if (!this.visible || this._inflight) return;
    this._inflight = true;
    this.loading = true;
    this.error = null;
    this.render();
    try {
      this.data = await fetchAgentBoard();
    } catch (e) {
      this.error = e?.message || 'Could not reach the relay.';
    }
    this.loading = false;
    this._inflight = false;
    if (this.visible) this.render();
  }

  render() {
    if (!this.el) return;
    this.body.innerHTML = '';
    this.foot.innerHTML = '';
    this.summary.innerHTML = '';

    if (this.loading && !this.data) {
      this.body.appendChild(el('div', 'ab-empty', 'Loading the world roster…'));
      return;
    }
    if (this.error) {
      this.body.appendChild(el('div', 'ab-empty', `<b>Board unavailable.</b><br>${escapeHtml(this.error)}`));
    } else if (!this.data?.agents?.length) {
      // The friendly, honest empty state — zero agents is normal, not an error.
      this.body.appendChild(el('div', 'ab-empty', 'No agents in the world right now.'));
    } else {
      const head = el('div', 'ab-row ab-head');
      head.innerHTML = '<span class="ab-name">NAME</span><span class="ab-job">JOB</span>'
        + '<span class="ab-zone">ZONE</span><span class="ab-act">ACTION</span>'
        + '<span class="ab-num">GATH</span><span class="ab-num">KILLS</span><span class="ab-up">UPTIME</span>';
      this.body.appendChild(head);
      for (const a of this.data.agents) {
        const row = el('div', 'ab-row');
        const owned = a.ownerBacked ? ' <i class="ab-owned" title="owner-backed">◆</i>' : '';
        row.innerHTML =
          `<span class="ab-name">${escapeHtml(a.name || 'Wayfarer')}${owned}</span>`
          + `<span class="ab-job">${escapeHtml(String(a.job || 'wayfarer'))}${a.level != null ? ` Lv${num(a.level)}` : ''}</span>`
          + `<span class="ab-zone">${escapeHtml(a.zone || a.area || '—')}</span>`
          + `<span class="ab-act">${escapeHtml(a.action || 'idle')}</span>`
          + `<span class="ab-num">${num(a.gathered).toLocaleString()}</span>`
          + `<span class="ab-num">${num(a.kills).toLocaleString()}</span>`
          + `<span class="ab-up">${fmtDuration(a.uptimeMs)}</span>`;
        this.body.appendChild(row);
      }
    }

    if (this.data?.agents?.length) {
      const s = this.data.summary || {};
      this.summary.textContent = `${num(s.total).toLocaleString()} in the world · ${num(s.gathered).toLocaleString()} gathered · ${num(s.kills).toLocaleString()} kills`;
    } else {
      this.summary.textContent = '';
    }

    const updated = this.data?.updatedAt ? new Date(this.data.updatedAt).toLocaleTimeString() : '—';
    this.foot.appendChild(el('span', 'ab-dim', `Updated ${updated}${this.data?.world ? ` · ${escapeHtml(this.data.world)}` : ''}`));
    const refresh = el('button', 'ab-btn', 'REFRESH');
    refresh.addEventListener('click', () => this.refresh());
    this.foot.appendChild(refresh);
  }
}

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const s = el('style');
  s.textContent = `
#wf-social .ab-panel{pointer-events:auto;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;width:min(560px,calc(100vw - 16px));max-height:86vh;background:rgba(26,16,8,.95);border:2px solid #8a5a2b;box-shadow:inset 0 0 0 1px #3a2410,0 0 0 1px #1a1024;font-family:'Silkscreen',monospace;font-size:10px;color:#f4f0dc}
#wf-social .ab-title{color:#ffe8a0;font-size:11px;font-weight:bold;padding:6px 8px;border-bottom:1px solid #3a2410;display:flex;align-items:center;gap:6px}
#wf-social .ab-title .ab-sub{color:#9bbc0f;font-size:8px;font-weight:normal;text-transform:uppercase;letter-spacing:1px}
#wf-social .ab-title .ab-x{margin-left:auto;background:transparent;border:0;box-shadow:none;color:#c8b890;cursor:pointer;font-family:inherit;font-size:10px;padding:2px 4px}
#wf-social .ab-title .ab-x:hover{color:#fff}
#wf-social .ab-summary{padding:4px 8px;color:#9bbc0f;font-size:9px;border-bottom:1px solid #3a2410}
#wf-social .ab-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 6px}
#wf-social .ab-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid #2a1a0c}
#wf-social .ab-row.ab-head{color:#ffd84a;font-size:8px;border-bottom:1px solid #3a2410}
#wf-social .ab-row:hover{background:rgba(255,255,255,.05)}
#wf-social .ab-name{flex:1.4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-social .ab-owned{color:#14f195;font-style:normal;cursor:help}
#wf-social .ab-job{width:74px;color:#b8a888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-social .ab-zone{width:84px;color:#e6c98a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-social .ab-act{width:60px;color:#7fdcff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-social .ab-num{width:44px;text-align:right;color:#f4c542}
#wf-social .ab-up{width:58px;text-align:right;color:#8a7a60}
#wf-social .ab-foot{display:flex;gap:4px;padding:6px 8px;border-top:1px solid #3a2410;align-items:center;justify-content:space-between;flex-wrap:wrap}
#wf-social .ab-dim{color:#8a7a60;font-size:8px}
#wf-social .ab-btn{font-family:inherit;font-size:9px;color:#3a1f00;background:#9bbc0f;border:1px solid #1a1024;padding:2px 8px;cursor:pointer}
#wf-social .ab-btn:hover{background:#b8d820}
#wf-social .ab-empty{padding:22px 12px;color:#8a7a60;text-align:center;line-height:1.6}
@media (max-width:560px){#wf-social .ab-panel{max-height:78vh}#wf-social .ab-job,#wf-social .ab-zone{display:none}}
`;
  document.head.appendChild(s);
}
