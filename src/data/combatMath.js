// Combat math shared by Enemy / WorldScene / systems/combat.js. Pure functions, no Phaser.
//
// Levels: every enemy instance rolls a level inside its zone's range (see
// rollMobLevel). "Con" colours compare that level with the hero's, WoW-style:
//   grey  (trivial, no aggro, ~no XP)  green (easy)  yellow (even)
//   orange (hard)  red (deadly, +damage taken, more misses)

export const CON = {
  grey:   { id: 'grey',   color: '#9a9a9a', tint: 0x9a9a9a },
  green:  { id: 'green',  color: '#5fd35f', tint: 0x5fd35f },
  yellow: { id: 'yellow', color: '#ffe14a', tint: 0xffe14a },
  orange: { id: 'orange', color: '#ff9a3a', tint: 0xff9a3a },
  red:    { id: 'red',    color: '#ff4a4a', tint: 0xff4a4a },
};

// Levels below the hero at which a mob turns grey (scales with hero level).
export function greyGap(playerLv) { return playerLv < 6 ? 5 : 5 + Math.floor((playerLv - 6) / 8); }

export function conOf(playerLv, mobLv) {
  const d = mobLv - playerLv;
  if (d >= 5) return CON.red;
  if (d >= 3) return CON.orange;
  if (d >= -2) return CON.yellow;
  if (d > -greyGap(playerLv)) return CON.green;
  return CON.grey;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Outgoing hero damage vs a mob of level mobLv.
export function heroDmgMul(playerLv, mobLv) { return clamp(1 - 0.06 * (mobLv - playerLv), 0.55, 1.3); }
// Incoming mob damage vs the hero.
export function mobDmgMul(playerLv, mobLv) { return clamp(1 + 0.08 * (mobLv - playerLv), 0.6, 1.6); }
// Chance for the hero's hit to miss a higher-level mob.  Even-level fights
// should feel reliable; the meaningful accuracy pressure starts once a foe
// outlevels the hero, then caps before a red enemy becomes untouchable.
export function heroMissChance(playerLv, mobLv) {
  return clamp(0.01 + 0.04 * Math.max(0, mobLv - playerLv), 0, 0.35);
}
// XP multiplier (grey mobs give a token 10%).
export function xpMul(playerLv, mobLv) {
  if (conOf(playerLv, mobLv) === CON.grey) return 0.1;
  return clamp(1 + 0.1 * (mobLv - playerLv), 0.4, 1.5);
}

// Base stats in ENEMY_TABLE are tuned for def.lv; scale to an instance level.
export function scaleForLevel(def, lv) {
  const d = lv - (def.lv || lv);
  return {
    hp: Math.round(def.hp * (1 + 0.1 * d)),
    atk: def.atk * (1 + 0.07 * d),
    dmg: def.dmg != null ? def.dmg * (1 + 0.07 * d) : null,
    xp: Math.round(def.xp * (1 + 0.14 * d)),
    gold: [Math.round(def.gold[0] * (1 + 0.1 * d)), Math.round(def.gold[1] * (1 + 0.1 * d))],
  };
}

// Pick an instance level: def.lv..def.lv+2, clamped into the zone range.
export function rollMobLevel(def, zoneLv, rnd = Math.random) {
  const base = def.lv || (zoneLv ? zoneLv[0] : 1);
  let lv = base + Math.floor(rnd() * 3);
  if (zoneLv) lv = clamp(lv, Math.min(base, zoneLv[0]), Math.max(base, zoneLv[1]));
  return Math.max(1, lv);
}

// Elite / champion variants (not for bosses).
export const RANKS = {
  normal:   { id: 'normal',   prefix: '',          scale: 1,    hp: 1,   atk: 1,   xp: 1,   gold: 1,   lv: 0, tint: null,     loot: 0 },
  elite:    { id: 'elite',    prefix: 'Elite ',    scale: 1.3,  hp: 2.2, atk: 1.35, xp: 2.5, gold: 2.5, lv: 1, tint: 0xffd36a, loot: 1 },
  champion: { id: 'champion', prefix: 'Champion ', scale: 1.55, hp: 4,   atk: 1.7, xp: 5,   gold: 4,   lv: 2, tint: 0xd08cff, loot: 2 },
};
export function rollRank(rnd = Math.random) {
  const r = rnd();
  if (r < 0.015) return RANKS.champion;
  if (r < 0.085) return RANKS.elite;
  return RANKS.normal;
}

// Status effect catalogue. dot = damage per tick as a fraction of the SOURCE's
// attack (mobs → hero) or of the hero's ATK (hero → mobs); tick in ms.
export const STATUS = {
  poison: { id: 'poison', name: 'Poison', color: 0x7bd84a, text: '#9be86a', secs: 6, tick: 1000, dot: 0.18 },
  burn:   { id: 'burn',   name: 'Burn',   color: 0xff7a2a, text: '#ffa04a', secs: 3, tick: 500,  dot: 0.14 },
  bleed:  { id: 'bleed',  name: 'Bleed',  color: 0xd02a3a, text: '#ff5a6a', secs: 5, tick: 800,  dot: 0.15 },
  slow:   { id: 'slow',   name: 'Slow',   color: 0x7ac8ff, text: '#9bd0ff', secs: 3, speed: 0.55 },
  stun:   { id: 'stun',   name: 'Stun',   color: 0xffe14a, text: '#ffe14a', secs: 1.2 },
};
