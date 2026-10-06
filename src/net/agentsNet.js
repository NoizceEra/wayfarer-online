import { net } from './NetworkManager.js';

// Client-side API for the autonomous agent system (see docs/AGENT_CLIENT.md).
//
// Mirrors src/net/arenaNet.js: the three server->client messages are handled
// per-attach via net.onAttach + room.onMessage (so they survive reconnects),
// and the client->server `agent-claim` goes through the generic relay.
//
// Incoming (server -> client, to the owning player only):
//   agent-entitlement  { eligible, reason, held, requiredUsd, priceUsd }
//   agent-state        { sid, name, action, zone, gathers:{...}, kills, solFound, uptimeMs }
//   agent-claim-result { ok, amount, reason }
// Outgoing (client -> server):
//   claim() -> agent-claim {}
//
// Agent IDENTITY arrives out-of-band: `peer-join.agent`/`peer-join.ownerSid`
// and `snap.p[].ag`. Real players still render from `snap` untouched — this
// module only records WHICH remote sessionIds are agents so the world/HUD can
// mark them (`isAgent(id)` / `agentIds()` / `onAgents()`); it never draws.

export const AGENT_TYPES = ['agent-entitlement', 'agent-state', 'agent-claim-result', 'agent-claim'];

const INCOMING = ['agent-entitlement', 'agent-state', 'agent-claim-result'];
const OUTGOING = new Set(['agent-claim']);

const handlers = {
  'agent-entitlement': new Set(),
  'agent-state': new Set(),
  'agent-claim-result': new Set(),
};

// ─── snapshot state (readable via `state`) ───────────────────────────────
let entitlement = null;   // latest agent-entitlement
let agent = null;         // latest agent-state
let lastClaim = null;     // latest agent-claim-result
const agents = new Map(); // sid -> { sid, name, ownerSid } — identity of agent peers
const agentListeners = new Set();

let wired = false;
let idWired = false;

function safe(fn, ...args) { try { fn(...args); } catch (e) { console.error('[agentsNet]', e); } }

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
        if (type === 'agent-entitlement') entitlement = msg;
        else if (type === 'agent-state') agent = msg;
        else lastClaim = msg;
        for (const fn of handlers[type]) safe(fn, msg);
      });
    }
  });
}

// Identity comes from broadcast messages already forwarded by NetworkManager
// for every room (snap / peer-join / peer-leave), so the generic net.on path
// is the right hook here — no polling and no new room-level listeners.
function ensureIdWired() {
  if (idWired) return;
  idWired = true;
  net.on('peer-join', (m) => {
    if (!m || m.agent !== 1 || !m.sessionId) return;
    agents.set(m.sessionId, { sid: m.sessionId, name: m.name || null, ownerSid: m.ownerSid || null });
    notifyAgents();
  });
  net.on('peer-leave', (m) => { if (m && agents.delete(m.sessionId)) notifyAgents(); });
  net.on('snap', (m) => {
    let added = false;
    for (const d of m?.p || []) {
      if (d && d.ag === 1 && d.i && !agents.has(d.i)) {
        agents.set(d.i, { sid: d.i, name: null, ownerSid: null });
        added = true;
      }
    }
    if (added) notifyAgents();
  });
}

function notifyAgents() {
  const list = [...agents.values()];
  for (const fn of agentListeners) safe(fn, list);
}

function send(type, payload = {}) {
  if (!OUTGOING.has(type)) return false;
  if (!net.connected) { console.warn('[agentsNet] offline, no-op:', type); return false; }
  return net.send(type, payload);
}

function on(type, fn) { ensureWired(); handlers[type].add(fn); return () => handlers[type].delete(fn); }

export const agentsNet = {
  isOnline() { return !!net.connected; },

  // Ask the server to pay out the agent's accumulated SOL. No-op offline; the
  // server decides — a disabled claim path answers via agent-claim-result.
  claim() { return send('agent-claim'); },

  onEntitlement(fn) { return on('agent-entitlement', fn); },
  onState(fn) { return on('agent-state', fn); },
  onClaimResult(fn) { return on('agent-claim-result', fn); },

  // Read-only snapshot of everything received so far.
  get state() {
    return { entitlement, agent, lastClaim, agents: [...agents.values()], connected: !!net.connected };
  },

  // ─── agent identity (for marking agents in the world / on the HUD) ──────
  isAgent(id) { ensureIdWired(); return agents.has(id); },
  agentIds() { ensureIdWired(); return [...agents.keys()]; },
  onAgents(fn) { ensureIdWired(); agentListeners.add(fn); return () => agentListeners.delete(fn); },
};
