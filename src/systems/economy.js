// Economy helpers: vendor stock rotation (restock every RESTOCK_MS), materials
// for sale, sell values and the buy-back list (meta.buyback, max 10).
import { SHOPS, gearById, sellPrice } from '../data/gear.js';
import { matById } from '../data/materials.js';

export const RESTOCK_MS = 10 * 60 * 1000;
export const BUYBACK_MAX = 10;
export const INN_COST = 10;

// Healing Potion (Q): heals at least 45 HP, or 20% of max HP so it stays relevant as HP grows
// (45 HP is 31% of a Lv1 hero but 8% at Lv20). Price creeps up 1g per 4 levels: 3g at Lv1-3 .. 8g at Lv20.
export const potionHeal = (maxHp) => Math.max(45, Math.round((maxHp || 0) * 0.2));
export const potionPrice = (level) => 3 + Math.floor(Math.max(1, level || 1) / 4);

// Materials vendors sell (price = buy cost)
export const MAT_STOCK = {
  maren: [{ id: 'empty_vial', price: 2 }, { id: 'oak_log', price: 6 }, { id: 'herbal_tonic', price: 22 }],
  bram: [{ id: 'whetstone', price: 18 }],
  dovey: [],
};

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const restockWindow = (now = Date.now()) => Math.floor(now / RESTOCK_MS);
export const restockIn = (now = Date.now()) => RESTOCK_MS - (now % RESTOCK_MS);

// Gear for sale now: cheap staples always; the rest rotates (~60% of it) each window.
export function shopStock(shopId, now = Date.now()) {
  const all = (SHOPS[shopId]?.stock || []).map(gearById).filter(Boolean);
  const win = restockWindow(now);
  return all.filter((g) => g.price <= 55 || hash(`${shopId}:${win}:${g.id}`) % 100 < 60).map((g) => g.id);
}

export const matSellValue = (id) => matById(id)?.price || 0;
export const buybackCost = (entry, now = Date.now()) => (entry.at && now - entry.at < UNDO_SELL_MS ? entry.price : Math.max(1, Math.ceil(entry.price * 1.25)));

export const UNDO_SELL_MS = 60 * 1000; // an accidental sale can be undone at the sell price for a minute
export function pushBuyback(meta, entry) {
  entry.at = Date.now();
  const list = meta.buyback;
  const same = list.find((b) => b.kind === entry.kind && b.id === entry.id && b.price === entry.price);
  if (same) same.n += entry.n; else list.unshift(entry);
  while (list.length > BUYBACK_MAX) list.pop();
}
export { sellPrice };
