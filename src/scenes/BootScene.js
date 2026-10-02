import Phaser from 'phaser';
import { startWorldLoad } from '../assets/worldLoad.js';
import { prefetchGameplay } from './lazy.js';
import { veil } from '../core/veil.js';
import { audio } from '../systems/audio.js';

// Boot is deliberately tiny: the DOM splash (index.html) is already on screen, fonts are the only blocking
// dependency, and the title scene is procedural. Boot then STAYS RUNNING as the host of the background
// world-asset loader (assets/worldLoad.js) and of lazy audio fetches.
export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }
  create() {
    // Canvas stays transparent so HTML5 video behind it shows through
    this.cameras.main.setRoundPixels(true);
    audio.host = this; // lazy music/jingle fetches use this scene's loader (it is never shut down)
    veil.show('LOADING');
    veil.progress(0.3);
    const go = () => {
      veil.progress(1);
      this.scene.launch('title'); // launch (not start): Boot keeps running to host the loader
      // let the title paint a frame, drop the splash, then stream the world in without competing with first paint
      setTimeout(() => {
        veil.hide();
        startWorldLoad(this);
        setTimeout(() => prefetchGameplay().catch(() => {}), 300);
      }, 120);
    };
    // fonts.ready alone can resolve before the lazy @font-face fonts are requested: load the ones the title uses explicitly.
    const fonts = ['16px "Silkscreen"', '16px "Jacquard12"', '16px "PixelifySans"'].map((f) => document.fonts.load(f).catch(() => {}));
    Promise.race([Promise.all(fonts).then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 2500))]).then(go);
  }
}
