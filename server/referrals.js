import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CFG } from './config.js';
import { log } from './log.js';
import { loadChar, saveChar, deviceKey } from './store.js';
import { CAPS } from './validate.js';
import { ledger, commit } from './econStore.js';

// Referral rewards (REFER-A-FRIEND). Loaded by index.js like economy.js
// (addRoomModule): WayfarerRoom calls install / onJoin / onLeave / beforeSave,
// index.js calls init() / routes(app) / stop().
//
// Every character gets a stable 6-char referral code (deterministic hash of
// device-token+name; collision-safe counter fallback). A new player can enter
// ONE friend's code while their level <= 2. When the invitee hits level
// milestones the referrer earns gold, and the invitee earns a welcome bonus:
//   bind   -> invitee +50 gold
//   lv  5  -> referrer +150 gold
//   lv 10  -> referrer +400 gold
// Each (referrer, invitee, milestone) is paid AT MOST ONCE (PRIMARY KEY on
// referral_milestones; a pending row has paid_at NULL).
//
// ZERO NET COST: every payout is paid FROM the accumulated platform-fee
// treasury (db.js `treasury.total_fees`, fed by recordFee()). The debit is a
// single conditional UPDATE (total_fees >= payout) - if the pool is short the
// milestone is only recorded as pending and retried on later joins/saves.
// No payout ever mints gold. In file mode (no USE_SQLITE) the pool is
// identically 0 (fees are burned, not pooled there), so payouts simply stay
// pending - still nothing minted. All payouts respect CAPS.GOLD_MAX on the
// receiving character (a capped receiver records the capped amount once).
//
// Characters are only mutated through store.js loadChar/saveChar, which needs
// the raw device token - so a payout lands only while its RECEIVER is online
// (the ONLINE map, filled by onJoin); otherwise the milestone row waits as
// pending, exactly like mail waiting to be claimed.
//
// Persistence: SQLite (USE_SQLITE) via db.js `referrals` + `referral_milestones`
// tables + the treasury row; otherwise a JSON doc at
// DATA_DIR/economy/referrals.json (write-through, tmp+fsync+rename, same
// pattern as econStore.js). db.js is imported DYNAMICALLY (better-sqlite3 is
// only installed where USE_SQLITE is used - a static import would crash
// file-mode deployments).
//
// Wire (both sides owned by this module; the server->client types are also in
// economy.js's swallow list so they can never ride the generic '*' broadcast):
//   client->server  referral-info {}                server->client referral-state
//   client->server  referral-apply {code}           referral-state (updated) | econ-error
//   client->server  referral-token-stats {}         server->client referral-token-stats {total, rows}
//                  (receiver of a payout)           referral-paid {milestone, gold}
//                                                  econ-sync {why:'referral', delta:{gold}} (adopted rev+gold)

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 unambiguous uppercase alnum chars
const MILESTONE_GOLD = { welcome: 50, lv5: 150, lv10: 400 };
const APPLY_MAX_LEVEL = 2;   // a code may only be entered while the invitee is level <= 2
const SWEEP_MAX = 25;        // pending payouts attempted per join/save

const ONLINE = new Map();    // charKey -> { room, sid, token, name }
let S = null;                // active store (file or sqlite)
let useSqlite = false;

const ckOf = (p) => (p?.token ? (p.ck ||= `${deviceKey(p.token)}:${p.name.toLowerCase()}`) : null);
const clientOf = (room, sid) => room?.clients?.find((c) => c.sessionId === sid) || null;
const now = () => Date.now();
const err = (client, msg, code) => { try { client.send('econ-error', code ? { msg, code } : { msg }); } catch { /* closing */ } };

class Tok {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.t = Date.now(); this.n = burst; }
  take() { const t = Date.now(); this.n = Math.min(this.burst, this.n + ((t - this.t) / 1000) * this.rate); this.t = t; if (this.n < 1) return false; this.n -= 1; return true; }
}

