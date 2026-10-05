// RPG progression math (Ragnarok-style). Pure functions, no Phaser.
//
// Six stats: STR AGI VIT INT DEX LUK.
// A stat's TOTAL = class base + allocated points + class auto-growth
//                  (floor((level-1) * growth)) + advanced-class bonus.
// Gear adds flat ATK/DEF/HP/MP/SPD on top of the derived numbers (ModularPlayer).

export const STAT_IDS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];
export const STAT_INFO = {
  str: { name: 'STR', desc: 'Melee ATK' },
  agi: { name: 'AGI', desc: 'Flee, ASPD, move' },
  vit: { name: 'VIT', desc: 'Max HP, DEF' },
  int: { name: 'INT', desc: 'Max MP, MATK, MDEF' },
  dex: { name: 'DEX', desc: 'Bow ATK, hit, ASPD' },
  luk: { name: 'LUK', desc: 'Crit, flee, small ATK' },
};

export const MAX_LEVEL = 50;
export const MAX_STAT = 99;
export const CLASS_CHANGE_LEVEL = 10;
export const SKILL_MAX = 5;
export const START_STAT_POINTS = 6;

// XP needed to go from `lv` to `lv + 1` (Lv1 -> 2 = 100 XP, Lv49 -> 50 ~ 5000).
export function xpToNext(lv) { return Math.round(30 + 70 * Math.pow(Math.max(1, lv), 1.1)); }

// Stat points granted on reaching level `lv` (3-5, rising). 1 skill point/level.
export function statPointsForLevel(lv) { return lv < 15 ? 3 : lv < 30 ? 4 : 5; }
export const SKILL_POINTS_PER_LEVEL = 1;

// RO-like rising cost: raising a stat whose current base value is v costs
// floor((v - 1) / 10) + 2 points (2 up to 10, 3 for 11-20, ... ).
export function statCost(v) { return Math.floor((Math.max(1, v) - 1) / 10) + 2; }

// Skill level scaling (1..5): +15% damage/effect per level, -6% cooldown per level.
export function skillDmgMul(lv) { return 1 + 0.15 * (Math.max(1, lv) - 1); }
export function skillCdMul(lv) { return 1 - 0.06 * (Math.max(1, lv) - 1); }

export function emptyAlloc() { return { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 }; }

export function newProg() {
  return { alloc: emptyAlloc(), statPoints: START_STAT_POINTS, skillPoints: 0, skills: {}, adv: null, paths: { might: 0, ward: 0, spirit: 0 }, nodes: [] };
}

// Default progression for a pre-progression save at `level`: grant the points
// the character would have earned, nothing spent.
export function retroProg(level) {
  const p = newProg();
  for (let l = 2; l <= level; l++) { p.statPoints += statPointsForLevel(l); p.skillPoints += SKILL_POINTS_PER_LEVEL; }
  return p;
}

// total stat values. job: {base, growth}; adv: advanced class def or null.
export function totalStats(job, adv, level, alloc, bonus = null) {
  const out = {};
  for (const s of STAT_IDS) {
    out[s] = Math.round((job.base?.[s] ?? 5) + (alloc?.[s] || 0)
      + Math.floor((level - 1) * (job.growth?.[s] || 0)) + (adv?.bonus?.[s] || 0) + (bonus?.[s] || 0));
  }
  return out;
}

