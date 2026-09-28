import Phaser from 'phaser';
import { preload, createAnims } from '../assets/loader.js';
import { makeGearTextures } from '../systems/gearArt.js';
import { GEAR } from '../data/gear.js';

export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }
  preload() {
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor('#0f380f');
    const label = this.add.text(W / 2, H / 2 - 20, 'LOADING EMBERVALE…', { fontSize: '16px', color: '#9bbc0f' }).setOrigin(0.5);
    const bar = this.add.rectangle(W / 2 - 110, H / 2 + 6, 220, 12, 0x000000, 0.7).setOrigin(0, 0.5);
    const fill = this.add.rectangle(W / 2 - 108, H / 2 + 6, 0, 8, 0x9bbc0f).setOrigin(0, 0.5);
    this.load.on('progress', (v) => fill.setDisplaySize(216 * v, 8));
    this.load.on('loaderror', (f) => console.warn('loaderror', f?.key));
    label.setText('LOADING EMBERVALE…');
    preload(this);
  }
  create() {
    this.cameras.main.setRoundPixels(true);
    this.physics.world.setFPS(60);
    createAnims(this);
    makeGearTextures(this, GEAR);
    this.scene.start('title');
  }
}
