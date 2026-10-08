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
//    arena:report    deprecated; always rejected (the server resolves results)
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
  'arena:agent-queue',
  'arena:agent-leave',
  'arena:challenge',
  'arena:accept',
  'arena:decline',
  'arena:report',
  'arena:rating',
  'arena:queued',
  'arena:agent-queued',
  'arena:match',
  'arena:declined',
  'arena:result',
  'arena:combat-state',
  'arena:combat-result',
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
  for (const m of room.arenaMatches?.values() || []) if (m.a === sid || m.b === sid || m.ownerA === sid || m.ownerB === sid) return m;
  return null;
}
const pairKey = (a, b) => [a, b].sort().join('~');
const ownerOf = (room, sid) => room.players.get(sid)?.agent ? room.players.get(sid)?.ownerSid || null : sid;
const recipients = (m) => [...new Set([m.ownerA || m.a, m.ownerB || m.b])];
function ownedAgent(room, ownerSid) {
  const agent = room.agents?.list?.().find((a) => a?.ownerSid === ownerSid && room.players.get(a.sid)?.agent && !room.players.get(a.sid)?.dc);
  return agent ? room.players.get(agent.sid) : null;
}
function clearAgents(room, match) {
  for (const sid of match?.agents || []) room.agents?.clearArenaOpponent?.(sid, match.id);
}

function tryMatchQueue(room) {
  const q = room.arenaQueue;
  for (let i = q.length - 1; i >= 0; i--) if (!room.players.has(q[i]) || room.players.get(q[i])?.agent || inMatch(room, q[i])) q.splice(i, 1);
  let paired = true;
  while (paired) {
    paired = false;
    outer: for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
      const a = q[i], b = q[j];
      if (!room._canStartDuel?.(a, b) || Date.now() < (room.arenaPairCd?.get(pairKey(a, b)) || 0)) continue;
      q.splice(j, 1); q.splice(i, 1);
      send(room, a, 'arena:queued', { position: 0 }); send(room, b, 'arena:queued', { position: 0 });
      startMatch(room, a, b, 'queue'); paired = true; break outer;
    }
  }
  q.forEach((sid, i) => send(room, sid, 'arena:queued', { position: i + 1 }));
}

function startMatch(room, a, b, via) {
  const pa = room.players.get(a);
  const pb = room.players.get(b);
  if (!pa || !pb) return;
  const hasAgent = !!(pa.agent || pb.agent);
  const ownerA = ownerOf(room, a), ownerB = ownerOf(room, b);
  if (!ownerA || !ownerB || ownerA === ownerB || inMatch(room, ownerA) || inMatch(room, ownerB)) {
    err(room, ownerA || a, 'An owner cannot battle their own agent or enter multiple matches.'); return;
  }
  // A challenged player or an agent's owner may have queued elsewhere since
  // the queue scan; reserve each owner exactly once before starting combat.
  for (const ownerSid of [ownerA, ownerB]) {
    const qi = room.arenaQueue?.indexOf(ownerSid) ?? -1;
    if (qi !== -1) { room.arenaQueue.splice(qi, 1); send(room, ownerSid, 'arena:queued', { position: 0 }); }
    let removedAgentQueue = false;
    for (let i = (room.arenaAgentQueue?.length || 0) - 1; i >= 0; i--) {
      if (ownerOf(room, room.arenaAgentQueue[i]) === ownerSid) { room.arenaAgentQueue.splice(i, 1); removedAgentQueue = true; }
    }
    if (removedAgentQueue) send(room, ownerSid, 'arena:agent-queued', { position: 0 });
  }
  const canStart = hasAgent
    ? room._canArenaAgentDuel?.(a, b, ownerA, ownerB)
    : room._canStartDuel?.(a, b);
  if (!canStart) {
    const message = pa.a !== pb.a || Math.hypot(pa.x - pb.x, pa.y - pb.y) > 300
      ? 'Arena opponents must be nearby in the same area.'
      : 'Arena combat is unavailable in this room.';
    for (const sid of new Set([ownerA, ownerB])) err(room, sid, message);
    return;
  }
  const matchId = `${a}~${b}~${Date.now().toString(36)}`;
  const m = { id: matchId, a, b, ownerA, ownerB, agents: [pa.agent ? a : null, pb.agent ? b : null].filter(Boolean), aName: pa.name, bName: pb.name, via, at: Date.now() };
  room.arenaMatches.set(matchId, m);
  const started = hasAgent
    ? typeof room._startArenaAgentDuel === 'function' && room._startArenaAgentDuel(a, b, { matchId, ownerA, ownerB })
    : typeof room._startDuel === 'function' && room._startDuel(a, b, { matchId, arena: true });
  if (!started) {
    room.arenaMatches.delete(matchId);
    for (const sid of new Set([ownerA, ownerB])) err(room, sid, 'Arena combat is unavailable in this room.');
    return;
  }
  const payload = { matchId, a: ownerA, b: ownerB, fighterA: a, fighterB: b, ownerA, ownerB, aName: pa.name, bName: pb.name };
  for (const sid of recipients(m)) send(room, sid, 'arena:match', payload);
}

