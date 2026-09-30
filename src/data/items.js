// Item catalogue from Ninja Adventure Items/* (CC0): consumables, resources,
// treasure, tools, weapon icons. Each entry gets a 32px icon texture
// `icon32.<id>` (nearest-neighbour 2x upscale, see assets/loader.js makeItemIcons)
// usable by quests / crafting / shops. Consumable counts live in
// scene.questState.pack ({id: n}), which the existing save already persists.
//   kind: potion | food | scroll | resource | treasure | tool | weapon
//   use:  { hp?, mp?, hpPct?, effect? }  effect: 'home' | 'fire' | 'ice' | 'thunder'
export const ITEMS = {};
const I = (id, name, kind, src, price, desc, use) => { ITEMS[id] = { id, name, kind, src: `Items/${src}.png`, price, desc, ...(use ? { use } : {}) }; };

// potions
I('potion_small', 'Life Potion', 'potion', 'Potion/LifePot', 6, 'Restores 60 HP.', { hp: 60 });
I('medipack', 'Medipack', 'potion', 'Potion/Medipack', 14, 'Restores 40% of max HP.', { hpPct: 0.4 });
I('heart_charm', 'Heart Drop', 'potion', 'Potion/Heart', 20, 'Restores 25 HP and 15 MP.', { hp: 25, mp: 15 });
I('milk', 'Milk Flask', 'potion', 'Potion/MilkPot', 5, 'Soothing. Restores 20 MP.', { mp: 20 });
I('water_flask', 'Spring Water', 'potion', 'Potion/WaterPot', 3, 'Cool and clean. Restores 10 MP.', { mp: 10 });
I('empty_flask', 'Empty Flask', 'resource', 'Potion/EmptyPot', 1, 'Crafting vessel.');
// food (H = eat best)
I('onigiri', 'Onigiri', 'food', 'Food/Onigiri', 4, 'Rice ball. Restores 35 HP.', { hp: 35 });
I('noodles', 'Noodle Bowl', 'food', 'Food/Noodle', 8, 'Hot bowl. Restores 55 HP.', { hp: 55 });
I('yakitori', 'Yakitori', 'food', 'Food/Yakitori', 7, 'Grilled skewer. Restores 45 HP.', { hp: 45 });
I('sushi', 'Sushi', 'food', 'Food/Sushi', 9, 'Restores 50 HP, 10 MP.', { hp: 50, mp: 10 });
I('sushi2', 'Maki Roll', 'food', 'Food/Sushi2', 9, 'Restores 40 HP, 15 MP.', { hp: 40, mp: 15 });
I('fish_fresh', 'Fresh Fish', 'food', 'Food/Fish', 5, 'Restores 30 HP.', { hp: 30 });
I('shrimp', 'Shrimp', 'food', 'Food/Shrimp', 6, 'Restores 30 HP, 5 MP.', { hp: 30, mp: 5 });
I('calamari', 'Calamari', 'food', 'Food/Calamari', 8, 'Chewy. Restores 45 HP.', { hp: 45 });
I('octopus_leg', 'Octopus', 'food', 'Food/Octopus', 8, 'Restores 40 HP, 10 MP.', { hp: 40, mp: 10 });
I('apple_honey', 'Wild Honey', 'food', 'Food/Honey', 7, 'Restores 25 HP and 25 MP.', { hp: 25, mp: 25 });
I('beef', 'Roast Beef', 'food', 'Food/Beaf', 12, 'Hearty. Restores 80 HP.', { hp: 80 });
I('meat', 'Meat Chunk', 'food', 'Food/Meat', 8, 'Restores 50 HP.', { hp: 50 });
I('fortune_cookie', 'Fortune Cookie', 'food', 'Food/FortuneCookie', 3, 'Restores 15 HP. Has a note inside.', { hp: 15 });
I('herb_tea', 'Tea Leaf Brew', 'food', 'Food/TeaLeaf', 5, 'Restores 15 HP, 20 MP.', { hp: 15, mp: 20 });
I('nut_bag', 'Nuts', 'food', 'Food/Nut', 3, 'Restores 15 HP.', { hp: 15 });
I('nut2', 'Forest Nuts', 'food', 'Food/Nut2', 3, 'Restores 15 HP.', { hp: 15 });
// scrolls (Y = read best)
I('scroll_home', 'Homecoming Scroll', 'scroll', 'Scroll/Scroll', 30, 'Teleports you to Thistle Town.', { effect: 'home' });
I('scroll_fire', 'Scroll of Embers', 'scroll', 'Scroll/ScrollFire', 40, 'Burns nearby monsters.', { effect: 'fire' });
I('scroll_ice', 'Scroll of Frost', 'scroll', 'Scroll/ScrollIce', 40, 'Freezes and damages nearby monsters.', { effect: 'ice' });
I('scroll_thunder', 'Scroll of Thunder', 'scroll', 'Scroll/ScrollThunder', 45, 'Shocks nearby monsters.', { effect: 'thunder' });
I('scroll_plant', 'Scroll of Growth', 'scroll', 'Scroll/ScrollPlant', 30, 'Heals a little over the moment. Restores 50 HP.', { hp: 50 });
I('scroll_rock', 'Scroll of Stone', 'scroll', 'Scroll/ScrollRock', 30, 'Crafting scroll.');
I('scroll_blank', 'Blank Scroll', 'resource', 'Scroll/ScrollEmpty', 5, 'Write your own magic.');
// resources
for (const [id, nm, f, p] of [['bar_copper', 'Copper Bar', 'BarCopper', 12], ['bar_iron', 'Iron Bar', 'BarIron', 20], ['bar_silver', 'Silver Bar', 'BarSilver', 35], ['bar_gold', 'Gold Bar', 'BarGold', 60], ['bar_mithril', 'Mithril Bar', 'BarMithril', 90], ['bar_purple', 'Amethyst Bar', 'BarPurple', 75]]) I(id, nm, 'resource', `Resource/${f}`, p, 'Smelted metal for crafting.');
for (const [id, nm, f, p] of [['gem_green', 'Green Gem', 'GemGreen', 40], ['gem_purple', 'Purple Gem', 'GemPurple', 50], ['gem_red', 'Red Gem', 'GemRed', 55], ['gem_yellow', 'Yellow Gem', 'GemYellow', 45]]) I(id, nm, 'resource', `Resource/${f}`, p, 'A cut gemstone.');
I('branch', 'Branch', 'resource', 'Resource/Branch', 1, 'Sturdy wood.');
I('grass', 'Grass Bundle', 'resource', 'Resource/Grass', 1, 'Tough fibres.');
I('rock', 'Rock', 'resource', 'Resource/Rock', 1, 'A solid stone.');
I('feather', 'Feather', 'resource', 'Resource/feather', 2, 'Light as air.');
I('water_drop', 'Water', 'resource', 'Resource/Water', 1, 'A drop of water.');
// treasure + objects
I('gold_cup', 'Gold Cup', 'treasure', 'Treasure/GoldCup', 120, 'A trophy. Sells well.');
I('silver_cup', 'Silver Cup', 'treasure', 'Treasure/SilverCup', 60, 'A runner-up trophy.');
I('gold_key', 'Gold Key', 'treasure', 'Treasure/GoldKey', 0, 'Opens something golden.');
I('silver_key', 'Silver Key', 'treasure', 'Treasure/SilverKey', 0, 'Opens something silver.');
I('chest_small', 'Little Chest', 'treasure', 'Treasure/LittleTreasureChest', 0, 'A small locked chest.');
I('chest_big', 'Treasure Chest', 'treasure', 'Treasure/BigTreasureChest', 0, 'A big treasure chest.');
I('gold_coin', 'Gold Coin', 'treasure', 'Treasure/GoldCoin', 1, 'Shiny.');
I('silver_coin', 'Silver Coin', 'treasure', 'Treasure/SilverCoin', 1, 'Less shiny.');
I('money_bag', 'Money Bag', 'treasure', 'Object/MoneyBag', 50, 'Heavy with coin.');
I('hourglass', 'Hourglass', 'treasure', 'Object/Hourglass', 40, 'Sand runs both ways.');
I('pan_flute', 'Pan Flute', 'treasure', 'Object/PanFlute', 25, 'Plays a sweet tune.');
I('dice20', 'Twenty-sided Die', 'treasure', 'Object/Dice_20', 10, 'Roll for initiative.');
I('gourd', 'Gourd', 'treasure', 'Object/Gourd', 6, 'A drinking gourd.');
I('book', 'Old Book', 'treasure', 'Object/Book', 15, 'Dusty.');
I('bag', 'Satchel', 'treasure', 'Object/Bag', 10, 'Roomy.');
I('letter', 'Sealed Letter', 'treasure', 'Other/Letter', 0, 'Addressed to someone far away.');
I('bomb', 'Bomb', 'tool', 'Projectile/Bomb', 18, 'Boom.');
I('dynamite', 'Dynamite', 'tool', 'Projectile/Dynamite', 25, 'Boom, but louder.');
I('caltrop', 'Caltrops', 'tool', 'Projectile/Caltrop', 10, 'Nasty for pursuers.');
// tools
for (const [id, nm, f, p] of [['tool_axe', 'Woodsman Axe', 'Axe', 40], ['tool_hammer', 'Smith Hammer', 'Hammer', 40], ['tool_pickaxe', 'Pickaxe', 'Pickaxe', 45], ['tool_shovel', 'Shovel', 'Shovel', 30], ['tool_hoe', 'Hoe', 'Hoe', 30], ['tool_sickle', 'Sickle', 'Sickle', 30], ['tool_can', 'Watering Can', 'WateringCan', 25], ['tool_anvil', 'Anvil', 'Anvil', 150]]) I(id, nm, 'tool', `Tool/${f}`, p, 'A trusty tool for crafting and gathering.');
// weapon art (icons only; real gear stats live in data/gear.js)
for (const [id, nm, f] of [['w_club', 'Club', 'Club'], ['w_lance', 'Lance', 'Lance'], ['w_lance2', 'Iron Lance', 'Lance2'], ['w_stick', 'Walking Stick', 'Stick'], ['w_whip', 'Whip', 'Whip'], ['w_fork', 'Pitchfork', 'Fork'], ['w_pickaxe', 'Miner Pick', 'Pickaxe'], ['w_fishing', 'Fishing Rod', 'Fishing_Rod'], ['w_axe', 'Hand Axe', 'Axe'], ['w_bigsword', 'Great Sword', 'BigSword'], ['w_katana', 'Katana', 'Katana'], ['w_rapier', 'Rapier', 'Rapier'], ['w_sai', 'Sai', 'Sai'], ['w_bone', 'Bone Club', 'Bone'], ['w_book', 'Spell Tome', 'Book'], ['w_ninjaku', 'Ninjaku', 'Ninjaku'], ['w_sword2', 'Steel Sword', 'Sword2'], ['w_bow2', 'Hunting Bow', 'Bow2']]) I(id, nm, 'weapon', `Weapons/${f}/Sprite`, 50, 'Weapon art (see gear for stats).');

