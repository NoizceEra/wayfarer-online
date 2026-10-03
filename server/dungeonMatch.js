/**
 * dungeonMatch.js — Colyseus-compatible LFG/dungeon matchmaking scaffold.
 * No runtime dependency on Colyseus; exposes a function that can be wired into
 * a room's onMessage handlers.
 */

const QUEUE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MATCH_COUNTDOWN_MS = 10000; // 10 seconds

class DungeonMatchmaker {
  constructor() {
    /** @type {Map<string, QueueEntry>} */
    this.queue = new Map();
    /** @type {Map<string, MatchSession>} */
    this.matches = new Map();
    this.tickInterval = null;
  }

  start() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this.tick(), 5000);
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Add a player or party to the queue.
   * @param {string} ticket
   * @param {object} player
   * @param {string} dungeonId
   * @param {string} [role]
   * @param {string} [groupMode]
   */
  enqueue(ticket, player, dungeonId, role = 'any', groupMode = 'solo') {
    this.queue.set(ticket, {
      ticket,
      player,
      dungeonId,
      role,
      groupMode,
      joinedAt: Date.now(),
      matched: false,
    });
  }

  /**
   * Remove a ticket from queue.
   * @param {string} ticket
   */
  cancel(ticket) {
    this.queue.delete(ticket);
    const match = this.matches.get(ticket);
    if (match && !match.locked) {
      for (const t of match.tickets) this.matches.delete(t);
    }
  }

  /**
   * Accept a match.
   * @param {string} ticket
   * @returns {object|null} match state
   */
  accept(ticket) {
    const match = this.matches.get(ticket);
    if (!match) return null;
    match.accepted.add(ticket);
    if (match.accepted.size === match.tickets.size) {
      match.locked = true;
      match.status = 'locked';
    }
    return match;
  }

  /**
   * Run one matching pass.
   */
  tick() {
    const now = Date.now();
    for (const [ticket, entry] of this.queue) {
      if (entry.matched) continue;
      if (now - entry.joinedAt > QUEUE_TTL_MS) {
        this.queue.delete(ticket);
        continue;
      }
      this.tryMatch(entry);
    }

    for (const [ticket, match] of this.matches) {
      if (match.locked) continue;
      if (now - match.createdAt > MATCH_COUNTDOWN_MS) {
        // Decline anyone who didn't accept
        for (const t of match.tickets) {
          this.matches.delete(t);
          const q = this.queue.get(t);
          if (q) q.matched = false;
        }
      }
    }
  }

  tryMatch(entry) {
    const candidates = [];
    for (const [ticket, other] of this.queue) {
      if (ticket === entry.ticket) continue;
      if (other.matched) continue;
      if (other.dungeonId !== entry.dungeonId) continue;
      candidates.push(other);
    }

    // Prefer diverse roles, then oldest.
    candidates.sort((a, b) => {
      const roleDiff = this.roleScore(entry.role, a.role) - this.roleScore(entry.role, b.role);
      if (roleDiff !== 0) return roleDiff;
      return a.joinedAt - b.joinedAt;
    });

    const maxParty = 3; // server-side party cap (could come from dungeon def)
    const party = [entry];
    for (const c of candidates) {
      if (party.length >= maxParty) break;
      party.push(c);
    }

    if (party.length < 1) return;

    const matchId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const match = {
      id: matchId,
      dungeonId: entry.dungeonId,
      tickets: new Set(party.map((p) => p.ticket)),
      players: party.map((p) => p.player),
      accepted: new Set(),
      createdAt: Date.now(),
      locked: false,
      status: 'pending',
    };

    for (const p of party) {
      p.matched = true;
      this.matches.set(p.ticket, match);
    }
  }

  roleScore(ref, other) {
    if (ref === 'any' || other === 'any') return 0;
    return ref === other ? 2 : -1;
  }

  /**
   * @param {string} ticket
   * @returns {object|null}
   */
  getMatch(ticket) {
    return this.matches.get(ticket) || null;
  }

  /**
   * @param {string} ticket
   * @returns {'idle'|'queued'|'ready'|'locked'}
   */
  getStatus(ticket) {
    if (this.matches.has(ticket)) {
      const m = this.matches.get(ticket);
      return m.locked ? 'locked' : 'ready';
    }
    if (this.queue.has(ticket)) return 'queued';
    return 'idle';
  }

  /**
   * Wire into a Colyseus room or express-style socket handler.
   * @param {object} room
   */
  bindToRoom(room) {
    this.start();
    room.onMessage('lfg:queue', (client, msg) => {
      const ticket = msg?.ticket || `${msg?.dungeonId}_${Date.now()}_${client.sessionId}`;
      this.enqueue(ticket, { sessionId: client.sessionId }, msg.dungeonId, msg.role, msg.groupMode);
      client.send('lfg:queued', { ticket });
    });

    room.onMessage('lfg:cancel', (client, msg) => {
      this.cancel(msg?.ticket);
      client.send('lfg:cancelled', { ticket: msg?.ticket });
    });

    room.onMessage('lfg:accept', (client, msg) => {
      const match = this.accept(msg?.ticket);
      if (!match) {
        client.send('lfg:error', { reason: 'match_expired' });
        return;
      }
      if (match.locked) {
        this.createDungeonRoom(room, match);
      } else {
        client.send('lfg:waiting', {
          accepted: match.accepted.size,
          required: match.tickets.size,
        });
      }
    });
  }

  createDungeonRoom(room, match) {
    // Scaffold: notify all matched clients.
    for (const ticket of match.tickets) {
      const q = this.queue.get(ticket);
      if (!q) continue;
      const client = room.clients.find((c) => c.sessionId === q.player.sessionId);
      if (client) {
        client.send('dungeon:enter', {
          dungeonId: match.dungeonId,
          matchId: match.id,
          playerCount: match.players.length,
        });
      }
    }
    for (const t of match.tickets) {
      this.matches.delete(t);
      this.queue.delete(t);
    }
  }
}

function createMatchmaker() {
  return new DungeonMatchmaker();
}

export { DungeonMatchmaker, createMatchmaker };
export default DungeonMatchmaker;
