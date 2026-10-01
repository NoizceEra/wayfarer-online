// server/econ/http.js — the /econ/* HTTP surface. This is the ONLY way a client reads
// balances, stakes, claims or rates (docs/BLOCKCHAIN_V1.md, workstream A).
//
// CONVENTIONS, matching server/wallet.js so a client has one shape to code against:
//   * POST bodies are JSON, 4 kb, strict; the player is identified by the same 24-char
//     device token the /wallet/* routes use (store.TOKEN_RE + deviceKey).
//   * Failures answer { ok:false, error:'<machine_readable_code>', ...extras }.
//   * Every response carries `econ`, the flag block, so a client never has to guess why a
//     call was refused.
//
// GATES
//   GET  /econ/rates     always answers (public rate sheet: read-only, chain-free, and the
//                        one endpoint that must work before the economy is switched on).
//   POST /econ/balance   always answers — it reads the local ledger, never the chain.
//   POST /econ/history   always answers, same reason.
//   POST /econ/stake     requires ECON_ENABLED (moves value in the ledger; no RPC).
//   POST /econ/unstake   requires ECON_ENABLED (moves value in the ledger; no RPC).
//   POST /econ/claim     requires ECON_ENABLED *and* the chain config, because a claim is
//                        the one call that exists to move tokens on-chain. Unconfigured,
//                        it refuses 503 econ_unconfigured naming what is missing.
//
// The claim DESTINATION is resolved server-side from the device's signature-verified wallet
// link (ops -> wallet.js). No request field can name an address. The relay still dry-runs
// unless PAYOUTS_ENABLED === 'true', which is payouts.js's rule and is not touched here.

import express from 'express';
import { log } from '../log.js';
import { deviceKey, TOKEN_RE } from '../store.js';
import { shortAddr } from '../validate.js';
import { rateRows, TAPER_NOTE } from '../economy/rates.js';
import { BUDGET_TOTAL_RAW, EMISSION } from '../economy/stakeMath.js';
import { econEnabled, flagsPublic, limits, payoutsEnabled } from './config.js';
import * as ops from './ops.js';
import * as state from './state.js';

class Tok {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.t = Date.now(); this.n = burst; }
  take() { const now = Date.now(); this.n = Math.min(this.burst, this.n + ((now - this.t) / 1000) * this.rate); this.t = now; if (this.n < 1) return false; this.n -= 1; return true; }
}

