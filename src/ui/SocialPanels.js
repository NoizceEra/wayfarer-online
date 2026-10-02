import { bus, Events } from '../core/events.js';
import { social } from '../systems/social/index.js';
import { socialRoot, el, escapeHtml, placeAt } from './socialDom.js';
import { gearById } from '../data/gear.js';
import { input } from '../core/input.js';

// DOM panels: player/friends/ignore list (O), party panel (P), party-invite
// toast and the per-player context menu (right-click a hero, click a name in
// chat, or a row in any list). Exposes open/close through the social action
// registry: openFriends, openParty, contextMenu, and reports anyOpen/closeAll
// to the coordinator (src/ui/socialUI.js).
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const JOB_ICON = { wayfarer: '⚔', ranger: '➶', arcanist: '✦', bandit: '🗡' };

export class SocialPanels {
  constructor(scene) {
    this.scene = scene;
    this.root = socialRoot();
    this.listTab = 'online';
    this.buildList(); this.buildParty(); this.buildToast(); this.buildMenu(); this.buildOffer();
    this.off = [
      bus.on(Events.SOCIAL_ROSTER, () => { if (this.listOpen) this.renderList(); if (this.partyOpen) this.renderParty(); }),
      bus.on(Events.SOCIAL_PARTY, () => { if (this.partyOpen) this.renderParty(); if (this.listOpen) this.renderList(); }),
      bus.on(Events.SOCIAL_UI, (m) => {
        if (m.panel === 'invite') this.showToast(m.open ? m.invite : null);
        else if (m.panel === 'trade' && m.open) this.showOffer({ kind: 'incoming' });
        else if (m.panel === 'trade-compose' && m.open) this.showOffer({ kind: 'compose', to: m.to, gold: m.gold });
        else if ((m.panel === 'trade' || m.panel === 'trade-compose') && !m.open) this.hideOffer();
        else if (m.panel === 'duel' && m.open) this.showOffer({ kind: 'duel' });
        else if (m.panel === 'duel' && !m.open) this.hideOffer();
      }),
    ];
    this.offActs = [
      social.registerAction('openFriends', () => this.setList(!this.listOpen)),
      social.registerAction('openParty', () => this.setParty(!this.partyOpen)),
      social.registerAction('contextMenu', (o) => this.showMenu(o)),
    ];
    this.onDocDown = (e) => { if (this.menu.style.display !== 'none' && !this.menu.contains(e.target)) this.hideMenu(); };
    document.addEventListener('pointerdown', this.onDocDown, true);
  }
  get anyOpen() { return this.listOpen || this.partyOpen || this.menu.style.display !== 'none' || (this.offer && this.offer.style.display !== 'none'); }
  closeAll() { let c = false; if (this.listOpen) { this.setList(false); c = true; } if (this.partyOpen) { this.setParty(false); c = true; } if (this.menu.style.display !== 'none') { this.hideMenu(); c = true; } if (this.offer && this.offer.style.display !== 'none') { this.hideOffer(); c = true; } return c; }

  titleBar(text, onClose) {
    const t = el('div', 'wf-title', `<span>${text}</span>`);
    const x = el('button', 'wf-ghost wf-x', '✕'); x.addEventListener('click', onClose);
    t.appendChild(x); return t;
  }

