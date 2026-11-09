// Atlas-drawn town buildings.
//
// The art is generated, not hand-drawn: parametric 3D buildings (Zengkailin/parametric-
// topdown-pixel-architecture, MIT) rendered to pixel sprites, downscaled ÷8 and quantized
// to a 40-colour palette harvested from the game's own CC0 tilesets — see
// D:/ai-studio/parametric-topdown/buildings/build2.py. `src/data/buildings.js` is generated
// from the atlas JSON, so names, frames and footprints never drift from the sheet.
//
// Everything here degrades gracefully: if the atlas texture is not loaded (or a name is
// unknown) placeBuilding() returns null and the caller keeps its procedural graphics props.
import { BUILDINGS, BUILDING_ATLAS, BY_ZONE } from '../data/buildings.js';

export const atlasReady = (scene) => !!scene?.textures?.exists?.(BUILDING_ATLAS.key);

// Place one building with its base (feet) at (x, y) — the same anchor the graphics props use,
// so y-sorted depth and the existing shadow helper behave identically.
export function placeBuilding(scene, solids, ground, x, y, name, opts = {}) {
  const def = BUILDINGS[name];
  if (!def || !atlasReady(scene)) return null;
  const { scale = 1, shadow = true, solid = true, depth } = opts;

  if (shadow && ground?.D?.shadow) {
    // The sprite sits wider than its walls (eaves), so the shadow is a fraction of the frame.
    ground.D.shadow(x + 4, y + 1, Math.max(18, def.w * 0.74 * scale), Math.max(6, def.h * 0.13), 0.2);
  }

  const img = scene.add.image(x, y, BUILDING_ATLAS.key, def.f)
    .setOrigin(0.5, 1)
    .setScale(scale)
    .setDepth(depth ?? y);

  if (solid) {
    // Only the walls block: the eaves/roof overhang should be walk-under, and the box
    // stops at the base so the player can stand next to the facade.
    const w = Math.max(14, def.w * 0.66 * scale);
    const h = Math.max(10, def.h * 0.30 * scale);
    solids.add(scene.add.rectangle(x, y - h / 2, w, h, 0xffffff, 0));
  }
  return img;
}

// Deterministic pick for scatter placement — never touches the seeded rnd() stream.
export function pickBuilding(zone, v = 0) {
  const list = BY_ZONE[zone] || BY_ZONE.town || [];
  return list.length ? list[Math.abs(v) % list.length] : null;
}

export { BUILDINGS, BUILDING_ATLAS, BY_ZONE };
