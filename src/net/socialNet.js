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
    on('trade-offer', (m) => { if (m?.sessionId !== undefined) return; social.onTradeOffer(m); });
    on('trade-sent', (m) => { if (m?.sessionId !== undefined) return; social.onTradeSent(m); });
    on('trade-done', (m) => { if (m?.sessionId !== undefined) return; social.onTradeDone(m); });
    on('duel-challenge', (m) => { if (m?.sessionId !== undefined) return; social.onDuelChallenge(m); });
    on('duel-decline', (m) => { if (m?.sessionId !== undefined) return; social.system(`${m.fromName || '???'} declined your duel.`); });
    on('duel-start', (m) => { if (m?.sessionId !== undefined) return; social.onDuelStart(m); });
    on('duel-end', (m) => { if (m?.sessionId !== undefined) return; social.onDuelEnd(m); });
    on('pvp-hit', (m) => { if (m?.sessionId !== undefined) return; social.onPvpHit(m); });
    on('pet-duel', (m) => {
      if (m?.sessionId !== undefined) return;
      if (m?.action === 'challenge') {
        social.onPetDuelChallenge(m);
      } else if (m?.action === 'declined') {
        social.system(`${m.fromName || '???'} declined your pet duel.`);
      } else if (m?.action === 'start') {
        const peerId = m.a === social.id ? m.b : m.a;
        const peer = social.roster.get(peerId) || social.findPlayer(peerId);
        social.duel = { peerId, peerName: peer?.name || m.bName || '???' };
        social.system(`PET DUEL vs ${social.duel.peerName}!`);
        bus.emit(Events.PET_DUEL_START, { ...m, mySide: m.a === social.id ? 'a' : 'b' });
        bus.emit(Events.SOCIAL_ROSTER, social.players());
      } else if (m?.action === 'end') {
        if (!social.duel) return;
        const reason = m.reason === 'forfeit' ? `${social.duel.peerName} forfeited.` : m.reason === 'left' ? `${social.duel.peerName} left — duel over.` : 'Pet duel over.';
        social.duel = null;
        social.system(reason);
        bus.emit(Events.SOCIAL_ROSTER, social.players());
      }
    });
    on('party-invite', (m) => { if (m?.sessionId !== undefined) return; social.onInvite(m); });
    on('party-update', (m) => { if (m?.sessionId !== undefined) return; social.onPartyUpdate(m); });
    on('party-msg', (m) => { if (m?.sessionId !== undefined) return; social.addLine({ ch: 'party', text: m.text, plain: true }); });
    on('party-xp', (m) => { if (m?.sessionId !== undefined) return; social.onPartyXp(m); });
    on('party-status', (m) => { if (m?.sessionId !== undefined) return; social.onPartyStatus(m); });
    on('guild-update', (m) => { if (m?.sessionId !== undefined) return; social.onGuildUpdate(m); });
    on('social-error', (m) => { if (m?.sessionId !== undefined) return; social.system(m.msg || 'Something went wrong.'); });
    social.onConnected();
  });
  // NET_CONNECTED fires after attach(); re-announce presence in case the
  // hero's level/zone was set between the two.
  const offBus = bus.on(Events.NET_CONNECTED, () => social.onConnected());
  return { destroy() { off(); offBus(); } };
}