// ─── stores (identical interface: file JSON or SQLite via db.js) ──────────

function fileStore() {
  const DIR = path.join(CFG.DATA_DIR, 'economy');
  const FILE = path.join(DIR, 'referrals.json');
  let doc = { codes: {}, byCk: {}, milestones: {}, tokenBonuses: [], treasury: { fees: 0 } };
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') doc = { ...doc, ...parsed, treasury: { fees: parsed.treasury?.fees | 0 } };
  } catch (e) { if (e.code !== 'ENOENT') log.error('referrals.json unreadable (starting empty)', { err: e.message }); }
  const write = () => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeSync(fd, JSON.stringify(doc)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, FILE);
    } catch (e) { log.error('referrals write failed', { err: e.message }); }
  };
  const k3 = (r, i, m) => `${r}|${i}|${m}`;
  return {
    kind: 'file',
    byCode(c) { const e = doc.codes[c]; return e ? { ck: e.ck, name: e.name } : null; },
    byPlayer(ck) { const c = doc.byCk[ck]; const e = c && doc.codes[c]; return e ? { code: c, name: e.name, invited: e.invited | 0, goldPaid: e.goldPaid | 0, tokenBonusPaid: e.tokenBonusPaid | 0 } : null; },
    insertCode(ck, name, code) { doc.codes[code] = { ck, name, createdAt: now(), invited: 0, goldPaid: 0, tokenBonusPaid: 0 }; doc.byCk[ck] = code; write(); },
    bumpInvited(ck) { const c = doc.byCk[ck]; if (c && doc.codes[c]) { doc.codes[c].invited = (doc.codes[c].invited | 0) + 1; write(); } },
    bumpGoldPaid(ck, n) { const c = doc.byCk[ck]; if (c && doc.codes[c]) { doc.codes[c].goldPaid = (doc.codes[c].goldPaid | 0) + n; write(); } },
    bumpTokenBonus(ck, n) { const c = doc.byCk[ck]; if (c && doc.codes[c]) { doc.codes[c].tokenBonusPaid = (doc.codes[c].tokenBonusPaid | 0) + n; write(); } },
    bindOf(ck) { for (const [k, v] of Object.entries(doc.milestones)) { const a = k.split('|'); if (a[1] === ck && a[2] === 'bind') return { referrer: a[0], at: v.paidAt }; } return null; },
    insertBind(r, i) { doc.milestones[k3(r, i, 'bind')] = { gold: 0, paidAt: now() }; write(); },
    milestoneOf(r, i, m) { const v = doc.milestones[k3(r, i, m)]; return v ? { gold: v.gold | 0, paidAt: v.paidAt ?? null } : null; },
    insertPending(r, i, m) { const k = k3(r, i, m); if (!doc.milestones[k]) { doc.milestones[k] = { gold: 0, paidAt: null }; write(); } },
    markPaid(r, i, m, gold) { doc.milestones[k3(r, i, m)] = { gold, paidAt: now() }; write(); },
    pending() {
      return Object.entries(doc.milestones)
        .filter(([, v]) => v.paidAt == null)
        .map(([k]) => { const a = k.split('|'); return { referrer: a[0], invitee: a[1], milestone: a[2] }; })
        .slice(0, SWEEP_MAX);
    },
    treasuryGold() { return doc.treasury.fees | 0; },
    addFee(n) { doc.treasury.fees = (doc.treasury.fees | 0) + (n | 0); write(); },
    spend(n) { if ((doc.treasury.fees | 0) < n) return false; doc.treasury.fees -= n; write(); return true; },
    tokenBonusTotal(ck) { return doc.tokenBonuses.filter((b) => b.referrer === ck).reduce((s, b) => s + (b.amount | 0), 0); },
    tokenBonusRows(ck) { return doc.tokenBonuses.filter((b) => b.referrer === ck).map((b) => ({ ...b })); },
    addTokenBonus(r, i, amount, sourceClaim) { doc.tokenBonuses.push({ referrer: r, invitee: i, amount: amount | 0, sourceClaim: sourceClaim | 0, paidAt: now() }); write(); },
    counts() {
      let binds = 0, pending = 0;
      for (const [k, v] of Object.entries(doc.milestones)) { if (k.endsWith('|bind')) binds++; else if (v.paidAt == null) pending++; }
      return { codes: Object.keys(doc.codes).length, binds, pending };
    },
  };
}

