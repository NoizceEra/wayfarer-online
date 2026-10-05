// hudPolish.js — ADDITIVE HUD/UX polish helpers.
//
// This module is intentionally dependency-light so the parent can wire it in
// later without touching the host scenes/panels. Its only imports are three
// read-only core/data modules (the event bus, the settings store, and the HUD
// icon id maps); it imports nothing from any UI file (UIScene.js, econDom.js,
// socialDom.js, core/input.js are never touched). Every helper is a graceful
// no-op when its target elements / scene / input manager are absent
// (SSR, tests, HUD elements not yet built).
//
// Style tokens (Solana palette + pixel fonts):
//   bg #0A0E1A, bgLight #1A103C, green #14F195, purple #9945FF,
//   cyan #03E1FF, magenta #DC1FFF, white #E1E8F0, muted #6B7A99.
//   Fonts: Jacquard12 (display), Silkscreen (labels/buttons),
//   PixelifySans (body).

import { bus, Events } from '../core/events.js';
import { settings } from '../core/settings.js';
import { hudStatusIconKey } from '../systems/hudIcons.js';

export const POLISH_PALETTE = Object.freeze({
  bg: '#0A0E1A',
  bgLight: '#1A103C',
  green: '#14F195',
  purple: '#9945FF',
  cyan: '#03E1FF',
  magenta: '#DC1FFF',
  white: '#E1E8F0',
  muted: '#6B7A99',
});

export const POLISH_FONTS = Object.freeze({
  display: '"Jacquard12", "Silkscreen", monospace',
  label: '"Silkscreen", monospace',
  body: '"PixelifySans", "Silkscreen", monospace',
});

// Mobile readability floors the parent asked for.
export const POLISH_MIN = Object.freeze({
  panelWidthPx: 340,
  logHeightPx: 90,
  inputFontPx: 13,
  logFontPx: 11,
  tabButtonPx: 44,
  touchTargetPx: 44,
  mobileBreakpointPx: 560,
});

// ── Standard HUD icon registration metadata ────────────────────────────────
// The game builds canvas icons via makeHudIcons(scene) in systems/hudIcons.js.
// This table is the DOM/aria-side companion: a stable id + label per icon so
// future icon buttons, toasts and screen-reader text stay consistent.
// registerHudIcons() is a no-op unless given a scene whose textures exist;
// it only records metadata on the scene object for later wiring.
export const HUD_ICONS = Object.freeze([
  { id: 'heart', label: 'Health', glyph: '♥', ariaLabel: 'Health points' },
  { id: 'mana', label: 'Mana', glyph: '◆', ariaLabel: 'Mana points' },
  { id: 'xp', label: 'Experience', glyph: '★', ariaLabel: 'Experience progress' },
  { id: 'coin', label: 'Gold', glyph: '◉', ariaLabel: 'Gold amount' },
  { id: 'potion', label: 'Potions', glyph: '⚱', ariaLabel: 'Potion count' },
  { id: 'sword', label: 'Attack', glyph: '⚔', ariaLabel: 'Attack stat' },
  { id: 'shield', label: 'Defense', glyph: '⛨', ariaLabel: 'Defense stat' },
]);

export function hudIconById(id) {
  if (!id) return null;
  return HUD_ICONS.find((i) => i.id === id) || null;
}

export function registerHudIcons(scene) {
  try {
    if (!scene || typeof scene !== 'object') return false;
    if (!scene.textures || typeof scene.textures.exists !== 'function') return false;
    if (!scene.cache && !scene.textures) return false;
    // Record-only: never creates textures here; the real build stays in hudIcons.js.
    scene.hudPolishIcons = HUD_ICONS.map((i) => ({ ...i }));
    return true;
  } catch {
    return false;
  }
}

