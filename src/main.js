import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { CreatorScene } from './scenes/CreatorScene.js';
import { WorldScene } from './scenes/WorldScene.js';
import { UIScene } from './scenes/UIScene.js';
import { CharacterScene } from './scenes/CharacterScene.js';
import { OverlayScene } from './scenes/OverlayScene.js';

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
// ?renderer=canvas forces the 2D fallback (weak GPUs, broken GL, headless tests)
const forceCanvas = new URLSearchParams(window.location.search).get('renderer') === 'canvas';

const game = new Phaser.Game({
  type: forceCanvas ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  pixelArt: true,
  roundPixels: true,
  resolution: dpr,
  disableContextMenu: true,
  fps: { target: 60, smoothStep: true },
  render: { antialias: false, roundPixels: true },
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false, fps: 60 } },
  scene: [BootScene, TitleScene, CreatorScene, WorldScene, UIScene, CharacterScene, OverlayScene],
  backgroundColor: '#0f380f',
  // RESIZE: canvas always fills the window; scenes pick integer zooms (core/display.js)
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight, autoCenter: Phaser.Scale.NO_CENTER },
});

// Debug/testing handle (also used by automated smoke tests).
window.__wayfarer = game;
