// Shared co-op PvE helpers (no Phaser). Used by WorldSync / coopSync, the
// relay (optional), and tools/coop_pve_test.mjs. Solo/offline callers no-op.

export const CONTRIB_MS = 20000;
export const HIT_RANGE = 360;
export const HIT_CAP = 20000;
export const DUNGEON_EPOCH_MS = 15 * 60 * 1000;
export const RANK_CODE = { normal: 'n', elite: 'e', champion: 'c' };
export const RANK_FROM = { n: 'normal', e: 'elite', c: 'champion', normal: 'normal', elite: 'elite', champion: 'champion' };
export const TG_KIND = ['slam', 'charge', 'nova', 'zones', 'beams', 'ring'];
const kindIdx = (k) => Math.max(0, TG_KIND.indexOf(k));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function packRank(rank) {
  if (!rank) return 'n';
  const id = typeof rank === 'string' ? rank : rank.id;
  return RANK_CODE[id] || RANK_FROM[id] && RANK_CODE[RANK_FROM[id]] || 'n';
}
export function unpackRank(rk) { return RANK_FROM[rk] || 'normal'; }

// Compact telegraph: numbers-only so esnap stays small.
// [kindIdx, st, t, wind, x, y, r, a, len, wide, sx, sy]
export function packTele(plan, state = 'wind') {
  if (!plan || !plan.kind && !plan.k) return null;
  const k = plan.kind || plan.k;
  const st = state === 'dash' ? 1 : state === 'wind' ? 0 : 2;
  return [
    kindIdx(k), st,
    Math.round(plan.t || 0), Math.round(plan.wind || 0),
    Math.round(plan.x || 0), Math.round(plan.y || 0), Math.round(plan.r || 0),
    Math.round(((plan.a || 0) + Math.PI) * 1000) / 1000 - Math.PI,
    Math.round(plan.len || 0), Math.round(plan.wide || 0),
    Math.round(plan.sx || 0), Math.round(plan.sy || 0),
  ];
}
export function unpackTele(tg) {
  if (!tg) return null;
  if (!Array.isArray(tg)) return tg.k ? { ...tg, kind: tg.k } : tg;
  const k = TG_KIND[tg[0]] || 'slam';
  return {
    k, kind: k, st: tg[1] === 1 ? 'dash' : tg[1] === 0 ? 'wind' : 'done',
    t: tg[2] | 0, wind: tg[3] | 0, x: tg[4] | 0, y: tg[5] | 0, r: tg[6] | 0,
    a: +tg[7] || 0, len: tg[8] | 0, wide: tg[9] | 0, sx: tg[10] | 0, sy: tg[11] | 0,
  };
}

export function packMech(m) {
  if (!m || m.st !== 'wind' || !m.plan) return null;
  const pl = m.plan;
  const out = { k: m.k, t: Math.round(pl.t || 0), w: Math.round(pl.wind || 0), r: m.r | 0, len: m.len | 0, wide: m.wide | 0 };
  if (pl.spots) out.sp = pl.spots.map((s) => [Math.round(s.x), Math.round(s.y)]);
  if (pl.lanes) { out.sx = Math.round(pl.sx); out.sy = Math.round(pl.sy); out.ln = pl.lanes.map((a) => Math.round(a * 1000) / 1000); }
  if (pl.x != null) { out.x = Math.round(pl.x); out.y = Math.round(pl.y); }
  return out;
}
export function unpackMech(d) {
  if (!d || !d.k) return null;
  return {
    k: d.k, kind: d.k, st: 'wind', t: d.t | 0, wind: d.w | 0, r: d.r | 0, len: d.len | 0, wide: d.wide | 0,
    x: d.x | 0, y: d.y | 0, sx: d.sx | 0, sy: d.sy | 0,
    spots: (d.sp || []).map((p) => ({ x: p[0], y: p[1] })),
    lanes: d.ln || null,
  };
}

export function pointInCircle(px, py, x, y, r) {
  const rr = r || 0;
  return (px - x) * (px - x) + (py - y) * (py - y) <= rr * rr;
}
export function pointInLane(px, py, sx, sy, a, len, wide) {
  const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
  const vx = ex - sx, vy = ey - sy, l2 = vx * vx + vy * vy || 1;
  const tt = clamp(((px - sx) * vx + (py - sy) * vy) / l2, 0, 1);
  return Math.hypot(px - (sx + vx * tt), py - (sy + vy * tt)) < (wide || 0) / 2 + 6;
}

