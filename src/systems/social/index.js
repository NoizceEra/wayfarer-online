import { bus, Events } from '../../core/events.js';
import { net } from '../../net/NetworkManager.js';
import { SocialStore } from './store.js';
import { EMOTES, emoteById } from './emotes.js';
import { installSocialNet } from '../../net/socialNet.js';
import { petDuel } from '../../net/petDuelNet.js';
import { arenaNet } from '../../net/arenaNet.js';
import { JOBS } from '../../data/jobs.js';

// Social layer (chat channels, whispers, party, emotes, friends/ignore,
// roster, guild stub). Pure state + rules; no Phaser here. The UI
// (src/ui/ChatPanel.js, PartyFrames.js, SocialPanels.js, EmoteWheel.js) and
// the world layer (systems/social/world.js) subscribe to bus events:
//   SOCIAL_CHAT, SOCIAL_PARTY, SOCIAL_EMOTE, SOCIAL_ROSTER, SOCIAL_UI.
// Network in/out goes through src/net/socialNet.js. Everything degrades to a
// local echo when offline.
//
// ACTION REGISTRY (for the input/hotkey layer): social.registerAction(name, fn)
// / social.act(name, ...args). Names: openChat(prefill?), closeChat, toggleChat,
// openParty, openFriends, openEmotes, closeAll, contextMenu({id,name,x,y}).
// Default keys: Enter chat (bound in UIScene), P party, O friends/players,
// G emote wheel, Esc close. There is no src/core/input.js yet, so
// installFallbackKeys() below binds P/O/G/Esc on window; remove it once the
// input registry lands and bind these actions there instead.

export const CHANNELS = {
  say:     { label: 'Say',     color: '#f4f0dc', prefix: '' },
  party:   { label: 'Party',   color: '#7dd3fc', prefix: '[Party]' },
  world:   { label: 'World',   color: '#ffb36b', prefix: '[World]' },
  guild:   { label: 'Guild',   color: '#8ce68c', prefix: '[Guild]' },
  whisper: { label: 'Whisper', color: '#ff9ad5', prefix: '' },
  system:  { label: 'System',  color: '#ffe27a', prefix: '' },
  emote:   { label: 'Emote',   color: '#e0b0ff', prefix: '' },
};
export const TABS = [
  { id: 'all', label: 'All', chans: ['say', 'party', 'world', 'guild', 'whisper', 'system', 'emote'] },
  { id: 'say', label: 'Say', chans: ['say', 'emote'] },
  { id: 'party', label: 'Party', chans: ['party'] },
  { id: 'world', label: 'World', chans: ['world'] },
  { id: 'guild', label: 'Guild', chans: ['guild'] },
  { id: 'whisper', label: 'Whisper', chans: ['whisper'] },
  { id: 'system', label: 'System', chans: ['system'] },
];

export const SAY_RADIUS = 260;     // px: Say/local reaches roughly one screen
export const PARTY_XP_RADIUS = 340; // px: party XP is shared with members this close to the kill
const HISTORY_MAX = 300;
const CLIENT_RATE = { max: 5, windowMs: 3000 };

// profanity-light: a handful of words, masked to the first letter.
const BAD = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'bastard', 'slut', 'whore', 'faggot', 'nigger', 'retard'];
const BAD_RE = new RegExp(`\\b(${BAD.join('|')})(s|ing|ed|er)?\\b`, 'gi');
export const maskProfanity = (t) => String(t).replace(BAD_RE, (m) => m[0] + '*'.repeat(m.length - 1));

const nowTs = () => Date.now();
const esc = (n) => String(n || '').trim().slice(0, 14);

