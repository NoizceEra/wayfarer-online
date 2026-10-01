/**
 * walletAuth.test.mjs — independent test for the grafted wallet link.
 *
 * This test does NOT trust the port: it generates a real Ed25519 keypair, builds a
 * real base58 Solana-shaped address from the raw public key, and drives the actual
 * signing/verification path. Every check has an attacker-shaped counterpart
 * (replay, tamper, wrong key, expiry, forged session) rather than only a happy path.
 *
 * Run: node server/chain/walletAuth.test.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the nonce store before the module reads CFG.DATA_DIR.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-chainauth-'));
process.env.DATA_DIR = SANDBOX;
process.env.CHAIN_SESSION_SECRET = 'test-secret-that-is-long-enough-1234';

const {
  b58decode, isSolanaAddress, issueNonce, verifyWalletSignature, verifyWalletLink,
  issueSession, verifySession, chainSessionsEnabled, buildNonceMessage,
} = await import('./walletAuth.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};
const throwsWith = (name, fn, expect) => {
  try { fn(); fail++; console.log(`  FAIL  ${name}  -> did not throw`); }
  catch (e) {
    if (e.message.includes(expect)) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}  -> threw "${e.message}", wanted "${expect}"`); }
  }
};

// ── real keypair -> real base58 address ──────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
  let num = 0n; for (const b of buf) num = num * 256n + BigInt(b);
  let out = ''; while (num > 0n) { out = B58[Number(num % 58n)] + out; num /= 58n; }
  let zeros = 0; for (const b of buf) { if (b === 0) zeros++; else break; }
  return '1'.repeat(zeros) + out;
}
function newWallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return { address: b58encode(raw), privateKey, publicKey };
}
const sign = (privateKey, msg) =>
  crypto.sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('base64');

console.log('\n1. base58 decoding (replaces @solana/web3.js PublicKey)');
ok('32 leading "1"s decode to 32 zero bytes',
  b58decode('11111111111111111111111111111111').equals(Buffer.alloc(32)));
ok('real $FORGERS mint decodes to 32 bytes',
  b58decode('3XQnwspiepPaC1iCRVL57aT44noDa9LtTgqFo69xpump').length === 32);
ok('real USDC mint decodes to 32 bytes',
  b58decode('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').length === 32);
ok('a freshly generated address round-trips', (() => {
  const w = newWallet();
  return b58decode(w.address).length === 32;
})());
throwsWith('rejects characters outside the alphabet ("0OIl")', () => b58decode('0OIl'), 'invalid character');
throwsWith('rejects empty input', () => b58decode(''), 'empty input');
throwsWith('rejects over-long input', () => b58decode('1'.repeat(45)), 'too long');
ok('isSolanaAddress accepts a real mint', isSolanaAddress('3XQnwspiepPaC1iCRVL57aT44noDa9LtTgqFo69xpump'));
ok('isSolanaAddress rejects a truncated key', !isSolanaAddress('3XQnwspiepPaC1iCRVL57aT44noDa9LtTgqFo69'));
ok('isSolanaAddress rejects junk', !isSolanaAddress('not-a-wallet'));

console.log('\n2. signature verification (Ed25519 from node:crypto, no tweetnacl)');
const alice = newWallet();
const bob = newWallet();
const { message } = issueNonce(alice.address);
ok('a valid signature over the challenge verifies',
  verifyWalletSignature(alice.address, message, sign(alice.privateKey, message)));
ok("BOB's signature does not verify as Alice", 
  !verifyWalletSignature(alice.address, message, sign(bob.privateKey, message)));
ok('a tampered message fails with the same signature',
  !verifyWalletSignature(alice.address, message + ' ', sign(alice.privateKey, message)));
// Note: a signature is valid over ANY message the key signed — Ed25519 proves key
// control, not freshness. So the crypto layer must ACCEPT this, and the link layer
// must refuse it because the challenge has to match the one we issued. Testing
// both halves is the point; conflating them is how replay bugs get shipped.
ok('crypto layer accepts any message the key genuinely signed',
  verifyWalletSignature(alice.address, 'arbitrary', sign(alice.privateKey, 'arbitrary')));
{
  const l = issueNonce(alice.address);
  const otherMsg = `${l.message}-attacker-suffix`;
  throwsWith('link layer refuses a valid signature over a DIFFERENT message',
    () => verifyWalletLink(alice.address, otherMsg, sign(alice.privateKey, otherMsg)), 'challenge mismatch');
}
ok('a truncated signature is rejected', 
  !verifyWalletSignature(alice.address, message, Buffer.from(sign(alice.privateKey, message), 'base64').subarray(0, 63).toString('base64')));
ok('a non-base64 signature is rejected', !verifyWalletSignature(alice.address, message, '!!!not-base64!!!'));
ok('the message is branded for Wayfarer, not Forgers',
  message.startsWith('Welcome to Wayfarer Online!') && !/Forgers/i.test(message), message.split('\n')[0]);

console.log('\n3. the challenge is single-use (replay protection)');
const link = issueNonce(alice.address);
const sig = sign(alice.privateKey, link.message);
ok('first use succeeds', verifyWalletLink(alice.address, link.message, sig) === true);
throwsWith('replaying the identical signature is refused',
  () => verifyWalletLink(alice.address, link.message, sig), 'no pending challenge');

console.log('\n4. expiry and mismatch');
const link2 = issueNonce(bob.address);
throwsWith('a mismatched challenge message is refused',
  () => verifyWalletLink(bob.address, link2.message + 'x', sign(bob.privateKey, link2.message + 'x')), 'challenge mismatch');
const t = Date.now();
const fresh = issueNonce(bob.address, t);
throwsWith('a challenge past its TTL is refused',
  () => verifyWalletLink(bob.address, fresh.message, sign(bob.privateKey, fresh.message), t + 6 * 60 * 1000), 'expired');
throwsWith('an address with no pending challenge is refused',
  () => verifyWalletLink(newWallet().address, 'anything', 'x'), 'no pending challenge');
throwsWith('a malformed wallet address is refused outright',
  () => issueNonce('0OIl-not-an-address'), 'invalid Solana wallet address');

console.log('\n5. the nonce survives a reload (file-backed, not an in-memory Map)');
const carol = newWallet();
const c3 = issueNonce(carol.address);
const onDisk = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'chain-nonces.json'), 'utf8'));
ok('the pending challenge is persisted to DATA_DIR', !!onDisk[carol.address]?.nonce);
ok('the persisted nonce matches the issued one', onDisk[carol.address].nonce === c3.nonce);
ok('the stored nonce is high-entropy (32 CSPRNG bytes), not Math.random',
  Buffer.from(c3.nonce, 'base64url').length === 32, `len=${Buffer.from(c3.nonce, 'base64url').length}`);

console.log('\n6. session tokens (HMAC-SHA256, replaces the jsonwebtoken dep)');
const tok = issueSession(carol.address, { playerId: 'p_123', name: 'Wanderer' });
const claims = verifySession(tok);
ok('a fresh token verifies', claims.w === carol.address && claims.p === 'p_123' && claims.n === 'Wanderer');
ok('chainSessionsEnabled() is true with a secret set', chainSessionsEnabled());
const [payload, mac] = tok.split('.');
throwsWith('a tampered payload fails the MAC',
  () => verifySession(`${Buffer.from(JSON.stringify({ w: carol.address, p: 'p_evil', exp: Date.now() + 1e9 })).toString('base64url')}.${mac}`), 'bad token signature');
throwsWith('a tampered MAC fails',
  () => verifySession(`${payload}.${Buffer.from('x'.repeat(32)).toString('base64url')}`), 'bad token signature');
throwsWith('a truncated token is rejected', () => verifySession(payload), 'malformed token');
throwsWith('an expired token is refused',
  () => verifySession(issueSession(carol.address, { playerId: 'p_123', now: Date.now() - 8 * 24 * 60 * 60 * 1000 }), Date.now()), 'token expired');
{
  const savedSecret = process.env.CHAIN_SESSION_SECRET;
  process.env.CHAIN_SESSION_SECRET = 'a-completely-different-secret-9999';
  throwsWith('a token signed with another secret is refused', () => verifySession(tok), 'bad token signature');
  process.env.CHAIN_SESSION_SECRET = savedSecret;
}
{
  const savedSecret = process.env.CHAIN_SESSION_SECRET;
  delete process.env.CHAIN_SESSION_SECRET;
  ok('chainSessionsEnabled() is false with no secret', !chainSessionsEnabled());
  throwsWith('issuing a session with no secret is refused',
    () => issueSession(carol.address, { playerId: 'p_1' }), 'CHAIN_SESSION_SECRET');
  process.env.CHAIN_SESSION_SECRET = savedSecret;
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
