// Lazy registration of the gameplay scenes (world/ui/character/overlay).
// * prefetchGameplay(): kicks off the dynamic import once (idempotent); safe to call any time.
// * installLazyScenes(game): guards SceneManager.queueOp so a start/launch of a not-yet-registered
//   gameplay scene waits for the chunk instead of failing (keeps `__wayfarer.scene.start('world')` working).
import { worldReady, whenWorldReady, worldAssets } from '../assets/worldLoad.js';
import { veil } from '../core/veil.js';
const LAZY_KEYS = new Set(['world', 'ui', 'character', 'overlay', 'creator', 'home', 'GuildHallScene']);
const NEEDS_WORLD_ASSETS = new Set(LAZY_KEYS); // scenes that draw sprites loaded in phase 2
let promise = null;
let ready = false;
let gameRef = null;
let syncTitleVideo = () => {};

export function gameplayReady() { return ready; }

export function prefetchGameplay() {
  if (promise) return promise;
  promise = import('./gameplay.js').then((m) => {
    const sm = gameRef?.scene;
    if (sm) {
      const add = (key, cls) => {
        if (sm.getScene(key)) return;
        sm.add(key, cls, false);
        if (key === 'world') {
          const world = sm.getScene(key);
          world.events.on('start', syncTitleVideo);
          // Defer until Phaser has applied the shutdown/start queue so a world
          // restart keeps the title video paused without a one-frame flash.
          world.events.on('shutdown', () => requestAnimationFrame(syncTitleVideo));
        }
      };
      add('world', m.WorldScene); add('ui', m.UIScene); add('character', m.CharacterScene); add('overlay', m.OverlayScene);
      add('creator', m.CreatorScene); add('home', m.HomeIslandScene); add('GuildHallScene', m.GuildHallScene);
    }
    ready = true;
    return m;
  }).catch((e) => { promise = null; console.error('gameplay chunk failed', e); throw e; });
  return promise;
}

export function installLazyScenes(game) {
  gameRef = game;
  const sm = game.scene;
  const orig = sm.queueOp.bind(sm);
  syncTitleVideo = () => {
    const video = document.getElementById('bg-video');
    if (!video || !video.dataset.armed) return; // trailer not attached (lazy / skipped on mobile)
    if (document.hidden || sm.isActive('world')) video.pause();
    else video.play().catch(() => {});
  };
  document.addEventListener('visibilitychange', syncTitleVideo);
  sm.queueOp = (op, src, data) => {
    const key = typeof src === 'string' ? src : src?.sys?.settings?.key;
    const starting = op === 'start' || op === 'launch' || op === 'run';
    const waitChunk = LAZY_KEYS.has(key) && !ready;
    const waitAssets = NEEDS_WORLD_ASSETS.has(key) && !worldReady();
    if (starting && (waitChunk || waitAssets)) {
      // "Preparing the world" card with real progress while the background preload finishes
      let off = null;
      if (waitAssets) {
        veil.show('PREPARING THE WORLD');
        veil.progress(worldAssets.progress);
        const f = (v) => veil.progress(v);
        worldAssets.listeners.add(f); off = () => worldAssets.listeners.delete(f);
      }
      Promise.all([whenWorldReady(), waitChunk || LAZY_KEYS.has(key) ? prefetchGameplay() : null]).then(() => {
        off?.();
        orig(op, src, data);
        if (waitAssets) setTimeout(() => veil.hide(), 250);
      }).catch(() => { off?.(); veil.hide(); });
      return sm;
    }
    return orig(op, src, data);
  };
}
