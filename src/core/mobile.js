// Mobile / touch helpers: fullscreen + orientation hint, haptics (behind a setting), on-screen-keyboard aware
// DOM overlays (visualViewport), scroll / zoom / long-press hardening.
import { bus, Events } from './events.js';
import { settings } from './settings.js';

const isTouchDevice = () => ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ── haptics ────────────────────────────────────────────────────────────────
// haptic(ms | [on,off,on..]) — no-op without navigator.vibrate (iOS Safari) or when the setting is off.
let lastBuzz = 0;
export function haptic(pattern = 12) {
  try {
    if (!settings.get('haptics') || !navigator.vibrate) return false;
    const now = performance.now();
    if (now - lastBuzz < 60) return false; // coalesce bursts (multi-hit frames)
    lastBuzz = now;
    return navigator.vibrate(pattern);
  } catch { return false; }
}

function installHaptics() {
  let lastHp = null;
  bus.on(Events.PLAYER_HP, (p) => {
    if (!p || typeof p.hp !== 'number') return;
    if (lastHp != null && p.hp < lastHp) haptic(Math.min(45, 12 + (lastHp - p.hp) * 0.5));
    lastHp = p.hp;
  });
  bus.on(Events.LEVEL_UP, () => haptic([30, 40, 30, 40, 70]));
  bus.on(Events.PLAYER_DIED, () => haptic([80, 50, 160]));
  bus.on(Events.KILL, () => haptic(10));
}

// ── fullscreen + orientation hint ──────────────────────────────────────────
const fsEl = () => document.documentElement;
export const fullscreenSupported = () => !!(fsEl().requestFullscreen || fsEl().webkitRequestFullscreen);
export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export function toggleFullscreen() {
  try {
    if (isFullscreen()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return false; }
    const el = fsEl();
    const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
    // landscape lock is best-effort (Chrome Android, fullscreen only)
    Promise.resolve(p).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    return true;
  } catch { return false; }
}

const CSS = `
#wf-rotate{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);transform:translateX(-50%);z-index:40;max-width:88vw;
  background:rgba(5,18,8,.92);border:2px solid #c9a23a;color:#e8d48a;font:400 11px/1.4 'Silkscreen',monospace;padding:8px 12px;text-align:center;display:none}
#wf-rotate button{margin-left:8px;background:#9bbc0f;border:1px solid #051208;color:#0f380f;font:inherit;padding:2px 6px}
#wf-update{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);transform:translateX(-50%);z-index:60;background:rgba(5,18,8,.96);
  border:2px solid #9bbc0f;color:#c8e030;font:400 11px 'Silkscreen',monospace;padding:8px 12px;display:flex;gap:10px;align-items:center}
#wf-update button{background:#9bbc0f;border:1px solid #051208;color:#0f380f;font:inherit;padding:3px 8px;cursor:pointer}
#wf-update button.ghost{background:transparent;color:#8bac0f;border-color:#306230}
/* DOM social layer follows the VISUAL viewport (on-screen keyboard) and stays out of the notch */
html.wf-kbd #wf-social .wf-chat{bottom:6px}
html body #wf-social{inset:auto;left:env(safe-area-inset-left,0px);right:env(safe-area-inset-right,0px);
  top:var(--vv-top,0px);height:calc(var(--vv-h,100%) - env(safe-area-inset-bottom,0px));}
`;

function installChrome() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const touch = isTouchDevice();
  document.documentElement.classList.toggle('wf-touch', touch);
  const standalone = window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
  document.documentElement.classList.toggle('wf-standalone', !!standalone);

  // portrait hint: the HUD is laid out for landscape; nudge phones to rotate (dismissible, once per session)
  if (touch) {
    const hint = document.createElement('div'); hint.id = 'wf-rotate';
    hint.innerHTML = 'Rotate your phone sideways for the best view <button type="button">OK</button>';
    document.body.append(hint);
    let dismissed = false;
    hint.querySelector('button').addEventListener('click', () => { dismissed = true; hint.style.display = 'none'; });
    const check = () => { hint.style.display = !dismissed && window.innerHeight > window.innerWidth && window.innerWidth < 700 ? 'block' : 'none'; };
    window.addEventListener('resize', check); window.addEventListener('orientationchange', check); check();
    setTimeout(() => { dismissed = true; hint.style.display = 'none'; }, 9000); // auto-dismiss: it must never linger over the HUD
  }
}

// Keep DOM overlays inside the visible area when the soft keyboard is up.
function installViewportTracking() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const apply = () => {
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
    // keyboard is up when the visual viewport is much shorter than the layout viewport
    root.classList.toggle('wf-kbd', window.innerHeight - vv.height > 120);
  };
  vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); apply();
  // iOS scrolls the page to reveal a focused input; the page is position:fixed, so snap it back
  window.addEventListener('scroll', () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); }, { passive: true });
}

export function installMobile() {
  installChrome();
  installViewportTracking();
  installHaptics();
  // long-press callout / text selection / image drag on anything that is not an input
  document.addEventListener('selectstart', (e) => { if (!/^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  // block pull-to-refresh / overscroll bounce started on the canvas
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || e.target?.tagName === 'CANVAS') e.preventDefault(); }, { passive: false });
}