export function routes(app) {
  const BUCKETS = new Map(); // `${kind}|${key}` -> Tok
  const limited = (kind, key) => {
    const k = `${kind}|${key}`;
    let b = BUCKETS.get(k);
    if (!b) { const [r, burst] = limits()[kind]; b = new Tok(r, burst); BUCKETS.set(k, b); }
    if (BUCKETS.size > 5000) { const t = Date.now(); for (const [kk, v] of BUCKETS) if (t - v.t > 600_000) BUCKETS.delete(kk); }
    return !b.take();
  };
  // client IP: Railway's edge appends the real client address as the LAST X-Forwarded-For
  // hop (earlier hops are client-controlled) — same rule as wallet.js.
  const ipOf = (req) => {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    return xff.length ? xff[xff.length - 1] : req.socket?.remoteAddress || '';
  };

  const json = express.json({ limit: '4kb', strict: true });
  const fail = (res, status, error, extra) => res.status(status).json({ ok: false, error, econ: flagsPublic(), ...extra });
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    log.error('econ route failed', { err: e.message });
    if (!res.headersSent) fail(res, 500, 'internal');
  });
  /** IP limit + JSON body + valid device token. Returns null after answering an error. */
  const pre = (req, res, needToken = true) => {
    const ip = ipOf(req);
    if (limited('ip', ip)) { fail(res, 429, 'rate_limited'); return null; }
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (!needToken) return { ip, b };
    if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) { fail(res, 400, 'bad_token'); return null; }
    return { ip, b, dk: deviceKey(b.token) };
  };
  /** ECON_ENABLED gate for anything that moves value. */
  const needEnabled = (res) => {
    if (econEnabled()) return true;
    fail(res, 403, 'econ_disabled', { message: 'The token economy is off (ECON_ENABLED is not set to true). Reads still work.' });
    return false;
  };
  /** The chain gate: only the on-chain path needs it. */
  const needChain = (res) => {
    if (!econEnabled()) {
      fail(res, 403, 'econ_disabled', { message: 'The token economy is off (ECON_ENABLED is not set to true). Reads still work.' });
      return false;
    }
    const missing = flagsPublic().missing;
    if (missing.length) {
      fail(res, 503, 'econ_unconfigured', {
        message: `The chain layer is not configured: set ${missing.join(' and ')}. Nothing was signed and no value moved.`,
        missing,
      });
      return false;
    }
    return true;
  };

  // ── GET /econ/rates — the published rate sheet. Always answers. ───────────
  app.get('/econ/rates', (req, res) => {
    if (limited('ip', ipOf(req))) return fail(res, 429, 'rate_limited');
    const spent = state.budgetSpentRaw();
    res.json({
      ok: true,
      rows: rateRows(),
      taperNote: TAPER_NOTE,
      emission: {
        budgetTotalRaw: BUDGET_TOTAL_RAW,
        budgetSpentRaw: spent,
        budgetRemainingRaw: Math.max(0, BUDGET_TOTAL_RAW - spent),
        halfLifeDays: EMISSION.HALF_LIFE_DAYS,
      },
      idleGold: false,                       // owner's rule: rewards are per-kill only
      payoutsEnabled: payoutsEnabled(),      // false => claims dry-run and sign nothing
      tiers: rateRows().map((r) => r.tierId),
      econ: flagsPublic(),
    });
  });

  // ── POST /econ/balance ────────────────────────────────────────────────────
  app.post('/econ/balance', json, wrap((req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    res.json({ ...ops.balanceFor(ctx.dk), econ: flagsPublic() });
  }));

  // ── POST /econ/history {token, limit} ─────────────────────────────────────
  app.post('/econ/history', json, wrap((req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    const raw = ctx.b.limit;
    const limit = raw === undefined ? 50 : Number(raw);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return fail(res, 400, 'bad_limit');
    res.json({ ...ops.historyFor(ctx.dk, limit), econ: flagsPublic() });
  }));

  // ── POST /econ/stake {token, tierId} ──────────────────────────────────────
  app.post('/econ/stake', json, wrap((req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    if (!needEnabled(res)) return;
    if (limited('action', ctx.dk)) return fail(res, 429, 'rate_limited');
    let r;
    try { r = ops.stakeNow(ctx.dk, ctx.b.tierId); }
    catch (e) { return fail(res, 400, 'unknown_tier', { message: e.message }); }
    if (!r.ok) return fail(res, 409, r.error, { stake: r.stake, neededRaw: r.neededRaw, availableRaw: r.availableRaw });
    res.json({ ...r, balance: ops.balanceFor(ctx.dk), econ: flagsPublic() });
  }));

  // ── POST /econ/unstake {token} ────────────────────────────────────────────
  app.post('/econ/unstake', json, wrap((req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    if (!needEnabled(res)) return;
    if (limited('action', ctx.dk)) return fail(res, 429, 'rate_limited');
    const r = ops.unstakeNow(ctx.dk);
    if (!r.ok) return fail(res, 409, r.error, { stake: r.stake });
    res.json({ ...r, balance: ops.balanceFor(ctx.dk), econ: flagsPublic() });
  }));

  // ── POST /econ/claim {token, claimId?} ────────────────────────────────────
  // No destination address is read from the body — ever. `claimId` is an optional
  // idempotency key so a client that times out can retry the SAME claim safely.
  app.post('/econ/claim', json, wrap(async (req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    if (!needChain(res)) return;
    if (limited('action', ctx.dk)) return fail(res, 429, 'rate_limited');
    const r = await ops.claimFor(ctx.dk, ctx.dk, { claimId: ctx.b.claimId });
    const out = { ...r, destinationShort: r.destination ? shortAddr(r.destination) : '' };
    delete out.spentBudgetRaw;
    delete out.missing;
    delete out.chainReady;
    if (r.error === 'dry_run') return res.status(200).json({ ...out, econ: flagsPublic() });
    if (r.ok) return res.json({ ...out, balance: ops.balanceFor(ctx.dk), econ: flagsPublic() });
    const status = r.error === 'already_paid' || r.error === 'no_verified_wallet' || r.error === 'insufficient'
      ? 409
      : r.error === 'rate_limited' ? 429
        : r.error === 'internal' ? 500 : 400;
    return fail(res, status, r.error, {
      claimId: r.claimId, destination: r.destination, destinationShort: out.destinationShort,
      availableRaw: r.available, amountRaw: r.amountRaw, minimum: r.minimum,
      note: r.note, message: r.message,
    });
  }));

  log.info('econ routes ready', { routes: ['/econ/rates', '/econ/balance', '/econ/stake', '/econ/unstake', '/econ/claim', '/econ/history'] });
}
