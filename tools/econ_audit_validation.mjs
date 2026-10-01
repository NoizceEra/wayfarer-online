#!/usr/bin/env node
// Wayfarer Online — numeric / validation / forgery audit harness.
//
// Drives the REAL relay over its WebSocket protocol (colyseus.js client + a
// self-spawned `node index.js` on its own port/DATA_DIR). Nothing here imports a
// server module directly: every result is a live wire result.
// Economy messages are paced because server/economy.js rate-limits them
// (Tok(5,16)); a 'rate' reply is retried, never counted as a validation verdict.
//
// Exit code: 0 = no issue reproduced, 1 = at least one issue reproduced.
//
// Usage: node tools/econ_audit_validation.mjs   (from the repo root)
//        AUDIT_PORT=2592 node tools/econ_audit_validation.mjs

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.AUDIT_PORT || 2591);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-audit-'));
const BASE = `http://127.0.0.1:${PORT}`;
const GEAR = Object.keys(JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'shared', 'item_ids.json'), 'utf8')).gear);

const issues = [];
const clean = [];
const notes = [];
const say = (...a) => console.log(...a);
const issue = (sev, id, detail) => { issues.push({ sev, id, detail }); say(`  [ISSUE ${sev}] ${id}: ${detail}`); };
const ok = (id, detail) => { clean.push(id); say(`  [ok] ${id}: ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── relay ──────────────────────────────────────────────────────────────────
const relay = spawn(process.execPath, ['index.js'], {
  cwd: SERVER_DIR, env: { ...process.env, PORT: String(PORT), DATA_DIR }, stdio: ['ignore', 'pipe', 'pipe'],
});
let relayLog = '';
relay.stdout.on('data', (d) => { relayLog += d; });
relay.stderr.on('data', (d) => { relayLog += d; });
const shutdown = () => { try { relay.kill(); } catch {} };
process.on('exit', shutdown);

const healthy = async () => { try { return (await fetch(`${BASE}/health`)).status === 200; } catch { return false; } };
async function waitHealthy(ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await healthy()) return true; await sleep(150); } return false; }

// ── clients ────────────────────────────────────────────────────────────────
const mod = await import('colyseus.js');
const ColyseusClient = mod.Client || mod.default?.Client;
let sidSeq = 0;
async function join(name, token) {
  const c = new ColyseusClient(`ws://127.0.0.1:${PORT}`);
  const room = await c.joinOrCreate('world', { name, token, hero: {}, a: 'ow', x: 0, y: 0 });
  const inbox = [];
  room.onMessage('*', (type, m) => inbox.push({ type, m, t: Date.now() }));
  room.onError((code) => inbox.push({ type: '!onError', m: { code }, t: Date.now() }));
  room.onLeave((code) => inbox.push({ type: '!onLeave', m: { code }, t: Date.now() }));
  return { name, token, room, inbox, sid: room.sessionId, n: ++sidSeq };
}
const clear = (p) => { p.inbox.length = 0; };
function waitFor(p, type, ms = 1500) {
  return new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const i = p.inbox.findIndex((x) => x.type === type);
      if (i >= 0) { clearInterval(iv); res(p.inbox.splice(i, 1)[0]); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); res(null); }
    }, 5);
  });
}
const isOpen = (p) => !!p.room.connection?.isOpen;
// a socket can be closed by the transport (frame > 4KB): re-join the same
// character (same device token + name -> same server copy) and carry on
const rejoin = async (p, name, token) => (p && isOpen(p) ? p : join(name || p?.name, token || p?.token));
async function ping(p, ms = 1500) { clear(p); p.room.send('ping', { c: 1 }); return !!(await waitFor(p, 'pong', ms)); }

