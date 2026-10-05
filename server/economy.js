import { log } from './log.js';
import crypto from 'crypto';
import { CFG } from './config.js';
import { loadChar, saveChar, deviceKey } from './store.js';
import {
  ECON, GEAR_META, isGearId, isMatId, CAPS, goldAmount, itemList, cleanLine, cleanCharName, cleanPetName, revOf, hasItems, withoutItems,
} from './validate.js';
import { db, initEconStore, markDirty, commit, flushEcon, ledger, stopEcon } from './econStore.js';

// Player-to-player economy: direct trade, server-wide market board, mail,
// persisted guilds (on top of the social.js guild stub). Loaded by index.js
// like social.js; WayfarerRoom calls install / onJoin / onLeave / beforeSave.
//
// AUTHORITY. The server's copy of each character (store.js, per device token
// + name) is the source of truth for every economy operation: offers are
// checked against its bag (progress.inventory, gear ids) and gold, never
// against what the client claims. Each character record carries `rev`, a
// monotonically increasing economy revision bumped by the server on every
// economy mutation. Economy ops must quote the current rev, and a character
// save quoting an older rev is refused (the client missed a mutation: its
// upload could resurrect items it already gave away).
// Items moved out by the economy are remembered for ECON_OUT_MS; a save that
// shows more copies of such an item than the server copy has is stripped
// (dupe attempt from a tampered client) and logged.
//
// Client -> server                       Server -> client
//  econ-hello {rev}                       econ-state {rev,gold,inventory,hasSave,mailUnread,guild,cfg}
//  trade-request {to:sid}                 trade-request {from,fromName} (target) / econ-msg (sender)
//  trade-respond {from,accept}            trade-open {id,partner:{sid,name}} (both) / econ-msg
//  trade-offer {id,items,gold}            trade-update {id,me,them}  side = {items,gold,locked,confirmed}
//  trade-lock {id,rev} / trade-unlock {id}
//  trade-confirm {id}                     trade-result {ok,id,rev,gold,inventory,delta,partner} | {ok:0,id,reason}
//  trade-cancel {id}                      trade-closed {id,reason}
//  market-browse {q,slot,rarity,min,max,sort,page,mine}  market-page {items,total,page,pages}
//  market-post {item,price,hours,rev}     econ-sync {why,rev,gold,inventory,delta} + econ-msg
//  market-buy {id,rev} / market-cancel {id,rev}          econ-sync + econ-msg
//  mail-list                              mail-box {mails,unread}
//  mail-read {id} / mail-delete {id}      mail-box
//  mail-claim {id,rev}                    econ-sync + mail-box
//  mail-send {to,subject,body,gold,items,rev}            econ-sync + econ-msg; recipient: mail-unread {n}
//  guild-create {tag,name} / guild-invite {name} / guild-accept {tag} / guild-decline {tag}
//  guild-join {tag} (accepts a pending invite) / guild-leave / guild-kick {name}
//  guild-rank {name,rank} / guild-motd {text} / guild-info
//  guild-deposit {gold,rev} / guild-withdraw {gold,rev}  guild-info {...} (members) + guild-update (legacy social shape)
//                                         guild-invite {tag,name,from} (target)
//  (save, handled by WayfarerRoom)        econ-sync {stale:1,rev,gold,inventory} when the save's rev is old
//  wallet-bind-challenge {address}        wallet-bind-challenge {address,nonce,message}
//  wallet-bind {address,signature}        wallet-bound {address} | econ-error
//  token-withdraw {amount,rev}            token-withdraw-result {ok,amount,fee,net,status,reason?}
//  token-deposit {signature}              token-deposit-result {ok,amount,credited,reason?}
//  token-bridge-state {}                  token-bridge-state {...}
//  (any)                                  econ-error {msg, code?}

const SCALE = Number(process.env.MARKET_DURATION_SCALE) > 0 ? Number(process.env.MARKET_DURATION_SCALE) : 1;
const ECON_OUT_MS = 5 * 60_000;
const TRADE_IDLE_MS = 5 * 60_000;
const REQ_TTL_MS = 30_000;
const PAGE = 12;

const ONLINE = new Map();   // charKey -> {room, sid}
const TRADES = new Map();   // id -> session
const REQUESTS = new Map(); // `${toSid}|${fromSid}` -> expiry
const INVITES = new Map();  // charKey -> {tag, from, until}
let tradeSeq = 1;

class Tok {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.t = Date.now(); this.n = burst; }
  take() { const now = Date.now(); this.n = Math.min(this.burst, this.n + ((now - this.t) / 1000) * this.rate); this.t = now; if (this.n < 1) return false; this.n -= 1; return true; }
}

// ─── helpers ──────────────────────────────────────────────────────────
const ckOf = (p) => (p?.token ? (p.ck ||= `${deviceKey(p.token)}:${p.name.toLowerCase()}`) : null);
const dkOf = (p) => deviceKey(p.token);
const clientOf = (room, sid) => room.clients.find((c) => c.sessionId === sid) || null;
const send = (room, sid, type, msg) => { try { clientOf(room, sid)?.send(type, msg); } catch { /* closing */ } };
const err = (client, msg, code) => { try { client.send('econ-error', code ? { msg, code } : { msg }); } catch { /* closing */ } };
const note = (client, text) => { try { client.send('econ-msg', { text }); } catch { /* closing */ } };
async function commitFor(client, files) {
  try { await commit(files); return true; }
  catch (e) {
    log.error('econ operation not durably committed', { err: e.message });
    err(client, 'The save could not be confirmed. Reconnect and check your state before trying again.', 'storage');
    return false;
  }
}
const gname = (id) => GEAR_META[id]?.name || id;
const now = () => Date.now();

// Server copy of a character (must have been saved at least once).
function charRec(p) {
  if (!p?.token) return null;
  const rec = loadChar(p.token, p.name);
  if (!rec?.progress || !Array.isArray(rec.progress.inventory)) return null;
  return rec;
}
const stateOf = (rec) => ({ rev: rec.rev || 0, gold: rec.progress.gold | 0, inventory: rec.progress.inventory.slice(), tokenPoints: rec.progress.tokenPoints | 0, wayfarerTokens: rec.progress.wayfarerTokens | 0 });

// Apply an economy mutation to a server copy: bumps rev, marks the device dirty.
function mutate(p, rec, { gold = 0, add = [], remove = [] }) {
  const pr = rec.progress;
  pr.inventory = withoutItems(pr.inventory, remove).concat(add);
  pr.gold = (pr.gold | 0) + gold;
  const t = now();
  rec.rev = (rec.rev || 0) + 1;
  rec.savedAt = t; pr.savedAt = t;
  if (remove.length) {
    rec.econOut = (rec.econOut || []).filter((e) => t - e.t < ECON_OUT_MS);
    for (const id of remove) rec.econOut.push({ id, t });
    rec.econOut = rec.econOut.slice(-40);
  }
  saveChar(p.token, p.name, rec);
  return { gold, add, remove };
}
function sync(client, rec, why, delta) {
  try { client.send('econ-sync', { why, ...stateOf(rec), delta }); } catch { /* closing */ }
}

// Common preamble of every op that moves items or gold: online character with a
// server copy, and the client's rev matches. Returns rec or null (error sent).
function requireRec(client, p, m, { needRev = true } = {}) {
  if (!p.token) { err(client, 'Your character is not saved on this server yet.', 'nosave'); return null; }
  const rec = charRec(p);
  if (!rec) { err(client, 'Syncing your character with the server... try again in a moment.', 'nosave'); return null; }
  if (needRev && revOf(m.rev) !== (rec.rev || 0)) {
    err(client, 'Your bag changed - re-synced with the server, please try again.', 'rev');
    sync(client, rec, 'rev');
    return null;
  }
  return rec;
}
function suspicious(room, client, p, why, extra) {
  if (room.violation) room.violation(client, p, `econ-${why}`, extra); // logs 'anticheat' + counts
  else log.warn('econ violation', { name: p.name, why, ...extra });
}

// ─── token-bridge internals (wallet link + withdraw/deposit) ──────────
// Wallet linking proves address ownership with an ed25519 signature over a
// server-issued nonce challenge (verified with node:crypto, no extra dep).
// Withdrawals mint devnet $WAYFARER through the on-chain oracle; deposits are
// verified from the configured devnet RPC. Both degrade honestly when the env
// is not configured (see bridgeConfigured / depositConfigured).
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58IDX = (() => { const m = {}; for (let i = 0; i < B58.length; i++) m[B58[i]] = i; return m; })();
const ED_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // SPKI DER prefix for an ed25519 public key
const BIND_NONCES = new Map(); // ck -> { nonce, message, address, until }
const BIND_TTL_MS = 5 * 60_000;

// minimal base58 (Bitcoin alphabet) decoder -> Uint8Array | null
function b58decode(str) {
  if (typeof str !== 'string' || str.length < 1 || str.length > 128) return null;
  const bytes = [0];
  for (const ch of str) {
    const v = B58IDX[ch];
    if (v === undefined) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { const x = bytes[i] * 58 + carry; bytes[i] = x & 0xff; carry = x >> 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

// verify a base58 ed25519 signature of `message` by the base58 Solana address
function verifySolanaSignature(address, message, signatureB58) {
  try {
    const pub = b58decode(address);
    if (!pub || pub.length !== 32) return false;
    const sig = b58decode(signatureB58);
    if (!sig || sig.length !== 64) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([ED_PREFIX, Buffer.from(pub)]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(String(message), 'utf8'), key, Buffer.from(sig));
  } catch { return false; }
}

function bindChallenge(address) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `Wayfarer Online - link this Solana wallet\n\nAddress: ${address}\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}\n\nSigning proves you own this wallet. It does not authorize any transaction.`;
  return { nonce, message };
}
function sweepBindNonces() {
  const t = now();
  for (const [ck, ch] of BIND_NONCES) if (ch.until < t) BIND_NONCES.delete(ck);
}

const short = (a) => (a ? `${String(a).slice(0, 4)}...${String(a).slice(-4)}` : '');
// Withdraw needs the oracle signer + program + mint + RPC; deposit only needs the
// RPC + mint (the treasury is read from env or derived from the on-chain config).
const withdrawConfigured = () => !!(CFG.SOLANA_RPC && CFG.PROGRAM_ID && CFG.MINT_ADDRESS && CFG.ORACLE_KEYPAIR);
const depositConfigured = () => !!(CFG.SOLANA_RPC && CFG.MINT_ADDRESS);
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// db.js (better-sqlite3) is only installed where SQLITE is used: dynamic, cached.
let _bridgeDb = null;
async function bridgeDb() {
  if (_bridgeDb) return _bridgeDb;
  try { _bridgeDb = await import('./db.js'); } catch { _bridgeDb = null; }
  return _bridgeDb;
}
async function solanaWeb3() {
  try { return await import('@solana/web3.js'); } catch { return null; }
}
// the address bound to this character's device ('' when none / db unavailable)
function boundWalletAddressFor(dbm, p) {
  try { return dbm?.getWalletForToken?.(p.token)?.address || ''; } catch { return ''; }
}

// Best-effort on-chain mint of `net` whole $WAYFARER to the player's ATA.
// Returns { signature, reason }; a null signature means the row stays 'pending'.
async function sendMintWithdraw(address, net) {
  const w = await solanaWeb3();
  if (!w) return { signature: null, reason: 'server is missing @solana/web3.js (add it to server/package.json)' };
  try {
    const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } = w;
    const oracle = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(CFG.ORACLE_KEYPAIR)));
    const programId = new PublicKey(CFG.PROGRAM_ID);
    const mint = new PublicKey(CFG.MINT_ADDRESS);
    const player = new PublicKey(address);
    const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
    const ataProgram = new PublicKey(ATA_PROGRAM_ID);
    const conn = new Connection(CFG.SOLANA_RPC, 'confirmed');
    const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
    const [mintAuth] = PublicKey.findProgramAddressSync([Buffer.from('mint')], programId);
    const cfgInfo = await conn.getAccountInfo(config);
    if (!cfgInfo) return { signature: null, reason: 'bridge config PDA not found on-chain (run the program initialize)' };
    // Anchor account layout: 8-byte discriminator, then mint(32) + treasury(32)
    const onMint = new PublicKey(cfgInfo.data.subarray(8, 40));
    const treasury = new PublicKey(cfgInfo.data.subarray(40, 72));
    if (!onMint.equals(mint)) return { signature: null, reason: 'MINT_ADDRESS does not match the on-chain config' };
    const [playerAta] = PublicKey.findProgramAddressSync([player.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ataProgram);
    const raw = BigInt(Math.floor(net)) * (10n ** BigInt(CFG.TOKEN_DECIMALS));
    const disc = crypto.createHash('sha256').update('global:mint_withdraw').digest().subarray(0, 8);
    const amt = Buffer.alloc(8); amt.writeBigUInt64LE(raw);
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: oracle.publicKey, isSigner: true, isWritable: false },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: mintAuth, isSigner: false, isWritable: false },
        { pubkey: player, isSigner: false, isWritable: false },
        { pubkey: playerAta, isSigner: false, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc, amt]),
    });
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [oracle], { commitment: 'confirmed' });
    return { signature: sig, reason: null };
  } catch (e) {
    return { signature: null, reason: e.message || 'mint transaction failed' };
  }
}

