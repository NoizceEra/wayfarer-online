'use strict';
/**
 * agentPersist.cjs — PURE progress-continuity policy for autonomous agents.
 *
 * NO IO, NO fs, NO network, NO db. Every function takes plain data and returns
 * plain data (or mutates the agent record it is handed, by design). This mirrors
 * the split in server/agentRewards.cjs: the money rules are pure and unit-testable
 * and the durable IO lives in one place (server/agentStore.cjs).
 *
 * WHAT THIS IS
 *   An OWNED agent (a wallet-holding player's companion) accrues progress as it
 *   works: gathered resources, engaged kills, and the level that follows. That
 *   progress must survive a relay restart so the owner's companion is the SAME
 *   one on return — not a fresh spawn. This module defines the record shape, the
 *   level curve, and the (pure) restore rule. The actual read/write of the
 *   `progress` section of DATA_DIR/agents/agents.json is agentStore.cjs's job, so
 *   there is exactly ONE on-disk format for the agent subsystem.
 *
 * KEYED BY THE OWNER'S STABLE DEVICE TOKEN (never the ephemeral sessionId):
 *   spawn(opts.ownerSid) resolves the owner's CURRENT session to its player
 *   record and uses owner.token as the persistence key. Ambient agents (no owner)
 *   and temporary gold-hired companions (hirelings) are NOT persisted — pets and
 *   hired help are not companions.
 *
 * HONESTY: this file stores numbers and display data. It holds no SOL, no key,
 * no treasury, and moves nothing. The `solFoundLamports` mirror is a read-only
 * convenience copy of the reward ledger (server/agentStore.cjs `players` section),
 * which stays the authoritative record of accrued finds.
 */

const MIN_LEVEL = 1;
const MAX_LEVEL = 99;

// Level curve: a companion gains a level every LEVEL_GATHER_STEP resources worked
// and every LEVEL_KILL_STEP hostiles that died while it was engaged. `base` is the
// level the agent started at (owner-derived at first spawn, then persisted), so
// the SAME (base, gathered, kills) always maps to the SAME level — an exact,
// restart-stable restore with no hidden counter.
const LEVEL_GATHER_STEP = 8;
const LEVEL_KILL_STEP = 4;

// Bound every stored integer so a corrupt/hostile file can never inject absurdity.
const MAX_COUNTER = 1_000_000_000;
const MAX_SOL_LAMPORTS = 1_000_000_000_000_000; // same ceiling as agentRewards.ABSURD_LAMPORTS

const clampInt = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d;
};
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

/** Level implied by (base, gathered, kills). Pure; used at spawn and after work. */
function computeLevel(base, gathered, kills) {
  const b = clampInt(base, MIN_LEVEL, MAX_LEVEL, MIN_LEVEL);
  const g = clampInt(gathered, 0, MAX_COUNTER, 0);
  const k = clampInt(kills, 0, MAX_COUNTER, 0);
  return clampInt(b + Math.floor(g / LEVEL_GATHER_STEP) + Math.floor(k / LEVEL_KILL_STEP), MIN_LEVEL, MAX_LEVEL, MIN_LEVEL);
}

/** Blank, well-formed stats block (attacks/spells are session-local, not restored). */
function blankStats() {
  return { gathered: 0, attacks: 0, spells: 0, kills: 0 };
}

// A defensively-copied hero: only primitive/string/number/bool own fields, so a
// corrupt file can never smuggle a nested/garbage look object into the client.
function cleanHero(hero) {
  if (!hero || typeof hero !== 'object') return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(hero)) {
    if (n >= 48) break;
    const v = hero[k];
    const t = typeof v;
    if (t === 'string') { out[k] = v.slice(0, 64); n++; }
    else if (t === 'number' && Number.isFinite(v)) { out[k] = v; n++; }
    else if (t === 'boolean') { out[k] = v; n++; }
    // starter:{} etc. dropped on purpose — the client re-merges defaultHero()
  }
  return out;
}

/**
 * Coerce any input into the canonical persisted shape, or null when there is
 * nothing usable. Never throws.
 */
function normalizeProgress(v) {
  if (!v || typeof v !== 'object') return null;
  const gathered = clampInt(v.gathered, 0, MAX_COUNTER, 0);
  const kills = clampInt(v.kills, 0, MAX_COUNTER, 0);
  // base is authoritative for the curve; fall back to an explicit level if an
  // older/partial record only carries `level`.
  const base = clampInt(v.base, MIN_LEVEL, MAX_LEVEL, clampInt(v.level, MIN_LEVEL, MAX_LEVEL, MIN_LEVEL));
  const snap = {
    name: str(v.name, 14),
    hero: cleanHero(v.hero),
    base,
    level: computeLevel(base, gathered, kills),
    gathered,
    kills,
    attacks: clampInt(v.attacks, 0, MAX_COUNTER, 0),
    spells: clampInt(v.spells, 0, MAX_COUNTER, 0),
    solFoundLamports: clampInt(v.solFoundLamports, 0, MAX_SOL_LAMPORTS, 0),
    updatedAt: Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
  };
  return snap;
}

/** Build the durable snapshot for an agent record. Pure. */
function snapshot(agent, solFoundLamports, now = Date.now()) {
  const b = (agent && agent.b) || {};
  const s = (b.stats) || {};
  const gathered = clampInt(s.gathered, 0, MAX_COUNTER, 0);
  const kills = clampInt(s.kills, 0, MAX_COUNTER, 0);
  const base = clampInt(b.base, MIN_LEVEL, MAX_LEVEL, clampInt(agent && agent.level, MIN_LEVEL, MAX_LEVEL, MIN_LEVEL));
  return {
    name: str(agent && agent.name, 14),
    hero: cleanHero(agent && agent.hero),
    base,
    level: computeLevel(base, gathered, kills),
    gathered,
    kills,
    attacks: clampInt(s.attacks, 0, MAX_COUNTER, 0),
    spells: clampInt(s.spells, 0, MAX_COUNTER, 0),
    solFoundLamports: clampInt(solFoundLamports, 0, MAX_SOL_LAMPORTS, 0),
    updatedAt: now,
  };
}

/**
 * Apply a persisted snapshot onto a freshly-built agent record (in place).
 * Returns the normalized snapshot applied, or null if there was nothing usable.
 * Only identity/level/progress fields are touched; behaviour state is untouched.
 */
function applyTo(agent, snapIn) {
  const snap = normalizeProgress(snapIn);
  if (!snap || !agent) return null;
  agent.b = agent.b || {};
  agent.b.base = snap.base;
  agent.b.stats = { ...(agent.b.stats || blankStats()), gathered: snap.gathered, kills: snap.kills };
  if (snap.name) agent.name = snap.name;
  if (agent.hero && snap.hero) agent.hero = { ...agent.hero, ...snap.hero, name: agent.name };
  else if (agent.hero) agent.hero.name = agent.name;
  agent.level = computeLevel(snap.base, snap.gathered, snap.kills);
  return snap;
}

module.exports = {
  MIN_LEVEL,
  MAX_LEVEL,
  LEVEL_GATHER_STEP,
  LEVEL_KILL_STEP,
  MAX_COUNTER,
  MAX_SOL_LAMPORTS,
  computeLevel,
  blankStats,
  cleanHero,
  normalizeProgress,
  snapshot,
  applyTo,
};
