import { bus, Events } from '../core/events.js';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { socialRoot, el } from './socialDom.js';

// First-run tour: teaches by PLAYING. It never says "click Next" — every step
// ticks itself off when the real action happens, detected from the event bus
// (attack / talk / kill / gather / journal) or by watching the live world
// state (walking, equipping, taking a quest). Dismissible at any time; the
// "already onboarded" flag lives in the hero's save (progress ext.onboarded,
// see src/core/save.js) so it never shows twice. Reopen it from Help (H).
//
// Deliberately DOM (same overlay scaffolding as the social panels): text,
// buttons and viewport fitting come for free, it never swallows gameplay keys,
// and clicks on the card cannot reach the world (no stray swings). No motion
// is used at all, so Reduce motion is inherently respected.
//
// Mounted from WorldScene.create() and stepped from WorldScene.update().

const STEPS = [
  { id: 'move', title: 'Walk around', hint: 'Move with the keys shown (or the touch stick).' },
  { id: 'talk', title: 'Say hello to someone', hint: 'Walk up to a townsperson and press the interact key.' },
  { id: 'attack', title: 'Swing at a slime', hint: 'Attack with the key shown, or click/tap the monster.' },
  { id: 'equip', title: 'Wear something you find', hint: 'Open your bag and equip a piece of gear you picked up.' },
  { id: 'quest', title: 'Take a quest', hint: 'Talk to the townsperson with a ! overhead and accept.' },
  { id: 'gather', title: 'Gather something', hint: 'Press the interact key at herbs, ore, logs or a fishing ripple.' },
  { id: 'journal', title: 'Open your journal', hint: 'Press the journal key to see quests, lore and your bestiary.' },
];

let CSS_DONE = false;
function injectCss() {
  if (CSS_DONE) return;
  CSS_DONE = true;
  const s = el('style');
  s.textContent = `
#wf-social .wf-ob{pointer-events:auto;position:absolute;left:50%;top:44px;transform:translateX(-50%);width:min(420px,calc(100vw - 16px));max-height:min(62vh,430px);overflow-y:auto;background:rgba(26,16,8,.95);border:2px solid #8a5a2b;box-shadow:inset 0 0 0 1px #3a2410,0 0 0 1px #1a1024;padding-bottom:6px}
#wf-social .wf-ob-h{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid #3a2410;color:#ffe8a0;font-weight:bold;font-size:11px}
#wf-social .wf-ob-h .wf-ob-x{margin-left:auto;min-height:0;padding:1px 7px}
#wf-social .wf-ob-sub{padding:4px 9px 0;color:#b8a888;font-size:9px;line-height:1.35}
#wf-social .wf-ob-step{display:flex;align-items:center;gap:6px;padding:2px 9px;font-size:9px;color:#b9b39a;line-height:1.4}
#wf-social .wf-ob-step .b{width:16px;color:#8a7a60;flex:none}
#wf-social .wf-ob-step .t{flex:1}
#wf-social .wf-ob-step .k{color:#ffd84a;font-size:8px;white-space:nowrap;flex:none}
#wf-social .wf-ob-step.done{color:#9be88a}
#wf-social .wf-ob-step.done .b{color:#9be88a}
#wf-social .wf-ob-step.cur{color:#fff6c8;font-weight:bold;background:rgba(255,216,74,.10)}
#wf-social .wf-ob-hint{margin:4px 8px 0;padding:4px 6px;background:rgba(155,188,15,.14);border-left:2px solid #9bbc0f;color:#eaf7b0;font-size:9px;line-height:1.4}
#wf-social .wf-ob-f{display:flex;align-items:center;gap:6px;padding:5px 8px 0;color:#8a7a60;font-size:8px}
#wf-social .wf-ob-f button{margin-left:auto;min-height:24px}
@media (max-width:640px),(max-height:520px){#wf-social .wf-ob{top:50%;transform:translate(-50%,-50%);max-width:min(420px,max(300px,calc(100vw - 500px)))}}
`;
  document.head.appendChild(s);
}

export class OnboardingPanel {
  // fresh: true only for a hero with no saved progress yet (never nags a returning player).
  constructor(world, { fresh = false } = {}) {
    this.world = world;
    this.acc = 0;
    this.done = {};
    this.closed = false;
    this.hidden = false;
    this.card = null;
    this.root = socialRoot();
    const p = world.player;
    this.sx = p?.x || 0; this.sy = p?.y || 0;
    this.eq0 = JSON.stringify(p?.equipped || {});
    this.visible = !!fresh && !world.meta?.onboarded;

    this.teardown = [world.events.once('shutdown', () => this.destroy())];
    // The bus subscriptions exist even when the tour is not shown, so Help (H) >
    // "How to play" can replay it later for a returning hero.
    this.teardown.push(
      bus.on(Events.ONBOARD, (m) => { if (m?.act) this.mark(m.act); else if (m?.open) this.reopen(); }),
      bus.on(Events.KILL, () => this.mark('attack')),
      bus.on(Events.ACH_EVENT, (m) => { if (m?.k === 'gather') this.mark('gather'); }),
      bus.on(Events.JOURNAL, () => this.mark('journal')),
      bus.on(Events.QUEST_CHANGED, () => { if ((this.world.quests?.activeIds?.().length || 0) > 0) this.mark('quest'); }),
      input.onChange(() => { if (!this.closed) this.render(); }),
    );
    if (!this.visible) return; // returning hero / already done: no DOM until Help replays it
    this.build();
  }
  get isOpen() { return !!this.card && !this.closed; }

