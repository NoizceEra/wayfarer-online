import { net } from '../net/NetworkManager.js';
import { listOpenRooms } from '../net/partyFinderNet.js';
import { el, escapeHtml, socialRoot } from './socialDom.js';
import { loadProfile, saveProfile, loadHero } from '../core/save.js';
import { bus, Events } from '../core/events.js';

// CO-OP FINDER (DOM overlay, MailPanel pattern): browses OPEN private co-op
// rooms (server GET /party-finder) and quick-joins by 5-char code through the
// existing net.join() flow. Open rooms are party rooms created with
// { open: true } (net.host(name, hero, { open: true })); rooms without it stay
// code-share-only and never appear here. Solana palette on the shared
// #wf-social overlay root (Silkscreen font comes with it).
export class PartyFinderPanel {
  constructor() {
    injectCss();
    this.scene = null;
    this.rooms = null;      // null = not fetched yet
    this.error = null;
    this.joining = false;  // one join in flight
    const p = el('div', 'pf-panel');
    p.style.display = 'none';
    const t = el('div', 'pf-title', '<span>CO-OP FINDER</span>');
    const x = el('button', 'pf-x', '✕');
    x.addEventListener('click', () => this.close());
    t.appendChild(x);
    this.body = el('div', 'pf-body');
    this.foot = el('div', 'pf-foot');
    p.append(t, this.body, this.foot);
    // keep clicks from reaching the game behind the overlay
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el = p;
    socialRoot().appendChild(p);
    this.render();
  }

  get isOpen() { return this.el.style.display !== 'none'; }

  open(scene) {
    if (scene) this.scene = scene;
    this.el.style.display = 'flex';
    this.refresh();
  }
  close() { this.el.style.display = 'none'; }
  toggle(scene) { if (this.isOpen) this.close(); else this.open(scene); }

  async refresh() {
    if (!this.isOpen) return;
    this.rooms = null; this.error = null;
    this.render();
    try {
      this.rooms = await listOpenRooms();
    } catch (e) {
      this.error = e?.message || 'Could not reach the relay.';
    }
    this.render();
  }

  render() {
    const b = this.body; const f = this.foot;
    b.innerHTML = ''; f.innerHTML = '';
    if (this.error) {
      b.appendChild(el('div', 'pf-empty', `<b>${escapeHtml(this.error)}</b><br>Check your connection, then Refresh.`));
    } else if (this.rooms === null) {
      b.appendChild(el('div', 'pf-empty', 'Searching for open rooms…'));
    } else if (!this.rooms.length) {
      b.appendChild(el('div', 'pf-empty', 'No open co-op rooms right now — host one in-game!'));
    } else {
      for (const r of this.rooms) b.appendChild(this.row(r));
    }
    const n = this.rooms?.length ?? 0;
    const count = el('span', 'pf-dim', this.rooms ? `${n} open room${n === 1 ? '' : 's'}` : '');
    const refresh = el('button', 'pf-refresh', 'REFRESH');
    refresh.addEventListener('click', () => this.refresh());
    f.append(count, el('span', 'pf-grow'), refresh);
  }

  row(r) {
    const row = el('div', 'pf-row');
    row.innerHTML =
      `<span class="pf-code">${escapeHtml(String(r.code || '').toUpperCase())}</span>` +
      `<span class="pf-host">${escapeHtml(String(r.hostName || 'Host'))}</span>` +
      `<span class="pf-meta">${Number(r.players) || 0}/${Number(r.maxPlayers) || 8} · <i>Lv${Number(r.level) || 1}</i></span>`;
    const join = el('button', 'pf-join', 'JOIN');
    if ((Number(r.players) || 0) >= (Number(r.maxPlayers) || 8)) { join.disabled = true; join.textContent = 'FULL'; }
    join.addEventListener('click', () => this.joinRoom(r, join));
    row.appendChild(join);
    return row;
  }

