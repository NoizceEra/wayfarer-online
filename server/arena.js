// PvP arena server module for WayfarerRoom.
// Purely additive: install(room) wires message handlers. No edits to
// WayfarerRoom.js itself — the parent wires this module (see docs/ARENA.md).
//
// CANONICAL message-type table. Every Colyseus message type used by the arena
// is prefixed `arena:` and MUST be identical in src/net/arenaNet.js (which
// mirrors this list as ARENA_TYPES). Do not rename one side without the other.
//
//  Client -> server
//    arena:queue     {}                        join matchmaking queue
//    arena:leave     {}                        leave matchmaking queue
//    arena:challenge { target }                consensual challenge (target = sessionId or name)
//    arena:accept    { target }                accept (target = challenger sessionId/name)
//    arena:decline   { target }                decline (target = challenger sessionId/name)
//    arena:report    { matchId, winner }       report a finished match (winner = sessionId)
//    arena:rating    {}                        request own rating record
//  Server -> client(s)
//    arena:queued    { position }              -> self (queue position, 1-based)
//    arena:match     { matchId, a, b, aName, bName } -> both (queue pop OR accepted challenge)
//    arena:challenge { from, fromName }        -> target only
//    arena:declined  { from, fromName }        -> challenger only
//    arena:result    { matchId, winner, winnerName, reason, you } -> both (personalized `you`)
//       you = { rating, wins, losses, delta }  (delta = ELO points gained/lost)
//    arena:rating    { rating, wins, losses }  -> self (reply to request, or pushed after result)
//    arena:error     { msg }                   -> sender only
//
// Rating store: plain JSON under the character record at
//   rec.progress.ext.arena = { rating, wins, losses }
// with an in-memory fallback for unsaved/guest characters. ELO K=32,
// start 1000, floor 100. See docs/ARENA.md for the formula + anti-farm notes.

import { loadChar, saveChar } from './store.js';

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

export const CHALLENGE_TTL_MS = 45_000;
export const MATCH_TTL_MS = 10 * 60_000;
export const PAIR_CD_MS = 60_000; // same-pair rematch cooldown (anti-farm)
export const ELO_K = 32;
export const ELO_START = 1000;
export const ELO_FLOOR = 100;
const RATE = { burst: 8, perMs: 800 }; // ~1.25 msg/s sustained, burst 8

// ─── rating store ────────────────────────────────────────────────────────────
// Read-through: server record first, in-memory fallback for guests.
const memRatings = new Map(); // storeKey -> { rating, wins, losses }
const memKey = (p) => (p?.token ? `t:${p.token}:${p.name}` : `s:${p?.name || '?'}`);
const clean = (r) => ({
  rating: Number.isFinite(+r?.rating) ? Math.max(ELO_FLOOR, Math.round(+r.rating)) : ELO_START,
  wins: Math.max(0, +r?.wins | 0),
  losses: Math.max(0, +r?.losses | 0),
});

export function getRating(playerRec) {
  try {
    if (playerRec?.token) {
      const rec = loadChar(playerRec.token, playerRec.name);
      const a = rec?.progress?.ext?.arena;
      if (a && Number.isFinite(+a.rating)) return clean(a);
    }
  } catch { /* store unavailable: fall through to memory */ }
  return clean(memRatings.get(memKey(playerRec)));
}

export function setRating(playerRec, next) {
  const r = clean(next);
  memRatings.set(memKey(playerRec), r);
  try {
    if (playerRec?.token) {
      const rec = loadChar(playerRec.token, playerRec.name);
      if (rec?.progress) {
        rec.progress.ext ||= {};
        rec.progress.ext.arena = { ...r };
        saveChar(playerRec.token, playerRec.name, rec);
      }
    }
  } catch { /* memory copy already kept */ }
  return r;
}