export const ITEM_LIST = Object.values(ITEMS);
export const itemById = (id) => ITEMS[id];

// ——— minimal inventory wiring ———
const pack = (scene) => (scene.questState.pack ||= {});
export function packCount(scene, id) { return pack(scene)[id] || 0; }
export function giveItem(scene, id, n = 1) { if (ITEMS[id]) pack(scene)[id] = packCount(scene, id) + n; }
export function takeItem(scene, id, n = 1) { const p = pack(scene); if ((p[id] || 0) < n) return false; p[id] -= n; if (p[id] <= 0) delete p[id]; return true; }
export function packList(scene, kind) { return Object.entries(pack(scene)).filter(([id]) => ITEMS[id] && (!kind || ITEMS[id].kind === kind)).map(([id, n]) => ({ ...ITEMS[id], n })); }

// Use a consumable. Returns a message string on success, null if it couldn't be used.
export function useItem(scene, id) {
  const it = ITEMS[id], p = scene.player;
  if (!it?.use || packCount(scene, id) < 1 || p.dead) return null;
  const u = it.use;
  if (u.effect === 'home') {
    if (scene.areas?.current) { return null; }
    takeItem(scene, id);
    scene.spawnFx?.(p.x, p.y - 8, 'fx.boost', 1.2);
    p.setPosition(scene.spawn.x, scene.spawn.y + 24);
    scene.spawnFx?.(p.x, p.y - 8, 'fx.spark', 1.4);
    return 'The scroll crumbles... you are back in Thistle Town.';
  }
  if (u.effect) {
    takeItem(scene, id);
    const fx = { fire: 'fx.explosion', ice: 'fx.shieldBlue', thunder: 'fx.spark' }[u.effect];
    scene.spawnFx?.(p.x, p.y - 8, fx, 2);
    const dmg = 40 + p.level * 6;
    scene.enemies?.getChildren().forEach((e) => {
      if (e.hurt && Math.hypot(e.x - p.x, e.y - p.y) < 64) scene.damageEnemy(e, dmg);
    });
    return `${it.name}: the scroll flares!`;
  }
  const hpGain = (u.hp || 0) + Math.round((u.hpPct || 0) * p.effMaxHp());
  const hp0 = p.hp, mp0 = p.mp;
  if (hpGain && p.hp >= p.effMaxHp() && !u.mp) return null;
  if (u.mp && !hpGain && p.mp >= p.effMaxMp()) return null;
  takeItem(scene, id);
  if (hpGain) p.heal(hpGain);
  if (u.mp) p.mp = Math.min(p.effMaxMp(), p.mp + u.mp);
  scene.spawnFx?.(p.x, p.y - 10, 'fx.spark', 1.1);
  if (hpGain) scene.damageNumber?.(p.x, p.y, `+${Math.round(p.hp - hp0)}`, '#2ecc71');
  if (u.mp) scene.damageNumber?.(p.x + 8, p.y - 6, `+${Math.round(p.mp - mp0)}`, '#5ab8ff');
  return `${it.name}: ${hpGain ? `+${Math.round(p.hp - hp0)} HP ` : ''}${u.mp ? `+${Math.round(p.mp - mp0)} MP` : ''}`.trim();
}
// Best consumable of a kind for the H (food) / Y (scroll) hotkeys.
export function bestOwned(scene, kind) {
  const list = packList(scene, kind).filter((i) => i.use);
  if (kind === 'scroll') return (list.find((i) => i.use.effect === 'home') || list[0])?.id;
  list.sort((a, b) => ((a.use.hp || 0) + (a.use.mp || 0)) - ((b.use.hp || 0) + (b.use.mp || 0)));
  return list[0]?.id; // cheapest first, save the good stuff
}
