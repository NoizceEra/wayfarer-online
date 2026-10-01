// server/econ/seed-dev.mjs — DEV/OPS fixture: put WAYFARER in a device's ledger account.
//
// There is no in-game way to mint the token (that is the point: it is earned per boss kill),
// so testing a stake / claim end to end needs a funded account. This script is the explicit,
// auditable way to do that — it writes ONE 'admin' entry through the real ledger API, and it
// refuses to run without an explicit acknowledgement flag so it can never fire by accident
// (a stray `node seed-dev.mjs` in a deploy script would otherwise mint money).
//
//   ECON_SEED_ACK=yes DATA_DIR=<dir> node server/econ/seed-dev.mjs <deviceToken|playerKey> <wholeWAYFARER> [note]
//
// It prints only public data: the ledger key (a sha256 prefix), the amount and the balances.

import crypto from 'crypto';
import { CFG } from '../config.js';
import { initLedger, apply, balancesOf, flushAll, stopLedger } from '../economy/ledger.js';
import { stateKeyFor } from './ops.js';

const [who, amountArg, note] = process.argv.slice(2);
const fail = (msg) => { console.error(`seed-dev: ${msg}`); process.exit(2); };

if (process.env.ECON_SEED_ACK !== 'yes') {
  fail('refusing to mint without ECON_SEED_ACK=yes (this writes a real ledger credit)');
}
if (!who) fail('usage: ECON_SEED_ACK=yes DATA_DIR=<dir> node server/econ/seed-dev.mjs <deviceToken|playerKey> <wholeWAYFARER> [note]');
const whole = Number(amountArg);
if (!Number.isSafeInteger(whole) || whole <= 0) fail(`amount must be a positive whole number of WAYFARER, got ${JSON.stringify(amountArg)}`);

// A 24-char device token is hashed to its ledger key; a 32-hex key is used as-is.
const key = /^[0-9a-f]{32}$/.test(who) ? who : stateKeyFor(who);
if (!key) fail('could not resolve a ledger key from that argument');

const raw = whole * 10 ** 6;
const id = `admin:seed:${key}:${Date.now()}`;

initLedger();
const res = apply(key, { id, reason: 'admin', resource: 'wayfarer', amount: raw, meta: { note: note || 'seed-dev', dataDir: CFG.DATA_DIR } });
// ledger.stopLedger() only clears the write-behind timer — it does NOT flush. A short-lived
// process that applies an entry and exits would silently drop it, so flush explicitly.
await flushAll();
stopLedger();
if (!res.applied) fail(`ledger refused the credit: ${res.reason}`);
console.log(JSON.stringify({ ok: true, ledgerKey: key.slice(0, 8), creditedRaw: raw, creditedWhole: whole, entryId: id, balances: res.balances }, null, 2));
void crypto;
