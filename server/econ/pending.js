// server/econ/pending.js — the RETROACTIVE HOOK: what an UNLINKED device is owed.
//
// THE RULE THIS FILE EXISTS FOR (docs/BLOCKCHAIN_V1.md, part 3): a player who plays
// forty hours before they ever connect a wallet must not be punished for it. The token
// layer is OPT-IN and does not exist until a signature-verified wallet link does, so
// while there is no link NOTHING is written to the WAYFARER ledger (ops.js). But the
// player's history is still recorded, and this module answers exactly one question:
//
//     "what would this device be owed if it linked a wallet now?"
//
//   * It is RECORDED and REPORTED, and it is NEVER PAID. Nothing here calls the ledger,
//     and `ops.claimFor` claims only the ledger balance — pending can never leave the
//     relay through this module.
//   * It is IDEMPOTENT BY ID. Every accomplishment is a stable id
//     ('ach:hunter', 'boss:forgelord', 'bestiary:redclaw', ...); recording the same one
//     twice is a no-op, so replaying a save cannot inflate it.
//   * It is BOUNDED. The combat half reuses the SAME per-type plausibility cap as the
//     live credit (server/rewards.js `cap`), and the achievement/codex half reads at
//     most the same keys the client's own save normaliser keeps.
//   * It is DISPLAY-ONLY DATA. The client-supplied half (`info.raw.ext`) is untrusted by
//     definition — the relay never saw those events — so it can never move money. It is
//     a preview an operator can hand to the player, and a record to settle by hand if
//     the owner ever decides to back-pay.
//
// TWO HALVES OF "OWED":
//   earnedRaw         — the WAYFARER this device would have earned from its boss kills
//                       while unlinked, computed with the identical delta + cap logic
//                       the live path uses (ops.creditKills).
//   accomplishmentsRaw — a ONE-TIME bonus per recorded accomplishment. Boss first-kills
//                       are recorded but valued at 0 here: they already earn their
//                       per-kill `crypto` through earnedRaw, and valuing them again
//                       would double-pay the same kill.

import { ENEMY_REWARDS } from '../rewards.js';
import * as state from './state.js';

// The one unit conversion this module needs; it matches ops.CRYPTO_UNIT_RAW (a whole
// WAYFARER figure in server/rewards.js -> base units at 6 decimals).
const UNIT = 10 ** 6;

/**
 * DRAFT POLICY, in one place so an operator can tune it without hunting: the base-unit
 * value of each kind of one-time accomplishment. Prefixes map to the id families below.
 */
export const ACCOMPLISHMENT_RAW = {
  boss: 0,                    // first kill of a boss type — already earned per-kill
  dungeon: 15 * UNIT,         // first clear of a dungeon
  ach: 5 * UNIT,              // each achievement / feat unlocked
  bestiary: 1 * UNIT,         // each enemy type discovered
  'codex:gear': 1 * UNIT,     // each gear codex entry
  'codex:mats': 1 * UNIT,     // each material codex entry
};

/** The id family of an accomplishment ('boss:forgelord' -> 'boss'). */
export const accomplishmentKind = (id) => {
  const s = String(id || '');
  if (s.startsWith('codex:')) return s.split(':').slice(0, 2).join(':');   // codex:gear | codex:mats
  return s.split(':')[0];
};

/** The value, in base units, of one accomplishment id. Unknown kinds are worth 0. */
export function accomplishmentValueRaw(id) {
  const v = ACCOMPLISHMENT_RAW[accomplishmentKind(id)];
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

const MAX_ACH = 400;        // mirrors src/core/save.js normalizeExtras (.slice(0, 400))
const MAX_BESTIARY = 80;    // mirrors src/core/save.js normalizeExtras
const MAX_CODEX = 400;
const ID_RE = /^[A-Za-z0-9_:.-]{1,80}$/;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const keys = (o, max) => (isObj(o) ? Object.keys(o).slice(0, max) : []);

/**
 * Every one-time accomplishment this save demonstrates. Pure: no I/O, no state.
 *
 * `rec`  the VALIDATED character record (validate.js) — its per-type kill map is the
 *        only trustworthy "this boss died" evidence the relay has.
 * `raw`  the raw client progress, used ONLY for the content-depth buckets the relay
 *        has no other view of (achievements, bestiary, codex). Never paid.
 *
 * @returns {string[]} stable ids, deduplicated.
 */
export function extractAccomplishments(rec, raw) {
  const ids = new Set();
  const kills = rec && isObj(rec.kills) ? rec.kills : {};
  for (const [type, n] of Object.entries(kills)) {
    const spec = ENEMY_REWARDS[type];
    if (spec && spec.crypto > 0 && Number.isFinite(Number(n)) && Number(n) >= 1) ids.add(`boss:${type}`);
  }
  const ext = isObj(raw?.ext) ? raw.ext : (isObj(rec?.ext) ? rec.ext : null);
  if (ext) {
    for (const id of keys(ext.ach, MAX_ACH)) ids.add(`ach:${id}`);
    for (const id of keys(ext.bestiary, MAX_BESTIARY)) ids.add(`bestiary:${id}`);
    for (const id of keys(ext.codex?.gear, MAX_CODEX)) ids.add(`codex:gear:${id}`);
    for (const id of keys(ext.codex?.mats, MAX_CODEX)) ids.add(`codex:mats:${id}`);
    // The achievement counters carry dungeon clears and named boss kills; the dungeon
    // counter is the only first-clear signal the save exposes.
    if (isObj(ext.counters) && Number(ext.counters.dungeons) >= 1) ids.add('dungeon:first');
  }
  return [...ids].filter((id) => ID_RE.test(id));
}

/** The base-unit value of a set of accomplishment ids (unknown kinds are worth 0). */
export function accomplishmentsValueRaw(ids) {
  let sum = 0;
  for (const id of ids || []) sum += accomplishmentValueRaw(id);
  return sum;
}

/**
 * The ONE function that answers "what would this device be owed if it linked now".
 * Reads only the durable record; never moves anything.
 *
 * @returns {{ok:boolean, pendingOnLinkRaw:number, earnedRaw:number, accomplishmentsRaw:number,
 *            accomplishments:Array<{id:string, at:number}>, note:string}}
 */
export function pendingFor(playerKey) {
  const p = state.pendingOf(playerKey);
  const accomplishments = Object.entries(p.accomplishments)
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id));
  const accomplishmentsRaw = accomplishmentsValueRaw(accomplishments.map((a) => a.id));
  return {
    ok: true,
    pendingOnLinkRaw: p.earnedRaw + accomplishmentsRaw,
    earnedRaw: p.earnedRaw,
    accomplishmentsRaw,
    accomplishments,
    note: 'Recorded while this device had no wallet. Not paid and never auto-paid: it is a '
      + 'preview of what linking would have been worth, and a record an operator can settle by hand.',
  };
}

/**
 * Record the one-time accomplishments of a save. Idempotent; returns how many were NEW.
 * Called by the relay's save hook only while the device is UNLINKED (once a wallet is
 * linked the live per-kill credit takes over and there is nothing retroactive to keep).
 */
export function recordSaveAccomplishments(playerKey, rec, raw, nowMs = Date.now()) {
  const ids = extractAccomplishments(rec, raw);
  if (!ids.length) return { ok: true, added: 0, ids: [] };
  const added = state.recordAccomplishments(playerKey, ids, nowMs);
  return { ok: true, added, ids };
}
