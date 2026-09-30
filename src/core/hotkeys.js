// Hotkey registration shim for the content panels (journal = L, craft = U).
// If the input agent's registry (src/core/input.js) is present and exposes a
// register function, use it; otherwise bind a plain Phaser keyboard listener.
// Resolved with import.meta.glob so the build never depends on that file.
const inputMods = import.meta.glob('./input.js', { eager: true });
const mod = Object.values(inputMods)[0] || null;

export function registerHotkey(scene, action, key, fn) {
  // Dedupe: if both the registry and the fallback listener fire for one press, act once.
  let last = 0;
  const once = (...a) => { const t = performance.now(); if (t - last < 150) return; last = t; return fn(...a); };
  try {
    const reg = mod && (mod.registerAction || mod.registerHotkey || mod.registry?.register || mod.hotkeys?.register);
    if (typeof reg === 'function') reg.call(mod.registry || mod.hotkeys || mod, action, { key, scene, handler: once, onPress: once, label: action });
  } catch (e) { console.warn('hotkey registry failed, using fallback only', e); }
  scene.input.keyboard.on(`keydown-${key}`, once);
}