// Formulas:
//  maxHP  = (job.hp + (Lv-1)*job.hpLv) * (1 + VIT*1%) + VIT*2          [* adv.hpMul]
//  maxMP  = (job.mp + (Lv-1)*job.mpLv) * (1 + INT*1%) + INT            [* adv.mpMul]
//  ATK    = 0.4*job.atk + 0.5*Lv + main*0.7 + off*0.2 + 0.15*LUK       (melee: main=STR, off=DEX; bow: swapped)
//  MATK   = 0.4*job.atk + 0.5*Lv + 0.8*INT + 0.2*DEX + 0.15*LUK        (used when a wand is held)
//  DEF    = 0.3*VIT + 0.15*Lv      MDEF = 0.3*INT + 0.15*VIT + 0.1*Lv
//  HIT    = 100 + Lv + DEX         FLEE = 100 + Lv + AGI + 0.2*LUK
//  CRIT%  = 1 + 0.3*LUK (+adv)     dodge% = min(40, 0.5*(AGI + 0.2*LUK))
//  atkSpd = 1 + min(1, 0.008*AGI + 0.003*DEX + adv)   (attack delay = 350ms / atkSpd)
//  move   = job.spd * (1 + min(0.25, 0.002*AGI) + adv.move)
export function computeDerived({ job, adv = null, level = 1, alloc, weaponKind = 'melee', bonus = null }) {
  const T = totalStats(job, adv, level, alloc, bonus);
  const hpBase = job.hp + (level - 1) * (job.hpLv ?? 10);
  const mpBase = job.mp + (level - 1) * (job.mpLv ?? 5);
  const main = weaponKind === 'bow' ? T.dex : T.str;
  const off = weaponKind === 'bow' ? T.str : T.dex;
  const flee = 100 + level + T.agi + Math.floor(T.luk * 0.2);
  const atkSpd = 1 + Math.min(1, T.agi * 0.008 + T.dex * 0.003 + (adv?.aspd || 0));
  return {
    T,
    maxHp: Math.round(((hpBase * (1 + T.vit * 0.01)) + T.vit * 2) * (adv?.hpMul || 1)),
    maxMp: Math.round(((mpBase * (1 + T.int * 0.01)) + T.int) * (adv?.mpMul || 1)),
    atk: Math.floor(job.atk * 0.4 + level * 0.5 + main * 0.7 + off * 0.2 + T.luk * 0.15),
    matk: Math.floor(job.atk * 0.4 + level * 0.5 + T.int * 0.8 + T.dex * 0.2 + T.luk * 0.15),
    def: Math.floor(T.vit * 0.3 + level * 0.15),
    mdef: Math.floor(T.int * 0.3 + T.vit * 0.15 + level * 0.1),
    hit: 100 + level + T.dex,
    flee,
    crit: Math.min(60, Math.round((1 + T.luk * 0.3 + (adv?.crit || 0)) * 10) / 10),
    dodge: Math.min(40, (T.agi + T.luk * 0.2) * 0.5),
    atkSpd,
    attackDelay: Math.round(350 / atkSpd),
    moveSpeed: Math.round(job.spd * (1 + Math.min(0.25, T.agi * 0.002) + (adv?.move || 0))),
  };
}

// ── Specialization runtime (data contract: docs/SPEC_ENGINE.md) ─────────────
// Pure helpers for the level-2+ spec system. The node catalogue itself lives in
// data/skillTrees.js (sibling lane); everything here treats unknown node ids
// as inert so old saves and missing data never crash.
export const SPEC_PATHS = ['might', 'ward', 'spirit'];
export const SPEC_NODES_MAX = 64;
export const SPEC_DERIVED_KEYS = ['hpMul', 'mpMul', 'crit', 'aspd', 'move'];

const clampSpecInt = (v, d = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(999, Math.max(0, n)) : d;
};

// {might,ward,spirit} ints; anything malformed → zeros (old saves default cleanly).
export function sanitizePaths(raw) {
  const out = { might: 0, ward: 0, spirit: 0 };
  if (raw && typeof raw === 'object') for (const p of SPEC_PATHS) out[p] = clampSpecInt(raw[p], 0);
  return out;
}

// Owned node ids: deduped string array, bounded so a corrupt save can't balloon.
export function sanitizeSpecNodes(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(); const out = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id); out.push(id);
    if (out.length >= SPEC_NODES_MAX) break;
  }
  return out;
}

// Ensure a prog object carries valid spec state (complements save.js
// sanitizeProgression, which owns the rest of the prog shape). Mutates + returns.
export function ensureSpecState(prog) {
  if (!prog || typeof prog !== 'object') return prog;
  prog.paths = sanitizePaths(prog.paths);
  prog.nodes = sanitizeSpecNodes(prog.nodes);
  return prog;
}

