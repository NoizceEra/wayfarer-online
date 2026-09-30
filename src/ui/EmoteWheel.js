import { bus, Events } from '../core/events.js';
import { social } from '../systems/social/index.js';
import { EMOTES, emoteCanvas } from '../systems/social/emotes.js';
import { socialRoot, el } from './socialDom.js';

// Radial emote wheel (G). Seven pixel-art emotes around the screen centre;
// click one (or press its number while the wheel is open) to play it locally
// and broadcast it to the room. Closes on pick, G again, Esc or clicking away.
export class EmoteWheel {
  constructor(scene) {
    this.scene = scene;
    this.root = socialRoot();
    this.open = false;
    this.shade = el('div', 'wf-shade'); this.shade.style.display = 'none';
    this.shade.addEventListener('pointerdown', () => this.setOpen(false));
    this.wheel = el('div', 'wf-wheel'); this.wheel.style.display = 'none';
    const R = 96;
    EMOTES.forEach((e, i) => {
      const a = -Math.PI / 2 + (i / EMOTES.length) * Math.PI * 2;
      const b = el('div', 'wf-em');
      b.style.left = `${Math.round(Math.cos(a) * R)}px`; b.style.top = `${Math.round(Math.sin(a) * R)}px`;
      b.appendChild(emoteCanvas(e.id, 2));
      b.appendChild(el('span', '', e.label));
      b.appendChild(el('span', 'k', e.key));
      b.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.pick(e.id); });
      this.wheel.appendChild(b);
    });
    this.wheel.appendChild(el('div', 'wf-center', 'EMOTE<br><span style="color:#8a7a60;font-size:8px">G / Esc close</span>'));
    this.root.append(this.shade, this.wheel);
    this.offAct = social.registerAction('openEmotes', () => this.setOpen(!this.open));
    this.onKey = (e) => {
      if (!this.open || e.target?.tagName === 'INPUT') return;
      const em = EMOTES.find((x) => x.key === e.key);
      if (em) { e.preventDefault(); e.stopPropagation(); this.pick(em.id); }
    };
    window.addEventListener('keydown', this.onKey, true);
  }
  pick(id) { this.setOpen(false); social.emote(id); }
  setOpen(v) {
    if (v === this.open) return;
    this.open = v;
    this.shade.style.display = v ? '' : 'none';
    this.wheel.style.display = v ? '' : 'none';
    bus.emit(Events.SOCIAL_UI, { panel: 'emotes', open: v });
  }
  destroy() { this.offAct(); window.removeEventListener('keydown', this.onKey, true); this.shade.remove(); this.wheel.remove(); }
}
