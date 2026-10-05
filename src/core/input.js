// Central input manager: ONE window-level keyboard listener + gamepad polling
// for every gameplay / panel hotkey. Scenes subscribe to named ACTIONS instead
// of Phaser `keydown-*` events, so bindings are rebindable, layout-safe and
// never stick.
//
//   import { input } from '../core/input.js';
//   input.on('attack', () => this.attack(), { scene: this });  // auto-off on shutdown
//   input.isDown('moveLeft'); input.axis();                    // held state / analog move
//   input.registerAction({ id: 'journal', label: 'Quest journal', group: 'Panels', keys: ['KeyL'] });
//   input.addCloser({ id: 'myPanel', priority: 480, isOpen: () => open, close: () => hide(), scene: this });
//
// Key matching (per keydown): event.code first (physical key: WASD stays WASD
// on AZERTY/Dvorak, Shift-held digits still read as digits, caps lock is
// irrelevant), then numpad aliases (Numpad1 -> Digit1, NumpadAdd -> Equal),
// then a token derived from event.key / keyCode (virtual keyboards and old
// browsers that report an empty `code`). The first candidate that has any
// binding wins, so a key never fires two unrelated actions.
//
// Esc ('menu') closes the topmost open panel registered with addCloser()
// before anything else; only when nothing is open does it reach the handlers
// (UIScene opens the pause menu).

const LS_BINDS = 'wayfarer.keybinds.v1';
const MAX_KEYS = 3;
const RESERVED = new Set(['Escape']); // always opens/closes menus; cannot be rebound away

// Default action table (append-only ids; other modules may registerAction()).
// gameplay: blocked while a modal (pause menu / help / rebind) is up.
// repeat: fires again on OS key-repeat (held key).
// hold: continuous (read via isDown/axis) rather than a press event.
export const DEFAULT_ACTIONS = [
  { id: 'moveUp', label: 'Move up', group: 'Movement', keys: ['KeyW', 'ArrowUp'], hold: true, gameplay: true },
  { id: 'moveDown', label: 'Move down', group: 'Movement', keys: ['KeyS', 'ArrowDown'], hold: true, gameplay: true },
  { id: 'moveLeft', label: 'Move left', group: 'Movement', keys: ['KeyA', 'ArrowLeft'], hold: true, gameplay: true },
  { id: 'moveRight', label: 'Move right', group: 'Movement', keys: ['KeyD', 'ArrowRight'], hold: true, gameplay: true },
  { id: 'attack', label: 'Attack', group: 'Combat', keys: ['KeyJ'], gameplay: true },
  { id: 'skill1', label: 'Skill 1', group: 'Combat', keys: ['Digit1'], gameplay: true },
  { id: 'skill2', label: 'Skill 2', group: 'Combat', keys: ['Digit2'], gameplay: true },
  { id: 'skill3', label: 'Skill 3', group: 'Combat', keys: ['Digit3'], gameplay: true },
  { id: 'skill4', label: 'Skill 4', group: 'Combat', keys: ['Digit4'], gameplay: true },
  { id: 'skill5', label: 'Skill 5 (class)', group: 'Combat', keys: ['Digit5'], gameplay: true },
  { id: 'skill6', label: 'Skill 6 (class)', group: 'Combat', keys: ['Digit6'], gameplay: true },
  { id: 'potion', label: 'Drink potion', group: 'Combat', keys: ['KeyQ'], gameplay: true },
  { id: 'interact', label: 'Talk / use', group: 'World', keys: ['KeyE'], gameplay: true },
  { id: 'confirm', label: 'Confirm dialog', group: 'World', keys: ['Space'], gameplay: true },
  { id: 'close', label: 'Close map / dialog', group: 'World', keys: ['KeyX'], gameplay: true },
  { id: 'bag', label: 'Bag / equipment', group: 'Panels', keys: ['KeyI', 'KeyB'], gameplay: true },
  { id: 'character', label: 'Character', group: 'Panels', keys: ['KeyC'], gameplay: true },
  { id: 'skills', label: 'Skills', group: 'Panels', keys: ['KeyK'], gameplay: true },
  { id: 'worldMap', label: 'World map', group: 'Panels', keys: ['KeyN'], gameplay: true },
  { id: 'minimap', label: 'Minimap size', group: 'Panels', keys: ['KeyM'], gameplay: true },
  { id: 'chat', label: 'Chat', group: 'Panels', keys: ['Enter'], gameplay: true },
  { id: 'help', label: 'Help / hotkeys', group: 'System', keys: ['KeyH', 'F1'] },
  { id: 'menu', label: 'Close / pause menu', group: 'System', keys: ['Escape'] },
  { id: 'mute', label: 'Mute sound', group: 'System', keys: [] },
  { id: 'zoomIn', label: 'Zoom in', group: 'System', keys: ['Equal', 'NumpadAdd'], repeat: true, gameplay: true },
  { id: 'zoomOut', label: 'Zoom out', group: 'System', keys: ['Minus', 'NumpadSubtract'], repeat: true, gameplay: true },
  { id: 'zoomReset', label: 'Zoom: auto fit', group: 'System', keys: ['Digit0', 'Numpad0'], gameplay: true },
];

