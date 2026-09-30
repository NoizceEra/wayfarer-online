// Economy helpers: vendor stock rotation (restock every RESTOCK_MS), materials
// for sale, sell values and the buy-back list (meta.buyback, max 10).
import { SHOPS, gearById, sellPrice } from '../data/gear.js';
import { matById } from '../data/materials.js';

export const RESTOCK_MS = 10 * 60 * 1000;
export const BUYBACK_MAX = 10;
export const INN_COST = 10;

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
export const buybackCost = (entry) => Math.max(1, Math.ceil(entry.price * 1.25));

export function pushBuyback(meta, entry) {
  const list = meta.buyback;
  const same = list.find((b) => b.kind === entry.kind && b.id === entry.id && b.price === entry.price);
  if (same) same.n += entry.n; else list.unshift(entry);
  while (list.length > BUYBACK_MAX) list.pop();
}
export { sellPrice };
