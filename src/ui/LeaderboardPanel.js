import { fetchLeaderboard, clearLeaderboardCache } from '../net/leaderboardNet.js';
import { el, escapeHtml, socialRoot } from './socialDom.js';

const TYPES = [
  ['level', 'LEVEL'],
  ['gold', 'GOLD'],
  ['season', 'SEASON'],
  ['pets', 'PETS'],
  ['arena', 'ARENA'],
];

const TYPE_LABEL = { level: 'Level', gold: 'Gold', season: 'Season XP', pets: 'Pets', arena: 'Arena Rating' };

export class LeaderboardPanel {
  constructor() {
    injectCss();
    this.type = 'level';
    this.limit = 20;
    this.data = null;
    this.error = null;
    this.loading = false;
    this.visible = false;

    const root = socialRoot();
    this.el = el('div', 'lb-panel');
    this.el.style.display = 'none';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

    const t = el('div', 'lb-title', '<span>LEADERBOARD</span>');
    const x = el('button', 'lb-x', '✕');
    x.addEventListener('click', () => this.close());
    t.appendChild(x);

    this.tabs = el('div', 'lb-tabs');
    for (const [id, label] of TYPES) {
      const b = el('button', '', label);
      b.addEventListener('click', () => { this.type = id; clearLeaderboardCache(); this.refresh(); });
      this.tabs.appendChild(b);
    }

    this.body = el('div', 'lb-body');
    this.foot = el('div', 'lb-foot');

    this.el.append(t, this.tabs, this.body, this.foot);
    root.appendChild(this.el);
    this.render();
  }

  open() { this.visible = true; this.el.style.display = 'flex'; this.refresh(); }
  close() { this.visible = false; this.el.style.display = 'none'; }
  toggle() { if (this.visible) this.close(); else this.open(); }

  async refresh() {
    if (!this.visible) return;
    this.loading = true; this.error = null; this.data = null;
    this.render();
    try {
      this.data = await fetchLeaderboard(this.type, this.limit);
    } catch (e) {
      this.error = e?.message || 'Could not reach the relay.';
    }
    this.loading = false;
    this.render();
  }

  render() {
    this.body.innerHTML = '';
    this.foot.innerHTML = '';

    // tab active state
    const btns = this.tabs.querySelectorAll('button');
    for (let i = 0; i < TYPES.length; i++) {
      btns[i]?.classList.toggle('lb-on', TYPES[i][0] === this.type);
    }

    if (this.loading) {
      this.body.appendChild(el('div', 'lb-empty', 'Loading rankings…'));
      return;
    }
    if (this.error) {
      this.body.appendChild(el('div', 'lb-empty', `<b>${escapeHtml(this.error)}</b><br>Check your connection, then Refresh.`));
    } else if (!this.data?.entries?.length) {
      this.body.appendChild(el('div', 'lb-empty', 'No rankings yet — be the first!'));
    } else {
      const header = el('div', 'lb-row lb-head');
      header.innerHTML = '<span class="lb-rank">#</span><span class="lb-name">NAME</span><span class="lb-level">LV</span><span class="lb-value">' + escapeHtml(TYPE_LABEL[this.type].toUpperCase()) + '</span>';
      this.body.appendChild(header);
      for (const e of this.data.entries) {
        const row = el('div', 'lb-row');
        const extra = e.extras && (e.extras.wins !== undefined || e.extras.losses !== undefined)
          ? ` <i>${e.extras.wins || 0}W / ${e.extras.losses || 0}L</i>` : '';
        row.innerHTML =
          `<span class="lb-rank">${e.rank}</span>` +
          `<span class="lb-name">${escapeHtml(e.name)}</span>` +
          `<span class="lb-level">${e.level}</span>` +
          `<span class="lb-value">${Number(e.value).toLocaleString()}${extra}</span>`;
        this.body.appendChild(row);
      }
    }

    const updated = this.data?.updatedAt ? new Date(this.data.updatedAt).toLocaleTimeString() : '--:--';
    this.foot.appendChild(el('span', 'lb-dim', `Updated ${updated}`));
    const refresh = el('button', 'lb-btn', 'REFRESH');
    refresh.addEventListener('click', () => { clearLeaderboardCache(); this.refresh(); });
    this.foot.appendChild(refresh);
  }
}

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const s = el('style');
  s.textContent = `
#wf-social .lb-panel{pointer-events:auto;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;width:min(420px,calc(100vw - 16px));max-height:86vh;background:rgba(26,16,8,.95);border:2px solid #8a5a2b;box-shadow:inset 0 0 0 1px #3a2410,0 0 0 1px #1a1024;font-family:'Silkscreen',monospace;font-size:10px;color:#f4f0dc}
#wf-social .lb-title{color:#ffe8a0;font-size:11px;font-weight:bold;padding:6px 8px;border-bottom:1px solid #3a2410;display:flex;align-items:center;gap:6px}
#wf-social .lb-title .lb-x{margin-left:auto;background:transparent;border:0;color:#c8b890;cursor:pointer;font-family:inherit;font-size:10px}
#wf-social .lb-title .lb-x:hover{color:#fff}
#wf-social .lb-tabs{display:flex;gap:1px;padding:4px 4px 0;border-bottom:1px solid #3a2410;flex-wrap:wrap}
#wf-social .lb-tabs button{background:transparent;box-shadow:none;border:1px solid transparent;color:#9a8a70;padding:4px 6px;font-size:9px;cursor:pointer}
#wf-social .lb-tabs button.lb-on{color:#fff;border-color:#8a5a2b;border-bottom-color:transparent;background:rgba(255,255,255,.06)}
#wf-social .lb-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 6px}
#wf-social .lb-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid #2a1a0c}
#wf-social .lb-row.lb-head{color:#ffd84a;font-size:9px;border-bottom:1px solid #3a2410}
#wf-social .lb-row:hover{background:rgba(255,255,255,.05)}
#wf-social .lb-rank{width:24px;text-align:center;color:#ffd84a}
#wf-social .lb-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-social .lb-level{width:28px;text-align:center;color:#b8a888}
#wf-social .lb-value{width:90px;text-align:right;color:#f4c542}
#wf-social .lb-value i{color:#8a7a60;font-style:normal;margin-left:4px}
#wf-social .lb-foot{display:flex;gap:4px;padding:6px 8px;border-top:1px solid #3a2410;align-items:center;justify-content:space-between;flex-wrap:wrap}
#wf-social .lb-dim{color:#8a7a60;font-size:8px}
#wf-social .lb-btn{font-family:inherit;font-size:9px;color:#3a1f00;background:#9bbc0f;border:1px solid #1a1024;padding:2px 8px;cursor:pointer}
#wf-social .lb-btn:hover{background:#b8d820}
#wf-social .lb-empty{padding:18px 10px;color:#8a7a60;text-align:center;line-height:1.6}
@media (max-width:560px){#wf-social .lb-panel{max-height:78vh}}
`;
  document.head.appendChild(s);
}