// Gamepad (standard mapping) -> action. 'back' = close topmost panel.
export const PAD_MAP = {
  0: 'attack', 1: 'back', 2: 'interact', 3: 'potion',
  4: 'skill1', 5: 'skill2', 6: 'skill3', 7: 'skill4',
  8: 'bag', 9: 'menu', 10: 'skill5', 11: 'skill6',
};
export const PAD_LABELS = {
  attack: 'A', back: 'B', interact: 'X', potion: 'Y', skill1: 'LB', skill2: 'RB', skill3: 'LT', skill4: 'RT',
  skill5: 'L3', skill6: 'R3', bag: 'SELECT', menu: 'START',
};

// Keys whose browser default (scroll, focus-move, quick-find, help) we stop
// while the game has focus, even when unbound.
const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Slash', 'Quote', 'F1']);

const CODE_ALIASES = {
  Numpad0: 'Digit0', Numpad1: 'Digit1', Numpad2: 'Digit2', Numpad3: 'Digit3', Numpad4: 'Digit4',
  Numpad5: 'Digit5', Numpad6: 'Digit6', Numpad7: 'Digit7', Numpad8: 'Digit8', Numpad9: 'Digit9',
  NumpadEnter: 'Enter', NumpadAdd: 'Equal', NumpadSubtract: 'Minus', NumpadDecimal: 'Period', NumpadDivide: 'Slash',
  IntlBackslash: 'Backslash',
};
const KEY_ALIASES = {
  ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  ArrowUp: 'ArrowUp', Up: 'ArrowUp', ArrowDown: 'ArrowDown', Down: 'ArrowDown', ArrowLeft: 'ArrowLeft', Left: 'ArrowLeft',
  ArrowRight: 'ArrowRight', Right: 'ArrowRight', Delete: 'Delete', Del: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
  '-': 'Minus', _: 'Minus', '=': 'Equal', '+': 'Equal', '/': 'Slash', '?': 'Slash', ',': 'Comma', '<': 'Comma',
  '.': 'Period', '>': 'Period', ';': 'Semicolon', ':': 'Semicolon', "'": 'Quote', '"': 'Quote',
  '[': 'BracketLeft', '{': 'BracketLeft', ']': 'BracketRight', '}': 'BracketRight', '\\': 'Backslash', '|': 'Backslash',
  '`': 'Backquote', '~': 'Backquote',
};
const SHIFT_DIGITS = { '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' };
const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'CapsLock']);

