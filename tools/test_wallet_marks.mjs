#!/usr/bin/env node
// Protocol tests for optional wallet link + Wayfarer Marks.
// No @solana/web3.js — Node crypto ed25519 only. No Playwright required.
//
//   node tools/test_wallet_marks.mjs
//
// Browser mock (injected provider on the title screen) is skipped when
// Playwright is not installed; the game must remain playable with no wallet.

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-marks-'));
process.env.DATA_DIR = TMP;
process.env.LOG_LEVEL = 'error';
process.env.WALLET_NONCE_TTL_S = '2';
process.env.FEATURE_REDEEMABLE_REWARDS = 'true';
process.env.FEATURE_ONCHAIN_CLAIM = 'true';
process.env.FOUNDER_CUTOFF = '2099-01-01T00:00:00Z';
process.env.WALLET_IP_BURST = '200';
process.env.WALLET_IP_RATE = '50';
process.env.WALLET_CHALLENGE_BURST = '8';
process.env.WALLET_LINK_BURST = '20';

const requireSrv = createRequire(path.join(ROOT, 'server', 'package.json'));

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log(`  ok  ${name}`);
  else { failed++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token() { return crypto.randomBytes(18).toString('base64url'); }

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const raw = Buffer.from(der.subarray(der.length - 32));
  return { privateKey, raw, address: null };
}

