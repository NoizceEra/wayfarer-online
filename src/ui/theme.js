// theme.js — ONE source of truth for the olive / gold wood-panel look.
//
// Canvas panels import THEME (hex numbers + css strings) and the small draw
// helpers; DOM panels get the same tokens as CSS variables plus an override
// sheet (installTheme) that is appended LAST so panels added by different
// waves (Solana navy/teal cards, 7-8px captions, 2px focus rings...) read as
// one game. Everything here is presentation only.
//
// Contrast (WCAG 2.x, measured on panel fill #1a1008):
//   text #f4f0dc 16.4:1   title #ffe8a0 15.4:1   dim #a89a7e 6.8:1 (was #8a7a60 4.5)
//   gold #ffd84a 13.5:1   danger #ff7a6a 7.4:1    ok #9be88a 12.8:1
//   button ink #1a1024 on olive #9bbc0f 8.4:1
import { settings } from '../core/settings.js';

const hex = (s) => parseInt(s.slice(1), 16);

const C = {
  ink: '#1a1024',        // outlines / deepest shade
  panel: '#1a1008',      // panel interior
  panelHi: '#2a1d10',    // raised rows, HUD frames
  wood: '#8d5a2b',       // frame
  woodLo: '#3a2410',     // dividers
  gold: '#ffd84a',       // accent / focus / selected
  goldText: '#ffe8a0',   // titles
  cream: '#f4f0dc',      // body text
  dim: '#a89a7e',        // secondary text (AA on panel)
  olive: '#9bbc0f',      // primary button
  oliveHi: '#b8d820',
  oliveLo: '#7a9a0a',
  oliveDark: '#0f380f',
  danger: '#ff7a6a',
  dangerBg: '#e8564a',
  ok: '#9be88a',
  info: '#a0c4f0',
  focus: '#fff6c8',      // keyboard / gamepad focus ring (pairs with an ink halo)
};

export const THEME = Object.freeze({
  color: Object.freeze(C),
  hex: Object.freeze(Object.fromEntries(Object.entries(C).map(([k, v]) => [k, hex(v)]))),
  font: Object.freeze({
    display: '"Jacquard12", "Silkscreen", monospace',
    label: '"Silkscreen", monospace',
    body: '"PixelifySans", "Silkscreen", monospace',
  }),
  // Type scale (CSS px at 1x). `min` is the floor for ANY readable text;
  // phones get one extra px because they are held closer but are physically tiny.
  size: Object.freeze({ min: 9, minPhone: 10, small: 10, body: 11, title: 12, hero: 18 }),
  frame: Object.freeze({ border: 2, radius: 0, pad: 8 }),
  touch: Object.freeze({ min: 44 }),
  // Stacking contract: HUD < panels < modals < toasts. DOM layers all live inside
  // #wf-social (z-index 20 under the splash); canvas depth is per-scene.
  z: Object.freeze({ hud: 10, chat: 25, panel: 30, chatInput: 40, modal: 60, toast: 90 }),
});

export const isPhone = () => (typeof window !== 'undefined') && window.innerWidth < 560;
export const minFont = () => (isPhone() ? THEME.size.minPhone : THEME.size.min);
/** Clamp a canvas font size (number) to the readable floor. */
export const fs = (px) => Math.max(px, minFont());

