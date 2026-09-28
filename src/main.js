import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { CreatorScene } from './scenes/CreatorScene.js';
import { WorldScene } from './scenes/WorldScene.js';
import { UIScene } from './scenes/UIScene.js';

// Mobile hardening: no pinch-zoom gestures, no long-press menu, no dblclick zoom.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300) e.preventDefault(); // kill double-tap zoom
  lastTouchEnd = now;
}, { passive: false });

const coarse = window.matchMedia?.('(pointer: coarse)').matches;
const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2); // perf: cap DPR

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  pixelArt: true,
  roundPixels: true,
  resolution: dpr,
  disableContextMenu: true,
  fps: { target: 60, smoothStep: true },
  render: { antialias: false, roundPixels: true, powerPreference: 'high-performance' },
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false, fps: 60 } },
  scene: [BootScene, TitleScene, CreatorScene, WorldScene, UIScene],
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
});