function tryMatchAgentQueue(room) {
  const humans = room.arenaQueue, agents = room.arenaAgentQueue;
  for (let i = humans.length - 1; i >= 0; i--) if (!room.players.has(humans[i]) || inMatch(room, humans[i])) humans.splice(i, 1);
  for (let i = agents.length - 1; i >= 0; i--) {
    const p = room.players.get(agents[i]);
    if (!p?.agent || !p.ownerSid || !room.players.has(p.ownerSid) || inMatch(room, agents[i]) || inMatch(room, p.ownerSid)) agents.splice(i, 1);
  }
  let paired = true;
  while (paired) {
    paired = false;
    outer: for (let hi = 0; hi < humans.length; hi++) {
      for (let ai = 0; ai < agents.length; ai++) {
        const h = humans[hi], a = agents[ai], ownerA = ownerOf(room, a);
        if (!ownerA || ownerA === h || !room._canArenaAgentDuel?.(h, a, h, ownerA)) continue;
        humans.splice(hi, 1); agents.splice(ai, 1);
        send(room, h, 'arena:queued', { position: 0 });
        send(room, ownerA, 'arena:agent-queued', { position: 0 });
        startMatch(room, h, a, 'agent-queue'); paired = true; break outer;
      }
    }
    if (paired) continue;
    outer2: for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i], b = agents[j], ownerA = ownerOf(room, a), ownerB = ownerOf(room, b);
        if (!ownerA || !ownerB || ownerA === ownerB || !room._canArenaAgentDuel?.(a, b, ownerA, ownerB)) continue;
        agents.splice(j, 1); agents.splice(i, 1);
        send(room, ownerA, 'arena:agent-queued', { position: 0 });
        send(room, ownerB, 'arena:agent-queued', { position: 0 });
        startMatch(room, a, b, 'agent-queue'); paired = true; break outer2;
      }
    }
  }
}

function settleCombatResult(room, result) {
  const match = [...(room.arenaMatches?.values() || [])].find((m) => m.id === result?.matchId);
  if (!match) return false;
  const winner = result.winner;
  if (winner !== match.a && winner !== match.b) return false;
  if (!['ko', 'forfeit'].includes(result.reason)) {
    room.arenaMatches.delete(match.id);
    clearAgents(room, match);
    for (const sid of recipients(match)) err(room, sid, 'Arena match ended without a verified result. No rating change was applied.');
    return false;
  }
  const loser = winner === match.a ? match.b : match.a;
  const winnerOwner = winner === match.a ? (match.ownerA || match.a) : (match.ownerB || match.b);
  const loserOwner = winner === match.a ? (match.ownerB || match.b) : (match.ownerA || match.a);
  room.arenaMatches.delete(match.id);
  clearAgents(room, match);
  room.arenaPairCd.set(pairKey(winnerOwner, loserOwner), Date.now() + PAIR_CD_MS);
  const wRec = room.players.get(winnerOwner);
  const lRec = room.players.get(loserOwner);
  if (!wRec || !lRec) return false;
  const w = getRating(wRec);
  const l = getRating(lRec);
  const delta = eloDelta(w.rating, l.rating);
  const wNext = setRating(wRec, { rating: w.rating + delta, wins: w.wins + 1, losses: w.losses });
  const lNext = setRating(lRec, { rating: l.rating - delta, wins: l.wins, losses: l.losses + 1 });
  const winnerName = room.players.get(winner)?.name || wRec.name || '???';
  for (const [sid, rec, d] of [[winnerOwner, wNext, delta], [loserOwner, lNext, -delta]]) {
    send(room, sid, 'arena:result', {
      matchId: match.id, winner: winnerOwner, combatWinner: winner, combatLoser: loser, winnerName, reason: result.reason,
      you: { rating: rec.rating, wins: rec.wins, losses: rec.losses, delta: d },
    });
    send(room, sid, 'arena:rating', { rating: rec.rating, wins: rec.wins, losses: rec.losses });
  }
  return true;
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
  // Cancel matches on disconnect/room loss, and expire any other stale match.
  for (const [id, m] of room.arenaMatches || []) {
    const ownerA = m.ownerA || (room.players.get(m.a)?.agent ? room.players.get(m.a)?.ownerSid : m.a);
    const ownerB = m.ownerB || (room.players.get(m.b)?.agent ? room.players.get(m.b)?.ownerSid : m.b);
    const disconnected = [ownerA, ownerB].some((sid) => !sid || !room.players.has(sid) || room.players.get(sid)?.dc || !clientOf(room, sid))
      || !room.players.has(m.a) || !room.players.has(m.b);
    if (disconnected || now - m.at > MATCH_TTL_MS) cancelMatch(room, m, disconnected ? 'left' : 'timeout');
  }
}

