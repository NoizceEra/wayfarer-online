#!/usr/bin/env node
// Wayfarer Online — economy regression harness (real relay, real sockets).
//
//   node tools/econ_test.mjs [--port 2621] [--data-dir D:/...] [--keep]
//
// Spawns its OWN relay (its own PORT and its own NATIVE-path DATA_DIR under the
// repo, wiped first, removed afterwards) with piped stdio — no TTY anywhere, so
// the run also asserts the relay is reachable headlessly (GET /health) before
// any economy check runs. Then it joins the public world shard with two real
// colyseus clients (the repo's own client lib, `ws` underneath — no dependency
// added anywhere) and drives the economy over the wire. The exit code is
// non-zero if ANY check fails, so this can gate a merge.
//
// VERIFIED OVER THE WIRE (each is one PASS/FAIL line below):
//   hello/authority  econ-state gold+bag mirror the character the client uploaded
//   trade            request -> accept -> offer -> lock -> confirm, and the swap
//                    itself: gold and item multisets on BOTH sides, the delta the
//                    client is told to apply vs the server's absolute state, and
//                    the durable commit landing in DATA_DIR/players
//   market           post (listing fee taken, item leaves the bag), browse, buy
//                    (buyer pays/receives, seller is paid BY MAIL and can claim
//                    it), cancel (item returns, fee not refunded), own listing
//   mail             send (postage), list, claim (gold + item attachment), and
//                    that a second claim of the same mail is refused
//   guild            create, invite, accept, member deposit, leader withdraw,
//                    bank totals, leader-only withdraw
//   rejects          insufficient gold; unknown / unowned item ids; over-cap item
//                    count, price, gold and duration; malformed payloads;
//                    missing / stale / REPLAYED rev; stale SAVE revision; unknown
//                    mail recipient; unknown trade target; oversize payload
//                    (dropped silently); an empty trade
//   side effects     every rejected op is re-checked against the server copy
//                    (gold + bag unchanged), and gold is conserved minus the
//                    fees the server itself reported
//   dupe guard       a save claiming an extra copy of an item the economy moved
//                    out is stripped by beforeSave (read back via econ-state)
//
// HOW GOLD ENTERS: gold is EARNED over the wire, never uploaded. A first save is
// clamped to CAPS.freshGold = 0 (server/validate.js), so the harness seeds each
// character through the relay's own per-kill credit path (earnGold below) and then
// pins the exact balance the scenario reasons about — exactly what a player does.
//
// HOW IT DRIVES THE RELAY: every step waits for the server's own message
// (econ-sync / trade-update / trade-result / guild-info / ...) before the next
// one is sent. The two clients are SEPARATE sockets, so there is no ordering
// between them: an offer runs unlockAll() server-side, and a trade confirm is
// only accepted once both sides have locked. Replies are matched against
// messages received after the sending step, so an earlier phase's message can
// never satisfy a later check.
//
// NOT VERIFIED HERE (assumed, not measured — do not read these as covered):
//   * the client half of the protocol: src/net/economyNet.js delta application,
//     src/systems/trade.js state machine, all UI/panel behaviour
//   * combat, loot, crafting and every other way items/gold can enter a bag
//   * cross-restart durability: txn.json roll-forward in econStore.js recover()
//     (only "the commit landed on disk" is checked, not crash recovery)
//   * anticheat counters, flood-disconnect, rate limiting beyond staying under
//     it, mail-box overflow, market expiry, >2 clients, party rooms, reconnect
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
// server/rewards.js is a pure data table (no side effects): the harness needs it to
// seed gold the ONLY way the relay lets gold in — see earnGold below.
import { ENEMY_REWARDS } from '../server/rewards.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const PORT_ARG = arg('--port', null);
let PORT = Number(PORT_ARG || 2621);
const DATA_DIR = arg('--data-dir', `${ROOT}/.scratch-econ-harness`);
const KEEP = flag('--keep');
// The relay stamps its WORLD_NAME into /stats, so we can prove the relay that
// answers /health is OUR child (and not a stray relay squatting the port).
const WORLD_NAME = `EconHarness${crypto.randomBytes(3).toString('hex')}`;
let WS_URL = `ws://localhost:${PORT}`;

