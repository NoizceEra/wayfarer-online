// Lazy title-screen trailer. index.html ships a <video preload="none"> with a static WebP poster; this module decides
// whether to attach the mp4 at all and when. Never blocks interactivity: nothing is fetched until the title is up AND
// either the world-asset preload finished (so it does not compete for bandwidth) or the player interacted.
// Skipped entirely on coarse pointers (phones), Save-Data, slow effective connection and reduced-motion: poster only.
import { whenWorldReady } from '../assets/worldLoad.js';

const SRC = '/trailer/wayfarer_login_bg.mp4';

export function trailerAllowed() {
  try {
    const c = navigator.connection;
    if (window.matchMedia?.('(pointer: coarse)').matches) return false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    if (c && (c.saveData || /(^|-)2g$|3g/.test(c.effectiveType || '') || (c.downlink && c.downlink < 1.5))) return false;
  } catch { /* unknown: allow */ }
  return true;
}

export function installTrailer(game) {
  const video = document.getElementById('bg-video');
  if (!video || !trailerAllowed()) return;
  let started = false;
  const evs = ['pointerdown', 'keydown'];
  const off = () => evs.forEach((e) => window.removeEventListener(e, start));
  const arm = () => evs.forEach((e) => window.addEventListener(e, start, { once: true, passive: true }));
  function start() {
    if (started) return;
    started = true;
    off();
    if (document.hidden || game.scene.isActive('world')) return; // gameplay already running: poster only
    video.src = SRC;
    video.dataset.armed = '1';
    video.play().catch(() => {});
  }
  arm();
  const idle = (f) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 1500));
  whenWorldReady().then(() => idle(start));
}
