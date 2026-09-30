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
  return { alloc: emptyAlloc(), statPoints: START_STAT_POINTS, skillPoints: 0, skills: {}, adv: null };
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
