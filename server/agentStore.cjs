'use strict';
/**
 * agentStore.cjs — durable, player-keyed ledger for autonomous-agent SOL finds.
 *
 * Conventions copied from server/econStore.js: its OWN file under DATA_DIR,
 * atomic writes (tmp file + fsync + rename — never a half-written file), a
 * load-on-boot that tolerates a missing/corrupt file, and NO dependency on
 * server/db.js (better-sqlite3). Unlike econStore.js this is a plain CommonJS
 * module (hence .cjs) so the pure policy in agentRewards.cjs can be required
 * directly, and so it can be exercised by a throwaway node script with no
 * server boot.
 *
 * WHY THE DATA DIR IS RESOLVED HERE, NOT FROM config.js: server/config.js is an
 * ESM module (`export const CFG`); a .cjs file cannot `require()` it
 * synchronously and this change deliberately does not modify config.js (another
 * track owns it). The resolution below MIRRORS config.js exactly — DATA_DIR
 * env, else <repo server dir>/data — and appends `agents/`. If the parent later
 * wants this wired into CFG, that is parent/other-track work.
 *
 * FILE   DATA_DIR/agents/agents.json
 * SHAPE  {
 *          "players": {
 *            "<charKey>": { agentId, solFoundLamports, solClaimedLamports,
 *                           lastFindAt, foundTodayLamports, dayKey,
 *                           finds:[{lamports,at}], claim, lastClaim }
 *          },
 *          "global": { "totalFoundLamports": n, "totalClaimedLamports": n }
 *        }
 *
 * HONESTY: this file stores numbers. It holds no SOL, no key, no treasury and
 * moves nothing. `global` exists for operator visibility only.
 */

const fs = require('fs');
const path = require('path');
const R = require('./agentRewards.cjs');

const baseDataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DEFAULT_DIR = path.join(baseDataDir, 'agents');
const FILE_NAME = 'agents.json';
const FINDS_MAX = R.DEFAULTS.findsMax;

const intOr0 = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/**
 * Create an agent ledger store bound to a directory.
 *   createAgentStore({ dir, log }) -> store
 * Pass `dir` in tests so a throwaway script never touches the real data dir.
 * `log` is any {info,warn,error,debug} (server/log.js's `log` fits).
 */
function createAgentStore(opts = {}) {
  const dir = path.resolve(opts.dir || DEFAULT_DIR);
  const file = path.join(dir, FILE_NAME);
  const log = opts.log || { info() {}, warn() {}, error() {}, debug() {} };

  const db = {
    players: Object.create(null),
    global: { totalFoundLamports: 0, totalClaimedLamports: 0 },
  };
  let seq = 0;
  let loaded = false;

  function writeAtomicSync(data) {
    const tmp = `${file}.${process.pid}-${seq++}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  }

  /** Load from disk (creating the dir). Missing/corrupt file => empty ledger. */
  function load() {
    fs.mkdirSync(dir, { recursive: true });
    // sweep .tmp files left by a crash mid-write (same idea as econStore recover())
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        if (parsed.players && typeof parsed.players === 'object') {
          db.players = Object.create(null);
          for (const [k, v] of Object.entries(parsed.players)) db.players[k] = R.normalize(v);
        }
        if (parsed.global && typeof parsed.global === 'object') {
          db.global = {
            totalFoundLamports: intOr0(parsed.global.totalFoundLamports),
            totalClaimedLamports: intOr0(parsed.global.totalClaimedLamports),
          };
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') log.error('agentStore: agents.json unreadable (starting empty)', { err: e.message });
    }
    loaded = true;
    log.info('agentStore ready', { dir, players: Object.keys(db.players).length, ...db.global });
    return db;
  }

  function ensureLoaded() { if (!loaded) load(); }

  /** Atomic durable write of the whole ledger. */
  function save() { writeAtomicSync(JSON.stringify(db)); }

  /** The canonical entry for a player key, created blank on first touch. */
  function entry(ck) {
    if (!ck) return null;
    ensureLoaded();
    const key = String(ck);
    if (!db.players[key]) db.players[key] = R.blankEntry();
    return db.players[key];
  }

  function get(ck) { return ck ? db.players[String(ck)] || null : null; }

  /** Replace a player's entry wholesale (used by the claim phase callbacks). */
  function put(ck, state) {
    if (!ck) return null;
    ensureLoaded();
    const norm = R.normalize(state);
    db.players[String(ck)] = norm;
    return norm;
  }

  function global() { return { ...db.global }; }

  function stats() {
    return {
      players: Object.keys(db.players).length,
      pending: Object.values(db.players).filter((p) => p.claim && p.claim.status === 'pending').length,
      ...db.global,
    };
  }

  /**
   * Book a find against a player and persist atomically.
   * Pure policy (R.accrue) + global bookkeeping + IO. Returns { state, accepted, reason }.
   */
  function recordFind(ck, findOpts = {}) {
    const e = entry(ck);
    if (!e) return { state: null, accepted: 0, reason: 'nokey' };
    const { state, accepted, reason } = R.accrue(e, findOpts);
    db.players[String(ck)] = state;
    if (accepted > 0) db.global.totalFoundLamports += accepted;
    save();
    return { state, accepted, reason };
  }

  /**
   * Run the two-phase claim for a player, wiring persist -> put+save so the
   * intent marker is durably on disk before any payout is attempted.
   *   applyClaim(ck, ctx) -> same shape as R.claim, plus updates `global` on commit.
   * ctx.perform is REQUIRED and CALLER-OWNED — this store never supplies one.
   */
  async function applyClaim(ck, ctx = {}) {
    const cur = entry(ck);
    if (!cur) return { state: null, ok: false, reason: 'nokey' };
    const persist = async (nextState) => { put(ck, nextState); save(); };
    const res = await R.claim(cur, { ...ctx, persist });
    if (res && res.ok && !res.duplicate && res.amount > 0) db.global.totalClaimedLamports += res.amount;
    return res;
  }

  return {
    dir, file, db,
    load, save, entry, get, put, global, stats, recordFind, applyClaim,
  };
}

module.exports = { createAgentStore, DEFAULT_DIR, FILE_NAME, FINDS_MAX };
