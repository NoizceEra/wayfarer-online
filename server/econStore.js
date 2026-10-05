import fs from 'fs';
import path from 'path';
import { CFG } from './config.js';
import { log } from './log.js';
import { charFile, charDocJson, storeIdle, storeDir } from './store.js';

// Server-wide economy persistence (market, mail, guilds, name registry), used
// by server/economy.js. Plain JSON files under DATA_DIR/economy/:
//   market.json  {seq, listings: {id: listing}}
//   mail.json    {seq, boxes: {charKey: [mail]}}
//   guilds.json  {guilds: {TAG: guild}, memberOf: {charKey: TAG}}
//   names.json   {names: {nameLower: charKey}}   first device to use a name owns it (mail by name)
//   ledger.jsonl append-only audit log of every economy mutation (rotated at 5 MB)
//
// Writes: tmp file + fsync + rename (never a half-written file). Docs are
// write-behind (every SAVE_FLUSH_MS, and on shutdown) unless an operation moves
// items or gold, in which case commit() writes every affected file - economy
// docs AND the character device files in DATA_DIR/players - as ONE
// transaction:
//   1. write every new file as <file>.<txid>.txn (fsync)
//   2. write txn.json listing the renames (atomic)   <- commit point
//   3. rename each .txn over its target, then delete txn.json
// On boot, a leftover txn.json is rolled forward and stray .txn files are
// deleted, so a trade can never be half-applied (one side paid, the other not).
const DIR = path.join(CFG.DATA_DIR, 'economy');
const TXN = path.join(DIR, 'txn.json');
const LEDGER = path.join(DIR, 'ledger.jsonl');
const DEFAULTS = {
  market: () => ({ seq: 0, listings: {} }),
  mail: () => ({ seq: 0, boxes: {} }),
  guilds: () => ({ guilds: {}, memberOf: {} }),
  names: () => ({ names: {} }),
};
export const db = {};
const dirty = new Set();
let timer = null;
let txSeq = 0;
const fileOf = (name) => path.join(DIR, `${name}.json`);

function writeTmp(file, data, id) {
  const tmp = `${file}.${id}.txn`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return tmp;
}
function writeAtomicSync(file, data) {
  const tmp = writeTmp(file, data, `${process.pid}-${Date.now().toString(36)}-${txSeq++}`);
  fs.renameSync(tmp, file);
}

function recover() {
  if (fs.existsSync(TXN)) {
    try {
      const j = JSON.parse(fs.readFileSync(TXN, 'utf8'));
      let n = 0;
      for (const [tmp, final] of j.files || []) if (fs.existsSync(tmp)) { fs.renameSync(tmp, final); n++; }
      log.warn('econ: rolled forward interrupted transaction', { id: j.id, files: n });
    } catch (e) { log.error('econ: txn.json unreadable, discarding', { err: e.message }); }
    try { fs.unlinkSync(TXN); } catch { /* ignore */ }
  }
  // anything still named .txn was never committed
  for (const dir of [DIR, storeDir()]) {
    let list = [];
    try { list = fs.readdirSync(dir); } catch { continue; }
    for (const f of list) if (f.endsWith('.txn')) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
  }
}

export function initEconStore() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(storeDir(), { recursive: true });
  recover();
  for (const [name, make] of Object.entries(DEFAULTS)) {
    let doc = make();
    try {
      const parsed = JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
      if (parsed && typeof parsed === 'object') doc = { ...doc, ...parsed };
    } catch (e) { if (e.code !== 'ENOENT') log.error(`econ: ${name}.json unreadable (starting empty)`, { err: e.message }); }
    db[name] = doc;
  }
  timer = setInterval(() => { try { flushEcon(); } catch (e) { log.error('econ flush failed', { err: e.message }); } }, CFG.SAVE_FLUSH_MS);
  timer.unref?.();
  log.info('econ store ready', {
    dir: DIR, listings: Object.keys(db.market.listings).length, mailboxes: Object.keys(db.mail.boxes).length,
    guilds: Object.keys(db.guilds.guilds).length,
  });
}

export const markDirty = (name) => { dirty.add(name); };

export function flushEcon() {
  for (const name of [...dirty]) {
    dirty.delete(name);
    try { writeAtomicSync(fileOf(name), JSON.stringify(db[name])); } catch (e) { dirty.add(name); log.error('econ write failed', { name, err: e.message }); }
  }
}

// Durably write economy docs + character device files (store keys) together.
export async function commit({ docs = [], deviceKeys = [] }) {
  const id = `${process.pid}-${Date.now().toString(36)}-${txSeq++}`;
  const pairs = [];
  let committed = false;
  try {
    await storeIdle(); // never race an in-flight write-behind flush of the same file
    for (const name of new Set(docs)) pairs.push([writeTmp(fileOf(name), JSON.stringify(db[name]), id), fileOf(name)]);
    for (const key of new Set(deviceKeys)) pairs.push([writeTmp(charFile(key), charDocJson(key), id), charFile(key)]);
    writeAtomicSync(TXN, JSON.stringify({ id, at: Date.now(), files: pairs }));
    // txn.json is the transaction's commit point. If a later rename fails,
    // boot recovery will finish these renames, so retain the journal.
    committed = true;
    for (const [tmp, final] of pairs) fs.renameSync(tmp, final);
    fs.unlinkSync(TXN);
    for (const name of new Set(docs)) dirty.delete(name);
  } catch (e) {
    // Before the commit point, remove staged files. After it, preserve txn.json
    // so startup can roll the transaction forward. Keep docs dirty for retry.
    if (!committed) for (const [tmp] of pairs) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    for (const name of docs) dirty.add(name);
    log.error('econ commit failed', { id, err: e.message });
    throw e;
  }
}

export function ledger(entry) {
  try {
    const st = fs.statSync(LEDGER, { throwIfNoEntry: false });
    if (st && st.size > 5 * 1048576) fs.renameSync(LEDGER, `${LEDGER}.1`);
    fs.appendFileSync(LEDGER, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
  } catch (e) { log.warn('econ ledger write failed', { err: e.message }); }
}

export function stopEcon() { if (timer) clearInterval(timer); timer = null; }