const { Client } = await import('colyseus.js'); // repo dependency (root node_modules), the lib the game client itself uses
const ITEM_DB = JSON.parse(fs.readFileSync(`${ROOT}/server/shared/item_ids.json`, 'utf8'));
const GEAR = Object.keys(ITEM_DB.gear || {}).sort();
if (GEAR.length < 6) { console.error('econ_test: server/shared/item_ids.json has too few gear ids to test with'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0, failed = 0;
const failures = [];
function record(ok, name, detail) {
  checks++;
  if (ok) { console.log(`PASS ${name}`); return; }
  failed++; failures.push(name);
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}
async function t(name, fn) {
  try { await fn(); record(true, name); }
  catch (e) { record(false, name, e && e.message ? e.message : String(e)); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const ms = (inv) => [...inv].sort().join(',');
const appearsOnce = (list, id) => Array.isArray(list) && list.filter((x) => x === id).length === 1;
const step = (s) => console.log(`- ${s}`);

// Server-side rate buckets (mirror of server/economy.js Tok + WayfarerRoom.js
// Bucket) so the harness never trips the flood guard and eats a 'rate' error.
const BUCKETS = { econ: [5, 16], browse: [3, 8], save: [0.5, 4], misc: [20, 60] };
const BROWSE_TYPES = new Set(['econ-hello', 'market-browse', 'mail-list', 'mail-read', 'guild-info']);
const ECON_TYPES = new Set([
  'trade-request', 'trade-respond', 'trade-offer', 'trade-lock', 'trade-unlock', 'trade-confirm', 'trade-cancel',
  'market-post', 'market-buy', 'market-cancel', 'mail-send', 'mail-claim', 'mail-delete',
  'guild-create', 'guild-join', 'guild-accept', 'guild-decline', 'guild-invite', 'guild-leave',
  'guild-kick', 'guild-rank', 'guild-motd', 'guild-deposit', 'guild-withdraw',
]);
const bucketOf = (type) => (type === 'save' ? 'save' : BROWSE_TYPES.has(type) ? 'browse' : ECON_TYPES.has(type) ? 'econ' : 'misc');

class Peer {
  constructor({ name, token, gold, inventory }) {
    this.name = name; this.token = token;
    this.gold = gold; this.inventory = [...inventory]; this.rev = 0;
    this.inbox = []; this.bt = {}; this.room = null; this.sid = null;
  }
  async join() {
    const room = await new Client(WS_URL).joinOrCreate('world', { name: this.name, token: this.token, a: 'ow' });
    this.room = room; this.sid = room.sessionId;
    room.onMessage('*', (type, m) => {
      this.inbox.push({ type, m, used: false });
      // every economy state message carries the server's authoritative copy
      if (m && Number.isInteger(m.rev)) this.rev = m.rev;
      if (m && Number.isInteger(m.gold) && Array.isArray(m.inventory)) { this.gold = m.gold; this.inventory = [...m.inventory]; }
    });
    return room;
  }
  mark() { return this.inbox.length; }
  since(mark) { return this.inbox.slice(mark); }
  async pace(type) {
    const bucket = bucketOf(type);
    const [rate, burst] = BUCKETS[bucket];
    const b = (this.bt[bucket] ||= { tokens: burst, t: Date.now() });
    for (;;) {
      const now = Date.now();
      b.tokens = Math.min(burst, b.tokens + ((now - b.t) / 1000) * rate); b.t = now;
      if (b.tokens >= 1) { b.tokens -= 1; return; }
      await sleep(Math.ceil(((1 - b.tokens) / rate) * 1000) + 10);
    }
  }
  async send(type, payload = {}) {
    await this.pace(type);
    this.lastSend = this.inbox.length;   // responses must be newer than this send
    this.room.send(type, payload);
  }
  // wait for the first UNCONSUMED message of `type` matching `pred`, received
  // after our most recent send (so an earlier phase's message can never satisfy
  // a later check)
  async waitFor(type, pred = () => true, wait = 4000) {
    const deadline = Date.now() + wait;
    const from = this.lastSend || 0;
    for (;;) {
      const hit = this.inbox.find((e, i) => i >= from && !e.used && e.type === type && pred(e.m));
      if (hit) { hit.used = true; return hit.m; }
      if (Date.now() > deadline) return null;
      await sleep(20);
    }
  }
  async hello(wait = 4000) {
    await this.send('econ-hello', { rev: this.rev });
    const m = await this.waitFor('econ-state', () => true, wait);
    assert(m, 'no econ-state reply to econ-hello (is server/economy.js installed in the room?)');
    return m;
  }
  progress(gold = this.gold, inventory = this.inventory, kills = {}) {
    return {
      job: 'wayfarer', level: 5, xp: 10, xpNext: 100, gold, potions: 0,
      maxHp: 110, maxMp: 30, atk: 12, x: 100, y: 100, inventory: [...inventory], equipped: {}, dyes: {},
      // top-level per-enemy-type lifetime kills: the ONLY source of gold (validate.js)
      kills: { ...kills },
      quest: { idx: 0, kills: {} }, prog: null, savedAt: Date.now(),
    };
  }
  async save({ rev = this.rev, gold = this.gold, inventory = this.inventory, kills = {} } = {}) {
    await this.pace('save');
    this.room.send('save', { name: this.name, progress: this.progress(gold, inventory, kills), hero: { name: this.name }, rev });
  }
  async expectError({ code = null, msg = null, wait = 4000 } = {}) {
    const m = await this.waitFor('econ-error', (e) => (!code || e.code === code) && (!msg || String(e.msg).includes(msg)), wait);
    assert(m, `expected econ-error${code ? ` code=${code}` : ''}${msg ? ` containing "${msg}"` : ''} — none arrived within ${wait}ms`);
    return m;
  }
  async expectSync(why, wait = 4000) {
    const m = await this.waitFor('econ-sync', (e) => !why || e.why === why, wait);
    assert(m, `expected econ-sync${why ? ` why=${why}` : ''} — none arrived within ${wait}ms`);
    return m;
  }
  // assert the server copy equals what we expect
  expectState({ gold, inventory }, label) {
    if (gold !== undefined) assert(this.gold === gold, `${label}: server copy gold ${this.gold} != expected ${gold}`);
    if (inventory !== undefined) assert(ms(this.inventory) === ms(inventory), `${label}: server copy bag [${this.inventory}] != expected [${inventory}]`);
  }
}

// ─── relay lifecycle ─────────────────────────────────────────────────
let relay = null;
const relayOut = [];
function keep(name, buf) { for (const line of String(buf).split('\n')) if (line.trim()) relayOut.push(`[relay ${name}] ${line.trimEnd()}`); }
let reuseNoted = false;
function rmScratch() {
  if (KEEP) return;
  // wipe only the harness's own scratch dir inside the repo
  const norm = DATA_DIR.replace(/\\/g, '/');
  if (norm.startsWith(ROOT) && norm.includes('.scratch-econ')) { fs.rmSync(DATA_DIR, { recursive: true, force: true }); return; }
  // a custom --data-dir is never deleted; warn once if it already holds state
  if (reuseNoted) return;
  reuseNoted = true;
  try { if (fs.readdirSync(DATA_DIR).length) step(`reusing a non-empty --data-dir (not wiped: it is outside the repo scratch area) — expect stale listings/mail/guilds`); } catch { /* does not exist yet: fine */ }
}
function startRelay() {
  relay = spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/server`,
    env: { ...process.env, PORT: String(PORT), DATA_DIR, LOG_LEVEL: 'info', WORLD_NAME },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  relay.stdout.on('data', (d) => keep('out', d));
  relay.stderr.on('data', (d) => keep('err', d));
}
// Poll /health until OUR relay answers it (bounded). A stranger answering on the
// port is reported as such, never silently accepted.
async function waitHealth(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (relay.exitCode !== null) throw new Error(`the relay we started exited (code ${relay.exitCode}) before answering /health — raw output:\n${relayOut.slice(-15).join('\n')}`);
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      const j = await r.json();
      if (r.ok && j.ok === true && j.game === 'wayfarer-online') {
        const st = await (await fetch(`http://localhost:${PORT}/stats`)).json();
        if (st.world !== WORLD_NAME) throw new Error(`IDENTITY: :${PORT}/health answers, but /stats.world is "${st.world}" not "${WORLD_NAME}" — a different relay owns this port`);
        return j;
      }
      throw new Error(`/health answered ${r.status} ${JSON.stringify(j)}`);
    } catch (e) {
      const m = String(e.message);
      if (m.startsWith('/health answered') || m.startsWith('IDENTITY')) throw e;
    }
    await sleep(250);
  }
  throw new Error(`our relay did not answer /health in ${attempts} polls (~${Math.round(attempts * 0.25)}s) — raw output:\n${relayOut.slice(-15).join('\n')}`);
}
// Boot our own relay; if the port is taken by another relay (EADDRINUSE), say so
// and move to the next 26xx port instead of quietly testing someone else's server.
async function bootRelay() {
  const tries = PORT_ARG ? 1 : 5;
  for (let k = 0; k < tries; k++) {
    relayOut.length = 0;
    startRelay();
    try {
      const j = await waitHealth();
      if (relay.exitCode !== null) throw new Error(`the relay we started exited (code ${relay.exitCode}) right after /health — raw output:\n${relayOut.slice(-15).join('\n')}`);
      return j;
    } catch (e) {
      relay?.kill();
      await sleep(500);
      const taken = relayOut.some((l) => l.includes('EADDRINUSE')) || String(e.message).startsWith('IDENTITY');
      if (k >= tries - 1 || !taken) throw e;
      const raw = relayOut.find((l) => l.includes('EADDRINUSE')) || 'another relay answered on it';
      step(`port ${PORT} is already in use (${raw.trim()}) — retrying on ${PORT + 1}`);
      PORT += 1; WS_URL = `ws://localhost:${PORT}`;
    }
  }
  throw new Error('could not find a free 26xx port for the relay');
}
const keyFile = (token) => `${DATA_DIR}/players/${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}.json`;
function diskProgress(token, name) {
  try { return JSON.parse(fs.readFileSync(keyFile(token), 'utf8')).chars[name.toLowerCase()]?.progress || null; } catch { return null; }
}
async function waitDisk(peer, want, wait = 4000) {
  const deadline = Date.now() + wait;
  for (;;) {
    const pr = diskProgress(peer.token, peer.name);
    if (pr && pr.gold === want.gold && ms(pr.inventory) === ms(want.inventory)) return pr;
    if (Date.now() > deadline) return null;
    await sleep(100);
  }
}

// ─── scenario ────────────────────────────────────────────────────────
const X = GEAR[0], Y = GEAR[1], Z = GEAR[2], W = GEAR[3], UNOWNED = GEAR[5];
const tok = (s) => `${s}${crypto.randomBytes(12).toString('hex')}`; // matches server store.js TOKEN_RE
let cfg = null;
let startTotal = 0;               // the seeded total gold, the conservation baseline
const SEED_A = 5000, SEED_B = 1000;
const A = new Peer({ name: 'Aldra', token: tok('econTestA'), gold: SEED_A, inventory: [X, Y, Z] });
const B = new Peer({ name: 'Brann', token: tok('econTestB'), gold: SEED_B, inventory: [W] });
const sinks = [];   // fees the server reported, for the conservation invariant
const fee = (price) => Math.max(1, Math.ceil(price * cfg.tax));

// ─── legitimate gold seeding ─────────────────────────────────────────
// Gold enters the economy exactly ONE way (server/validate.js): a save may claim kills,
// each enemy type crediting its OWN per-kill value, capped by burst + dt*perSec of wall
// time since the previous ACCEPTED save. A character's FIRST save holds
// CAPS.freshGold = 0 gold — the anti-gold-mint rule — so the harness CANNOT upload a
// starting balance. It earns the gold it needs over the wire, exactly as a player would.
// The clamp is not weakened, no production limit moves, and the relay is spawned with
// production defaults: this makes the fixture honest, it does not make the server loose.
async function earnGold(peer, want, inventory) {
  assert(inventory, 'earnGold needs an inventory to save with');
  // A server record must exist FIRST: the credit is measured from the previous accepted
  // save's timestamp, so one save has to land before any kill can be credited.
  await peer.save({ rev: peer.rev, gold: 0, inventory });
  assert(await peer.waitFor('saved', () => true, 4000), `${peer.name}: seed save was not acknowledged`);
  await peer.hello();
  let gold = peer.gold | 0;
  let kills = {};                 // cumulative lifetime counts (they must never rewind)
  for (let i = 0; i < 4 && gold < want; i++) {
    await sleep(3300);            // wall time for the per-type caps to accrue
    const dt = 3;                 // claim strictly below the true elapsed time
    const next = {}; let credit = 0;
    for (const id of Object.keys(ENEMY_REWARDS)) {
      const r = ENEMY_REWARDS[id];
      const add = r.cap.burst + Math.floor(dt * r.cap.perSec);
      if (add <= 0) continue;
      next[id] = (kills[id] | 0) + add;      // lifetime count, never lower than before
      credit += add * r.gold[1];
    }
    kills = next;
    await peer.save({ rev: peer.rev, gold: gold + credit, inventory, kills });
    assert(await peer.waitFor('saved', () => true, 4000), `${peer.name}: kill-credit save was not acknowledged`);
    await peer.hello();
    gold = peer.gold | 0;
  }
  return gold;
}

async function main() {
  rmScratch();
  await t('relay answers /health as OUR process (own port + DATA_DIR, headless)', async () => {
    const j = await bootRelay();
    assert(j.ok === true && j.game === 'wayfarer-online', `/health said ${JSON.stringify(j)}`);
  });
  if (relay.exitCode !== null) throw new Error('relay is not running; aborting the scenario');

  await t('two clients join the same public world shard (one room, seen by the relay)', async () => {
    const ra = await A.join(); const rb = await B.join();
    assert(ra.roomId === rb.roomId, `different rooms: ${ra.roomId} vs ${rb.roomId}`);
    assert(A.sid && B.sid && A.sid !== B.sid, `bad session ids ${A.sid}/${B.sid}`);
    const stats = await (await fetch(`http://localhost:${PORT}/stats`)).json();
    const world = (stats.rooms || []).find((r) => r.kind === 'world');
    assert(world, `relay /stats has no world room: ${JSON.stringify(stats.rooms)}`);
    assert(world.players === 2, `relay sees ${world.players} player(s) in the world, expected 2`);
  });

  step('hello: EARN the starting gold over the wire (a first save is clamped to 0), then read the server copy back');
  await t('both clients save a character and econ-state mirrors it (server is authoritative)', async () => {
    await A.save({ rev: 0 }); await B.save({ rev: 0 });
    const savedA = await A.waitFor('saved', () => true, 4000);
    const savedB = await B.waitFor('saved', () => true, 4000);
    assert(savedA && savedB, `save not acknowledged (A:${!!savedA} B:${!!savedB})`);
    const firstA = await A.hello(); const firstB = await B.hello();
    // Populate cfg BEFORE any assertion that can throw: it used to be set after the
    // gold assertion, so a single clamp mismatch left cfg null and turned the rest of
    // the run into 14 misleading "Cannot read properties of null" failures instead of
    // one honest failure.
    cfg = firstA.cfg;
    assert(cfg && typeof cfg.tax === 'number', `econ-state carried no cfg: ${JSON.stringify(cfg)}`);
    assert(firstA.hasSave === true && firstB.hasSave === true, `hasSave false (A:${firstA.hasSave} B:${firstB.hasSave})`);

    // Earn the starting gold the ONLY way the relay lets it in — per-kill credit
    // (server/rewards.js), capped by wall time between accepted saves. A first save is
    // clamped to CAPS.freshGold = 0, so uploading a balance is impossible by design.
    const gA = await earnGold(A, SEED_A, [X, Y, Z]);
    const gB = await earnGold(B, SEED_B, [W]);
    assert(gA >= SEED_A && gB >= SEED_B, `could not earn the starting gold (A ${gA}/${SEED_A}, B ${gB}/${SEED_B})`);
    // Pin the exact balances this scenario reasons about: a save may KEEP gold the
    // character already holds (kills only ever credit upward) but can never invent it.
    await A.save({ rev: A.rev, gold: SEED_A, inventory: [X, Y, Z] });
    assert(await A.waitFor('saved', () => true, 4000), 'A: pin save not acknowledged');
    await B.save({ rev: B.rev, gold: SEED_B, inventory: [W] });
    assert(await B.waitFor('saved', () => true, 4000), 'B: pin save not acknowledged');

    const sa = await A.hello(); const sb = await B.hello();
    assert(sa.hasSave === true && sb.hasSave === true, `hasSave false (A:${sa.hasSave} B:${sb.hasSave})`);
    assert(sa.gold === SEED_A && ms(sa.inventory) === ms([X, Y, Z]), `A copy ${sa.gold}g [${sa.inventory}]`);
    assert(sb.gold === SEED_B && ms(sb.inventory) === ms([W]), `B copy ${sb.gold}g [${sb.inventory}]`);
    eq({ bag: cfg.bag, tradeItems: cfg.tradeItems, tax: cfg.tax, postage: cfg.postage, priceMax: cfg.priceMax },
      { bag: 30, tradeItems: 8, tax: 0.05, postage: 5, priceMax: 1000000 }, 'econ-state cfg (mirrors validate.js ECON)');
    // the seeded total is what conservation below must hold to
    startTotal = sa.gold + sb.gold;
  });

  // ── happy: direct trade ──────────────────────────────────────────
  step('trade: request -> accept -> offer -> lock -> confirm (A gives 1 item + 300g, B gives 1 item)');
  let tradeId = null;
  await t('trade request reaches the target and opens a session for both', async () => {
    await A.send('trade-request', { to: B.sid });
    const req = await B.waitFor('trade-request', (m) => m.from === A.sid, 4000);
    assert(req, `B got no trade-request from ${A.sid}`);
    eq(req.fromName, 'Aldra', 'trade-request fromName');
    const note = await A.waitFor('econ-msg', (m) => String(m.text).includes('Trade request sent'), 3000);
    assert(note, 'sender got no confirmation note');
    await B.send('trade-respond', { from: A.sid, accept: true });
    const openA = await A.waitFor('trade-open', () => true, 4000);
    const openB = await B.waitFor('trade-open', () => true, 4000);
    assert(openA && openB, `trade-open missing (A:${!!openA} B:${!!openB})`);
    assert(openA.partner.sid === B.sid && openB.partner.sid === A.sid, 'trade-open partner mismatch');
    eq(openA.id, openB.id, 'both sides see the same trade id');
    tradeId = openA.id;
  });
  await t('offers are checked against each server copy and mirrored to the partner', async () => {
    await A.send('trade-offer', { id: tradeId, items: [Y], gold: 300 });
    await B.send('trade-offer', { id: tradeId, items: [W], gold: 0 });
    const aView = await A.waitFor('trade-update', (m) => m.id === tradeId && m.them.items.length === 1 && m.me.gold === 300, 4000);
    const bView = await B.waitFor('trade-update', (m) => m.id === tradeId && m.them.gold === 300 && m.me.items.length === 1, 4000);
    assert(aView && bView, `trade-update missing (A:${!!aView} B:${!!bView})`);
    eq(aView.me.items, [Y], 'A own offer items');
    eq(aView.them.items, [W], 'A sees the partner offer');
    eq(bView.me.items, [W], 'B own offer items');
    assert(aView.me.locked === false && aView.me.confirmed === false, 'an offer must not auto-lock');
  });
  await t('both lock then both confirm: gold + items swap atomically on BOTH sides', async () => {
    await A.send('trade-lock', { id: tradeId, rev: A.rev });
    await B.send('trade-lock', { id: tradeId, rev: B.rev });
    const lockA = await A.waitFor('trade-update', (m) => m.id === tradeId && m.me.locked === true, 4000);
    const lockB = await B.waitFor('trade-update', (m) => m.id === tradeId && m.me.locked === true, 4000);
    assert(lockA && lockB, `lock not confirmed (A:${!!lockA} B:${!!lockB})`);
    await A.send('trade-confirm', { id: tradeId });
    await B.send('trade-confirm', { id: tradeId });
    const resA = await A.waitFor('trade-result', (m) => m.id === tradeId, 5000);
    const resB = await B.waitFor('trade-result', (m) => m.id === tradeId, 5000);
    assert(resA && resB, `trade-result missing (A:${!!resA} B:${!!resB})`);
    assert(resA.ok === 1 && resB.ok === 1, `trade refused: A=${JSON.stringify(resA)} B=${JSON.stringify(resB)}`);
    // the server's absolute state
    assert(resA.gold === 4700, `A gold ${resA.gold} != 4700 (5000-300)`);
    assert(resB.gold === 1300, `B gold ${resB.gold} != 1300 (1000+300)`);
    eq(ms(resA.inventory), ms([X, Z, W]), 'A bag after the trade');
    eq(ms(resB.inventory), ms([Y]), 'B bag after the trade');
    // the delta the client is told to apply must agree with that absolute state
    eq(resA.delta, { gold: -300, add: [W], remove: [Y] }, 'A delta');
    eq(resB.delta, { gold: 300, add: [Y], remove: [W] }, 'B delta');
    A.expectState({ gold: 4700, inventory: [X, Z, W] }, 'A');
    B.expectState({ gold: 1300, inventory: [Y] }, 'B');
  });
  await t('durable commit: both player files on disk match the post-trade server copy', async () => {
    const da = await waitDisk(A, { gold: 4700, inventory: [X, Z, W] });
    const db = await waitDisk(B, { gold: 1300, inventory: [Y] });
    assert(da, `A file on disk is not 4700g/[${X},${Z},${W}] (gold ${diskProgress(A.token, A.name)?.gold})`);
    assert(db, `B file on disk is not 1300g/[${Y}] (gold ${diskProgress(B.token, B.name)?.gold})`);
  });

  // ── happy: market ────────────────────────────────────────────────
  step('market: post -> browse -> buy -> seller claims proceeds -> cancel');
  await t('market-post takes the listing fee and removes the item from the seller bag', async () => {
    const before = A.gold, revBefore = A.rev, f = fee(200);
    await A.send('market-post', { item: X, price: 200, hours: 2, rev: revBefore });
    const sync = await A.expectSync('market-post');
    eq(sync.delta, { gold: -f, add: [], remove: [X] }, 'market-post delta');
    assert(sync.gold === before - f, `A gold ${sync.gold} != ${before} - ${f} fee`);
    assert(!A.inventory.includes(X), 'the listed item is still in the server bag');
    assert(A.rev === revBefore + 1, `rev did not advance: ${A.rev} != ${revBefore} + 1`);
    sinks.push({ what: `market fee (${X} @200g)`, gold: f });
  });
  await t('market-browse lists the new listing with item, price and seller', async () => {
    await B.send('market-browse', { page: 0 });
    const page = await B.waitFor('market-page', (m) => m.items.some((i) => i.item === X), 4000);
    assert(page, `market-page does not contain item ${X}`);
    const l = page.items.find((i) => i.item === X);
    assert(l.price === 200, `listed price ${l.price} != 200`);
    assert(l.seller === 'Aldra', `listed seller ${l.seller} != Aldra`);
    assert(typeof l.id === 'string' && l.id, 'the listing has no id');
    B.listingId = l.id;
  });
  await t('market-buy moves the item + gold and pays the seller BY MAIL', async () => {
    const before = B.gold;
    await B.send('market-buy', { id: B.listingId, rev: B.rev });
    const sync = await B.expectSync('market-buy');
    eq(sync.delta, { gold: -200, add: [X], remove: [] }, 'market-buy delta');
    assert(sync.gold === before - 200, `B gold ${sync.gold} != ${before} - 200`);
    assert(B.inventory.includes(X), 'the buyer bag does not contain the bought item');
    const unread = await A.waitFor('mail-unread', (m) => String(m.subject || '').startsWith('Sold:'), 5000);
    assert(unread, 'the seller got no mail-unread for the sale');
  });
  await t('the seller claims the market proceeds out of mail', async () => {
    const before = A.gold;
    await A.send('mail-list', {});
    const box = await A.waitFor('mail-box', (m) => m.mails.some((x) => String(x.subject).startsWith('Sold:')), 4000);
    assert(box, 'the seller mail-box has no Sold mail');
    const sold = box.mails.find((x) => String(x.subject).startsWith('Sold:'));
    assert(sold.gold === 200, `Sold mail gold ${sold.gold} != 200`);
    await A.send('mail-claim', { id: sold.id, rev: A.rev });
    const sync = await A.expectSync('mail-claim');
    eq(sync.delta, { gold: 200, add: [], remove: [] }, 'Sold-mail claim delta');
    assert(A.gold === before + 200, `A gold ${A.gold} != ${before} + 200`);
  });
  await t('the sold listing is gone from the board (seller has no listings left)', async () => {
    await A.send('market-browse', { mine: 1 });
    const page = await A.waitFor('market-page', (m) => m.mine === 1, 4000);
    assert(page, 'no market-page for mine=1');
    assert(page.total === 0, `seller still shows ${page.total} listing(s)`);
  });
  await t('market-cancel returns the item to the bag and does NOT refund the fee', async () => {
    const before = A.gold, f = fee(50);
    await A.send('market-post', { item: Z, price: 50, hours: 24, rev: A.rev });
    const posted = await A.expectSync('market-post');
    eq(posted.delta, { gold: -f, add: [], remove: [Z] }, 'cancel-test market-post delta');
    assert(!A.inventory.includes(Z), 'the item is still in the bag after posting');
    await A.send('market-browse', { mine: 1, sort: 'new' });
    const page = await A.waitFor('market-page', (m) => m.mine === 1 && m.total === 1, 4000);
    assert(page, 'the new listing is not visible to its seller');
    await A.send('market-cancel', { id: page.items[0].id, rev: A.rev });
    const cancelled = await A.expectSync('market-cancel');
    eq(cancelled.delta, { gold: 0, add: [Z], remove: [] }, 'market-cancel delta');
    assert(A.inventory.includes(Z), 'the cancelled item did not come back to the bag');
    assert(A.gold === before - f, `the fee was refunded: gold ${A.gold} != ${before} - ${f}`);
    sinks.push({ what: `market fee (${Z} @50g)`, gold: f });
  });

  // ── happy: mail ──────────────────────────────────────────────────
  step('mail: send (item + gold) -> list -> claim, and a second claim is refused');
  let mailId = null;
  await t('mail-send charges postage and takes the attachment from the sender', async () => {
    const before = A.gold;
    await A.send('mail-send', { to: 'Brann', subject: 'Econ test', body: 'enclosed', gold: 100, items: [Z], rev: A.rev });
    const sync = await A.expectSync('mail-send');
    eq(sync.delta, { gold: -(100 + cfg.postage), add: [], remove: [Z] }, 'mail-send delta (100g + postage)');
    assert(sync.gold === before - 100 - cfg.postage, `A gold ${sync.gold} != ${before} - 100 - ${cfg.postage} postage`);
    assert(!A.inventory.includes(Z), 'the mailed item is still in the sender bag');
    sinks.push({ what: 'mail postage', gold: cfg.postage });
    const unread = await B.waitFor('mail-unread', (m) => m.from === 'Aldra', 5000);
    assert(unread && unread.n >= 1, `the recipient got no mail-unread (${JSON.stringify(unread)})`);
  });
  await t('mail-list shows the mail with its gold + item attachment', async () => {
    await B.send('mail-list', {});
    const box = await B.waitFor('mail-box', (m) => m.mails.some((x) => x.subject === 'Econ test'), 4000);
    assert(box, 'mail-box does not contain the sent mail');
    const mail = box.mails.find((x) => x.subject === 'Econ test');
    assert(mail.from === 'Aldra', `mail from ${mail.from} != Aldra`);
    assert(mail.gold === 100 && (mail.items || []).includes(Z), `attachments wrong: ${JSON.stringify(mail)}`);
    mailId = mail.id;
  });
  await t('mail-claim delivers the gold + item to the recipient', async () => {
    const before = B.gold;
    await B.send('mail-claim', { id: mailId, rev: B.rev });
    const sync = await B.expectSync('mail-claim');
    eq(sync.delta, { gold: 100, add: [Z], remove: [] }, 'mail-claim delta');
    assert(sync.gold === before + 100, `B gold ${sync.gold} != ${before} + 100`);
    assert(B.inventory.includes(Z), 'the claimed item is not in the recipient bag');
  });
  await t('mail-claim twice is refused (nothing to take)', async () => {
    await B.send('mail-claim', { id: mailId, rev: B.rev });
    await B.expectError({ code: 'gone', msg: 'Nothing to take' });
  });

  step('gold conservation over the happy path (trades + the fees the server reported)');
  await t('total gold = start minus reported fees (nothing created or destroyed)', async () => {
    await A.hello(); await B.hello();
    const sunk = sinks.reduce((s, x) => s + x.gold, 0);
    assert(A.gold + B.gold === startTotal - sunk, `A(${A.gold}) + B(${B.gold}) != ${startTotal} - ${sunk} sinks (= ${startTotal - sunk})`);
    assert(sunk === 18, `reported sinks ${sunk} != 13 (market fees) + 5 (postage)`);
  });

  // ── happy: guild bank ────────────────────────────────────────────
  step('guild: create -> invite -> accept -> member deposit -> leader withdraw');
  await t('guild-create makes the founder the leader of an empty bank', async () => {
    await A.send('guild-create', { tag: 'ECON', name: 'Economy Testers' });
    const info = await A.waitFor('guild-info', (m) => m.tag === 'ECON', 5000);
    assert(info, 'no guild-info for the new guild');
    assert(info.myRank === 'leader', `founder rank ${info.myRank} != leader`);
    assert(info.bank === 0, `new bank ${info.bank} != 0`);
    assert(info.members.length === 1 && info.members[0].name === 'Aldra', `members ${JSON.stringify(info.members)}`);
  });
  await t('guild-invite reaches the target and accepting adds the member', async () => {
    await A.send('guild-invite', { name: 'Brann' });
    const inv = await B.waitFor('guild-invite', (m) => m.tag === 'ECON', 5000);
    assert(inv, 'the target got no guild-invite');
    await B.send('guild-accept', {});
    const info = await B.waitFor('guild-info', (m) => m.tag === 'ECON' && m.members.length === 2, 5000);
    assert(info, 'no guild-info with 2 members for the new member');
    assert(info.myRank === 'member', `joiner rank ${info.myRank} != member`);
    assert(await A.waitFor('guild-info', (m) => m.tag === 'ECON' && m.members.length === 2, 5000), 'existing members were not refreshed after the join');
  });
  await t('guild-deposit moves gold from a member into the bank', async () => {
    const beforeA = A.gold, beforeB = B.gold;
    await A.send('guild-deposit', { gold: 500, rev: A.rev });
    const sa = await A.expectSync('guild-deposit');
    eq(sa.delta, { gold: -500, add: [], remove: [] }, 'A guild-deposit delta');
    assert(await A.waitFor('guild-info', (m) => m.bank === 500, 5000), 'no guild-info with bank 500 after A deposited');
    assert(A.gold === beforeA - 500, `A gold ${A.gold} != ${beforeA} - 500`);
    await B.send('guild-deposit', { gold: 100, rev: B.rev });
    const sb = await B.expectSync('guild-deposit');
    eq(sb.delta, { gold: -100, add: [], remove: [] }, 'B guild-deposit delta');
    assert(await B.waitFor('guild-info', (m) => m.bank === 600, 5000), 'no guild-info with bank 600 after B deposited');
    assert(B.gold === beforeB - 100, `B gold ${B.gold} != ${beforeB} - 100`);
  });
  await t('guild-withdraw pays the leader out of the bank', async () => {
    const before = A.gold;
    await A.send('guild-withdraw', { gold: 200, rev: A.rev });
    const sync = await A.expectSync('guild-withdraw');
    eq(sync.delta, { gold: 200, add: [], remove: [] }, 'guild-withdraw delta');
    assert(await A.waitFor('guild-info', (m) => m.bank === 400, 5000), 'no guild-info with bank 400 after the withdraw');
    assert(A.gold === before + 200, `A gold ${A.gold} != ${before} + 200`);
  });

  // ── rejects: trade ───────────────────────────────────────────────
  step('rejects: trade (bad offers, empty swap, unknown target)');
  await t('trade offers: insufficient gold, bad id, unowned id, over-cap, malformed — all refused', async () => {
    await A.hello();
    const g0 = A.gold, bag0 = ms(A.inventory);
    await A.send('trade-request', { to: B.sid });
    assert(await B.waitFor('trade-request', (m) => m.from === A.sid, 4000), 'no trade-request');
    await B.send('trade-respond', { from: A.sid, accept: true });
    const open = await A.waitFor('trade-open', () => true, 4000);
    assert(open, 'no trade-open');
    const id = open.id;
    await A.send('trade-offer', { id, items: [], gold: 999999 });
    await A.expectError({ code: 'gold', msg: 'not have that much gold' });
    await A.send('trade-offer', { id, items: ['definitely_not_a_real_item'], gold: 0 });
    await A.expectError({ code: 'invalid', msg: 'Invalid offer' });
    await A.send('trade-offer', { id, items: [UNOWNED], gold: 0 });
    await A.expectError({ code: 'missing', msg: 'server copy' });
    await A.send('trade-offer', { id, items: new Array(cfg.tradeItems + 1).fill(X), gold: 0 });
    await A.expectError({ code: 'invalid', msg: 'Invalid offer' });         // > TRADE_ITEMS
    await A.send('trade-offer', { id, items: 'not-an-array', gold: 'lots' });
    await A.expectError({ code: 'invalid', msg: 'Invalid offer' });         // malformed payload
    await A.send('trade-offer', { id, items: [], gold: 10000000 });
    await A.expectError({ code: 'invalid', msg: 'Invalid offer' });         // > GOLD_MAX
    await A.hello();
    assert(A.gold === g0, `gold moved during the refused offers: ${A.gold} != ${g0}`);
    assert(ms(A.inventory) === bag0, `bag moved during the refused offers: [${A.inventory}] != [${bag0}]`);
    // Nothing was ever offered into this session (every offer above was refused),
    // so both sides are already empty: lock straight away. Sending another empty
    // offer here would race the peer's lock — an offer runs unlockAll() on the
    // server, and two sockets have no ordering relative to each other.
    const mErrA = A.mark(), mErrB = B.mark();
    await A.send('trade-lock', { id, rev: A.rev });
    await B.send('trade-lock', { id, rev: B.rev });
    // wait until the server has acked BOTH locks before confirming (a confirm is
    // only accepted once both sides are locked)
    const lkA = await A.waitFor('trade-update', (m) => m.id === id && m.me.locked === true, 3000);
    const lkB = await B.waitFor('trade-update', (m) => m.id === id && m.me.locked === true, 3000);
    const trace = [...A.since(mErrA).map((e) => `A:${e.type}${e.type === 'trade-update' ? JSON.stringify(e.m) : e.type === 'econ-error' ? `(${e.m.code || '-'}: ${e.m.msg})` : ''}`),
                   ...B.since(mErrB).map((e) => `B:${e.type}${e.type === 'trade-update' ? JSON.stringify(e.m) : e.type === 'econ-error' ? `(${e.m.code || '-'}: ${e.m.msg})` : ''}`)].join(' | ');
    assert(lkA && lkB, `empty-offer locks did not register (A:${!!lkA} B:${!!lkB}) — messages: ${trace}`);
    await A.send('trade-confirm', { id });
    await B.send('trade-confirm', { id });
    const failA = await A.waitFor('trade-result', (m) => m.id === id && m.ok === 0, 5000);
    const failB = await B.waitFor('trade-result', (m) => m.id === id && m.ok === 0, 5000);
    assert(failA && failB, `an empty trade was not refused for both (A:${JSON.stringify(failA)} B:${JSON.stringify(failB)}) — messages: ${trace}`);
    assert(failA.reason === 'Nothing to trade.', `empty-trade reason ${JSON.stringify(failA.reason)}`);
    await A.hello();
    assert(A.gold === g0 && ms(A.inventory) === bag0, `the empty trade moved state: ${A.gold}g/[${A.inventory}]`);
    await A.send('trade-cancel', { id });
    const closedA = await A.waitFor('trade-closed', (m) => m.id === id, 4000);
    const closedB = await B.waitFor('trade-closed', (m) => m.id === id, 4000);
    assert(closedA && closedB, `trade-cancel did not close the session for both (A:${!!closedA} B:${!!closedB})`);
  });
  await t('trade-request to an unknown session id is refused', async () => {
    await A.send('trade-request', { to: 'no-such-session' });
    await A.expectError({ msg: 'not here' });
  });

  // ── rejects: market ──────────────────────────────────────────────
  step('rejects: market (rev protocol, bad ids/amounts, replay, own listing)');
  await t('market-post with no rev, and with a stale rev, is refused with a re-sync', async () => {
    await A.hello();
    await A.send('market-post', { item: X, price: 100, hours: 2 });                       // no rev at all
    await A.expectError({ code: 'rev', msg: 're-synced' });
    await A.send('market-post', { item: X, price: 100, hours: 2, rev: A.rev - 1 });      // stale rev
    await A.expectError({ code: 'rev', msg: 're-synced' });
    assert(await A.waitFor('econ-sync', (m) => m.why === 'rev', 3000), 'the client was not re-synced after a stale rev');
  });
  await t('a replayed market-post (same payload, already-used rev) is refused and cannot dupe an item', async () => {
    await A.hello();
    const payload = { item: W, price: 111, hours: 2, rev: A.rev };
    await A.send('market-post', { ...payload });
    const first = await A.expectSync('market-post');
    assert(appearsOnce(first.delta.remove, W), `the first post did not remove ${W}: ${JSON.stringify(first.delta)}`);
    const goldAfter = A.gold;
    await A.send('market-post', { ...payload });                                          // exact replay, old rev
    await A.expectError({ code: 'rev', msg: 're-synced' });
    await A.send('market-browse', { mine: 1, sort: 'new' });
    const page = await A.waitFor('market-page', (m) => m.mine === 1, 4000);
    assert(page && page.total === 1, `the replay created a second listing (total ${page && page.total})`);
    await A.hello();
    assert(A.gold === goldAfter, `the replay changed gold: ${A.gold} != ${goldAfter}`);
    await A.send('market-cancel', { id: page.items[0].id, rev: A.rev });
    const back = await A.expectSync('market-cancel');
    assert(appearsOnce(back.delta.add, W), `the cancel did not return ${W}: ${JSON.stringify(back.delta)}`);
    sinks.push({ what: `market fee (${W} @111g, replay test)`, gold: fee(111) });
  });
  await t('market-post rejects bad ids, over-cap price, non-integer price, bad duration, unowned item', async () => {
    await A.hello();
    const g0 = A.gold, bag0 = ms(A.inventory);
    await A.send('market-post', { item: 'definitely_not_a_real_item', price: 10, hours: 2, rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'cannot be listed' });
    await A.send('market-post', { item: X, price: cfg.priceMax + 1, hours: 2, rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'Price must be' });
    await A.send('market-post', { item: X, price: 1.5, hours: 2, rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'Price must be' });                       // whole numbers only
    await A.send('market-post', { item: X, price: 10, hours: 3, rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'duration' });                            // not in MARKET_HOURS
    await A.send('market-post', { item: UNOWNED, price: 10, hours: 2, rev: A.rev });
    await A.expectError({ code: 'missing', msg: 'not in your bag' });
    await A.hello();
    assert(A.gold === g0, `gold moved on refused listings: ${A.gold} != ${g0}`);
    assert(ms(A.inventory) === bag0, `bag changed on refused listings: [${A.inventory}] != [${bag0}]`);
  });
  await t('market-buy of a gone listing, and of your own listing, are refused', async () => {
    await A.hello();
    await A.send('market-buy', { id: 'L999999', rev: A.rev });
    await A.expectError({ code: 'gone', msg: 'listing is gone' });
    assert(A.inventory.includes(W), `${W} is not in the seller bag, cannot list it`);
    await A.send('market-post', { item: W, price: 77, hours: 2, rev: A.rev });
    await A.expectSync('market-post');
    await A.send('market-browse', { mine: 1, sort: 'new' });
    const page = await A.waitFor('market-page', (m) => m.mine === 1 && m.total === 1, 4000);
    assert(page, 'the own listing is not visible to its seller');
    await A.send('market-buy', { id: page.items[0].id, rev: A.rev });
    await A.expectError({ msg: 'your own listing' });
    await A.send('market-cancel', { id: page.items[0].id, rev: A.rev });
    const back = await A.expectSync('market-cancel');
    assert(appearsOnce(back.delta.add, W), `the own-listing cancel did not return ${W}`);
    sinks.push({ what: `market fee (${W} @77g, own-listing test)`, gold: fee(77) });
  });

  // ── rejects: mail / guild ────────────────────────────────────────
  step('rejects: mail and guild bank');
  await t('mail-send refuses over-cap gold, malformed attachments, over-cap items and unknown names', async () => {
    await A.hello();
    const g0 = A.gold;
    await A.send('mail-send', { to: 'Brann', subject: 'x', body: 'y', gold: 10000000, items: [], rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'Invalid attachments' });                  // > GOLD_MAX
    await A.send('mail-send', { to: 'Brann', subject: 'x', body: 'y', gold: 'lots', items: 'nope', rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'Invalid attachments' });                  // malformed
    await A.send('mail-send', { to: 'Brann', subject: 'x', body: 'y', gold: 0, items: new Array(cfg.mailItems + 1).fill(X), rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'Invalid attachments' });                  // > MAIL_ITEMS
    await A.send('mail-send', { to: 'Nobody Here', subject: 'x', body: 'y', gold: 0, items: [], rev: A.rev });
    await A.expectError({ code: 'noname', msg: 'Nobody named' });
    await A.hello();
    assert(A.gold === g0, `gold moved on refused mail: ${A.gold} != ${g0}`);
  });
  await t('mail-claim of an unknown mail id is refused', async () => {
    await B.send('mail-claim', { id: 'M999999', rev: B.rev });
    await B.expectError({ code: 'gone', msg: 'Nothing to take' });
  });
  await t('guild bank: only the leader may withdraw, and bad amounts are refused', async () => {
    await A.hello(); await B.hello();
    const gA = A.gold, gB = B.gold;
    await B.send('guild-withdraw', { gold: 50, rev: B.rev });
    await B.expectError({ msg: 'Only the guild leader' });
    await A.send('guild-withdraw', { gold: 100000, rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'bank holds' });                           // over the bank total
    await A.send('guild-deposit', { gold: 1.5, rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'whole number' });                         // not an integer
    await A.send('guild-deposit', { gold: 0, rev: A.rev });
    await A.expectError({ code: 'invalid', msg: 'whole number' });                          // zero
    await A.send('guild-deposit', { gold: 9999999, rev: A.rev });
    await A.expectError({ code: 'gold', msg: 'not have that much gold' });                  // more than the wallet
    await A.hello(); await B.hello();
    assert(A.gold === gA && B.gold === gB, `refused guild ops moved gold: A ${A.gold}/${gA}, B ${B.gold}/${gB}`);
    await A.send('guild-info', {});
    const info = await A.waitFor('guild-info', (m) => m.tag === 'ECON', 4000);
    assert(info && info.bank === 400, `bank changed to ${info && info.bank}, expected 400`);
  });

  // ── guards ───────────────────────────────────────────────────────
  step('guards: oversize payload, stale save revision, dupe strip on save');
  await t('an oversize economy payload is dropped silently, with no reply and no state change', async () => {
    await A.hello();
    const mark = A.mark(), g0 = A.gold;
    await A.send('market-post', { item: 'x'.repeat(3000), price: 10, hours: 2, rev: A.rev });
    await sleep(900);
    const replies = A.since(mark).filter((e) => ['econ-error', 'econ-sync', 'econ-msg', 'market-page'].includes(e.type));
    assert(replies.length === 0, `the oversize payload got ${replies.length} repl(y/ies): ${JSON.stringify(replies.map((r) => r.type))}`);
    await A.hello();
    assert(A.gold === g0, `gold moved on an oversize payload: ${A.gold} != ${g0}`);
  });
  await t('a save quoting a stale economy rev is refused (econ-sync stale, no "saved")', async () => {
    await A.hello();
    assert(A.rev > 0, `rev is ${A.rev}: this check needs an already-mutated character`);
    const mark = A.mark();
    await A.save({ rev: A.rev - 1 });
    assert(await A.waitFor('econ-sync', (m) => m.stale === 1, 4000), 'a stale save was not answered with econ-sync {stale:1}');
    await sleep(300);
    const saved = A.since(mark).filter((e) => e.type === 'saved');
    assert(saved.length === 0, 'the server acknowledged a save with a stale rev');
  });
  await t('a save quoting the current rev is accepted', async () => {
    const mark = A.mark();
    await A.save({ rev: A.rev });
    assert(await A.waitFor('saved', () => true, 4000), 'the server refused a save with the current rev');
    assert(A.since(mark).filter((e) => e.type === 'econ-sync' && e.m.stale === 1).length === 0, 'a current-rev save was treated as stale');
  });
  await t('dupe guard: an extra copy of an economy-out item in an uploaded save is stripped', async () => {
    await A.hello();
    const before = [...A.inventory];
    assert(!before.includes(Z), `${Z} is back in the bag: this check needs an item the economy moved out`);
    await A.save({ rev: A.rev, gold: A.gold, inventory: [...before, Z] });   // claim the item the mail-send moved out
    assert(await A.waitFor('saved', () => true, 4000), 'the dupe save was not acknowledged');
    const after = await A.hello();
    const n = after.inventory.filter((x) => x === Z).length;
    assert(n === 0, `the duped ${Z} survived on the server copy (${n} copy/copies): [${after.inventory}]`);
    assert(ms(after.inventory) === ms(before), `the bag changed beyond the stripped dupe: [${after.inventory}] != [${before}]`);
  });
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  record(false, 'harness aborted', e && e.stack ? e.stack : String(e));
} finally {
  try { await A.room?.leave?.(); } catch { /* closing */ }
  try { await B.room?.leave?.(); } catch { /* closing */ }
  relay?.kill();
  rmScratch();
  await sleep(150);
  if (failed) {
    console.log('\n--- relay output (last 25 lines, raw) ---');
    for (const l of relayOut.slice(-25)) console.log(l);
    console.log(`\nECON FAILED — ${failed} of ${checks} checks failed: ${failures.join(' | ')}`);
    exitCode = 1;
  } else {
    console.log(`\nECON OK — ${checks} checks passed (wire-level, real relay on :${PORT}, DATA_DIR cleaned up)`);
  }
  process.exit(exitCode);
}