// ── Panel open/close + Escape / outside-click behavior ─────────────────────
// attachPanelBehavior wires the three closers every HUD panel should have:
//   1. explicit close button (selector or node),
//   2. Escape key (via input manager closer stack when available,
//      otherwise a local keydown listener),
//   3. outside-click / shade click (optional, off by default so world
//      clicks are unaffected).
// Returns a detach() function. No-ops (returns () => {}) when panelEl is null.
export function attachPanelBehavior({
  panelEl = null,
  onClose = null,
  closeButton = '[data-close], .wf-x',
  closeOnEscape = true,
  closeOnOutsideClick = false,
  inputManager = null,
  closerId = null,
  closerPriority = 0,
} = {}) {
  if (!panelEl || typeof panelEl.addEventListener !== 'function') return () => {};
  if (typeof onClose !== 'function') return () => {};
  const cleanups = [];
  const isOpen = () => {
    try {
      if (panelEl.style && panelEl.style.display === 'none') return false;
      if (typeof panelEl.hasAttribute === 'function' && panelEl.hasAttribute('hidden')) return false;
      return panelEl.isConnected !== false;
    } catch {
      return true;
    }
  };

  if (closeButton) {
    let btns = [];
    try {
      btns = Array.from(panelEl.querySelectorAll(closeButton));
    } catch {
      btns = [];
    }
    for (const b of btns) {
      const h = (e) => {
        try { e.stopPropagation(); } catch { /* noop */ }
        onClose();
      };
      b.addEventListener('click', h);
      cleanups.push(() => b.removeEventListener('click', h));
    }
  }

  let offCloser = null;
  if (closeOnEscape) {
    if (inputManager && typeof inputManager.addCloser === 'function') {
      try {
        offCloser = inputManager.addCloser({
          id: closerId || `polish-panel-${Math.random().toString(36).slice(2)}`,
          priority: closerPriority,
          isOpen,
          close: onClose,
        });
      } catch {
        offCloser = null;
      }
      if (typeof offCloser === 'function') cleanups.push(offCloser);
    }
    if (!offCloser && typeof document !== 'undefined') {
      const onKey = (e) => {
        if (e && (e.key === 'Escape' || e.key === 'Esc') && isOpen()) {
          try { e.stopPropagation(); } catch { /* noop */ }
          onClose();
        }
      };
      document.addEventListener('keydown', onKey, true);
      cleanups.push(() => document.removeEventListener('keydown', onKey, true));
    }
  }

  if (closeOnOutsideClick && typeof document !== 'undefined') {
    const onDown = (e) => {
      try {
        if (isOpen() && e.target && !panelEl.contains(e.target)) onClose();
      } catch { /* noop */ }
    };
    // Capture phase so panel-internal stopPropagation still lets this run first.
    document.addEventListener('pointerdown', onDown, true);
    cleanups.push(() => document.removeEventListener('pointerdown', onDown, true));
  }

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    for (const fn of cleanups) {
      try { fn(); } catch { /* noop */ }
    }
  };
}

// Thin wrapper when the parent only wants the Escape-closer stack entry.
export function registerCloser(inputManager, { id, priority = 0, isOpen, close } = {}) {
  const noop = () => {};
  if (!id || typeof isOpen !== 'function' || typeof close !== 'function') return noop;
  try {
    if (inputManager && typeof inputManager.addCloser === 'function') {
      const off = inputManager.addCloser({ id, priority, isOpen, close });
      return typeof off === 'function' ? off : noop;
    }
  } catch { /* fall through to noop */ }
  return noop;
}