function sqliteStore(dbh) {
  // Idempotent: also created by db.js's schema (initDb); run here so this
  // module is safe on a database created before that patch.
  dbh.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      code TEXT PRIMARY KEY,
      player TEXT UNIQUE,
      name TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      invited_count INTEGER NOT NULL DEFAULT 0,
      gold_paid INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS referral_milestones (
      referrer TEXT,
      invitee TEXT,
      milestone TEXT,
      gold INTEGER NOT NULL DEFAULT 0,
      paid_at INTEGER,
      PRIMARY KEY(referrer, invitee, milestone)
    );
    CREATE TABLE IF NOT EXISTS referral_token_bonuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer TEXT NOT NULL,
      invitee TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      source_claim INTEGER NOT NULL DEFAULT 0,
      paid_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_referral_token_referrer ON referral_token_bonuses(referrer);
    CREATE INDEX IF NOT EXISTS idx_referral_token_pair ON referral_token_bonuses(referrer, invitee);
  `);
  const q = {
    byCode: dbh.prepare('SELECT code, player AS ck, name FROM referrals WHERE code = ?'),
    byPlayer: dbh.prepare('SELECT code, player AS ck, name, invited_count AS invited, gold_paid AS goldPaid, token_bonus_paid AS tokenBonusPaid FROM referrals WHERE player = ?'),
    insertCode: dbh.prepare('INSERT INTO referrals (code, player, name) VALUES (?, ?, ?)'),
    bumpInvited: dbh.prepare('UPDATE referrals SET invited_count = invited_count + 1 WHERE player = ?'),
    bumpGoldPaid: dbh.prepare('UPDATE referrals SET gold_paid = gold_paid + ? WHERE player = ?'),
    bumpTokenBonus: dbh.prepare('UPDATE referrals SET token_bonus_paid = token_bonus_paid + ? WHERE player = ?'),
    bindOf: dbh.prepare("SELECT referrer, paid_at AS at FROM referral_milestones WHERE invitee = ? AND milestone = 'bind' LIMIT 1"),
    insertBind: dbh.prepare("INSERT OR IGNORE INTO referral_milestones (referrer, invitee, milestone, gold, paid_at) VALUES (?, ?, 'bind', 0, unixepoch())"),
    milestoneOf: dbh.prepare('SELECT gold, paid_at AS paidAt FROM referral_milestones WHERE referrer = ? AND invitee = ? AND milestone = ?'),
    insertPending: dbh.prepare('INSERT OR IGNORE INTO referral_milestones (referrer, invitee, milestone, gold, paid_at) VALUES (?, ?, ?, 0, NULL)'),
    markPaid: dbh.prepare(`INSERT INTO referral_milestones (referrer, invitee, milestone, gold, paid_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(referrer, invitee, milestone) DO UPDATE SET gold = excluded.gold, paid_at = excluded.paid_at`),
    pending: dbh.prepare("SELECT referrer, invitee, milestone FROM referral_milestones WHERE paid_at IS NULL AND milestone <> 'bind' ORDER BY rowid LIMIT " + SWEEP_MAX),
    binds: dbh.prepare("SELECT COUNT(*) AS n FROM referral_milestones WHERE milestone = 'bind'"),
    pendingN: dbh.prepare("SELECT COUNT(*) AS n FROM referral_milestones WHERE paid_at IS NULL AND milestone <> 'bind'"),
    tokenBonusTotal: dbh.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM referral_token_bonuses WHERE referrer = ?'),
    tokenBonusRows: dbh.prepare('SELECT invitee, amount, source_claim AS sourceClaim, paid_at AS paidAt FROM referral_token_bonuses WHERE referrer = ? ORDER BY paid_at DESC LIMIT 100'),
    addTokenBonus: dbh.prepare('INSERT INTO referral_token_bonuses (referrer, invitee, amount, source_claim, paid_at) VALUES (?, ?, ?, ?, unixepoch())'),
    codes: dbh.prepare('SELECT COUNT(*) AS n FROM referrals'),
    treasury: dbh.prepare('SELECT total_fees AS fees FROM treasury WHERE id = 1'),
    addFee: dbh.prepare('UPDATE treasury SET total_fees = total_fees + ?, updated_at = unixepoch() WHERE id = 1'),
    // the zero-net-cost gate: the debit only lands if the fee pool covers it
    spend: dbh.prepare('UPDATE treasury SET total_fees = total_fees - ?, updated_at = unixepoch() WHERE id = 1 AND total_fees >= ?'),
  };
  return {
    kind: 'sqlite',
    byCode(c) { return q.byCode.get(c) || null; },
    byPlayer(ck) { return q.byPlayer.get(ck) || null; },
    insertCode(ck, name, code) { q.insertCode.run(code, ck, name); },
    bumpInvited(ck) { q.bumpInvited.run(ck); },
    bumpGoldPaid(ck, n) { q.bumpGoldPaid.run(n, ck); },
    bindOf(ck) { return q.bindOf.get(ck) || null; },
    insertBind(r, i) { q.insertBind.run(r, i); },
    milestoneOf(r, i, m) { return q.milestoneOf.get(r, i, m) || null; },
    insertPending(r, i, m) { q.insertPending.run(r, i, m); },
    markPaid(r, i, m, gold) { q.markPaid.run(r, i, m, gold); },
    pending() { return q.pending.all(); },
    treasuryGold() { return q.treasury.get()?.fees | 0; },
    addFee(n) { q.addFee.run(n | 0); },
    spend(n) { return q.spend.run(n, n).changes === 1; },
    tokenBonusTotal(ck) { return q.tokenBonusTotal.get(ck)?.total | 0; },
    tokenBonusRows(ck) { return q.tokenBonusRows.all(ck); },
    addTokenBonus(r, i, amount, sourceClaim) { q.addTokenBonus.run(r, i, amount | 0, sourceClaim | 0); },
    counts() { return { codes: q.codes.get().n, binds: q.binds.get().n, pending: q.pendingN.get().n }; },
  };
}

// ─── lifecycle hooks (index.js / WayfarerRoom) ─────────────────────────────

export function init() {
  if (S) return;
  S = fileStore(); // synchronous, always ready
  if (!process.env.USE_SQLITE) { log.info('referrals ready', { store: 'file' }); return; }
  // db.js (better-sqlite3) is only installed where sqlite is used: import it
  // lazily, and wait briefly for initDb() if index.js loads us first.
  let tries = 0;
  const trySqlite = () => {
    import('./db.js').then((m) => {
      const dbh = m.getDb?.();
      if (dbh) { S = sqliteStore(dbh); useSqlite = true; log.info('referrals ready', { store: 'sqlite' }); }
      else if (++tries < 40) setTimeout(trySqlite, 250);
      else log.warn('referrals: USE_SQLITE set but db.js never initialized - staying on the file store');
    }).catch((e) => log.error('referrals: sqlite store unavailable', { err: e.message }));
  };
  trySqlite();
}

export function stop() { /* file store is write-through, sqlite is durable: nothing to flush. */ }

export function routes(app) {
  app.get('/referrals', (req, res) => {
    if (!S) { res.status(503).json({ ok: false }); return; }
    res.json({ ok: true, store: S.kind, ...S.counts(), treasuryGold: S.treasuryGold(), online: ONLINE.size });
  });
}

// Record a platform fee into the reward pool (mirrors db.js recordFee without
// the trade counter). index.js/economy.js may call this so token-claim and
// escrow fees fund referrals instead of being burned.
export function recordFee(fee) { if (S && (fee | 0) > 0) S.addFee(fee | 0); }

export function onJoin(room, client, p) {
  const ck = ckOf(p);
  if (!ck || !S) return;
  ONLINE.set(ck, { room, sid: client.sessionId, token: p.token, name: p.name });
  ensureCode(ck, p.name);
  // best-effort: the client may not have its handlers attached yet (its
  // joinOrCreate promise resolves after onJoin); it asks again via
  // referral-info on attach, and the panel has REFRESH.
  try { client.send('referral-state', stateFor(ck)); } catch { /* closing */ }
  // offline level-ups: check the server copy's level now that they are here
  const rec = loadChar(p.token, p.name);
  checkLevel(ck, rec?.progress?.level | 0);
  sweepPending();
}

export function onLeave(room, client, p) {
  const sid = client?.sessionId || p?.sid;
  if (!sid) return;
  for (const [ck, on] of ONLINE) if (on.sid === sid) ONLINE.delete(ck);
}

// Milestone detection: the invitee's save is the authority for their level.
// Never refuses (return true): payouts are additive server-side mutations on
// the referrer, unrelated to the save being validated.
export function beforeSave(room, client, p, m, prev) {
  if (!S) return true;
  const ck = ckOf(p);
  if (ck && m?.progress && typeof m.progress === 'object') checkLevel(ck, m.progress.level | 0);
  sweepPending();
  return true;
}

export function install(room) {
  // Server->client referral types must never ride the generic '*' passthrough
  // (a client could forge a referral-paid / referral-state for its peers).
  // economy.js's swallow list also covers these; re-registered here so this
  // module is safe even when loaded alone.
  for (const t of ['referral-state', 'referral-paid', 'referral-token-stats']) room.onMessage(t, () => {});

  const on = (type, fn) => room.onMessage(type, (client, m) => {
    const p = room.players.get(client.sessionId);
    if (!p) return;
    const b = (p.refB ||= new Tok(2, 8));
    if (!b.take()) { err(client, 'Slow down a little.'); return; }
    let size = 0; try { size = JSON.stringify(m ?? null).length; } catch { return; }
    if (size > 256) return;
    const msg = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
    try { fn(client, p, msg); } catch (e) { log.warn('referral handler error', { type, err: e.message }); }
  });

  on('referral-info', (c, p) => {
    const ck = ckOf(p);
    if (!ck) { err(c, 'You need a saved online character to get a referral code.', 'nosave'); return; }
    ensureCode(ck, p.name);
    c.send('referral-state', stateFor(ck));
    sweepPending();
  });

  on('referral-apply', (c, p, m) => {
    const ck = ckOf(p);
    if (!ck) { err(c, 'You need a saved online character to use referral codes.', 'nosave'); return; }
    const code = String(m.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { err(c, 'Referral codes are 6 letters or digits.', 'invalid'); return; }
    if (S.bindOf(ck)) { err(c, 'You already entered a referral code.', 'bound'); return; }
    const owner = S.byCode(code);
    if (!owner) { err(c, 'No wayfarer has that code.', 'unknown'); return; }
    // self-referral: same character, or another character on the same device
    if (owner.ck === ck || owner.ck.split(':')[0] === ck.split(':')[0]) { err(c, 'You cannot refer yourself.', 'self'); return; }
    const rec = loadChar(p.token, p.name);
    if ((rec?.progress?.level | 0) > APPLY_MAX_LEVEL) { err(c, `Referral codes can only be entered at level ${APPLY_MAX_LEVEL} or below.`, 'late'); return; }
    // one-time bind: the 'bind' milestone row doubles as the lock (PK + the
    // bindOf check above)
    S.insertBind(owner.ck, ck);
    S.bumpInvited(owner.ck);
    ledger({ op: 'referral-bind', referrer: owner.ck, invitee: ck, code });
    log.info('referral bind', { referrer: owner.ck, invitee: ck });
    c.send('referral-state', stateFor(ck));
    settle(owner.ck, ck, 'welcome'); // invitee +50: paid now if funded, else pending
    const refOn = ONLINE.get(owner.ck);
    if (refOn) { try { clientOf(refOn.room, refOn.sid)?.send('referral-state', stateFor(owner.ck)); } catch { /* closing */ } }
  });

  on('referral-token-stats', (c, p) => {
    const ck = ckOf(p);
    if (!ck) { err(c, 'You need a saved online character.'); return; }
    c.send('referral-token-stats', tokenStatsFor(ck));
  });
}

// Public API used by server/economy.js token-claim. Pays a 5% token bonus to
// the referrer from the existing 5% claim fee (2.5% referrer, 2.5% treasury).
// The invitee's fee is unchanged; the treasury still receives half the fee.
export function payReferralTokenBonus(inviteeCk, amount, sourceClaim) {
  if (!S || !amount || amount <= 0) return 0;
  const bind = S.bindOf(inviteeCk);
  if (!bind) return 0;
  const referrer = bind.referrer;
  S.addTokenBonus(referrer, inviteeCk, amount, sourceClaim);
  S.bumpTokenBonus(referrer, amount);
  const on = ONLINE.get(referrer);
  if (on) {
    try {
      const c = clientOf(on.room, on.sid);
      if (c) {
        c.send('referral-state', stateFor(referrer));
        c.send('referral-token-stats', tokenStatsFor(referrer));
      }
    } catch { /* closing */ }
  }
  ledger({ op: 'referral-token-bonus', referrer, invitee: inviteeCk, amount, sourceClaim });
  log.info('referral token bonus', { referrer, invitee: inviteeCk, amount, sourceClaim });
  return amount;
}

function tokenStatsFor(ck) {
  return {
    total: S.tokenBonusTotal(ck),
    rows: S.tokenBonusRows(ck),
  };
}

// ─── internals ─────────────────────────────────────────────────────────────

// Stable 6-char code: deterministic hash of the charKey (device token + name),
// counter-salted on collision with another player's code, random fallback.
function ensureCode(ck, name) {
  if (!S) return null;
  const row = S.byPlayer(ck);
  if (row) return row.code;
  const free = (c) => !S.byCode(c);
  let code = null;
  for (let n = 0; n < 64 && !code; n++) {
    const h = crypto.createHash('sha256').update(n ? `${ck}#${n}` : ck).digest();
    let s = '';
    for (let i = 0; i < 6; i++) s += ALPHA[h[i] & 31];
    if (free(s)) code = s;
  }
  for (let i = 0; i < 16 && !code; i++) { // astronomically unlikely fallback
    const b = crypto.randomBytes(6);
    let s = '';
    for (let j = 0; j < 6; j++) s += ALPHA[b[j] & 31];
    if (free(s)) code = s;
  }
  if (!code) { log.error('referral code exhaustion', { ck }); return null; }
  S.insertCode(ck, name, code);
  return code;
}