// Tolerant node-def reader: accepts the contract shape plus near-variants
// ({reqLv|level}, {cost|sp}, {prereq|requires|prev}, {base|job|jobs},
//  {bonus|stats}, {skillBoost|boost}) so the runtime never depends on exact keys.
export function normalizeSpecNode(def) {
  if (!def || typeof def !== 'object') return null;
  const id = typeof def.id === 'string' ? def.id : null;
  if (!id) return null;
  const path = SPEC_PATHS.includes(def.path) ? def.path : null;
  const reqLv = clampSpecInt(def.reqLv ?? def.reqLevel ?? def.level ?? def.minLevel ?? 1, 1);
  const cost = clampSpecInt(def.cost ?? def.sp ?? def.points ?? 1, 1);
  const rawPre = def.prereq ?? def.requires ?? def.prev ?? [];
  let prereq = (Array.isArray(rawPre) ? rawPre : [rawPre]).filter((x) => typeof x === 'string' && x);
  // skillTrees.js linear tracks imply order via {job, path, index} instead of
  // explicit prereqs: node N requires node N-1 on the same track.
  if (!prereq.length && typeof def.job === 'string' && typeof def.path === 'string'
      && Number.isInteger(def.index) && def.index > 1) prereq = [`${def.job}.${def.path}.${def.index - 1}`];
  const rawBase = def.base ?? def.job ?? def.jobs ?? def.forJob ?? null;
  const base = rawBase == null ? null : (Array.isArray(rawBase) ? rawBase : [rawBase]).filter((x) => typeof x === 'string');
  // skillTrees.js effect shape: {kind:'stat', key, value} | {kind:'skill', skillId, levels}.
  const eff = def.effect && typeof def.effect === 'object' ? def.effect : null;
  const effStat = eff?.kind === 'stat' && typeof eff.key === 'string' ? { [eff.key]: eff.value } : null;
  const already = (def.derived && typeof def.derived === 'object') ? def.derived : null; // idempotence: re-normalizing a normalized def must keep derived
  const srcBase = def.bonus && typeof def.bonus === 'object' ? def.bonus : (def.stats && typeof def.stats === 'object' ? def.stats : (effStat || {}));
  const src = already ? { ...srcBase, ...already } : srcBase;
  const bonus = {};
  const derived = {};
  for (const s of STAT_IDS) if (Number.isFinite(Number(src[s])) && Number(src[s]) !== 0) bonus[s] = Math.trunc(Number(src[s]));
  for (const k of SPEC_DERIVED_KEYS) if (Number.isFinite(Number(src[k])) && Number(src[k]) !== 0) derived[k] = Number(src[k]);
  const sb = def.skillBoost && typeof def.skillBoost === 'object' ? def.skillBoost : (def.boost && typeof def.boost === 'object' ? def.boost : (eff?.kind === 'skill' ? { id: eff.skillId, lv: eff.levels } : null));
  let skillBoost = null;
  const sbId = sb?.id ?? sb?.skill ?? (typeof def.skillId === 'string' ? def.skillId : null);
  const sbLv = Math.floor(Number(sb?.lv ?? sb?.levels ?? def.skillLv ?? 0)) || 0;
  if (typeof sbId === 'string' && sbId && sbLv > 0) skillBoost = { id: sbId, lv: Math.min(5, sbLv) };
  return { id, path, reqLv, cost, prereq, base, bonus, derived, skillBoost };
}

