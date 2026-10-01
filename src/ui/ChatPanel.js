import { bus, Events } from '../core/events.js';
import { social, CHANNELS, TABS } from '../systems/social/index.js';
import { socialRoot, el, escapeHtml } from './socialDom.js';
import { CONFIG } from '../config.js';

// MMO chat window (DOM overlay, bottom-left): colour-coded channel tabs with
// unread markers, scrollback, optional timestamps, an input row that only
// exists while chat is open (Enter opens, Enter/Esc closes; Tab cycles the
// outgoing channel; Up/Down recalls sent lines). While the input has focus the
// Phaser keyboard is disabled so WASD/J/1-4 never leak into the world.
const ORDER = ['say', 'party', 'world', 'guild', 'whisper'];
const fmtTime = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export class ChatPanel {
  constructor(scene) {
    this.scene = scene;
    this.root = socialRoot();
    this.tab = social.store?.prefs.tab || 'all';
    if (!TABS.some((t) => t.id === this.tab)) this.tab = 'all';
    this.open = false;
    this.sentHist = []; this.histIdx = -1;
    this.unread = new Set();
    this.build();
    this.renderAll();
    this.off = [
      bus.on(Events.SOCIAL_CHAT, (l) => this.addLine(l)),
      bus.on(Events.SOCIAL_UI, (m) => {
        if (m.panel === 'channel') this.syncChan();
        else if (m.panel === 'prefs') this.applyPrefs();
        else if (m.panel === 'clear') this.log.innerHTML = '';
      }),
    ];
    this.offActs = [
      social.registerAction('openChat', (prefill) => this.setOpen(true, prefill)),
      social.registerAction('closeChat', () => this.setOpen(false)),
      social.registerAction('toggleChat', () => this.setOpen(!this.open)),
    ];
    this.onDocDown = (e) => { if (this.open && e.target?.tagName === 'CANVAS') this.setOpen(false); };
    document.addEventListener('pointerdown', this.onDocDown, true);
  }

  build() {
    const p = this.panel = el('div', 'wf-panel wf-chat');
    const tabs = this.tabsEl = el('div', 'wf-tabs');
    this.tabBtns = {};
    for (const t of TABS) {
      const b = el('button', '', t.label);
      b.dataset.tab = t.id;
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
      b.addEventListener('click', () => this.setTab(t.id));
      tabs.appendChild(b); this.tabBtns[t.id] = b;
    }
    const right = el('div', 'wf-right');
    this.tsBtn = el('button', '', 'ts'); this.tsBtn.title = 'Toggle timestamps (/time)';
    this.tsBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.tsBtn.addEventListener('click', () => { social.store.setPref('timestamps', !social.store.prefs.timestamps); this.applyPrefs(); });
    this.fBtn = el('button', '', 'filter'); this.fBtn.title = 'Toggle profanity filter (/filter)';
    this.fBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.fBtn.addEventListener('click', () => { social.store.setPref('filter', !social.store.prefs.filter); this.applyPrefs(); });
    const minB = el('button', '', '–'); minB.title = 'Collapse chat';
    minB.addEventListener('click', () => this.setCollapsed(true));
    right.append(this.tsBtn, this.fBtn, minB);
    tabs.appendChild(right);

    const log = this.log = el('div', 'wf-log wf-scroll');
    log.addEventListener('click', (e) => {
      const n = e.target.closest?.('.n'); if (!n) return;
      social.act('contextMenu', { id: n.dataset.id || null, name: n.dataset.name, x: e.clientX, y: e.clientY });
    });
    const row = el('div', 'wf-inrow');
    this.chanEl = el('span', 'wf-chan', '[Say]');
    this.chanEl.title = 'Click or Tab to change channel';
    this.chanEl.addEventListener('mousedown', (e) => e.preventDefault());
    this.chanEl.addEventListener('click', () => this.cycleChannel());
    const inp = this.input = el('input');
    inp.maxLength = 160; inp.placeholder = 'Say something… (/help)'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.addEventListener('keydown', (e) => this.onKey(e));
    row.append(this.chanEl, inp);
    this.hint = el('div', 'wf-hint', 'Enter: chat · Tab: channel · /help');
    p.append(tabs, log, row, this.hint);

    this.chip = el('button', 'wf-panel wf-chip', 'chat');
    this.chip.title = 'Open chat';
    this.chip.addEventListener('click', () => this.setCollapsed(false));
    this.root.append(p, this.chip);

    const collapsed = social.store?.prefs.collapsed ?? (CONFIG.isMobile || this.scene.scale.width < 560);
    this.setCollapsed(!!collapsed, false);
    this.applyPrefs();
    this.setTab(this.tab, false);
  }

  applyPrefs() {
    const pr = social.store?.prefs || {};
    this.panel.classList.toggle('wf-ts', !!pr.timestamps);
    this.tsBtn.style.color = pr.timestamps ? '#1a1024' : '#6a5a48';
    this.fBtn.style.color = pr.filter !== false ? '#1a1024' : '#6a5a48';
    this.log.querySelectorAll('.t').forEach((t) => { t.style.display = pr.timestamps ? '' : 'none'; });
  }
  setCollapsed(v, save = true) {
    this.collapsed = v;
    this.panel.style.display = v ? 'none' : 'flex';
    this.chip.style.display = v ? '' : 'none';
    if (v && this.open) this.setOpen(false);
    if (save) social.store?.setPref('collapsed', v);
  }
  setTab(id, save = true) {
    this.tab = id;
    for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('wf-on', k === id);
    this.unread.delete(id); this.tabBtns[id]?.classList.remove('wf-new');
    const t = TABS.find((x) => x.id === id);
    if (t && t.chans.length === 1 && CHANNELS[t.chans[0]] && t.chans[0] !== 'system') { social.channel = t.chans[0]; this.syncChan(); }
    this.renderAll();
    if (save) social.store?.setPref('tab', id);
  }
  syncChan() {
    const ch = CHANNELS[social.channel] || CHANNELS.say;
    let label = ch.label;
    if (social.channel === 'whisper' && social.lastWhisperTo) label = `To ${social.lastWhisperTo}`;
    this.chanEl.textContent = `[${label}]`;
    this.chanEl.style.color = ch.color;
    this.input.placeholder = social.channel === 'say' ? 'Say something… (/help)' : `${ch.label} chat…`;
  }
  cycleChannel(dir = 1) {
    const i = ORDER.indexOf(social.channel);
    social.channel = ORDER[(i + dir + ORDER.length) % ORDER.length];
    this.syncChan();
  }

  visible(l) { const t = TABS.find((x) => x.id === this.tab); return !t || t.chans.includes(l.ch); }
  lineHtml(l) {
    const ch = CHANNELS[l.ch] || CHANNELS.say;
    const t = `<span class="t" style="display:${social.store?.prefs.timestamps ? '' : 'none'}">${fmtTime(l.ts)}</span>`;
    const pre = ch.prefix ? `<span class="c" style="color:${ch.color}">${ch.prefix}</span>` : '';
    if (l.ch === 'system') return `${t}<span style="color:${ch.color}">${escapeHtml(l.text)}</span>`;
    if (l.ch === 'emote' || l.plain) return `${t}${pre}<span style="color:${ch.color};font-style:italic">${escapeHtml(l.text)}</span>`;
    const rel = l.self ? 'self' : social.relation(l.from || l.name);
    const nameColor = l.self ? '#ffe27a' : { party: '#7dff9a', friend: '#ff9ad5', guild: '#ffd84a', other: ch.color }[rel];
    const who = `<span class="n" data-id="${escapeHtml(l.from || '')}" data-name="${escapeHtml(l.name)}" style="color:${nameColor}">${escapeHtml(l.name)}</span>`;
    if (l.ch === 'whisper') {
      const dir = l.dir === 'to' ? 'To' : 'From';
      return `${t}<span style="color:${ch.color}">${dir} ${who}<span style="color:${ch.color}">: ${escapeHtml(l.text)}</span></span>`;
    }
    const gtag = l.guild && l.ch !== 'guild' ? `<span style="color:#ffd84a">&lt;${escapeHtml(l.guild)}&gt; </span>` : '';
    return `${t}${pre}${gtag}${who}<span style="color:${ch.color}">: ${escapeHtml(l.text)}</span>`;
  }
  addLine(l) {
    for (const t of TABS) if (t.id !== this.tab && t.id !== 'all' && t.chans.includes(l.ch) && l.ch !== 'system' && !l.self) { this.unread.add(t.id); this.tabBtns[t.id]?.classList.add('wf-new'); }
    if (!this.visible(l)) return;
    this.appendLine(l);
  }
  appendLine(l) {
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    const d = el('div', `l ch-${l.ch}`, this.lineHtml(l));
    this.log.appendChild(d);
    while (this.log.childElementCount > 300) this.log.firstElementChild.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }
  renderAll() {
    this.log.innerHTML = '';
    for (const l of social.history) if (this.visible(l)) this.log.appendChild(el('div', `l ch-${l.ch}`, this.lineHtml(l)));
    this.log.scrollTop = this.log.scrollHeight;
  }

  // ── open / close ──
  setOpen(v, prefill) {
    if (v && this.collapsed) this.setCollapsed(false);
    if (v === this.open && !prefill) { if (v) this.input.focus(); return; }
    this.open = v;
    this.panel.classList.toggle('wf-open', v);
    const world = this.scene.scene.get('world');
    const km = this.scene.game.input.keyboard;
    if (v) {
      if (world) { world.chatOpen = true; world.input?.keyboard?.resetKeys?.(); }
      this.scene.input.keyboard?.resetKeys?.();
      if (km) km.enabled = false;
      this.syncChan();
      if (typeof prefill === 'string') this.input.value = prefill;
      this.histIdx = -1;
      setTimeout(() => { this.input.focus(); this.input.setSelectionRange(this.input.value.length, this.input.value.length); }, 0);
      this.log.scrollTop = this.log.scrollHeight;
    } else {
      this.input.blur();
      if (km) km.enabled = true;
      if (world) { world.chatOpen = false; world.uiLockUntil = Math.max(world.uiLockUntil || 0, (world.time?.now || 0) + 150); }
    }
    bus.emit(Events.SOCIAL_UI, { panel: 'chat', open: v });
  }
  onKey(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.setOpen(false); return; }
    if (e.key === 'Tab') { e.preventDefault(); this.cycleChannel(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!this.sentHist.length) return;
      e.preventDefault();
      this.histIdx = e.key === 'ArrowUp' ? Math.min(this.sentHist.length - 1, this.histIdx + 1) : Math.max(-1, this.histIdx - 1);
      this.input.value = this.histIdx < 0 ? '' : this.sentHist[this.sentHist.length - 1 - this.histIdx];
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = this.input.value;
      this.input.value = '';
      if (v.trim()) {
        this.sentHist.push(v); if (this.sentHist.length > 30) this.sentHist.shift();
        social.submit(v);
        if (/^\/(w|whisper|tell|msg|r|reply)\b/i.test(v)) { social.channel = 'whisper'; this.syncChan(); }
        // MMO feel: stay open after a slash command that changes channel, close after a message
        // (the old test was inverted: /accept, /invite, /wave... left the input focused and swallowed game keys)
        const bareSwitch = /^\/(say|s|party|p|world|y|yell|global|g|guild)\s*$/i.test(v.trim()) || /^\/(w|whisper|tell|msg)\s+\S+\s*$/i.test(v.trim());
        if (!bareSwitch) this.setOpen(false);
      } else this.setOpen(false);
    }
  }

  destroy() {
    this.off.forEach((f) => f()); this.offActs.forEach((f) => f());
    document.removeEventListener('pointerdown', this.onDocDown, true);
    if (this.open) this.setOpen(false);
    this.panel.remove(); this.chip.remove();
  }
}