  // ── players / friends / ignored ──
  buildList() {
    const p = this.list = el('div', 'wf-panel wf-list'); p.style.display = 'none';
    p.appendChild(this.titleBar('PEOPLE', () => this.setList(false)));
    const tabs = el('div', 'wf-tabs');
    this.listTabs = {};
    for (const [id, label] of [['online', 'Online now'], ['friends', 'Friends'], ['guild', 'Guild'], ['ignored', 'Ignored']]) {
      const b = el('button', '', label); b.addEventListener('click', () => { this.listTab = id; this.renderList(); });
      tabs.appendChild(b); this.listTabs[id] = b;
    }
    // One-click way to the rest of the social layer — plain words, real keys.
    const quick = el('div', 'wf-foot');
    const q = (label, fn) => { const b = el('button', '', label); b.addEventListener('click', fn); quick.appendChild(b); };
    q(`Chat [${input.labelFor('chat')}]`, () => { this.setList(false); social.act('openChat'); });
    q(`Party [${input.labelFor('party')}]`, () => social.act('openParty'));
    q(`Emotes [${input.labelFor('emotes')}]`, () => { this.setList(false); social.act('openEmotes'); });
    this.listBody = el('div', 'wf-scroll');
    const how = el('div', 'wf-hint', 'Click a name for Message, Party, Trade, Mail or Duel — or right-click a hero in the world.');
    const foot = el('div', 'wf-foot');
    this.listInput = el('input'); this.listInput.placeholder = 'name'; this.listInput.maxLength = 14;
    const addF = el('button', '', '+ Friend'); addF.addEventListener('click', () => { if (this.listInput.value.trim()) { social.addFriend(this.listInput.value); this.listInput.value = ''; this.renderList(); } });
    const who = el('button', '', 'Who is online?'); who.addEventListener('click', () => social.who());
    foot.append(this.listInput, addF, who);
    p.append(tabs, quick, this.listBody, how, foot);
    this.root.appendChild(p);
  }
  setList(v) { this.listOpen = v; this.list.style.display = v ? 'flex' : 'none'; if (v) { this.setParty(false); this.renderList(); } bus.emit(Events.SOCIAL_UI, { panel: 'friends', open: v }); }
  row(name, meta, acts, online) {
    const r = el('div', 'wf-row');
    r.innerHTML = `<span class="wf-dot ${online ? 'on' : ''}"></span><span class="wf-name">${escapeHtml(name)}</span><span class="wf-meta">${meta}</span>`;
    const a = el('div', 'wf-acts');
    for (const [label, fn, cls] of acts) { const b = el('button', cls || '', label); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); a.appendChild(b); }
    r.appendChild(a);
    return r;
  }
  renderList() {
    for (const [k, b] of Object.entries(this.listTabs)) b.classList.toggle('wf-on', k === this.listTab);
    const body = this.listBody; body.innerHTML = '';
    const st = social.store;
    if (this.listTab === 'online') {
      const list = social.players();
      this.list.querySelector('.wf-title span').textContent = `ONLINE NOW (${social.online ? list.length : 1})`;
      if (!social.online) { body.appendChild(el('div', 'wf-empty', `Offline — it is just you, ${escapeHtml(social.me.name)}, for now.<br>Press Enter Embervale (or Host / Join a room) on the title screen to meet people.`)); }
      for (const p of list) {
        const me = p.id === social.id;
        const rel = social.relation(p.id);
        const meta = `${p.guild ? `&lt;${escapeHtml(p.guild)}&gt; ` : ''}Lv${p.level} ${JOB_ICON[p.job] || ''}${cap(p.job)} · ${escapeHtml(p.zone || '?')}${p.party ? ' · in party' : ''}`;
        const acts = me ? [] : [
          ['Message', () => social.act('openChat', `/w ${p.name} `)],
          ['Party', () => social.invite(p.id)],
          ['Trade', () => social.act('trade', p.id)],
        ];
        const r = this.row(p.name + (me ? ' (you)' : ''), meta, acts, true);
        r.querySelector('.wf-name').style.color = { party: '#7dff9a', friend: '#ff9ad5', guild: '#ffd84a', other: '#f4f0dc' }[rel];
        if (!me) r.addEventListener('click', (e) => this.showMenu({ id: p.id, name: p.name, x: e.clientX, y: e.clientY }));
        body.appendChild(r);
      }
    } else if (this.listTab === 'friends') {
      this.list.querySelector('.wf-title span').textContent = `FRIENDS (${st.friends.length})`;
      if (!st.friends.length) body.appendChild(el('div', 'wf-empty', 'No friends yet.<br>Click a name above, or right-click a hero in the world, and choose Add friend.'));
      for (const n of st.friends) {
        const p = social.findPlayer(n);
        const meta = p ? `Lv${p.level} ${cap(p.job)} · ${escapeHtml(p.zone || '')}` : 'offline';
        const r = this.row(n, meta, [
          ['Message', () => social.act('openChat', `/w ${n} `)],
          ['Invite', () => social.invite(n)],
          ['Trade', () => social.act('trade', n)],
          ['✕', () => { social.removeFriend(n); this.renderList(); }, 'wf-danger'],
        ], !!p);
        body.appendChild(r);
      }
    } else if (this.listTab === 'guild') {
      // persisted guilds (src/ui/GuildTab.js via the action registry)
      if (!social.act('renderGuildTab', body, this.list.querySelector('.wf-title span'))) body.appendChild(el('div', 'wf-empty', social.online
        ? 'No guild yet.<br>Create one with /gcreate TAG Guild Name, or join with /gjoin TAG.'
        : 'Guilds live in a shared world.<br>Press Enter Embervale on the title screen, then /gcreate TAG Guild Name.'));
    } else {
      this.list.querySelector('.wf-title span').textContent = `IGNORED (${st.ignored.length})`;
      if (!st.ignored.length) body.appendChild(el('div', 'wf-empty', 'Nobody ignored. Peace and quiet.'));
      for (const n of st.ignored) body.appendChild(this.row(n, 'muted', [['Unignore', () => { social.unignore(n); this.renderList(); }]], !!social.findPlayer(n)));
    }
  }

  // ── party panel ──
  buildParty() {
    const p = this.partyEl = el('div', 'wf-panel wf-list'); p.style.display = 'none';
    p.appendChild(this.titleBar('PARTY', () => this.setParty(false)));
    this.partyBody = el('div', 'wf-scroll');
    const foot = el('div', 'wf-foot');
    this.invInput = el('input'); this.invInput.placeholder = 'player name'; this.invInput.maxLength = 14;
    const inv = el('button', '', 'Invite'); inv.addEventListener('click', () => { if (this.invInput.value.trim()) { social.invite(this.invInput.value.trim()); this.invInput.value = ''; } });
    this.leaveBtn = el('button', 'wf-danger', 'Leave'); this.leaveBtn.addEventListener('click', () => social.leaveParty());
    foot.append(this.invInput, inv, this.leaveBtn);
    p.append(this.partyBody, foot);
    this.root.appendChild(p);
  }
  setParty(v) { this.partyOpen = v; this.partyEl.style.display = v ? 'flex' : 'none'; if (v) { this.setList(false); this.renderParty(); } bus.emit(Events.SOCIAL_UI, { panel: 'party', open: v }); }
  renderParty() {
    const body = this.partyBody; body.innerHTML = '';
    const party = social.party;
    const title = this.partyEl.querySelector('.wf-title span');
    this.leaveBtn.style.display = party ? '' : 'none';
    if (!party) {
      title.textContent = 'PARTY';
      body.appendChild(el('div', 'wf-empty', social.online
        ? 'Not in a party.<br>Invite someone below, right-click a hero, or /invite name.<br>Party members share XP within range.'
        : `Offline — parties need a room.<br>Host or Join from the title screen.`));
      if (social.pendingInvite) {
        const r = el('div', 'wf-row', `<span class="wf-name">${escapeHtml(social.pendingInvite.fromName)}</span><span class="wf-meta">invites you</span>`);
        const a = el('div', 'wf-acts');
        const ok = el('button', '', 'Accept'); ok.addEventListener('click', () => social.accept());
        const no = el('button', 'wf-danger', 'Decline'); no.addEventListener('click', () => social.decline());
        a.append(ok, no); r.appendChild(a); body.appendChild(r);
      }
      return;
    }
    title.textContent = `PARTY (${party.members.length}/5)`;
    for (const m of party.members) {
      const me = m.id === social.id;
      const leader = m.id === party.leader;
      const p = social.roster.get(m.id);
      const hp = m.maxHp ? `${m.hp}/${m.maxHp} HP` : '';
      const meta = `${leader ? '♛ ' : ''}Lv${m.level || p?.level || '?'} ${cap(m.job || p?.job || '')} ${hp}`;
      const acts = [];
      if (!me) acts.push(['Whisper', () => social.act('openChat', `/w ${m.name} `)]);
      if (social.isLeader() && !me) { acts.push(['Promote', () => social.promote(m.id)]); acts.push(['Kick', () => social.kick(m.id), 'wf-danger']); }
      const r = this.row(m.name + (me ? ' (you)' : ''), meta, acts, true);
      if (leader) r.querySelector('.wf-name').style.color = '#ffd84a';
      body.appendChild(r);
    }
  }

  // ── invite toast ──
  buildToast() {
    const t = this.toast = el('div', 'wf-panel wf-toast'); t.style.display = 'none';
    this.toastText = el('span');
    const ok = el('button', '', 'Accept'); ok.addEventListener('click', () => social.accept());
    const no = el('button', 'wf-danger', 'Decline'); no.addEventListener('click', () => social.decline());
    t.append(this.toastText, ok, no);
    this.root.appendChild(t);
  }
  showToast(inv) {
    if (!inv) { this.toast.style.display = 'none'; return; }
    this.toastText.innerHTML = `<b style="color:#ffe8a0">${escapeHtml(inv.fromName)}</b> invites you to a party`;
    this.toast.style.display = 'flex';
  }

  // ── trade composer + incoming trade/duel modals ──
  // One shared modal shell; content depends on mode. Gear-only offers v1.
  buildOffer() {
    const m = this.offer = el('div', 'wf-panel wf-offer'); m.style.display = 'none';
    this.root.appendChild(m);
    this.offerState = null;
  }
  hideOffer() { if (this.offer) this.offer.style.display = 'none'; this.offerState = null; }
  offerShell(title) {
    const m = this.offer; m.innerHTML = '';
    m.appendChild(el('div', 'wf-mh', title));
    const body = el('div', 'wf-obody'); m.appendChild(body);
    const row = el('div', 'wf-orow');
    const back = el('button', 'wf-ghost', 'Cancel');
    back.addEventListener('click', () => this.hideOffer());
    row.appendChild(back); m.appendChild(row);
    m.style.display = 'block';
    return { body, row };
  }
  showOffer(spec) {
    if (spec.kind === 'compose') return this.showCompose(spec.to, spec.gold | 0);
    if (spec.kind === 'duel') {
      const d = social.pendingDuel; if (!d) return;
      const { body, row } = this.offerShell(`Duel challenge`);
      body.appendChild(el('div', 'wf-otext', `<b>${escapeHtml(d.fromName)}</b> challenges you to a duel!<br>First to fall loses.`));
      const ok = el('button', '', 'Accept'); ok.addEventListener('click', () => { social.acceptDuel(); this.hideOffer(); });
      const no = el('button', 'wf-danger', 'Decline'); no.addEventListener('click', () => { social.declineDuel(); this.hideOffer(); });
      row.prepend(ok, no);
      return;
    }
    // incoming trade
    const t = social.pendingTrade; if (!t) return;
    const { body, row } = this.offerShell(`Trade offer`);
    const item = t.item && gearById(t.item);
    body.appendChild(el('div', 'wf-otext', `<b>${escapeHtml(t.fromName)}</b> offers ${t.gold}g${item ? ' + ' + escapeHtml(item.name) : ''}.`));
    const ok = el('button', '', 'Accept'); ok.addEventListener('click', () => { social.acceptTrade(); this.hideOffer(); });
    const no = el('button', 'wf-danger', 'Decline'); no.addEventListener('click', () => { social.declineTrade(); this.hideOffer(); });
    row.prepend(ok, no);
  }
  showCompose(to, preGold = 0) {
    const p = social.findPlayer(to);
    const me = social.world?.player;
    if (!p || !me) { social.system('No one to trade with.'); return; }
    let gold = Math.max(0, Math.min(preGold | 0, me.gold | 0));
    let item = null;
    const { body, row } = this.offerShell(`Trade with ${escapeHtml(p.name || '???')}`);
    const state = { to: p.id || to, gold, item };
    this.offerState = state;
    const goldLine = el('div', 'wf-otext', '');
    const paint = () => { goldLine.innerHTML = `Offer: <b>${state.gold}g</b>${state.item ? ' + ' + escapeHtml(gearById(state.item)?.name || state.item) : ''} <span style="color:#8aa070">(you have ${me.gold}g)</span>`; };
    paint();
    const step = el('div', 'wf-orow');
    const mkStep = (label, d) => { const b = el('button', 'wf-ghost', label); b.addEventListener('click', () => { state.gold = Math.max(0, Math.min(me.gold, state.gold + d)); paint(); }); step.appendChild(b); };
    mkStep('-10', -10); mkStep('-1', -1); mkStep('+1', 1); mkStep('+10', 10);
    body.append(goldLine, step);
    const grid = el('div', 'wf-oitems');
    const paintItems = () => {
      grid.innerHTML = '';
      const inv = [...new Set(me.inventory || [])].slice(0, 12);
      if (!inv.length) grid.appendChild(el('div', 'wf-empty', 'No tradeable gear (materials stay home).'));
      for (const id of inv) {
        const g = gearById(id); if (!g) continue;
        const b = el('button', 'wf-oitem' + (state.item === id ? ' sel' : ''), escapeHtml(g.name));
        b.title = g.name;
        b.addEventListener('click', () => { state.item = state.item === id ? null : id; paint(); paintItems(); });
        grid.appendChild(b);
      }
    };
    paintItems();
    body.appendChild(grid);
    const send = el('button', '', 'Send offer');
    send.addEventListener('click', () => {
      if (!state.gold && !state.item) { social.system('Offer gold or an item.'); return; }
      social.offerTrade(state.to, state.gold, state.item);
      this.hideOffer();
    });
    row.prepend(send);
  }

  // ── context menu ──
  buildMenu() {
    const m = this.menu = el('div', 'wf-panel wf-menu'); m.style.display = 'none';
    this.root.appendChild(m);
  }
  showMenu({ id, name, x, y }) {
    if (!name || name === social.me.name) return;
    const p = social.findPlayer(id || name);
    const sid = p?.id || id;
    const st = social.store;
    const m = this.menu; m.innerHTML = '';
    m.appendChild(el('div', 'wf-mh', `${escapeHtml(name)}${p?.level ? ` <span style="color:#b8a888;font-weight:normal">Lv${p.level} ${cap(p.job)}</span>` : ''}`));
    const item = (label, fn, disabled = false) => { const b = el('button', '', label); b.disabled = disabled; b.addEventListener('click', () => { this.hideMenu(); fn(); }); m.appendChild(b); };
    item('Whisper', () => social.act('openChat', `/w ${name} `));
    const inPartyWithThem = !!social.member(sid);
    if (inPartyWithThem) {
      if (social.isLeader()) { item('Promote to leader', () => social.promote(sid)); item('Kick from party', () => social.kick(sid)); }
    } else item('Invite to party', () => social.invite(sid || name), !social.online || (social.party && !social.isLeader()));
    item('Trade', () => social.act('trade', sid || name), !social.online);   // server-checked trade window (economy)
    item('Quick gift', () => bus.emit(Events.SOCIAL_UI, { panel: 'trade-compose', open: true, to: sid || name })); // 1 gear item + gold, trust model
    item('Duel', () => social.challenge(sid || name));
    item('Send mail', () => social.act('mail', name), !social.online);
    if (st.isFriend(name)) item('Remove friend', () => social.removeFriend(name)); else item('Add friend', () => social.addFriend(name));
    if (st.isIgnored(name)) item('Unignore', () => social.unignore(name)); else item('Ignore', () => social.ignore(name));
    item('Cancel', () => {});
    m.style.display = 'block';
    placeAt(m, x + 4, y + 4);
  }
  hideMenu() { this.menu.style.display = 'none'; }

  destroy() {
    this.off.forEach((f) => f()); this.offActs.forEach((f) => f());
    document.removeEventListener('pointerdown', this.onDocDown, true);
    this.list.remove(); this.partyEl.remove(); this.toast.remove(); this.menu.remove(); this.offer?.remove();
  }
}