class Social {
  constructor() {
    this.store = null;
    this.me = { name: 'Wayfarer', level: 1, job: 'wayfarer', zone: 'Thistle Town' };
    this.roster = new Map();      // sessionId -> presence
    this.party = null;            // {id, leader, members:[{id,name,hp,maxHp,mp,maxMp,level,job}]}
    this.guild = null;            // {tag, name, members:[names]}
    this.pendingInvite = null;    // {from, fromName, at}
    this.pendingTrade = null;     // {from, fromName, gold, item, at}
    this.pendingDuel = null;      // {from, fromName, at}
    this.pendingPetDuel = null;   // {from, fromName, at}
    this.duel = null;             // {peerId, peerName} — active consensual PvP
    this.history = [];            // chat lines
    this.channel = 'say';         // active outgoing channel
    this.lastWhisperFrom = null;  // name for /r
    this.lastWhisperTo = null;
    this.sent = [];               // client rate-limit timestamps
    this.actions = {};
    this.world = null;            // WorldScene (set by systems/social/world.js)
    this._presenceT = 0;
    this._offBus = [];
    // Network handlers + bus hooks are wired at module load (this module is in
    // main.js's import graph) so nothing the relay sends during onJoin is missed.
    this.netApi = installSocialNet(this);
    this._offBus.push(
      bus.on(Events.KILL, (k) => this.onKill(k)),
      bus.on(Events.LEVEL_UP, (m) => { this.me.level = m.level; this.pushPresence(); }),
      bus.on(Events.ZONE, (z) => { this.me.zone = z?.name || this.me.zone; this.pushPresence(); }),
      bus.on(Events.NET_PLAYER_LEFT, ({ id }) => { if (this.roster.delete(id)) bus.emit(Events.SOCIAL_ROSTER, this.players()); }),
      bus.on(Events.NET_DISCONNECTED, () => this.onDisconnected()),
      bus.on(Events.CHAT, (m) => { // legacy 'chat' relay messages (net.sendChat) show up as Say
        if (m && m.name !== undefined && !m._social) this.addLine({ ch: 'say', name: m.name, text: m.text, from: null });
      }),
    );
  }
  get id() { return net.sessionId; }
  get online() { return net.connected; }

  // Called from the UI scene once the hero is known (name -> friends store).
  init(name, job) {
    const n = esc(name) || 'Wayfarer';
    if (job) this.me.job = job;
    if (this.store && this.me.name === n) return this;
    this.me.name = n;
    this.store = new SocialStore(this.me.name);
    return this;
  }

  // ── actions registry ──
  registerAction(name, fn) { this.actions[name] = fn; return () => { if (this.actions[name] === fn) delete this.actions[name]; }; }
  act(name, ...args) { const fn = this.actions[name]; if (!fn) return false; try { fn(...args); } catch (e) { console.error(e); } return true; }