export function telegraphHits(px, py, tele, pad = 0) {
  if (!tele) return false;
  const k = tele.kind || tele.k;
  if (k === 'slam' || k === 'nova' || k === 'ring') return pointInCircle(px, py, tele.x, tele.y, (tele.r || 0) + pad);
  if (k === 'zones') return (tele.spots || []).some((s) => pointInCircle(px, py, s.x, s.y, (tele.r || 28) + pad));
  if (k === 'charge') return pointInLane(px, py, tele.sx, tele.sy, tele.a, tele.len, (tele.wide || 0) + pad * 2);
  if (k === 'beams') {
    const lanes = tele.lanes || [];
    return lanes.some((a) => pointInLane(px, py, tele.sx, tele.sy, a, tele.len || 220, (tele.wide || 22) + pad * 2));
  }
  return false;
}

export function lagWindowMs(rtt) { return clamp(((Number(rtt) || 80) / 2) + 40, 40, 180); }
export function lagPad(rtt, speed = 180) { return Math.round(speed * (lagWindowMs(rtt) / 1000)); }

export function isStrike(tele) {
  if (!tele) return false;
  if (tele.st === 'dash') return true;
  return (tele.st === 'wind' || !tele.st) && tele.wind > 0 && tele.t >= tele.wind;
}

export function strikeId(tele) {
  if (!tele) return '';
  return `${tele.kind || tele.k}:${Math.round(tele.x || tele.sx || 0)}:${Math.round(tele.y || tele.sy || 0)}:${Math.round(tele.wind || 0)}`;
}

export function teleDamage(atk, tele) {
  const k = tele?.kind || tele?.k;
  if (k === 'nova' || k === 'ring') return (atk || 10) + 4;
  if (k === 'charge' || k === 'beams') return (atk || 10) + 6;
  if (k === 'zones') return (atk || 10) * 0.7;
  return (atk || 10) + 8;
}
export function teleStatus(tele) {
  const k = tele?.kind || tele?.k;
  if (k === 'nova' || k === 'ring') return { id: 'burn' };
  if (k === 'charge') return { id: 'bleed' };
  if (k === 'slam') return { id: 'stun', secs: 0.8 };
  return null;
}

// Dungeon instance area: shared seed, per-floor authority. ≤32 chars.
export function dungeonAreaId(seed, floor = 0) {
  return `h:${(seed >>> 0).toString(36)}:f${floor | 0}`;
}
export function parseDungeonArea(a) {
  const m = /^h:([0-9a-z]+):f(\d+)$/.exec(String(a || ''));
  if (!m) return null;
  return { seed: parseInt(m[1], 36) >>> 0, floor: +m[2] };
}
export function isDungeonArea(a) { return /^h:[0-9a-z]+:f\d+$/.test(String(a || '')); }
export function samePlaySpace(enemyArea, here) {
  const ea = enemyArea || null, h = here || null;
  if (ea === h) return true;
  if (h === 'hollow' && isDungeonArea(ea)) return true;
  if (isDungeonArea(h) && (ea === 'hollow' || isDungeonArea(ea))) return true;
  return false;
}

// Party / private-room share a seed; public-without-party and solo stay unique
// so a third player is not pulled into someone else's Hollow Depths.
export function dungeonSeed({ partyId, roomKind, roomCode, connected, now, forced } = {}) {
  if (forced != null) return forced >>> 0;
  const epoch = Math.floor((now || Date.now()) / DUNGEON_EPOCH_MS);
  const key = partyId || (connected && roomKind === 'party' ? roomCode : null);
  if (key) return hashStr(`${key}|${epoch}`);
  return (Math.random() * 4294967296) >>> 0;
}

export function noteContrib(map, sid, now = Date.now()) {
  if (!sid) return map;
  const m = map || new Map();
  m.set(sid, now);
  return m;
}
export function contributors(map, now = Date.now(), windowMs = CONTRIB_MS) {
  const out = [];
  map?.forEach((t, sid) => { if (now - t < windowMs) out.push(sid); });
  return out;
}

