// Two-phase asset loading.
//  phase 1 (boot): nothing but fonts — the title is generated procedurally, so it is interactive almost immediately.
//  phase 2 (this file): the ~700 sprite/face/item/FX/SFX files stream in on the persistent Boot scene's loader while
//  the player sits on the title screen. Anything that needs the world (creator / world / ui scenes) is gated on
//  `whenWorldReady()` (scenes/lazy.js shows the "preparing the world" veil if it is still running).
import { preloadWorld, createAnims } from './loader.js';
import { makeGearTextures } from '../systems/gearArt.js';
import { GEAR } from '../data/gear.js';

let resolveReady;
const readyPromise = new Promise((r) => { resolveReady = r; }); // resolves when phase 2 completes (even if started later)
export const worldAssets = { state: 'idle', progress: 0, promise: null, listeners: new Set() };
export const worldReady = () => worldAssets.state === 'ready';
export const whenWorldReady = () => readyPromise;

export function startWorldLoad(scene) {
  if (worldAssets.promise) return worldAssets.promise;
  worldAssets.state = 'loading';
  worldAssets.promise = new Promise((resolve) => {
    const L = scene.load;
    L.on('progress', (v) => { worldAssets.progress = v; worldAssets.listeners.forEach((f) => f(v)); });
    L.on('loaderror', (f) => console.warn('loaderror', f?.key));
    L.once('complete', () => {
      try {
        softenShadow(scene);
        createAnims(scene);
        makeGearTextures(scene, GEAR);
      } catch (e) { console.error('world asset finalize failed', e); }
      worldAssets.state = 'ready'; worldAssets.progress = 1;
      worldAssets.listeners.forEach((f) => f(1));
      resolve(); resolveReady();
    });
    preloadWorld(scene);
    L.start();
  });
  return worldAssets.promise;
}

// Replace the hard black blob with a soft radial ellipse so sprites sit on the ground.
function softenShadow(scene) {
  const key = 'char.shadow', W = 32, H = 12;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, W, H);
  const ctx = tex.getContext();
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(1, H / W);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, W / 2);
  g.addColorStop(0, 'rgba(10,20,10,0.42)'); g.addColorStop(0.6, 'rgba(10,20,10,0.26)'); g.addColorStop(1, 'rgba(10,20,10,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, W / 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  tex.refresh();
}
