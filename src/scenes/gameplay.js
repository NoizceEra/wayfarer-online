// Gameplay scene bundle — loaded lazily (dynamic import) so the title screen does not pay for
// the whole world/HUD/panels graph. See src/scenes/lazy.js.
import { SKILL_TREES, ADV_TREE_GATES } from '../data/skillTrees.js';
import { injectPolishCss } from '../ui/hudPolish.js';
export { WorldScene } from './WorldScene.js';
export { UIScene } from './UIScene.js';
export { CharacterScene } from './CharacterScene.js';
export { OverlayScene } from './OverlayScene.js';
export { CreatorScene } from './CreatorScene.js';
export { default as GuildHallScene } from './GuildHallScene.js';
export { default as HomeIslandScene } from './HomeIslandScene.js';

// Specialization catalogue (skill trees + adv gates) for the spec runtime.
// Global (not import) so game code and UI panels share one catalogue object,
// including remote-player puppets sanitized on older shapes.
globalThis.__WAYFARER_SKILL_TREES__ = { ...SKILL_TREES, advGates: ADV_TREE_GATES };
injectPolishCss(); // additive HUD readability/mobile floors (ui/hudPolish.js; id-guarded)
