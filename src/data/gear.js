// Gear catalog: equip slots (head/chest/weapon/trinket) with stats, sources,
// and visuals. Worn visuals are runtime-generated 16×16 overlays in the same
// chunky-pixel style as the Ninja Adventure bodies (see systems/gearArt.js),
// so everything matches with zero license risk — all authored for this project.
// Optional drop-in: Newc42's CC0 "Medieval & Fantasy Pixel Art Items" pack can
// replace generated icons later (public/assets/custom/, same texture keys).
export const SLOTS = ['head', 'chest', 'weapon', 'trinket'];

export const GEAR = {
  // — starter —
  worn_tunic: { id: 'worn_tunic', name: 'Worn Tunic', slot: 'chest', stats: { def: 1 }, price: 0, tint: 0x8a7a5a, desc: 'Smells like every road.' },
  // — head —
  straw_hat: { id: 'straw_hat', name: 'Straw Hat', slot: 'head', overlay: 'straw_hat', hidesHair: true, stats: { hp: 10, def: 1 }, price: 40, shop: true, tint: 0xd9b64a, desc: '+10 HP, +1 DEF. Cozy.' },
  leather_cap: { id: 'leather_cap', name: 'Leather Cap', slot: 'head', overlay: 'leather_cap', hidesHair: true, stats: { def: 2 }, price: 55, shop: true, tint: 0x8d5524, desc: '+2 DEF.' },
  iron_helm: { id: 'iron_helm', name: 'Iron Helm', slot: 'head', overlay: 'iron_helm', hidesHair: true, stats: { def: 4 }, price: 120, tint: 0x95a5a6, drop: { enemies: ['thornmite', 'rustskull'], chance: 0.04 }, desc: '+4 DEF. Clanks.' },
  mage_hat: { id: 'mage_hat', name: 'Mage Hat', slot: 'head', overlay: 'mage_hat', hidesHair: true, stats: { mp: 20, def: 1 }, price: 150, tint: 0x2e4a8d, drop: { enemies: ['willowisp', 'bogspirit'], chance: 0.04 }, desc: '+20 MP, +1 DEF.' },
  tide_crown: { id: 'tide_crown', name: 'Tide Crown', slot: 'head', overlay: 'tide_crown', hidesHair: false, stats: { def: 2, mp: 10, hp: 10 }, price: 260, tint: 0xf4c542, drop: { enemies: ['tideeye'], chance: 0.03 }, desc: '+2 DEF, +10 MP, +10 HP.' },
  // — chest —
  leather_vest: { id: 'leather_vest', name: 'Leather Vest', slot: 'chest', stats: { def: 2, hp: 10 }, price: 45, shop: true, tint: 0x7a4a22, desc: '+2 DEF, +10 HP.' },
  iron_mail: { id: 'iron_mail', name: 'Iron Mail', slot: 'chest', stats: { def: 4, hp: 10 }, price: 110, tint: 0x7f8c8d, drop: { enemies: ['thornmite', 'capling'], chance: 0.04 }, desc: '+4 DEF, +10 HP.' },
  mage_robe: { id: 'mage_robe', name: 'Mage Robe', slot: 'chest', stats: { def: 1, mp: 25 }, price: 130, tint: 0x3a5a9d, drop: { enemies: ['bogspirit'], chance: 0.035 }, desc: '+1 DEF, +25 MP.' },
  tide_plate: { id: 'tide_plate', name: 'Tide Plate', slot: 'chest', stats: { def: 6, hp: 25 }, price: 220, tint: 0x2e86c1, drop: { enemies: ['tideeye'], chance: 0.025 }, desc: '+6 DEF, +25 HP.' },
  // — weapon (tex = real in-hand sprite, tinted per tier; kind drives attacks) —
  honed_edge: { id: 'honed_edge', name: 'Honed Edge', slot: 'weapon', tex: 'weapon.sword', kind: 'melee', stats: { atk: 3 }, price: 60, shop: true, tint: 0xffffff, desc: '+3 ATK.' },
  fang_pair: { id: 'fang_pair', name: 'Ember Fangs', slot: 'weapon', tex: 'weapon.sai', kind: 'melee', stats: { atk: 4 }, price: 110, tint: 0xffb36b, drop: { enemies: ['thornmite'], chance: 0.04 }, desc: '+4 ATK.' },
  yew_bow: { id: 'yew_bow', name: 'Yew Longbow', slot: 'weapon', tex: 'weapon.bow', kind: 'bow', stats: { atk: 5 }, price: 120, tint: 0xffffff, drop: { enemies: ['mossbat'], chance: 0.04 }, desc: '+5 ATK. Ranged.' },
  ember_wand: { id: 'ember_wand', name: 'Ember Wand', slot: 'weapon', tex: 'weapon.wand', kind: 'wand', stats: { atk: 6, mp: 10 }, price: 140, tint: 0xff8d5a, drop: { enemies: ['willowisp'], chance: 0.04 }, desc: '+6 ATK, +10 MP. Ranged.' },
  iron_greatblade: { id: 'iron_greatblade', name: 'Iron Greatblade', slot: 'weapon', tex: 'weapon.bigSword', kind: 'melee', stats: { atk: 7 }, price: 170, tint: 0xbfd4e6, drop: { enemies: ['capling', 'rustskull'], chance: 0.03 }, desc: '+7 ATK. Heavy.' },
  tidebrand: { id: 'tidebrand', name: 'Tidebrand', slot: 'weapon', tex: 'weapon.sword', kind: 'melee', stats: { atk: 9, mp: 10 }, price: 260, tint: 0x5ad1ff, drop: { enemies: ['tideeye'], chance: 0.02 }, desc: '+9 ATK, +10 MP.' },
  // — trinket —
  moss_charm: { id: 'moss_charm', name: 'Moss Charm', slot: 'trinket', stats: { hp: 15 }, price: 30, shop: true, tint: 0x5da24a, drop: { enemies: ['dewslime'], chance: 0.05 }, desc: '+15 HP.' },
  feather_charm: { id: 'feather_charm', name: 'Feather Charm', slot: 'trinket', stats: { spd: 12 }, price: 50, shop: true, tint: 0xecf0f1, drop: { enemies: ['mossbat'], chance: 0.04 }, desc: '+12 speed.' },
  ember_charm: { id: 'ember_charm', name: 'Ember Charm', slot: 'trinket', stats: { atk: 2, hp: 10 }, price: 80, tint: 0xd35400, drop: { enemies: ['willowisp'], chance: 0.035 }, desc: '+2 ATK, +10 HP.' },
  tide_pearl: { id: 'tide_pearl', name: 'Tide Pearl', slot: 'trinket', stats: { mp: 15, hp: 15 }, price: 120, tint: 0x76d7c4, drop: { enemies: ['bogspirit'], chance: 0.03 }, desc: '+15 MP, +15 HP.' },
};

export function gearById(id) { return GEAR[id] || null; }

// Roll a gear drop for a slain enemy type (single roll, rarest-first).
export function rollGearDrop(typeId) {
  const cands = Object.values(GEAR).filter((g) => g.drop?.enemies.includes(typeId));
  for (const g of cands) {
    if (Math.random() < g.drop.chance) return g.id;
  }
  return null;
}

export function statLine(stats) {
  const parts = [];
  if (stats.atk) parts.push(`+${stats.atk} ATK`);
  if (stats.def) parts.push(`+${stats.def} DEF`);
  if (stats.hp) parts.push(`+${stats.hp} HP`);
  if (stats.mp) parts.push(`+${stats.mp} MP`);
  if (stats.spd) parts.push(`+${stats.spd} SPD`);
  return parts.join(', ') || '—';
}

export const SHOP_STOCK = ['straw_hat', 'leather_cap', 'leather_vest', 'honed_edge', 'moss_charm', 'feather_charm'];
