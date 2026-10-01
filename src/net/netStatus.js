import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';

// Server status pill (title + HUD, bottom-left) and the "Reconnecting…"
// banner. Plain DOM over the canvas so no scene has to own it.
//   online:        ● Embervale-1 · 42 ms · 5 online
//   reconnecting:  ◌ Reconnecting…  (+ banner)
//   offline:       ○ Solo · server up, 12 online   (polls /stats every 8 s)
const httpBase = () => CONFIG.serverUrl.replace(/^ws/, 'http');

export function installNetStatus(net) {
  if (typeof document === 'undefined' || document.getElementById('net-pill')) return;
  const css = document.createElement('style');
  css.textContent = `
  #net-pill{position:fixed;left:6px;bottom:4px;z-index:50;pointer-events:none;font:9px "Silkscreen",monospace;
    color:#cfe8a0;background:#0a1e0acc;border:1px solid #306230;padding:2px 6px;border-radius:2px;white-space:nowrap;opacity:.85}
  #net-pill.off{color:#9aa38a}#net-pill.warn{color:#ffd84a;border-color:#8a6a1a}
  #net-banner{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:60;pointer-events:none;display:none;
    font:14px "Silkscreen",monospace;color:#ffe9a8;background:#1a1024e6;border:2px solid #e67e22;padding:10px 18px;text-align:center}
  #net-banner small{display:block;font:11px "PixelifySans",monospace;color:#d8c184;margin-top:4px}
  #chain-pill{position:fixed;left:6px;bottom:22px;z-index:50;pointer-events:none;display:none;
    font:9px "Silkscreen",monospace;color:#ffd84a;background:#1a1024cc;border:1px solid #8a6a1a;
    padding:2px 6px;border-radius:2px;white-space:nowrap;opacity:.9}`;
  document.head.appendChild(css);
  const pill = document.createElement('div'); pill.id = 'net-pill';
  const banner = document.createElement('div'); banner.id = 'net-banner';
  document.body.append(pill, banner);

  // Optional WAYFARER marker (bottom-left, above the server pill). DISCOVERABILITY
  // WITHOUT PRESSURE: it opens nothing and prompts for nothing, it is INVISIBLE
  // until the player has linked a wallet (see ChainPanel.chainHint), and it never
  // appears at all when the relay has no token economy. A curious player notices
  // it; an uninterested one never sees it — the pre-wallet game is complete.
  const chainPillEl = document.createElement('div');
  chainPillEl.id = 'chain-pill';
  document.body.appendChild(chainPillEl);
  const renderChain = async () => {
    try {
      const { chainHint } = await import('../ui/ChainPanel.js');
      const h = chainHint();
      if (h.available) { chainPillEl.textContent = h.text; chainPillEl.title = h.hint || ''; chainPillEl.style.display = 'block'; }
      else chainPillEl.style.display = 'none';
    } catch { chainPillEl.style.display = 'none'; }
  };

  let probe = { up: null, players: 0, ping: null };
  const render = () => {
    const st = net.status;
    banner.style.display = st === 'reconnecting' ? 'block' : 'none';
    if (st === 'reconnecting') banner.innerHTML = 'Reconnecting…<small>your progress is safe — hang tight</small>';
    pill.className = st === 'online' ? '' : st === 'offline' ? 'off' : 'warn';
    if (st === 'online') {
      pill.textContent = `● ${net.roomName || 'online'} · ${net.ping == null ? '…' : Math.round(net.ping) + ' ms'} · ${net.players || 1} online`;
    } else if (st === 'connecting') pill.textContent = '◌ Connecting…';
    else if (st === 'reconnecting') pill.textContent = '◌ Reconnecting…';
    else if (probe.up === null) pill.textContent = '○ Solo · checking server…';
    else if (probe.up) pill.textContent = `○ Solo · server up${probe.ping != null ? ` (${probe.ping} ms)` : ''} · ${probe.players} online`;
    else pill.textContent = '○ Solo · server offline';
  };
  const poll = async () => {
    if (net.status !== 'offline' || document.hidden) return;
    const t0 = performance.now();
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${httpBase()}/stats`, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(to);
      const j = await r.json();
      probe = { up: !!j.ok, players: j.players || 0, ping: Math.round(performance.now() - t0) };
    } catch { probe = { up: false, players: 0, ping: null }; }
    render();
  };
  bus.on(Events.NET_STATUS, render);
  setInterval(poll, 8000);
  poll(); render();
  // Token marker: refresh the balance quietly, then show/hide. It is never shown
  // before a wallet is linked, so this is invisible to a pre-wallet player.
  const chainTick = async () => {
    try {
      const { chainNet } = await import('../net/chainNet.js');
      await chainNet.refresh?.();
    } catch { /* optional surface — the game never depends on it */ }
    renderChain();
  };
  setInterval(chainTick, 20000);
  chainTick();
  // debug/test handle
  window.__netProbe = () => probe;
}
