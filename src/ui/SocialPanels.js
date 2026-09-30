import { bus, Events } from '../core/events.js';
import { social } from '../systems/social/index.js';
import { socialRoot, el, escapeHtml, placeAt } from './socialDom.js';

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
    this.buildList(); this.buildParty(); this.buildToast(); this.buildMenu();
    this.off = [
      bus.on(Events.SOCIAL_ROSTER, () => { if (this.listOpen) this.renderList(); if (this.partyOpen) this.renderParty(); }),
      bus.on(Events.SOCIAL_PARTY, () => { if (this.partyOpen) this.renderParty(); if (this.listOpen) this.renderList(); }),
      bus.on(Events.SOCIAL_UI, (m) => { if (m.panel === 'invite') this.showToast(m.open ? m.invite : null); }),
    ];
    this.offActs = [
      social.registerAction('openFriends', () => this.setList(!this.listOpen)),
      social.registerAction('openParty', () => this.setParty(!this.partyOpen)),
      social.registerAction('contextMenu', (o) => this.showMenu(o)),
    ];
    this.onDocDown = (e) => { if (this.menu.style.display !== 'none' && !this.menu.contains(e.target)) this.hideMenu(); };
    document.addEventListener('pointerdown', this.onDocDown, true);
  }
  get anyOpen() { return this.listOpen || this.partyOpen || this.menu.style.display !== 'none'; }
  closeAll() { let c = false; if (this.listOpen) { this.setList(false); c = true; } if (this.partyOpen) { this.setParty(false); c = true; } if (this.menu.style.display !== 'none') { this.hideMenu(); c = true; } return c; }

  titleBar(text, onClose) {
    const t = el('div', 'wf-title', `<span>${text}</span>`);
    const x = el('button', 'wf-ghost wf-x', '✕'); x.addEventListener('click', onClose);
    t.appendChild(x); return t;
  }

  // ── players / friends / ignored ──
  buildList() {
    const p = this.list = el('div', 'wf-panel wf-list'); p.style.display = 'none';
    p.appendChild(this.titleBar('PLAYERS', () => this.setList(false)));
    const tabs = el('div', 'wf-tabs');
    this.listTabs = {};
    for (const [id, label] of [['online', 'Online'], ['friends', 'Friends'], ['ignored', 'Ignored']]) {
      const b = el('button', '', label); b.addEventListener('click', () => { this.listTab = id; this.renderList(); });
      tabs.appendChild(b); this.listTabs[id] = b;
    }
    this.listBody = el('div', 'wf-scroll');
    const foot = el('div', 'wf-foot');
    this.listInput = el('input'); this.listInput.placeholder = 'name'; this.listInput.maxLength = 14;
    const addF = el('button', '', '+ Friend'); addF.addEventListener('click', () => { if (this.listInput.value.trim()) { social.addFriend(this.listInput.value); this.listInput.value = ''; this.renderList(); } });
    const who = el('button', '', '/who'); who.addEventListener('click', () => social.who());
    foot.append(this.listInput, addF, who);
    p.append(tabs, this.listBody, foot);
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
      this.list.querySelector('.wf-title span').textContent = `PLAYERS ONLINE (${social.online ? list.length : 1})`;
      if (!social.online) { body.appendChild(el('div', 'wf-empty', `Offline — only you, ${escapeHtml(social.me.name)}.<br>Host or Join a room from the title screen.`)); }
      for (const p of list) {
        const me = p.id === social.id;
        const rel = social.relation(p.id);
        const meta = `${p.guild ? `&lt;${escapeHtml(p.guild)}&gt; ` : ''}Lv${p.level} ${JOB_ICON[p.job] || ''}${cap(p.job)} · ${escapeHtml(p.zone || '?')}${p.party ? ' · in party' : ''}`;
        const r = this.row(p.name + (me ? ' (you)' : ''), meta, me ? [] : [['…', () => {}]], true);
        r.querySelector('.wf-name').style.color = { party: '#7dff9a', friend: '#ff9ad5', guild: '#ffd84a', other: '#f4f0dc' }[rel];
        if (!me) r.addEventListener('click', (e) => this.showMenu({ id: p.id, name: p.name, x: e.clientX, y: e.clientY }));
        body.appendChild(r);
      }
    } else if (this.listTab === 'friends') {
      this.list.querySelector('.wf-title span').textContent = `FRIENDS (${st.friends.length})`;
      if (!st.friends.length) body.appendChild(el('div', 'wf-empty', 'No friends yet.<br>Right-click a hero or use /friend name.'));
      for (const n of st.friends) {
        const p = social.findPlayer(n);
        const meta = p ? `Lv${p.level} ${cap(p.job)} · ${escapeHtml(p.zone || '')}` : 'offline';
        const r = this.row(n, meta, [
          ['Whisper', () => social.act('openChat', `/w ${n} `)],
          ['Invite', () => social.invite(n)],
          ['✕', () => { social.removeFriend(n); this.renderList(); }, 'wf-danger'],
        ], !!p);
        body.appendChild(r);
      }
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
    item('Trade (coming soon)', () => social.system('Trading is not in yet — soon!'), true);
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
    this.list.remove(); this.partyEl.remove(); this.toast.remove(); this.menu.remove();
  }
}
