// Social relay: chat channels, whispers, parties, emotes, guild stub, roster.
// Everything lives in memory per room (persistence is a separate concern).
// Wired from index.js with three calls: installSocial(room) in onCreate,
// socialJoin(room, client, options) in onJoin, socialLeave(room, client) in onLeave.
//
// Client -> server            Server -> client(s)
//  presence {level,job,zone}   presence {id,name,level,job,zone,guild,party}   (broadcast)
//  who                         roster [presence...]                            (requester)
//  schat {ch,text}             schat {ch,from,name,text,guild?}                (say/world: all; party/guild: members)
//  whisper {to,text}           whisper {from,fromName,text} -> target, whisper-sent {to,toName,text} -> sender
//  emote {id}                  emote {from,name,id}                            (broadcast)
//  party-invite {to}           party-invite {from,fromName}                    (target)
//  party-accept {from}         party-update {id,leader,members:[{id,name}]}    (all members) + party-msg
//  party-decline {from}        party-msg {text}                                (inviter)
//  party-leave / party-kick {id} / party-promote {id}   -> party-update / party-msg
//  party-xp {xp,x,y}           party-xp {from,xp,x,y}                          (other members)
//  party-status {hp,maxHp,mp,maxMp,level}  party-status {from,...}             (other members)
//  guild-create {tag,name} / guild-join {tag} / guild-leave
//                              guild-update {tag,name,members:[names]} (guild members) + presence broadcast
//  trade-offer {to,gold,item}   trade-offer {from,fromName,gold,item} -> target, trade-sent {to,toName} -> sender
//  trade-respond {to,accept,gold,item}  trade-done {from,gold,item} | {from,declined} -> offerer
//  duel-challenge {to}         duel-challenge {from,fromName} -> target
//  duel-respond {to,accept}     duel-start {a,b} -> both | duel-decline {from,fromName} -> challenger
//  duel-end {}                 duel-end {a,b,reason} -> both (also on death/leave)
//  pvp-hit {to,dmg,x,y}        pvp-hit {from,dmg,x,y} -> recorded opponent only
//  (any)                       social-error {msg}

const CHAT_MAX = 160;
const RATE = { burst: 6, perMs: 1200 }; // ~1 msg / 1.2s sustained, 6 burst
const PARTY_MAX = 5;