  // Existing join flow: net.join(code, name, hero) resolves the code to the
  // room (GET /rooms/:code) and joins by id — the same path a typed code uses.
  async joinRoom(r, btn) {
    if (this.joining) return;
    this.joining = true;
    btn.disabled = true; btn.textContent = '…';
    const name = String(loadProfile()?.name || 'Pip').slice(0, 14);
    const hero = loadHero() || { name, job: 'wayfarer' };
    try {
      saveProfile({ name });
      if (net.connected) net.leave(); // drop any current room before joining
      await net.join(String(r.code).toUpperCase(), name, hero);
      this.close();
      bus.emit(Events.SYSTEM, `Joined ${r.hostName || 'the host'}'s room (${r.code})!`);
      // Mirror TitleScene.doOnline: connect first, then continue through creator.
      this.scene?.scene?.start?.('creator', { name, mode: 'join' });
    } catch (e) {
      bus.emit(Events.SYSTEM, `Co-op join failed: ${e?.message || e}`);
      this.refresh(); // room may be gone/full — re-list
    } finally {
      this.joining = false;
      if (this.isOpen) { btn.disabled = false; btn.textContent = 'JOIN'; }
    }
  }

  destroy() { this.el.remove(); }
}

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const s = el('style');
  s.textContent = `
#wf-social .pf-panel{pointer-events:auto;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;max-height:84vh;width:min(430px,calc(100vw - 16px));background:rgba(26,16,8,.96);border:2px solid #c8a840;box-shadow:0 0 0 1px #1a1008,0 0 22px rgba(141,90,43,.35)}
#wf-social .pf-title{color:#9bbc0f;font-size:11px;font-weight:bold;padding:5px 8px;border-bottom:1px solid rgba(141,90,43,.4);display:flex;align-items:center;gap:6px}
#wf-social .pf-title .pf-x{margin-left:auto}
#wf-social .pf-body{padding:4px 6px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#c8a840 #1a1008;flex:1;min-height:0}
#wf-social .pf-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px solid #1A2436}
#wf-social .pf-row:hover{background:rgba(155,188,15,.06)}
#wf-social .pf-code{color:#a0c4f0;background:rgba(255,216,74,.12);border:1px solid rgba(255,216,74,.5);padding:1px 5px;font-size:10px}
#wf-social .pf-host{color:#f4f0dc;font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-social .pf-meta{color:#a89a7e;font-size:9px;flex:1}
#wf-social .pf-meta i{font-style:normal;color:#9bbc0f}
#wf-social .pf-empty{padding:16px 10px;color:#a89a7e;font-size:10px;text-align:center;line-height:1.7}
#wf-social .pf-foot{display:flex;gap:4px;padding:6px 8px;border-top:1px solid rgba(141,90,43,.4);align-items:center}
#wf-social .pf-foot .pf-grow{flex:1}
#wf-social .pf-dim{color:#a89a7e;font-size:9px}
#wf-social .pf-panel button{font-family:'Silkscreen',monospace;font-size:9px;cursor:pointer;padding:2px 8px}
#wf-social .pf-join{color:#1a1008;background:#9bbc0f;border:1px solid #1a1008;box-shadow:inset -1px -1px 0 #7a9a0a,inset 1px 1px 0 #c8e040}
#wf-social .pf-join:hover{background:#3df5ac}
#wf-social .pf-join:active{background:#7a9a0a}
#wf-social .pf-join:disabled{background:#2a1d10;color:#a89a7e;box-shadow:none;cursor:default}
#wf-social .pf-refresh{color:#a0c4f0;background:transparent;border:1px solid rgba(255,216,74,.5)}
#wf-social .pf-refresh:hover{background:rgba(255,216,74,.12);color:#f4f0dc}
#wf-social .pf-x{color:#a89a7e;background:transparent;border:1px solid transparent}
#wf-social .pf-x:hover{color:#f4f0dc;background:rgba(255,255,255,.08)}
@media (max-width:560px){#wf-social .pf-panel{max-height:76vh;top:46%}}
`;
  document.head.appendChild(s);
}
