import { econ, isTradable } from '../net/economyNet.js';
import { bus, Events } from '../core/events.js';
import { el, escapeHtml, panel, tabs, chip, offlineNote } from './econDom.js';

// Mailbox (DOM, hotkey V or the ✉ HUD badge). INBOX lists player + system
// mail (market sales, expired / returned listings); open one to read it and
// take its gold / items. COMPOSE sends a letter by character name with up to
// 5 bag items and gold attached (5g postage). Everything is stored on the
// relay per character, so mail waits for you while you are offline.
export class MailPanel {
  constructor() {
    const { p, title } = panel('ec-mail', 'MAILBOX', () => this.close());
    this.el = p; this.titleEl = title;
    this.tab = 'inbox'; this.box = null; this.openId = null;
    this.draft = { to: '', subject: '', body: '', gold: 0, items: [] };
    this.tabs = tabs([['inbox', 'Inbox'], ['compose', 'Compose']], (id) => { this.tab = id; this.openId = null; this.render(); });
    this.body = el('div', 'ec-body ec-list');
    this.foot = el('div', 'ec-foot');
    p.append(this.tabs.bar, this.body, this.foot);
    this.offs = [
      econ.on('mail-box', (m) => { this.box = m; if (this.isOpen) this.render(); }),
      econ.on('mail-unread', () => { if (this.isOpen && this.tab === 'inbox') econ.send('mail-list', {}); }),
      econ.on('sync', (m) => { if (m.why === 'mail-send') { this.draft = { to: '', subject: '', body: '', gold: 0, items: [] }; this.tab = 'inbox'; if (this.isOpen) this.render(); } }),
      econ.on('state', () => { if (this.isOpen) { this.render(); econ.send('mail-list', {}); } }),
      econ.on('status', () => { if (this.isOpen) this.render(); }),
    ];
  }
  get isOpen() { return this.el.style.display !== 'none'; }
  open(tab) {
    if (tab) this.tab = tab;
    this.el.style.display = 'flex';
    this.render();
    if (econ.online) econ.send('mail-list', {});
  }
  close() { this.el.style.display = 'none'; this.openId = null; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  compose(to) { this.draft.to = to || ''; this.open('compose'); }

  render() {
    this.tabs.set(this.tab);
    const b = this.body; const f = this.foot; b.innerHTML = ''; f.innerHTML = '';
    const unread = this.box?.unread ?? econ.mailUnread;
    this.titleEl.textContent = `MAILBOX${unread ? ` (${unread} unread)` : ''}`;
    if (!econ.online) { b.appendChild(offlineNote('mail')); return; }
    if (this.tab === 'compose') { this.renderCompose(b, f); return; }
    if (!this.box) { b.appendChild(el('div', 'wf-empty', 'Loading…')); return; }
    const m = this.openId && this.box.mails.find((x) => x.id === this.openId);
    if (m) { this.renderMail(b, f, m); return; }
    if (!this.box.mails.length) b.appendChild(el('div', 'wf-empty', 'No mail yet.<br>Market sales and returned listings arrive here.'));
    for (const x of this.box.mails) {
      const att = (x.gold ? ` · <span class="ec-gold">${x.gold}g</span>` : '') + (x.items?.length ? ` · ${x.items.length} item${x.items.length > 1 ? 's' : ''}` : '');
      const r = el('div', `wf-row ec-mail${x.read ? '' : ' unread'}`);
      r.innerHTML = `<span class="wf-dot ${x.read ? '' : 'on'}"></span><span class="wf-name">${escapeHtml(x.subject)}</span><span class="wf-meta">${x.sys ? '📜 ' : ''}${escapeHtml(x.from)} · ${new Date(x.at).toLocaleDateString()}${att}</span>`;
      r.addEventListener('click', () => { this.openId = x.id; if (!x.read) econ.send('mail-read', { id: x.id }); this.render(); });
      b.appendChild(r);
    }
    const refresh = el('button', '', 'Refresh'); refresh.addEventListener('click', () => econ.send('mail-list', {}));
    f.append(el('span', 'ec-dim', `${this.box.mails.length} letter${this.box.mails.length === 1 ? '' : 's'}`), el('span', 'ec-grow'), refresh);
  }

  renderMail(b, f, m) {
    b.appendChild(el('div', 'ec-h', `${escapeHtml(m.subject)} <span class="ec-tag ec-dim">${new Date(m.at).toLocaleString()}</span>`));
    b.appendChild(el('div', 'ec-dim', `From ${escapeHtml(m.from)}${m.sys ? ' (system)' : ''}`));
    if (m.body) b.appendChild(el('div', 'ec-row', escapeHtml(m.body)));
    const has = m.gold || m.items?.length;
    if (has) {
      b.appendChild(el('div', 'ec-h', 'ATTACHED'));
      const g = el('div', 'ec-grid');
      if (m.gold) g.appendChild(el('span', 'ec-gold', `${m.gold} gold`));
      for (const id of m.items || []) g.appendChild(chip(id, null, { small: true }));
      b.appendChild(g);
    }
    const back = el('button', '', '‹ Inbox'); back.addEventListener('click', () => { this.openId = null; this.render(); });
    f.append(back, el('span', 'ec-grow'));
    if (has) {
      const take = el('button', '', 'Take attachments');
      take.addEventListener('click', () => { take.disabled = true; econ.send('mail-claim', { id: m.id }, { rev: true, sync: true }); });
      f.appendChild(take);
    } else {
      const del = el('button', 'wf-danger', 'Delete');
      del.addEventListener('click', () => { this.openId = null; econ.send('mail-delete', { id: m.id }); });
      f.appendChild(del);
    }
    if (!m.sys) { const re = el('button', '', 'Reply'); re.addEventListener('click', () => { this.draft.to = m.from; this.draft.subject = `Re: ${m.subject}`.slice(0, 40); this.tab = 'compose'; this.openId = null; this.render(); }); f.appendChild(re); }
  }

  renderCompose(b, f) {
    const d = this.draft;
    const p = econ.player();
    const r1 = el('div', 'ec-row');
    const to = el('input'); to.placeholder = 'to (character name)'; to.maxLength = 14; to.value = d.to; to.style.flex = '1';
    to.addEventListener('input', () => { d.to = to.value; });
    const gold = el('input'); gold.type = 'number'; gold.min = '0'; gold.value = String(d.gold || 0); gold.style.width = '70px';
    gold.addEventListener('input', () => { d.gold = Math.max(0, Math.floor(Number(gold.value) || 0)); });
    r1.append(to, el('span', 'ec-gold', 'gold'), gold);
    const subj = el('input'); subj.placeholder = 'subject'; subj.maxLength = 40; subj.value = d.subject; subj.style.width = '100%';
    subj.addEventListener('input', () => { d.subject = subj.value; });
    const body = el('textarea'); body.maxLength = 200; body.placeholder = 'message (200 chars)'; body.value = d.body;
    body.addEventListener('input', () => { d.body = body.value; });
    b.append(r1, el('div', 'ec-row', ''), subj, el('div', 'ec-row', ''), body);
    b.appendChild(el('div', 'ec-h', `ATTACH (${d.items.length}/${econ.cfg.mailItems}) - click to add / remove`));
    const att = el('div', 'ec-grid');
    d.items.forEach((id, i) => att.appendChild(chip(id, () => { d.items.splice(i, 1); this.render(); }, { small: true })));
    if (!d.items.length) att.appendChild(el('span', 'ec-dim', 'no attachments'));
    b.appendChild(att);
    const bag = el('div', 'ec-grid');
    const left = [...(p?.inventory || [])];
    for (const id of d.items) { const i = left.indexOf(id); if (i >= 0) left.splice(i, 1); }
    for (const id of left) bag.appendChild(chip(id, isTradable(id) && d.items.length < econ.cfg.mailItems ? () => { d.items.push(id); this.render(); } : null, { small: true }));
    b.appendChild(el('div', 'ec-h', 'YOUR BAG'));
    b.appendChild(bag);
    const send = el('button', '', 'Send');
    send.addEventListener('click', () => {
      if (!d.to.trim()) { bus.emit(Events.SYSTEM, 'Who is it for?'); return; }
      const cost = (d.gold | 0) + econ.cfg.postage;
      if (p && p.gold < cost) { bus.emit(Events.SYSTEM, `You need ${cost} gold (incl. ${econ.cfg.postage}g postage).`); return; }
      econ.send('mail-send', { to: d.to.trim(), subject: d.subject, body: d.body, gold: d.gold | 0, items: [...d.items] }, { rev: true, sync: true });
    });
    f.append(el('span', 'ec-dim', `postage ${econ.cfg.postage}g`), el('span', 'ec-grow'), send);
  }
  destroy() { this.offs.forEach((o) => o()); this.el.remove(); }
}
