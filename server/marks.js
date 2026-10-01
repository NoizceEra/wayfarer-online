import { log } from './log.js';
import { deviceKey } from './store.js';
import { displayName, shortAddr } from './validate.js';
import {
  WCFG, links, board, marksRec, markMarksDirty, markBoardDirty, badgesFor, maybeSeasonAttest, flagsPublic,
} from './walletStore.js';
import {
  evaluate, cleanClaim, awardDaily, tickActive, buy, equip, lookOf, todayOf, COSMETIC_BY_ID, MARKS_VERSION,
} from './shared/marksRules.js';

// Wayfarer Marks (server side). Off-chain, non-transferable, non-purchasable
// cosmetic progress currency, keyed by device (store.deviceKey(token)), for
// EVERY player: no wallet needed. Rules + caps + anti-farm live in
// server/shared/marksRules.js (shared with the client).
//
// Where Marks come from (all server-authoritative):
//  - afterSave hook (WayfarerRoom.onSave, after validate.js accepted + clamped
//    the save): evaluate() with the VALIDATED level/gold and the save's
//    milestone data (progress.ext.ach / ext.counters, sanitised by cleanClaim)
//  - activity sampler: every MARKS_MINUTE_MS a player who actually moved gets
//    an active minute; 5 active minutes in a UTC day -> daily login award
// Nothing the client says about Marks numbers is ever read.
//
// Client -> server                          Server -> client
//  marks-hello {}                            marks-state {...}  (see stateFor)
//  marks-buy {id}                            marks-state + marks-msg {text} | marks-error {msg, code}
//  marks-equip {kind, id|null}               marks-state; room: marks-look {sid, look}
//  marks-board {}                            marks-board {season, rows, me}
//  marks-optin {show, name, showAddr}        marks-state
//  (save accepted)                           marks-award {awards:[{src,n,label}], balance}
//  (join)                                    marks-look {sid, look} for every peer + own look to the room

const ONLINE = new Map(); // dk -> Set of {room, sid}

class Tok {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.t = Date.now(); this.n = burst; }
  take() { const now = Date.now(); this.n = Math.min(this.burst, this.n + ((now - this.t) / 1000) * this.rate); this.t = now; if (this.n < 1) return false; this.n -= 1; return true; }
}

const dkOf = (p) => (p?.token ? (p.mkDk ||= deviceKey(p.token)) : null);
const sendC = (client, type, msg) => { try { client.send(type, msg); } catch { /* closing */ } };
const clientOf = (room, sid) => room.clients.find((c) => c.sessionId === sid) || null;

export function stateFor(dk) {
  const rec = marksRec(dk);
  const m = rec.marks;
  m.badges = badgesFor(dk, rec);
  const l = links.byDevice[dk];
  return {
    v: MARKS_VERSION, enabled: WCFG.MARKS, flags: flagsPublic(),
    balance: m.balance, earned: m.earned, spent: m.spent,
    season: { id: WCFG.SEASON, earned: m.season.id === WCFG.SEASON ? m.season.earned : 0 },
    today: todayOf(m), history: m.history.slice(0, 25),
    owned: m.owned, badges: m.badges, equipped: m.equipped, look: lookOf(m),
    board: { ...rec.board },
    wallet: { linked: !!l, short: l ? shortAddr(l.addr) : '' },
  };
}

// Push fresh state (+ look) to every online session of a device (after a
// wallet link change, a purchase, ...).
export function pushState(dk) {
  const set = ONLINE.get(dk);
  if (!set) return;
  const st = stateFor(dk);
  for (const { room, sid } of set) {
    const c = clientOf(room, sid);
    if (c) sendC(c, 'marks-state', st);
    room.broadcast('marks-look', { sid, look: st.look });
  }
}

function boardUpdate(dk, rec) {
  if (!WCFG.LEADERBOARD) return;
  if (rec.board.show && rec.marks.season.id === WCFG.SEASON) {
    board.rows[dk] = { name: rec.board.name, earned: rec.marks.season.earned, at: Date.now() };
  } else delete board.rows[dk];
  markBoardDirty();
}

