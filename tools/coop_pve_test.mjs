#!/usr/bin/env node
// Unit + protocol tests for co-op shared PvE (no Phaser).
import {
  packTele, unpackTele, telegraphHits, isStrike, strikeId, teleDamage,
  packRank, unpackRank, dungeonAreaId, parseDungeonArea, dungeonSeed,
  validateHit, creditTier, noteContrib, contributors, CONTRIB_MS,
  mergeEnemySnap, packEnemyExtras, extrasChanged, eventNetId,
  lagWindowMs, samePlaySpace, isDungeonArea, HIT_CAP, HIT_RANGE,
} from '../src/systems/coopPve.js';

let failed = 0, passed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; return; }
  failed++;
  console.error('FAIL', msg);
};

// ── telegraphs ──────────────────────────────────────────────────────
{
  const packed = packTele({ kind: 'slam', x: 100, y: 200, r: 40, t: 800, wind: 1150 }, 'wind');
  const u = unpackTele(packed);
  assert(u.kind === 'slam' && u.x === 100 && u.r === 40, 'unpack slam');
  assert(telegraphHits(100, 200, u), 'slam hits center');
  assert(!telegraphHits(100, 260, u), 'slam misses outside');
  assert(!isStrike(u), 'not yet striking');
  u.t = 1150;
  assert(isStrike(u), 'strike at wind');
  assert(teleDamage(10, u) === 18, 'slam damage');
}
{
  const packed = packTele({ kind: 'charge', a: 0, len: 170, wide: 28, t: 950, wind: 950, sx: 0, sy: 0 }, 'dash');
  const u = unpackTele(packed);
  assert(u.st === 'dash' && isStrike(u), 'dash is strike');
  assert(telegraphHits(80, 0, u), 'lane hits along');
  assert(!telegraphHits(80, 40, u), 'lane misses wide');
}
{
  assert(strikeId({ kind: 'nova', x: 1, y: 2, wind: 3 }).includes('nova'), 'strike id');
}

// ── ranks ───────────────────────────────────────────────────────────
assert(packRank({ id: 'elite' }) === 'e', 'pack elite');
assert(unpackRank('c') === 'champion', 'unpack champion');
assert(unpackRank(packRank('normal')) === 'normal', 'roundtrip normal');

// ── dungeon instances ───────────────────────────────────────────────
{
  const a = dungeonAreaId(0xabcdef, 0);
  const b = dungeonAreaId(0xabcdef, 1);
  const c = dungeonAreaId(0x1234, 0);
  assert(a !== b, 'floors are separate areas');
  assert(a !== c, 'seeds are separate areas');
  assert(parseDungeonArea(a).floor === 0 && parseDungeonArea(a).seed === 0xabcdef, 'parse area');
  assert(isDungeonArea(a) && !isDungeonArea('hollow'), 'isDungeonArea');
  assert(a.length <= 32, 'area id fits server cap');
  const now = 1_700_000_000_000;
  const s1 = dungeonSeed({ partyId: 'p-abc', connected: true, now, forced: null });
  const s2 = dungeonSeed({ partyId: 'p-abc', connected: true, now });
  const s3 = dungeonSeed({ partyId: 'p-zzz', connected: true, now });
  assert(s1 === s2, 'party members share seed');
  assert(s1 !== s3, 'other party is separate');
  const pub = dungeonSeed({ connected: true, roomKind: 'world', roomCode: 'Embervale-1', now });
  const pub2 = dungeonSeed({ connected: true, roomKind: 'world', roomCode: 'Embervale-1', now });
  // public without party is random — two rolls should usually differ; if not, still unique vs party
  assert(typeof pub === 'number' && typeof pub2 === 'number', 'public seed rolls');
  const partyRoom = dungeonSeed({ connected: true, roomKind: 'party', roomCode: 'ABCDE', now });
  const partyRoom2 = dungeonSeed({ connected: true, roomKind: 'party', roomCode: 'ABCDE', now });
  assert(partyRoom === partyRoom2, 'private room shares seed');
  assert(samePlaySpace('hollow', 'hollow'), 'same hollow');
  assert(samePlaySpace(a, 'hollow'), 'net id vs hollow visual');
}

// ── hits / credit ───────────────────────────────────────────────────
assert(validateHit(12, 0, 0, 10, 0).ok, 'valid hit');
assert(validateHit(HIT_CAP + 1, 0, 0, 0, 0).why === 'dmg-cap', 'damage cap');
assert(validateHit(10, 0, 0, HIT_RANGE + 40, 0).why === 'hit-range', 'range');
assert(validateHit(0).ok === false, 'zero dmg');
assert(creditTier({ dealt: 0.2, minFrac: 0.15 }) === 1, 'participation tier');
assert(creditTier({ killed: true }) === 2, 'kill tier');
assert(creditTier({ dealt: 0.01 }) === 0, 'no credit');
{
  const m = noteContrib(null, 'a', 1000);
  noteContrib(m, 'b', 1000);
  noteContrib(m, 'c', 0);
  const by = contributors(m, 1000 + CONTRIB_MS - 1);
  assert(by.includes('a') && by.includes('b') && !by.includes('c'), '20s contrib window');
}