export function keyToken(key) {
  if (!key || key === 'Unidentified' || key === 'Dead' || key === 'Process') return null;
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/[0-9]/.test(key)) return `Digit${key}`;
    if (KEY_ALIASES[key]) return KEY_ALIASES[key];
    if (SHIFT_DIGITS[key]) return `Digit${SHIFT_DIGITS[key]}`;
    return null;
  }
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  return KEY_ALIASES[key] || null;
}
function keyCodeToken(kc) {
  if (!kc) return null;
  if (kc >= 65 && kc <= 90) return `Key${String.fromCharCode(kc)}`;
  if (kc >= 48 && kc <= 57) return `Digit${kc - 48}`;
  if (kc >= 96 && kc <= 105) return `Digit${kc - 96}`;
  if (kc >= 112 && kc <= 123) return `F${kc - 111}`;
  return ({ 13: 'Enter', 27: 'Escape', 32: 'Space', 9: 'Tab', 8: 'Backspace', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 189: 'Minus', 173: 'Minus', 109: 'Minus', 187: 'Equal', 61: 'Equal', 107: 'Equal' })[kc] || null;
}

// Candidate tokens for an event, most specific first.
export function tokensFor(e) {
  const out = [];
  const push = (t) => { if (t && !out.includes(t)) out.push(t); };
  const code = e.code || '';
  if (code && code !== 'Unidentified') { push(code); push(CODE_ALIASES[code]); }
  push(keyToken(e.key));
  push(keyCodeToken(e.keyCode || e.which));
  return out;
}

const PRETTY = {
  Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP', Delete: 'DEL',
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Minus: '-', Equal: '=', Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', NumpadAdd: 'NUM+', NumpadSubtract: 'NUM-',
  NumpadEnter: 'NUM ENTER', NumpadMultiply: 'NUM*', NumpadDivide: 'NUM/', NumpadDecimal: 'NUM.',
  PageUp: 'PGUP', PageDown: 'PGDN', Home: 'HOME', End: 'END', Insert: 'INS',
};

export function isTypingTarget(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(t);
  }
  return !!el.isContentEditable;
}

class InputManager {
  constructor() {
    this.actions = new Map();          // id -> def {id,label,group,keys,defaults,hold,repeat,gameplay}
    this.handlers = new Map();         // id -> [{fn, priority, seq}]
    this.closers = [];                 // [{id, priority, isOpen, close}]
    this.byToken = new Map();          // token -> [actionId]
    this.held = new Map();             // physical key -> Set(actionId)
    this.modals = new Set();           // ids of active modal layers (pause/help/rebind)
    this.listeners = new Set();        // change listeners (bindings/labels)
    this.capture = null;               // rebind: next key goes here
    this.nav = null;                   // menu navigation provider {move(d), adjust(d), activate(), back()}
    this.layoutMap = null;             // navigator.keyboard layout labels (Chromium)
    this.enabled = true;
    this.seq = 0;
    this.pad = { prev: [], axis: { x: 0, y: 0 }, navT: 0, navDir: 0, id: null };
    this.lastSource = 'keyboard';
    for (const a of DEFAULT_ACTIONS) this.registerAction(a, { silent: true });
    this.loadBindings();
  }

  // ── registry ─────────────────────────────────────────────────────────────
  registerAction(def, { silent = false } = {}) {
    if (!def?.id) return () => {};
    const prev = this.actions.get(def.id);
    const keys = (def.keys || []).filter((k) => typeof k === 'string').slice(0, MAX_KEYS);
    const a = {
      group: 'Other', label: def.id, hold: false, repeat: false, gameplay: false,
      ...prev, ...def,
      defaults: [...keys],
      keys: prev?.custom ? prev.keys : [...keys],
      custom: prev?.custom || false,
    };
    this.actions.set(a.id, a);
    if (!prev && this.saved?.[a.id]) this.applySaved(a, this.saved[a.id]);
    this.reindex();
    if (!silent) this.changed();
    return () => { this.actions.delete(a.id); this.reindex(); this.changed(); };
  }