function bucket(room, sid) {
  const b = room.social.rate.get(sid) || { tokens: RATE.burst, t: Date.now() };
  const now = Date.now();
  b.tokens = Math.min(RATE.burst, b.tokens + (now - b.t) / RATE.perMs);
  b.t = now;
  room.social.rate.set(sid, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

const cleanTag = (t) => String(t || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
const cleanText = (t) => String(t || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, CHAT_MAX);

function info(room, sid) { return room.social.players.get(sid); }
function presenceOf(room, sid) {
  const p = info(room, sid);
  if (!p) return null;
  return { id: sid, name: p.name, level: p.level, job: p.job, zone: p.zone, guild: p.guild || '', party: p.party || '' };
}
function clientById(room, sid) { return room.clients.find((c) => c.sessionId === sid) || null; }
function findByName(room, name) {
  const n = String(name || '').toLowerCase();
  for (const [sid, p] of room.social.players) if (p.name.toLowerCase() === n) return sid;
  return null;
}
function err(client, msg) { client.send('social-error', { msg }); }

// ── parties ──────────────────────────────────────────────────────────────────
function partyOf(room, sid) { const pid = info(room, sid)?.party; return pid ? room.social.parties.get(pid) : null; }
function sendParty(room, party, type, msg, exceptSid = null) {
  for (const sid of party.members) {
    if (sid === exceptSid) continue;
    clientById(room, sid)?.send(type, msg);
  }
}
function pushPartyUpdate(room, party) {
  const payload = { id: party.id, leader: party.leader, members: party.members.map((sid) => ({ id: sid, name: info(room, sid)?.name || '???' })) };
  sendParty(room, party, 'party-update', payload);
  for (const sid of party.members) room.broadcast('presence', presenceOf(room, sid));
}
function removeFromParty(room, sid, reason) {
  const party = partyOf(room, sid);
  const p = info(room, sid);
  if (p) p.party = '';
  if (!party) return;
  party.members = party.members.filter((m) => m !== sid);
  clientById(room, sid)?.send('party-update', { id: '', leader: '', members: [] });
  room.broadcast('presence', presenceOf(room, sid) || { id: sid });
  const name = p?.name || '???';
  if (party.members.length <= 1) {
    for (const m of party.members) { const q = info(room, m); if (q) q.party = ''; }
    sendParty(room, party, 'party-msg', { text: `${name} ${reason}. Party disbanded.` });
    sendParty(room, party, 'party-update', { id: '', leader: '', members: [] });
    for (const m of party.members) room.broadcast('presence', presenceOf(room, m));
    room.social.parties.delete(party.id);
    return;
  }
  if (party.leader === sid) {
    party.leader = party.members[0];
    sendParty(room, party, 'party-msg', { text: `${name} ${reason}. ${info(room, party.leader)?.name || '???'} is now the leader.` });
  } else sendParty(room, party, 'party-msg', { text: `${name} ${reason}.` });
  pushPartyUpdate(room, party);
}

// ── guilds ───────────────────────────────────────────────────────────────────
function pushGuildUpdate(room, g) {
  const payload = { tag: g.tag, name: g.name, members: g.members.map((sid) => info(room, sid)?.name || '???') };
  for (const sid of g.members) clientById(room, sid)?.send('guild-update', payload);
}
function leaveGuild(room, sid, silent = false) {
  const p = info(room, sid);
  if (!p?.guild) return;
  const g = room.social.guilds.get(p.guild);
  p.guild = '';
  if (g) {
    g.members = g.members.filter((m) => m !== sid);
    if (g.members.length === 0) room.social.guilds.delete(g.tag);
    else pushGuildUpdate(room, g);
  }
  if (!silent) { clientById(room, sid)?.send('guild-update', { tag: '', name: '', members: [] }); room.broadcast('presence', presenceOf(room, sid)); }
}

export function installSocial(room) {
  room.social = { players: new Map(), parties: new Map(), guilds: new Map(), duels: new Map(), rate: new Map(), nextParty: 1 };

  room.onMessage('presence', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    if (Number.isFinite(+m?.level)) p.level = Math.max(1, Math.min(99, +m.level | 0));
    if (typeof m?.job === 'string') p.job = m.job.slice(0, 16);
    if (typeof m?.zone === 'string') p.zone = m.zone.slice(0, 24);
    room.broadcast('presence', presenceOf(room, client.sessionId));
  });
  room.onMessage('who', (client) => {
    client.send('roster', [...room.social.players.keys()].map((sid) => presenceOf(room, sid)).filter(Boolean));
  });

  room.onMessage('schat', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    const text = cleanText(m?.text); if (!text) return;
    if (!bucket(room, client.sessionId)) { err(client, 'You are chatting too fast.'); return; }
    const ch = ['say', 'world', 'party', 'guild'].includes(m?.ch) ? m.ch : 'say';
    const out = { ch, from: client.sessionId, name: p.name, text, guild: p.guild || '' };
    if (ch === 'party') {
      const party = partyOf(room, client.sessionId);
      if (!party) { err(client, 'You are not in a party.'); return; }
      sendParty(room, party, 'schat', out);
    } else if (ch === 'guild') {
      const g = p.guild && room.social.guilds.get(p.guild);
      if (!g) { err(client, 'You are not in a guild.'); return; }
      for (const sid of g.members) clientById(room, sid)?.send('schat', out);
    } else room.broadcast('schat', out);
  });

  room.onMessage('whisper', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    const text = cleanText(m?.text); if (!text) return;
    if (!bucket(room, client.sessionId)) { err(client, 'You are chatting too fast.'); return; }
    const sid = room.social.players.has(m?.to) ? m.to : findByName(room, m?.to);
    if (!sid) { err(client, `No player named "${String(m?.to || '').slice(0, 14)}" is online.`); return; }
    if (sid === client.sessionId) { err(client, 'Talking to yourself?'); return; }
    clientById(room, sid)?.send('whisper', { from: client.sessionId, fromName: p.name, text });
    client.send('whisper-sent', { to: sid, toName: info(room, sid)?.name || '???', text });
  });

  room.onMessage('emote', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    if (!bucket(room, client.sessionId)) return;
    const id = String(m?.id || '').replace(/[^a-z]/g, '').slice(0, 12);
    if (!id) return;
    room.broadcast('emote', { from: client.sessionId, name: p.name, id });
  });

  // ── party ──
  room.onMessage('party-invite', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    const sid = room.social.players.has(m?.to) ? m.to : findByName(room, m?.to);
    if (!sid || sid === client.sessionId) { err(client, 'No such player to invite.'); return; }
    const mine = partyOf(room, client.sessionId);
    if (mine && mine.leader !== client.sessionId) { err(client, 'Only the party leader can invite.'); return; }
    if (mine && mine.members.length >= PARTY_MAX) { err(client, 'Party is full.'); return; }
    if (partyOf(room, sid)) { err(client, `${info(room, sid).name} is already in a party.`); return; }
    clientById(room, sid)?.send('party-invite', { from: client.sessionId, fromName: p.name });
    client.send('party-msg', { text: `Invited ${info(room, sid).name} to your party.` });
  });
  room.onMessage('party-accept', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    const inviter = info(room, m?.from); if (!inviter) { err(client, 'That invite has expired.'); return; }
    if (partyOf(room, client.sessionId)) { err(client, 'Leave your current party first (/leave).'); return; }
    let party = partyOf(room, m.from);
    if (!party) {
      party = { id: `p${room.social.nextParty++}`, leader: m.from, members: [m.from] };
      room.social.parties.set(party.id, party);
      inviter.party = party.id;
    }
    if (party.members.length >= PARTY_MAX) { err(client, 'That party is full.'); return; }
    party.members.push(client.sessionId);
    p.party = party.id;
    sendParty(room, party, 'party-msg', { text: `${p.name} joined the party.` }, client.sessionId);
    client.send('party-msg', { text: `You joined ${inviter.name}'s party.` });
    pushPartyUpdate(room, party);
  });
  room.onMessage('party-decline', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    clientById(room, m?.from)?.send('party-msg', { text: `${p.name} declined your invite.` });
  });
  room.onMessage('party-leave', (client) => {
    if (!partyOf(room, client.sessionId)) { err(client, 'You are not in a party.'); return; }
    client.send('party-msg', { text: 'You left the party.' });
    removeFromParty(room, client.sessionId, 'left the party');
  });
  room.onMessage('party-kick', (client, m) => {
    const party = partyOf(room, client.sessionId);
    if (!party || party.leader !== client.sessionId) { err(client, 'Only the leader can kick.'); return; }
    const sid = party.members.includes(m?.id) ? m.id : findByName(room, m?.id);
    if (!sid || !party.members.includes(sid) || sid === client.sessionId) { err(client, 'No such party member.'); return; }
    clientById(room, sid)?.send('party-msg', { text: 'You were removed from the party.' });
    removeFromParty(room, sid, 'was kicked');
  });
  room.onMessage('party-promote', (client, m) => {
    const party = partyOf(room, client.sessionId);
    if (!party || party.leader !== client.sessionId) { err(client, 'Only the leader can promote.'); return; }
    const sid = party.members.includes(m?.id) ? m.id : findByName(room, m?.id);
    if (!sid || !party.members.includes(sid)) { err(client, 'No such party member.'); return; }
    party.leader = sid;
    sendParty(room, party, 'party-msg', { text: `${info(room, sid)?.name || '???'} is now the party leader.` });
    pushPartyUpdate(room, party);
  });
  room.onMessage('party-xp', (client, m) => {
    const party = partyOf(room, client.sessionId); if (!party) return;
    const xp = Math.max(0, Math.min(100000, +m?.xp | 0)); if (!xp) return;
    // typeId rides along so recipients can take shared kill credit for quests,
    // not just XP. Bounded + type-checked here; the recipient still re-checks
    // proximity before granting anything.
    const typeId = typeof m?.typeId === 'string' && m.typeId.length <= 48 ? m.typeId : null;
    sendParty(room, party, 'party-xp', { from: client.sessionId, xp, x: +m?.x | 0, y: +m?.y | 0, typeId }, client.sessionId);
  });
  room.onMessage('party-status', (client, m) => {
    const party = partyOf(room, client.sessionId); if (!party) return;
    const s = { from: client.sessionId };
    for (const k of ['hp', 'maxHp', 'mp', 'maxMp', 'level']) s[k] = +m?.[k] | 0;
    sendParty(room, party, 'party-status', s, client.sessionId);
  });

  // ── trade (1:1 offers, co-op trust model: sender deducts on 'done') ──
  room.onMessage('trade-offer', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    if (!bucket(room, client.sessionId)) { err(client, 'You are trading too fast.'); return; }
    const sid = room.social.players.has(m?.to) ? m.to : findByName(room, m?.to);
    if (!sid || sid === client.sessionId) { err(client, 'No such player to trade with.'); return; }
    const gold = Math.max(0, Math.min(9999, m?.gold | 0));
    const item = typeof m?.item === 'string' ? m.item.slice(0, 40) : null;
    if (!gold && !item) { err(client, 'Offer gold or an item.'); return; }
    clientById(room, sid)?.send('trade-offer', { from: client.sessionId, fromName: p.name, gold, item });
    client.send('trade-sent', { to: sid, toName: info(room, sid)?.name || '???' });
  });
  room.onMessage('trade-respond', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    const sid = m?.to;
    if (!sid || !room.social.players.has(sid)) { err(client, 'That trader is gone.'); return; }
    if (m?.accept) {
      const gold = Math.max(0, Math.min(9999, m?.gold | 0));
      const item = typeof m?.item === 'string' ? m.item.slice(0, 40) : null;
      clientById(room, sid)?.send('trade-done', { from: client.sessionId, gold, item });
    } else {
      clientById(room, sid)?.send('trade-done', { from: client.sessionId, declined: true });
    }
  });

  // ── duels (server-validated PvP; no client-authored arena results) ──
  const duelKey = (a, b) => [a, b].sort().join('~');
  const inDuel = (sid) => { for (const d of room.social.duels.values()) if (d.a === sid || d.b === sid) return d; return null; };
  const MAX_DUEL_HP = 600;
  const DUEL_HIT_DAMAGE = 40;
  const DUEL_HIT_COOLDOWN_MS = 700;
  // Matchmaking may pair players anywhere in the same local area, but hits
  // resolve only at melee range to match the autonomous agent combat loop.
  const DUEL_MATCH_RANGE = 300;
  const DUEL_HIT_RANGE = 40;
  const arenaMatchForPair = (a, b) => {
    for (const match of room.arenaMatches?.values() || []) {
      if ((match.a === a && match.b === b) || (match.a === b && match.b === a)) return match;
    }
    return null;
  };
  const isArenaParticipant = (sid) => [...(room.arenaMatches?.values() || [])].some((match) =>
    match.a === sid || match.b === sid || match.ownerA === sid || match.ownerB === sid);
  const duelFor = (sid) => {
    const regular = inDuel(sid);
    if (regular) return regular;
    for (const match of room.arenaMatches?.values() || []) {
      if (match.a === sid || match.b === sid) {
        match.combat ||= { a: match.a, b: match.b, arena: true, matchId: match.id, hp: new Map([[match.a, MAX_DUEL_HP], [match.b, MAX_DUEL_HP]]), lastHit: new Map(), resolved: false };
        return match.combat;
      }
    }
    return null;
  };
  const participantsReady = (a, b) => {
    const pa = room.players?.get(a), pb = room.players?.get(b);
    return !!(pa && pb && !pa.dc && !pb.dc && !pa.agent && !pb.agent && clientById(room, a) && clientById(room, b));
  };
  const ownerOf = (sid) => {
    const p = room.players?.get(sid);
    return p?.agent ? p.ownerSid : sid;
  };
  const arenaCombatantReady = (sid) => {
    const p = room.players?.get(sid);
    if (!p || p.dc) return false;
    if (!p.agent) return !!clientById(room, sid);
    const owner = room.players.get(p.ownerSid);
    return !!(room.agents?.get?.(sid) === p && owner && !owner.agent && !owner.dc && clientById(room, p.ownerSid));
  };
  const sameArenaRange = (a, b, range = DUEL_MATCH_RANGE) => {
    const pa = room.players?.get(a), pb = room.players?.get(b);
    return !!(pa && pb && pa.a === pb.a && Math.hypot(pa.x - pb.x, pa.y - pb.y) <= range);
  };
  const ownerOnline = (sid) => {
    const p = room.players?.get(sid);
    return !!(p && !p.agent && !p.dc && clientById(room, sid));
  };
  const canArenaAgentDuel = (a, b, ownerA, ownerB, matchId = '') => {
    const pa = room.players?.get(a), pb = room.players?.get(b);
    if (!pa || !pb || a === b || (!pa.agent && !pb.agent)) return false;
    const resolvedOwnerA = ownerOf(a), resolvedOwnerB = ownerOf(b);
    if (resolvedOwnerA !== ownerA || resolvedOwnerB !== ownerB || !ownerA || !ownerB || ownerA === ownerB) return false;
    if (!ownerOnline(ownerA) || !ownerOnline(ownerB) || !arenaCombatantReady(a) || !arenaCombatantReady(b)) return false;
    if (inDuel(a) || inDuel(b)) return false;
    const reserved = isArenaParticipant(a) || isArenaParticipant(b);
    if (reserved) {
      const match = arenaMatchForPair(a, b);
      if (!match || match.id !== matchId) return false;
    }
    return sameArenaRange(a, b);
  };
  room._canArenaAgentDuel = canArenaAgentDuel;
  const sendArenaState = (match, d) => {
    if (!match || !d) return;
    const sides = [
      [match.ownerA || ownerOf(match.a), match.a, match.b],
      [match.ownerB || ownerOf(match.b), match.b, match.a],
    ];
    for (const [recipient, fighter, opponent] of sides) {
      clientById(room, recipient)?.send('arena:combat-state', {
        matchId: match.id, youHp: d.hp.get(fighter), opponentHp: d.hp.get(opponent), maxHp: MAX_DUEL_HP,
      });
    }
  };
  room._startArenaAgentDuel = (a, b, options = {}) => {
    const match = arenaMatchForPair(a, b);
    const ownerA = options.ownerA || ownerOf(a), ownerB = options.ownerB || ownerOf(b);
    if (!match || String(options.matchId || '') !== match.id || !canArenaAgentDuel(a, b, ownerA, ownerB, match.id)) return false;
    const d = { a, b, arena: true, matchId: match.id, hp: new Map([[a, MAX_DUEL_HP], [b, MAX_DUEL_HP]]), lastHit: new Map(), resolved: false };
    match.combat = d;
    for (const sid of [a, b]) {
      const fighter = room.players.get(sid);
      if (!fighter?.agent) continue;
      if (!room.agents?.assignArenaOpponent?.(sid, sid === a ? b : a, match.id)) {
        for (const agentSid of [a, b]) room.agents?.clearArenaOpponent?.(agentSid, match.id);
        match.combat = null;
        return false;
      }
    }
    for (const sid of [a, b]) {
      if (!room.players.get(sid)?.agent) clientById(room, sid)?.send('duel-start', { a, b, arena: true, matchId: match.id });
    }
    sendArenaState(match, d);
    return true;
  };
  room._agentArenaAttack = (agentSid, targetSid, matchId) => {
    const match = [...(room.arenaMatches?.values() || [])].find((m) => m.id === matchId && (m.a === agentSid || m.b === agentSid));
    const d = match?.combat;
    const target = d && (d.a === agentSid ? d.b : d.b === agentSid ? d.a : null);
    if (!d || !d.arena || d.resolved || target !== targetSid || !room.players.get(agentSid)?.agent || !arenaCombatantReady(agentSid) || !arenaCombatantReady(targetSid) || !sameArenaRange(agentSid, targetSid, 40)) return false;
    const now = Date.now();
    if (now - (d.lastHit.get(agentSid) || 0) < 650) return false;
    d.lastHit.set(agentSid, now);
    d.hp.set(targetSid, Math.max(0, (d.hp.get(targetSid) ?? MAX_DUEL_HP) - DUEL_HIT_DAMAGE));
    const attacker = room.players.get(agentSid);
    if (!room.players.get(targetSid)?.agent) clientById(room, targetSid)?.send('pvp-hit', { from: agentSid, dmg: DUEL_HIT_DAMAGE, x: Math.round(attacker.x), y: Math.round(attacker.y), hp: d.hp.get(targetSid), maxHp: MAX_DUEL_HP });
    sendArenaState(match, d);
    if (d.hp.get(targetSid) === 0) finishDuel(d, agentSid, 'ko');
    return true;
  };
  const canStartDuel = (a, b, matchId = '') => {
    if (a === b || !participantsReady(a, b) || inDuel(a) || inDuel(b)) return false;
    const pa = room.players.get(a), pb = room.players.get(b);
    if (pa.a !== pb.a || Math.hypot(pa.x - pb.x, pa.y - pb.y) > DUEL_MATCH_RANGE) return false;
    const reserved = isArenaParticipant(a) || isArenaParticipant(b);
    if (!reserved) return !matchId;
    const match = arenaMatchForPair(a, b);
    return !!(match && match.id === matchId && match.a !== match.b);
  };
  room._canStartDuel = (a, b) => canStartDuel(a, b);
  const sendDuelStart = (d) => {
    const payload = { a: d.a, b: d.b, ...(d.arena ? { arena: true, matchId: d.matchId } : {}) };
    for (const sid of [d.a, d.b]) {
      clientById(room, sid)?.send('duel-start', payload);
      if (d.arena) clientById(room, sid)?.send('arena:combat-state', { matchId: d.matchId, youHp: d.hp.get(sid), opponentHp: d.hp.get(sid === d.a ? d.b : d.a), maxHp: MAX_DUEL_HP });
    }
  };
  const finishDuel = (d, winner, reason) => {
    if (!d || d.resolved) return false;
    d.resolved = true;
    if (!d.arena) room.social.duels.delete(duelKey(d.a, d.b));
    const match = d.arena ? [...(room.arenaMatches?.values() || [])].find((m) => m.id === d.matchId) : null;
    const payload = { a: d.a, b: d.b, reason: reason || '' };
    if (winner) payload.winner = winner;
    for (const sid of [d.a, d.b]) if (!room.players.get(sid)?.agent) clientById(room, sid)?.send('duel-end', payload);
    if (d.arena && winner) {
      const result = { matchId: d.matchId, winner, loser: winner === d.a ? d.b : d.a, reason };
      // Arena module consumes this trusted in-process result and settles ratings.
      try { room._onArenaCombatResult?.(result); } catch (e) { console.error('[social] arena result hook failed', e); }
      const ownerA = match?.ownerA || ownerOf(d.a), ownerB = match?.ownerB || ownerOf(d.b);
      const ownerWinner = winner === d.a ? ownerA : ownerB;
      const resultForOwners = { matchId: d.matchId, a: ownerA, b: ownerB, winner: ownerWinner, fighterWinner: winner, reason };
      for (const sid of new Set([ownerA, ownerB])) clientById(room, sid)?.send('arena:combat-result', resultForOwners);
    }
    for (const sid of [d.a, d.b]) room.agents?.clearArenaOpponent?.(sid, d.matchId);
    return true;
  };

  // Arena module calls this only after its own matchmaking/challenge checks.
  // No warp is performed: the match is live, but combat requires both clients
  // to be in the same area and within the server-checked attack radius.
  room._startDuel = (a, b, options = {}) => {
    const arena = options.arena === true;
    if (arena) {
      if (!canStartDuel(a, b, String(options.matchId || ''))) return false;
    } else if (a === b || !participantsReady(a, b) || inDuel(a) || inDuel(b) || isArenaParticipant(a) || isArenaParticipant(b)) return false;
    let d;
    if (arena) {
      const match = arenaMatchForPair(a, b);
      if (!match || String(options.matchId || '') !== match.id) return false;
      d = match.combat || { a, b, arena: true, matchId: match.id, hp: new Map([[a, MAX_DUEL_HP], [b, MAX_DUEL_HP]]), lastHit: new Map(), resolved: false };
      match.combat = d;
    } else d = { a, b, arena: false, hp: new Map([[a, MAX_DUEL_HP], [b, MAX_DUEL_HP]]), lastHit: new Map(), resolved: false };
    if (!arena) room.social.duels.set(duelKey(a, b), d);
    sendDuelStart(d);
    return true;
  };
  room.onMessage('duel-challenge', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    if (!bucket(room, client.sessionId)) { err(client, 'Slow down.'); return; }
    const sid = room.social.players.has(m?.to) ? m.to : findByName(room, m?.to);
    if (!sid || sid === client.sessionId) { err(client, 'No such duelist.'); return; }
    if (inDuel(client.sessionId) || isArenaParticipant(client.sessionId)) { err(client, 'Finish your current duel first.'); return; }
    if (inDuel(sid) || isArenaParticipant(sid)) { err(client, `${info(room, sid)?.name || '???'} is already dueling.`); return; }
    clientById(room, sid)?.send('duel-challenge', { from: client.sessionId, fromName: p.name });
    client.send('party-msg', { text: `Duel challenge sent to ${info(room, sid)?.name || '???'}.` });
  });
  room.onMessage('duel-respond', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    const sid = m?.to;
    if (!sid || !room.social.players.has(sid)) { err(client, 'That challenger is gone.'); return; }
    if (!m?.accept) { clientById(room, sid)?.send('duel-decline', { from: client.sessionId, fromName: p.name }); return; }
    if (inDuel(client.sessionId) || inDuel(sid) || isArenaParticipant(client.sessionId) || isArenaParticipant(sid)) { err(client, 'Someone is already dueling.'); return; }
    if (!participantsReady(sid, client.sessionId)) { err(client, 'Both players must be in the world to duel.'); return; }
    const d = { a: sid, b: client.sessionId, at: Date.now(), arena: false, hp: new Map([[sid, MAX_DUEL_HP], [client.sessionId, MAX_DUEL_HP]]), lastHit: new Map(), resolved: false };
    room.social.duels.set(duelKey(sid, client.sessionId), d);
    sendDuelStart(d);
  });
  const endDuel = (sid, reason) => {
    const d = duelFor(sid); if (!d) return false;
    // Only a participant's explicit duel-end is a forfeit. Disconnect and room
    // cleanup end the duel without awarding a winner.
    const winner = reason === 'forfeit' ? (sid === d.a ? d.b : d.a) : null;
    return finishDuel(d, winner, reason);
  };
  room.onMessage('duel-end', (client) => { endDuel(client.sessionId, 'forfeit'); });
  // Server checks pairing, area, accepted positions, range, hit cadence and its
  // own HP ledger. Payload coordinates and damage are deliberately ignored.
  room.onMessage('pvp-hit', (client, m) => {
    const d = duelFor(client.sessionId); if (!d || d.resolved) return;
    const target = d.a === client.sessionId ? d.b : d.a;
    // Keep ordinary consensual duels on their established client-combat relay.
    // Only arena fights consume the server-owned HP ledger used for rated results.
    if (!d.arena) {
      const dmg = Math.max(1, Math.min(500, Math.round(+m?.dmg || 0)));
      clientById(room, target)?.send('pvp-hit', { from: client.sessionId, dmg, x: +m?.x | 0, y: +m?.y | 0 });
      return;
    }
    if (m?.to !== target) return;
    const attacker = room.players?.get(client.sessionId), defender = room.players?.get(target);
    if (!arenaCombatantReady(client.sessionId) || !arenaCombatantReady(target) || !attacker || !defender || attacker.a !== defender.a) return;
    const distance = Math.hypot(attacker.x - defender.x, attacker.y - defender.y);
    if (!Number.isFinite(distance) || distance > DUEL_HIT_RANGE) return;
    const now = Date.now();
    if (now - (d.lastHit.get(client.sessionId) || 0) < DUEL_HIT_COOLDOWN_MS) return;
    d.lastHit.set(client.sessionId, now);
    const hp = Math.max(0, (d.hp.get(target) ?? MAX_DUEL_HP) - DUEL_HIT_DAMAGE);
    d.hp.set(target, hp);
    clientById(room, target)?.send('pvp-hit', { from: client.sessionId, dmg: DUEL_HIT_DAMAGE, x: Math.round(attacker.x), y: Math.round(attacker.y), hp, maxHp: MAX_DUEL_HP });
    client.send('pvp-hit-confirm', { target, dmg: DUEL_HIT_DAMAGE, hp, maxHp: MAX_DUEL_HP });
    if (d.arena) sendArenaState(arenaMatchForPair(d.a, d.b), d);
    if (hp === 0) finishDuel(d, client.sessionId, 'ko');
  });
  room._endDuel = endDuel;

  // ── guild stub (in-memory) ──
  room.onMessage('guild-create', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    const tag = cleanTag(m?.tag);
    if (tag.length < 2) { err(client, 'Guild tag must be 2-4 letters/digits.'); return; }
    if (room.social.guilds.has(tag)) { err(client, `Guild <${tag}> already exists — /gjoin ${tag}.`); return; }
    leaveGuild(room, client.sessionId, true);
    const g = { tag, name: cleanText(m?.name).slice(0, 24) || tag, members: [client.sessionId] };
    room.social.guilds.set(tag, g);
    p.guild = tag;
    pushGuildUpdate(room, g);
    room.broadcast('presence', presenceOf(room, client.sessionId));
  });
  room.onMessage('guild-join', (client, m) => {
    const p = info(room, client.sessionId); if (!p) return;
    const g = room.social.guilds.get(cleanTag(m?.tag));
    if (!g) { err(client, 'No such guild. Create one with /gcreate TAG Name.'); return; }
    leaveGuild(room, client.sessionId, true);
    g.members.push(client.sessionId); p.guild = g.tag;
    pushGuildUpdate(room, g);
    room.broadcast('presence', presenceOf(room, client.sessionId));
  });
  room.onMessage('guild-leave', (client) => {
    if (!info(room, client.sessionId)?.guild) { err(client, 'You are not in a guild.'); return; }
    leaveGuild(room, client.sessionId);
  });
}

