// server/econ/index.js — the optional token-economy module.
//
// Loaded by server/index.js exactly like ./economy.js / ./wallet.js: a try/catch dynamic
// import (absent = the relay behaves as if the token layer did not exist), then init() +
// addRoomModule(this), then routes(app), then stop() during shutdown. It exports the same
// hook names those modules do; the only room hook it needs is afterSave, because the
// economy is server-authoritative and gets its input from the character save, not from a
// client message.
//
// WHAT IT OWNS
//   * the /econ/* HTTP surface (http.js) — the only way a client reads balances, stakes,
//     claims, rates and history;
//   * the per-kill WAYFARER credit (ops.creditKills) wired into the save hook below;
//   * the durable emission budget + stake registry (state.js), and the lifecycle that
//     flushes it.
// WHAT IT DELIBERATELY DOES NOT DO
//   * no idle gold accrual: ECON_IDLE_GOLD defaults false and server/economy/idle.js is
//     never called here (owner's rule, rewards.js header / docs/BLOCKCHAIN_V1.md §3.9);
//   * no signing: only economy/payouts.js signs, and only when PAYOUTS_ENABLED === 'true';
//   * no chain access on any path the game loop can touch.

import { log } from '../log.js';
import { initLedger, flushAll as flushLedger, stopLedger, ledgerStats } from '../economy/ledger.js';
import { initState, flushState, stopState, stateStats } from './state.js';
import { routes as httpRoutes } from './http.js';
import { econEnabled, flagsPublic } from './config.js';
import { creditKillsForSave } from './ops.js';

export function init() {
  initState();
  initLedger();
  // Exactly one line, and it says which of the three states the economy is in. The chain
  // layer must degrade quietly and visibly, never by crashing or by staying silent.
  const f = flagsPublic();
  if (!f.enabled) {
    log.info('econ module loaded: ECON_ENABLED is off — /econ/rates and /econ/balance answer, everything that moves value refuses');
  } else if (!f.configured) {
    log.warn(`econ module loaded: ECON_ENABLED is on but the chain is unconfigured (missing ${f.missing.join(', ')}) — ledger paths work, /econ/claim refuses`);
  } else {
    log.info('econ module ready', { cluster: f.cluster, payoutsEnabled: f.payoutsEnabled, idleGold: f.idleGold });
  }
}

export function flush() { flushState(); return flushLedger(); }

export async function stop() {
  stopState();                                            // sync: the budget/stakes must land
  try { await flushLedger(); } catch (e) { log.error('econ ledger flush failed', { err: e.message }); }
  stopLedger();
  log.info('econ stopped', { state: stateStats(), ledger: ledgerStats() });
}

export function routes(app) { httpRoutes(app); }

// ── the kill-credit hook ────────────────────────────────────────────────────
// WayfarerRoom.onSave calls every room module's afterSave AFTER validate.js accepted and
// clamped the save, so `info.rec.kills` is the validated per-type kill map: unknown ids
// dropped, counts bounded. Gold was already credited by the clamp in validate.js; this adds
// the WAYFARER side of the same event, per kill, for the boss types that carry `crypto`
// (server/rewards.js). Ordinary enemies carry crypto 0 and pay nothing.
//
// It happens HERE (on save) and never in the tick/combat path: docs/BLOCKCHAIN_V1.md §3.2 —
// the chain is never in the hot path, and this touches no chain at all.
export function afterSave(room, client, p, info) {
  if (!econEnabled()) return;                             // value-moving: needs the flag
  let r = null;
  try { r = creditKillsForSave(p, info); }
  catch (e) { log.warn('econ kill credit failed', { err: e.message }); return; }
  if (r && r.creditedRaw > 0) {
    log.info('econ combat credit', { name: p?.name, creditedRaw: r.creditedRaw, byType: r.byType });
  }
}