// Confirm an on-chain transfer of $WAYFARER into the treasury ATA and return
// the credited whole-token amount.
async function verifyDeposit(signature, ownerAddress) {
  const w = await solanaWeb3();
  if (!w) return { ok: false, reason: 'server is missing @solana/web3.js' };
  try {
    const { Connection, PublicKey } = w;
    const conn = new Connection(CFG.SOLANA_RPC, 'confirmed');
    const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (!tx || !tx.meta) return { ok: false, reason: 'transaction not found or not yet confirmed' };
    if (tx.meta.err) return { ok: false, reason: 'transaction failed on chain' };
    if (!ownerAddress) return { ok: false, reason: 'link a wallet before claiming a deposit' };
    let treasury = CFG.TREASURY_ADDRESS || '';
    if (!treasury && CFG.PROGRAM_ID) {
      const programId = new PublicKey(CFG.PROGRAM_ID);
      const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
      const ataProgram = new PublicKey(ATA_PROGRAM_ID);
      const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
      const [ata] = PublicKey.findProgramAddressSync([config.toBuffer(), tokenProgram.toBuffer(), new PublicKey(CFG.MINT_ADDRESS).toBuffer()], ataProgram);
      treasury = ata.toString();
    }
    if (!treasury) return { ok: false, reason: 'treasury address unknown (set TREASURY_ADDRESS or PROGRAM_ID)' };
    const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
    const ataProgram = new PublicKey(ATA_PROGRAM_ID);
    const [sourceAta] = PublicKey.findProgramAddressSync([
      new PublicKey(ownerAddress).toBuffer(), tokenProgram.toBuffer(), new PublicKey(CFG.MINT_ADDRESS).toBuffer(),
    ], ataProgram);
    const source = sourceAta.toString();
    const keys = (tx.transaction.message.accountKeys || []).map((k) => (k && k.pubkey ? k.pubkey.toString() : String(k)));
    const tokenBalance = (rows, account) => {
      let amount = 0n; let decimals = CFG.TOKEN_DECIMALS;
      for (const b of rows || []) {
        if (b.mint !== CFG.MINT_ADDRESS || keys[b.accountIndex] !== account) continue;
        amount += BigInt(b.uiTokenAmount.amount);
        decimals = b.uiTokenAmount.decimals;
      }
      return { amount, decimals };
    };
    const preSource = tokenBalance(tx.meta.preTokenBalances, source).amount;
    const postSource = tokenBalance(tx.meta.postTokenBalances, source).amount;
    const preTreasury = tokenBalance(tx.meta.preTokenBalances, treasury).amount;
    const postTreasury = tokenBalance(tx.meta.postTokenBalances, treasury);
    const sourceDelta = postSource - preSource;
    const treasuryDelta = postTreasury.amount - preTreasury;
    if (sourceDelta >= 0n || treasuryDelta <= 0n || -sourceDelta !== treasuryDelta) {
      return { ok: false, reason: 'transaction must transfer $WAYFARER from your linked wallet to the treasury' };
    }
    const raw = treasuryDelta;
    const decimals = postTreasury.decimals;
    const unit = 10n ** BigInt(decimals);
    if (raw % unit !== 0n) return { ok: false, reason: 'transfer must contain a whole number of tokens' };
    const amount = Number(raw / (10n ** BigInt(decimals)));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'transfer is below one whole token' };
    return { ok: true, amount, decimals };
  } catch (e) {
    return { ok: false, reason: e.message || 'verification failed' };
  }
}


// ─── lifecycle ────────────────────────────────────────────────────────
let timers = [];
export function init() {
  initEconStore();
  sweepMarket().catch((e) => log.error('econ market sweep failed', { err: e.message }));
  timers = [
    setInterval(() => sweepMarket().catch((e) => log.error('econ market sweep failed', { err: e.message })), Math.max(250, Math.min(15_000, 15_000 * SCALE))),
    setInterval(sweepTrades, 5_000),
  ];
  timers.forEach((t) => t.unref?.());
}
export function flush() { flushEcon(); }
export function stop() { timers.forEach(clearInterval); stopEcon(); flushEcon(); }

export function routes(app) {
  app.get('/economy', (req, res) => {
    const listings = Object.values(db.market.listings);
    res.json({
      ok: true, listings: listings.length, sellers: new Set(listings.map((l) => l.seller)).size,
      mailboxes: Object.keys(db.mail.boxes).length, guilds: Object.keys(db.guilds.guilds).length,
      trades: TRADES.size, online: ONLINE.size,
    });
  });
}

export function onJoin(room, client, p) {
  const ck = ckOf(p);
  if (!ck) return;
  ONLINE.set(ck, { room, sid: client.sessionId });
  const lower = p.name.toLowerCase();
  if (!db.names.names[lower]) { db.names.names[lower] = ck; markDirty('names'); }
  const tag = db.guilds.memberOf[ck];
  if (tag && db.guilds.guilds[tag]) {
    linkSocial(room, client.sessionId, tag);
    sendGuild(room, client.sessionId, ck, true);
  }
}

export function onLeave(room, client, p) {
  const sid = client.sessionId;
  for (const s of [...TRADES.values()]) if (s.room === room && (s.a.sid === sid || s.b.sid === sid)) closeTrade(s, `${p?.name || 'Your partner'} left.`);
  for (const k of [...REQUESTS.keys()]) if (k.startsWith(`${sid}|`) || k.endsWith(`|${sid}`)) REQUESTS.delete(k);
  const ck = ckOf(p);
  const on = ck && ONLINE.get(ck);
  if (on && on.room === room && on.sid === sid) ONLINE.delete(ck);
}

// Called by WayfarerRoom.onSave before the save is validated. false = refuse.
export function beforeSave(room, client, p, m, prev) {
  if (!prev?.progress) return true;
  const cur = prev.rev || 0;
  if (cur > 0 && m.rev !== cur) {
    try { client.send('econ-sync', { stale: 1, ...stateOf(prev) }); } catch { /* closing */ }
    log.info('econ: stale save refused', { name: p.name, got: m.rev ?? null, cur });
    return false;
  }
  // dupe guard: items the economy just moved out may not reappear
  const t = now();
  const out = (prev.econOut || []).filter((e) => t - e.t < ECON_OUT_MS);
  if (out.length && m.progress && Array.isArray(m.progress.inventory)) {
    const count = (inv, eq, id) => inv.filter((x) => x === id).length + Object.values(eq || {}).filter((x) => x === id).length;
    const stripped = [];
    for (const id of new Set(out.map((e) => e.id))) {
      const allowed = count(prev.progress.inventory, prev.progress.equipped, id);
      let extra = count(m.progress.inventory, m.progress.equipped, id) - allowed;
      while (extra > 0) {
        const i = m.progress.inventory.lastIndexOf(id);
        if (i >= 0) { m.progress.inventory.splice(i, 1); extra--; stripped.push(id); continue; }
        // also strip from equipped map if the extra copy is hiding there
        if (m.progress.equipped && typeof m.progress.equipped === 'object') {
          for (const k of Object.keys(m.progress.equipped)) {
            if (m.progress.equipped[k] === id) { delete m.progress.equipped[k]; extra--; stripped.push(id); break; }
          }
        }
        break;
      }
    }
    if (stripped.length) suspicious(room, client, p, 'dupe', { stripped });
  }
  // craft-material consistency at the authority boundary: progress.ext.mats is
  // client-simulated (gathering/crafting run on the client), so the upload may
  // only carry known catalogue ids within the stack cap. Unknown ids and
  // non-counts are dropped, over-cap stacks are clamped. Gain-bounding vs the
  // server copy lives in validateSave, which runs next and reports it; this
  // strip keeps junk from ever reaching the server copy, mirroring the
  // econOut strip above. Decreases (craft consumption) always pass through.
  const upMats = m.progress?.ext?.mats;
  if (upMats && typeof upMats === 'object' && !Array.isArray(upMats)) {
    const badMats = [];
    for (const [id, v] of Object.entries(upMats)) {
      const n = Math.floor(Number(v));
      if (!isMatId(id) || !Number.isFinite(n) || n <= 0) { delete upMats[id]; badMats.push(String(id).slice(0, 32)); }
      else if (n > CAPS.matStack) { upMats[id] = CAPS.matStack; badMats.push(`${String(id).slice(0, 32)}>${n}`); }
    }
    if (badMats.length) suspicious(room, client, p, 'bad-mats', { stripped: badMats.slice(0, 8) });
  }
  return true;
}

