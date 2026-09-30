// PWA: service worker registration, update prompt, install (A2HS) prompt capture.
// Production only (the SW is stamped at build time and would just cache stale dev modules).
// Opt out with ?nosw=1 (also unregisters an existing worker + clears its caches).

import { whenWorldReady } from '../assets/worldLoad.js';

export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

let deferredInstall = null;
export const canInstall = () => !!deferredInstall;
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const r = await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  return r?.outcome === 'accepted';
}

function showUpdatePrompt(reg) {
  if (document.getElementById('wf-update')) return;
  const box = document.createElement('div');
  box.id = 'wf-update';
  box.innerHTML = '<span>New version available</span><button type="button">RELOAD</button><button type="button" class="ghost">LATER</button>';
  const [go, later] = box.querySelectorAll('button');
  go.addEventListener('click', () => {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    (reg.waiting || reg.installing)?.postMessage('SKIP_WAITING');
    setTimeout(() => { if (!reloaded) location.reload(); }, 3000);
  });
  later.addEventListener('click', () => box.remove());
  document.body.append(box);
}

export function installPwa() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; window.dispatchEvent(new Event('wf-can-install')); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; });
  if (!('serviceWorker' in navigator)) return;
  const params = new URLSearchParams(location.search);
  if (params.get('nosw') === '1') {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    caches?.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
    return;
  }
  if (!import.meta.env.PROD) return;
  // register after load so the SW's precache traffic never competes with the title screen
  const reg = () => navigator.serviceWorker.register('/sw.js').then((r) => {
    window.__swReg = r;
    // tell the worker what this first visit already downloaded so offline play works after a single load
    Promise.all([navigator.serviceWorker.ready, whenWorldReady()]).then(([rdy]) => {
      setTimeout(() => {
        const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/assets/'));
        (rdy.active || navigator.serviceWorker.controller)?.postMessage({ type: 'CACHE_URLS', urls });
      }, 2000);
    }).catch(() => {});
    if (r.waiting && navigator.serviceWorker.controller) showUpdatePrompt(r);
    r.addEventListener('updatefound', () => {
      const nw = r.installing;
      nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt(r); });
    });
    // long sessions: look for a new deploy hourly
    setInterval(() => r.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('sw register failed', e));
  if (document.readyState === 'complete') setTimeout(reg, 1500); else window.addEventListener('load', () => setTimeout(reg, 1500));
}
