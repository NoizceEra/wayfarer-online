export const CONFIG = {
  tile: 16,
  // One large open map (larger scale than Lanternfall's 4 small regions)
  worldCols: 128,
  worldRows: 128,
  playerSpeed: 95,
  enemySpeed: 45,
  maxParty: 8,
  interactRadius: 26,
  palettes: ['classic', 'pocket', 'color', 'modern'],
  // production builds fall back to the public relay if VITE_SERVER_URL isn't set on the host
  serverUrl: import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'wss://wayfarer-relay-production.up.railway.app' : 'ws://localhost:2567'),
  isMobile: (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)
    || (typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 620),
};