// ─── install (per room) ───────────────────────────────────────────────
export function install(room) {
  const on = (type, fn, bucket = 'econ') => room.onMessage(type, (client, m) => {
    const p = room.players.get(client.sessionId);
    if (!p) return;
    const b = (p.econB ||= { econ: new Tok(5, 16), browse: new Tok(3, 8) });
    if (!b[bucket].take()) { err(client, 'Slow down a little.', 'rate'); return; }
    let size = 0; try { size = JSON.stringify(m ?? null).length; } catch { return; }
    if (size > 2048) { suspicious(room, client, p, 'oversize', { type, size }); return; }
    const msg = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
    try {
      const r = fn(client, p, msg);
      if (r && typeof r.catch === 'function') r.catch((e) => log.warn('econ handler error', { type, err: e.message }));
    } catch (e) { log.warn('econ handler error', { type, err: e.message }); }
  });

  const STAKE_TIERS = {
    bronze: { amount: 100, days: 7, dropRate: 0.05 },
    silver: { amount: 500, days: 14, dropRate: 0.10 },
    gold:   { amount: 2000, days: 30, dropRate: 0.15 },
  };
  // Server->client economy types must never ride the generic '*' passthrough
  // (a client could forge a trade-result / econ-sync for its peers): swallow them.
  for (const t of ['econ-state', 'econ-sync', 'econ-msg', 'econ-error', 'trade-open', 'trade-update', 'trade-result', 'trade-closed', 'trade-done', 'escrow-open', 'escrow-update', 'escrow-result', 'escrow-closed', 'market-page', 'mail-box', 'mail-unread', 'guild-info', 'guild-update', 'saved', 'referral-state', 'referral-paid', 'worldboss-announce', 'worldboss-state', 'worldboss-slain', 'token-spend-ok', 'wallet-bind-challenge', 'wallet-bound', 'token-withdraw-result', 'token-deposit-result', 'token-bridge-state']) {
    room.onMessage(t, () => {});
  }

  on('econ-hello', (c, p) => {
    const rec = charRec(p);
    const ck = ckOf(p);
    const box = ck ? db.mail.boxes[ck] || [] : [];
    const ext = rec?.progress?.ext || {};
    const today = new Date().toISOString().slice(0, 10);
    const bridgeDailyClaimed = ext.bridgeDailyClaimed?.date === today ? (ext.bridgeDailyClaimed?.amount || 0) : 0;
    c.send('econ-state', {
      hasSave: !!rec, ...(rec ? stateOf(rec) : { rev: 0 }),
      mailUnread: box.filter((x) => !x.read).length,
      guild: ck ? db.guilds.memberOf[ck] || '' : '',
      cfg: { bag: ECON.BAG_SIZE, tradeItems: ECON.TRADE_ITEMS, tax: ECON.MARKET_TAX, hours: ECON.MARKET_HOURS, postage: ECON.MAIL_POSTAGE, mailItems: ECON.MAIL_ITEMS, priceMax: ECON.PRICE_MAX, tokenClaimFee: ECON.TOKEN_CLAIM_FEE, tokenWithdrawDailyCap: ECON.TOKEN_WITHDRAW_DAILY_CAP, stakeTiers: STAKE_TIERS },
      sinksState: { stashTabs: Math.max(0, Math.min(5, Math.floor(Number(ext.stashTabs)) || 0)), dailyClaimed: bridgeDailyClaimed },
    });
  }, 'browse');

  // ── direct trade ──
  on('trade-request', (c, p, m) => {
    const q = room.players.get(m.to);
    if (!q || q.dc || m.to === c.sessionId) { err(c, 'That player is not here.'); return; }
    if (!p.token || !q.token) { err(c, 'Both players need a saved online character to trade.'); return; }
    if (tradeOf(room, c.sessionId)) { err(c, 'Finish your current trade first.'); return; }
    if (tradeOf(room, m.to)) { err(c, `${q.name} is busy trading.`); return; }
    REQUESTS.set(`${m.to}|${c.sessionId}`, now() + REQ_TTL_MS);
    send(room, m.to, 'trade-request', { from: c.sessionId, fromName: p.name });
    note(c, `Trade request sent to ${q.name}.`);
  });
  on('trade-respond', (c, p, m) => {
    const key = `${c.sessionId}|${m.from}`;
    const until = REQUESTS.get(key);
    REQUESTS.delete(key);
    const q = room.players.get(m.from);
    if (!until || until < now() || !q || q.dc) { err(c, 'That trade request has expired.'); return; }
    if (!m.accept) { send(room, m.from, 'econ-msg', { text: `${p.name} declined your trade request.` }); return; }
    if (tradeOf(room, c.sessionId) || tradeOf(room, m.from)) { err(c, 'One of you is already trading.'); return; }
    const side = (pl, sid) => ({ sid, ck: ckOf(pl), name: pl.name, items: [], gold: 0, locked: false, lockRev: null, confirmed: false });
    const s = { id: `T${tradeSeq++}`, room, a: side(q, m.from), b: side(p, c.sessionId), touched: now() };
    TRADES.set(s.id, s);
    send(room, s.a.sid, 'trade-open', { id: s.id, partner: { sid: s.b.sid, name: s.b.name } });
    send(room, s.b.sid, 'trade-open', { id: s.id, partner: { sid: s.a.sid, name: s.a.name } });
    pushTrade(s);
    log.info('econ trade open', { id: s.id, a: s.a.name, b: s.b.name });
  });
  on('trade-offer', (c, p, m) => {
    const s = mySession(room, c, m.id); if (!s) return;
    const me = sideOf(s, c.sessionId);
    const items = itemList(m.items, ECON.TRADE_ITEMS);
    const gold = goldAmount(m.gold);
    if (items === null || gold === null) { suspicious(room, c, p, 'bad-offer', { items: m.items, gold: m.gold }); err(c, 'Invalid offer.', 'invalid'); return; }
    const rec = requireRec(c, p, m, { needRev: false }); if (!rec) return;
    if (!hasItems(rec.progress.inventory, items)) { suspicious(room, c, p, 'offer-missing', { items }); err(c, 'You do not have those items (server copy).', 'missing'); sync(c, rec, 'offer'); return; }
    if (gold > (rec.progress.gold | 0)) { suspicious(room, c, p, 'offer-gold', { gold, have: rec.progress.gold }); err(c, 'You do not have that much gold.', 'gold'); return; }
    me.items = items; me.gold = gold;
    unlockAll(s);
    pushTrade(s);
  });
  on('trade-lock', (c, p, m) => {
    const s = mySession(room, c, m.id); if (!s) return;
    const me = sideOf(s, c.sessionId);
    const rec = requireRec(c, p, m); if (!rec) return;
    if (!hasItems(rec.progress.inventory, me.items) || me.gold > (rec.progress.gold | 0)) { err(c, 'Your offer is no longer in your bag.', 'missing'); me.items = []; me.gold = 0; unlockAll(s); pushTrade(s); return; }
    me.locked = true; me.lockRev = rec.rev || 0; me.confirmed = false;
    s.touched = now();
    pushTrade(s);
  });
  on('trade-unlock', (c, p, m) => {
    const s = mySession(room, c, m.id); if (!s) return;
    unlockAll(s); pushTrade(s);
  });
  on('trade-confirm', (c, p, m) => {
    const s = mySession(room, c, m.id); if (!s) return;
    const me = sideOf(s, c.sessionId);
    if (!s.a.locked || !s.b.locked) { err(c, 'Both sides must lock their offer first.'); return; }
    me.confirmed = true; s.touched = now();
    if (s.a.confirmed && s.b.confirmed) executeTrade(s);
    else pushTrade(s);
  });
  on('trade-cancel', (c, p, m) => {
    const s = TRADES.get(String(m.id || '')) || tradeOf(room, c.sessionId);
    if (!s || s.room !== room || !sideOf(s, c.sessionId)) return;
    closeTrade(s, `${p.name} cancelled the trade.`);
  });

  // ── escrow trade (secure, server-guaranteed, 2.5% fee) ──
  const ESCROWS = new Map(); // id -> escrow session
  let escrowSeq = 1;
  const ESCROW_IDLE_MS = 5 * 60_000;
  const escrowOf = (room, sid) => {
    for (const s of ESCROWS.values()) if (s.room === room && (s.a.sid === sid || s.b.sid === sid)) return s;
    return null;
  };
  const eSideOf = (s, sid) => (s.a.sid === sid ? s.a : s.b.sid === sid ? s.b : null);
  const eOtherOf = (s, sid) => (s.a.sid === sid ? s.b : s.a);
  const ePub = (x) => ({ name: x.name, items: x.items, gold: x.gold, locked: x.locked, confirmed: x.confirmed });
  const calcFee = (aGold, bGold) => {
    const total = (aGold | 0) + (bGold | 0);
    return total > 0 ? Math.max(1, Math.ceil(total * 0.025)) : 0;
  };

  on('escrow-request', (c, p, m) => {
    const q = room.players.get(m.to);
    if (!q || q.dc || m.to === c.sessionId) { err(c, 'That player is not here.'); return; }
    if (!p.token || !q.token) { err(c, 'Both players need a saved online character to escrow trade.'); return; }
    if (escrowOf(room, c.sessionId)) { err(c, 'Finish your current escrow first.'); return; }
    if (escrowOf(room, m.to)) { err(c, `${q.name} is busy in an escrow.`); return; }
    if (tradeOf(room, c.sessionId) || tradeOf(room, m.to)) { err(c, 'One of you is in a direct trade.'); return; }
    REQUESTS.set(`${m.to}|${c.sessionId}`, now() + REQ_TTL_MS);
    send(room, m.to, 'escrow-request', { from: c.sessionId, fromName: p.name });
    note(c, `Escrow trade request sent to ${q.name}.`);
  });
  on('escrow-respond', (c, p, m) => {
    const key = `${c.sessionId}|${m.from}`;
    const until = REQUESTS.get(key);
    REQUESTS.delete(key);
    const q = room.players.get(m.from);
    if (!until || until < now() || !q || q.dc) { err(c, 'That escrow request has expired.'); return; }
    if (!m.accept) { send(room, m.from, 'econ-msg', { text: `${p.name} declined your escrow request.` }); return; }
    if (escrowOf(room, c.sessionId) || escrowOf(room, m.from)) { err(c, 'One of you is already in an escrow.'); return; }
    const side = (pl, sid) => ({ sid, ck: ckOf(pl), name: pl.name, items: [], gold: 0, locked: false, lockRev: null, confirmed: false });
    const s = { id: `E${escrowSeq++}`, room, a: side(q, m.from), b: side(p, c.sessionId), touched: now() };
    ESCROWS.set(s.id, s);
    send(room, s.a.sid, 'escrow-open', { id: s.id, partner: { sid: s.b.sid, name: s.b.name } });
    send(room, s.b.sid, 'escrow-open', { id: s.id, partner: { sid: s.a.sid, name: s.a.name } });
    pushEscrow(s);
    log.info('econ escrow open', { id: s.id, a: s.a.name, b: s.b.name });
  });
  on('escrow-offer', (c, p, m) => {
    const s = myEscrow(room, c, m.id); if (!s) return;
    const me = eSideOf(s, c.sessionId);
    const items = itemList(m.items, ECON.TRADE_ITEMS);
    const gold = goldAmount(m.gold);
    if (items === null || gold === null) { suspicious(room, c, p, 'bad-escrow-offer', { items: m.items, gold: m.gold }); err(c, 'Invalid offer.', 'invalid'); return; }
    const rec = requireRec(c, p, m, { needRev: false }); if (!rec) return;
    if (!hasItems(rec.progress.inventory, items)) { suspicious(room, c, p, 'escrow-offer-missing', { items }); err(c, 'You do not have those items (server copy).', 'missing'); sync(c, rec, 'escrow-offer'); return; }
    if (gold > (rec.progress.gold | 0)) { suspicious(room, c, p, 'escrow-offer-gold', { gold, have: rec.progress.gold }); err(c, 'You do not have that much gold.', 'gold'); return; }
    me.items = items; me.gold = gold;
    eUnlockAll(s);
    pushEscrow(s);
  });
  on('escrow-lock', (c, p, m) => {
    const s = myEscrow(room, c, m.id); if (!s) return;
    const me = eSideOf(s, c.sessionId);
    const rec = requireRec(c, p, m); if (!rec) return;
    if (!hasItems(rec.progress.inventory, me.items) || me.gold > (rec.progress.gold | 0)) { err(c, 'Your offer is no longer in your bag.', 'missing'); me.items = []; me.gold = 0; eUnlockAll(s); pushEscrow(s); return; }
    me.locked = true; me.lockRev = rec.rev || 0; me.confirmed = false;
    s.touched = now();
    pushEscrow(s);
  });
  on('escrow-unlock', (c, p, m) => {
    const s = myEscrow(room, c, m.id); if (!s) return;
    eUnlockAll(s); pushEscrow(s);
  });
  on('escrow-confirm', (c, p, m) => {
    const s = myEscrow(room, c, m.id); if (!s) return;
    const me = eSideOf(s, c.sessionId);
    if (!s.a.locked || !s.b.locked) { err(c, 'Both sides must lock their offer first.'); return; }
    me.confirmed = true; s.touched = now();
    if (s.a.confirmed && s.b.confirmed) executeEscrow(s);
    else pushEscrow(s);
  });
  on('escrow-cancel', (c, p, m) => {
    const s = ESCROWS.get(String(m.id || '')) || escrowOf(room, c.sessionId);
    if (!s || s.room !== room || !eSideOf(s, c.sessionId)) return;
    closeEscrowSession(s, `${p.name} cancelled the escrow.`);
  });

  function myEscrow(room, client, id) {
    const s = ESCROWS.get(String(id || ''));
    if (!s || s.room !== room || !eSideOf(s, client.sessionId)) { err(client, 'That escrow is closed.', 'closed'); return null; }
    return s;
  }
  function eUnlockAll(s) { for (const x of [s.a, s.b]) { x.locked = false; x.confirmed = false; x.lockRev = null; } s.touched = now(); }
  function pushEscrow(s) {
    const fee = calcFee(s.a.gold, s.b.gold);
    send(s.room, s.a.sid, 'escrow-update', { id: s.id, me: ePub(s.a), them: ePub(s.b), fee });
    send(s.room, s.b.sid, 'escrow-update', { id: s.id, me: ePub(s.b), them: ePub(s.a), fee });
  }
  function closeEscrowSession(s, reason) {
    if (!ESCROWS.delete(s.id)) return;
    send(s.room, s.a.sid, 'escrow-closed', { id: s.id, reason });
    send(s.room, s.b.sid, 'escrow-closed', { id: s.id, reason });
    log.info('econ escrow closed', { id: s.id, reason });
  }
  function failEscrow(s, reason) {
    eUnlockAll(s);
    send(s.room, s.a.sid, 'escrow-result', { ok: 0, id: s.id, reason });
    send(s.room, s.b.sid, 'escrow-result', { ok: 0, id: s.id, reason });
    pushEscrow(s);
    log.info('econ escrow failed', { id: s.id, reason });
  }
  async function executeEscrow(s) {
    const room = s.room;
    const pa = room.players.get(s.a.sid); const pb = room.players.get(s.b.sid);
    if (!pa || !pb || pa.dc || pb.dc) { closeEscrowSession(s, 'Your partner disconnected.'); return; }
    const ra = charRec(pa); const rb = charRec(pb);
    if (!ra || !rb) { failEscrow(s, 'A character is not synced with the server.'); return; }
    if ((ra.rev || 0) !== s.a.lockRev || (rb.rev || 0) !== s.b.lockRev) { failEscrow(s, 'A bag changed after locking - lock again.'); return; }
    for (const [x, r] of [[s.a, ra], [s.b, rb]]) {
      if (!hasItems(r.progress.inventory, x.items) || x.gold > (r.progress.gold | 0)) { failEscrow(s, `${x.name}'s offer is no longer in their bag.`); return; }
    }
    const invA = ra.progress.inventory.length - s.a.items.length + s.b.items.length;
    const invB = rb.progress.inventory.length - s.b.items.length + s.a.items.length;
    if (invA > ECON.BAG_SIZE) { failEscrow(s, `${s.a.name}'s bag would be over ${ECON.BAG_SIZE} items.`); return; }
    if (invB > ECON.BAG_SIZE) { failEscrow(s, `${s.b.name}'s bag would be over ${ECON.BAG_SIZE} items.`); return; }
    const totalGold = s.a.gold + s.b.gold;
    const fee = calcFee(s.a.gold, s.b.gold);
    const netA = (s.b.gold | 0) - (fee > 0 && totalGold > 0 ? Math.round(fee * ((s.b.gold | 0) / totalGold)) : 0);
    const netB = (s.a.gold | 0) - (fee > 0 && totalGold > 0 ? Math.round(fee * ((s.a.gold | 0) / totalGold)) : 0);
    if ((ra.progress.gold | 0) - s.a.gold + netA > ECON.GOLD_MAX || (rb.progress.gold | 0) - s.b.gold + netB > ECON.GOLD_MAX) { failEscrow(s, 'Gold would exceed the carry limit.'); return; }
    if (!s.a.items.length && !s.b.items.length && !s.a.gold && !s.b.gold) { failEscrow(s, 'Nothing to trade.'); return; }

    ESCROWS.delete(s.id);
    const da = mutate(pa, ra, { gold: netA - s.a.gold, add: s.b.items, remove: s.a.items });
    const dbb = mutate(pb, rb, { gold: netB - s.b.gold, add: s.a.items, remove: s.b.items });
    try { await commit({ deviceKeys: [dkOf(pa), dkOf(pb)] }); }
    catch (e) {
      log.error('econ escrow not durably committed', { id: s.id, err: e.message });
      send(room, s.a.sid, 'econ-error', { msg: 'Escrow could not be saved. Please reconnect before trading again.', code: 'storage' });
      send(room, s.b.sid, 'econ-error', { msg: 'Escrow could not be saved. Please reconnect before trading again.', code: 'storage' });
      failEscrow(s, 'The escrow could not be saved.');
      return;
    }
    send(room, s.a.sid, 'escrow-result', { ok: 1, id: s.id, ...stateOf(ra), delta: da, partner: s.b.name, fee });
    send(room, s.b.sid, 'escrow-result', { ok: 1, id: s.id, ...stateOf(rb), delta: dbb, partner: s.a.name, fee });
    ledger({ op: 'escrow', id: s.id, fee, a: { ck: s.a.ck, name: s.a.name, gave: s.a.items, gold: s.a.gold, rev: ra.rev }, b: { ck: s.b.ck, name: s.b.name, gave: s.b.items, gold: s.b.gold, rev: rb.rev } });
    log.info('econ escrow done', { id: s.id, a: s.a.name, b: s.b.name, aGave: s.a.items.length, aGold: s.a.gold, bGave: s.b.items.length, bGold: s.b.gold, fee });
  }
  function sweepEscrows() {
    const t = now();
    for (const s of [...ESCROWS.values()]) {
      const pa = s.room.players.get(s.a.sid); const pb = s.room.players.get(s.b.sid);
      if (!pa || !pb || pa.dc || pb.dc) closeEscrowSession(s, 'Your partner disconnected.');
      else if (t - s.touched > ESCROW_IDLE_MS) closeEscrowSession(s, 'Escrow timed out.');
    }
  }
  timers.push(setInterval(sweepEscrows, 5_000));
  timers.push(setInterval(sweepBindNonces, 30_000));

  // ── market ──
  on('market-browse', (c, p, m) => {
    const ck = ckOf(p);
    const q = cleanLine(m.q, 24).toLowerCase();
    const slot = typeof m.slot === 'string' ? m.slot : '';
    const rarity = typeof m.rarity === 'string' ? m.rarity : '';
    const min = goldAmount(m.min, ECON.PRICE_MAX) ?? 0;
    const max = goldAmount(m.max, ECON.PRICE_MAX) || ECON.PRICE_MAX;
    const t = now();
    let list = Object.values(db.market.listings).filter((l) => {
      if (l.expiresAt <= t) return false;
      if (m.mine) return l.seller === ck;
      const g = GEAR_META[l.item] || {};
      if (slot && g.slot !== slot) return false;
      if (rarity && g.rarity !== rarity) return false;
      if (l.price < min || l.price > max) return false;
      if (q && !String(g.name || l.item).toLowerCase().includes(q) && !l.sellerName.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorts = {
      price: (a, b) => a.price - b.price, '-price': (a, b) => b.price - a.price,
      new: (a, b) => b.createdAt - a.createdAt, ending: (a, b) => a.expiresAt - b.expiresAt,
    };
    list.sort(sorts[m.sort] || sorts.price);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const page = Math.min(pages - 1, Math.max(0, Math.floor(Number(m.page)) || 0));
    c.send('market-page', {
      total: list.length, page, pages, mine: m.mine ? 1 : 0,
      items: list.slice(page * PAGE, page * PAGE + PAGE).map((l) => {
        const g = GEAR_META[l.item] || {};
        return { id: l.id, item: l.item, name: g.name || l.item, slot: g.slot, rarity: g.rarity, lvl: g.lvl, price: l.price, seller: l.sellerName, expiresAt: l.expiresAt, left: l.expiresAt - t, mine: l.seller === ck ? 1 : 0 };
      }),
    });
  }, 'browse');

  on('market-post', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const ck = ckOf(p);
    if (!isGearId(m.item)) { suspicious(room, c, p, 'bad-item', { item: m.item }); err(c, 'That item cannot be listed.', 'invalid'); return; }
    const price = goldAmount(m.price, ECON.PRICE_MAX);
    if (!price) { err(c, `Price must be 1-${ECON.PRICE_MAX} gold.`, 'invalid'); return; }
    const hours = ECON.MARKET_HOURS.includes(m.hours) ? m.hours : null;
    if (!hours) { err(c, 'Pick a listing duration.', 'invalid'); return; }
    if (!hasItems(rec.progress.inventory, [m.item])) { suspicious(room, c, p, 'post-missing', { item: m.item }); err(c, 'That item is not in your bag (server copy).', 'missing'); sync(c, rec, 'post'); return; }
    const mine = Object.values(db.market.listings).filter((l) => l.seller === ck).length;
    if (mine >= ECON.MARKET_MAX_PER_SELLER) { err(c, `You already have ${mine} listings (max ${ECON.MARKET_MAX_PER_SELLER}).`); return; }
    const tax = Math.max(1, Math.ceil(price * ECON.MARKET_TAX));
    if ((rec.progress.gold | 0) < tax) { err(c, `The listing fee is ${tax} gold.`, 'gold'); return; }
    const t = now();
    const l = { id: `L${++db.market.seq}`, seller: ck, sellerName: p.name, item: m.item, price, tax, hours, createdAt: t, expiresAt: t + Math.round(hours * 3_600_000 * SCALE) };
    db.market.listings[l.id] = l; markDirty('market');
    const delta = mutate(p, rec, { gold: -tax, remove: [m.item] });
    ledger({ op: 'market-post', id: l.id, seller: ck, name: p.name, item: m.item, price, tax, rev: rec.rev });
    log.info('econ market post', { id: l.id, name: p.name, item: m.item, price });
    if (!await commitFor(c, { docs: ['market'], deviceKeys: [dkOf(p)] })) return;
    sync(c, rec, 'market-post', delta);
    note(c, `Listed ${gname(m.item)} for ${price}g (fee ${tax}g).`);
  });

  on('market-buy', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const ck = ckOf(p);
    const lid = String(m.id || '');
    const l = Object.prototype.hasOwnProperty.call(db.market.listings, lid) ? db.market.listings[lid] : undefined;
    if (!l || l.expiresAt <= now()) { err(c, 'That listing is gone.', 'gone'); return; }
    if (l.seller === ck) { err(c, 'That is your own listing - cancel it instead.'); return; }
    if ((rec.progress.gold | 0) < l.price) { err(c, `You need ${l.price} gold.`, 'gold'); return; }
    if (rec.progress.inventory.length >= ECON.BAG_SIZE) { err(c, 'Your bag is full.', 'bag'); return; }
    delete db.market.listings[l.id]; markDirty('market');
    const delta = mutate(p, rec, { gold: -l.price, add: [l.item] });
    const sellerMail = deliverMail(l.seller, { sys: 1, from: 'Market Board', subject: `Sold: ${gname(l.item)}`, body: `${p.name} bought your ${gname(l.item)} for ${l.price} gold.`, gold: l.price, items: [] });
    ledger({ op: 'market-buy', id: l.id, buyer: ck, name: p.name, seller: l.seller, item: l.item, price: l.price, rev: rec.rev });
    log.info('econ market buy', { id: l.id, buyer: p.name, seller: l.sellerName, item: l.item, price: l.price });
    if (!await commitFor(c, { docs: ['market', 'mail'], deviceKeys: [dkOf(p)] })) return;
    notifyMail(l.seller, sellerMail);
    sync(c, rec, 'market-buy', delta);
    note(c, `Bought ${gname(l.item)} for ${l.price}g.`);
  });

  on('market-cancel', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const ck = ckOf(p);
    const lid = String(m.id || '');
    const l = Object.prototype.hasOwnProperty.call(db.market.listings, lid) ? db.market.listings[lid] : undefined;
    if (!l || l.seller !== ck) { err(c, 'That is not your listing.', 'gone'); return; }
    delete db.market.listings[l.id]; markDirty('market');
    let delta = null;
    let mailNotice = null;
    if (rec.progress.inventory.length < ECON.BAG_SIZE) {
      delta = mutate(p, rec, { add: [l.item] });
    } else { mailNotice = deliverMail(ck, { sys: 1, from: 'Market Board', subject: `Returned: ${gname(l.item)}`, body: 'Your bag was full, so your cancelled listing was sent here.', gold: 0, items: [l.item] }); }
    ledger({ op: 'market-cancel', id: l.id, seller: ck, item: l.item, toMail: !delta });
    if (!await commitFor(c, { docs: ['market', 'mail'], deviceKeys: delta ? [dkOf(p)] : [] })) return;
    if (delta) { sync(c, rec, 'market-cancel', delta); note(c, `Listing cancelled: ${gname(l.item)} is back in your bag.`); }
    else { notifyMail(ck, mailNotice); note(c, `Listing cancelled: your bag is full, ${gname(l.item)} was mailed to you.`); }
  });

  // ── mail ──
  on('mail-list', (c, p) => sendBox(c, ckOf(p)), 'browse');
  on('mail-read', async (c, p, m) => {
    const ck = ckOf(p); const mail = findMail(ck, m.id);
    if (mail && !mail.read) { mail.read = 1; markDirty('mail'); if (!await commitFor(c, { docs: ['mail'] })) return; }
    sendBox(c, ck);
  }, 'browse');
  on('mail-delete', async (c, p, m) => {
    const ck = ckOf(p); const mail = findMail(ck, m.id);
    if (!mail) return;
    if (mail.gold || mail.items?.length) { err(c, 'Take the attachments first.'); return; }
    db.mail.boxes[ck] = db.mail.boxes[ck].filter((x) => x !== mail); markDirty('mail');
    if (!await commitFor(c, { docs: ['mail'] })) return;
    sendBox(c, ck);
  });
  on('mail-claim', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const ck = ckOf(p); const mail = findMail(ck, m.id);
    if (!mail || (!mail.gold && !mail.items?.length)) { err(c, 'Nothing to take.', 'gone'); return; }
    const items = mail.items || [];
    if (rec.progress.inventory.length + items.length > ECON.BAG_SIZE) { err(c, `Make room in your bag first (${items.length} slot${items.length > 1 ? 's' : ''}).`, 'bag'); return; }
    if ((rec.progress.gold | 0) + mail.gold > ECON.GOLD_MAX) { err(c, 'You cannot carry that much gold.', 'gold'); return; }
    const gold = mail.gold | 0;
    mail.gold = 0; mail.items = []; mail.read = 1; markDirty('mail');
    const delta = mutate(p, rec, { gold, add: items });
    ledger({ op: 'mail-claim', id: mail.id, to: ck, gold, items, rev: rec.rev });
    if (!await commitFor(c, { docs: ['mail'], deviceKeys: [dkOf(p)] })) return;
    sync(c, rec, 'mail-claim', delta);
    sendBox(c, ck);
  });
  on('mail-send', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const ck = ckOf(p);
    const toName = cleanCharName(m.to);
    const toKey = toName.toLowerCase();
    const to = Object.prototype.hasOwnProperty.call(db.names.names, toKey) ? db.names.names[toKey] : undefined;
    if (!toName || !to) { err(c, `Nobody named "${toName}" has visited this world.`, 'noname'); return; }
    if (to === ck) { err(c, 'You cannot mail yourself.'); return; }
    const items = itemList(m.items, ECON.MAIL_ITEMS);
    const gold = goldAmount(m.gold ?? 0);
    if (items === null || gold === null) { suspicious(room, c, p, 'bad-mail', { items: m.items, gold: m.gold }); err(c, 'Invalid attachments.', 'invalid'); return; }
    if (!hasItems(rec.progress.inventory, items)) { suspicious(room, c, p, 'mail-missing', { items }); err(c, 'Those items are not in your bag (server copy).', 'missing'); sync(c, rec, 'mail'); return; }
    const cost = gold + ECON.MAIL_POSTAGE;
    if ((rec.progress.gold | 0) < cost) { err(c, `You need ${cost} gold (incl. ${ECON.MAIL_POSTAGE}g postage).`, 'gold'); return; }
    const box = db.mail.boxes[to] || [];
    if (box.filter((x) => !x.sys).length >= ECON.MAIL_BOX_MAX) { err(c, `${toName}'s mailbox is full.`); return; }
    const subject = cleanLine(m.subject, ECON.SUBJECT_MAX) || '(no subject)';
    const body = cleanLine(m.body, ECON.TEXT_MAX);
    const delta = mutate(p, rec, { gold: -cost, remove: items });
    const recipientMail = deliverMail(to, { sys: 0, from: p.name, subject, body, gold, items });
    ledger({ op: 'mail-send', from: ck, to, gold, items, rev: rec.rev });
    if (!await commitFor(c, { docs: ['mail'], deviceKeys: [dkOf(p)] })) return;
    notifyMail(to, recipientMail);
    sync(c, rec, 'mail-send', delta);
    note(c, `Mail sent to ${toName}${gold || items.length ? ' with attachments' : ''} (${ECON.MAIL_POSTAGE}g postage).`);
  });

  // ── guilds (persisted; overrides the in-memory social.js stub handlers) ──
  on('guild-info', (c, p) => sendGuild(room, c.sessionId, ckOf(p)), 'browse');
  on('guild-create', async (c, p, m) => {
    const ck = ckOf(p); if (!ck) { err(c, 'Guilds need a saved online character.'); return; }
    if (db.guilds.memberOf[ck]) { err(c, 'Leave your guild first (/gleave).'); return; }
    const tag = String(m.tag || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
    if (tag.length < 2) { err(c, 'Guild tag must be 2-4 letters/digits.'); return; }
    if (db.guilds.guilds[tag]) { err(c, `Guild <${tag}> already exists.`); return; }
    const name = cleanLine(m.name, 24) || tag;
    db.guilds.guilds[tag] = { tag, name, leader: ck, members: { [ck]: { name: p.name, rank: 'leader', joined: now() } }, motd: 'Welcome!', bank: 0, log: [], created: now() };
    db.guilds.memberOf[ck] = tag;
    glog(tag, `${p.name} founded the guild.`);
    markDirty('guilds');
    ledger({ op: 'guild-create', tag, by: ck });
    if (!await commitFor(c, { docs: ['guilds'] })) return;
    refreshGuild(tag, true);
  });
  on('guild-join', async (c, p, m) => {
    const ck = ckOf(p);
    const inv = ck && INVITES.get(ck);
    const tag = String(m.tag || '').toUpperCase();
    if (inv && inv.until > now() && (!tag || tag === inv.tag)) { await acceptInvite(room, c, p); return; }
    err(c, 'Guilds are invite-only: ask an officer to /ginvite you.');
  });
  on('guild-accept', async (c, p) => acceptInvite(room, c, p));
  on('guild-decline', (c, p) => {
    const ck = ckOf(p); const inv = ck && INVITES.get(ck);
    if (!inv) return;
    INVITES.delete(ck);
    const from = ONLINE.get(inv.fromCk);
    if (from) send(from.room, from.sid, 'econ-msg', { text: `${p.name} declined the guild invite.` });
  });
  on('guild-invite', (c, p, m) => {
    const ck = ckOf(p); const g = guildOf(ck);
    if (!g) { err(c, 'You are not in a guild.'); return; }
    if (!['leader', 'officer'].includes(g.members[ck]?.rank)) { err(c, 'Only the leader and officers can invite.'); return; }
    const want = cleanCharName(m.name).toLowerCase();
    const hit = [...ONLINE.entries()].find(([k, v]) => v.room.players.get(v.sid)?.name.toLowerCase() === want && k !== ck);
    if (!want || !hit) { err(c, `No player named "${cleanCharName(m.name)}" is online.`); return; }
    const [tck, where] = hit;
    if (db.guilds.memberOf[tck]) { err(c, 'That player is already in a guild.'); return; }
    if (Object.keys(g.members).length >= 100) { err(c, 'Your guild is full (100).'); return; }
    INVITES.set(tck, { tag: g.tag, fromCk: ck, until: now() + 60_000 });
    send(where.room, where.sid, 'guild-invite', { tag: g.tag, name: g.name, from: p.name });
    note(c, `Guild invite sent to ${where.room.players.get(where.sid)?.name}.`);
  });
  on('guild-leave', async (c, p) => {
    const ck = ckOf(p); const g = guildOf(ck);
    if (!g) { err(c, 'You are not in a guild.'); return; }
    if (await removeMember(g, ck, `${p.name} left the guild.`, c)) note(c, `You left <${g.tag}>.`);
  });
  on('guild-kick', async (c, p, m) => {
    const ck = ckOf(p); const g = guildOf(ck);
    if (!g) { err(c, 'You are not in a guild.'); return; }
    const t = memberByName(g, m.name);
    if (!t || t === ck) { err(c, 'No such guild member.'); return; }
    const mine = g.members[ck].rank; const theirs = g.members[t].rank;
    if (!(mine === 'leader' || (mine === 'officer' && theirs === 'member'))) { err(c, 'You cannot kick that member.'); return; }
    const name = g.members[t].name;
    if (!await removeMember(g, t, `${name} was removed by ${p.name}.`, c)) return;
    const on2 = ONLINE.get(t); if (on2) send(on2.room, on2.sid, 'econ-msg', { text: `You were removed from <${g.tag}>.` });
  });
  on('guild-rank', async (c, p, m) => {
    const ck = ckOf(p); const g = guildOf(ck);
    if (!g || g.members[ck].rank !== 'leader') { err(c, 'Only the guild leader can change ranks.'); return; }
    const t = memberByName(g, m.name);
    if (!t || t === ck) { err(c, 'No such guild member.'); return; }
    const rank = ['leader', 'officer', 'member'].includes(m.rank) ? m.rank : null;
    if (!rank) { err(c, 'Rank must be leader, officer or member.'); return; }
    if (rank === 'leader') { g.members[ck].rank = 'officer'; g.leader = t; }
    g.members[t].rank = rank;
    glog(g.tag, `${p.name} made ${g.members[t].name} ${rank}.`);
    markDirty('guilds');
    if (!await commitFor(c, { docs: ['guilds'] })) return;
    refreshGuild(g.tag);
  });
  on('guild-motd', async (c, p, m) => {
    const ck = ckOf(p); const g = guildOf(ck);
    if (!g || !['leader', 'officer'].includes(g.members[ck].rank)) { err(c, 'Only the leader and officers can set the MOTD.'); return; }
    g.motd = cleanLine(m.text, ECON.MOTD_MAX);
    glog(g.tag, `${p.name} set the message of the day.`);
    markDirty('guilds');
    if (!await commitFor(c, { docs: ['guilds'] })) return;
    refreshGuild(g.tag);
  });
  on('guild-deposit', async (c, p, m) => {
    const ck = ckOf(p); const g = guildOf(ck);
    if (!g) { err(c, 'You are not in a guild.'); return; }
    const rec = requireRec(c, p, m); if (!rec) return;
    const gold = goldAmount(m.gold);
    if (!gold) { err(c, 'Deposit a whole number of gold.', 'invalid'); return; }
    if ((rec.progress.gold | 0) < gold) { err(c, 'You do not have that much gold.', 'gold'); return; }
    if (g.bank + gold > ECON.GOLD_MAX * 10) { err(c, 'The guild bank is full.'); return; }
    g.bank += gold; glog(g.tag, `${p.name} deposited ${gold}g.`); markDirty('guilds');
    const delta = mutate(p, rec, { gold: -gold });
    ledger({ op: 'guild-deposit', tag: g.tag, by: ck, gold, bank: g.bank, rev: rec.rev });
    if (!await commitFor(c, { docs: ['guilds'], deviceKeys: [dkOf(p)] })) return;
    sync(c, rec, 'guild-deposit', delta);
    refreshGuild(g.tag);
  });
  on('guild-withdraw', async (c, p, m) => {
    const ck = ckOf(p); const g = guildOf(ck);
    if (!g || g.members[ck].rank !== 'leader') { err(c, 'Only the guild leader can withdraw.'); return; }
    const rec = requireRec(c, p, m); if (!rec) return;
    const gold = goldAmount(m.gold);
    if (!gold || gold > g.bank) { err(c, `The bank holds ${g.bank}g.`, 'invalid'); return; }
    if ((rec.progress.gold | 0) + gold > ECON.GOLD_MAX) { err(c, 'You cannot carry that much gold.', 'gold'); return; }
    g.bank -= gold; glog(g.tag, `${p.name} withdrew ${gold}g.`); markDirty('guilds');
    const delta = mutate(p, rec, { gold });
    ledger({ op: 'guild-withdraw', tag: g.tag, by: ck, gold, bank: g.bank, rev: rec.rev });
    if (!await commitFor(c, { docs: ['guilds'], deviceKeys: [dkOf(p)] })) return;
    sync(c, rec, 'guild-withdraw', delta);
    refreshGuild(g.tag);
  });

  // ── token-claim (Wayfarer Tokens) ──
  // Fee split: the player still pays the full 5% claim fee in gold. Half (2.5%)
  // goes to the fee treasury; the other half is paid as a token bonus to the
  // referrer when this player was referred. If there is no referrer the entire
  // fee stays in the treasury.
  on('token-claim', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const amount = goldAmount(m.amount); // token points to claim
    if (!amount || amount <= 0) { err(c, 'Enter a whole number of token points to claim.', 'invalid'); return; }
    if ((rec.progress.tokenPoints | 0) < amount) { err(c, `You only have ${rec.progress.tokenPoints | 0} token points.`, 'missing'); return; }
    const fee = Math.max(1, Math.floor(amount * ECON.TOKEN_CLAIM_FEE));
    const net = amount - fee;
    if (net <= 0) { err(c, 'Amount too small after fee.', 'invalid'); return; }
    if ((rec.progress.gold | 0) < fee) { err(c, `You need ${fee} gold to cover the claim fee.`, 'gold'); return; }
    // daily cap tracking
    const today = new Date().toISOString().slice(0, 10);
    const prev = rec.progress.ext?.bridgeDailyClaimed || { date: '', amount: 0 };
    const claimedToday = prev.date === today ? (prev.amount || 0) : 0;
    if (claimedToday + net > ECON.TOKEN_WITHDRAW_DAILY_CAP) {
      err(c, `Daily token claim cap reached: ${claimedToday}/${ECON.TOKEN_WITHDRAW_DAILY_CAP} tokens today.`, 'cap');
      return;
    }
    rec.progress.ext = rec.progress.ext || {};
    rec.progress.ext.bridgeDailyClaimed = { date: today, amount: claimedToday + net };

    rec.progress.tokenPoints = (rec.progress.tokenPoints | 0) - amount;
    rec.progress.wayfarerTokens = (rec.progress.wayfarerTokens | 0) + net;
    rec.progress.gold = (rec.progress.gold | 0) - fee;
    rec.rev = (rec.rev || 0) + 1;
    rec.savedAt = now(); rec.progress.savedAt = rec.savedAt;
    saveChar(p.token, p.name, rec);
    const delta = { gold: -fee, tokenPoints: -amount, wayfarerTokens: net };
    ledger({ op: 'token-claim', ck: ckOf(p), name: p.name, amount, fee, net, rev: rec.rev });
    if (!await commitFor(c, { deviceKeys: [dkOf(p)] })) return;
    const treasuryFee = Math.floor(fee / 2);
    const referralBonus = fee - treasuryFee; // the remainder so fee = treasuryFee + referralBonus
    let bonus = 0;
    try {
      const refs = await import('./referrals.js');
      refs.recordFee(treasuryFee);
      bonus = refs.payReferralTokenBonus(ckOf(p), referralBonus, amount);
    } catch { /* referrals not loaded */ }
    sync(c, rec, 'token-claim', delta);
    note(c, `Claimed ${net} Wayfarer Token${net !== 1 ? 's' : ''} (fee ${fee}g).`);
    if (bonus > 0) note(c, `Your referrer earned ${bonus} Wayfarer Token bonus.`);
  });

  // ── token-spend (Wayfarer Token sinks) ──
  on('token-spend', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const amount = goldAmount(m.amount);
    if (!amount || amount <= 0) { err(c, 'Enter a positive number of tokens to spend.', 'invalid'); return; }
    const type = String(m.type || '');
    if (!ECON.TOKEN_SINK_TYPES.has(type)) { err(c, 'That is not a token sink.', 'invalid'); return; }
    if ((rec.progress.wayfarerTokens | 0) < amount) { err(c, `You only have ${rec.progress.wayfarerTokens | 0} Wayfarer Tokens.`, 'missing'); return; }

    const ext = rec.progress.ext || (rec.progress.ext = {});
    const sinksState = { stashTabs: Math.max(0, Math.min(5, Math.floor(Number(ext.stashTabs)) || 0)) };
    let ok = false, note = '';

    if (type === 'orb-upgrade') {
      const item = String(m.item || '');
      if (!['wayfarer_orb_plus', 'golden_orb_plus'].includes(item)) { err(c, 'Invalid orb upgrade.', 'invalid'); return; }
      // require owning the base orb; the upgrade is the reward (not consumed)
      const base = item === 'wayfarer_orb_plus' ? 'wayfarer_orb' : 'golden_orb';
      if (!hasItems(rec.progress.inventory, [base])) { err(c, `You need a ${base} to upgrade.`, 'missing'); return; }
      if (hasItems(rec.progress.inventory, [item])) { err(c, 'You already own this upgrade.', 'invalid'); return; }
      const cost = item === 'wayfarer_orb_plus' ? 50 : 150;
      if (amount !== cost) { err(c, `This upgrade costs ${cost} tokens.`, 'invalid'); return; }
      ext[item] = (ext[item] || 0) + 1;
      ok = true; note = `Upgraded to ${item.replace(/_/g, ' ')}!`;
    } else if (type === 'revive') {
      const cost = 25;
      if (amount !== cost) { err(c, `Premium revive costs ${cost} tokens.`, 'invalid'); return; }
      ok = true; note = 'Premium revive purchased. Stand up and fight!';
    } else if (type === 'pet-rename') {
      const cost = 10;
      if (amount !== cost) { err(c, `Pet rename costs ${cost} tokens.`, 'invalid'); return; }
      const name = cleanPetName(m.name);
      if (!name) { err(c, 'Pet name must be 1-24 characters.', 'invalid'); return; }
      ok = true; note = `Pet renamed to ${name}.`;
    } else if (type === 'stash-tab') {
      const tabs = sinksState.stashTabs;
      if (tabs >= 5) { err(c, 'You already have the maximum stash tabs.', 'invalid'); return; }
      const cost = 100 * (tabs + 1);
      if (amount !== cost) { err(c, `Next stash tab costs ${cost} tokens.`, 'invalid'); return; }
      ext.stashTabs = tabs + 1;
      sinksState.stashTabs = ext.stashTabs;
      ok = true; note = `Stash tab ${ext.stashTabs}/5 unlocked!`;
    }

    if (!ok) { err(c, 'That token spend could not be completed.', 'invalid'); return; }

    rec.progress.wayfarerTokens = (rec.progress.wayfarerTokens | 0) - amount;
    rec.rev = (rec.rev || 0) + 1;
    rec.savedAt = now(); rec.progress.savedAt = rec.savedAt;
    saveChar(p.token, p.name, rec);
    if (!await commitFor(c, { deviceKeys: [dkOf(p)] })) return;
    ledger({ op: 'token-spend', ck: ckOf(p), name: p.name, type, amount, rev: rec.rev });
    c.send('token-spend-ok', {
      type, amount,
      wayfarerTokens: rec.progress.wayfarerTokens,
      sinksState,
      petId: type === 'pet-rename' ? String(m.petId || '') : undefined,
      name: type === 'pet-rename' ? cleanPetName(m.name) : undefined,
    });
    note(c, note);
  });

  // ── token-stake (mock/devnet holder preview) ──
  // Lock Wayfarer Tokens in-game for a fixed term to earn drop-rate perks.
  // This is a server-side preview: tokens are deducted from the character's
  // wayfarerTokens balance and held in progress.ext.stake until lockedUntil.
  on('token-stake', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const tier = (m.tier || '').toLowerCase();
    const meta = STAKE_TIERS[tier];
    if (!meta) { err(c, 'Invalid stake tier (bronze/silver/gold).', 'invalid'); return; }
    const amount = goldAmount(m.amount);
    if (amount !== meta.amount) { err(c, `${tier} stake requires exactly ${meta.amount} tokens.`, 'invalid'); return; }
    const cur = rec.progress.wayfarerTokens | 0;
    if (cur < amount) { err(c, `You need ${amount} Wayfarer Tokens to ${tier}-stake.`, 'missing'); return; }
    const ext = rec.progress.ext || (rec.progress.ext = {});
    if (ext.stake && ext.stake.amount > 0 && ext.stake.lockedUntil > Date.now()) { err(c, 'You already have an active stake.', 'invalid'); return; }
    rec.progress.wayfarerTokens = cur - amount;
    ext.stake = { amount, lockedUntil: now() + meta.days * 86400000, tier, dropRate: meta.dropRate };
    rec.rev = (rec.rev || 0) + 1;
    rec.savedAt = now(); rec.progress.savedAt = rec.savedAt;
    saveChar(p.token, p.name, rec);
    const delta = { wayfarerTokens: -amount, stake: { ...ext.stake } };
    ledger({ op: 'token-stake', ck: ckOf(p), name: p.name, tier, amount, lockedUntil: ext.stake.lockedUntil, rev: rec.rev });
    if (!await commitFor(c, { deviceKeys: [dkOf(p)] })) return;
    sync(c, rec, 'token-stake', delta);
    note(c, `${tier.charAt(0).toUpperCase() + tier.slice(1)} stake locked: ${amount} tokens for ${meta.days} days (+${Math.round(meta.dropRate * 100)}% drop rate).`);
  });

  // ── wallet binding (prove ownership of a Solana address) ──
  // Issue a nonce challenge, then verify the ed25519 signature of the challenge
  // message against the claimed address before recording a wallet binding.
  on('wallet-bind-challenge', (c, p, m) => {
    const address = String(m.address || '').trim();
    const raw = b58decode(address);
    if (!raw || raw.length !== 32) { err(c, 'That is not a valid Solana wallet address.', 'invalid'); return; }
    const ck = ckOf(p);
    if (!ck) { err(c, 'Your character is not saved on this server yet.', 'nosave'); return; }
    const { nonce, message } = bindChallenge(address);
    BIND_NONCES.set(ck, { nonce, message, address, until: now() + BIND_TTL_MS });
    c.send('wallet-bind-challenge', { address, nonce, message });
  });

  on('wallet-bind', async (c, p, m) => {
    const address = String(m.address || '').trim();
    const signature = String(m.signature || '').trim();
    const ck = ckOf(p);
    const ch = ck && BIND_NONCES.get(ck);
    if (!ch) { err(c, 'Request a fresh link challenge first.', 'nonce'); return; }
    if (ch.until < now()) { BIND_NONCES.delete(ck); err(c, 'That link challenge expired - request a new one.', 'nonce'); return; }
    if (ch.address !== address) { err(c, 'That is not the address you asked to link.', 'invalid'); return; }
    if (!verifySolanaSignature(address, ch.message, signature)) {
      suspicious(room, c, p, 'bad-wallet-sig', { address });
      err(c, 'Signature check failed - your wallet did not sign the challenge.', 'sig');
      return;
    }
    BIND_NONCES.delete(ck);
    const dbm = await bridgeDb();
    const res = (await (dbm?.bindWalletForToken?.(p.token, address))) || { ok: false, error: 'db_unavailable' };
    if (!res.ok) {
      const msg = res.error === 'address_taken' ? 'That wallet is already linked to another account.'
        : res.error === 'already_bound' ? `This character is already linked to ${short(res.address)}.`
          : 'Wallet linking needs the SQLite store (USE_SQLITE=1) on this server.';
      err(c, msg, res.error || 'db');
      return;
    }
    c.send('wallet-bound', { address });
    note(c, `Wallet linked: ${short(address)}.`);
    ledger({ op: 'wallet-bind', ck, address });
    log.info('wallet bind', { ck, address });
  });

  // ── token-withdraw (in-game Wayfarer Tokens -> on-chain devnet $WAYFARER) ──
  on('token-withdraw', async (c, p, m) => {
    const rec = requireRec(c, p, m); if (!rec) return;
    const amount = goldAmount(m.amount);
    if (!amount || amount <= 0) { err(c, 'Enter a whole number of Wayfarer Tokens to withdraw.', 'invalid'); return; }
    const address = boundWalletAddressFor(await bridgeDb(), p);
    if (!address) { err(c, 'Link a Solana wallet before withdrawing.', 'wallet'); return; }
    if ((rec.progress.wayfarerTokens | 0) < amount) { err(c, `You only have ${rec.progress.wayfarerTokens | 0} Wayfarer Tokens.`, 'missing'); return; }
    const fee = Math.max(1, Math.floor(amount * ECON.TOKEN_WITHDRAW_FEE));
    const net = amount - fee;
    if (net <= 0) { err(c, 'Amount too small after the withdraw fee.', 'invalid'); return; }
    // daily cap shares the same fields as token-claim
    const today = new Date().toISOString().slice(0, 10);
    const ext = rec.progress.ext || (rec.progress.ext = {});
    const prev = ext.bridgeDailyClaimed || { date: '', amount: 0 };
    const claimedToday = prev.date === today ? (prev.amount || 0) : 0;
    if (claimedToday + net > ECON.TOKEN_WITHDRAW_DAILY_CAP) {
      err(c, `Daily token cap reached: ${claimedToday}/${ECON.TOKEN_WITHDRAW_DAILY_CAP} tokens today.`, 'cap');
      return;
    }
    if (!withdrawConfigured()) {
      // Honest degradation: no mint, no deduction.
      c.send('token-withdraw-result', { ok: 0, amount, fee, net, status: 'unconfigured', reason: 'The Solana bridge is not configured on this server (SOLANA_RPC / PROGRAM_ID / MINT_ADDRESS / ORACLE_KEYPAIR). Nothing was deducted.' });
      return;
    }

    // Deduct + reserve the daily cap; the row is 'pending' until a mint lands.
    ext.bridgeDailyClaimed = { date: today, amount: claimedToday + net };
    rec.progress.wayfarerTokens = (rec.progress.wayfarerTokens | 0) - amount;
    rec.rev = (rec.rev || 0) + 1;
    rec.savedAt = now(); rec.progress.savedAt = rec.savedAt;
    saveChar(p.token, p.name, rec);
    const delta = { wayfarerTokens: -amount };
    ledger({ op: 'token-withdraw', ck: ckOf(p), name: p.name, address, amount, fee, net, rev: rec.rev });

    // Persist the debit before attempting the irreversible on-chain mint.
    if (!await commitFor(c, { deviceKeys: [dkOf(p)] })) return;
    sync(c, rec, 'token-withdraw', delta);

    const mint = await sendMintWithdraw(address, net);
    const status = mint.signature ? 'sent' : 'pending';
    const dbm = await bridgeDb();
    try { dbm?.insertBridgeWithdrawal?.({ ck: ckOf(p), address, amount, fee, net, status, signature: mint.signature, reason: mint.reason }); } catch { /* bridge ledger is best-effort */ }
    c.send('token-withdraw-result', {
      ok: 1, amount, fee, net, status, signature: mint.signature || undefined,
      reason: mint.signature ? undefined : `Queued for settlement: ${mint.reason || 'the on-chain mint could not be sent'}`,
    });
    note(c, `Withdraw ${status === 'sent' ? 'sent' : 'queued'}: ${net} $WAYFARER to ${short(address)} (fee ${fee}).`);
    log.info('token withdraw', { ck: ckOf(p), address, amount, fee, net, status, reason: mint.reason });
    // fee split: half burned, half into the referral/fee treasury pool
    const treasuryFee = Math.floor(fee / 2);
    try { const refs = await import('./referrals.js'); refs.recordFee(treasuryFee); } catch { /* referrals not loaded */ }
  });

  // ── token-deposit (on-chain $WAYFARER -> in-game Wayfarer Tokens) ──
  on('token-deposit', async (c, p, m) => {
    const rec = requireRec(c, p, m, { needRev: false }); if (!rec) return;
    const signature = String(m.signature || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{40,100}$/.test(signature)) { err(c, 'Paste a valid Solana transaction signature.', 'invalid'); return; }
    const dbm = await bridgeDb();
    const address = boundWalletAddressFor(dbm, p);
    if (!address) { err(c, 'Link the wallet that sent this deposit before claiming it.', 'wallet'); return; }
    if (!depositConfigured()) {
      c.send('token-deposit-result', { ok: 0, amount: 0, credited: 0, reason: 'unconfigured' });
      return;
    }
    let prior = null; try { prior = dbm?.getBridgeDeposit?.(signature) || null; } catch { prior = null; }
    if (prior) {
      c.send('token-deposit-result', { ok: 0, amount: prior.amount | 0, credited: 0, reason: 'That transaction was already credited.' });
      return;
    }
    const v = await verifyDeposit(signature, address);
    if (!v.ok) { c.send('token-deposit-result', { ok: 0, amount: 0, credited: 0, reason: v.reason }); return; }
    const amount = Math.min(v.amount, 1e9); // bound the credit to the validator's int range
    const inserted = dbm?.insertBridgeDeposit
      ? (() => { try { return dbm.insertBridgeDeposit({ signature, ck: ckOf(p), address, amount }); } catch { return false; } })()
      : false;
    if (dbm?.insertBridgeDeposit && !inserted) {
      // lost the race against a concurrent credit of the same signature
      c.send('token-deposit-result', { ok: 0, amount, credited: 0, reason: 'That transaction was already credited.' });
      return;
    }
    rec.progress.wayfarerTokens = (rec.progress.wayfarerTokens | 0) + amount;
    rec.rev = (rec.rev || 0) + 1;
    rec.savedAt = now(); rec.progress.savedAt = rec.savedAt;
    saveChar(p.token, p.name, rec);
    const delta = { wayfarerTokens: amount };
    ledger({ op: 'token-deposit', ck: ckOf(p), signature, amount, rev: rec.rev });
    log.info('token deposit', { ck: ckOf(p), signature, amount });
    if (!await commitFor(c, { deviceKeys: [dkOf(p)] })) return;
    sync(c, rec, 'token-deposit', delta);
    c.send('token-deposit-result', { ok: 1, amount, credited: amount });
    note(c, `Deposit credited: ${amount} Wayfarer Token${amount !== 1 ? 's' : ''}.`);
  });

  // ── token-bridge-state ──
  on('token-bridge-state', async (c, p) => {
    const ck = ckOf(p);
    const rec = charRec(p);
    const ext = rec?.progress?.ext || {};
    const today = new Date().toISOString().slice(0, 10);
    const claimedToday = ext.bridgeDailyClaimed?.date === today ? (ext.bridgeDailyClaimed?.amount || 0) : 0;
    const dbm = await bridgeDb();
    const wallet = ck ? (await (dbm?.getWalletForToken?.(p.token))) : null;
    let pendingWithdrawals = []; let deposits = [];
    try { if (ck) pendingWithdrawals = dbm?.listBridgeWithdrawals?.(ck, 8) || []; } catch { pendingWithdrawals = []; }
    try { if (ck) deposits = dbm?.listBridgeDeposits?.(ck, 8) || []; } catch { deposits = []; }
    c.send('token-bridge-state', {
      configured: withdrawConfigured(),
      depositConfigured: depositConfigured(),
      dbReady: !!dbm,
      address: wallet?.address || '',
      network: CFG.SOLANA_NETWORK,
      withdrawFee: ECON.TOKEN_WITHDRAW_FEE,
      dailyCap: ECON.TOKEN_WITHDRAW_DAILY_CAP,
      claimedToday,
      tokenBalance: rec?.progress?.wayfarerTokens | 0,
      pendingWithdrawals,
      deposits,
    });
  }, 'browse');
}

