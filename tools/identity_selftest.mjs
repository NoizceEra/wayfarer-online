// tools/identity_selftest.mjs — acceptance test for the identity feature.
//   node tools/identity_selftest.mjs
//
// Runs ENTIRELY against a throwaway temp DATA_DIR (never the repo's data dir)
// and a random loopback port (bind 0) so it cannot collide with the running
// relay (2567) or the dev server (5176). Prints PASS/FAIL per check and exits
// non-zero if any check fails.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wayfarer-identity-selftest-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LOG_LEVEL = 'error';

const results = [];
let failed = 0;
function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failed++;
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`;
  results.push(line);
  console.log(line);
  return ok;
}

// Client-shaped recovery code (same alphabet/grouping as src/net/identity.js):
// unambiguous 31-symbol alphabet, 5 groups of 4, rejection sampling.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => {
  let body = '';
  while (body.length < 20) {
    for (const b of crypto.randomBytes(32)) { if (b >= 248) continue; body += ALPHABET[b % ALPHABET.length]; if (body.length === 20) break; }
  }
  return body.match(/.{1,4}/g).join('-');
};

// Base58 (no 0/O/I/l) — a valid Solana-shaped address, 44 and 32 chars.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sol44 = Array.from(crypto.randomBytes(44), (b) => B58[b % 58]).join('');
const sol32 = '11111111111111111111111111111111';   // canonical system program id
if (!/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(sol44)) throw new Error('selftest: base58 generator is broken');

// A REAL Ed25519 keypair whose public key encodes to a Solana-shaped address, so the
// wallet path is exercised with an actual signature rather than a random string.
function b58encode(buf) {
  let num = 0n; for (const b of buf) num = num * 256n + BigInt(b);
  let out = ''; while (num > 0n) { out = B58[Number(num % 58n)] + out; num /= 58n; }
  let zeros = 0; for (const b of buf) { if (b === 0) zeros++; else break; }
  return '1'.repeat(zeros) + out;
}
const walletKeys = crypto.generateKeyPairSync('ed25519');
const walletAddr = b58encode(walletKeys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
const signMessage = (msg) => crypto.sign(null, Buffer.from(msg, 'utf8'), walletKeys.privateKey).toString('base64');

// Imports AFTER DATA_DIR is set: server/config.js reads it at import time.
const store = await import('../server/store.js');
const identity = await import('../server/identity.js');

const playersDir = path.join(DATA_DIR, 'players');
const aliasesDir = path.join(DATA_DIR, 'aliases');
const linksDir = path.join(DATA_DIR, 'links');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);

store.initStore();

// ─── throwaway relay on a random port ────────────────────────────────────────
// Raised burst so this test can drive ~25 requests from one IP; the relay itself
// uses the defaults (check G proves the default limit is live).
const app = identity.createApp({ rate: { burst: 100 } });
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`# temp DATA_DIR: ${DATA_DIR}\n# identity app  : ${base}\n`);

async function post(p, body) {
  const res = await fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, data, text };
}
async function get(p) {
  const res = await fetch(`${base}${p}`);
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, data, text };
}

// ─── 1. save/load round-trip (anonymous path, unchanged) ─────────────────────
const t1 = crypto.randomBytes(18).toString('base64url');
const rec = { name: 'Hero', hero: 'pixel-wanderer', progress: { x: 104, y: 208, level: 7, mats: { wood: 3 } }, savedAt: 1712345678901 };
check('1. saveChar(t1) then loadChar(t1) returns the same record',
  store.saveChar(t1, 'Hero', rec) && JSON.stringify(store.loadChar(t1, 'Hero')) === JSON.stringify(rec),
  `t1 hash ${sha(t1).slice(0, 8)}…`);

// ─── 2. link a recovery code X to t1 ─────────────────────────────────────────
const code = newCode();
const link1 = await post('/identity/link', { token: t1, kind: 'recovery', id: code });
const linkKeys = link1.data?.links?.[0] ? Object.keys(link1.data.links[0]).sort().join(',') : '(none)';
check('2. POST /identity/link binds recovery code X to t1',
  link1.status === 200 && link1.data?.ok === true && link1.data.links.length === 1 && link1.data.links[0].kind === 'recovery',
  `status ${link1.status}`);
check('2b. link response exposes only {kind, addedAt, verified} (no id/idHash echoed)',
  linkKeys === 'addedAt,kind,verified' && !/id/i.test(linkKeys), linkKeys);