  // ── detection ────────────────────────────────────────────────────────────
  update(dt) {
    if (!this.card || this.closed) return;
    this.acc += dt;
    if (this.acc < 0.15) return; // 6-7 Hz state poll is plenty
    this.acc = 0;
    const w = this.world, p = w?.player;
    if (!p) return;
    // never sit on top of a menu / the chat input
    const hide = !!input.modal || !!w.chatOpen;
    if (hide !== this.hidden) { this.hidden = hide; this.render(); }
    if (!this.done.move && Math.hypot(p.x - this.sx, p.y - this.sy) > 40) this.mark('move');
    if (!this.done.equip && JSON.stringify(p.equipped || {}) !== this.eq0) this.mark('equip');
    if (!this.done.quest && (w.quests?.activeIds?.().length || 0) > 0) this.mark('quest');
  }
  mark(id) {
    if (!this.card || this.closed || this.done[id] || !STEPS.some((s) => s.id === id)) return;
    this.done[id] = 1;
    this.render();
    if (STEPS.every((s) => this.done[s.id])) this.finish();
  }

  // ── view ─────────────────────────────────────────────────────────────────
  build() {
    injectCss();
    const c = this.card = el('div', 'wf-ob');
    const h = el('div', 'wf-ob-h', '<span>HOW TO PLAY</span>');
    const x = el('button', 'wf-ob-x', 'x');
    x.title = 'Hide the tour';
    x.addEventListener('click', () => this.skip());
    h.appendChild(x);
    c.appendChild(h);
    c.appendChild(el('div', 'wf-ob-sub', 'Do each thing below — it ticks off by itself.'));
    this.stepEls = {};
    for (const s of STEPS) {
      const r = el('div', 'wf-ob-step');
      const b = el('span', 'b', '[ ]');
      const t = el('span', 't', s.title);
      const k = el('span', 'k', '');
      r.append(b, t, k);
      c.appendChild(r);
      this.stepEls[s.id] = { r, b, k };
    }
    this.hint = el('div', 'wf-ob-hint', '');
    c.appendChild(this.hint);
    const f = el('div', 'wf-ob-f');
    f.appendChild(el('span', '', 'Reopen any time: Help (H)'));
    const sk = el('button', '', 'Skip the tour');
    sk.addEventListener('click', () => this.skip());
    f.appendChild(sk);
    c.appendChild(f);
    this.root.appendChild(c);
    this.render();
  }
  render() {
    if (!this.card) return;
    const cur = STEPS.find((s) => !this.done[s.id]);
    for (const s of STEPS) {
      const e = this.stepEls[s.id];
      const isCur = !!cur && cur.id === s.id && !this.closed;
      e.r.className = `wf-ob-step${this.done[s.id] ? ' done' : isCur ? ' cur' : ''}`;
      e.b.textContent = this.done[s.id] ? '[x]' : isCur ? '>' : '[ ]';
      e.k.textContent = this.keyLabel(s);
    }
    this.hint.innerHTML = cur
      ? `&gt; <b>${cur.title}</b> — ${cur.hint}`
      : 'All done — welcome to Embervale!';
    this.card.style.display = this.hidden ? 'none' : '';
  }
  // Real, rebindable key labels (never a hard-coded letter).
  keyLabel(s) {
    if (s.id === 'move') return ['moveUp', 'moveLeft', 'moveDown', 'moveRight'].map((a) => input.labelFor(a)).join('');
    if (s.id === 'attack') return input.labelFor('attack');
    if (s.id === 'equip') return input.labelFor('bag');
    if (s.id === 'journal') return input.labelFor('journal');
    if (s.id === 'quest') return '!';
    return input.labelFor('interact'); // talk / gather
  }

  // ── life cycle ───────────────────────────────────────────────────────────
  finish() {
    bus.emit(Events.SYSTEM, 'Tour complete — you can reopen it any time with Help (H).');
    this.persist();
    if (settings.get('reduceMotion')) { this.close(); return; }
    this.timer = setTimeout(() => this.close(), 2400);
  }
  skip() {
    this.persist();
    bus.emit(Events.SYSTEM, 'Tour hidden — reopen it any time from Help (H).');
    this.close();
  }
  // The only thing that leaves a trace: one flag in this hero's save record.
  persist() {
    try { this.world.meta.onboarded = 1; this.world.saveNow?.(); } catch { /* world torn down */ }
  }
  close() { this.closed = true; clearTimeout(this.timer); this.card?.remove(); }
  // Help (H) > "How to play" -> replay the tour from the top.
  reopen() {
    if (!this.card) this.build();
    else if (!this.card.isConnected) this.root.appendChild(this.card);
    this.done = {}; this.closed = false; this.hidden = false;
    this.sx = this.world.player?.x ?? this.sx; this.sy = this.world.player?.y ?? this.sy;
    this.eq0 = JSON.stringify(this.world.player?.equipped || {});
    this.render();
    bus.emit(Events.SYSTEM, 'How to play: do each thing below and it ticks off.');
  }
  destroy() {
    clearTimeout(this.timer);
    for (const off of this.teardown || []) { try { off?.(); } catch { /* ignore */ } }
    this.teardown = [];
    this.card?.remove();
    this.card = null;
    this.closed = true;
  }
}