// ─── trade internals ──────────────────────────────────────────────────
function tradeOf(room, sid) {
  for (const s of TRADES.values()) if (s.room === room && (s.a.sid === sid || s.b.sid === sid)) return s;
  return null;
}
const sideOf = (s, sid) => (s.a.sid === sid ? s.a : s.b.sid === sid ? s.b : null);
const otherOf = (s, sid) => (s.a.sid === sid ? s.b : s.a);
function mySession(room, client, id) {
  const s = TRADES.get(String(id || ''));
  if (!s || s.room !== room || !sideOf(s, client.sessionId)) { err(client, 'That trade is closed.', 'closed'); return null; }
  return s;
}
function unlockAll(s) { for (const x of [s.a, s.b]) { x.locked = false; x.confirmed = false; x.lockRev = null; } s.touched = now(); }
const pub = (x) => ({ name: x.name, items: x.items, gold: x.gold, locked: x.locked, confirmed: x.confirmed });
function pushTrade(s) {
  send(s.room, s.a.sid, 'trade-update', { id: s.id, me: pub(s.a), them: pub(s.b) });
  send(s.room, s.b.sid, 'trade-update', { id: s.id, me: pub(s.b), them: pub(s.a) });
}
function closeTrade(s, reason) {
  if (!TRADES.delete(s.id)) return;
  send(s.room, s.a.sid, 'trade-closed', { id: s.id, reason });
  send(s.room, s.b.sid, 'trade-closed', { id: s.id, reason });
  log.info('econ trade closed', { id: s.id, reason });
}
function failTrade(s, reason) {
  unlockAll(s);
  send(s.room, s.a.sid, 'trade-result', { ok: 0, id: s.id, reason });
  send(s.room, s.b.sid, 'trade-result', { ok: 0, id: s.id, reason });
  pushTrade(s);
  log.info('econ trade failed', { id: s.id, reason });
}
function sweepTrades() {
  const t = now();
  for (const [k, until] of REQUESTS) if (until < t) REQUESTS.delete(k);
  for (const [k, inv] of INVITES) if (inv.until < t) INVITES.delete(k);
  for (const s of [...TRADES.values()]) {
    const pa = s.room.players.get(s.a.sid); const pb = s.room.players.get(s.b.sid);
    if (!pa || !pb || pa.dc || pb.dc) closeTrade(s, 'Your partner disconnected.');
    else if (t - s.touched > TRADE_IDLE_MS) closeTrade(s, 'Trade timed out.');
  }
}