// ─── 3. continue with X mints a NEW token ────────────────────────────────────
const cont = await post('/identity/continue', { kind: 'recovery', id: code });
const t2 = cont.data?.token;
check('3. POST /identity/continue returns a NEW token (t2 !== t1, valid shape)',
  cont.status === 200 && cont.data?.ok === true && typeof t2 === 'string' && t2 !== t1 && store.TOKEN_RE.test(t2),
  `status ${cont.status}`);
check('3b. continue response is exactly {ok, token} and never echoes t1',
  Object.keys(cont.data || {}).sort().join(',') === 'ok,token' && !cont.text.includes(t1), `keys ${Object.keys(cont.data || {}).sort().join(',')}`);

// ─── 4. the whole point: the same character comes back ──────────────────────
check('4. loadChar(t2,"Hero") returns THE SAME character (progress preserved)',
  JSON.stringify(store.loadChar(t2, 'Hero')) === JSON.stringify(rec));

// ─── 5. writes through either token hit the same underlying doc ─────────────
const rec2 = { ...rec, progress: { ...rec.progress, level: 9 }, savedAt: 1712345679999 };
store.saveChar(t2, 'Hero', rec2);
check('5. a save written with t2 is visible when read with t1',
  JSON.stringify(store.loadChar(t1, 'Hero')) === JSON.stringify(rec2));

// ─── 6. backward compatibility: a legacy doc (chars only) ───────────────────
const legacyToken = crypto.randomBytes(18).toString('base64url');
const legacyFile = path.join(playersDir, `${sha(legacyToken)}.json`);
fs.writeFileSync(legacyFile, JSON.stringify({ chars: { legacy: { name: 'Legacy', savedAt: 1, progress: { x: 1, y: 2 } } } }));
const legacyLoaded = store.loadChar(legacyToken, 'Legacy');
const legacySaved = store.saveChar(legacyToken, 'Second', { name: 'Second', savedAt: 2, progress: { x: 3, y: 4 } });
await store.flushAll();
const legacyOnDisk = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
check('6. a hand-written legacy doc (chars only, no links) loads and saves unchanged',
  !!legacyLoaded && legacyLoaded.name === 'Legacy' && legacySaved === true
  && !!legacyOnDisk.chars.legacy && !!legacyOnDisk.chars.second && !('links' in legacyOnDisk),
  `keys ${Object.keys(legacyOnDisk).join(',')}`);
check('6b. no alias file was created for a legacy token (key === token hash)',
  !fs.existsSync(path.join(aliasesDir, `${sha(legacyToken)}.json`)) && fs.existsSync(legacyFile));

// ─── 7. credential hygiene: no raw secret anywhere under DATA_DIR ───────────
await store.flushAll();
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => { const p = path.join(dir, e.name); return e.isDirectory() ? walk(p) : [p]; });
const files = walk(DATA_DIR);
const hits = [];
for (const needle of [code, code.replace(/-/g, ''), t1, t2]) {
  for (const f of files) {
    const rel = path.relative(DATA_DIR, f);
    if (rel.includes(needle)) hits.push(`${rel} (filename)`);
    const txt = fs.readFileSync(f, 'utf8');
    if (txt.includes(needle)) hits.push(`${rel} (content)`);
  }
}
check('7. raw recovery code + BOTH raw tokens appear nowhere under DATA_DIR',
  hits.length === 0, hits.length ? hits.slice(0, 3).join('; ') : `${files.length} files scanned`);

// Positive controls: the hashes that SHOULD be on disk are on disk.
const aliasFile = path.join(aliasesDir, `${sha(t2)}.json`);
const aliasJson = fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, 'utf8')) : null;
const linkFile = files.find((f) => f.startsWith(linksDir) && f.endsWith('.json'));
const linkJson = linkFile ? JSON.parse(fs.readFileSync(linkFile, 'utf8')) : null;
check('7b. only hashes are stored: alias file for sha256(t2) -> t1 doc key, link index -> {primaryKey, kind, idHash}',
  aliasJson?.primaryKey === sha(t1) && linkJson?.primaryKey === sha(t1) && linkJson?.kind === 'recovery'
  && linkJson?.idHash === crypto.createHash('sha256').update(`recovery:${code.replace(/-/g, '')}`).digest('hex').slice(0, 32)
  && !JSON.stringify(linkJson).includes(code.replace(/-/g, '')),
  `alias ${path.basename(aliasFile)}`);