export function validateHit(d, ex, ey, px, py, range = HIT_RANGE, cap = HIT_CAP) {
  const n = Math.floor(Number(d));
  if (!Number.isFinite(n) || n < 1) return { ok: false, why: 'dmg' };
  if (n > cap) return { ok: false, why: 'dmg-cap', d: n };
  if (ex != null && ey != null && px != null && py != null) {
    const dist = Math.hypot(ex - px, ey - py);
    if (dist > range) return { ok: false, why: 'hit-range', dist };
  }
  return { ok: true, d: n };
}

export function creditTier({ dealt = 0, killed = false, minFrac = 0.15 } = {}) {
  if (killed) return 2;
  if (dealt >= minFrac) return 1;
  return 0;
}

export function mergeEnemySnap(e, d) {
  if (!e || !d) return e;
  if (d.x !== undefined) e.x = d.x | 0;
  if (d.y !== undefined) e.y = d.y | 0;
  if (d.h !== undefined) e.h = d.h | 0;
  if (d.s !== undefined) e.s = d.s | 0;
  if (d.f !== undefined) e.f = d.f;
  if (d.lv !== undefined) e.lv = d.lv | 0;
  if (d.rk !== undefined) e.rk = String(d.rk).slice(0, 4);
  if (d.mh !== undefined) e.mh = d.mh | 0;
  if (d.ty !== undefined) e.ty = String(d.ty).slice(0, 24);
  if (d.ph !== undefined) e.ph = d.ph | 0;
  if (d.sh !== undefined) e.sh = d.sh ? 1 : 0;
  if (d.en !== undefined) e.en = d.en ? 1 : 0;
  if (d.tg !== undefined) e.tg = d.tg;
  if (d.mt !== undefined) e.mt = Array.isArray(d.mt) ? d.mt.slice(0, 6) : d.mt;
  if (d.hx !== undefined) e.hx = d.hx | 0;
  if (d.hy !== undefined) e.hy = d.hy | 0;
  return e;
}

export function packEnemyExtras(e) {
  if (!e) return null;
  const rank = e.rank?.id || e.rankId || 'normal';
  const plan = e.plan;
  const st = e.state || e.aiState || 'idle';
  const tg = plan ? packTele(plan, st) : null;
  const mt = (e.mechs || []).map(packMech).filter(Boolean);
  const d = {
    ty: e.typeId,
    lv: e.level | 0,
    rk: packRank(rank),
    mh: Math.max(0, Math.round(e.maxHp || 0)),
    ph: (e.phase || 1) | 0,
    sh: e.invuln ? 1 : 0,
    en: e.engaged ? 1 : 0,
    hx: Math.round(e.home?.x ?? e.x),
    hy: Math.round(e.home?.y ?? e.y),
  };
  if (tg) d.tg = tg;
  if (mt.length) d.mt = mt;
  return d;
}

export function extrasChanged(last, cur) {
  if (!cur) return false;
  if (!last) return true;
  if (last.lv !== cur.lv || last.rk !== cur.rk || last.mh !== cur.mh) return true;
  if (last.ph !== cur.ph || last.sh !== cur.sh || last.en !== cur.en) return true;
  if (JSON.stringify(last.tg || null) !== JSON.stringify(cur.tg || null)) return true;
  if (JSON.stringify(last.mt || null) !== JSON.stringify(cur.mt || null)) return true;
  return false;
}

export function eventNetId(key, typeId, i = 0) {
  return `evt:${String(key).slice(0, 12)}:${typeId}:${i | 0}`.slice(0, 64);
}

export function sanitizeDst(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    a: typeof m.a === 'string' ? m.a.slice(0, 32) : '',
    seed: (m.seed >>> 0) || 0,
    floor: m.floor | 0,
    sealed: m.sealed ? 1 : 0,
    done: m.done ? 1 : 0,
    kills: Math.max(0, m.kills | 0),
  };
}
export function sanitizeEvp(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    k: String(m.k || '').slice(0, 24),
    n: Math.max(0, m.n | 0),
    of: Math.max(0, m.of | 0),
    hp: Math.max(0, m.hp | 0),
    max: Math.max(0, m.max | 0),
    tier: Math.max(0, Math.min(2, m.tier | 0)),
  };
}