function stateFor(ck) {
  const row = S.byPlayer(ck);
  const bind = S.bindOf(ck);
  const boundTo = bind ? (S.byPlayer(bind.referrer)?.name || bind.referrer) : null;
  return {
    code: row?.code || '',
    invited: row?.invited | 0,
    goldPaid: row?.goldPaid | 0,
    tokenBonusPaid: row?.tokenBonusPaid | 0,
    boundTo,
    treasuryGold: S.treasuryGold(),
  };
}

// Invitee level milestones (called from beforeSave with the save's level, and
// from onJoin with the stored copy's level for offline level-ups).
function checkLevel(ck, level) {
  if (!S || level < 5) return;
  const bind = S.bindOf(ck);
  if (!bind) return;
  if (level >= 5) settle(bind.referrer, ck, 'lv5');
  if (level >= 10) settle(bind.referrer, ck, 'lv10');
}

// Pay one milestone: at most once (PK), only while the receiver is online
// (character mutation needs their device token), only if the fee pool covers
// it (atomic conditional debit), never above GOLD_MAX on the receiver.
function settle(referrer, invitee, milestone) {
  const amount = MILESTONE_GOLD[milestone];
  if (!amount || !S) return;
  const existing = S.milestoneOf(referrer, invitee, milestone);
  if (existing && existing.paidAt != null) return; // already paid: at-most-once
  const receiver = milestone === 'welcome' ? invitee : referrer;
  const on = ONLINE.get(receiver);
  if (!on) { S.insertPending(referrer, invitee, milestone); return; } // pays when they are around (like mail)
  const rec = loadChar(on.token, on.name);
  if (!rec?.progress || typeof rec.progress.gold !== 'number') { S.insertPending(referrer, invitee, milestone); return; }
  const cur = rec.progress.gold | 0;
  const pay = Math.max(0, Math.min(amount, CAPS.GOLD_MAX - cur)); // GOLD_MAX cap
  if (pay <= 0) { S.markPaid(referrer, invitee, milestone, 0); return; } // receiver at cap: done, nothing to credit
  // zero-net-cost gate: gold enters circulation only by leaving the fee pool
  if (!S.spend(pay)) { S.insertPending(referrer, invitee, milestone); return; } // pool short: pending, retried later
  rec.progress.gold = cur + pay;
  rec.rev = (rec.rev || 0) + 1;
  const t = now();
  rec.savedAt = t; rec.progress.savedAt = t;
  saveChar(on.token, on.name, rec);
  S.markPaid(referrer, invitee, milestone, pay);
  S.bumpGoldPaid(receiver, pay);
  ledger({ op: 'referral-paid', milestone, referrer, invitee, gold: pay, rev: rec.rev });
  log.info('referral paid', { milestone, referrer, invitee, gold: pay, treasuryLeft: S.treasuryGold() });
  // tell the receiver: econ-sync so the client adopts rev+gold immediately,
  // a toast trigger, and the refreshed referral state
  const c = clientOf(on.room, on.sid);
  if (c) {
    try {
      c.send('econ-sync', {
        why: 'referral', rev: rec.rev || 0, gold: rec.progress.gold | 0,
        inventory: Array.isArray(rec.progress.inventory) ? rec.progress.inventory : [],
        tokenPoints: rec.progress.tokenPoints | 0, wayfarerTokens: rec.progress.wayfarerTokens | 0,
        delta: { gold: pay },
      });
      c.send('referral-paid', { milestone, gold: pay });
      c.send('referral-state', stateFor(receiver));
    } catch { /* closing */ }
  }
  if (!useSqlite) commit({ deviceKeys: [deviceKey(on.token)] }).catch(() => { /* memory stays authoritative */ });
}

// Retry pending payouts (receiver online + pool funded) on joins/saves.
function sweepPending() {
  if (!S) return;
  let n = 0;
  for (const p of S.pending()) {
    if (++n > SWEEP_MAX) break;
    settle(p.referrer, p.invitee, p.milestone);
  }
}

// Internals for tests/debug (the wire harness never needs these).
export const _test = {
  ensureCode,
  sweepPending,
  stateFor: (ck) => (S ? stateFor(ck) : null),
  tokenStatsFor: (ck) => (S ? tokenStatsFor(ck) : null),
  treasuryGold: () => (S ? S.treasuryGold() : 0),
};