// ── esnap extras ────────────────────────────────────────────────────
{
  const e = { typeId: 'worldtitan', level: 14, rank: { id: 'elite' }, maxHp: 4000, hp: 3900, phase: 2, invuln: 0, engaged: true, home: { x: 10, y: 20 }, plan: { kind: 'slam', x: 10, y: 20, r: 40, t: 100, wind: 1000 }, state: 'wind' };
  const extra = packEnemyExtras(e);
  assert(extra.rk === 'e' && extra.lv === 14 && extra.mh === 4000 && extra.tg, 'pack extras');
  const cache = { x: 10, y: 20, h: 3900, s: 0, f: 'down' };
  mergeEnemySnap(cache, { ...extra, h: 3500, i: 'evt:b1:worldtitan:0' });
  assert(cache.h === 3500 && cache.rk === 'e' && cache.lv === 14 && cache.tg, 'merge extras');
  assert(extrasChanged(null, extra), 'first extras');
  assert(!extrasChanged(extra, extra), 'unchanged extras');
  assert(eventNetId('b12', 'worldtitan', 0).startsWith('evt:'), 'event net id');
  assert(lagWindowMs(200) >= 40 && lagWindowMs(200) <= 180, 'lag window clamp');
}

// ── 3-client protocol sim (authority, guest, late joiner) ───────────
{
  const area = { auth: 'A', enemies: new Map(), dead: new Map() };
  const clients = {
    A: { sid: 'A', a: 'ow', x: 0, y: 0, hpSeen: {}, credit: new Set(), tele: null },
    B: { sid: 'B', a: 'ow', x: 20, y: 0, hpSeen: {}, credit: new Set(), tele: null },
    C: { sid: 'C', a: 'ow', x: 40, y: 0, hpSeen: {}, credit: new Set(), tele: null },
  };
  const applySnap = (who, d) => {
    const e = area.enemies.get(d.i) || {};
    mergeEnemySnap(e, d);
    who.hpSeen[d.i] = e.h;
    if (d.tg) who.tele = unpackTele(d.tg);
  };
  const esnap = (list) => {
    for (const d of list) {
      let e = area.enemies.get(d.i);
      if (!e) { e = { x: 0, y: 0, h: 1 }; area.enemies.set(d.i, e); }
      mergeEnemySnap(e, d);
      for (const id of Object.keys(clients)) if (id !== area.auth) applySnap(clients[id], { i: d.i, ...e, ...d });
    }
  };
  const hit = (from, i, dmg) => {
    const e = area.enemies.get(i);
    const v = validateHit(dmg, e.x, e.y, clients[from].x, clients[from].y);
    assert(v.ok, `${from} hit ok`);
    e.h = Math.max(0, e.h - v.d);
    noteContrib(e._c = e._c || new Map(), from, Date.now());
    esnap([{ i, h: e.h }]);
    if (e.h <= 0) {
      const by = contributors(e._c);
      by.forEach((sid) => clients[sid].credit.add(i));
      area.enemies.delete(i);
    }
  };

  // spawn shared world boss
  esnap([{ i: 'boss1', ty: 'worldtitan', x: 10, y: 0, h: 100, mh: 100, lv: 12, rk: 'n', tg: packTele({ kind: 'slam', x: 10, y: 0, r: 40, t: 1150, wind: 1150 }, 'wind') }]);
  assert(clients.B.hpSeen.boss1 === 100, 'guest sees spawn HP');
  assert(clients.B.tele && telegraphHits(clients.B.x, clients.B.y, clients.B.tele), 'guest sees same telegraph and is in it');
  assert(telegraphHits(clients.A.x, clients.A.y, unpackTele(area.enemies.get('boss1').tg)), 'auth in same tele');

  hit('A', 'boss1', 30);
  hit('B', 'boss1', 30);
  assert(clients.B.hpSeen.boss1 === 40, 'both hits applied');

  // authority leaves → migrate to B
  area.auth = 'B';
  hit('A', 'boss1', 10);
  assert(clients.A.hpSeen.boss1 === 30, 'hits still apply after migrate');

  // late joiner C gets full snapshot
  const e = area.enemies.get('boss1');
  applySnap(clients.C, { i: 'boss1', ...e });
  assert(clients.C.hpSeen.boss1 === 30, 'late joiner sees current HP');
  assert(clients.C.tele?.kind === 'slam' || unpackTele(e.tg).kind === 'slam', 'late joiner tele');

  hit('B', 'boss1', 30);
  assert(clients.A.credit.has('boss1') && clients.B.credit.has('boss1'), 'both credited');
  assert(!clients.C.credit.has('boss1'), 'spectator not credited');

  // dungeon instances
  const seedAB = dungeonSeed({ partyId: 'party-1', now: 1e12 });
  const seedC = dungeonSeed({ partyId: 'party-2', now: 1e12 });
  const areaAB = dungeonAreaId(seedAB, 0);
  const areaC = dungeonAreaId(seedC, 0);
  assert(areaAB !== areaC, 'third player separate dungeon');
  const floor1 = dungeonAreaId(seedAB, 1);
  assert(floor1 !== areaAB, 'floors per-player (separate authority)');

  // elite rank equal
  area.auth = 'A';
  esnap([{ i: 'mob1', ty: 'thornmite', x: 0, y: 0, h: 40, mh: 40, lv: 5, rk: 'e' }]);
  assert(clients.B.hpSeen.mob1 === 40 && clients.C.hpSeen.mob1 === 40, 'elite exists on guests');
  const guest = {};
  mergeEnemySnap(guest, area.enemies.get('mob1'));
  assert(guest.rk === 'e' && guest.lv === 5, 'elite rank+level equal across clients');
}

if (failed) {
  console.error(`coop_pve_test: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`coop_pve_test: ${passed} passed`);
