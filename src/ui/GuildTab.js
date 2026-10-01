import { econ } from '../net/economyNet.js';
import { net } from '../net/NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { el, escapeHtml } from './econDom.js';

// Guild tab of the Players panel (O). Rendered on demand by
// src/ui/SocialPanels.js through social.act('renderGuildTab', body, titleEl).
// Guilds are persisted on the relay (server/economy.js): name, tag, ranks
// (leader / officer / member), MOTD, a gold bank, invite by name.
let pendingInvite = null; // {tag, name, from}
econ.on('guild-invite', (m) => {
  pendingInvite = { ...m, at: Date.now() };
  bus.emit(Events.SYSTEM, `${m.from} invites you to the guild <${m.tag}> ${m.name}. /gaccept or /gdecline`);
  bus.emit(Events.SOCIAL_ROSTER, null);
});
export const guildInvite = () => (pendingInvite && Date.now() - pendingInvite.at < 60_000 ? pendingInvite : null);
export function answerInvite(yes) {
  const inv = guildInvite(); pendingInvite = null;
  if (!inv) { bus.emit(Events.SYSTEM, 'No pending guild invite.'); return; }
  econ.send(yes ? 'guild-accept' : 'guild-decline', { tag: inv.tag });
}

const RANK_ICON = { leader: '♛', officer: '★', member: '·' };

export function renderGuildTab(body, titleEl) {
  const g = econ.guild;
  titleEl.textContent = g ? `GUILD <${g.tag}>` : 'GUILD';
  if (!econ.online) { body.appendChild(el('div', 'wf-empty', 'Play Online to found or join a guild.<br>Guilds, their bank and ranks are saved on the server.')); return; }
  const inv = guildInvite();
  if (!g) {
    if (inv) {
      const r = el('div', 'wf-row', `<span class="wf-name">&lt;${escapeHtml(inv.tag)}&gt; ${escapeHtml(inv.name)}</span><span class="wf-meta">invite from ${escapeHtml(inv.from)}</span>`);
      const a = el('div', 'wf-acts');
      const ok = el('button', '', 'Join'); ok.addEventListener('click', () => answerInvite(true));
      const no = el('button', 'wf-danger', 'No'); no.addEventListener('click', () => { answerInvite(false); bus.emit(Events.SOCIAL_ROSTER, null); });
      a.append(ok, no); r.appendChild(a); body.appendChild(r);
    }
    body.appendChild(el('div', 'wf-empty', 'You are not in a guild.<br>Found one below, or ask an officer to invite you.'));
    const f = el('div', 'wf-foot');
    const tag = el('input'); tag.placeholder = 'TAG'; tag.maxLength = 4; tag.style.maxWidth = '54px'; tag.style.minWidth = '40px';
    const name = el('input'); name.placeholder = 'guild name'; name.maxLength = 24;
    const mk = el('button', '', 'Found');
    mk.addEventListener('click', () => { if (tag.value.trim().length >= 2) econ.send('guild-create', { tag: tag.value.trim(), name: name.value.trim() }); else bus.emit(Events.SYSTEM, 'Tag: 2-4 letters or digits.'); });
    f.append(tag, name, mk);
    body.appendChild(f);
    return;
  }
  const staff = g.myRank === 'leader' || g.myRank === 'officer';
  body.appendChild(el('div', 'wf-row', `<span class="wf-name" style="color:#ffd84a">${escapeHtml(g.name)}</span><span class="wf-meta">leader ${escapeHtml(g.leader)} · you: ${g.myRank}</span>`));
  // MOTD
  const motd = el('div', 'wf-row', `<span class="wf-meta" style="color:#f4f0dc">“${escapeHtml(g.motd || '...')}”</span>`);
  if (staff) {
    const a = el('div', 'wf-acts'); const ed = el('button', '', 'Edit');
    ed.addEventListener('click', () => {
      motd.innerHTML = '';
      const i = el('input'); i.maxLength = 120; i.value = g.motd || ''; i.style.flex = '1';
      const s = el('button', '', 'Save'); s.addEventListener('click', () => econ.send('guild-motd', { text: i.value }));
      motd.append(i, s); i.focus();
    });
    a.appendChild(ed); motd.appendChild(a);
  }
  body.appendChild(motd);
  // bank
  const bank = el('div', 'wf-row', `<span class="wf-name">Bank</span><span class="wf-meta" style="color:#f4c542">${g.bank} gold</span>`);
  const ba = el('div', 'wf-acts');
  const amt = el('input'); amt.type = 'number'; amt.min = '1'; amt.placeholder = 'g'; amt.style.width = '56px';
  const dep = el('button', '', 'Deposit');
  dep.addEventListener('click', () => { const v = Math.floor(Number(amt.value) || 0); if (v > 0) econ.send('guild-deposit', { gold: v }, { rev: true, sync: true }); });
  ba.append(amt, dep);
  if (g.myRank === 'leader') {
    const wd = el('button', '', 'Withdraw');
    wd.addEventListener('click', () => { const v = Math.floor(Number(amt.value) || 0); if (v > 0) econ.send('guild-withdraw', { gold: v }, { rev: true, sync: true }); });
    ba.appendChild(wd);
  }
  bank.appendChild(ba);
  body.appendChild(bank);
  // members
  for (const m of g.members) {
    const r = el('div', 'wf-row', `<span class="wf-dot ${m.online ? 'on' : ''}"></span><span class="wf-name">${RANK_ICON[m.rank] || ''} ${escapeHtml(m.name)}</span><span class="wf-meta">${m.rank}</span>`);
    const a = el('div', 'wf-acts');
    const me = m.name.toLowerCase() === String(net.name || '').toLowerCase();
    const act = (label, fn, cls) => { const b = el('button', cls || '', label); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); a.appendChild(b); };
    if (!me && g.myRank === 'leader') {
      if (m.rank === 'member') act('▲', () => econ.send('guild-rank', { name: m.name, rank: 'officer' }));
      if (m.rank === 'officer') { act('▼', () => econ.send('guild-rank', { name: m.name, rank: 'member' })); act('♛', () => econ.send('guild-rank', { name: m.name, rank: 'leader' })); }
    }
    if (!me && (g.myRank === 'leader' || (g.myRank === 'officer' && m.rank === 'member'))) act('Kick', () => econ.send('guild-kick', { name: m.name }), 'wf-danger');
    r.appendChild(a);
    body.appendChild(r);
  }
  if (g.log?.length) {
    body.appendChild(el('div', 'wf-row', `<span class="wf-meta">${g.log.slice(-5).reverse().map((l) => escapeHtml(l.text)).join('<br>')}</span>`));
  }
  const f = el('div', 'wf-foot');
  if (staff) {
    const who = el('input'); who.placeholder = 'invite player'; who.maxLength = 14;
    const inv2 = el('button', '', 'Invite'); inv2.addEventListener('click', () => { if (who.value.trim()) { econ.send('guild-invite', { name: who.value.trim() }); who.value = ''; } });
    f.append(who, inv2);
  }
  const leave = el('button', 'wf-danger', 'Leave');
  leave.addEventListener('click', () => {
    if (leave.dataset.armed) { econ.send('guild-leave', {}); return; }
    leave.dataset.armed = '1'; leave.textContent = g.members.length === 1 ? 'Disband?' : 'Sure?';
    setTimeout(() => { delete leave.dataset.armed; leave.textContent = 'Leave'; }, 3000);
  });
  f.appendChild(leave);
  body.appendChild(f);
}
