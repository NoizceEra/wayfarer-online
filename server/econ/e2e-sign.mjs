// server/econ/e2e-sign.mjs — the wallet side of the /econ/* end-to-end walkthrough.
//
// The relay only ever links a wallet that PROVES possession of its private key, so a curl
// walkthrough needs a real Ed25519 key that can sign the relay's own challenge. This helper
// owns the key and the signing; the walkthrough's HTTP calls stay plain curl.
//
//   node server/econ/e2e-sign.mjs new <keyfile>
//        -> generates an Ed25519 keypair at <keyfile> (PKCS8 PEM, chmod 600) and prints the
//           base58 Solana address. The private key is NEVER printed, logged or committed;
//           keep <keyfile> in a scratch dir outside the repo.
//   node server/econ/e2e-sign.mjs identity-body <keyfile> <token> <challenge.json>
//        -> prints the JSON body for POST /identity/link: signature over the relay's
//           challenge message, base64 (walletAuth.verifyWalletSignature).
//   node server/econ/e2e-sign.mjs wallet-body <keyfile> <token> <challenge.json>
//        -> prints the JSON body for POST /wallet/link: signature over the relay's
//           challenge message, base58 (validate.solSignature).

import fs from 'fs';
import crypto from 'crypto';
import { b58encode } from '../validate.js';

const [cmd, keyfile, ...rest] = process.argv.slice(2);
const die = (m) => { console.error(`e2e-sign: ${m}`); process.exit(2); };
const readKey = (f) => crypto.createPrivateKey(fs.readFileSync(f, 'utf8'));

function address(file) {
  const priv = readKey(file);
  const jwk = crypto.createPublicKey(priv).export({ format: 'jwk' });
  return b58encode(Buffer.from(jwk.x, 'base64url'));
}

if (cmd === 'new') {
  if (!keyfile) die('usage: e2e-sign.mjs new <keyfile>');
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyfile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  console.log(b58encode(Buffer.from(jwk.x, 'base64url')));
} else if (cmd === 'identity-body' || cmd === 'wallet-body') {
  const [token, challengeFile] = rest;
  if (!token || !challengeFile) die(`usage: e2e-sign.mjs ${cmd} <keyfile> <token> <challenge.json>`);
  const ch = JSON.parse(fs.readFileSync(challengeFile, 'utf8'));
  const message = String(ch.message || '');
  if (!message) die('challenge file has no message');
  const sig = crypto.sign(null, Buffer.from(message, 'utf8'), readKey(keyfile));
  const addressStr = address(keyfile);
  const body = cmd === 'identity-body'
    ? { token, kind: 'solana', id: addressStr, message, signature: sig.toString('base64') }
    : { token, nonce: String(ch.nonce || ''), signature: b58encode(sig) };
  if (cmd === 'wallet-body' && !body.nonce) die('challenge file has no nonce');
  console.log(JSON.stringify(body));
} else {
  die('usage: e2e-sign.mjs new|identity-body|wallet-body ...');
}
