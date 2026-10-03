import { net } from './NetworkManager.js';
import { bus, Events } from '../core/events.js';

// Social message handlers, registered on every attached room via
// net.onAttach (kept out of NetworkManager so sync/reconnect work can evolve
// independently). Incoming types (see server/social.js for the full table):
//   roster, presence, presence-gone, schat, whisper, whisper-sent, emote,
//   party-invite, party-update, party-msg, party-xp, party-status,
//   guild-update, social-error
// Outgoing is plain net.send(type, payload) from systems/social/index.js:
//   presence, who, schat, whisper, emote, party-invite/accept/decline/leave/
//   kick/promote/xp/status, guild-create/join/leave
export function installSocialNet(social) {
  const off = net.onAttach((room) => {
    const on = (type, fn) => room.onMessage(type, (m) => { try { fn(m); } catch (e) { console.error(`[social] ${type}`, e); } });
    on('roster', (list) => social.setRoster(list));
    on('presence', (p) => social.upsertPresence(p));
    on('presence-gone', (m) => social.removePresence(m.id));
    on('schat', (m) => social.onChat(m));
    on('whisper', (m) => social.onWhisper(m));
    on('whisper-sent', (m) => social.onWhisperSent(m));
    on('emote', (m) => social.onEmote(m));
    on('trade-offer', (m) => social.onTradeOffer(m));
    on('trade-sent', (m) => social.onTradeSent(m));
    on('trade-done', (m) => social.onTradeDone(m));
    on('duel-challenge', (m) => social.onDuelChallenge(m));
    on('duel-decline', (m) => social.system(`${m.fromName || '???'} declined your duel.`));
    on('duel-start', (m) => social.onDuelStart(m));
    on('duel-end', (m) => social.onDuelEnd(m));
    on('pvp-hit', (m) => social.onPvpHit(m));
    on('pet-duel', (m) => {
      if (m?.action === 'challenge') {
        social.pendingDuel = { from: m.from, fromName: m.fromName || '???', at: Date.now() };
        social.system(`${m.fromName || '???'} challenges you to a pet duel! /dtaccept or /dtdecline`);
        bus.emit(Events.SOCIAL_UI, { panel: 'pet-duel', open: true, duel: social.pendingDuel });
        clearTimeout(social._duelT);
        social._duelT = setTimeout(() => { if (social.pendingDuel?.from === m.from) social.declineDuel(true); }, 45000);
      } else if (m?.action === 'declined') {
        social.system(`${m.fromName || '???'} declined your pet duel.`);
      } else if (m?.action === 'start') {
        const peerId = m.a === social.id ? m.b : m.a;
        const peer = social.roster.get(peerId) || social.findPlayer(peerId);
        social.duel = { peerId, peerName: peer?.name || m.bName || '???' };
        social.system(`PET DUEL vs ${social.duel.peerName}!`);
        bus.emit(Events.SOCIAL_ROSTER, social.players());
      } else if (m?.action === 'end') {
        if (!social.duel) return;
        const reason = m.reason === 'forfeit' ? `${social.duel.peerName} forfeited.` : m.reason === 'left' ? `${social.duel.peerName} left — duel over.` : 'Pet duel over.';
        social.duel = null;
        social.system(reason);
        bus.emit(Events.SOCIAL_ROSTER, social.players());
      }
    });
    on('party-invite', (m) => social.onInvite(m));
    on('party-update', (m) => social.onPartyUpdate(m));
    on('party-msg', (m) => social.addLine({ ch: 'party', text: m.text, plain: true }));
    on('party-xp', (m) => social.onPartyXp(m));
    on('party-status', (m) => social.onPartyStatus(m));
    on('guild-update', (m) => social.onGuildUpdate(m));
    on('social-error', (m) => social.system(m.msg || 'Something went wrong.'));
    social.onConnected();
  });
  // NET_CONNECTED fires after attach(); re-announce presence in case the
  // hero's level/zone was set between the two.
  const offBus = bus.on(Events.NET_CONNECTED, () => social.onConnected());
  return { destroy() { off(); offBus(); } };
}