// Atomic swap against both server copies. Validation first, then all
// mutations in one synchronous block, results out, then one durable commit.
async function executeTrade(s) {
  // Race guard: already executing or executed?
  if (s.executing) return;
  s.executing = true;
  const room = s.room;
  const pa = room.players.get(s.a.sid); const pb = room.players.get(s.b.sid);
  if (!pa || !pb || pa.dc || pb.dc) { closeTrade(s, 'Your partner disconnected.'); return; }
  const ra = charRec(pa); const rb = charRec(pb);
  if (!ra || !rb) { failTrade(s, 'A character is not synced with the server.'); return; }
  if ((ra.rev || 0) !== s.a.lockRev || (rb.rev || 0) !== s.b.lockRev) { failTrade(s, 'A bag changed after locking - lock again.'); return; }
  for (const [x, r] of [[s.a, ra], [s.b, rb]]) {
    if (!hasItems(r.progress.inventory, x.items) || x.gold > (r.progress.gold | 0)) { failTrade(s, `${x.name}'s offer is no longer in their bag.`); return; }
  }
  const invA = ra.progress.inventory.length - s.a.items.length + s.b.items.length;
  const invB = rb.progress.inventory.length - s.b.items.length + s.a.items.length;
  if (invA > ECON.BAG_SIZE) { failTrade(s, `${s.a.name}'s bag would be over ${ECON.BAG_SIZE} items.`); return; }
  if (invB > ECON.BAG_SIZE) { failTrade(s, `${s.b.name}'s bag would be over ${ECON.BAG_SIZE} items.`); return; }
  if ((ra.progress.gold | 0) - s.a.gold + s.b.gold > ECON.GOLD_MAX || (rb.progress.gold | 0) - s.b.gold + s.a.gold > ECON.GOLD_MAX) { failTrade(s, 'Gold would exceed the carry limit.'); return; }
  if (!s.a.items.length && !s.b.items.length && !s.a.gold && !s.b.gold) { failTrade(s, 'Nothing to trade.'); return; }

  TRADES.delete(s.id);
  const da = mutate(pa, ra, { gold: s.b.gold - s.a.gold, add: s.b.items, remove: s.a.items });
  const dbb = mutate(pb, rb, { gold: s.a.gold - s.b.gold, add: s.a.items, remove: s.b.items });
  try { await commit({ deviceKeys: [dkOf(pa), dkOf(pb)] }); }
  catch (e) {
    log.error('econ trade not durably committed', { id: s.id, err: e.message });
    send(room, s.a.sid, 'econ-error', { msg: 'Trade could not be saved. Please reconnect before trading again.', code: 'storage' });
    send(room, s.b.sid, 'econ-error', { msg: 'Trade could not be saved. Please reconnect before trading again.', code: 'storage' });
    failTrade(s, 'The trade could not be saved.');
    return;
  }
  send(room, s.a.sid, 'trade-result', { ok: 1, id: s.id, ...stateOf(ra), delta: da, partner: s.b.name });
  send(room, s.b.sid, 'trade-result', { ok: 1, id: s.id, ...stateOf(rb), delta: dbb, partner: s.a.name });
  ledger({ op: 'trade', id: s.id, a: { ck: s.a.ck, name: s.a.name, gave: s.a.items, gold: s.a.gold, rev: ra.rev }, b: { ck: s.b.ck, name: s.b.name, gave: s.b.items, gold: s.b.gold, rev: rb.rev } });
  log.info('econ trade done', { id: s.id, a: s.a.name, b: s.b.name, aGave: s.a.items.length, aGold: s.a.gold, bGave: s.b.items.length, bGold: s.b.gold });
}

