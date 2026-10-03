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
//   { action:'start', a, b, aTeam, bTeam, seed, round:1 } -> both
//   { action:'turn', a, b, round, aTurn, bTurn }          -> both (lockstep)
//   { action:'hpSync', pets, a, b }                       -> both
//   { action:'end', winner, reason }                      -> both

const DUEL_TTL_MS = 5 * 60_000;
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
  // Lightweight pet team: the hero's job becomes the lead, two enemy type ids fill in.
  // If a real pet system exists later, read hero.pets here.
  const job = hero?.job || 'wayfarer';
  const level = Math.max(1, Math.min(99, Number.isFinite(+hero?.level) ? +hero.level : 1));
  const maxHp = 60 + level * 8;
  const team = [
    { id: 'pet-hero', name: 'Hero Pet', type: job, maxHp, hp: maxHp, atk: 8 + level * 2, spd: 10 },
    { id: 'pet-a', name: 'Bite Bug', type: 'beetle', maxHp: Math.floor(maxHp * 0.75), hp: Math.floor(maxHp * 0.75), atk: 6 + level, spd: 8 },
    { id: 'pet-b', name: 'Spark Moth', type: 'moth', maxHp: Math.floor(maxHp * 0.65), hp: Math.floor(maxHp * 0.65), atk: 5 + level, spd: 12 },
  ];
  return team;
}

export function install(room) {
  room.petDuels ||= new Map();

  room.onMessage(type, (client, m) => {
    const p = room.players.get(client.sessionId);
    if (!p) return;
    if (!bucket(p)) return; // silent rate limit
    const msg = m && typeof m === 'object' ? m : {};
    const action = msg.action;

    if (action === 'challenge') {
      const target = resolveTarget(room, msg.target);
      if (!target || target === client.sessionId) { send(room, client.sessionId, type, { action: 'error', msg: 'No such player.' }); return; }
      if (inDuel(room, client.sessionId) || inDuel(room, target)) { send(room, client.sessionId, type, { action: 'error', msg: 'One of you is already in a duel.' }); return; }
      send(room, target, type, { action: 'challenge', from: client.sessionId, fromName: p.name });
      return;
    }

    if (action === 'decline') {
      const target = resolveTarget(room, msg.target);
      if (!target) return;
      send(room, target, type, { action: 'declined', from: client.sessionId, fromName: p.name });
      return;
    }

    if (action === 'accept') {
      const target = resolveTarget(room, msg.target);
      if (!target || target === client.sessionId) return;
      if (inDuel(room, client.sessionId) || inDuel(room, target)) {
        send(room, client.sessionId, type, { action: 'error', msg: 'Someone is already dueling.' });
        return;
      }
      const challenger = room.players.get(target);
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const duel = {
        id: `${client.sessionId}~${target}`,
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
      send(room, duel.a, type, {
        action: 'start', a: duel.a, b: duel.b,
        aName: duel.aName, bName: duel.bName,
        aTeam: duel.aTeam, bTeam: duel.bTeam,
        seed, round: duel.round,
      });
      send(room, duel.b, type, {
        action: 'start', a: duel.a, b: duel.b,
        aName: duel.aName, bName: duel.bName,
        aTeam: duel.aTeam, bTeam: duel.bTeam,
        seed, round: duel.round,
      });
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
  const duel = inDuel(room, sid);
  if (!duel) return;
  endDuel(room, duel, duel.a === sid ? duel.b : duel.a, 'left');
}

export function tick(room) {
  // Clean up abandoned duels
  const now = Date.now();
  for (const [id, duel] of room.petDuels || []) {
    if (now - duel.lastAt > DUEL_TTL_MS) {
      endDuel(room, duel, null, 'timeout');
    }
  }
}

function endDuel(room, duel, winner, reason) {
  room.petDuels?.delete(duel.id);
  const payload = { action: 'end', winner: winner || null, reason };
  send(room, duel.a, type, payload);
  send(room, duel.b, type, payload);
}
