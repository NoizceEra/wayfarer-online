import { bus, Events } from '../core/events.js';
import { input } from '../core/input.js';
import { social } from '../systems/social/index.js';
import { econ } from '../net/economyNet.js';
import { trade } from '../systems/trade.js';
import { TradePanel } from './TradePanel.js';
import { TradeEscrowPanel } from './TradeEscrowPanel.js';
import { MarketPanel } from './MarketPanel.js';
import { MailPanel } from './MailPanel.js';
import { renderGuildTab, answerInvite } from './GuildTab.js';
import { ClaimPanel } from './ClaimPanel.js';
import { ReferralPanel, mountReferralCta } from './ReferralPanel.js';
import { PartyFinderPanel } from './PartyFinderPanel.js';
import { TokenSinkPanel } from './TokenSinkPanel.js';
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
  const escrowP = new TradeEscrowPanel();
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
  const claimP = new ClaimPanel();
  const referralP = new ReferralPanel();
  const partyFinderP = new PartyFinderPanel();
  const sinksP = new TokenSinkPanel();
  const anyOpen = () => tradeP.isOpen || escrowP.isOpen || market.isOpen || mail.isOpen || claimP.isOpen || referralP.isOpen || partyFinderP.isOpen || sinksP.isOpen;
  const offs = [
    input.on('mail', () => { market.close(); escrowP.close(); tradeP.close(); sinksP.close(); mail.toggle(); return true; }, { scene: uiScene }),
    input.addCloser({ id: 'economy', priority: 960, isOpen: anyOpen, close: () => { if (mail.isOpen) mail.close(); else if (market.isOpen) market.close(); else if (escrowP.isOpen) escrowP.close(); else if (referralP.isOpen) referralP.close(); else if (partyFinderP.isOpen) partyFinderP.close(); else if (sinksP.isOpen) sinksP.close(); else if (claimP.isOpen) claimP.close(); else tradeP.close(); }, scene: uiScene }),
    social.registerAction('trade', (who) => trade.requestTrade(who)),
    social.registerAction('escrow', (who) => trade.requestEscrow(who)),
    social.registerAction('mail', (to) => mail.compose(to)),
    social.registerAction('renderGuildTab', (body, titleEl) => renderGuildTab(body, titleEl)),
    bus.on('econ-ui', (m) => {
      if (m?.panel === 'market') { mail.close(); tradeP.close(); escrowP.close(); claimP.close(); market.open(m.tab); }
      else if (m?.panel === 'mail') { market.close(); tradeP.close(); escrowP.close(); claimP.close(); mail.open(m.tab); }
      else if (m?.panel === 'claim') { market.close(); tradeP.close(); escrowP.close(); mail.close(); sinksP.close(); claimP.open(); }
      else if (m?.panel === 'sinks') { market.close(); tradeP.close(); escrowP.close(); mail.close(); claimP.close(); sinksP.open(); }
    }),
    econ.on('mail-unread', drawBadge), econ.on('state', drawBadge), econ.on('status', drawBadge),
    bus.on(Events.NET_STATUS, drawBadge),
  ];
  drawBadge();
  const refCta = mountReferralCta(() => referralP.open());
  installCommands(mail);

  const api = {
    trade: tradeP, escrow: escrowP, market, mail, claim: claimP, referral: referralP, partyFinder: partyFinderP, sinks: sinksP, anyOpen,
    destroy() { offs.forEach((o) => { try { o(); } catch { /* ignore */ } }); tradeP.destroy(); escrowP.destroy(); market.destroy(); mail.destroy(); claimP.destroy(); referralP.destroy(); partyFinderP.destroy(); sinksP.destroy(); badge.remove(); refCta.destroy(); },
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
      case 'escrow': case 'esc':
        if (first === 'accept' || first === 'yes') return trade.respondEscrow(true);
        if (first === 'decline' || first === 'no') return trade.respondEscrow(false);
        if (first === 'cancel') return trade.cancelEscrow();
        if (!first) return say('Usage: /escrow name  (or right-click a player > Escrow Trade)');
        return trade.requestEscrow(first);
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
      case 'claim': return bus.emit('econ-ui', { panel: 'claim' });
      case 'sinks': case 'tokensinks': return window.__econUI?.sinks?.toggle();
      case 'refer': case 'referral': return window.__econUI?.referral?.toggle();
      case 'partyfinder': case 'finder': case 'lfg': return window.__econUI?.partyFinder?.toggle(uiScene);
      case 'pets': case 'pet': {
        // Toggle pet panel via the social UI if it's mounted; otherwise emit the generic event.
        const socialApi = window.__socialUI;
        if (socialApi?.petPanel) { socialApi.petPanel.toggle(); return; }
        return bus.emit(Events.SOCIAL_UI, { panel: 'pet-panel', open: true });
      }
      case 'petduel': case 'pd': if (!first) return say('Usage: /petduel name'); return social.challengePetDuel(first);
      case 'pda': return social.acceptPetDuel();
      case 'pdd': return social.declinePetDuel();
      case 'petbattle': case 'pvb': return say('Walk up to a wild pet wisp and press E to capture it; /petduel name to challenge a player.');
      case 'ginfo': case 'guildinfo': {
        const g = econ.guild;
        if (!g) return say(econ.online ? 'You are not in a guild. /gcreate TAG Name' : 'Play Online to use guilds.');
        return say(`<${g.tag}> ${g.name} · bank ${g.bank}g · MOTD: ${g.motd || '-'} · ${g.members.map((m) => `${m.name}${m.rank === 'member' ? '' : ` (${m.rank})`}${m.online ? '' : ' [off]'}`).join(', ')}`);
      }
      case 'help': case '?':
        orig(raw);
        return say(`Economy: /trade name · /mail [name] · /claim · /sinks · /refer · /finder · /pet · /petduel name · /pda · /pdd · /ginvite /gaccept /gkick /gpromote /gdemote /gleader /gmotd /gdeposit /gwithdraw /ginfo. Mailbox: ${input.labelFor('mail')}. Market: talk to the notice-board clerks.`);
      default: return orig(raw);
    }
  };
}