// Standard ELO: winner gains round(K*(1-Ew)), loser loses round(K*El).
export function eloDelta(winnerRating, loserRating) {
  const ew = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  return Math.max(1, Math.round(ELO_K * (1 - ew)));
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function bucket(p) {
  const b = p.arenaRate ||= { tokens: RATE.burst, t: Date.now() };
  const now = Date.now();
  b.tokens = Math.min(RATE.burst, b.tokens + (now - b.t) / RATE.perMs);
  b.t = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function clientOf(room, sid) { return room.clients.find((c) => c.sessionId === sid) || null; }
function send(room, sid, type, msg) { try { clientOf(room, sid)?.send(type, msg); } catch { /* closing */ } }
const err = (room, sid, msg) => send(room, sid, 'arena:error', { msg });

function findPlayerByName(room, name) {
  const n = String(name || '').toLowerCase();
  // Agents are skipped: an agent has no client to accept a duel, so a challenge
  // resolved to one would create a match that can never resolve.
  for (const [sid, p] of room.players) if (!p.agent && String(p.name).toLowerCase() === n) return sid;
  return null;
}
function resolveTarget(room, target) {
  const direct = room.players.get(target);
  if (direct && !direct.agent) return target;
  return findPlayerByName(room, target);
}

function inMatch(room, sid) {
  for (const m of room.arenaMatches?.values() || []) if (m.a === sid || m.b === sid) return m;
  return null;
}
const pairKey = (a, b) => [a, b].sort().join('~');

function tryMatchQueue(room) {
  const q = room.arenaQueue;
  while (q.length >= 2) {
    // Drop entries whose players already left (lazy purge).
    while (q.length && !room.players.has(q[0])) q.shift();
    if (q.length < 2) break;
    const a = q.shift();
    let bIdx = q.findIndex((sid) => sid !== a && room.players.has(sid) && !room.players.get(sid)?.agent && !inMatch(room, sid));
    if (inMatch(room, a)) continue; // a entered a match meanwhile: skip, keep b queued
    if (bIdx === -1) { q.unshift(a); break; }
    const b = q.splice(bIdx, 1)[0];
    // Same-pair rematch cooldown (anti-farm: no instant re-queue farming).
    const pk = pairKey(a, b);
    const cdUntil = room.arenaPairCd?.get(pk) || 0;
    if (Date.now() < cdUntil) {
      q.unshift(b); q.unshift(a);
      send(room, a, 'arena:queued', { position: 1 });
      send(room, b, 'arena:queued', { position: 2 });
      break;
    }
    startMatch(room, a, b, 'queue');
  }
}

function startMatch(room, a, b, via) {
  const pa = room.players.get(a);
  const pb = room.players.get(b);
  if (!pa || !pb) return;
  const matchId = `${a}~${b}~${Date.now().toString(36)}`;
  const m = { id: matchId, a, b, aName: pa.name, bName: pb.name, via, at: Date.now() };
  room.arenaMatches.set(matchId, m);
  const payload = { matchId, a, b, aName: pa.name, bName: pb.name };
  send(room, a, 'arena:match', payload);
  send(room, b, 'arena:match', payload);
}

function sweep(room) {
  const now = Date.now();
  // Expire stale challenges (45s). Notify the challenger so their UI can clear.
  for (const [target, ch] of room.arenaChallenges || []) {
    if (now - ch.at > CHALLENGE_TTL_MS) {
      room.arenaChallenges.delete(target);
      err(room, ch.from, `Challenge to ${room.players.get(target)?.name || 'player'} expired (45s).`);
    }
  }
  // Expire stale matches (unreported result window).
  for (const [id, m] of room.arenaMatches || []) {
    if (now - m.at > MATCH_TTL_MS) room.arenaMatches.delete(id);
  }
}

// ─── install ─────────────────────────────────────────────────────────────────
export function install(room) {
  room.arenaQueue ||= [];           // sessionId[]
  room.arenaChallenges ||= new Map(); // targetSid -> { from, fromName, at }
  room.arenaMatches ||= new Map();    // matchId -> { id, a, b, aName, bName, via, at }
  room.arenaPairCd ||= new Map();     // pairKey -> timestamp (rematch cooldown)

  try { room.clock?.setInterval?.(() => sweep(room), 15_000); } catch { /* no clock (tests) */ }

  const on = (type, fn) => room.onMessage(type, (client, m) => {
    const p = room.players.get(client.sessionId);
    if (!p) return;
    if (!bucket(p)) return; // silent rate limit
    try { fn(client, p, m && typeof m === 'object' ? m : {}); }
    catch { /* handler error: additive module must never break the room */ }
  });

  on('arena:queue', (client) => {
    const sid = client.sessionId;
    if (inMatch(room, sid)) return err(room, sid, 'Finish your current match first.');
    if (!room.arenaQueue.includes(sid)) room.arenaQueue.push(sid);
    send(room, sid, 'arena:queued', { position: room.arenaQueue.indexOf(sid) + 1 });
    tryMatchQueue(room);
  });

  on('arena:leave', (client) => {
    const i = room.arenaQueue.indexOf(client.sessionId);
    if (i !== -1) room.arenaQueue.splice(i, 1);
    send(room, client.sessionId, 'arena:queued', { position: 0 }); // 0 = not queued
  });

  on('arena:challenge', (client, p, m) => {
    const target = resolveTarget(room, m.target);
    if (!target) return err(room, client.sessionId, 'No such player.');
    if (target === client.sessionId) return err(room, client.sessionId, 'You cannot challenge yourself.');
    if (inMatch(room, client.sessionId) || inMatch(room, target)) {
      return err(room, client.sessionId, 'One of you is already in a match.');
    }
    if (room.arenaChallenges.get(target)) {
      return err(room, client.sessionId, 'A challenge is already pending for that player.');
    }
    room.arenaChallenges.set(target, { from: client.sessionId, fromName: p.name, at: Date.now() });
    send(room, target, 'arena:challenge', { from: client.sessionId, fromName: p.name });
  });

  on('arena:decline', (client, p, m) => {
    const target = resolveTarget(room, m.target);
    if (!target) return;
    // Anti-spoof: only the challenged player can decline a challenge aimed at them.
    const ch = room.arenaChallenges.get(client.sessionId);
    if (!ch || ch.from !== target) return;
    room.arenaChallenges.delete(client.sessionId);
    send(room, target, 'arena:declined', { from: client.sessionId, fromName: p.name });
  });

  on('arena:accept', (client, p, m) => {
    const target = resolveTarget(room, m.target);
    if (!target) return err(room, client.sessionId, 'No such player.');
    if (target === client.sessionId) return err(room, client.sessionId, 'You cannot accept your own challenge.');
    // Anti-spoof: the challenger must have issued a live challenge to this acceptor.
    const ch = room.arenaChallenges.get(client.sessionId);
    if (!ch || ch.from !== target) return err(room, client.sessionId, 'No pending challenge from that player.');
    if (Date.now() - ch.at > CHALLENGE_TTL_MS) {
      room.arenaChallenges.delete(client.sessionId);
      return err(room, client.sessionId, 'That challenge expired (45s).');
    }
    if (inMatch(room, client.sessionId) || inMatch(room, target)) {
      return err(room, client.sessionId, 'Someone is already in a match.');
    }
    room.arenaChallenges.delete(client.sessionId);
    startMatch(room, target, client.sessionId, 'challenge');
  });

  on('arena:report', (client, _p, m) => {
    const sid = client.sessionId;
    const match = room.arenaMatches.get(m.matchId);
    if (!match) return err(room, sid, 'Unknown or expired match.');
    // Anti-spoof: only a participant may report, and the winner must be a participant.
    if (sid !== match.a && sid !== match.b) return err(room, sid, 'You are not in that match.');
    if (m.winner !== match.a && m.winner !== match.b) return err(room, sid, 'Invalid winner.');
    const loser = m.winner === match.a ? match.b : match.a;
    room.arenaMatches.delete(m.matchId); // consume: one report settles a match (no double-claim)
    room.arenaPairCd.set(pairKey(match.a, match.b), Date.now() + PAIR_CD_MS);
    const wRec = room.players.get(m.winner);
    const lRec = room.players.get(loser);
    const w = getRating(wRec);
    const l = getRating(lRec);
    const delta = eloDelta(w.rating, l.rating);
    const wNext = setRating(wRec, { rating: w.rating + delta, wins: w.wins + 1, losses: w.losses });
    const lNext = setRating(lRec, { rating: l.rating - delta, wins: l.wins, losses: l.losses + 1 });
    const reason = String(m.reason || 'ko').slice(0, 24);
    const wName = room.players.get(m.winner)?.name || '???';
    for (const [s, rec, d] of [[m.winner, wNext, delta], [loser, lNext, -delta]]) {
      send(room, s, 'arena:result', {
        matchId: m.matchId, winner: m.winner, winnerName: wName, reason,
        you: { rating: rec.rating, wins: rec.wins, losses: rec.losses, delta: d },
      });
      send(room, s, 'arena:rating', { rating: rec.rating, wins: rec.wins, losses: rec.losses });
    }
  });

  on('arena:rating', (client, p) => {
    const r = getRating(p);
    send(room, client.sessionId, 'arena:rating', r);
  });
}

// Optional parent hook: call from the room's onLeave so queue/challenges for a
// departed session never match against ghosts. (Lazy purge also covers this.)
export function purge(room, sid) {
  const i = room.arenaQueue?.indexOf(sid);
  if (i !== undefined && i !== -1) room.arenaQueue.splice(i, 1);
  for (const [target, ch] of room.arenaChallenges || []) {
    if (target === sid || ch.from === sid) room.arenaChallenges.delete(target);
  }
}