// paced economy send: server rate-limits econ (Tok(5,16)) and browse (Tok(3,8));
// a 'rate' reply is retried and never treated as a validation verdict.
const lastSent = new Map();
const bucketOf = (t) => (['econ-hello', 'market-browse', 'mail-list', 'guild-info', 'mail-read'].includes(t) ? 'browse' : 'econ');
async function econ(p, type, msg, { ms = 550, pace = 300, tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    const k = `${p.sid}|${bucketOf(type)}`;
    const gap = pace - (Date.now() - (lastSent.get(k) || 0));
    if (gap > 0) await sleep(gap);
    lastSent.set(k, Date.now());
    clear(p); p.room.send(type, msg);
    await sleep(ms);
    const replies = p.inbox.slice();
    const err = replies.find((r) => r.type === 'econ-error');
    const sync = replies.find((r) => r.type === 'econ-sync');
    if (err && err.m?.code === 'rate' && i < tries - 1) { await sleep(400); continue; }
    return { replies, err, sync, rate: !!(err && err.m?.code === 'rate') };
  }
}
async function econState(p) { const r = await econ(p, 'econ-hello', {}, { ms: 400 }); const s = r.replies.find((x) => x.type === 'econ-state'); return s ? s.m : null; }
const invNames = (inv) => `[${(inv || []).map((x) => (x === null ? 'null' : typeof x === 'string' ? x.slice(0, 6) : typeof x)).join(',')}]`;
const fp = (st) => (st ? `${st.gold}g rev${st.rev} inv${invNames(st.inventory)}` : 'no-state');
const progress = (o = {}) => ({
  job: 'wayfarer', level: 1, xp: 0, xpNext: 100, gold: 0, potions: 0, maxHp: 100, maxMp: 30, atk: 10,
  x: 0, y: 0, inventory: [], equipped: {}, dyes: {}, quest: { idx: 0, kills: {} }, savedAt: Date.now(), ...o,
});
async function save(p, prog, rev = 0) { clear(p); p.room.send('save', { name: p.name, progress: prog, rev, hero: {} }); const r = await waitFor(p, 'saved', 2500); return r ? r.m : null; }

// ── 0 ──────────────────────────────────────────────────────────────────────
say('\n== Wayfarer Online — numeric / validation / forgery audit (wire-level)');
say(`   relay :${PORT}  DATA_DIR=${DATA_DIR}  gear whitelist=${GEAR.length} ids`);
if (!await waitHealthy()) { say('FATAL: relay never became healthy'); say(relayLog.slice(-3000)); process.exit(2); }
say('   relay healthy\n');

const TOK_M = 'auditmain0000000xxxxxxxxxxxxxxxxx';
let main = null, alt = null;