export function leaderboard(limit = 50, meDk = null) {
  const all = Object.entries(board.rows).sort((a, b) => b[1].earned - a[1].earned || a[1].at - b[1].at);
  const row = ([dk, r], i) => {
    const l = links.byDevice[dk];
    const rec = marksCache(dk);
    const out = { rank: i + 1, name: r.name, marks: r.earned };
    if (l && links.byAddr[l.addr]?.attest?.some((x) => x.id === 'founder') && WCFG.FOUNDER_BADGE) out.founder = true;
    if (l && rec?.board.showAddr) out.addr = shortAddr(l.addr); // only when the player opted in
    return out;
  };
  const rows = all.slice(0, limit).map(row);
  let me = null;
  if (meDk) { const i = all.findIndex(([dk]) => dk === meDk); if (i >= 0) me = row(all[i], i); }
  return { season: WCFG.SEASON, rows, me, total: all.length };
}
const marksCache = (dk) => { try { return marksRec(dk); } catch { return null; } };

function applyAwards(room, client, p, dk, rec, awards) {
  if (!awards.length) return;
  markMarksDirty(dk);
  boardUpdate(dk, rec);
  const seasonNew = maybeSeasonAttest(dk, rec);
  sendC(client, 'marks-award', { awards, balance: rec.marks.balance });
  if (seasonNew) pushState(dk);
  log.info('marks award', { name: p.name, dk: dk.slice(0, 8), n: awards.reduce((s, a) => s + a.n, 0), src: awards.map((a) => a.src) });
}

// ─── room hooks ───────────────────────────────────────────────────────
export function install(room) {
  if (!WCFG.MARKS) return;
  // server->client types must never ride the generic passthrough (forgery)
  for (const t of ['marks-state', 'marks-award', 'marks-board', 'marks-look', 'marks-error', 'marks-msg']) room.onMessage(t, () => {});
  const on = (type, fn) => room.onMessage(type, (client, m) => {
    const p = room.players.get(client.sessionId);
    if (!p) return;
    const b = (p.mkB ||= new Tok(3, 8));
    if (!b.take()) { sendC(client, 'marks-error', { msg: 'Slow down a little.', code: 'rate' }); return; }
    let size = 0; try { size = JSON.stringify(m ?? null).length; } catch { return; }
    if (size > 512) return;
    const dk = dkOf(p);
    if (!dk) { sendC(client, 'marks-error', { msg: 'Marks need a saved device profile (local storage is blocked?).', code: 'nodevice' }); return; }
    try { fn(client, p, dk, m && typeof m === 'object' && !Array.isArray(m) ? m : {}); } catch (e) { log.warn('marks handler error', { type, err: e.message }); }
  });

  on('marks-hello', (c, p, dk) => sendC(c, 'marks-state', stateFor(dk)));
  on('marks-buy', (c, p, dk, m) => {
    const rec = marksRec(dk);
    const r = buy(rec.marks, typeof m.id === 'string' ? m.id : '');
    if (!r.ok) {
      const why = { unknown: 'That item is not in the shop.', badge: 'Badges cannot be bought.', owned: 'You already own that.', balance: 'Not enough Marks yet - keep playing!' }[r.reason] || 'Cannot buy that.';
      sendC(c, 'marks-error', { msg: why, code: r.reason }); return;
    }
    markMarksDirty(dk);
    log.info('marks buy', { dk: dk.slice(0, 8), id: m.id, balance: rec.marks.balance });
    sendC(c, 'marks-msg', { text: `Unlocked ${COSMETIC_BY_ID[m.id].name}.` });
    pushState(dk);
  });
  on('marks-equip', (c, p, dk, m) => {
    const rec = marksRec(dk);
    rec.marks.badges = badgesFor(dk, rec);
    const r = equip(rec.marks, String(m.kind || ''), m.id === null ? null : String(m.id || ''));
    if (!r.ok) { sendC(c, 'marks-error', { msg: r.reason === 'locked' ? 'Unlock it in the Marks shop first.' : 'Cannot equip that.', code: r.reason }); return; }
    markMarksDirty(dk);
    pushState(dk);
  });
  on('marks-board', (c, p, dk) => {
    if (!WCFG.LEADERBOARD) { sendC(c, 'marks-board', { season: WCFG.SEASON, rows: [], me: null, disabled: true }); return; }
    sendC(c, 'marks-board', leaderboard(50, dk));
  });
  on('marks-optin', (c, p, dk, m) => {
    const rec = marksRec(dk);
    const show = !!m.show;
    const name = show ? displayName(m.name ?? p.name) : '';
    if (show && !name) { sendC(c, 'marks-error', { msg: 'Pick a display name (2-16 letters or digits).', code: 'invalid' }); return; }
    rec.board = { show, name: name || '', showAddr: show && !!m.showAddr };
    markMarksDirty(dk);
    boardUpdate(dk, rec);
    pushState(dk);
  });

  // activity sampler -> daily login award (needs real movement, not just a connection)
  room.clock.setInterval(() => {
    const now = Date.now();
    for (const [sid, p] of room.players) {
      const dk = dkOf(p);
      if (!dk || p.dc) continue;
      const last = p.mkPos;
      p.mkPos = { x: p.x, y: p.y, a: p.a };
      if (!last || (last.a === p.a && Math.hypot(p.x - last.x, p.y - last.y) < 24)) continue;
      const rec = marksRec(dk);
      markMarksDirty(dk);
      if (!tickActive(rec.marks, now)) continue;
      const c = clientOf(room, sid);
      const awards = awardDaily(rec.marks, now, WCFG.SEASON);
      if (c) applyAwards(room, c, p, dk, rec, awards);
    }
  }, WCFG.MINUTE_MS);
}

