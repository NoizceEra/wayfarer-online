// PvP pet duel server module for WayfarerRoom.
// Purely additive: install(room) wires message handlers; onJoin/onLeave are no-ops.
//
// Wire protocol (type='pet-duel'):
// Client -> server
//   { action:'challenge', target }      target = sessionId or player name
//   { action:'accept', target }         target = challenger sessionId/name
//   { action:'decline', target }
//   { action:'forfeit' }
//   { action:'turn', turn }             turn = { petId, moveId?, targetId? }
//   { action:'hpSync', pets }           server also accepts authoritative HP updates
//
// Server -> client(s)
//   { action:'challenge', from, fromName } -> target only
//   { action:'declined', from, fromName }  -> challenger only
//   { action:'start', a, b, aName, bName, aTeam, bTeam, seed, round:1 } -> both
//   { action:'turn', a, b, round, aTurn, bTurn }          -> both (lockstep)
//   { action:'hpSync', pets, a, b }                       -> both
//   { action:'end', winner, reason }                      -> both

const DUEL_TTL_MS = 5 * 60_000;
const CHALLENGE_TTL_MS = 45_000;
const RATE = { burst: 8, perMs: 800 }; // ~1.25 msg/s sustained, burst 8

function bucket(p) {
  const b = p.petDuelRate ||= { tokens: RATE.burst, t: Date.now() };
  const now = Date.now();
  b.tokens = Math.min(RATE.burst, b.tokens + (now - b.t) / RATE.perMs);
  b.t = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function clientOf(room, sid) { return room.clients.find((c) => c.sessionId === sid) || null; }
function send(room, sid, type, msg) { try { clientOf(room, sid)?.send(type, msg); } catch { /* closing */ } }
const type = 'pet-duel';
function broadcastTo(room, duel, msg) { for (const s of [duel.a, duel.b]) send(room, s, type, msg); }

function findPlayerByName(room, name) {
  const n = String(name || '').toLowerCase();
  for (const [sid, p] of room.players) if (p.name.toLowerCase() === n) return sid;
  return null;
}
function resolveTarget(room, target) {
  if (room.players.has(target)) return target;
  return findPlayerByName(room, target);
}

function inDuel(room, sid) {
  for (const d of room.petDuels?.values() || []) if (d.a === sid || d.b === sid) return d;
  return null;
}

function makeTeamFromHero(hero) {
  // Real team: up to 3 pets from hero.meta.pets.roster, falling back to job-based placeholders.
  const roster = hero?.meta?.pets?.roster;
  if (Array.isArray(roster) && roster.length) {
    return roster.slice(0, 3).map((pet, i) => petToCombat(pet, i));
  }
  const job = hero?.job || 'wayfarer';
  const level = Math.max(1, Math.min(99, Number.isFinite(+hero?.level) ? +hero.level : 1));
  const maxHp = 60 + level * 8;
  return [
    { id: 'pet-hero', name: 'Hero Pet', type: job, maxHp, hp: maxHp, atk: 8 + level * 2, spd: 10 },
    { id: 'pet-a', name: 'Bite Bug', type: 'beetle', maxHp: Math.floor(maxHp * 0.75), hp: Math.floor(maxHp * 0.75), atk: 6 + level, spd: 8 },
    { id: 'pet-b', name: 'Spark Moth', type: 'moth', maxHp: Math.floor(maxHp * 0.65), hp: Math.floor(maxHp * 0.65), atk: 5 + level, spd: 12 },
  ];
}

function petToCombat(pet, index) {
  const level = Math.max(1, Math.min(99, Number.isFinite(+pet?.level) ? +pet.level : 1));
  // Normalize stats: hp/atk/def/spd with sane defaults.
  const s = pet?.stats || {};
  const maxHp = Math.max(20, Math.min(999, Number.isFinite(+s?.hp) ? +s.hp : 40 + level * 6));
  const atk = Math.max(5, Math.min(200, Number.isFinite(+s?.atk) ? +s.atk : 8 + level * 2));
  const def = Math.max(1, Math.min(200, Number.isFinite(+s?.def) ? +s.def : 5 + level));
  const spd = Math.max(1, Math.min(200, Number.isFinite(+s?.spd) ? +s.spd : 8 + level));
  return {
    id: String(pet?.id || `pet-${index}`).slice(0, 32),
    name: String(pet?.name || baseName(pet?.id) || `Pet ${index + 1}`).slice(0, 24),
    type: String(pet?.type || 'nature').slice(0, 12),
    level,
    maxHp,
    hp: Number.isFinite(+pet?.hp) ? Math.max(0, Math.min(maxHp, +pet.hp)) : maxHp,
    atk, def, spd,
  };
}

function baseName(id) {
  // Lightweight best-effort name from common pet ids; client can map ids to names.
  const map = {
    emberling: 'Emberling', ashfox: 'Ashfox', infernowarg: 'Infernowarg',
    dewdrop: 'Dewdrop', pondshell: 'Pondshell', leviarmor: 'Leviarmor',
    sprig: 'Sprig', mossback: 'Mossback', treantusk: 'Treantusk',
  };
  return map[id] || null;
}

export function install(room) {
  room.petDuels ||= new Map();
  room.petDuelChallenges ||= new Map(); // targetSid -> { from, fromName, at }

  room.onMessage(type, (client, m) => {
    const p = room.players.get(client.sessionId);
    if (!p) return;
    if (!bucket(p)) return; // silent rate limit
    // turn/hpSync payloads are relayed verbatim to the opponent: bound them
    let size = 0; try { size = JSON.stringify(m ?? null).length; } catch { return; }
    if (size > 2048) return;
    const msg = m && typeof m === 'object' ? m : {};
    const action = msg.action;

    if (action === 'challenge') {
      const target = resolveTarget(room, msg.target);
      if (!target) { send(room, client.sessionId, type, { action: 'error', msg: 'No such player.' }); return; }
      if (target === client.sessionId) { send(room, client.sessionId, type, { action: 'error', msg: 'You cannot challenge yourself.' }); return; }
      if (inDuel(room, client.sessionId) || inDuel(room, target)) { send(room, client.sessionId, type, { action: 'error', msg: 'One of you is already in a duel.' }); return; }
      // Spoof / duplicate guard: only one pending challenge from this challenger to this target.
      const key = `${client.sessionId}~${target}`;
      const existing = room.petDuelChallenges.get(target);
      if (existing) {
        send(room, client.sessionId, type, { action: 'error', msg: 'A challenge is already pending for that player.' });
        return;
      }
      room.petDuelChallenges.set(target, { from: client.sessionId, fromName: p.name, at: Date.now() });
      send(room, target, type, { action: 'challenge', from: client.sessionId, fromName: p.name });
      return;
    }

    if (action === 'decline') {
      const target = resolveTarget(room, msg.target);
      if (!target) return;
      // Only the challenged player can decline a challenge aimed at them.
      const ch = room.petDuelChallenges.get(client.sessionId);
      if (!ch || ch.from !== target) return;
      room.petDuelChallenges.delete(client.sessionId);
      send(room, target, type, { action: 'declined', from: client.sessionId, fromName: p.name });
      return;
    }

    if (action === 'accept') {
      const target = resolveTarget(room, msg.target);
      if (!target) { send(room, client.sessionId, type, { action: 'error', msg: 'No such player.' }); return; }
      if (target === client.sessionId) { send(room, client.sessionId, type, { action: 'error', msg: 'You cannot accept your own challenge.' }); return; }
      if (inDuel(room, client.sessionId) || inDuel(room, target)) {
        send(room, client.sessionId, type, { action: 'error', msg: 'Someone is already dueling.' });
        return;
      }
      // Verify the challenger actually issued a pending challenge to this acceptor.
      const ch = room.petDuelChallenges.get(client.sessionId);
      if (!ch || ch.from !== target) {
        send(room, client.sessionId, type, { action: 'error', msg: 'No pending challenge from that player.' });
        return;
      }
      room.petDuelChallenges.delete(client.sessionId);
      const challenger = room.players.get(target);
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const duel = {
        id: `${target}~${client.sessionId}`,
        a: target, b: client.sessionId,
        aName: challenger?.name || '???', bName: p.name,
        aTeam: makeTeamFromHero(challenger?.hero),
        bTeam: makeTeamFromHero(p.hero),
        seed,
        round: 1,
        turns: new Map(), // sid -> turn
        lastAt: Date.now(),
      };
      room.petDuels.set(duel.id, duel);
      const startPayload = {
        action: 'start', a: duel.a, b: duel.b,
        aName: duel.aName, bName: duel.bName,
        aTeam: duel.aTeam, bTeam: duel.bTeam,
        seed, round: duel.round,
      };
      send(room, duel.a, type, startPayload);
      send(room, duel.b, type, startPayload);
      return;
    }

    if (action === 'forfeit') {
      const duel = inDuel(room, client.sessionId);
      if (!duel) return;
      endDuel(room, duel, duel.a === client.sessionId ? duel.b : duel.a, 'forfeit');
      return;
    }

    if (action === 'turn') {
      const duel = inDuel(room, client.sessionId);
      if (!duel) return;
      const turn = msg.turn && typeof msg.turn === 'object' ? msg.turn : {};
      // Reject stale turns
      if (duel.turns.has(client.sessionId)) return;
      duel.turns.set(client.sessionId, turn);
      duel.lastAt = Date.now();
      if (duel.turns.size === 2) {
        const aTurn = duel.turns.get(duel.a) || {};
        const bTurn = duel.turns.get(duel.b) || {};
        const payload = {
          action: 'turn',
          a: duel.a, b: duel.b,
          round: duel.round,
          aTurn, bTurn,
        };
        send(room, duel.a, type, payload);
        send(room, duel.b, type, payload);
        duel.turns.clear();
        duel.round += 1;
      }
      return;
    }

    if (action === 'hpSync') {
      const duel = inDuel(room, client.sessionId);
      if (!duel) return;
      const pets = Array.isArray(msg.pets) ? msg.pets.slice(0, 6) : [];
      const payload = { action: 'hpSync', pets, a: duel.a, b: duel.b };
      send(room, duel.a, type, payload);
      send(room, duel.b, type, payload);
      return;
    }
  });
}

export function onJoin(room, client, p) { /* no-op; state is created on accept */ }

export function onLeave(room, client) {
  const sid = client.sessionId;
  room.petDuelChallenges?.delete(sid);
  for (const [key, ch] of room.petDuelChallenges || []) {
    if (ch.from === sid) room.petDuelChallenges.delete(key);
  }
  const duel = inDuel(room, sid);
  if (!duel) return;
  endDuel(room, duel, duel.a === sid ? duel.b : duel.a, 'left');
}

export function tick(room) {
  // Clean up abandoned duels and expired challenges
  const now = Date.now();
  for (const [id, duel] of room.petDuels || []) {
    if (now - duel.lastAt > DUEL_TTL_MS) {
      endDuel(room, duel, null, 'timeout');
    }
  }
  for (const [key, ch] of room.petDuelChallenges || []) {
    if (now - ch.at > CHALLENGE_TTL_MS) {
      room.petDuelChallenges.delete(key);
    }
  }
}

function endDuel(room, duel, winner, reason) {
  room.petDuels?.delete(duel.id);
  const payload = { action: 'end', winner: winner || null, reason };
  send(room, duel.a, type, payload);
  send(room, duel.b, type, payload);
}
