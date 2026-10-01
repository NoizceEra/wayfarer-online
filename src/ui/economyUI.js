import { bus, Events } from '../core/events.js';
import { input } from '../core/input.js';
import { social } from '../systems/social/index.js';
import { econ } from '../net/economyNet.js';
import { trade } from '../systems/trade.js';
import { TradePanel } from './TradePanel.js';
import { MarketPanel } from './MarketPanel.js';
import { MailPanel } from './MailPanel.js';
import { renderGuildTab, answerInvite } from './GuildTab.js';
import { el, setIconScene } from './econDom.js';
import { socialRoot } from './socialDom.js';

// Mounts the player-economy UI for the HUD scene (one call from UIScene):
// trade window + request toast, market board (opened by the notice-board
// clerks: bus 'econ-ui' {panel:'market'}), mailbox (V, or the ✉ badge above
// the server pill), guild tab in the Players panel, and the slash commands
//   /trade name|accept|decline|cancel  /mail [name]  /market
//   /ginvite name /gaccept /gdecline /gkick name /gpromote name /gdemote name
//   /gleader name /gmotd text /gdeposit n /gwithdraw n /ginfo
// Solo / offline: every panel shows a "Play Online" state; nothing is sent.
export function installEconomyUI(uiScene) {
  setIconScene(uiScene);
  econ.setWorld(() => { const w = uiScene.scene.get('world'); return w?.sys?.isActive?.() && w.player ? w : null; });
  const tradeP = new TradePanel();
  const market = new MarketPanel();
  const mail = new MailPanel();

  // ✉ unread badge (DOM, next to the server status pill)
  const badge = el('div', 'ec-badge');
  badge.title = `Mailbox (${input.labelFor('mail') || 'V'})`;
  badge.addEventListener('click', () => mail.toggle());
  socialRoot().appendChild(badge);
  const drawBadge = () => {
    const on = econ.online && econ.ready;
    badge.style.display = on ? 'block' : 'none';
    const n = econ.mailUnread | 0;
    badge.textContent = n ? `✉ ${n} new` : '✉';
    badge.classList.toggle('new', n > 0);
  };

  input.registerAction({ id: 'mail', label: 'Mailbox', group: 'Social', keys: ['KeyV'], gameplay: true });
  const anyOpen = () => tradeP.isOpen || market.isOpen || mail.isOpen;
  const offs = [
    input.on('mail', () => { market.close(); mail.toggle(); return true; }, { scene: uiScene }),
    input.addCloser({ id: 'economy', priority: 960, isOpen: anyOpen, close: () => { if (mail.isOpen) mail.close(); else if (market.isOpen) market.close(); else tradeP.close(); }, scene: uiScene }),
    social.registerAction('trade', (who) => trade.requestTrade(who)),
    social.registerAction('mail', (to) => mail.compose(to)),
    social.registerAction('renderGuildTab', (body, titleEl) => renderGuildTab(body, titleEl)),
    bus.on('econ-ui', (m) => {
      if (m?.panel === 'market') { mail.close(); market.open(m.tab); }
      else if (m?.panel === 'mail') { market.close(); mail.open(m.tab); }
    }),
    econ.on('mail-unread', drawBadge), econ.on('state', drawBadge), econ.on('status', drawBadge),
    bus.on(Events.NET_STATUS, drawBadge),
  ];
  drawBadge();
  installCommands(mail);

  const api = {
    trade: tradeP, market, mail, anyOpen,
    destroy() { offs.forEach((o) => { try { o(); } catch { /* ignore */ } }); tradeP.destroy(); market.destroy(); mail.destroy(); badge.remove(); },
  };
  uiScene.events.once('shutdown', () => api.destroy());
  window.__econUI = api; // debug / automated tests
  return api;
}

// Wrap social.command once so economy slash commands work from the chat box.
let mailRef = null;
function installCommands(mail) {
  mailRef = mail;
  if (social._econCommands) return;
  social._econCommands = true;
  const orig = social.command.bind(social);
  const say = (t) => social.system(t);
  social.command = (raw) => {
    const [c0, ...rest] = String(raw).slice(1).split(' ');
    const cmd = c0.toLowerCase(); const arg = rest.join(' ').trim(); const first = rest[0] || '';
    const n = Math.floor(Number(first));
    switch (cmd) {
      case 'trade': case 'tr':
        if (first === 'accept' || first === 'yes') return trade.respond(true);
        if (first === 'decline' || first === 'no') return trade.respond(false);
        if (first === 'cancel') return trade.cancel();
        if (!first) return say('Usage: /trade name  (or right-click a player > Trade)');
        return trade.requestTrade(first);
      case 'mail': case 'mailbox': return first ? mailRef?.compose(first) : mailRef?.toggle();
      case 'market': case 'ah': case 'auction': return say('The market board is run by the clerks by the notice boards in Thistle Town and Dock Town.');
      case 'ginvite': return first ? econ.send('guild-invite', { name: first }) : say('Usage: /ginvite name');
      case 'gaccept': return answerInvite(true);
      case 'gdecline': return answerInvite(false);
      case 'gkick': return first ? econ.send('guild-kick', { name: first }) : say('Usage: /gkick name');
      case 'gpromote': return first ? econ.send('guild-rank', { name: first, rank: 'officer' }) : say('Usage: /gpromote name');
      case 'gdemote': return first ? econ.send('guild-rank', { name: first, rank: 'member' }) : say('Usage: /gdemote name');
      case 'gleader': return first ? econ.send('guild-rank', { name: first, rank: 'leader' }) : say('Usage: /gleader name');
      case 'gmotd': return econ.send('guild-motd', { text: arg });
      case 'gdeposit': return n > 0 ? econ.send('guild-deposit', { gold: n }, { rev: true, sync: true }) : say('Usage: /gdeposit gold');
      case 'gwithdraw': return n > 0 ? econ.send('guild-withdraw', { gold: n }, { rev: true, sync: true }) : say('Usage: /gwithdraw gold');
      case 'ginfo': case 'guildinfo': {
        const g = econ.guild;
        if (!g) return say(econ.online ? 'You are not in a guild. /gcreate TAG Name' : 'Play Online to use guilds.');
        return say(`<${g.tag}> ${g.name} · bank ${g.bank}g · MOTD: ${g.motd || '-'} · ${g.members.map((m) => `${m.name}${m.rank === 'member' ? '' : ` (${m.rank})`}${m.online ? '' : ' [off]'}`).join(', ')}`);
      }
      case 'help': case '?':
        orig(raw);
        return say(`Economy: /trade name · /mail [name] · /ginvite /gaccept /gkick /gpromote /gdemote /gleader /gmotd /gdeposit /gwithdraw /ginfo. Mailbox: ${input.labelFor('mail')}. Market: talk to the notice-board clerks.`);
      default: return orig(raw);
    }
  };
}