// ── Focus / aria labels ────────────────────────────────────────────────────
// applyA11y(el, {label, role, describedBy, focusable}) sets accessible
// naming on HUD buttons/panels. No-op on null elements.
export function applyA11y(node, { label = null, role = null, describedBy = null, focusable = null } = {}) {
  if (!node || typeof node.setAttribute !== 'function') return false;
  try {
    if (label) node.setAttribute('aria-label', label);
    if (role) node.setAttribute('role', role);
    if (describedBy) node.setAttribute('aria-describedby', describedBy);
    if (focusable === true && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
    if (focusable === false && typeof node.removeAttribute === 'function') node.removeAttribute('tabindex');
    return true;
  } catch {
    return false;
  }
}

// Label every tab button in a .wf-tabs bar (or any container) and mark the
// selected one with aria-selected. Returns count labelled (0 when absent).
export function labelTabs(container, labels = []) {
  try {
    if (!container || typeof container.querySelectorAll !== 'function') return 0;
    const btns = Array.from(container.querySelectorAll('button'));
    if (!btns.length) return 0;
    btns.forEach((b, i) => {
      const label = labels[i] || b.textContent?.trim() || `Tab ${i + 1}`;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-selected', b.classList.contains('wf-on') ? 'true' : 'false');
      b.setAttribute('role', 'tab');
    });
    return btns.length;
  } catch {
    return 0;
  }
}

// Move focus into an opened panel's first focusable child (or the panel
// itself with tabindex=-1). Returns true if focus moved.
export function focusPanel(panelEl) {
  try {
    if (!panelEl || typeof panelEl.querySelector !== 'function') return false;
    const target =
      panelEl.querySelector('input, textarea, select, button:not([disabled])') || panelEl;
    if (target && typeof target.focus === 'function') {
      if (target === panelEl && !panelEl.hasAttribute('tabindex')) {
        panelEl.setAttribute('tabindex', '-1');
      }
      target.focus({ preventScroll: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Touch-target + readability upgrades ────────────────────────────────────
// upgradeTouchTargets(root, minPx): enforce a minimum 44px hit area on
// buttons/inputs inside HUD panels (mobile ≤560px rule is in the injected
// CSS; this helper covers inline-styled or dynamically added nodes).
// ensureReadableText(root): floor chat log/input font sizes to the
// POLISH_MIN values. Both return counts changed; 0 when root is absent.
export function upgradeTouchTargets(root = null, minPx = POLISH_MIN.touchTargetPx) {
  try {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
    const nodes = Array.from(
      scope.querySelectorAll('#wf-social button, #wf-social input, #wf-social select, #wf-social textarea'),
    );
    let changed = 0;
    for (const n of nodes) {
      try {
        const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(n) : null;
        const w = cs ? parseFloat(cs.minWidth) || 0 : 0;
        const h = cs ? parseFloat(cs.minHeight) || 0 : 0;
        if (w < minPx) { n.style.minWidth = `${minPx}px`; changed++; }
        else if (n.style && !n.style.minWidth && (n.tagName === 'BUTTON')) { n.style.minWidth = `${minPx}px`; changed++; }
        if (h < minPx) { n.style.minHeight = `${minPx}px`; changed++; }
        else if (n.style && !n.style.minHeight && (n.tagName === 'BUTTON')) { n.style.minHeight = `${minPx}px`; changed++; }
      } catch { /* per-node noop */ }
    }
    return changed;
  } catch {
    return 0;
  }
}

export function ensureReadableText(root = null) {
  try {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
    let changed = 0;
    const floorFont = (node, min) => {
      const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(node) : null;
      const cur = cs ? parseFloat(cs.fontSize) || 0 : 0;
      if (cur > 0 && cur < min) {
        node.style.fontSize = `${min}px`;
        changed++;
      }
    };
    for (const n of Array.from(scope.querySelectorAll('#wf-social .wf-log'))) {
      floorFont(n, POLISH_MIN.logFontPx);
    }
    for (const n of Array.from(scope.querySelectorAll('#wf-social .wf-inrow input, #wf-social input, #wf-social textarea'))) {
      floorFont(n, POLISH_MIN.inputFontPx);
    }
    // Chat panel width floor for narrow phones.
    for (const n of Array.from(scope.querySelectorAll('#wf-social .wf-chat, #wf-social .ec-panel'))) {
      const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(n) : null;
      const w = cs ? parseFloat(cs.width) || 0 : 0;
      if (w > 0 && w < POLISH_MIN.panelWidthPx && typeof window !== 'undefined' && window.innerWidth <= 560) {
        n.style.width = `min(${POLISH_MIN.panelWidthPx}px, calc(100vw - 16px))`;
        changed++;
      }
    }
    return changed;
  } catch {
    return 0;
  }
}

// ── Polish stylesheet (Solana theme, additive) ─────────────────────────────
// injectPolishCss() appends one <style id="wf-hud-polish"> after the existing
// social/econ styles. It only ADDS rules: mobile floors (panel ≥340px,
// log ≥90px, input ≥13px, log ≥11px, tab buttons 44×44 at ≤560px), Solana
// focus rings, and a .wf-polish-accent helper class. Safe to call twice.
export const POLISH_CSS_ID = 'wf-hud-polish';

export function injectPolishCss() {
  try {
    if (typeof document === 'undefined') return false;
    if (document.getElementById(POLISH_CSS_ID)) return true;
    const s = document.createElement('style');
    s.id = POLISH_CSS_ID;
    s.textContent = `
/* wf-hud-polish (additive): Solana accents + mobile readability floors. */
:root{
  --wf-bg:${POLISH_PALETTE.bg}; --wf-bg-light:${POLISH_PALETTE.bgLight};
  --wf-green:${POLISH_PALETTE.green}; --wf-purple:${POLISH_PALETTE.purple};
  --wf-cyan:${POLISH_PALETTE.cyan}; --wf-magenta:${POLISH_PALETTE.magenta};
  --wf-white:${POLISH_PALETTE.white}; --wf-muted:${POLISH_PALETTE.muted};
}
#wf-social .wf-display{font-family:${POLISH_FONTS.display};}
#wf-social .wf-polish-accent{color:var(--wf-green);border-color:var(--wf-green);}
#wf-social button:focus-visible,#wf-social input:focus-visible,
#wf-social select:focus-visible,#wf-social textarea:focus-visible{
  outline:2px solid var(--wf-cyan);outline-offset:2px;
}
@media (max-width:${POLISH_MIN.mobileBreakpointPx}px){
  #wf-social .wf-chat,#wf-social .wf-list,#wf-social .ec-panel{
    width:min(${POLISH_MIN.panelWidthPx}px,calc(100vw - 16px));
  }
  #wf-social .wf-log{height:${POLISH_MIN.logHeightPx}px;min-height:${POLISH_MIN.logHeightPx}px;font-size:${POLISH_MIN.logFontPx}px;}
  #wf-social .wf-inrow input,#wf-social .wf-foot input,#wf-social textarea{font-size:${POLISH_MIN.inputFontPx}px;}
  #wf-social .wf-tabs button{min-width:${POLISH_MIN.tabButtonPx}px;min-height:${POLISH_MIN.tabButtonPx}px;}
  #wf-social button{margin:0;}
}
`;
    document.head.appendChild(s);
    return true;
  } catch {
    return false;
  }
}

// Convenience: run the DOM-side upgrades in one call. All steps no-op
// independently when their targets are absent. Returns a summary object.
export function polishHud({ root = null, inputManager = null, panels = [] } = {}) {
  const summary = { css: false, tabsLabelled: 0, touchUpgraded: 0, readableFixed: 0, closers: 0 };
  try {
    summary.css = injectPolishCss();
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (scope && typeof scope.querySelectorAll === 'function') {
      for (const bar of Array.from(scope.querySelectorAll('#wf-social .wf-tabs'))) {
        summary.tabsLabelled += labelTabs(bar);
      }
    }
    summary.touchUpgraded = upgradeTouchTargets(scope);
    summary.readableFixed = ensureReadableText(scope);
    for (const p of panels) {
      try {
        attachPanelBehavior({ ...p, inputManager });
        summary.closers++;
      } catch { /* per-panel noop */ }
    }
  } catch { /* global noop */ }
  return summary;
}

// ══════════════════════════════════════════════════════════════════════════
// COMBAT READABILITY
// Skill-bar readiness / MP-failure clarity, low HP/MP warnings, and on-HUD
// status indicators. Additive and no-op tolerant like everything above.
//
// Reads ONLY existing sources — no new state store:
//   • cooldown/readiness : player.cooldowns[ab.id] + player.skillCd(ab) +
//                          player.skillLv(ab.id)   (same source UIScene uses)
//   • MP cost / afford   : the ability's fx.mp + player.mp  (same check as
//                          skillFx.castFx's "Not enough MP!" gate)
//   • statuses           : StatusSet.list(now) from systems/status.js
//   • shield / buff      : player.invulnUntil (Ward) + player.buff (empower)
//   • HP/MP numbers      : the existing Events.PLAYER_HP payload
//
// Honours settings.reduceMotion (steady state, no pulse/flash) and CONFIG.isMobile
// (pass it as opts.isMobile so touch gets a gentler, slower pulse).
//
// Host wire-in (~4 lines, after UIScene's hotbar is built):
//   this.combatRead = createCombatReadability(this, {
//     slots: this.hotbar, getPlayer: () => this.world()?.player,
//     hpBar: this.hpBar, mpBar: this.mpBar, small: this.small,
//     isMobile: CONFIG.isMobile,
//     statusList: () => this.world()?.combat?.statuses?.list(this.world()?.time?.now ?? 0) || [],
//     anchor: { x: 18, y: this.small ? 150 : 128 },
//   });
//   this.events.once('shutdown', this.combatRead.destroy);   // cleanup
//   // in UIScene.update():  this.combatRead.update();
// ══════════════════════════════════════════════════════════════════════════

export const COMBAT_READ = Object.freeze({
  lowHpFrac: 0.25,     // HP ≤ 25% -> warn
  lowMpFrac: 0.15,     // MP ≤ 15% -> warn
  pulseMs: 1000,       // warn pulse period on desktop
  warnAlpha: 0.9,      // peak frame alpha (also the steady value)
  warnAlphaMin: 0.28,  // trough alpha (desktop swing)
  readyFlashMs: 300,   // green edge flash when a slot comes off cooldown
  maxStatus: 6,        // status squares drawn at once
  statusStep: 26,      // px between status squares
});

// Status read-model. Ids match STATUS in data/combatMath.js (+ `shield` from
// Ward/invulnUntil and `buff` from player.buff). Kept local so the module needs
// no data import; colours are the Solana palette.
export const READ_STATUS = Object.freeze({
  poison: { label: 'Poison', color: POLISH_PALETTE.green, glyph: 'P' },
  burn: { label: 'Burn', color: POLISH_PALETTE.magenta, glyph: 'B' },
  bleed: { label: 'Bleed', color: POLISH_PALETTE.magenta, glyph: 'b' },
  slow: { label: 'Slow', color: POLISH_PALETTE.cyan, glyph: 'S' },
  stun: { label: 'Stun', color: POLISH_PALETTE.green, glyph: '*' },
  shield: { label: 'Shield', color: POLISH_PALETTE.purple, glyph: 'D' },
  buff: { label: 'Buff', color: POLISH_PALETTE.green, glyph: '+' },
});

function hexInt(hex) {
  try {
    const h = String(hex).replace('#', '');
    const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(f, 16);
    return Number.isFinite(n) ? n : 0xffffff;
  } catch {
    return 0xffffff;
  }
}

// ── Pure decision helpers (no Phaser, unit-testable) ───────────────────────

// One skill slot's readiness/affordability from the existing sources only.
// `now` is the world clock (ms), matching player.cooldowns + UIScene.update().
export function skillSlotState(player, ab, now) {
  const out = { learned: false, ready: false, cooldown: false, canAfford: false, brake: false, remain: 0, total: 1, mpCost: 0 };
  if (!player || !ab) return out;
  try { out.learned = (player.skillLv ? player.skillLv(ab.id) : 1) >= 1; } catch { out.learned = true; }
  try { out.total = (player.skillCd ? player.skillCd(ab) : ab.cd) || 1; } catch { out.total = ab.cd || 1; }
  const until = (player.cooldowns && player.cooldowns[ab.id]) || 0;
  out.remain = Math.max(0, (until - now) / 1000);
  out.cooldown = out.remain > 0;
  out.mpCost = (ab.fx && ab.fx.mp) || 0;
  out.canAfford = !out.mpCost || (player.mp || 0) >= out.mpCost;
  out.ready = out.learned && !out.cooldown && out.canAfford;
  // off cooldown but unaffordable -> the distinct "not enough MP" affordance
  out.brake = out.learned && !out.cooldown && !out.canAfford;
  return out;
}

// Low-resource flags: HP ≤ 25% and MP ≤ 15% (dead suppresses both).
export function lowResourceState({ hp = 0, maxHp = 1, mp = 0, maxMp = 1, dead = false } = {}) {
  const hpFrac = Math.max(0, Math.min(1, maxHp ? hp / maxHp : 0));
  const mpFrac = Math.max(0, Math.min(1, maxMp ? mp / maxMp : 0));
  return {
    hpFrac,
    mpFrac,
    lowHp: !dead && hpFrac <= COMBAT_READ.lowHpFrac,
    lowMp: !dead && mpFrac <= COMBAT_READ.lowMpFrac,
  };
}

// StatusSet.list(now) -> draw models. Unknown ids fall back to a muted square.
export function statusIndicators(list = []) {
  const out = [];
  for (const s of list || []) {
    if (!s || !s.id) continue;
    const d = READ_STATUS[s.id] || { label: String(s.id), color: POLISH_PALETTE.muted, glyph: '?' };
    out.push({
      id: s.id, label: d.label, color: d.color, colorInt: hexInt(d.color), glyph: d.glyph,
      left: s.left || 0, frac: typeof s.frac === 'number' ? s.frac : 1,
      iconKey: (() => { try { return hudStatusIconKey(s.id); } catch { return null; } })(),
    });
    if (out.length >= COMBAT_READ.maxStatus) break;
  }
  return out;
}

// Player buff/shield indicators from player.invulnUntil (Ward) + player.buff.
export function playerIndicators(player, now = 0) {
  const out = [];
  if (!player) return out;
  try {
    if (typeof player.invulnUntil === 'number' && player.invulnUntil > now && !player.dead) {
      const left = player.invulnUntil - now;
      if (left < 60000) out.push({ id: 'shield', label: 'Shield', color: POLISH_PALETTE.purple, colorInt: hexInt(POLISH_PALETTE.purple), glyph: 'D', left, frac: 1, iconKey: (() => { try { return hudStatusIconKey('shield'); } catch { return null; } })() });
    }
  } catch { /* noop */ }
  try {
    const b = player.buff;
    if (b && typeof b.until === 'number' && b.until > now) {
      const left = b.until - now;
      out.push({ id: 'buff', label: 'Buff', color: POLISH_PALETTE.green, colorInt: hexInt(POLISH_PALETTE.green), glyph: '+', left, frac: 1, iconKey: (() => { try { return hudStatusIconKey('buff'); } catch { return null; } })() });
    }
  } catch { /* noop */ }
  return out;
}

// Warning pulse alpha. reduceMotion -> steady at peak (unmistakable, no motion);
// mobile -> gentler, slower swing so it reads without nagging. Pure.
export function pulseAlpha(now, { reduceMotion = false, isMobile = false } = {}) {
  const hi = COMBAT_READ.warnAlpha;
  if (reduceMotion) return hi;
  const period = isMobile ? COMBAT_READ.pulseMs * 1.6 : COMBAT_READ.pulseMs;
  const lo = isMobile ? 0.55 : COMBAT_READ.warnAlphaMin;
  const t = (Math.sin((now / period) * Math.PI * 2) + 1) / 2;
  return lo + (hi - lo) * t;
}

// ── Phaser overlay controller ──────────────────────────────────────────────

export function createCombatReadability(scene, opts = {}) {
  const noopFn = () => {};
  const noop = { ready: false, update: noopFn, destroy: noopFn, slotCount: 0, statusCount: 0 };
  try {
    if (!scene || !scene.add || typeof scene.add.rectangle !== 'function') return noop;
  } catch { return noop; }

  const getPlayer = typeof opts.getPlayer === 'function' ? opts.getPlayer : () => null;
  const nowFn = typeof opts.getNow === 'function' ? opts.getNow : () => { try { return scene.time?.now ?? 0; } catch { return 0; } };
  const readReduce = () => {
    if (typeof opts.reduceMotion === 'boolean') return opts.reduceMotion;
    try { return !!settings.get('reduceMotion'); } catch { return false; }
  };
  const readMobile = () => {
    if (typeof opts.isMobile === 'boolean') return opts.isMobile;
    try {
      if (typeof window === 'undefined') return false;
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
      return Math.min(window.innerWidth || 9999, window.innerHeight || 9999) < 620;
    } catch { return false; }
  };

  const made = [];   // every Phaser object we create
  const offs = [];   // every bus unsubscribe fn
  const track = [];  // per-skill-slot feedback records
  const strip = [];  // status-strip entries
  let hpCache = null;      // last Events.PLAYER_HP payload
  let diedAt = -Infinity;  // suppress warnings for a beat after death
  const keep = (o) => { if (o) made.push(o); return o; };

  // — low-resource warning frames (HP magenta, MP cyan) around the bars —
  const mkFrame = (bar, colorInt) => {
    if (!bar || typeof bar.setStrokeStyle !== 'function') return null;
    const w = bar.width || bar.displayWidth || 0, h = bar.height || bar.displayHeight || 0;
    if (!w || !h) return null;
    try {
      const r = keep(scene.add.rectangle(bar.x, bar.y, w, h, 0x000000, 0).setOrigin(0, 0).setDepth(105));
      r.setStrokeStyle(2, colorInt, 1).setVisible(false);
      return r;
    } catch { return null; }
  };
  const hpWarn = mkFrame(opts.hpBar, hexInt(POLISH_PALETTE.magenta));
  const mpWarn = mkFrame(opts.mpBar, hexInt(POLISH_PALETTE.cyan));

  // — per-slot skill feedback: magenta MP badge + green ready flash —
  for (const slot of opts.slots || []) {
    const ab = slot && slot.s && slot.s.ab;
    if (!ab) continue;
    let bx = 0, by = 0, bw = 44, bh = 44;
    try { bx = slot.bg?.x ?? 0; by = slot.bg?.y ?? 0; bw = slot.bw || slot.bg?.width || 44; bh = slot.bh || slot.bg?.height || 44; } catch { /* noop */ }
    let brake = null, ready = null, brakeT = null;
    try {
      brake = keep(scene.add.rectangle(bx, by, bw - 2, bh - 2, hexInt(POLISH_PALETTE.magenta), 0.30).setDepth(107).setVisible(false));
      brake.setStrokeStyle(2, hexInt(POLISH_PALETTE.magenta), 0.95);
      ready = keep(scene.add.rectangle(bx, by, bw - 2, bh - 2, 0x000000, 0).setDepth(108).setVisible(false));
      ready.setStrokeStyle(2, hexInt(POLISH_PALETTE.green), 1);
      brakeT = keep(scene.add.text(bx + bw / 2 - 3, by + bh / 2 - 3, 'MP', {
        fontFamily: POLISH_FONTS.label, fontSize: '9px', color: POLISH_PALETTE.white,
        stroke: POLISH_PALETTE.bg, strokeThickness: 3,
      }).setOrigin(1, 1).setDepth(109).setVisible(false));
    } catch { /* no Phaser text renderer */ }
    track.push({ ab, brake, ready, brakeT, wasReady: false, flashUntil: 0 });
  }

  // — status strip (icons + remaining seconds) —
  const anchor = opts.anchor || { x: 18, y: 128 };
  try {
    for (let i = 0; i < COMBAT_READ.maxStatus; i++) {
      const c = keep(scene.add.container(anchor.x + i * COMBAT_READ.statusStep, anchor.y).setDepth(107).setVisible(false));
      const g = keep(scene.add.graphics());
      const glyph = keep(scene.add.text(11, 11, '', { fontFamily: POLISH_FONTS.label, fontSize: '11px', color: POLISH_PALETTE.white, stroke: POLISH_PALETTE.bg, strokeThickness: 2 }).setOrigin(0.5));
      const secs = keep(scene.add.text(21, 21, '', { fontFamily: POLISH_FONTS.label, fontSize: '8px', color: POLISH_PALETTE.white, stroke: POLISH_PALETTE.bg, strokeThickness: 2 }).setOrigin(1, 1));
      c.add([g, glyph, secs]);
      strip.push({ c, g, glyph, secs, icon: null });
    }
  } catch { /* noop */ }

  // — bus subscriptions (existing events; auto-detached in destroy) —
  try {
    offs.push(bus.on(Events.SKILL_CAST, (p) => {
      const id = p && p.id;
      if (!id) return;
      let now = 0; try { now = nowFn() || 0; } catch { now = 0; }
      for (const t of track) if (t.ab && t.ab.id === id) t.flashUntil = now + COMBAT_READ.readyFlashMs;
    }));
    offs.push(bus.on(Events.PLAYER_HP, (p) => { if (p && typeof p.hp === 'number') hpCache = p; }));
    offs.push(bus.on(Events.PLAYER_DIED, () => { try { diedAt = nowFn() || 0; } catch { diedAt = 0; } hpCache = null; }));
  } catch { /* noop */ }

  function update() {
    let now = 0;
    try { now = nowFn() || 0; } catch { now = 0; }
    let player = null;
    try { player = getPlayer(); } catch { player = null; }
    const reduceMotion = readReduce();
    const isMobile = readMobile();

    // — skill slots: MP-failure badge + ready flash (cooldown sweep stays the host's) —
    for (const t of track) {
      let st;
      try { st = skillSlotState(player, t.ab, now); } catch { st = skillSlotState(null, t.ab, now); }
      const brake = !!st.brake;
      if (t.brake) { t.brake.setVisible(brake); if (brake) t.brake.setAlpha(reduceMotion ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(now / 450))); }
      if (t.brakeT) t.brakeT.setVisible(brake);
      if (!reduceMotion && st.ready && !t.wasReady) t.flashUntil = now + COMBAT_READ.readyFlashMs;
      t.wasReady = st.ready;
      const flashing = !reduceMotion && now < t.flashUntil;
      if (t.ready) { t.ready.setVisible(flashing); if (flashing) t.ready.setAlpha(1 - (t.flashUntil - now) / COMBAT_READ.readyFlashMs); }
    }

    // — low HP/MP warnings: prefer the existing PLAYER_HP payload —
    let hp = player && player.hp, mp = player && player.mp;
    let maxHp = player ? (player.effMaxHp ? player.effMaxHp() : player.maxHp) : 1;
    let maxMp = player ? (player.effMaxMp ? player.effMaxMp() : player.maxMp) : 1;
    if (hpCache && typeof hpCache.hp === 'number') { hp = hpCache.hp; maxHp = hpCache.maxHp; mp = hpCache.mp; maxMp = hpCache.maxMp; }
    const dead = !!(player && player.dead) || (now - diedAt) < 1500;
    const rs = lowResourceState({ hp, maxHp, mp, maxMp, dead });
    const pa = pulseAlpha(now, { reduceMotion, isMobile });
    if (hpWarn) { hpWarn.setVisible(rs.lowHp); if (rs.lowHp) hpWarn.setAlpha(pa); }
    if (mpWarn) { mpWarn.setVisible(rs.lowMp); if (rs.lowMp) mpWarn.setAlpha(pa); }

    // — status strip —
    let models = [];
    try { models = statusIndicators(typeof opts.statusList === 'function' ? opts.statusList() : []); } catch { models = []; }
    try { models = models.concat(playerIndicators(player, now)); } catch { /* noop */ }
    if (models.length > COMBAT_READ.maxStatus) models = models.slice(0, COMBAT_READ.maxStatus);
    for (let i = 0; i < strip.length; i++) {
      const e = strip[i], m = models[i];
      if (!m) { e.c.setVisible(false); continue; }
      e.c.setVisible(true);
      const g = e.g;
      g.clear();
      g.fillStyle(hexInt(POLISH_PALETTE.bg), 0.92).fillRect(0, 0, 22, 22);
      g.fillStyle(m.colorInt, 0.95).fillRect(1, 1, 20, 20);
      g.fillStyle(0x000000, 0.5).fillRect(1, 1, 20, 20 * (1 - Math.max(0, Math.min(1, m.frac)))); // drains top-down
      g.lineStyle(2, m.colorInt, 1).strokeRect(1, 1, 20, 20);
      let hasIcon = false;
      if (m.iconKey) {
        try {
          if (scene.textures && scene.textures.exists(m.iconKey)) {
            if (!e.icon) { e.icon = keep(scene.add.image(1, 1, m.iconKey).setOrigin(0, 0).setScale(1.25)); e.c.add(e.icon); }
            else e.icon.setTexture(m.iconKey);
            e.icon.setVisible(true); hasIcon = true;
          }
        } catch { hasIcon = false; }
      }
      if (e.icon && !hasIcon) e.icon.setVisible(false);
      e.glyph.setText(hasIcon ? '' : m.glyph);
      e.secs.setText(m.left > 0 ? String(Math.ceil(m.left / 1000)) : '');
    }
    return models.length;
  }

  function destroy() {
    for (const off of offs) { try { off(); } catch { /* noop */ } }
    offs.length = 0;
    for (const o of made) { try { o?.destroy?.(); } catch { /* noop */ } }
    made.length = 0;
    track.length = 0;
    strip.length = 0;
  }

  return { ready: true, update, destroy, slotCount: track.length, statusCount: strip.length, hpWarn, mpWarn };
}
