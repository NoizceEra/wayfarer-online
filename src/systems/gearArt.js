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

// Undyed items of these styles use the AI-generated 32px icon art (see tools/slice_icons.py);
// colour-variant clothing keeps the dye-aware procedural icon.
const AI_STYLE = {
  sword: 'sword', greatsword: 'greatsword', axe: 'axe', hammer: 'warhammer', dagger: 'dagger', rapier: 'scimitar', bow: 'bow',
  staff: 'staff_wood', wand: 'wand_fire', tome: 'tome', round: 'shield', kite: 'shield', tower: 'shield',
  helm: 'helm', helm_plume: 'helm_winged', horns: 'helm_horned', cone_stars: 'hat_wizard', crown_gem: 'crown',
  plate: 'plate', mail: 'plate', wings_angel: 'wings', greaves: 'greaves', boots: 'boots', mask: 'mask', glasses: 'glasses',
  locket: 'amulet', gem: 'crystal', hood: 'hood_ranger',
};

// Texture key `gear.icon.<id>[.<dyeId>]` (created on demand).
export function iconKey(scene, item, dyeId) {
  const dye = item.dyeable !== false && dyeId && dyeById(dyeId) ? dyeId : null;
  const ai = !dye && AI_STYLE[item.style] && `icon.ai.${AI_STYLE[item.style]}`;
  if (ai && scene.textures.exists(ai)) return ai;
  const k = `gear.icon.${item.id}${dye ? `.${dye}` : ''}`;
  if (!scene.textures.exists(k)) scene.textures.addCanvas(k, iconCanvas(item, itemTint(item, dye), item.colors.trim));
  return k;
}

// Boot: pre-bake every default icon so drops/shop never hitch.
export function makeGearTextures(scene, gearMap) {
  for (const item of Object.values(gearMap)) iconKey(scene, item, null);
}