function cancelMatch(room, match, reason = 'left') {
  if (!match || !room.arenaMatches?.has(match.id)) return false;
  // Resolve the duel without a winner before releasing the match reservation.
  try { room._endDuel?.(match.a, reason); } catch { /* room may be disposing */ }
  room.arenaMatches.delete(match.id);
  clearAgents(room, match);
  const result = { matchId: match.id, a: match.ownerA || match.a, b: match.ownerB || match.b, combatA: match.a, combatB: match.b, winner: null, reason, status: 'cancelled' };
  for (const sid of recipients(match)) send(room, sid, 'arena:combat-result', result);
  return true;
}

// ─── install ─────────────────────────────────────────────────────────────────
export function install(room) {
  room.arenaQueue ||= [];           // sessionId[]
  room.arenaAgentQueue ||= [];      // owned-agent combatant sessionIds
  room.arenaChallenges ||= new Map(); // targetSid -> { from, fromName, at }
  room.arenaMatches ||= new Map();    // matchId -> { id, a, b, aName, bName, via, at, combat }
  room.arenaPairCd ||= new Map();     // pairKey -> timestamp (rematch cooldown)
  room._onArenaCombatResult = (result) => settleCombatResult(room, result);

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
    if (room.arenaAgentQueue.some((agentSid) => ownerOf(room, agentSid) === sid)) return err(room, sid, 'Leave agent matchmaking before queueing yourself.');
    if (!room.arenaQueue.includes(sid)) room.arenaQueue.push(sid);
    send(room, sid, 'arena:queued', { position: room.arenaQueue.indexOf(sid) + 1 });
    tryMatchQueue(room);
    tryMatchAgentQueue(room);
  });

  on('arena:agent-queue', (client) => {
    const ownerSid = client.sessionId;
    const agent = ownedAgent(room, ownerSid);
    if (!agent) return err(room, ownerSid, 'You need a live owned agent to enter agent matchmaking.');
    if (inMatch(room, ownerSid) || inMatch(room, agent.sid)) return err(room, ownerSid, 'Finish your current match first.');
    if (room.arenaQueue.includes(ownerSid)) return err(room, ownerSid, 'Leave human matchmaking before queueing your agent.');
    if (!room.arenaAgentQueue.includes(agent.sid)) room.arenaAgentQueue.push(agent.sid);
    send(room, ownerSid, 'arena:agent-queued', { position: room.arenaAgentQueue.indexOf(agent.sid) + 1 });
    tryMatchAgentQueue(room);
  });

  on('arena:agent-leave', (client) => {
    const ownerSid = client.sessionId;
    const i = room.arenaAgentQueue.findIndex((sid) => ownerOf(room, sid) === ownerSid);
    if (i !== -1) room.arenaAgentQueue.splice(i, 1);
    send(room, ownerSid, 'arena:agent-queued', { position: 0 });
  });

  on('arena:leave', (client) => {
    const i = room.arenaQueue.indexOf(client.sessionId);
    if (i !== -1) room.arenaQueue.splice(i, 1);
    send(room, client.sessionId, 'arena:queued', { position: 0 }); // 0 = not queued
    tryMatchAgentQueue(room);
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

  on('arena:report', (client) => err(room, client.sessionId, 'Arena results are resolved by the server; client result reports are disabled.'));

  on('arena:rating', (client, p) => {
    const r = getRating(p);
    send(room, client.sessionId, 'arena:rating', r);
  });
}

export function onLeave(room, client) {
  purge(room, client?.sessionId);
  for (const match of room.arenaMatches?.values() || []) {
    if (match.a === client?.sessionId || match.b === client?.sessionId || match.ownerA === client?.sessionId || match.ownerB === client?.sessionId) cancelMatch(room, match, 'left');
  }
}

// Optional parent hook: call from the room's onLeave so queue/challenges for a
// departed session never match against ghosts. (Lazy purge also covers this.)
export function purge(room, sid) {
  const i = room.arenaQueue?.indexOf(sid);
  if (i !== undefined && i !== -1) room.arenaQueue.splice(i, 1);
  for (let j = (room.arenaAgentQueue?.length || 0) - 1; j >= 0; j--) {
    const agentSid = room.arenaAgentQueue[j];
    if (agentSid === sid || ownerOf(room, agentSid) === sid) room.arenaAgentQueue.splice(j, 1);
  }
  for (const [target, ch] of room.arenaChallenges || []) {
    if (target === sid || ch.from === sid) room.arenaChallenges.delete(target);
  }
  tryMatchAgentQueue(room);
}