  // Subscribe to an action. Returns off(). With {scene}, auto-removed on scene shutdown.
  // A handler returning true consumes the press (lower-priority handlers skip it).
  on(id, fn, { scene = null, priority = 0 } = {}) {
    if (!this.handlers.has(id)) this.handlers.set(id, []);
    const h = { fn, priority, seq: this.seq++ };
    const list = this.handlers.get(id);
    list.push(h);
    list.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    const off = () => { const l = this.handlers.get(id); const i = l ? l.indexOf(h) : -1; if (i >= 0) l.splice(i, 1); };
    if (scene) scene.events.once('shutdown', off);
    return off;
  }

  // Esc/B-button close stack. Highest priority open panel closes first.
  addCloser({ id, priority = 0, isOpen, close, scene = null }) {
    const c = { id, priority, isOpen, close };
    this.closers = this.closers.filter((x) => x.id !== id);
    this.closers.push(c);
    this.closers.sort((a, b) => b.priority - a.priority);
    const off = () => { this.closers = this.closers.filter((x) => x !== c); };
    if (scene) scene.events.once('shutdown', off);
    return off;
  }
  closeTopmost() {
    for (const c of this.closers) {
      let open = false;
      try { open = !!c.isOpen(); } catch { open = false; }
      if (open) { try { c.close(); } catch (e) { console.error(e); } return c.id; }
    }
    return null;
  }
  anyOpen() { return this.closers.some((c) => { try { return !!c.isOpen(); } catch { return false; } }); }

