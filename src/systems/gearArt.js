// Gear art façade. Worn overlays live in wearArt.js (per-facing pixel layers),
// inventory icons in iconArt.js (16x16, outlined, dye-aware). Everything is
// generated at runtime from data/gear.js, so adding an item is one data row.
import { wearTexture } from './wearArt.js';
import { iconCanvas } from './iconArt.js';
import { dyeById } from '../data/gear.js';

export { wearTexture };

// Effective primary tint of an item given an optional dye id.
export function itemTint(item, dyeId) {
  const d = item.dyeable !== false && dyeId ? dyeById(dyeId) : null;
  return d ? d.tint : item.colors.main;
}

// Texture key `gear.icon.<id>[.<dyeId>]` (created on demand).
export function iconKey(scene, item, dyeId) {
  const dye = item.dyeable !== false && dyeId && dyeById(dyeId) ? dyeId : null;
  const k = `gear.icon.${item.id}${dye ? `.${dye}` : ''}`;
  if (!scene.textures.exists(k)) scene.textures.addCanvas(k, iconCanvas(item, itemTint(item, dye), item.colors.trim));
  return k;
}

// Boot: pre-bake every default icon so drops/shop never hitch.
export function makeGearTextures(scene, gearMap) {
  for (const item of Object.values(gearMap)) iconKey(scene, item, null);
}
