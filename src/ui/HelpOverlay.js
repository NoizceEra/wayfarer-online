import { input, PAD_LABELS } from '../core/input.js';
import { audio } from '../systems/audio.js';

// Controls & commands reference — opened with H / F1, the "?" HUD button, or
// Pause > "Controls & commands". Two tabs:
//   CONTROLS – live from the input registry (core/input.js + every module's
//              registerAction), so rebinds and actions added elsewhere appear
//              automatically. Grouped Movement / Combat / World / Panels /
//              Social / System, then fixed Gamepad + Touch blocks.
//   COMMANDS – the slash commands handled in systems/social/index.js and
//              ui/economyUI.js, with one-line descriptions.
// Read-only: keys are *changed* in Pause > Controls (rebind page). Small
// viewports paginate (<=560px drops to a single column) so nothing overflows.
//
// Colour/font rule: Solana palette only; Silkscreen labels, PixelifySans body.
const SOL = {
  green: '#14F195', purple: '#9945FF', cyan: '#03E1FF', magenta: '#DC1FFF',
  white: '#E1E8F0', muted: '#6B7A99',
  bgN: 0x0a0e1a, greenN: 0x14f195, purpleN: 0x9945ff, cyanN: 0x03e1ff,
  bar: 0x10182e, line: 0x2a3350,
};
const LABEL = '"Silkscreen", monospace';
const BODY = '"PixelifySans", "Silkscreen", monospace';
const L = (size, color, extra = {}) => ({ fontFamily: LABEL, fontSize: `${size}px`, color, ...extra });
const B = (size, color, extra = {}) => ({ fontFamily: BODY, fontSize: `${size}px`, color, ...extra });

// OnboardingHint (systems/onboarding.js STEPS) covers Move / Strike / Slay /
// Notice Board but never mentions the help overlay or chat commands, so we
// show a one-time tip strip the first time this reference is ever opened.
const SEEN_KEY = 'wayfarer.help.seen.v1';

// Display order + friendly titles for the live registry groups.
const GROUP_ORDER = ['Movement', 'Combat', 'World', 'Panels', 'Social', 'System', 'Other'];
const GROUP_TITLE = { Combat: 'COMBAT / SKILLS' };

// Gamepad (from core/input.js PAD_MAP/PAD_LABELS) — fixed, not rebindable.
const PAD_ROWS = [
  ['Move', 'L-STICK / D-PAD'],
  ['Attack', PAD_LABELS.attack],
  ['Talk / use', PAD_LABELS.interact],
  ['Potion', PAD_LABELS.potion],
  ['Skills 1-4', 'LB RB LT RT'],
  ['Skills 5-6', 'L3 R3'],
  ['Bag', PAD_LABELS.bag],
  ['Menu', PAD_LABELS.menu],
  ['Back / close', PAD_LABELS.back],
];
const TOUCH_ROWS = [
  ['Move', 'left stick'],
  ['Attack / skills', 'tap HUD hotbar'],
  ['Interact', 'X button'],
  ['Panels', 'CHAR / SKILL / MAP / BAG'],
  ['Chat / menu / help', 'ENTER / II / ?'],
];