// ── Canvas helpers ──────────────────────────────────────────────────────────
/** Standard wood panel: ink outline, wood frame, dark interior. Returns Graphics. */
export function drawPanel(scene, x, y, w, h, { fill = THEME.hex.panel, alpha = 0.96, border = THEME.hex.wood } = {}) {
  const g = scene.add.graphics();
  g.fillStyle(THEME.hex.ink, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle(fill, alpha).fillRect(x, y, w, h);
  g.lineStyle(2, border, 1).strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.lineStyle(1, THEME.hex.woodLo, 1).strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
  return g;
}
/** Keyboard/gamepad focus ring for canvas buttons (ink halo + cream ring: visible on olive AND dark). */
export function focusRing(scene, x, y, w, h, depth = 1000) {
  const g = scene.add.graphics().setDepth(depth);
  g.lineStyle(4, THEME.hex.ink, 1).strokeRect(x - 3, y - 3, w + 6, h + 6);
  g.lineStyle(2, hex(C.focus), 1).strokeRect(x - 2, y - 2, w + 4, h + 4);
  return g;
}
export const textStyle = (size = 11, color = C.cream, extra = {}) => ({ fontFamily: THEME.font.label, fontSize: `${fs(size)}px`, color, ...extra });

// ── Colour-blind-safe cues ────────────────────────────────────────────────────
// Rarity / status must never rely on colour alone: every tier has a glyph + short label.
export const RARITY_CUE = Object.freeze({
  common: { glyph: '', label: 'Common' },
  uncommon: { glyph: '+', label: 'Uncommon' },
  rare: { glyph: '◆', label: 'Rare' },
  epic: { glyph: '★', label: 'Epic' },
  legendary: { glyph: '♛', label: 'Legendary' },
});
export const rarityCue = (id) => RARITY_CUE[id] || RARITY_CUE.common;

// ── DOM theme ─────────────────────────────────────────────────────────────────
const CSS_ID = 'wf-theme';
function css() {
  const c = C;
  return `
:root{--wf-t-panel:${c.panel};--wf-t-panel-hi:${c.panelHi};--wf-t-wood:${c.wood};--wf-t-wood-lo:${c.woodLo};--wf-t-gold:${c.gold};--wf-t-title:${c.goldText};--wf-t-text:${c.cream};--wf-t-dim:${c.dim};--wf-t-olive:${c.olive};--wf-t-ink:${c.ink};--wf-t-danger:${c.danger};--wf-t-ok:${c.ok};--wf-t-focus:${c.focus};--wf-min-font:${THEME.size.min}px;--wf-text-scale:1}
/* Layer + safe area: same inset box as the canvas (#game) so DOM and canvas HUD agree */
html body #wf-social{inset:auto;top:env(safe-area-inset-top,0px);right:env(safe-area-inset-right,0px);bottom:env(safe-area-inset-bottom,0px);left:env(safe-area-inset-left,0px)}
html body #wf-social .wf-chat{z-index:${THEME.z.chat}}
html body #wf-social .wf-chat.wf-open{z-index:${THEME.z.chatInput}}
html body #wf-social .wf-panel{z-index:${THEME.z.panel}}
html body #wf-social .wf-wheel,html body #wf-social .wf-menu{z-index:${THEME.z.modal}}
html body #wf-social .holder-modal,html body #wf-social .wf-modal{z-index:${THEME.z.modal}}
html body #wf-social.wf-dimmed .wf-panel:not(.wf-chat){visibility:hidden}
/* One focus ring: cream ring + ink halo reads on olive buttons and on dark panels */
html body #wf-social :is(button,input,select,textarea,[tabindex]):focus-visible,html body :is(#ref-cta,.ec-badge):focus-visible{outline:2px solid var(--wf-t-focus);outline-offset:1px;box-shadow:0 0 0 4px var(--wf-t-ink)!important}
/* Shared button states: hover / pressed / disabled behave the same everywhere */
html body #wf-social button:disabled,html body #wf-social button[aria-disabled="true"]{filter:grayscale(.7) brightness(.7);cursor:not-allowed;transform:none}
html body #wf-social button:not(:disabled):active{transform:translateY(1px)}
/* Scrollbars */
html body #wf-social *{scrollbar-width:thin;scrollbar-color:${c.wood} ${c.ink}}
html body #wf-social ::-webkit-scrollbar{width:8px;height:8px}
html body #wf-social ::-webkit-scrollbar-track{background:${c.ink}}
html body #wf-social ::-webkit-scrollbar-thumb{background:${c.wood};border:1px solid ${c.ink}}
html body #wf-social ::-webkit-scrollbar-thumb:hover{background:${c.gold}}
/* Tooltip: any [data-tip] element */
html body #wf-social [data-tip]{position:relative}
html body #wf-social [data-tip]:hover::after,html body #wf-social [data-tip]:focus-visible::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 4px);transform:translateX(-50%);white-space:pre;max-width:240px;background:${c.ink};color:${c.cream};border:1px solid ${c.wood};padding:3px 6px;font-size:10px;z-index:${THEME.z.modal};pointer-events:none}
/* Secondary text: 4.5:1 floor on panel fill */
html body #wf-social :is(.ec-dim,.wf-hint,.wf-empty,.wf-log .t,.dr-note,.dr-streak-l,.dr-day .dr-d){color:var(--wf-t-dim)}
html body #wf-social .wf-tabs button{color:#b3a587}
/* Fonts never below the floor (JS floor in theme.js also covers inline styles) */
html body #wf-social :is(.ec-chip,.ec-status,.ec-dim,.wf-hint,.wf-row .wf-acts button,.wf-wheel .wf-em,.wf-wheel .k,.dr-day .dr-t){font-size:var(--wf-min-font)}
/* Web3 / Solana cards adopt the wood frame so every panel is one family */
html body #wf-social .dr-panel,html body #wf-social .holder-modal{background:rgba(26,16,8,.96);border:2px solid ${c.wood};box-shadow:inset 0 0 0 1px ${c.woodLo},0 0 0 1px ${c.ink},0 8px 24px rgba(0,0,0,.35);font-family:'Silkscreen',monospace;color:${c.cream}}
html body #wf-social .dr-title{background:transparent;border-bottom:1px solid ${c.woodLo};color:${c.goldText}}
html body #wf-social .dr-title span{color:${c.gold}}
html body #wf-social .dr-streak-n{color:${c.gold};text-shadow:none}
html body #wf-social .dr-day{background:rgba(255,255,255,.04);border-color:${c.woodLo}}
html body #wf-social .dr-day.today{border-color:${c.gold};box-shadow:none}
html body #wf-social .dr-day.claimed{border-color:${c.olive}}
html body #wf-social .dr-day.today .dr-d{color:${c.gold}}
html body #wf-social .dr-day .dr-t{color:${c.ok}}
html body #wf-social .dr-day .dr-check{color:${c.olive}}
html body #wf-social .dr-foot{border-top-color:${c.woodLo}}
html body #wf-social .dr-foot button{background:${c.olive};color:${c.ink};border:1px solid ${c.ink};box-shadow:inset -1px -1px 0 ${c.oliveLo},inset 1px 1px 0 #c8e040}
html body #wf-social .dr-foot button:hover{background:${c.oliveHi}}
html body #wf-social .dr-foot button:disabled{background:${c.panelHi};color:var(--wf-t-dim);border-color:${c.woodLo}}
html body #wf-social .dr-x{color:${c.cream}}
html body #wf-social .dr-x:hover{color:${c.gold}}
@media (max-width:560px){
  :root{--wf-min-font:${THEME.size.minPhone}px}
  html body #wf-social .wf-panel,html body #wf-social .ec-panel{max-height:calc(100% - 16px)}
}
/* Short landscape phones (844x390): panels may never be taller than the viewport */
@media (max-height:480px){html body #wf-social :is(.ec-panel,.wf-list,.dr-panel){max-height:calc(100% - 8px)!important}}
/* Large text option: scales every DOM panel */
html.wf-large-text body #wf-social{--wf-text-scale:1.2}
html.wf-large-text body #wf-social :is(.wf-panel,.wf-wheel){zoom:1.2}
html.wf-large-text body #wf-social .wf-panel.ec-panel,html.wf-large-text body #wf-social .wf-list,html.wf-large-text body #wf-social .dr-panel{max-width:calc((100% - 8px)/1.2)}
/* Reduce motion: no panel animations / transitions anywhere in the DOM */
html.wf-reduce-motion *,html.wf-reduce-motion *::before,html.wf-reduce-motion *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
html.wf-reduce-motion #bg-video{display:none}
/* DOM toasts (above everything) */
#wf-toasts{position:fixed;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 44px);z-index:${THEME.z.toast};display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;font-family:'Silkscreen',monospace}
#wf-toasts .wf-t{max-width:min(320px,calc(100vw - 16px));background:rgba(26,16,8,.97);border:2px solid ${c.wood};box-shadow:0 0 0 1px ${c.ink},0 6px 18px rgba(0,0,0,.4);padding:6px 10px;color:${c.cream};animation:wf-toast-in .22s ease-out both}
#wf-toasts .wf-t.wf-badge{border-color:${c.gold}}
#wf-toasts .wf-t .a{display:block;font-size:var(--wf-min-font);letter-spacing:.5px;text-transform:uppercase}
#wf-toasts .wf-t .b{display:block;font-size:11px;font-weight:bold;margin-top:2px;overflow-wrap:anywhere}
#wf-toasts .wf-t .c{display:block;font-size:var(--wf-min-font);color:var(--wf-t-dim);margin-top:2px;overflow-wrap:anywhere}
#wf-toasts .wf-t.out{opacity:0;transform:translateY(-8px);transition:opacity .25s,transform .25s}
@keyframes wf-toast-in{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
@media (max-width:560px){#wf-toasts{top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 200px)}}
`;
}

let observer = null;
let rafId = 0;
const pending = new Set();

function floorNode(root, min) {
  const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [];
  for (const n of els) {
    if (!n.firstChild || n.tagName === 'STYLE' || n.tagName === 'SCRIPT') continue;
    const cs = getComputedStyle(n);
    const px = parseFloat(cs.fontSize);
    if (px && px < min && cs.display !== 'none') n.style.fontSize = `${min}px`;
  }
}
function flushFloor() {
  rafId = 0;
  const min = minFont();
  for (const n of pending) { try { if (n.isConnected) floorNode(n, min); } catch { /* ignore */ } }
  pending.clear();
}
/** Floor every text node in #wf-social at the readable size; re-run on DOM changes (debounced). */
export function watchFontFloor() {
  if (observer || typeof MutationObserver === 'undefined') return;
  const root = document.getElementById('wf-social');
  if (!root) { setTimeout(watchFontFloor, 500); return; }
  observer = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
    // display:none -> flex style flips are attribute changes: floor the whole panel
    for (const m of muts) if (m.type === 'attributes' && m.target.classList?.contains('wf-panel')) pending.add(m.target);
    if (pending.size && !rafId) rafId = requestAnimationFrame(flushFloor);
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  pending.add(root); rafId = requestAnimationFrame(flushFloor);
}

function applyClasses() {
  const h = document.documentElement;
  h.classList.toggle('wf-reduce-motion', !!settings.get('reduceMotion'));
  h.classList.toggle('wf-large-text', !!settings.get('largeText'));
}

export function installTheme() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById(CSS_ID)) {
    const s = document.createElement('style');
    s.id = CSS_ID; s.textContent = css();
    document.head.appendChild(s); // last in <head>: wins ties with panel-injected sheets that come earlier
  }
  applyClasses();
  settings.onChange((k) => { if (k === 'reduceMotion' || k === 'largeText') applyClasses(); });
  // Panels inject their own <style> lazily (after us); re-append so our overrides stay last.
  const keepLast = () => { const s = document.getElementById(CSS_ID); if (s && s.nextElementSibling) document.head.appendChild(s); };
  setTimeout(keepLast, 3000); setTimeout(keepLast, 10000);
  watchFontFloor();
  window.addEventListener('resize', () => { const r = document.getElementById('wf-social'); if (r) { pending.add(r); if (!rafId) rafId = requestAnimationFrame(flushFloor); } });
}

/** True when motion should be calm: explicit setting OR the OS preference. */
export const calmMotion = () => {
  try { if (settings.get('reduceMotion')) return true; } catch { /* ignore */ }
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