export function onJoin(room, client, p) {
  if (!WCFG.MARKS) return;
  const dk = dkOf(p);
  if (dk) {
    if (!ONLINE.has(dk)) ONLINE.set(dk, new Set());
    ONLINE.get(dk).add({ room, sid: client.sessionId });
  }
  // looks: everyone else's to the joiner, the joiner's to everyone
  for (const [sid, q] of room.players) {
    if (sid === client.sessionId) continue;
    const qdk = dkOf(q);
    if (!qdk) continue;
    const look = lookOf(marksRec(qdk).marks);
    if (Object.keys(look).length) sendC(client, 'marks-look', { sid, look });
  }
  if (dk) {
    const look = lookOf(marksRec(dk).marks);
    if (Object.keys(look).length) room.broadcast('marks-look', { sid: client.sessionId, look }, { except: client });
  }
}

export function onLeave(room, client, p) {
  const dk = dkOf(p);
  const set = dk && ONLINE.get(dk);
  if (!set) return;
  for (const e of set) if (e.room === room && e.sid === client.sessionId) set.delete(e);
  if (!set.size) ONLINE.delete(dk);
}

// Called by WayfarerRoom.onSave after validate.js accepted the save.
// info = {name, rec (validated progress), raw (client progress as sent), clamped}
export function afterSave(room, client, p, info) {
  if (!WCFG.MARKS) return;
  const dk = dkOf(p);
  if (!dk || !info?.rec) return;
  const rec = marksRec(dk);
  const claim = cleanClaim(info.raw?.ext);
  const { awards, flags } = evaluate(rec.marks, {
    char: info.name, level: info.rec.level, gold: info.rec.gold, claim, now: Date.now(), season: WCFG.SEASON,
  });
  markMarksDirty(dk);
  // repeat counters rising faster than the game allows = tampered save; gates / caps / deferred
  // achievements are normal (clamped level, backfill) and only debug-logged
  const odd = flags.filter((f) => f.startsWith('rep-rate'));
  if (odd.length && room.violation) room.violation(client, p, 'marks-claim', { flags: odd.slice(0, 6) });
  else if (flags.length) log.debug('marks flags', { name: p.name, flags: flags.slice(0, 8) });
  applyAwards(room, client, p, dk, rec, awards);
}