  // ── roster / presence ──
  players() { return [...this.roster.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  setRoster(list) { this.roster.clear(); for (const p of list || []) if (p?.id) this.roster.set(p.id, p); bus.emit(Events.SOCIAL_ROSTER, this.players()); }
  upsertPresence(p) { if (!p?.id) return; this.roster.set(p.id, { ...(this.roster.get(p.id) || {}), ...p }); bus.emit(Events.SOCIAL_ROSTER, this.players()); }
  removePresence(id) { if (this.roster.delete(id)) bus.emit(Events.SOCIAL_ROSTER, this.players()); }
  findPlayer(nameOrId) {
    if (!nameOrId) return null;
    if (this.roster.has(nameOrId)) return this.roster.get(nameOrId);
    const n = String(nameOrId).toLowerCase();
    for (const p of this.roster.values()) if (p.name.toLowerCase() === n) return p;
    for (const [id, peer] of net.peers) if (peer.name?.toLowerCase() === n) return { id, name: peer.name };
    return null;
  }
  presencePayload() { return { level: this.me.level, job: this.me.job, zone: this.me.zone }; }
  pushPresence() {
    if (!this.online) return;
    clearTimeout(this._presenceT);
    this._presenceT = setTimeout(() => net.send('presence', this.presencePayload()), 150);
  }
  onConnected() {
    if (this.world?.player) { this.me.level = this.world.player.level; this.me.job = this.world.player.job.id; }
    net.send('presence', this.presencePayload());
    net.send('who', {});
    if (!this._statusTimer) this._statusTimer = setInterval(() => this.pushPartyStatus(), 1000);
  }
  onDisconnected() {
    if (this.party) this.system('Connection lost — party dissolved locally.');
    this.party = null; this.guild = null; this.pendingInvite = null;
    this.roster.clear();
    bus.emit(Events.SOCIAL_PARTY, null); bus.emit(Events.SOCIAL_ROSTER, []);
    if (this._statusTimer) { clearInterval(this._statusTimer); this._statusTimer = null; }
  }

  // relation used for nameplates / minimap colours
  relation(idOrName) {
    const p = this.roster.get(idOrName) || this.findPlayer(idOrName);
    const name = p?.name || idOrName;
    if (this.party?.members.some((m) => m.id === (p?.id || idOrName))) return 'party';
    if (this.store?.isFriend(name)) return 'friend';
    if (this.guild && p?.guild && p.guild === this.guild.tag) return 'guild';
    return 'other';
  }
  plateFor(id, fallbackName, opts = {}) {
    const p = this.roster.get(id);
    const name = p?.name || fallbackName || '???';
    const rel = this.relation(id);
    const color = { party: '#7dff9a', friend: '#ff9ad5', guild: '#ffd84a', other: '#ffffff' }[rel];
    const tag = p?.guild ? `<${p.guild}> ` : '';
    const lv = p?.level ? `Lv${p.level}` : '';
    const jobName = p?.job ? (JOBS[p.job]?.name || cap(p.job)) : '';
    const lag = opts.lag ? ' (lag)' : '';
    const parts = [tag ? tag.trim() : null, name + lag, lv, jobName].filter(Boolean);
    return { text: parts.join(' · '), color, rel };
  }

  // ── chat lines ──
  addLine(l) {
    const line = { ts: nowTs(), ...l };
    if (line.name && line.from !== this.id && this.store?.isIgnored(line.name) && line.ch !== 'system') return null;
    if (this.store?.prefs.filter && line.text) line.text = maskProfanity(line.text);
    this.history.push(line);
    if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    bus.emit(Events.SOCIAL_CHAT, line);
    return line;
  }
  system(text) { return this.addLine({ ch: 'system', text: String(text) }); }

  rateOk() {
    const t = nowTs();
    this.sent = this.sent.filter((x) => t - x < CLIENT_RATE.windowMs);
    if (this.sent.length >= CLIENT_RATE.max) return false;
    this.sent.push(t); return true;
  }

  // Send `text` on `ch` (defaults to the active channel). Handles slash commands.
  submit(text, ch = this.channel) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (text[0] === '/') return this.command(text);
    this.chat(ch, text);
  }
  chat(ch, text) {
    if (!CHANNELS[ch] || ch === 'system') ch = 'say';
    text = text.slice(0, 160);
    if (!this.rateOk()) { this.system('Slow down — you are chatting too fast.'); return; }
    if (ch === 'whisper') { if (this.lastWhisperTo) return this.whisper(this.lastWhisperTo, text); this.system('Whisper whom? /w name message'); return; }
    if (!this.online) {
      if (ch === 'party' || ch === 'guild' || ch === 'world') this.system(`(offline) nobody hears your ${ch} chat — Host or Join a room from the title screen.`);
      this.addLine({ ch, name: this.me.name, text, from: null, self: true });
      return;
    }
    if (ch === 'party' && !this.party) { this.system('You are not in a party. /invite name'); return; }
    if (ch === 'guild' && !this.guild) { this.system('You are not in a guild. /gcreate TAG name or /gjoin TAG'); return; }
    net.send('schat', { ch, text });
  }
  whisper(to, text) {
    to = esc(to); text = String(text || '').trim().slice(0, 160);
    if (!to || !text) { this.system('Usage: /w name message'); return; }
    if (!this.online) { this.system(`(offline) ${to} cannot hear you.`); return; }
    if (to.toLowerCase() === this.me.name.toLowerCase()) { this.system('Talking to yourself?'); return; }
    this.lastWhisperTo = to;
    net.send('whisper', { to, text });
  }
  emote(id) {
    const e = emoteById(id); if (!e) { this.system(`Unknown emote. Try: ${EMOTES.map((x) => x.id).join(', ')}`); return; }
    const payload = { from: this.id || 'me', name: this.me.name, id: e.id };
    if (!net.send('emote', { id: e.id })) this.onEmote(payload); // offline: play locally
  }
  onEmote(m) {
    if (m.from !== this.id && m.from !== 'me' && this.store?.isIgnored(m.name)) return;
    const e = emoteById(m.id); if (!e) return;
    bus.emit(Events.SOCIAL_EMOTE, m);
    this.addLine({ ch: 'emote', text: `${m.name} ${e.text}`, from: m.from, name: m.name, plain: true });
  }
  // incoming chat from relay
  onChat(m) {
    if (!m || !m.text) return;
    if (m.ch === 'say' && m.from !== this.id && this.world?.player) {
      const r = this.world.sync?.remotes?.get(m.from);
      if (r && Math.hypot(r.x - this.world.player.x, r.y - this.world.player.y) > SAY_RADIUS) return; // out of earshot
    }
    this.addLine({ ch: m.ch, name: m.name, text: m.text, from: m.from, guild: m.guild, self: m.from === this.id });
  }
  onWhisper(m) { this.lastWhisperFrom = m.fromName; this.addLine({ ch: 'whisper', name: m.fromName, text: m.text, from: m.from, dir: 'from' }); }
  onWhisperSent(m) { this.lastWhisperTo = m.toName; this.addLine({ ch: 'whisper', name: m.toName, text: m.text, from: this.id, dir: 'to', self: true }); }

  // ── party ──
  inParty() { return !!(this.party && this.party.members.length > 1); }
  isLeader() { return !!this.party && this.party.leader === this.id; }
  member(id) { return this.party?.members.find((m) => m.id === id) || null; }
  invite(who) {
    if (!this.online) { this.system('(offline) Host or Join a room first, then /invite name.'); return; }
    const p = this.findPlayer(who);
    if (!p) { this.system(`No player named "${esc(who)}" here.`); return; }
    if (p.id === this.id) { this.system('You cannot invite yourself.'); return; }
    net.send('party-invite', { to: p.id });
  }
  onInvite(m) {
    this.pendingInvite = { from: m.from, fromName: m.fromName, at: nowTs() };
    this.system(`${m.fromName} invites you to a party. /accept or /decline`);
    bus.emit(Events.SOCIAL_UI, { panel: 'invite', open: true, invite: this.pendingInvite });
    clearTimeout(this._inviteT);
    this._inviteT = setTimeout(() => { if (this.pendingInvite?.from === m.from) this.decline(true); }, 30000);
  }
  accept() {
    if (!this.pendingInvite) { this.system('No pending invite.'); return; }
    const inv = this.pendingInvite; this.pendingInvite = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'invite', open: false });
    net.send('party-accept', { from: inv.from });
  }
  decline(silent = false) {
    if (!this.pendingInvite) { if (!silent) this.system('No pending invite.'); return; }
    const inv = this.pendingInvite; this.pendingInvite = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'invite', open: false });
    net.send('party-decline', { from: inv.from });
    if (!silent) this.system(`Declined ${inv.fromName}'s invite.`);
  }
  leaveParty() { if (!this.party) { this.system('You are not in a party.'); return; } net.send('party-leave', {}); }
  kick(who) { const p = this.findPlayer(who); net.send('party-kick', { id: p?.id || who }); }
  promote(who) { const p = this.findPlayer(who); net.send('party-promote', { id: p?.id || who }); }
  onPartyUpdate(m) {
    const prev = this.party;
    if (!m || !m.members || m.members.length === 0) this.party = null;
    else {
      this.party = { id: m.id, leader: m.leader, members: m.members.map((x) => ({ ...(prev?.members.find((o) => o.id === x.id) || {}), ...x })) };
      for (const mem of this.party.members) { const p = this.roster.get(mem.id); if (p) { mem.job = p.job; mem.level = mem.level || p.level; } }
    }
    bus.emit(Events.SOCIAL_PARTY, this.party);
    this.pushPartyStatus(true);
  }
  onPartyStatus(m) { const mem = this.member(m.from); if (!mem) return; Object.assign(mem, m); bus.emit(Events.SOCIAL_PARTY, this.party); }
  pushPartyStatus(force = false) {
    const p = this.world?.player; if (!p || !this.inParty() || !this.online) return;
    const s = { hp: Math.ceil(p.hp), maxHp: p.effMaxHp?.() ?? p.maxHp, mp: Math.ceil(p.mp), maxMp: p.effMaxMp?.() ?? p.maxMp, level: p.level };
    const k = `${s.hp}/${s.maxHp}/${s.mp}/${s.maxMp}/${s.level}`;
    if (!force && k === this._lastStatus) return;
    this._lastStatus = k;
    net.send('party-status', s);
  }
  // Shared XP: killer keeps the kill XP (combat code already granted it) and
  // gets +10% per party member in range; each member in range receives
  // ceil(xp * (0.5 + 0.1 * partySize)) — RO-style "even share with a bonus".
  membersInRange(x, y) {
    const rem = this.world?.sync?.remotes; if (!rem || !this.party) return [];
    return this.party.members.filter((m) => { if (m.id === this.id) return false; const r = rem.get(m.id); return r && Math.hypot(r.x - x, r.y - y) <= PARTY_XP_RADIUS; });
  }
  onKill(k) {
    if (!k || !this.inParty() || !this.online) return;
    const near = this.membersInRange(k.x, k.y);
    net.send('party-xp', { xp: k.xp | 0, x: k.x | 0, y: k.y | 0 });
    if (near.length && this.world?.player) {
      const bonus = Math.ceil((k.xp | 0) * 0.1 * near.length);
      if (bonus > 0) { this.grantXp(bonus, `+${bonus} XP party bonus`); }
    }
  }
  onPartyXp(m) {
    const p = this.world?.player; if (!p || !this.party) return;
    const d = Math.hypot(p.x - m.x, p.y - m.y);
    if (d > PARTY_XP_RADIUS) return;
    const share = Math.ceil(m.xp * (0.5 + 0.1 * this.party.members.length));
    const who = this.member(m.from)?.name || 'a party member';
    this.grantXp(share, `+${share} XP shared from ${who}`);
  }
  grantXp(n, why) {
    const w = this.world; const p = w?.player; if (!p || n <= 0) return;
    const leveled = p.gainXp(n);
    this.system(why);
    bus.emit(Events.PLAYER_XP, w.xpPayload());
    bus.emit(Events.PLAYER_HP, w.hpPayload());
    if (leveled) { this.system(`${this.me.name} reached Lv ${p.level}!`); w.spawnFx?.(p.x, p.y - 10, 'fx.boost', 1.4); }
    w.saveNow?.();
  }

  // ── guild stub ──
  onGuildUpdate(m) { this.guild = m && m.tag ? m : null; bus.emit(Events.SOCIAL_ROSTER, this.players()); this.system(this.guild ? `Guild <${this.guild.tag}> ${this.guild.name}: ${this.guild.members.join(', ')}` : 'You are no longer in a guild.'); }

  // ── trade (gold + one item, co-op trust model) ──
  offerTrade(who, gold = 0, item = null) {
    if (!this.online) { this.system('(offline) trading needs a room.'); return; }
    const p = this.findPlayer(who);
    if (!p) { this.system(`No player named "${esc(who)}" here.`); return; }
    if (p.id === this.id) { this.system('You cannot trade with yourself.'); return; }
    gold = Math.max(0, Math.min(9999, gold | 0));
    if (typeof item === 'string') item = item.slice(0, 40); else item = null;
    if (!gold && !item) { this.system('Offer gold or an item.'); return; }
    const me = this.world?.player;
    if (gold > (me?.gold || 0)) { this.system('You do not have that much gold.'); return; }
    if (item && !me?.inventory?.includes(item)) { this.system(`You no longer have ${item}.`); return; }
    net.send('trade-offer', { to: p.id, gold, item });
  }
  onTradeOffer(m) {
    this.pendingTrade = { from: m.from, fromName: m.fromName || '???', gold: m.gold | 0, item: m.item || null, at: nowTs() };
    const what = `${m.gold | 0}g${m.item ? ' + ' + m.item : ''}`;
    this.system(`${m.fromName || '???'} offers you ${what}. /taccept or /tdecline`);
    bus.emit(Events.SOCIAL_UI, { panel: 'trade', open: true, trade: this.pendingTrade });
    clearTimeout(this._tradeT);
    this._tradeT = setTimeout(() => { if (this.pendingTrade?.from === m.from) this.declineTrade(true); }, 45000);
  }
  onTradeSent(m) { this.system(`Offer sent to ${m.toName || '???'}.`); }
  acceptTrade() {
    const t = this.pendingTrade;
    if (!t) { this.system('No pending trade.'); return; }
    const w = this.world, p = w?.player;
    if (p) {
      p.gold += t.gold | 0;
      if (t.item && !p.inventory.includes(t.item)) p.inventory.push(t.item);
      bus.emit(Events.PLAYER_HP, w.hpPayload());
      w.saveNow?.();
    }
    net.send('trade-respond', { to: t.from, accept: true, gold: t.gold | 0, item: t.item });
    this.system(`Accepted ${t.fromName}'s trade (+${t.gold | 0}g${t.item ? ' + ' + t.item : ''}).`);
    this.pendingTrade = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'trade', open: false });
  }
  declineTrade(silent = false) {
    const t = this.pendingTrade;
    if (!t) { if (!silent) this.system('No pending trade.'); return; }
    this.pendingTrade = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'trade', open: false });
    net.send('trade-respond', { to: t.from, accept: false });
    if (!silent) this.system(`Declined ${t.fromName}'s trade.`);
  }
  onTradeDone(m) {
    // We are the offerer: the recipient accepted (deduct) or declined.
    if (m.declined) { this.system('Trade declined.'); return; }
    const w = this.world, p = w?.player;
    if (p) {
      p.gold = Math.max(0, p.gold - (m.gold | 0));
      if (m.item) {
        const ix = p.inventory.indexOf(m.item);
        if (ix >= 0) p.inventory.splice(ix, 1);
        else {
          const slot = Object.keys(p.equipped || {}).find((s) => p.equipped[s] === m.item);
          if (slot && p.unequip) p.unequip(slot);
        }
        p.applyGearVisuals?.();
      }
      bus.emit(Events.PLAYER_HP, w.hpPayload());
      bus.emit(Events.GEAR, { changed: true });
      w.saveNow?.();
    }
    this.system(`Trade complete (${m.gold | 0}g${m.item ? ' + ' + m.item : ''}).`);
  }

  // ── duels (consensual PvP) ──
  duelingWith(id) { return !!this.duel && this.duel.peerId === id; }
  duelPeer() { return this.duel ? { id: this.duel.peerId, name: this.duel.peerName } : null; }
  challenge(who) {
    if (!this.online) { this.system('(offline) duels need a room.'); return; }
    const p = this.findPlayer(who);
    if (!p) { this.system(`No player named "${esc(who)}" here.`); return; }
    if (p.id === this.id) { this.system('You cannot duel yourself.'); return; }
    if (this.duel) { this.system('Finish your current duel first (/dtend).'); return; }
    net.send('duel-challenge', { to: p.id });
  }
  challengePetDuel(who) {
    if (!this.online) { this.system('(offline) pet duels need a room.'); return; }
    const p = this.findPlayer(who);
    if (!p) { this.system(`No player named "${esc(who)}" here.`); return; }
    if (p.id === this.id) { this.system('You cannot duel yourself.'); return; }
    petDuel.challenge(p.name);
  }
  onDuelChallenge(m) {
    this.pendingDuel = { from: m.from, fromName: m.fromName || '???', at: nowTs() };
    this.system(`${m.fromName || '???'} challenges you to a duel! /dtaccept or /dtdecline`);
    bus.emit(Events.SOCIAL_UI, { panel: 'duel', open: true, duel: this.pendingDuel });
    clearTimeout(this._duelT);
    this._duelT = setTimeout(() => { if (this.pendingDuel?.from === m.from) this.declineDuel(true); }, 45000);
  }
  acceptDuel() {
    const d = this.pendingDuel;
    if (!d) { this.system('No pending duel.'); return; }
    this.pendingDuel = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'duel', open: false });
    petDuel.accept(d.fromName || d.from);
  }
  declineDuel(silent = false) {
    const d = this.pendingDuel;
    if (!d) { if (!silent) this.system('No pending duel.'); return; }
    this.pendingDuel = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'duel', open: false });
    petDuel.decline(d.fromName || d.from);
    if (!silent) this.system(`Declined ${d.fromName}'s duel.`);
  }
  onPetDuelChallenge(m) {
    this.pendingPetDuel = { from: m.from, fromName: m.fromName || '???', at: nowTs() };
    this.system(`${m.fromName || '???'} challenges you to a pet duel! /pda to accept or /pdd to decline`);
    bus.emit(Events.SOCIAL_UI, { panel: 'pet-duel-request', open: true, duel: { fromName: m.fromName || '???', from: m.from } });
    clearTimeout(this._petDuelT);
    this._petDuelT = setTimeout(() => { if (this.pendingPetDuel?.from === m.from) this.declinePetDuel(true); }, 45000);
  }
  acceptPetDuel() {
    const d = this.pendingPetDuel;
    if (!d) { this.system('No pending pet duel.'); return; }
    this.pendingPetDuel = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'pet-duel-request', open: false });
    petDuel.accept(d.fromName || d.from);
  }
  declinePetDuel(silent = false) {
    const d = this.pendingPetDuel;
    if (!d) { if (!silent) this.system('No pending pet duel.'); return; }
    this.pendingPetDuel = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'pet-duel-request', open: false });
    petDuel.decline(d.fromName || d.from);
    if (!silent) this.system(`Declined ${d.fromName}'s pet duel.`);
  }
  onDuelStart(m) {
    const peerId = m.a === this.id ? m.b : m.a;
    const peer = this.roster.get(peerId) || this.findPlayer(peerId);
    this.duel = { peerId, peerName: peer?.name || '???' };
    this.system(`DUEL vs ${this.duel.peerName}! First to fall loses. (/dtend to yield)`);
    bus.emit(Events.SOCIAL_ROSTER, this.players());
  }
  onDuelEnd(m) {
    if (!this.duel) return;
    const reason = m?.reason === 'death' ? `${this.duel.peerName} won the duel.` : m?.reason === 'left' ? `${this.duel.peerName} left — duel over.` : 'Duel over.';
    this.duel = null;
    this.system(reason);
    bus.emit(Events.SOCIAL_ROSTER, this.players());
  }
  endDuel(reason = 'ended') {
    if (!this.duel) return;
    petDuel.forfeit();
    this.duel = null;
    this.system('You ended the duel.');
    bus.emit(Events.SOCIAL_ROSTER, this.players());
  }
  onPvpHit(m) {
    // Only the recorded opponent's hits land.
    if (!this.duel || m.from !== this.duel.peerId) return;
    const w = this.world;
    if (!w?.combat || w.player.dead) return;
    const dmg = Math.max(1, Math.min(500, Math.round(+m.dmg || 0)));
    w.combat.hitPlayer(dmg, { x: +m.x || w.player.x, y: +m.y || w.player.y }, true);
  }

  // ── friends / ignore ──
  addFriend(name) { name = esc(name); if (!name) return; if (name.toLowerCase() === this.me.name.toLowerCase()) return this.system('You are already your own best friend.'); this.system(this.store.add('friends', name) ? `${name} added to friends.` : `${name} is already a friend.`); bus.emit(Events.SOCIAL_ROSTER, this.players()); }
  removeFriend(name) { this.system(this.store.remove('friends', name) ? `${name} removed from friends.` : `${name} is not on your friends list.`); bus.emit(Events.SOCIAL_ROSTER, this.players()); }
  ignore(name) { name = esc(name); if (!name) return; this.store.remove('friends', name); this.system(this.store.add('ignored', name) ? `Ignoring ${name}.` : `${name} is already ignored.`); bus.emit(Events.SOCIAL_ROSTER, this.players()); }
  unignore(name) { this.system(this.store.remove('ignored', name) ? `No longer ignoring ${name}.` : `${name} was not ignored.`); bus.emit(Events.SOCIAL_ROSTER, this.players()); }

  who() {
    if (!this.online) { this.system(`Online: just you, ${this.me.name} (offline — solo). Host or Join from the title to meet others.`); return; }
    const list = this.players();
    this.system(`Online (${list.length}): ${list.map((p) => `${p.guild ? `<${p.guild}> ` : ''}${p.name} Lv${p.level} ${cap(p.job)} @ ${p.zone}`).join(' · ')}`);
    net.send('who', {});
  }

  // ── slash commands ──
  command(raw) {
    const [cmdRaw, ...rest] = raw.slice(1).split(' ');
    const cmd = cmdRaw.toLowerCase(); const arg = rest.join(' ').trim(); const first = rest[0] || '';
    const restText = rest.slice(1).join(' ').trim();
    const setCh = (ch) => { this.channel = ch; bus.emit(Events.SOCIAL_UI, { panel: 'channel', channel: ch }); if (arg) this.chat(ch, arg); else this.system(`Now talking in ${CHANNELS[ch].label}.`); };
    switch (cmd) {
      case 'help': case '?':
        this.system('Commands: /say /s /party /p /world /y /g(uild) /w name msg /r msg /me text /emote id /who /invite name /accept /decline /leave /kick name /promote name /friend name /unfriend name /friends /ignore name /unignore name /trade name /gift name [gold] /taccept /tdecline /duel name /dtaccept /dtdecline /dtend /petduel name /pda /pdd /arena [name|leave] /aqaccept /aqdecline /gcreate TAG name /gjoin TAG /gleave /filter /time /clear /help');
        this.system(`Emotes: ${EMOTES.map((e) => `/${e.id}`).join(' ')}. Keys: Enter chat · P party · O players · G emotes · Tab cycles channel.`);
        return;
      case 'say': case 's': return setCh('say');
      case 'party': case 'p': return setCh('party');
      case 'world': case 'y': case 'yell': case 'global': return setCh('world');
      case 'guild': case 'g': return setCh('guild');
      case 'w': case 'whisper': case 'tell': case 'msg': return this.whisper(first, restText);
      case 'r': case 'reply': if (!this.lastWhisperFrom) return this.system('Nobody has whispered you yet.'); return this.whisper(this.lastWhisperFrom, arg);
      case 'me': if (!arg) return this.system('Usage: /me does something'); if (!this.rateOk()) return this.system('Slow down.'); if (!net.send('schat', { ch: 'say', text: `*${arg}*` })) this.addLine({ ch: 'emote', text: `${this.me.name} ${arg}`, plain: true, from: null }); return;
      case 'emote': case 'e': return this.emote(first.toLowerCase());
      case 'who': case 'online': case 'players': return this.who();
      case 'invite': case 'inv': if (!first) return this.system('Usage: /invite name'); return this.invite(first);
      // /trade is the server-checked trade window (ui/economyUI.js); the quick trust-model gift keeps its own command
      case 'gift': case 'give': if (!first) return this.system('Usage: /gift name [gold] — pick one gear item in the gift window'); return socialTradeCmd(this, first, rest);
      case 'taccept': return this.acceptTrade();
      case 'tdecline': return this.declineTrade();
      case 'duel': case 'dt': if (!first) return this.system('Usage: /duel name'); return this.challenge(first);
      case 'dtaccept': return this.acceptDuel();
      case 'dtdecline': return this.declineDuel();
      case 'dtend': case 'yield': return this.endDuel('ended');
      case 'petduel': case 'pd': if (!first) return this.system('Usage: /petduel name'); return this.challengePetDuel(first);
      case 'pda': return this.acceptPetDuel();
      case 'pdd': return this.declinePetDuel();
      case 'arena': case 'aq':
        if (!first) { if (!arenaNet.queue()) return this.system('(offline) arena needs a room.'); return; }
        if (first === 'leave') return void arenaNet.leave();
        return void arenaNet.challenge(first);
      case 'aqaccept': return void arenaNet.accept(first);
      case 'aqdecline': return void arenaNet.decline(first);
      case 'accept': case 'join': return this.accept();
      case 'decline': return this.decline();
      case 'leave': return this.leaveParty();
      case 'kick': if (!first) return this.system('Usage: /kick name'); return this.kick(first);
      case 'promote': case 'lead': if (!first) return this.system('Usage: /promote name'); return this.promote(first);
      case 'friend': case 'addfriend': return this.addFriend(first);
      case 'unfriend': return this.removeFriend(first);
      case 'friends': return this.system(`Friends (${this.store.friends.length}): ${this.store.friends.join(', ') || 'none yet — /friend name'}`);
      case 'ignore': if (!first) return this.system(`Ignored: ${this.store.ignored.join(', ') || 'nobody'}`); return this.ignore(first);
      case 'unignore': return this.unignore(first);
      case 'gcreate': if (!first) return this.system('Usage: /gcreate TAG Guild Name'); if (!net.send('guild-create', { tag: first, name: restText })) return this.system('(offline) guilds need a room.'); return;
      case 'gjoin': if (!net.send('guild-join', { tag: first })) return this.system('(offline) guilds need a room.'); return;
      case 'gleave': if (!net.send('guild-leave', {})) return this.system('You are not in a guild.'); return;
      case 'filter': this.store.setPref('filter', !this.store.prefs.filter); return this.system(`Profanity filter ${this.store.prefs.filter ? 'ON' : 'OFF'}.`);
      case 'time': case 'timestamps': this.store.setPref('timestamps', !this.store.prefs.timestamps); bus.emit(Events.SOCIAL_UI, { panel: 'prefs' }); return this.system(`Timestamps ${this.store.prefs.timestamps ? 'ON' : 'OFF'}.`);
      case 'clear': this.history.length = 0; bus.emit(Events.SOCIAL_UI, { panel: 'clear' }); return;
      case 'roll': { const n = Math.max(2, Math.min(1000, parseInt(first, 10) || 100)); const v = 1 + Math.floor(Math.random() * n); const t = `rolls ${v} (1-${n})`; if (!net.send('schat', { ch: 'say', text: `*${t}*` })) this.addLine({ ch: 'emote', text: `${this.me.name} ${t}`, plain: true }); return; }
      default:
        if (emoteById(cmd)) return this.emote(cmd);
        return this.system(`Unknown command /${cmd}. Try /help`);
    }
  }
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// /trade name [gold] → opens the trade composer modal for that player.
function socialTradeCmd(social, first, rest) {
  const p = social.findPlayer(first);
  if (!p) return social.system(`No player named "${esc(first)}" here.`);
  if (p.id === social.id) return social.system('You cannot trade with yourself.');
  const gold = Math.max(0, parseInt(rest[0], 10) || 0);
  bus.emit(Events.SOCIAL_UI, { panel: 'trade-compose', open: true, to: p.id, gold });
}

export const social = new Social();
if (typeof window !== 'undefined') window.__social = social; // debug / automated tests

// Fallback hotkeys (no src/core/input.js yet). Capture-phase on window so an
// open social panel can swallow Esc before the pause menu sees it. Typing in
// the chat input never triggers these (the input owns Enter/Esc/Tab itself).
export function installFallbackKeys() {
  if (installFallbackKeys.done) return; installFallbackKeys.done = true;
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!social.actions.anyOpen) return; // UI not mounted (title screen etc.)
    const k = e.key;
    if (k === 'Escape') { if (social.act('closeAll') && social._closedSomething) { e.stopPropagation(); e.preventDefault(); } return; }
    if (k === 'p' || k === 'P') social.act('openParty');
    else if (k === 'o' || k === 'O') social.act('openFriends');
    else if (k === 'g' || k === 'G') social.act('openEmotes');
  }, true);
}