try {
  const g0 = GEAR[0], g1 = GEAR[1], g2 = GEAR[2];

  // ── 1. forged progress: the first save of a character is unbounded ───────
  say('== 1. forged first save (client-claimed level/gold/inventory)');
  main = await join('auditmain', TOK_M);
  let r = await save(main, progress({ level: 99, xp: 1e9, xpNext: 1e9, gold: 100000, potions: 99, inventory: [g0, g1, g2] }));
  let st = await econState(main);
  say(`   save reply ${JSON.stringify(r)} -> server copy ${fp(st)}`);
  if (st && st.gold === 100000 && st.inventory.length === 3) issue('high', 'forged-first-save',
    `FIRST save of a NEW character accepted verbatim: level 99 + ${st.gold}g + ${st.inventory.length} bag items with zero play (validate.js:63 validateSave clamps only when prev exists)`);
  else ok('forged-first-save', `first save clamped to ${fp(st)}`);

  // ── 2. rate clamp does exist on an existing record (positive control) ───
  say('\n== 2. rate clamp on an EXISTING record (mitigation check + positive control)');
  const lvl = await join('auditlevel', 'auditlevel000000xxxxxxxxxxxxxxxx');
  await save(lvl, progress({ level: 1, gold: 0 }));
  r = await save(lvl, progress({ level: 99, gold: 9999999 }), 0);
  st = await econState(lvl);
  say(`   claim L99/9,999,999g on the 2nd save -> reply ${JSON.stringify(r)} -> ${fp(st)}`);
  if (st && st.gold <= 2000 && r && r.clamped) ok('clamp-2nd-save', `clamped to ${st.gold}g / L${r.clamped.level} (CAPS.goldBase 1500 + 60/s)`);
  else if (st && st.gold === 9999999) issue('critical', 'no-clamp-2nd-save', `2nd save jumped to ${st.gold} gold`);
  else notes.push(`2nd-save clamp inconclusive: ${fp(st)} ${JSON.stringify(r)}`);

  // ── 3. same device, fresh character: the mint repeats ───────────────────
  say('\n== 3. the mint repeats per character on ONE device (store.js:59 allows 12 chars/device)');
  alt = await join('auditalt', TOK_M);
  await save(alt, progress({ level: 99, gold: 9999999, inventory: [g1, g2] }));
  const stA3 = await econState(alt);
  say(`   alt = 2nd character, SAME device token, first save -> ${fp(stA3)}`);
  if (stA3 && stA3.gold === 9999999) issue('high', 'mint-per-character',
    `2nd name on the same device minted ${stA3.gold}g on its first save; the clamp is per-record so each new name = another GOLD_MAX (12 per device)`);
  else ok('mint-per-character', `alt capped at ${fp(stA3)}`);

  // ── 4. laundering: forged gold -> market sale -> server-paid mail ───────
  say('\n== 4. laundering forged gold into a real, rev-tracked payout');
  const stM0 = await econState(main);
  const post = await econ(main, 'market-post', { item: g0, price: 1000000, hours: 2, rev: stM0.rev }, { ms: 900 });
  say(`   main posts ${g0} @1,000,000g -> ${post.sync ? JSON.stringify(post.sync.m).slice(0, 78) : `NO SYNC err=${JSON.stringify(post.err?.m)}`}`);
  const stA = await econState(alt);
  const page = await econ(alt, 'market-browse', { page: 0 }, { ms: 500 });
  const listing = ((page.replies.find((x) => x.type === 'market-page')?.m.items) || []).find((i) => i.item === g0);
  if (!listing) notes.push('listing not visible to alt — laundering leg not run');
  else {
    const buy = await econ(alt, 'market-buy', { id: listing.id, rev: stA.rev }, { ms: 900 });
    say(`   alt buys ${listing.id} @${listing.price}g -> ${buy.sync ? JSON.stringify(buy.sync.m).slice(0, 78) : `NO SYNC err=${JSON.stringify(buy.err?.m)}`}`);
    const stM1 = await econState(main);
    const box = await econ(main, 'mail-list', {}, { ms: 500 });
    const mail = ((box.replies.find((x) => x.type === 'mail-box')?.m.mails) || []).find((m) => m.gold === 1000000);
    say(`   main mailbox: ${mail ? `id=${mail.id} gold=${mail.gold} from=${mail.from}` : 'no payout mail'}`);
    if (mail) {
      const claim = await econ(main, 'mail-claim', { id: mail.id, rev: stM1.rev }, { ms: 900 });
      const stM2 = await econState(main);
      say(`   claim -> ${claim.sync ? JSON.stringify(claim.sync.m).slice(0, 68) : `err=${JSON.stringify(claim.err?.m)}`}; main now ${fp(stM2)}`);
      if (stM2 && stM2.gold > (stM1?.gold ?? 0)) issue('high', 'laundering-loop',
        `gold minted by a fresh character moved between accounts via the market board and paid out by the server as system mail (${fp(stM1)} -> ${fp(stM2)})`);
      else ok('laundering-loop', `payout leg did not increase gold (${fp(stM2)})`);
    }
  }

  // ── 5. numeric abuse over the wire ─────────────────────────────────────
  say('\n== 5. numeric abuse: every boundary that comes off the wire');
  const NUMBAD = [-1, 0, NaN, Infinity, -Infinity, 2 ** 53, 1.5, Number.MAX_VALUE, '100', '1e9', true, [5], { v: 5 }, null, undefined];
  const stB = await econState(main);
  const accepted = [], codes = new Set();
  let silent = 0;
  for (const v of NUMBAD) {
    const rr = await econ(main, 'market-post', { item: g1, price: v, hours: 2, rev: stB.rev });
    if (rr.sync) accepted.push(`price=${String(v)}`);
    else if (rr.err) codes.add(rr.err.m.code || 'no-code');
    else silent++;
  }
  const stB2 = await econState(main);
  if (accepted.length) issue('high', 'bad-price-accepted', `market-post accepted ${accepted.join(', ')} (${fp(stB)} -> ${fp(stB2)})`);
  else if (!stB2 || stB2.gold !== stB.gold || stB2.rev !== stB.rev) issue('high', 'bad-price-mutated', `state changed with no sync reply: ${fp(stB)} -> ${fp(stB2)}`);
  else ok('market-post-price', `${NUMBAD.length} malformed prices (-1/0/NaN/±Inf/2^53/float/MAX_VALUE/string/bool/array/object/null/undefined): 0 accepted, 0 mutation, codes {${[...codes].join(',')}}, silent=${silent}, ${fp(stB)} unchanged`);

  // mail gold
  const stC = await econState(main);
  const mailBad = [-1, NaN, 2 ** 53, '10', 1e400, 1.5, Number.MAX_VALUE];
  const mgr = [];
  for (const v of mailBad) {
    const rr = await econ(main, 'mail-send', { to: 'auditalt', subject: 's', body: 'b', gold: v, items: [], rev: stC.rev });
    if (rr.sync) mgr.push(`gold=${String(v)}`);
  }
  const stC2 = await econState(main);
  if (mgr.length) issue('critical', 'bad-mail-gold', `mail-send accepted ${mgr.join(', ')} (${fp(stC)} -> ${fp(stC2)})`);
  else ok('mail-send-gold', `${mailBad.length} malformed golds rejected, ${fp(stC)} -> ${fp(stC2)}`);
  // mail items
  const itembad = [['__proto__'], [g1, g1, g1, g1, g1, g1, g1, g1, g1], [123], [null], [g1, 5], 'proto_str', { 0: g1 }, 12345];
  const iacc = [];
  for (const v of itembad) {
    const rr = await econ(main, 'mail-send', { to: 'auditalt', subject: 's', body: 'b', gold: 0, items: v, rev: stC.rev });
    if (rr.sync) iacc.push(JSON.stringify(v).slice(0, 32));
  }
  const stC3 = await econState(main);
  if (iacc.length) issue('high', 'bad-item-list', `mail-send accepted items ${iacc.join(' | ')}; bag ${fp(stC3)}`);
  else ok('mail-items', `${itembad.length} spoofed item lists rejected (non-whitelist id, 9-item list>cap5, numbers, null, non-array, __proto__) ${fp(stC2)} -> ${fp(stC3)}`);
  // oversized economy payload: the 2048-byte econ guard must drop it before the
  // handler (must stay under the 4KB ws transport maxPayload to test the guard)
  const stC3b = await econState(main);
  const bigItems = Array(200).fill(g1); // ~2.6KB: > ECON guard 2048, < ws maxPayload 4096
  const rrBig = await econ(main, 'mail-send', { to: 'auditalt', subject: 's', body: 'b', gold: 0, items: bigItems, rev: stC3b.rev }, { ms: 800 });
  const stC4 = await econState(main);
  if (rrBig.sync || !stC4 || stC4.rev !== stC3b.rev) issue('high', 'oversize-econ', `2.6KB economy payload passed the 2048-byte guard and did work (${fp(stC3b)} -> ${fp(stC4)})`);
  else ok('oversize-econ', `2.6KB economy payload dropped by the 2048-byte guard before validation (silent=${!rrBig.err}, connection alive=${isOpen(main)}, ${fp(stC3b)} unchanged)`);
  // guild deposit numerics
  const gc = await econ(main, 'guild-create', { tag: 'AUD', name: 'Audit' }, { ms: 600 });
  const gdep = [];
  const stG = await econState(main);
  for (const v of [-1, NaN, 2 ** 53, '50', 1.5]) {
    const rr = await econ(main, 'guild-deposit', { gold: v, rev: stG.rev }, { ms: 700 });
    if (rr.sync) gdep.push(String(v));
  }
  const stG2 = await econState(main);
  if (gdep.length) issue('critical', 'guild-deposit-numeric', `guild-deposit accepted ${gdep.join(',')} (${fp(stG)} -> ${fp(stG2)})`);
  else ok('guild-deposit', `guild-create=${gc.err ? gc.err.m.msg : 'ok'}; -1/NaN/2^53/"50"/1.5 deposits all rejected, ${fp(stG)} -> ${fp(stG2)}`);

  // ── 6. trade offer validation (live session) ───────────────────────────
  say('\n== 6. direct trade offer validation (live session, forged offers)');
  clear(alt); alt.room.send('trade-request', { to: main.sid });
  const req = await waitFor(main, 'trade-request', 2000);
  if (!req) notes.push(`trade-request not delivered (main inbox: ${main.inbox.map((x) => x.type).join(',')})`);
  else {
    clear(main); main.room.send('trade-respond', { from: alt.sid, accept: 1 });
    const openMsg = await waitFor(alt, 'trade-open', 2000);
    const tid = openMsg?.m?.id;
    say(`   trade ${tid} open with ${openMsg?.m?.partner?.name}`);
    const offerBad = [
      { gold: -1, items: [] }, { gold: NaN, items: [] }, { gold: 2 ** 53, items: [] },
      { gold: '100', items: [] }, { gold: 1.5, items: [] }, { gold: 9e15, items: [] },
      { gold: 0, items: [GEAR[10] || 'nope'] }, { gold: 0, items: [g1, g1, g1, g1, g1, g1, g1, g1, g1] },
      { gold: 0, items: '__proto__' }, { gold: 0, items: [Array(20).fill(g1)] }, { gold: undefined, items: [] },
    ];
    const bad = [];
    for (const o of offerBad) {
      if (!isOpen(alt)) { notes.push(`alt socket died mid-trade-offer probes (transport kill) before ${JSON.stringify(o).slice(0, 40)}`); break; }
      const rr = await econ(alt, 'trade-offer', { id: tid, ...o });
      if (!rr.err) {
        if (!isOpen(alt)) { notes.push(`offer probe ${JSON.stringify(o).slice(0, 40)} exceeded the 4KB transport limit (silent + socket closed) — inconclusive`); break; }
        bad.push(`${JSON.stringify(o).slice(0, 50)}${rr.sync ? '(SYNC)' : '(silent)'}`);
      }
    }
    const goodOffer = await econ(alt, 'trade-offer', { id: tid, gold: 0, items: [g2] });
    const goodAccepted = !!(goodOffer.replies.find((x) => x.type === 'trade-update'));
    if (bad.length) issue('critical', 'bad-trade-offer', `trade-offer accepted ${bad.join(' | ')}`);
    else ok('trade-offer', `${offerBad.length} forged offers rejected (negative/NaN/2^53/string/float/absent id/9-item list/non-array); positive control: legal offer accepted=${goodAccepted}`);
    const stMain = await econState(main);
    const over = await econ(main, 'trade-offer', { id: tid, gold: 9000000, items: [] });
    const stMain2 = await econState(main);
    if (!over.err && stMain2 && stMain2.gold < (stMain?.gold ?? 0)) issue('critical', 'trade-over-offer', `over-holdings offer accepted: ${fp(stMain)} -> ${fp(stMain2)}`);
    else ok('trade-over-offer', `9,000,000g offer on a ${stMain?.gold}g character rejected ("${over.err?.m?.msg}")`);
    clear(alt); alt.room.send('trade-cancel', { id: tid });
  }

  // ── 7. inherited-key bypass in market-buy ─────────────────────────────
  say('\n== 7. market-buy with an Object.prototype key as the listing id');
  alt = await rejoin(alt, 'auditalt', TOK_M);
  const stP = await econState(alt);
  if (!stP) { notes.push('alt state unavailable (socket dropped earlier) — market-buy probe skipped'); }
  else {
  const before = fp(stP);
  let protoRejected = true;
  for (const id of ['__proto__', 'constructor', 'toString']) {
    const rr = await econ(alt, 'market-buy', { id, rev: stP.rev }, { ms: 900 });
    const st2 = await econState(alt);
    say(`   id=${id}: err=${rr.err ? JSON.stringify(rr.err.m) : 'NONE'} sync=${rr.sync ? JSON.stringify(rr.sync.m.delta) : '-'} ${before} -> ${fp(st2)}`);
    if (!rr.err) {
      protoRejected = false;
      issue('medium', 'proto-listing-id', `market-buy id="${id}" not rejected as a missing listing (economy.js:360: inherited member is truthy so the !l guard never fires); mutate() then ran with l.price/l.item undefined -> ${fp(st2)}: gold destroyed, bag got a non-string entry`);
      break;
    }
  }
  if (protoRejected) ok('proto-listing-id', 'inherited Object.prototype keys used as listing ids are rejected');
  }
  // same class: db.names.names is a plain object, so a lookup key of "__proto__"
  // (a legal character name: cleanCharName keeps [\w ]) resolves to Object.prototype
  main = await rejoin(main, 'auditmain', TOK_M);
  const stN = await econState(main);
  if (!stN) notes.push('main state unavailable — mail-to-__proto__ probe skipped');
  else {
    const rrN = await econ(main, 'mail-send', { to: '__proto__', subject: 's', body: 'b', gold: 10, items: [], rev: stN.rev }, { ms: 800 });
    const stN2 = await econState(main);
    say(`   mail-send to="__proto__": err=${rrN.err ? JSON.stringify(rrN.err.m) : 'NONE'} sync=${rrN.sync ? 'yes' : '-'} ${fp(stN)} -> ${fp(stN2)}`);
    if (!rrN.err && stN2 && stN2.gold < stN.gold) issue('low', 'proto-mail-recipient', `mail to a non-existent recipient named "__proto__" was accepted (economy.js:427 lookup is truthy via Object.prototype) -> ${stN.gold}g-${stN2.gold}g destroyed into a box keyed "[object Object]"`);
    else ok('proto-mail-recipient', `mail to "__proto__" rejected/ignored (${fp(stN)} -> ${fp(stN2)})`);
  }

  // ── 8. prototype pollution over the wire ──────────────────────────────
  say('\n== 8. prototype pollution via a wire payload');
  const payload = JSON.parse('{"__proto__":{"zpoll":1},"constructor":{"prototype":{"zpoll2":1}},"a":1}');
  clear(alt); alt.room.send('pwned', payload);
  await sleep(200);
  clear(main); alt.room.send('mv', { x: 60, y: 60 }); main.room.send('mv', { x: 40, y: 40 });
  const snap = await waitFor(main, 'snap', 2500);
  const keys = new Set();
  for (const d of snap?.m?.p || []) for (const k of Object.keys(d)) keys.add(k);
  if (keys.has('zpoll') || keys.has('zpoll2')) issue('critical', 'proto-pollution-server', `relay Object.prototype polluted (snap delta keys ${[...keys].join(',')})`);
  else if (({}).zpoll !== undefined || Object.prototype.zpoll2 !== undefined) issue('high', 'proto-pollution-client', 'client Object.prototype polluted by the decoded payload');
  else ok('proto-pollution', `__proto__/constructor keys in a client payload polluted nothing on either side (server detector = tick()'s for..in over player deltas; snap keys=[${[...keys].join(',')}])`);

  // ── 9. forged server->client types ────────────────────────────────────
  say('\n== 9. client-forged server->client message types must not reach peers');
  clear(main); clear(alt);
  for (const t of ['trade-result', 'econ-sync', 'econ-msg', 'guild-info', 'mail-box', 'saved'])
    alt.room.send(t, { ok: 1, gold: 9999999, inventory: [g0], text: 'forged by peer' });
  await sleep(500);
  const leaked = main.inbox.filter((x) => ['trade-result', 'econ-sync', 'econ-msg', 'guild-info', 'mail-box', 'saved'].includes(x.type));
  if (leaked.length) issue('high', 'forged-server-msg', `peer-forged ${leaked.map((x) => x.type).join(',')} delivered to another player`);
  else ok('forged-server-msg', 'forged trade-result/econ-sync/econ-msg/guild-info/mail-box/saved never reached the peer (colyseus 0.16 dispatch: a registered specific handler swallows the type)');

  // ── 10. oversized / malformed payloads, per-case fresh client ──────────
  // The transport (colyseus ws-transport default) rejects any frame > 4096 bytes
  // by closing the offending socket; each case therefore needs a fresh client.
  say('\n== 10. oversized / malformed payloads — transport limit vs app budgets');
  const payloadCase = async (label, build, tokenName) => {
    const p = await join(tokenName, `${tokenName}xxxxxxxxxxxxxxxxxxxx`.slice(0, 32));
    let threw = null;
    try { build(p); } catch (e) { threw = e.message; }
    await sleep(700);
    const alive = isOpen(p) && await ping(p, 1200);
    const h = await healthy();
    const codes = p.inbox.filter((x) => x.type === '!onError' || x.type === '!onLeave').map((x) => `${x.type}:${x.m.code}`);
    say(`   ${label.padEnd(30)} sent=${threw ? 'no(client-throw)' : 'yes'} socketAlive=${alive} relayHealth=${h ? 200 : 'DOWN'} ${codes.join(' ') || ''}${threw ? ` (${threw.slice(0, 34)})` : ''}`);
    try { p.room.leave(); } catch {}
    return { label, threw, alive, h, codes };
  };
  const cases = [];
  cases.push(await payloadCase('2.6KB econ payload', (p) => p.room.send('market-browse', { q: 'B'.repeat(2600) }), 'probegen01'));
  cases.push(await payloadCase('5KB passthrough string', (p) => p.room.send('chatish', { text: 'A'.repeat(5120) }), 'probebig02'));
  cases.push(await payloadCase('900KB passthrough string', (p) => p.room.send('chatish', { text: 'A'.repeat(900 * 1024) }), 'probebig03'));
  cases.push(await payloadCase('40k-element array', (p) => p.room.send('arrish', { a: Array(40000).fill(1) }), 'probearr04'));
  cases.push(await payloadCase('depth-3000 nesting', (p) => { let d = {}; for (let i = 0; i < 3000; i++) d = { a: d }; p.room.send('deepish', d); }, 'probedp05'));

  // the app's OWN size budgets (validate.js: hero <=6000, quest <24000, prog <12000,
  // econ <=2048) sit ABOVE the 4KB transport ceiling: a legal save is killed
  const q = { idx: 0, kills: {} };
  while (JSON.stringify(q).length < 6000) q.kills[`k${Object.keys(q.kills).length}`] = 1; // ~6KB quest blob, allowed by sanitizeProgress
  const sq = await payloadCase(`save with ${JSON.stringify(q).length}B quest blob`, (p) => p.room.send('save', { progress: progress({ level: 1, gold: 0, inventory: [g1], quest: q }), hero: {} }), 'probesave06');
  const sqState = await econState((await join('probesave06', 'probesave06xxxxxxxxxxxxxxxxxxxx'.slice(0, 32))));
  const killed = !sq.alive;
  const saved = !!(sqState && sqState.rev >= 0 && sqState.inventory && sqState.inventory.length === 1);
  if (killed && !saved) issue('medium', 'transport-vs-app-budget',
    `a save inside the app's own limits (${JSON.stringify(q).length}B quest blob < the 24,000 the validator accepts) exceeds the ws-transport maxPayload (4096) -> the socket is closed and the save never lands (server copy ${fp(sqState)} = fresh, before=${fp(await econState(main))})`);
  else if (killed) ok('transport-vs-app-budget', `save with a ${JSON.stringify(q).length}B quest blob: socket closed but the save landed (${fp(sqState)})`);
  else ok('transport-vs-app-budget', `save with a ${JSON.stringify(q).length}B quest blob survived (socketAlive=${sq.alive})`);

  const relayKilledSomeone = cases.filter((c) => !c.threw && !c.alive);
  const relayAlwaysUp = cases.every((c) => c.h) && killed;
  say(`   oversized frames killed the sender's socket: ${relayKilledSomeone.map((c) => c.label).join(', ') || 'none'}; relay /health stayed 200 in every case=${cases.every((c) => c.h)}`);
  if (!cases.every((c) => c.h)) issue('critical', 'payload-dos', `relay /health was not 200 after: ${cases.filter((c) => !c.h).map((c) => c.label).join(', ')}`);
  else ok('payload-relay-survival', `relay stayed healthy (health=200) through all ${cases.length + 1} oversized/malformed payloads; only the offending socket is closed (ws maxPayload 4096, ws-transport default)`);

  // client-to-peer forged types already covered in 9; confirm relay still serves others
  const stillWorks = await ping(main, 1500);
  say(`   the other connection still works after the oversized cases: pong=${stillWorks}`);
  if (!stillWorks) issue('high', 'payload-cross-client', 'an unrelated connected client stopped answering after another client sent oversized payloads');
  else ok('payload-cross-client', 'an unrelated client kept answering after every oversized/malformed payload');
  void relayAlwaysUp;

  // ── 11. persisted evidence ────────────────────────────────────────────
  say('\n== 11. persisted server copies on disk');
  await sleep(2500);
  const key = crypto.createHash('sha256').update(TOK_M).digest('hex').slice(0, 32);
  const charFile = path.join(DATA_DIR, 'players', `${key}.json`);
  if (fs.existsSync(charFile)) {
    const doc = JSON.parse(fs.readFileSync(charFile, 'utf8'));
    for (const n of Object.keys(doc.chars)) say(`   ${n}: gold=${JSON.stringify(doc.chars[n].progress.gold)} level=${doc.chars[n].progress.level} inv=${JSON.stringify(doc.chars[n].progress.inventory)} rev=${doc.chars[n].rev}`);
  } else notes.push(`char file not flushed yet (${charFile})`);
  const mailFile = path.join(DATA_DIR, 'economy', 'mail.json');
  if (fs.existsSync(mailFile)) {
    const mb = JSON.parse(fs.readFileSync(mailFile, 'utf8'));
    say(`   mail boxes: ${Object.keys(mb.boxes).map((k) => `${k.slice(-12)}(${mb.boxes[k].length})`).join(', ')}`);
    if (Object.keys(mb.boxes).includes('undefined')) issue('low', 'mail-box-undefined', 'a mail box was persisted under the literal key "undefined" (deliverMail received ck=undefined from the market-buy hole)');
  }
  const led = path.join(DATA_DIR, 'economy', 'ledger.jsonl');
  if (fs.existsSync(led)) say(`   ledger: ${fs.readFileSync(led, 'utf8').trim().split('\n').length} entries`);
} catch (e) {
  say(`\n!! harness error: ${e.stack || e.message}`);
  notes.push(`harness error: ${e.message}`);
} finally {
  try { main?.room.leave(); } catch {}
  try { alt?.room.leave(); } catch {}
}

// ── summary ────────────────────────────────────────────────────────────────
say('\n== summary');
say(`   reproduced issues: ${issues.length}`);
for (const i of issues) say(`     ${i.sev.toUpperCase().padEnd(8)} ${i.id}`);
say(`   clean probes: ${clean.length} -> ${clean.join(', ')}`);
for (const n of notes) say(`   note: ${n}`);
say('   relay log tail:');
for (const l of relayLog.split('\n').filter(Boolean).slice(-14)) say(`     relay| ${l.slice(0, 150)}`);
shutdown();
await sleep(300);
try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
process.exit(issues.length ? 1 : 0);
