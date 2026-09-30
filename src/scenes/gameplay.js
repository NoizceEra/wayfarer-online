// Gameplay scene bundle — loaded lazily (dynamic import) so the title screen does not pay for
// the whole world/HUD/panels graph. See src/scenes/lazy.js.
export { WorldScene } from './WorldScene.js';
export { UIScene } from './UIScene.js';
export { CharacterScene } from './CharacterScene.js';
export { OverlayScene } from './OverlayScene.js';
