// Toast stack: achievements, quest accepted/complete, recipe learned, lore unlocked, arena results.
// DOM-based so toasts are ALWAYS above every canvas and DOM panel (z-index 90, see ui/theme.js), sit
// inside the safe area, wrap long text, and are announced to screen readers (aria-live).
// Same API as the old canvas Toaster: push({title, text, sub, color, badge}) / destroy().
import { calmMotion } from './theme.js';

const MAX_VISIBLE = 3;
const LIFE_MS = 2800;

function host() {
  let h = document.getElementById('wf-toasts');
  if (!h) {
    h = document.createElement('div');
    h.id = 'wf-toasts';
    h.setAttribute('role', 'status');
    h.setAttribute('aria-live', 'polite');
    document.body.appendChild(h);
  }
  return h;
}

export class Toaster {
  constructor(scene) {
    this.scene = scene;
    this.live = new Set();
  }
  push(t) {
    if (!t) return;
    const h = host();
    const el = document.createElement('div');
    el.className = `wf-t${t.badge ? ' wf-badge' : ''}`;
    const a = document.createElement('span'); a.className = 'a';
    // glyph + word, never colour alone: badge toasts get a star
    a.textContent = `${t.badge ? '★ ' : ''}${String(t.title || '')}`;
    if (t.color) a.style.color = t.color;
    const b = document.createElement('span'); b.className = 'b'; b.textContent = String(t.text || '');
    el.append(a, b);
    if (t.sub) { const c = document.createElement('span'); c.className = 'c'; c.textContent = String(t.sub); el.append(c); }
    if (calmMotion()) el.style.animation = 'none';
    h.appendChild(el);
    this.live.add(el);
    while (this.live.size > MAX_VISIBLE) this.drop(this.live.values().next().value, true);
    setTimeout(() => this.drop(el), LIFE_MS);
  }
  drop(el, now = false) {
    if (!el || !this.live.has(el)) return;
    this.live.delete(el);
    if (now || calmMotion()) { el.remove(); return; }
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }
  destroy() { for (const el of [...this.live]) this.drop(el, true); }
}