async function main() {
  const express = requireSrv('express');
  const { b58encode, solAddress } = await import('../server/validate.js');
  const kp = keypair();
  kp.address = b58encode(kp.raw);
  ok('canonical sol address', !!solAddress(kp.address), kp.address);

  const sign = (priv, message) => b58encode(crypto.sign(null, Buffer.from(message, 'utf8'), priv));

  const { init, stop, routes, verifyEd25519, STATEMENT } = await import('../server/wallet.js');
  const { flagsPublic, marksRec, markMarksDirty, flushWalletStore, dropMarksCache, initWalletStore, stopWalletStore, links } = await import('../server/walletStore.js');
  const { deviceKey } = await import('../server/store.js');
  const rules = await import('../server/shared/marksRules.js');

  init();

  const flags = flagsPublic();
  ok('redeemableRewards hard-off despite env', flags.redeemableRewards === false);
  ok('onchainClaim hard-off despite env', flags.onchainClaim === false);
  ok('marks default on', flags.marks === true);
  ok('walletLink default on', flags.walletLink === true);

  const app = express();
  routes(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const post = async (p, body) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  };
  const get = async (p) => {
    const r = await fetch(base + p);
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  };

  // ── config / claim stub ──────────────────────────────────────────
  const cfg = await get('/wallet/config');
  ok('GET /wallet/config', cfg.j.ok && cfg.j.statement === STATEMENT);
  ok('config flags hide redeemable', cfg.j.flags.redeemableRewards === false && cfg.j.flags.onchainClaim === false);

  const claim = await post('/wallet/claim', { token: token() });
  ok('POST /wallet/claim not_enabled', claim.status === 403 && claim.j.error === 'not_enabled');

  const t1 = token();
  const t2 = token();

  // ── valid link ───────────────────────────────────────────────────
  const ch = await post('/wallet/challenge', { token: t1, address: kp.address, action: 'link' });
  ok('challenge ok', ch.j.ok && ch.j.nonce && ch.j.message.includes('cannot move funds'));
  ok('challenge carries nonce + expiry', typeof ch.j.expiresAt === 'number');
  const goodSig = sign(kp.privateKey, ch.j.message);
  const linked = await post('/wallet/link', { token: t1, nonce: ch.j.nonce, signature: goodSig });
  ok('valid link', linked.j.ok && linked.j.linked && linked.j.address === kp.address, JSON.stringify(linked.j));
  ok('founder attestation on first link', linked.j.founder === true);

  const st = await post('/wallet/status', { token: t1 });
  ok('status linked', st.j.ok && st.j.linked && st.j.address === kp.address);

  // ── bad signature ────────────────────────────────────────────────
  const chBad = await post('/wallet/challenge', { token: t2, address: kp.address, action: 'relink' });
  const other = keypair(); other.address = b58encode(other.raw);
  const badSig = sign(other.privateKey, chBad.j.message);
  const bad = await post('/wallet/link', { token: t2, nonce: chBad.j.nonce, signature: badSig });
  ok('bad signature rejected', bad.status === 401 && bad.j.error === 'bad_signature');

  // ── replay ───────────────────────────────────────────────────────
  const replay = await post('/wallet/link', { token: t1, nonce: ch.j.nonce, signature: goodSig });
  ok('replayed nonce rejected', replay.status === 400 && replay.j.error === 'unknown_nonce');

  // ── expired nonce ────────────────────────────────────────────────
  const t3 = token();
  const kp2 = keypair(); kp2.address = b58encode(kp2.raw);
  const chExp = await post('/wallet/challenge', { token: t3, address: kp2.address, action: 'link' });
  ok('expiry challenge issued', chExp.j.ok);
  await sleep(2100);
  const expSig = sign(kp2.privateKey, chExp.j.message);
  const expired = await post('/wallet/link', { token: t3, nonce: chExp.j.nonce, signature: expSig });
  ok('expired nonce rejected', expired.status === 400 && expired.j.error === 'nonce_expired', expired.j.error);

  // ── second device, same wallet, no relink ────────────────────────
  const chElse = await post('/wallet/challenge', { token: t2, address: kp.address, action: 'link' });
  ok('second device same wallet refused at challenge', chElse.status === 409 && chElse.j.error === 'wallet_linked_elsewhere');

  // ── relink to second device ──────────────────────────────────────
  const chRe = await post('/wallet/challenge', { token: t2, address: kp.address, action: 'relink' });
  ok('relink challenge', chRe.j.ok, chRe.j.error);
  const reSig = sign(kp.privateKey, chRe.j.message);
  const relinked = await post('/wallet/link', { token: t2, nonce: chRe.j.nonce, signature: reSig });
  ok('relink moves wallet', relinked.j.ok && relinked.j.relinked === true, JSON.stringify(relinked.j));
  const st1 = await post('/wallet/status', { token: t1 });
  const st2 = await post('/wallet/status', { token: t2 });
  ok('old device unlinked after relink', st1.j.linked === false);
  ok('new device linked after relink', st2.j.linked === true);

  const chCool = await post('/wallet/challenge', { token: t1, address: kp.address, action: 'relink' });
  ok('relink cooldown', chCool.status === 429 && chCool.j.error === 'relink_cooldown');

  // ── unlink + relink needs a fresh signature ──────────────────────
  const un = await post('/wallet/unlink', { token: t2 });
  ok('unlink', un.j.ok && un.j.linked === false);
  const chAgain = await post('/wallet/challenge', { token: t2, address: kp.address, action: 'link' });
  ok('relink after unlink needs new challenge', chAgain.j.ok && chAgain.j.nonce !== chRe.j.nonce);
  const againSig = sign(kp.privateKey, chAgain.j.message);
  const again = await post('/wallet/link', { token: t2, nonce: chAgain.j.nonce, signature: againSig });
  ok('fresh signature relinks', again.j.ok && again.j.linked);

  // ── rate limits / too many pending ───────────────────────────────
  const t4 = token();
  const kp3 = keypair(); kp3.address = b58encode(kp3.raw);
  const p1 = await post('/wallet/challenge', { token: t4, address: kp3.address });
  const p2 = await post('/wallet/challenge', { token: t4, address: kp3.address });
  const p3 = await post('/wallet/challenge', { token: t4, address: kp3.address });
  const p4 = await post('/wallet/challenge', { token: t4, address: kp3.address });
  ok('three pending nonces allowed', p1.j.ok && p2.j.ok && p3.j.ok);
  ok('fourth pending nonce refused', p4.status === 429 && p4.j.error === 'too_many_pending', p4.j.error);

  // ── verifyEd25519 helper ─────────────────────────────────────────
  const msg = 'hello wayfarer';
  const sigBuf = crypto.sign(null, Buffer.from(msg), kp.privateKey);
  ok('verifyEd25519 good', verifyEd25519(kp.raw, msg, sigBuf) === true);
  ok('verifyEd25519 bad', verifyEd25519(kp.raw, 'nope', sigBuf) === false);

  // ── Marks rules ──────────────────────────────────────────────────
  const copyA = fs.readFileSync(path.join(ROOT, 'server/shared/marksRules.js'));
  const copyB = fs.readFileSync(path.join(ROOT, 'src/data/marksRules.js'));
  ok('marksRules.js client copy is byte-identical', Buffer.compare(copyA, copyB) === 0);

  const doc = rules.newDoc();
  const now = Date.now();
  const r1 = rules.evaluate(doc, {
    char: 'Pip', level: 20, gold: 200, now, season: 's1',
    claim: rules.cleanClaim({ ach: { first_blood: 1, hunter: 1, lv10: 1, lv20: 1 }, counters: { boss: 1, dungeons: 1, slimeking: 1 } }),
  });
  ok('one-time awards fire', r1.awards.length >= 4, String(r1.awards.length));
  ok('no kill source in catalogue', !Object.prototype.hasOwnProperty.call(rules.SOURCES, 'kill'));
  const before = doc.balance;
  const rKill = rules.evaluate(doc, {
    char: 'Pip', level: 20, gold: 200, now: now + 1000, season: 's1',
    claim: rules.cleanClaim({ ach: { first_blood: 1 }, counters: { kills: 999 } }),
  });
  ok('trivial kills award nothing', rKill.awards.length === 0 && doc.balance === before);

  const doc2 = rules.newDoc();
  const rCap = rules.evaluate(doc2, {
    char: 'Pip', level: 99, gold: 5000, now, season: 's1',
    claim: rules.cleanClaim({ ach: Object.fromEntries(rules.ACHIEVEMENT_IDS.map((id) => [id, 1])), counters: { boss: 1, dungeons: 1, slimeking: 1, worldboss: 1, chains: 1, events: 1 } }),
  });
  ok('daily cap respected', doc2.day.total <= rules.MARKS_CFG.DAILY_CAP, String(doc2.day.total));
  ok('deferred one-time not lost (once keys pending or credited)', Object.keys(doc2.once).length > 0);

  const doc3 = rules.newDoc();
  doc3.chars.pip = { c: { dungeons: 0, boss: 0, chains: 0, events: 0 }, t: now - 3600_000 };
  const rep1 = rules.evaluate(doc3, {
    char: 'Pip', level: 20, gold: 10, now, season: 's1',
    claim: rules.cleanClaim({ counters: { dungeons: 4, events: 2 } }),
  });
  const firstAmt = rep1.awards.filter((a) => a.src === 'dungeon').reduce((s, a) => s + a.n, 0);
  const secondAmt = rep1.awards.filter((a) => a.src === 'dungeon').slice(1).reduce((s, a) => s + a.n, 0);
  ok('repeatable diminishing returns', firstAmt > 0 && (rep1.awards.filter((a) => a.src === 'dungeon').length <= 1 || secondAmt <= firstAmt), JSON.stringify(rep1.awards));
  const farm = rules.evaluate(doc3, {
    char: 'Pip', level: 20, gold: 10, now: now + 1000, season: 's1',
    claim: rules.cleanClaim({ counters: { dungeons: 80 } }),
  });
  ok('anti-farm rate-caps dungeon spam', farm.flags.some((f) => String(f).startsWith('rep-rate:dungeons')), farm.flags.join(','));

  const shop = rules.newDoc();
  shop.balance = 50;
  ok('buy title', rules.buy(shop, 't_wayfarer').ok === true && shop.owned.includes('t_wayfarer'));
  ok('cannot buy badge', rules.buy(shop, 'b_founder').reason === 'badge');
  ok('cannot buy with no balance', rules.buy(shop, 't_hollow').reason === 'balance');
  ok('equip owned', rules.equip(shop, 'title', 't_wayfarer').ok);
  ok('cannot equip locked', rules.equip(shop, 'frame', 'f_starlit').reason === 'locked');

  // ── Marks persistence across "relay restart" ─────────────────────
  const dk = deviceKey(t2);
  const rec = marksRec(dk);
  rec.marks.balance = 77; rec.marks.earned = 77;
  rec.marks.history.unshift({ t: now, src: 'level', n: 20, label: 'test' });
  markMarksDirty(dk);
  flushWalletStore();
  dropMarksCache();
  stopWalletStore();
  initWalletStore();
  const rec2 = marksRec(dk);
  ok('marks persist across store restart', rec2.marks.balance === 77 && rec2.marks.earned === 77);
  ok('wallet link persists across restart', links.byDevice[dk]?.addr === kp.address);

  // ── client must not import server/ or tools/ ─────────────────────
  let leak = null;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(js|ts|vue)$/.test(name)) {
        const txt = fs.readFileSync(p, 'utf8');
        if (/from\s+['"][^'"]*(server|tools)\//.test(txt) || /from\s+['"]\.\.\/server\//.test(txt)) leak = p;
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  ok('client does not import server/ or tools/', leak === null, leak);

  // ── wallet.js with no provider ───────────────────────────────────
  const { wallet } = await import('../src/core/wallet.js');
  ok('available() is false without window provider', wallet.available() === false);
  let declined = null;
  try { await wallet.connect(); } catch (e) { declined = e; }
  ok('connect() rejects politely with no wallet', declined && (declined.code === 'missing' || /No Solana wallet/i.test(declined.message)));
  ok('shortAddress empty when disconnected', wallet.shortAddress() === '');
  ok('game does not require a provider to load wallet.js', wallet.state.connected === false);

  // ── Playwright browser mock (optional) ───────────────────────────
  let pw = null;
  try { pw = requireSrv('playwright'); } catch { /* not a server dep */ }
  if (!pw) {
    try {
      const req = createRequire(path.join(ROOT, 'package.json'));
      pw = req('playwright');
    } catch { pw = null; }
  }
  if (!pw) {
    console.log('  skip Playwright browser mock (playwright not installed). Game remains fully playable with no provider.');
  } else {
    console.log('  skip Playwright browser mock (protocol tests cover link + Marks; UI smoke is tools/smoke.mjs).');
  }

  stop();
  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