// ─── market sweep / mail internals ────────────────────────────────────
async function sweepMarket() {
  const t = now();
  let n = 0;
  const notices = [];
  for (const l of Object.values(db.market.listings)) {
    if (l.expiresAt > t) continue;
    delete db.market.listings[l.id];
    notices.push([l.seller, deliverMail(l.seller, { sys: 1, from: 'Market Board', subject: `Expired: ${gname(l.item)}`, body: `Nobody bought your ${gname(l.item)} (${l.price}g). The item is attached.`, gold: 0, items: [l.item] })]);
    ledger({ op: 'market-expire', id: l.id, seller: l.seller, item: l.item });
    n++;
  }
  if (n) {
    markDirty('market');
    log.info('econ market expired', { n });
    try {
      await commit({ docs: ['market', 'mail'] });
      for (const [ck, mail] of notices) notifyMail(ck, mail);
    } catch (e) { log.error('econ market expiry commit failed', { err: e.message, expired: n }); }
  }
}
function deliverMail(ck, mail) {
  const box = (db.mail.boxes[ck] ||= []);
  const m = { id: `M${++db.mail.seq}`, at: now(), read: 0, ...mail };
  box.push(m);
  if (box.length > 200) { // trim oldest read mails without attachments
    const drop = box.filter((x) => x.read && !x.gold && !x.items?.length).slice(0, box.length - 200);
    db.mail.boxes[ck] = box.filter((x) => !drop.includes(x));
  }
  markDirty('mail');
  return m;
}
function notifyMail(ck, mail) {
  const on = ONLINE.get(ck);
  if (on && mail) send(on.room, on.sid, 'mail-unread', { n: (db.mail.boxes[ck] || []).filter((x) => !x.read).length, subject: mail.subject, from: mail.from });
}
const findMail = (ck, id) => (ck ? (db.mail.boxes[ck] || []).find((x) => x.id === id) : null);
function sendBox(client, ck) {
  const box = ck ? db.mail.boxes[ck] || [] : [];
  client.send('mail-box', { unread: box.filter((x) => !x.read).length, mails: box.slice(-60).reverse() });
}

