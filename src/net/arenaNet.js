import { net } from './NetworkManager.js';

// Client-side PvP arena API.
// Sends and receives `arena:*` messages through the generic relay.
// TYPE TABLE MIRROR — must stay identical to server/arena.js ARENA_TYPES.
// All handlers survive reconnects via net.onAttach.
//
// Outgoing (client -> server):
//   queue()            -> arena:queue {}
//   leave()            -> arena:leave {}
//   challenge(name)    -> arena:challenge { target }
//   accept(name)       -> arena:accept { target }
//   decline(name)      -> arena:decline { target }
//   report(matchId, winner, reason?) -> arena:report { matchId, winner, reason }
//   refreshRating()    -> arena:rating {}
//
// Incoming (server -> client):
//   queued    -> arena:queued { position }            (0 = not queued)
//   match     -> arena:match { matchId, a, b, aName, bName }
//   challenge -> arena:challenge { from, fromName }
//   declined  -> arena:declined { from, fromName }
//   result    -> arena:result { matchId, winner, winnerName, reason, you }
//   rating    -> arena:rating { rating, wins, losses }
//   error     -> arena:error { msg }

export const ARENA_TYPES = [
  'arena:queue',
  'arena:leave',
  'arena:challenge',
  'arena:accept',
  'arena:decline',
  'arena:report',
  'arena:rating',
  'arena:queued',
  'arena:match',
  'arena:declined',
  'arena:result',
  'arena:error',
];

const INCOMING = ['arena:queued', 'arena:match', 'arena:challenge', 'arena:declined', 'arena:result', 'arena:rating', 'arena:error'];
const OUTGOING = new Set(['arena:queue', 'arena:leave', 'arena:challenge', 'arena:accept', 'arena:decline', 'arena:report', 'arena:rating']);

const handlers = {
  'arena:queued': new Set(),
  'arena:match': new Set(),
  'arena:challenge': new Set(),
  'arena:declined': new Set(),
  'arena:result': new Set(),
  'arena:rating': new Set(),
  'arena:error': new Set(),
};

let wired = false;
function ensureWired() {
  if (wired) return;
  wired = true;
  net.onAttach((room) => {
    for (const type of INCOMING) {
      room.onMessage(type, (m) => {
        const msg = m && typeof m === 'object' ? m : {};
        // SessionId-echo guard: ignore relayed/passthrough copies of our own
        // sends (the generic relay tags foreign echoes with sessionId).
        if (msg?.sessionId !== undefined) return;
        for (const fn of handlers[type]) safe(fn, msg);
      });
    }
  });
}

function safe(fn, ...args) { try { fn(...args); } catch (e) { console.error('[arenaNet]', e); } }

function send(type, payload = {}) {
  if (!OUTGOING.has(type)) return false;
  if (!net.connected) { console.warn('[arenaNet] offline, no-op:', type); return false; }
  return net.send(type, payload);
}

function on(type, fn) { ensureWired(); handlers[type].add(fn); return () => handlers[type].delete(fn); }

export const arenaNet = {
  isOnline() { return !!net.connected; },
  queue() { return send('arena:queue'); },
  leave() { return send('arena:leave'); },
  challenge(name) { return send('arena:challenge', { target: String(name || '') }); },
  accept(name) { return send('arena:accept', { target: String(name || '') }); },
  decline(name) { return send('arena:decline', { target: String(name || '') }); },
  report(matchId, winner, reason) {
    return send('arena:report', { matchId: String(matchId || ''), winner: String(winner || ''), reason: String(reason || 'ko').slice(0, 24) });
  },
  refreshRating() { return send('arena:rating'); },
  onQueued(fn) { return on('arena:queued', fn); },
  onMatch(fn) { return on('arena:match', fn); },
  onChallenge(fn) { return on('arena:challenge', fn); },
  onDeclined(fn) { return on('arena:declined', fn); },
  onResult(fn) { return on('arena:result', fn); },
  onRating(fn) { return on('arena:rating', fn); },
  onError(fn) { return on('arena:error', fn); },
};
