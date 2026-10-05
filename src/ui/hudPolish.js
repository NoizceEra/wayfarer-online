// hudPolish.js — ADDITIVE HUD/UX polish helpers.
//
// This module is intentionally dependency-free (no imports from existing UI
// files) so the parent can wire it in later without touching UIScene.js,
// econDom.js, socialDom.js or core/input.js. Every helper is a graceful
// no-op when its target elements / scene / input manager are absent
// (SSR, tests, HUD elements not yet built).
//
// Style tokens (Solana palette + pixel fonts):
//   bg #0A0E1A, bgLight #1A103C, green #14F195, purple #9945FF,
//   cyan #03E1FF, magenta #DC1FFF, white #E1E8F0, muted #6B7A99.
//   Fonts: Jacquard12 (display), Silkscreen (labels/buttons),
//   PixelifySans (body).

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
