/* Wayfarer Online service worker.
 * - App shell + hashed JS/CSS are precached per build (cache name carries the build id).
 * - Game art/audio/fonts (unhashed, /assets/**) use stale-while-revalidate in a separate, unversioned cache
 *   so a code deploy never re-downloads 20MB of sprites and music.
 * - Only same-origin GET requests are handled. Multiplayer (WebSocket relay / any other origin) and any
 *   /api, /matchmake or /colyseus path are never touched.
 * __BUILD_ID__ and the precache list are stamped by vite.config.js at build time.
 */
const BUILD = '__BUILD_ID__';
const SHELL_CACHE = `wf-shell-${BUILD}`;
const ASSET_CACHE = 'wf-assets-v1';
const PRECACHE = '__PRECACHE__'; // replaced with a JSON array at build; stays a string in dev (SW is not registered in dev)
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/assets/fonts/silkscreen/Silkscreen-Regular.ttf', '/assets/fonts/silkscreen/Silkscreen-Bold.ttf',
  '/assets/fonts/jacquard12/Jacquard12-Regular.ttf', '/assets/fonts/pixelifysans/PixelifySans_wght_.ttf', '/assets/fonts/jersey10/Jersey10-Regular.ttf'];

self.addEventListener('install', (event) => {
  const hashed = Array.isArray(PRECACHE) ? PRECACHE : [];
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll is atomic; tolerate one missing optional file by falling back to individual adds
    await Promise.all([...SHELL, ...hashed].map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    // no skipWaiting(): the page shows an "update available" prompt and sends SKIP_WAITING when accepted
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('wf-shell-') && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  else if (event.data && event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    // First visit: the page finished loading assets before this worker controlled it, so it tells us what it
    // used. They come from the HTTP cache (already downloaded), which makes offline solo play work after ONE load.
    event.waitUntil((async () => {
      const cache = await caches.open(ASSET_CACHE);
      for (const u of event.data.urls) {
        try {
          const url = new URL(u, self.location.origin);
          if (url.origin !== self.location.origin || !url.pathname.startsWith('/assets/') || await cache.match(url.pathname)) continue;
          await cache.add(new Request(url.pathname));
        } catch { /* ignore */ }
      }
    })());
  }
  else if (event.data === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', build: BUILD });
});

const isHashed = (p) => /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(p);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // relay / CDN / anything cross-origin: untouched
  if (/^\/(api|matchmake|colyseus)(\/|$)/.test(url.pathname)) return;
  if (req.headers.has('range')) return; // partial content can't be cached; let the network answer

  if (req.mode === 'navigate') {
    // network-first so a deploy shows up immediately; offline -> cached shell
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL_CACHE)).put('/index.html', res.clone()).catch(() => {});
        return res;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (isHashed(url.pathname)) { // immutable: cache-first
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL_CACHE)).put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') {
    // stale-while-revalidate
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = (await cache.match(req)) || (await caches.match(req));
      const net = fetch(req).then((res) => { if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
      if (hit) { event.waitUntil(net); return hit; }
      return (await net) || Response.error();
    })());
  }
});