export function socialJoin(room, client, options) {
  const hero = options?.hero || {};
  room.social.players.set(client.sessionId, {
    name: String(options?.name || 'Wayfarer').slice(0, 14),
    level: Math.max(1, +options?.level | 0 || 1),
    job: String(hero.job || options?.job || 'wayfarer').slice(0, 16),
    zone: 'town', guild: '', party: '',
  });
  const me = presenceOf(room, client.sessionId);
  room.broadcast('presence', me, { except: client });
  client.send('roster', [...room.social.players.keys()].map((sid) => presenceOf(room, sid)).filter(Boolean));
}

export function socialLeave(room, client) {
  removeFromParty(room, client.sessionId, 'went offline');
  leaveGuild(room, client.sessionId, true);
  if (room._endDuel) room._endDuel(client.sessionId, 'left');
  room.social.players.delete(client.sessionId);
  room.social.rate.delete(client.sessionId);
  room.broadcast('presence-gone', { id: client.sessionId });
}

// ── adapter for the WayfarerRoom hook names (server/index.js: setSocialModule) ──
// install(room) runs after the built-in handlers; onJoin/onLeave get the player record.
export function install(room) { installSocial(room); }
export function onJoin(room, client, p) { socialJoin(room, client, { name: p?.name, hero: p?.hero, level: p?.level, job: p?.job }); }
export function onLeave(room, client) { socialLeave(room, client); }