// Slash commands — extracted from the dispatch in systems/social/index.js:505
// and the economy wrapper in ui/economyUI.js:136. Keep in sync with those.
const COMMANDS = [
  { c: '/say <msg>', d: 'Say channel (local). Alias /s.' },
  { c: '/party <msg>', d: 'Party channel. Alias /p.' },
  { c: '/world <msg>', d: 'World channel. Aliases /y /yell /global.' },
  { c: '/g <msg>', d: 'Guild chat channel. (/guild opens the panel instead.)' },
  { c: '/w <name> <msg>', d: 'Whisper a player. Aliases /whisper /tell /msg.' },
  { c: '/r <msg>', d: 'Reply to the last whisper. Alias /reply.' },
  { c: '/me <text>', d: 'Emote an action in Say (*does something*).' },
  { c: '/emote <id>', d: 'Play an emote by id. Alias /e; emote ids also work bare.' },
  { c: '/who', d: 'List online players. Aliases /online /players.' },
  { c: '/invite <name>', d: 'Invite a player to your party. Alias /inv.' },
  { c: '/accept', d: 'Accept a party invite. Alias /join.' },
  { c: '/decline', d: 'Decline a party invite.' },
  { c: '/leave', d: 'Leave the party.' },
  { c: '/kick <name>', d: 'Remove a party member.' },
  { c: '/promote <name>', d: 'Make a member party leader. Alias /lead.' },
  { c: '/friend <name>', d: 'Add a friend. Alias /addfriend.' },
  { c: '/unfriend <name>', d: 'Remove a friend.' },
  { c: '/friends', d: 'List your friends.' },
  { c: '/ignore <name>', d: 'Ignore a player.' },
  { c: '/unignore <name>', d: 'Stop ignoring a player.' },
  { c: '/trade <name>', d: 'Open a trade window; accept|decline|cancel to answer. Alias /tr.' },
  { c: '/escrow <name>', d: 'Server-held escrow trade; accept|decline|cancel. Alias /esc.' },
  { c: '/gift <name> [gold]', d: 'Gift one gear item. Alias /give.' },
  { c: '/duel <name>', d: 'Challenge a player to a duel. Alias /dt.' },
  { c: '/dtaccept', d: 'Accept a duel challenge.' },
  { c: '/dtdecline', d: 'Decline a duel challenge.' },
  { c: '/dtend', d: 'End / yield your duel. Alias /yield.' },
  { c: '/petduel <name>', d: 'Challenge a pet duel. Alias /pd.' },
  { c: '/pda', d: 'Accept a pet-duel challenge.' },
  { c: '/pdd', d: 'Decline a pet-duel challenge.' },
  { c: '/arena [name|leave]', d: 'Queue, challenge, or leave the arena. Alias /aq.' },
  { c: '/aqaccept', d: 'Accept an arena challenge.' },
  { c: '/aqdecline', d: 'Decline an arena challenge.' },
  { c: '/gcreate <TAG> <name>', d: 'Found a guild.' },
  { c: '/gjoin <TAG>', d: 'Join a guild by tag.' },
  { c: '/gleave', d: 'Leave your guild.' },
  { c: '/ginvite <name>', d: 'Invite a player to your guild.' },
  { c: '/gaccept', d: 'Accept a guild invite.' },
  { c: '/gdecline', d: 'Decline a guild invite.' },
  { c: '/gkick <name>', d: 'Kick a guild member.' },
  { c: '/gpromote <name>', d: 'Raise a member to officer.' },
  { c: '/gdemote <name>', d: 'Lower a member rank.' },
  { c: '/gleader <name>', d: 'Transfer guild leadership.' },
  { c: '/gmotd <text>', d: 'Set the guild message of the day.' },
  { c: '/gdeposit <gold>', d: 'Deposit gold into the guild bank.' },
  { c: '/gwithdraw <gold>', d: 'Withdraw gold from the guild bank.' },
  { c: '/ginfo', d: 'Show your guild summary. Alias /guildinfo.' },
  { c: '/mail [name]', d: 'Open the mailbox, or compose to a name. Alias /mailbox.' },
  { c: '/claim', d: 'Claim pending rewards.' },
  { c: '/sinks', d: 'Token sinks panel. Alias /tokensinks.' },
  { c: '/bridge', d: 'Token bridge panel. Alias /tokenbridge.' },
  { c: '/refer', d: 'Referral panel. Alias /referral.' },
  { c: '/finder', d: 'Party finder panel. Alias /partyfinder.' },
  { c: '/lfg', d: 'Dungeon / LFG panel. Alias /dungeon.' },
  { c: '/season', d: 'Season pass panel. Alias /pass.' },
  { c: '/guild', d: 'Open the guild panel.' },
  { c: '/leaderboard', d: 'Leaderboard panel. Alias /lb.' },
  { c: '/market', d: 'Where to find the market board. Aliases /ah /auction.' },
  { c: '/boss', d: 'World-boss info; add "tp" to teleport to it.' },
  { c: '/pets', d: 'Open the pet panel. Alias /pet.' },
  { c: '/petbattle', d: 'How to catch and battle pets. Alias /pvb.' },
  { c: '/home', d: 'Travel to your home island.' },
  { c: '/roll [n]', d: 'Roll a die (default 100).' },
  { c: '/filter', d: 'Toggle the profanity filter.' },
  { c: '/time', d: 'Toggle chat timestamps. Alias /timestamps.' },
  { c: '/clear', d: 'Clear your chat history.' },
  { c: '/help', d: 'List every command. Alias /?.' },
];

export class HelpOverlay {
  constructor(scene) {
    this.scene = scene; this.isOpen = false; this.c = null; this.prevNav = null;
    this.tab = 'controls'; this.page = 0; this._pages = 1; this.nudge = false;
    this.offChange = input.onChange(() => { if (this.isOpen) this.build(); });
    // Wheel pages through long lists on desktop; touch uses the NEXT/PREV chips.
    this.onWheel = (_p, _objs, _dx, dy) => { if (this.isOpen && (this._pages || 1) > 1) this.turn(dy > 0 ? 1 : -1); };
    scene.input?.on?.('wheel', this.onWheel);
    scene.events.once('shutdown', () => {
      this.close();
      this.offChange();
      scene.input?.off?.('wheel', this.onWheel);
    });
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.nudge = this.takeFirstRun();
    input.pushModal('help');
    this.prevNav = input.nav; input.nav = null;
    audio.play('ui', 0.5);
    this.build();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    input.popModal('help');
    if (input.nav === null && this.prevNav) input.nav = this.prevNav;
    this.prevNav = null;
    this.c?.destroy(); this.c = null;
  }