// ─── extra A: unknown code fails cleanly ────────────────────────────────────
const unknown = await post('/identity/continue', { kind: 'recovery', id: newCode() });
check('A. /identity/continue with an UNKNOWN code fails cleanly (404, no token)',
  unknown.status === 404 && unknown.data?.ok === false && !('token' in (unknown.data || {})),
  `${unknown.status} ${unknown.data?.error}`);

// ─── extra B: a code bound elsewhere is never stolen ────────────────────────
const t3 = crypto.randomBytes(18).toString('base64url');
const steal = await post('/identity/link', { token: t3, kind: 'recovery', id: code });
const t3status = await get(`/identity/status?token=${encodeURIComponent(t3)}`);
check('B. /identity/link refuses a code already bound to another account (409)',
  steal.status === 409 && steal.data?.ok === false && steal.data?.error === 'link_taken',
  `${steal.status} ${steal.data?.error}`);
check('B2. the refused link wrote nothing to the second account',
  t3status.data?.links?.length === 0 && store.loadChar(t3, 'Hero') === null);

// ─── status + idempotency ───────────────────────────────────────────────────
const st1 = await get(`/identity/status?token=${encodeURIComponent(t1)}`);
const st2 = await get(`/identity/status?token=${encodeURIComponent(t2)}`);
check('C. /identity/status reports the link + character names for BOTH tokens',
  st1.data?.ok === true && st1.data.links.length === 1 && st1.data.chars.join(',') === 'Hero'
  && st2.data?.ok === true && st2.data.links.length === 1 && st2.data.chars.join(',') === 'Hero');
const again = await post('/identity/link', { token: t1, kind: 'recovery', id: code });
const st1b = await get(`/identity/status?token=${encodeURIComponent(t1)}`);
check('D. linking the same (kind,id) twice is idempotent (no duplicate entry)',
  again.status === 200 && again.data?.ok === true && st1b.data?.links?.length === 1);

// ─── shape validation ───────────────────────────────────────────────────────
const badToken = await post('/identity/link', { token: 'short', kind: 'recovery', id: code });
const badKind = await post('/identity/link', { token: t1, kind: 'email', id: code });
const badCode = await post('/identity/link', { token: t1, kind: 'recovery', id: 'too-short' });
const badSol = await post('/identity/link', { token: t1, kind: 'solana', id: '0OIl-not-base58' });
check('E. shape validation rejects bad token / bad kind / short code / invalid solana address',
  badToken.status === 400 && badKind.status === 400 && badCode.status === 400 && badSol.status === 400,
  [badToken.data?.error, badKind.data?.error, badCode.data?.error, badSol.data?.error].join(','));
// ─── F. wallet linking REQUIRES proof of key control ────────────────────────
// A wallet address is PUBLIC (it is on-chain), so linking one is an authentication
// step and must carry a signature over a challenge the relay issued. This suite
// previously asserted the opposite — that an unsigned address link returns 200 —
// which WAS the account-takeover hole. The expectation is deliberately inverted.
const unsigned = await post('/identity/link', { token: t1, kind: 'solana', id: walletAddr });
check('F1. an UNSIGNED wallet link is refused',
  unsigned.status === 401 && unsigned.data?.error === 'wallet_signature_required',
  `${unsigned.status} ${unsigned.data?.error}`);
const forged = await post('/identity/link', {
  token: t1, kind: 'solana', id: walletAddr, message: 'anything', signature: signMessage('anything'),
});
check('F2. a signature over a message we did not issue is refused',
  forged.status === 401 && forged.data?.error === 'wallet_not_proven', `${forged.status} ${forged.data?.error}`);
const chal = await post('/identity/wallet-challenge', { wallet: walletAddr });
check('F3. the relay issues a challenge naming the wallet',
  chal.status === 200 && typeof chal.data?.message === 'string' && chal.data.message.includes(walletAddr));
const chalBad = await post('/identity/wallet-challenge', { wallet: '0OIl-not-base58' });
check('F3b. a malformed address gets no challenge', chalBad.status === 400);
const signed = await post('/identity/link', {
  token: t1, kind: 'solana', id: walletAddr, message: chal.data.message, signature: signMessage(chal.data.message),
});
check('F4. a SIGNED wallet link succeeds and is marked verified',
  signed.status === 200 && signed.data?.ok === true
  && signed.data.links.some((l) => l.kind === 'solana' && l.verified === true),
  JSON.stringify(signed.data));