// ─── guild internals ──────────────────────────────────────────────────
const guildOf = (ck) => { const tag = ck && db.guilds.memberOf[ck]; return tag ? db.guilds.guilds[tag] || null : null; };
function memberByName(g, name) {
  const n = cleanCharName(name).toLowerCase();
  return Object.keys(g.members).find((k) => g.members[k].name.toLowerCase() === n) || null;
}
function glog(tag, text) {
  const g = db.guilds.guilds[tag]; if (!g) return;
  g.log.push({ t: now(), text }); if (g.log.length > 30) g.log.splice(0, g.log.length - 30);
}
async function acceptInvite(room, c, p) {
  const ck = ckOf(p); const inv = ck && INVITES.get(ck);
  INVITES.delete(ck);
  if (!inv || inv.until < now()) { err(c, 'No pending guild invite.'); return; }
  const g = db.guilds.guilds[inv.tag];
  if (!g) { err(c, 'That guild no longer exists.'); return; }
  if (db.guilds.memberOf[ck]) { err(c, 'Leave your guild first (/gleave).'); return; }
  g.members[ck] = { name: p.name, rank: 'member', joined: now() };
  db.guilds.memberOf[ck] = g.tag;
  glog(g.tag, `${p.name} joined the guild.`);
  markDirty('guilds');
  ledger({ op: 'guild-join', tag: g.tag, who: ck });
  if (!await commitFor(c, { docs: ['guilds'] })) return;
  refreshGuild(g.tag, true);
}
async function removeMember(g, ck, why, client) {
  const on = ONLINE.get(ck);
  delete g.members[ck];
  delete db.guilds.memberOf[ck];
  glog(g.tag, why);
  const left = Object.keys(g.members);
  if (!left.length) {
    delete db.guilds.guilds[g.tag];
    ledger({ op: 'guild-disband', tag: g.tag, bank: g.bank });
    log.info('econ guild disbanded', { tag: g.tag, bank: g.bank });
  } else if (g.leader === ck) {
    const next = left.find((k) => g.members[k].rank === 'officer') || left.sort((a, b) => g.members[a].joined - g.members[b].joined)[0];
    g.leader = next; g.members[next].rank = 'leader';
    glog(g.tag, `${g.members[next].name} is now the guild leader.`);
  }
  markDirty('guilds');
  if (!await commitFor(client, { docs: ['guilds'] })) return false;
  if (on) {
    linkSocial(on.room, on.sid, '');
    send(on.room, on.sid, 'guild-info', { tag: '' });
    send(on.room, on.sid, 'guild-update', { tag: '', name: '', members: [] });
  }
  if (left.length) refreshGuild(g.tag, true);
  return true;
}
function guildPayload(g, ck) {
  return {
    tag: g.tag, name: g.name, motd: g.motd, bank: g.bank, leader: g.members[g.leader]?.name || '',
    myRank: g.members[ck]?.rank || '',
    members: Object.entries(g.members).map(([k, v]) => ({ name: v.name, rank: v.rank, online: ONLINE.has(k) ? 1 : 0 }))
      .sort((a, b) => ['leader', 'officer', 'member'].indexOf(a.rank) - ['leader', 'officer', 'member'].indexOf(b.rank) || b.online - a.online || a.name.localeCompare(b.name)),
    log: g.log.slice(-12),
  };
}
function sendGuild(room, sid, ck, legacy = false) {
  const g = guildOf(ck);
  if (!g) { send(room, sid, 'guild-info', { tag: '' }); return; }
  send(room, sid, 'guild-info', guildPayload(g, ck));
  if (legacy) send(room, sid, 'guild-update', { tag: g.tag, name: g.name, members: Object.values(g.members).map((v) => v.name) });
}
// push guild state to every online member; membership changes also refresh the
// social.js per-room guild (guild chat channel, <TAG> on nameplates)
function refreshGuild(tag, membership = false) {
  const g = db.guilds.guilds[tag]; if (!g) return;
  for (const ck of Object.keys(g.members)) {
    const on = ONLINE.get(ck); if (!on) continue;
    if (membership) linkSocial(on.room, on.sid, tag);
    sendGuild(on.room, on.sid, ck, membership);
  }
}
function linkSocial(room, sid, tag) {
  const s = room.social; const info = s?.players?.get(sid);
  if (!info) return;
  if (info.guild && info.guild !== tag) {
    const og = s.guilds.get(info.guild);
    if (og) { og.members = og.members.filter((x) => x !== sid); if (!og.members.length) s.guilds.delete(og.tag); }
  }
  info.guild = tag || '';
  if (tag) {
    const g = db.guilds.guilds[tag];
    let rg = s.guilds.get(tag);
    if (!rg) { rg = { tag, name: g?.name || tag, members: [] }; s.guilds.set(tag, rg); }
    rg.name = g?.name || rg.name;
    if (!rg.members.includes(sid)) rg.members.push(sid);
  }
  try { room.broadcast('presence', { id: sid, name: info.name, level: info.level, job: info.job, zone: info.zone, guild: info.guild, party: info.party || '' }); } catch { /* ignore */ }
}
