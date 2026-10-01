// Shared loot helpers for chests, dungeons and world events.
import { GEAR, RARITY } from '../data/gear.js';
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { giveItem, ITEMS } from '../data/items.js';
import { addMat } from './pack.js';

// Pick one wearable piece of gear the hero can actually use (level + class aware).
//   opts: { rarity: 'rare' | 'epic' | 'rare+' (rare or epic), epicChance, lvSlack }
export function rollChestGear(scene, opts = {}) {
  const { rarity = 'rare+', epicChance = 0.3, lvSlack = 3 } = opts;
  const lvl = scene.player.level, job = scene.player.job?.id;
  const want = rarity === 'rare+' ? (Math.random() < epicChance ? 'epic' : 'rare') : rarity;
  const fit = (g) => g.lvl <= lvl + lvSlack && (!g.cls || !job || g.cls.includes(job));
  const all = Object.values(GEAR);
  let pool = all.filter((g) => g.rarity === want && fit(g));
  if (!pool.length) pool = all.filter((g) => (g.rarity === 'rare' || g.rarity === 'epic') && fit(g));
  if (!pool.length) pool = all.filter((g) => g.rarity !== 'common' && g.rarity !== 'uncommon');
  return pool[Math.floor(Math.random() * pool.length)]?.id || null;
}

// Grant a loot bundle: {gold:[min,max], potions, items:{id:n}, mats:{id:n}, gear:{rarity,..}|id|null, xp}
// Returns display lines. `x,y` = world pos for floating text.
export function grantLoot(scene, bundle, label = 'Loot', x, y) {
  const p = scene.player, lines = [];
  if (bundle.gold) { const g = Array.isArray(bundle.gold) ? bundle.gold[0] + Math.floor(Math.random() * (bundle.gold[1] - bundle.gold[0] + 1)) : bundle.gold; p.gold += g; lines.push(`${g}g`); }
  if (bundle.potions) { p.potions += bundle.potions; lines.push(`${bundle.potions} potions`); }
  for (const [id, n] of Object.entries(bundle.items || {})) if (ITEMS[id]) { giveItem(scene, id, n); lines.push(`${ITEMS[id].name}${n > 1 ? ` x${n}` : ''}`); }
  for (const [id, n] of Object.entries(bundle.mats || {})) { if (addMat(scene, id, n, { quiet: true, noQuest: true })) lines.push(`${id.replace(/_/g, ' ')} x${n}`); }
  if (bundle.xp) { scene.combat?.grantXp(bundle.xp, x, y ? y - 30 : undefined); lines.push(`${bundle.xp} XP`); }
  if (bundle.gear) {
    const id = typeof bundle.gear === 'string' ? bundle.gear : rollChestGear(scene, bundle.gear === true ? {} : bundle.gear);
    if (id && scene.grantGear(id, label)) { const g = GEAR[id]; lines.push(`${g.name} [${RARITY[g.rarity].name}]`); }
    else if (id) lines.push(`${GEAR[id]?.name || id} (sold, bag full)`);
  }
  bus.emit(Events.PLAYER_HP, scene.hpPayload());
  bus.emit(Events.SYSTEM, `${label}: ${lines.join(', ')}`);
  audio.play('chest');
  return lines;
}
