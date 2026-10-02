import { socialRoot, el, escapeHtml } from './socialDom.js';
import { gearById, RARITY, SLOT_LABEL, statLine } from '../data/gear.js';
import { iconKey } from '../systems/gearArt.js';

// Shared DOM bits for the economy panels (TradePanel, MarketPanel, MailPanel,
// GuildTab). They live in the #wf-social overlay and reuse its base styles
// (panels, buttons, inputs); the extra rules below are prefixed .ec-.
export { el, escapeHtml };

let sceneRef = null;
const iconCache = new Map();
export function setIconScene(scene) { sceneRef = scene; }
export function iconUrl(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const g = gearById(id);
  let url = '';
  try { if (g && sceneRef?.textures) url = sceneRef.textures.getBase64(iconKey(sceneRef, g, null)) || ''; } catch { url = ''; }
  if (url) iconCache.set(id, url);
  return url;
}
export const rarityColor = (id) => RARITY[gearById(id)?.rarity]?.color || '#f4f0dc';
export const itemName = (id) => gearById(id)?.name || id;
export function itemTitle(id) {
  const g = gearById(id);
  if (!g) return id;
  return `${g.name} - ${RARITY[g.rarity]?.name || ''} ${SLOT_LABEL[g.slot] || ''} Lv${g.lvl}\n${statLine(g.stats)}`;
}

// Clickable item chip: icon + name, rarity coloured.
export function chip(id, onClick, { small = false, badge = '' } = {}) {
  const b = el('button', `ec-chip${small ? ' ec-sm' : ''}`);
  const url = iconUrl(id);
  b.innerHTML = `${url ? `<img src="${url}" alt="">` : '<span class="ec-noimg">?</span>'}<span style="color:${rarityColor(id)}">${escapeHtml(itemName(id))}</span>${badge ? `<i>${escapeHtml(badge)}</i>` : ''}`;
  b.title = itemTitle(id);
  if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(id); }); else b.disabled = true;
  return b;
}

export function panel(cls, title, onClose) {
  const root = socialRoot(); injectCss();
  const p = el('div', `wf-panel ec-panel ${cls}`); p.style.display = 'none';
  const t = el('div', 'wf-title', `<span>${title}</span>`);
  const x = el('button', 'wf-ghost wf-x', '✕'); x.addEventListener('click', onClose);
  t.appendChild(x);
  p.appendChild(t);
  // keep clicks/keys inside the panel from reaching the game
  p.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.appendChild(p);
  return { p, title: t.querySelector('span') };
}

export function tabs(defs, onPick) {
  const bar = el('div', 'wf-tabs');
  const btns = {};
  for (const [id, label] of defs) { const b = el('button', '', label); b.addEventListener('click', () => onPick(id)); bar.appendChild(b); btns[id] = b; }
  return { bar, set: (id) => { for (const [k, b] of Object.entries(btns)) b.classList.toggle('wf-on', k === id); }, btns };
}

export const fmtLeft = (ms) => {
  if (ms <= 0) return 'ended';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
};
export const offlineNote = (what) => el('div', 'wf-empty ec-offline', `<b>${what} needs the public world.</b><br>Press <i>Enter Embervale</i> on the title screen:<br>trading, the market board and mail are server-wide.`);

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const s = el('style');
  s.textContent = `
#wf-social .ec-panel{left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;max-height:86vh;width:min(420px,calc(100vw - 16px))}
#wf-social .ec-panel.ec-wide{width:min(520px,calc(100vw - 16px))}
#wf-social .ec-body{padding:6px 8px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#8a5a2b #1a1024;flex:1;min-height:0}
#wf-social .ec-row{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin:3px 0}
#wf-social .ec-row input,#wf-social .ec-row select{min-width:0}
#wf-social select{font-family:inherit;font-size:10px;color:#fff6e0;background:#120c06;border:1px solid #8a5a2b;padding:2px 3px;pointer-events:auto}
#wf-social .ec-h{color:#ffe8a0;font-size:9px;margin:6px 0 2px;display:flex;align-items:center;gap:6px}
#wf-social .ec-h .ec-tag{margin-left:auto}
#wf-social .ec-grid{display:flex;flex-wrap:wrap;gap:3px;min-height:26px;padding:3px;background:rgba(0,0,0,.25);border:1px solid #3a2410}
#wf-social .ec-chip{display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,.06);box-shadow:none;border:1px solid #3a2410;color:#f4f0dc;padding:1px 4px 1px 1px;font-size:8px;max-width:150px}
#wf-social .ec-chip:hover{background:rgba(255,255,255,.14);border-color:#ffd84a}
#wf-social .ec-chip:disabled{cursor:default;opacity:1}
#wf-social .ec-chip img{width:20px;height:20px;image-rendering:pixelated;flex:none}
#wf-social .ec-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wf-social .ec-chip i{font-style:normal;color:#ffd84a;margin-left:2px}
#wf-social .ec-chip.ec-sel{border-color:#ffd84a;background:rgba(255,216,74,.18)}
#wf-social .ec-noimg{width:20px;text-align:center;color:#6a5a48}
#wf-social .ec-gold{color:#f4c542}
#wf-social .ec-cols{display:flex;gap:6px}
#wf-social .ec-cols>div{flex:1;min-width:0}
#wf-social .ec-status{font-size:8px;padding:1px 4px;border:1px solid #3a2410;color:#9a8a70}
#wf-social .ec-status.on{color:#1a1024;background:#9bbc0f;border-color:#1a1024}
#wf-social .ec-status.ok{color:#1a1024;background:#ffd84a;border-color:#1a1024}
#wf-social .ec-list .wf-row{padding:3px 4px}
#wf-social .ec-list .wf-row img{width:20px;height:20px;image-rendering:pixelated}
#wf-social .ec-price{color:#f4c542;min-width:52px;text-align:right}
#wf-social .ec-dim{color:#8a7a60;font-size:8px}
#wf-social .ec-mail{cursor:pointer}
#wf-social .ec-mail.unread .wf-name{color:#ffd84a}
#wf-social .ec-offline{padding:18px 10px;line-height:1.6}
#wf-social .ec-foot{display:flex;gap:4px;padding:6px 8px;border-top:1px solid #3a2410;align-items:center;flex-wrap:wrap}
#wf-social .ec-foot .ec-grow{flex:1}
#wf-social textarea{font-family:inherit;font-size:10px;color:#fff6e0;background:#120c06;border:1px solid #8a5a2b;padding:3px 5px;outline:none;pointer-events:auto;resize:vertical;width:100%;min-height:40px;-webkit-user-select:text;user-select:text}
#wf-social .ec-badge{position:fixed;left:6px;bottom:22px;z-index:51;pointer-events:auto;cursor:pointer;font:9px "Silkscreen",monospace;color:#ffe8a0;background:#1a1024e0;border:1px solid #8a5a2b;padding:2px 6px;border-radius:2px;display:none}
#wf-social .ec-badge.new{color:#1a1024;background:#ffd84a;border-color:#1a1024}
#wf-social .ec-toast{left:50%;top:96px;transform:translateX(-50%);padding:6px 10px;display:flex;gap:8px;align-items:center;background:rgba(26,16,8,.95)}
@media (max-width:560px){#wf-social .ec-panel{max-height:78vh;top:46%}#wf-social .ec-chip{max-width:120px}#wf-social .ec-badge{bottom:40px}}
`;
  document.head.appendChild(s);
}