  pushModal(id) { this.modals.add(id); this.clearHeld(); }
  popModal(id) { this.modals.delete(id); }
  get modal() { return this.modals.size > 0; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { this.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

  reindex() {
    this.byToken.clear();
    for (const a of this.actions.values()) {
      for (const k of a.keys) {
        if (!this.byToken.has(k)) this.byToken.set(k, []);
        this.byToken.get(k).push(a.id);
      }
    }
  }
  match(tokens) {
    for (const t of tokens) {
      const ids = this.byToken.get(t);
      if (ids && ids.length) return { token: t, ids };
    }
    return { token: tokens[0] || null, ids: [] };
  }

  // ── bindings persistence ─────────────────────────────────────────────────
  loadBindings() {
    this.saved = {};
    try {
      const raw = JSON.parse(window.localStorage.getItem(LS_BINDS) || '{}');
      if (raw && typeof raw === 'object') this.saved = raw;
    } catch { this.saved = {}; }
    for (const a of this.actions.values()) if (this.saved[a.id]) this.applySaved(a, this.saved[a.id]);
    this.reindex();
  }
  applySaved(a, keys) {
    if (!Array.isArray(keys)) return;
    const clean = keys.filter((k) => typeof k === 'string' && k.length < 32).slice(0, MAX_KEYS);
    if (a.id === 'menu' && !clean.includes('Escape')) clean.unshift('Escape');
    if (a.id !== 'menu') for (const r of RESERVED) { const i = clean.indexOf(r); if (i >= 0) clean.splice(i, 1); }
    a.keys = clean; a.custom = true;
  }
  saveBindings() {
    const out = {};
    for (const a of this.actions.values()) if (a.custom) out[a.id] = a.keys;
    this.saved = out;
    try { window.localStorage.setItem(LS_BINDS, JSON.stringify(out)); } catch { /* storage blocked */ }
  }
  // Put `token` in slot `slot` of action `id`; steals it from any other action.
  // Returns { ok, stolenFrom: [labels], reason }.
  bind(id, slot, token) {
    const a = this.actions.get(id);
    if (!a || !token) return { ok: false, reason: 'unknown' };
    if (RESERVED.has(token) && id !== 'menu') return { ok: false, reason: `${this.tokenLabel(token)} is reserved for menus` };
    if (MODIFIER_CODES.has(token)) return { ok: false, reason: 'Modifier keys cannot be bound' };
    const stolenFrom = [];
    for (const o of this.actions.values()) {
      if (o === a) continue;
      const i = o.keys.indexOf(token);
      if (i >= 0) { o.keys.splice(i, 1); o.custom = true; stolenFrom.push(o.label); }
    }
    const keys = a.keys.filter((k) => k !== token);
    if (slot < keys.length) keys[slot] = token; else keys.push(token);
    a.keys = keys.slice(0, MAX_KEYS);
    if (id === 'menu' && !a.keys.includes('Escape')) a.keys.unshift('Escape');
    a.custom = true;
    this.reindex(); this.saveBindings(); this.clearHeld(); this.changed();
    return { ok: true, stolenFrom };
  }
  unbind(id, slot) {
    const a = this.actions.get(id);
    if (!a || !a.keys[slot]) return;
    if (id === 'menu' && a.keys[slot] === 'Escape') return;
    a.keys.splice(slot, 1); a.custom = true;
    this.reindex(); this.saveBindings(); this.changed();
  }
  resetBindings() {
    for (const a of this.actions.values()) { a.keys = [...a.defaults]; a.custom = false; }
    this.saved = {};
    try { window.localStorage.removeItem(LS_BINDS); } catch { /* ignore */ }
    this.reindex(); this.clearHeld(); this.changed();
  }
  captureNext(cb) { this.capture = cb; this.clearHeld(); }
  cancelCapture() { this.capture = null; }

  // ── labels ───────────────────────────────────────────────────────────────
  tokenLabel(t) {
    if (!t) return '';
    const lm = this.layoutMap?.get?.(t);
    if (lm && lm.length === 1 && /^(Key|Digit)/.test(t)) return lm.toUpperCase();
    if (t.startsWith('Key')) return t.slice(3);
    if (t.startsWith('Digit')) return t.slice(5);
    if (t.startsWith('Numpad') && /\d$/.test(t)) return `NUM${t.slice(6)}`;
    return PRETTY[t] || t;
  }
  keysFor(id) { return this.actions.get(id)?.keys || []; }
  labelFor(id, max = 1) { return this.keysFor(id).slice(0, max).map((k) => this.tokenLabel(k)).join('/') || '--'; }
  list() { return [...this.actions.values()]; }

  // ── held state ───────────────────────────────────────────────────────────
  isDown(id) {
    const a = this.actions.get(id);
    if (a?.gameplay && this.modal) return false;
    for (const s of this.held.values()) if (s.has(id)) return true;
    return false;
  }
  // Movement vector from keys + gamepad stick/d-pad, length <= 1.
  axis() {
    if (this.modal) return { x: 0, y: 0 };
    let x = (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0);
    let y = (this.isDown('moveDown') ? 1 : 0) - (this.isDown('moveUp') ? 1 : 0);
    x += this.pad.axis.x; y += this.pad.axis.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }
  clearHeld() { this.held.clear(); }

  // ── dispatch ─────────────────────────────────────────────────────────────
  fire(id, meta = {}) {
    const a = this.actions.get(id);
    if (!a || !this.enabled) return false;
    if (id === 'menu' && !meta.skipClosers) {
      if (this.closeTopmost()) return true;
    }
    if (a.gameplay && this.modal && !meta.force) return false;
    const list = [...(this.handlers.get(id) || [])];
    for (const h of list) {
      let r;
      try { r = h.fn(meta); } catch (e) { console.error(e); }
      if (r === true) return true;
    }
    return list.length > 0;
  }

  gameHasFocus() {
    const el = document.activeElement;
    return !isTypingTarget(el) && (typeof document.hasFocus !== 'function' || document.hasFocus());
  }

  onKeyDown(e) {
    if (!this.enabled) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return; // chat / DOM inputs own the keyboard
    const tokens = tokensFor(e);
    if (!tokens.length) return;
    this.lastSource = 'keyboard';
    if (this.capture) {
      if (MODIFIER_CODES.has(tokens[0])) return;
      e.preventDefault(); e.stopPropagation();
      const cb = this.capture; this.capture = null;
      cb(tokens[0], e);
      return;
    }
    const mod = e.ctrlKey || e.metaKey || (e.altKey && !e.getModifierState?.('AltGraph'));
    if (mod) return; // browser shortcuts (Ctrl+R, Cmd+W, Alt+Tab...) pass straight through
    const phys = e.code || `k:${tokens[0]}`;
    const wasHeld = this.held.has(phys);
    const { token, ids } = this.match(tokens);
    this.held.set(phys, new Set(ids));
    // menu navigation (pause menu / settings) with arrows/WASD/Enter/Space
    if (this.nav && !e.repeat) {
      const navKey = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 }[tokens[0]] ?? { ArrowUp: -1, ArrowDown: 1 }[token];
      const adj = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[tokens[0]];
      if (navKey) { e.preventDefault(); this.nav.move?.(navKey); return; }
      if (adj) { e.preventDefault(); this.nav.adjust?.(adj); return; }
      if (tokens[0] === 'Enter' || tokens[0] === 'Space' || tokens[0] === 'NumpadEnter') { e.preventDefault(); this.nav.activate?.(); return; }
    }
    if ((ids.length || PREVENT.has(token) || PREVENT.has(tokens[0])) && this.gameHasFocus()) e.preventDefault();
    const repeat = e.repeat || wasHeld;
    for (const id of ids) {
      const a = this.actions.get(id);
      if (!a || a.hold) continue;
      if (repeat && !a.repeat) continue;
      this.fire(id, { source: 'keyboard', event: e, token });
    }
  }
  onKeyUp(e) {
    const tokens = tokensFor(e);
    const phys = e.code || `k:${tokens[0]}`;
    this.held.delete(phys);
    // macOS: while Cmd is held other keys never send keyup -> release everything
    if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') this.clearHeld();
  }

  // ── gamepad ──────────────────────────────────────────────────────────────
  pollPad(now) {
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads || []) if (p && p.connected) { gp = p; break; }
    if (!gp) { this.pad.axis = { x: 0, y: 0 }; this.pad.prev = []; return; }
    const pressed = gp.buttons.map((b) => (typeof b === 'object' ? b.pressed || b.value > 0.5 : b > 0.5));
    const prev = this.pad.prev;
    const edge = (i) => pressed[i] && !prev[i];
    const dz = (v) => (Math.abs(v) < 0.25 ? 0 : (v - Math.sign(v) * 0.25) / 0.75);
    let ax = dz(gp.axes[0] || 0), ay = dz(gp.axes[1] || 0);
    if (pressed[14]) ax = -1; if (pressed[15]) ax = 1;
    if (pressed[12]) ay = -1; if (pressed[13]) ay = 1;
    if (pressed.some(Boolean) || ax || ay) this.lastSource = 'gamepad';
    if (this.nav || this.capture) {
      this.pad.axis = { x: 0, y: 0 };
      // menu navigation with d-pad / stick (auto-repeat), A = activate, B = back
      const dir = Math.abs(ay) > 0.5 ? Math.sign(ay) : 0;
      const hdir = Math.abs(ax) > 0.5 ? Math.sign(ax) : 0;
      const key = dir ? `v${dir}` : hdir ? `h${hdir}` : '';
      if (key && (key !== this.pad.navKey || now - this.pad.navT > 220)) {
        this.pad.navKey = key; this.pad.navT = now;
        if (this.nav) { if (dir) this.nav.move?.(dir); else this.nav.adjust?.(hdir); }
      } else if (!key) this.pad.navKey = '';
      if (this.nav) {
        if (edge(0)) this.nav.activate?.();
        if (edge(1)) { if (!this.closeTopmost()) this.nav.back?.(); }
        if (edge(9)) this.fire('menu', { source: 'gamepad' });
      }
    } else {
      this.pad.axis = { x: ax, y: ay };
      for (const [i, id] of Object.entries(PAD_MAP)) {
        if (!edge(Number(i))) continue;
        if (id === 'back') this.closeTopmost();
        else this.fire(id, { source: 'gamepad' });
      }
    }
    this.pad.prev = pressed;
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  install(game) {
    if (this.game) return;
    this.game = game;
    const kd = (e) => this.onKeyDown(e);
    const ku = (e) => this.onKeyUp(e);
    // Bubble phase on window, registered AFTER Phaser's KeyboardManager (it
    // boots inside `new Phaser.Game`): Phaser ignores events whose default was
    // already prevented, so preventing earlier would kill any remaining Phaser
    // keyboard hooks (e.g. the creator's Enter).
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku, true);
    const release = () => this.clearHeld();
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    document.addEventListener('contextmenu', release);
    document.addEventListener('focusin', (e) => { if (isTypingTarget(e.target)) release(); });
    const focusGame = () => {
      const c = game.canvas;
      if (!c || isTypingTarget(document.activeElement)) return;
      if (document.activeElement !== c) { try { c.focus({ preventScroll: true }); } catch { /* ignore */ } }
    };
    this.focusGame = focusGame;
    document.addEventListener('visibilitychange', () => { if (document.hidden) release(); else focusGame(); });
    window.addEventListener('focus', focusGame);
    const attachCanvas = () => {
      const c = game.canvas;
      if (!c) return;
      if (!c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0');
      if (!c.hasAttribute('aria-label')) c.setAttribute('aria-label', 'Wayfarer Online game area');
      // Phaser preventDefault()s mousedown/touchstart, which also stops the
      // browser from moving focus (and, inside an iframe like itch.io, from
      // ever focusing the game frame) -> keys went nowhere. Focus explicitly.
      c.addEventListener('pointerdown', () => { try { window.focus(); } catch { /* ignore */ } focusGame(); }, true);
      focusGame();
    };
    if (game.canvas) attachCanvas(); else game.events.once('ready', attachCanvas);
    game.events.on('prestep', (t) => { try { this.pollPad(t); } catch { /* no gamepad API */ } });
    game.events.on('blur', release);
    try {
      navigator.keyboard?.getLayoutMap?.().then((m) => { this.layoutMap = m; this.changed(); }).catch(() => {});
    } catch { /* unsupported */ }
    window.__wayfarerInput = this; // debug / smoke-test handle
  }
}

export const input = new InputManager();

// ── Mobile virtual joystick + action buttons (additive, used by touch HUD) ──
export function isMobile() {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export class MobileInput {
  constructor(scene) {
    this.scene = scene;
    this.vector = { x: 0, y: 0 };
    this.activeActions = new Set();
    this.justPressed = new Set();
    this.onAction = null;
    this.onMove = null;
    this.deadzone = 0.22;
  }

  createJoystick(x, y, radius = 64) {
    this.joystickRadius = radius;
    this.joystickBase = this.scene.add.circle(x, y, radius, 0x161b22, 0.55)
      .setStrokeStyle(2, 0x9945ff, 0.7).setScrollFactor(0).setDepth(1000);
    this.joystickKnob = this.scene.add.circle(x, y, radius * 0.42, 0x14f195, 0.85)
      .setScrollFactor(0).setDepth(1001);
    this.joystickCenter = { x, y };
    this.joystickPointerId = null;
    const zone = this.scene.add.zone(x, y, radius * 3.5, radius * 3.5).setScrollFactor(0).setDepth(999).setInteractive({ draggable: true });
    this.joystickZone = zone;
    zone.on('pointerdown', (pointer) => this.onJoystickStart(pointer));
    this.scene.input.on('pointermove', (pointer) => this.onJoystickMove(pointer));
    this.scene.input.on('pointerup', (pointer) => this.onJoystickEnd(pointer));
  }

  onJoystickStart(pointer) {
    if (this.joystickPointerId !== null) return;
    this.joystickPointerId = pointer.id;
    this.joystickCenter.x = pointer.x;
    this.joystickCenter.y = pointer.y;
    this.joystickBase.setPosition(pointer.x, pointer.y);
    this.joystickKnob.setPosition(pointer.x, pointer.y);
    this.joystickBase.setAlpha(0.85);
    this.joystickKnob.setAlpha(1);
  }

  onJoystickMove(pointer) {
    if (this.joystickPointerId !== pointer.id) return;
    const dx = pointer.x - this.joystickCenter.x;
    const dy = pointer.y - this.joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = this.joystickRadius;
    const clampedDist = Math.min(dist, maxDist);
    const angle = Math.atan2(dy, dx);
    this.joystickKnob.setPosition(this.joystickCenter.x + Math.cos(angle) * clampedDist, this.joystickCenter.y + Math.sin(angle) * clampedDist);
    let nx = 0, ny = 0;
    if (dist > this.deadzone * maxDist) {
      const scale = (clampedDist - this.deadzone * maxDist) / (maxDist * (1 - this.deadzone));
      const clampedScale = Math.max(0, Math.min(1, scale));
      nx = Math.cos(angle) * clampedScale;
      ny = Math.sin(angle) * clampedScale;
    }
    this.vector.x = nx; this.vector.y = ny;
    if (this.onMove) this.onMove(this.vector);
  }

  onJoystickEnd(pointer) {
    if (this.joystickPointerId !== pointer.id) return;
    this.joystickPointerId = null;
    this.vector.x = 0; this.vector.y = 0;
    this.joystickKnob.setPosition(this.joystickBase.x, this.joystickBase.y);
    this.joystickBase.setAlpha(0.55);
    this.joystickKnob.setAlpha(0.6);
    if (this.onMove) this.onMove(this.vector);
  }

  createActionButtons(layout = {}) {
    const { x = 820, y = 520, size = 64, gap = 76 } = layout;
    const buttons = [
      { name: 'attack', label: '⚔', color: 0xff4444, x: x - gap, y: y - gap },
      { name: 'interact', label: '✋', color: 0x14f195, x, y: y - gap * 1.6 },
      { name: 'dodge', label: '↷', color: 0x03e1ff, x, y },
    ];
    this.actionButtons = {};
    for (const cfg of buttons) this.actionButtons[cfg.name] = this.createActionButton(cfg.x, cfg.y, size, cfg.color, cfg.label, cfg.name);
  }

  createActionButton(x, y, size, color, label, actionName) {
    const container = this.scene.add.container(x, y).setScrollFactor(0).setDepth(1002);
    const bg = this.scene.add.circle(0, 0, size / 2, color, 0.75).setStrokeStyle(2, 0xffffff, 0.5);
    const text = this.scene.add.text(0, 0, label, { fontSize: `${Math.floor(size * 0.5)}px`, color: '#ffffff' }).setOrigin(0.5);
    container.add([bg, text]);
    const hit = this.scene.add.zone(0, 0, size * 1.4, size * 1.4).setScrollFactor(0).setDepth(1003).setInteractive();
    container.add(hit);
    hit.on('pointerdown', () => { bg.setFillStyle(color, 0.95); this.activeActions.add(actionName); this.justPressed.add(actionName); if (this.onAction) this.onAction(actionName); });
    hit.on('pointerup', () => { bg.setFillStyle(color, 0.75); this.activeActions.delete(actionName); });
    hit.on('pointerout', () => { bg.setFillStyle(color, 0.75); this.activeActions.delete(actionName); });
    return { container, bg, text, actionName };
  }

  isActionDown(name) { return this.activeActions.has(name); }
  consumeJustPressed(name) { const pressed = this.justPressed.has(name); this.justPressed.delete(name); return pressed; }
  getVector() { return this.vector; }

  destroy() {
    this.joystickBase?.destroy(); this.joystickKnob?.destroy(); this.joystickZone?.destroy();
    for (const key in this.actionButtons) this.actionButtons[key].container.destroy();
  }
}