  // One-time tip strip for first-time players (see SEEN_KEY note above).
  takeFirstRun() {
    try {
      if (window.localStorage.getItem(SEEN_KEY) === '1') return false;
      window.localStorage.setItem(SEEN_KEY, '1');
      return true;
    } catch { return false; }
  }

  setTab(t) { if (t === this.tab) return; this.tab = t; this.page = 0; audio.play('ui', 0.5); this.build(); }
  turn(d) { const p = this._pages || 1; this.page = (this.page + d + p) % p; audio.play('ui', 0.4); this.build(); }

  // ── chrome ────────────────────────────────────────────────────────────────
  chip(c, x, y, w, h, label, cb) {
    const s = this.scene;
    const r = s.add.rectangle(x, y, w, h, SOL.purpleN, 1).setStrokeStyle(1, 0x1a1a22).setInteractive({ useHandCursor: true });
    const t = s.add.text(x, y, label, L(8, '#0a0e1a', { fontStyle: 'bold' })).setOrigin(0.5);
    r.on('pointerover', () => r.setStrokeStyle(2, SOL.cyanN));
    r.on('pointerout', () => r.setStrokeStyle(1, 0x1a1a22));
    r.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); audio.play('ui', 0.6); cb(); });
    c.add([r, t]);
  }
  tabBtn(c, x, y, label, active, cb) {
    const s = this.scene;
    const w = 104, h = 20;
    const r = s.add.rectangle(x, y, w, h, active ? SOL.purpleN : 0x141c33, active ? 1 : 0.85)
      .setStrokeStyle(1, active ? SOL.cyanN : SOL.line).setInteractive({ useHandCursor: true });
    const t = s.add.text(x, y, label, L(8, active ? SOL.white : SOL.muted)).setOrigin(0.5);
    r.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); if (!active) cb(); });
    c.add([r, t]);
  }
  // Truncate a one-line text object so it never overruns its column.
  fit(txt, max, full) {
    if (txt.width <= max) return;
    let t = full;
    while (t.length > 3) {
      t = t.slice(0, -1);
      txt.setText(`${t}…`);
      if (txt.width <= max) break;
    }
  }

  build() {
    const s = this.scene;
    this.c?.destroy();
    const { w: VW, h: VH } = s.view();
    const pw = Math.min(VW - 12, 660), ph = Math.min(VH - 12, 470);
    const c = this.c = s.add.container(Math.round(VW / 2), Math.round(VH / 2)).setDepth(230);

    // click-outside close (swallows world clicks too)
    const dim = s.add.rectangle(0, 0, VW * 2, VH * 2, 0x000000, 0.62).setInteractive();
    dim.on('pointerdown', () => this.close());
    // Solana panel: dark bg + green frame, purple header bar
    const bg = s.add.rectangle(0, 0, pw, ph, SOL.bgN, 0.97).setStrokeStyle(2, SOL.greenN).setInteractive();
    const bar = s.add.rectangle(0, -ph / 2 + 15, pw - 8, 26, SOL.bar, 1);
    c.add([dim, bg, bar]);

    const title = s.add.text(-pw / 2 + 12, -ph / 2 + 15, 'CONTROLS & COMMANDS', L(11, SOL.green, { fontStyle: 'bold' })).setOrigin(0, 0.5);
    const x = s.add.text(pw / 2 - 12, -ph / 2 + 15, 'X', L(12, '#ff7a7a', { fontStyle: 'bold' })).setOrigin(0.5).setInteractive({ useHandCursor: true });
    x.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); this.close(); });
    c.add([title, x]);

    const tabY = -ph / 2 + 37;
    this.tabBtn(c, -56, tabY, 'CONTROLS', this.tab === 'controls', () => this.setTab('controls'));
    this.tabBtn(c, 56, tabY, 'COMMANDS', this.tab === 'commands', () => this.setTab('commands'));

    let top = -ph / 2 + 56;
    if (this.nudge) {
      c.add(s.add.text(0, top - 3, 'NEW · every key, plus chat commands that start with  /', B(8, '#ffe07a', { align: 'center', wordWrap: { width: pw - 24 } })).setOrigin(0.5, 0));
      top += 16;
    }
    const bottom = ph / 2 - 46;
    if (this.tab === 'commands') this.buildCommands(c, { pw, ph, top, bottom });
    else this.buildControls(c, { pw, ph, top, bottom });
  }

  buildControls(c, o) {
    // group the live registry, in a fixed order so the list scans consistently
    const groups = new Map();
    for (const a of input.list()) { if (!groups.has(a.group)) groups.set(a.group, []); groups.get(a.group).push(a); }
    const rows = [];
    const pushGroup = (g) => {
      rows.push({ head: GROUP_TITLE[g] || String(g).toUpperCase() });
      for (const a of groups.get(g)) {
        const keys = a.keys.slice(0, 2).map((k) => input.tokenLabel(k)).filter(Boolean).join(' / ') || '--';
        rows.push({ label: a.label, keys });
      }
    };
    const seen = new Set();
    for (const g of GROUP_ORDER) if (groups.has(g)) { pushGroup(g); seen.add(g); }
    for (const g of groups.keys()) if (!seen.has(g)) pushGroup(g);
    rows.push({ head: 'GAMEPAD' });
    for (const [l, k] of PAD_ROWS) rows.push({ label: l, keys: k });
    rows.push({ head: 'TOUCH' });
    for (const [l, k] of TOUCH_ROWS) rows.push({ label: l, keys: k });

    const rowH = 15;
    const cols = o.pw >= 560 ? 2 : 1;
    const perCol = Math.max(1, Math.floor((o.bottom - o.top) / rowH));
    this.paintContent(c, rows, { ...o, rowH, cols, perCol, perPage: perCol * cols });
  }

  buildCommands(c, o) {
    const rowH = 22;
    const cols = o.pw >= 600 ? 2 : 1;
    const perCol = Math.max(1, Math.floor((o.bottom - o.top) / rowH));
    this.paintContent(c, COMMANDS, { ...o, rowH, cols, perCol, perPage: perCol * cols });
  }

  paintContent(c, rows, o) {
    const s = this.scene;
    const pages = Math.max(1, Math.ceil(rows.length / o.perPage));
    this._pages = pages;
    this.page = Math.min(this.page, pages - 1);
    const slice = rows.slice(this.page * o.perPage, (this.page + 1) * o.perPage);
    const colW = (o.pw - 20) / o.cols;
    const x0 = -o.pw / 2 + 10;
    slice.forEach((row, i) => {
      const ci = Math.min(o.cols - 1, Math.floor(i / o.perCol));
      const j = i - ci * o.perCol;
      const cx = x0 + ci * colW;
      const y = o.top + j * o.rowH;
      if (row.head) {
        c.add(s.add.text(cx, y, row.head, L(7, SOL.cyan)).setOrigin(0, 0));
      } else if (row.d !== undefined) {
        c.add(s.add.text(cx + 6, y + 6, row.c, L(9, SOL.green)).setOrigin(0, 0.5));
        const desc = s.add.text(cx + 6, y + 16, row.d, B(8, SOL.muted)).setOrigin(0, 0.5);
        this.fit(desc, colW - 14, row.d);
        c.add(desc);
      } else {
        c.add(s.add.text(cx + 6, y + o.rowH / 2, row.label, B(9, SOL.white)).setOrigin(0, 0.5));
        c.add(s.add.text(cx + colW - 10, y + o.rowH / 2, row.keys, L(8, SOL.green)).setOrigin(1, 0.5));
      }
    });
    this.footer(c, o.pw, o.ph, pages);
  }

  footer(c, pw, ph, pages) {
    const s = this.scene;
    if (pages > 1) {
      const y = ph / 2 - 28;
      this.chip(c, -pw / 2 + 48, y, 80, 18, '◀ PREV', () => this.turn(-1));
      this.chip(c, pw / 2 - 48, y, 80, 18, 'NEXT ▶', () => this.turn(1));
      c.add(s.add.text(0, y, `${this.page + 1} / ${pages}`, L(8, SOL.white)).setOrigin(0.5));
    }
    const hint = this.tab === 'commands'
      ? `Open chat with ${input.labelFor('chat')} and type a command — /help lists them all`
      : `${input.labelFor('help', 2)} toggles this  ·  ESC or click outside closes  ·  rebind in Pause (${input.labelFor('menu')}) > Controls`;
    c.add(s.add.text(0, ph / 2 - 10, hint, B(8, this.tab === 'commands' ? SOL.cyan : '#a0c4f0', { align: 'center', wordWrap: { width: pw - 20 } })).setOrigin(0.5));
  }
}
