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

export const AGENT_TYPES = ['agent-entitlement', 'agent-state', 'agent-claim-result', 'agent-claim', 'agent-hire-state', 'agent-hire-result'];

const INCOMING = ['agent-entitlement', 'agent-state', 'agent-claim-result', 'agent-hire-state', 'agent-hire-result'];
const OUTGOING = new Set(['agent-claim', 'agent-hire-state']);

const handlers = {
  'agent-entitlement': new Set(),
  'agent-state': new Set(),
  'agent-claim-result': new Set(),
  'agent-hire-state': new Set(),
  'agent-hire-result': new Set(),
};

// ─── snapshot state (readable via `state`) ───────────────────────────────
let entitlement = null;   // latest agent-entitlement
let agent = null;         // latest agent-state
let lastClaim = null;     // latest agent-claim-result
let hireling = null;
let hirelingOptions = [];
let lastHire = null;
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
        else if (type === 'agent-hire-state') { hireling = msg.agent || null; hirelingOptions = Array.isArray(msg.tiers) ? msg.tiers : hirelingOptions; }
        else if (type === 'agent-hire-result') { lastHire = msg; if (msg.ok) { hireling = msg.agent || hireling; hirelingOptions = Array.isArray(msg.tiers) ? msg.tiers : hirelingOptions; } }
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
    agents.set(m.sessionId, { sid: m.sessionId, name: m.name || null, ownerSid: m.ownerSid || null, hireling: m.hireling === 1, intelligence: m.intelligence || 1 });
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

// ─── world nameplate badging ────────────────────────────────────────────────
// ONE source of truth for how an agent peer is marked in the world. Shared by
// the plate renderers (src/systems/social/world.js and src/entities/
// RemotePlayer.js) so the marker + colours can never drift between them.
// The palette is deliberately OUTSIDE party(#7dff9a green)/friend(#ff9ad5
// pink)/guild(#ffd84a gold)/other(#ffffff) so an agent plate is unmistakable:
// bright cyan text on a deep navy-cyan background. isAgent() above stays a
// plain Set lookup with no allocation; agentPlateText builds at most one string
// per plate (the plates already join a string every refresh).
export const AGENT_PLATE_BADGE = '◆ AUTO';
export const AGENT_PLATE_COLOR = '#00e5ff';
export const AGENT_PLATE_BG = '#06283dee';
export function agentPlateText(text) { return text ? `${AGENT_PLATE_BADGE} · ${text}` : AGENT_PLATE_BADGE; }

export const agentsNet = {
  isOnline() { return !!net.connected; },

  // Ask the server to pay out the agent's accumulated SOL. No-op offline; the
  // server decides — a disabled claim path answers via agent-claim-result.
  claim() { return send('agent-claim'); },
  requestHirelingState() { return send('agent-hire-state'); },

  onEntitlement(fn) { return on('agent-entitlement', fn); },
  onState(fn) { return on('agent-state', fn); },
  onClaimResult(fn) { return on('agent-claim-result', fn); },
  onHireState(fn) { return on('agent-hire-state', fn); },
  onHireResult(fn) { return on('agent-hire-result', fn); },

  // Read-only snapshot of everything received so far.
  get state() {
    return { entitlement, agent, lastClaim, hireling, hirelingOptions, lastHire, agents: [...agents.values()], connected: !!net.connected };
  },

  // ─── agent identity (for marking agents in the world / on the HUD) ──────
  isAgent(id) { ensureIdWired(); return agents.has(id); },
  agentIds() { ensureIdWired(); return [...agents.keys()]; },
  onAgents(fn) { ensureIdWired(); agentListeners.add(fn); return () => agentListeners.delete(fn); },
};