// Find a node def by id across plausible catalogue shapes. Returns raw def or null.
export function findSpecNode(data, id) {
  if (!data || typeof data !== 'object' || typeof id !== 'string') return null;
  const byId = data.nodesById || data.NODES_BY_ID || data.byId;
  if (byId && typeof byId === 'object' && byId[id]) return byId[id];
  const listPools = [];
  if (data.nodes) listPools.push(data.nodes);
  if (data.NODES) listPools.push(data.NODES);
  if (data.trees) for (const t of Object.values(data.trees)) { if (t?.nodes) listPools.push(t.nodes); }
  if (data.paths) for (const p of Object.values(data.paths)) { if (p?.nodes) listPools.push(p.nodes); }
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (v.nodes || v.paths)) { if (v.nodes) listPools.push(v.nodes); }
    void k;
  }
  // skillTrees.js catalogue shape: { jobId: { pathId: [node, ...] }, ... }.
  // Collect per-path arrays whose items look like node defs (string id).
  for (const v of Object.values(data)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const sub of Object.values(v)) {
      if (Array.isArray(sub) && sub.some((n) => n && typeof n?.id === 'string')) listPools.push(sub);
    }
  }
  for (const pool of listPools) {
    if (Array.isArray(pool)) { const hit = pool.find((n) => n?.id === id); if (hit) return hit; }
    else if (pool && typeof pool === 'object' && pool[id]) return pool[id];
  }
  return null;
}

// Sum of flat STAT_IDS-only bonuses from owned nodes (feeds totalStats/computeDerived `bonus`).
export function specStatBonus(ownedIds, lookup) {
  const out = {};
  for (const id of ownedIds || []) {
    let def = null;
    try { def = normalizeSpecNode(typeof lookup === 'function' ? lookup(id) : findSpecNode(lookup, id)); } catch { continue; }
    if (!def) continue; // unknown node ids are ignored, never crash
    for (const [s, v] of Object.entries(def.bonus)) out[s] = (out[s] || 0) + v;
  }
  return out;
}

// Skill-id → bonus levels from owned nodes (applied in ModularPlayer.skillLv).
export function specSkillBoosts(ownedIds, lookup) {
  const out = {};
  for (const id of ownedIds || []) {
    let def = null;
    try { def = normalizeSpecNode(typeof lookup === 'function' ? lookup(id) : findSpecNode(lookup, id)); } catch { continue; }
    if (!def?.skillBoost) continue;
    out[def.skillBoost.id] = (out[def.skillBoost.id] || 0) + def.skillBoost.lv;
  }
  return out;
}

// Derived-slot deltas (hpMul/mpMul/crit/aspd/move) from owned nodes. Multipliers
// stack on (1+v) deltas; additive slots sum. Feeds computeDerived via an
// adv-like overlay in ModularPlayer.recalc (same slots adv uses).
export function specDerivedBonus(ownedIds, lookup) {
  const out = { hpMul: 1, mpMul: 1, crit: 0, aspd: 0, move: 0 };
  for (const id of ownedIds || []) {
    let def = null;
    try { def = normalizeSpecNode(typeof lookup === 'function' ? lookup(id) : findSpecNode(lookup, id)); } catch { continue; }
    if (!def?.derived) continue;
    for (const [k, v] of Object.entries(def.derived)) {
      if (v == null || v === 0) continue;
      if (k === 'hpMul' || k === 'mpMul') out[k] = out[k] * (1 + v);
      else if (k === 'crit' || k === 'aspd' || k === 'move') out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}
// Advanced-class path gate. Reads adv.specGate ?? adv.gate ?? adv.reqSpec (or a
 // catalogue-level gate map passed as `gate`). No gate data → true (old behavior).
// Shapes: {path, points|min|need} | {might:n, ward:n, ...} | 'might' (>=1).
export function meetsClassGate(adv, prog, gate = null) {
  const g = gate ?? adv?.specGate ?? adv?.gate ?? adv?.reqSpec ?? adv?.pathGate ?? null;
  if (g == null) return true;
  const paths = (prog && prog.paths) || {};
  const has = (p, n) => (paths[p] || 0) >= n;
  if (typeof g === 'string') return SPEC_PATHS.includes(g) ? has(g, 1) : true;
  if (typeof g === 'object') {
    if (typeof g.path === 'string') {
      if (!SPEC_PATHS.includes(g.path)) return true;
      return has(g.path, clampSpecInt(g.points ?? g.min ?? g.need ?? 1, 1));
    }
    const keys = SPEC_PATHS.filter((p) => g[p] !== undefined);
    if (!keys.length) return true;
    return keys.every((p) => has(p, clampSpecInt(g[p], 0)));
  }
  return true;
}