const replay = await post('/identity/link', {
  token: t1, kind: 'solana', id: walletAddr, message: chal.data.message, signature: signMessage(chal.data.message),
});
check('F5. the challenge is single-use (replaying the signature is refused)', replay.status === 401, `${replay.status}`);

// ─── F6. a LEGACY unverified wallet link cannot mint a credential ────────────
// Written exactly as the pre-fix server wrote it (no `verified` field), to prove the
// fail-closed rule for link records that already exist on disk.
const legacyHash = crypto.createHash('sha256').update(`solana:${sol44}`).digest('hex').slice(0, 32);
fs.mkdirSync(path.join(DATA_DIR, 'links'), { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, 'links', `${legacyHash}.json`),
  JSON.stringify({ primaryKey: store.deviceKey(t1), kind: 'solana', idHash: legacyHash, addedAt: Date.now() }));
const legacyTakeover = await post('/identity/continue', { kind: 'solana', id: sol44 });
check('F6. an unverified (legacy) wallet link is REFUSED as a credential',
  legacyTakeover.status === 403 && legacyTakeover.data?.error === 'wallet_not_verified',
  `${legacyTakeover.status} ${legacyTakeover.data?.error}`);

// ─── 7c. wallet addresses are hashed-only on disk too ───────────────────────
const files2 = walk(DATA_DIR);
const walletHits = [];
for (const needle of [sol44, sol32]) {
  for (const f of files2) {
    const rel = path.relative(DATA_DIR, f);
    if (rel.includes(needle) || fs.readFileSync(f, 'utf8').includes(needle)) walletHits.push(rel);
  }
}
check('7c. raw wallet addresses appear nowhere under DATA_DIR either',
  walletHits.length === 0, walletHits.length ? walletHits.join('; ') : `${files2.length} files scanned`);

// ─── G. the default rate limit is live (production settings) ────────────────
const app2 = identity.createApp();                 // production defaults, own bucket map
const server2 = app2.listen(0, '127.0.0.1');
await new Promise((r) => server2.once('listening', r));
const base2 = `http://127.0.0.1:${server2.address().port}`;
const codes = [];
for (let i = 0; i < 14; i++) {
  const r = await fetch(`${base2}/identity/status?token=${encodeURIComponent(t1)}`);
  codes.push(r.status);
  await r.text();
}
await new Promise((r) => server2.close(r));
check('G. default limits throttled an over-burst run (429 after the burst)',
  codes.filter((c) => c === 200).length === 10 && codes[codes.length - 1] === 429, `codes ${codes.join(',')}`);

// ─── H. the alias resolves in a FRESH PROCESS (a real "other device") ───────
// The checks above run in one process, so they could pass off the in-memory
// cache. This spawns a brand-new node process with an empty cache and asks it
// to load the character through the recovered token only.
const probePath = path.join(os.tmpdir(), `wf-identity-probe-${process.pid}.mjs`);
fs.writeFileSync(probePath, `
const store = await import(process.env.STORE_URL);
const t = process.env.PROBE_TOKEN;
const r = store.loadChar(t, 'Hero');
console.log(JSON.stringify({
  hit: !!r, x: r && r.progress ? r.progress.x : null,
  docKey: store.docKeyFor(t),
  aliasTarget: store.aliasFor(store.deviceKey(t)),
}));
`);
const probe = JSON.parse(execFileSync(process.execPath, [probePath], {
  encoding: 'utf8',
  env: {
    ...process.env, DATA_DIR, LOG_LEVEL: 'error',
    STORE_URL: new URL('../server/store.js', import.meta.url).href,
    PROBE_TOKEN: t2,
  },
}));
fs.unlinkSync(probePath);
check('H. a FRESH process (empty cache) resolves the new token to the same doc via the on-disk alias',
  probe.hit === true && probe.x === rec2.progress.x && probe.docKey === sha(t1) && probe.aliasTarget === sha(t1),
  `char x=${probe.x} docKey ${String(probe.docKey).slice(0, 8)}… alias -> ${String(probe.aliasTarget).slice(0, 8)}…`);

// ─── teardown ───────────────────────────────────────────────────────────────
await new Promise((r) => server.close(r));
await store.flushAll();
store.stopStore();

console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(failed ? `RESULT: FAIL (${failed} failed)` : 'RESULT: PASS');
console.log(`temp data dir kept for inspection: ${DATA_DIR}`);
process.exit(failed ? 1 : 0);
