import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';

// Simple day/night cycle: 6-minute days, overlay alpha + zone label.
export class DayNight {
  constructor(scene) {
    this.scene = scene;
    this.t = 0.3; // start mid-morning
    // Depth 3000: world uses y-sort (depth = y, up to 2048), overlay must sit
    // above everything in-scene (UI lives in its own scene above this).
    this.overlay = scene.add.rectangle(0, 0, 10, 10, 0x0b1026, 0).setOrigin(0).setDepth(3000).setScrollFactor(0);
    this.fitOverlay();
    // Static vignette (soft dark corners) + warm dusk wash, both screen-space.
    this.vig = scene.add.image(0, 0, this.makeVignette()).setOrigin(0).setDepth(2999).setScrollFactor(0).setAlpha(0.55);
    this.dusk = scene.add.rectangle(0, 0, 10, 10, 0xff8a3c, 0).setOrigin(0).setDepth(2998).setScrollFactor(0).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.fitOverlay();
  }
  makeVignette() {
    const key = 'fx.vignette';
    if (this.scene.textures.exists(key)) return key;
    const S = 256, tex = this.scene.textures.createCanvas(key, S, S), c = tex.getContext();
    const g = c.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(5,10,25,0.85)');
    c.fillStyle = g; c.fillRect(0, 0, S, S); tex.refresh();
    return key;
  }
  fitOverlay() {
    this.overlay.setDisplaySize(this.scene.scale.width * 2, this.scene.scale.height * 2);
    this.vig?.setDisplaySize(this.scene.scale.width, this.scene.scale.height);
    this.dusk?.setDisplaySize(this.scene.scale.width * 2, this.scene.scale.height * 2);
    this._ow = this.scene.scale.width; this._oh = this.scene.scale.height;
  }
  update(dt) {
    this.t = (this.t + dt / 360) % 1;
    // alpha peaks at midnight (t=0), zero at noon (t=0.5)
    const night = Math.max(0, Math.cos(this.t * Math.PI * 2)) * 0.42;
    this.overlay.setAlpha(night);
    // warm wash near dawn/dusk (t≈0.25 / 0.75)
    this.dusk.setAlpha(Math.pow(Math.max(0, Math.cos((((this.t * 2) % 1) - 0.5) * Math.PI * 2)), 6) * 0.22 * (Math.abs(Math.cos(this.t * Math.PI * 2)) < 0.75 ? 1 : 0));
    if (this.scene.scale.width !== this._ow || this.scene.scale.height !== this._oh) this.fitOverlay();
    bus.emit(Events.TIME, { t: this.t, night });
  }
  get isNight() { return Math.cos(this.t * Math.PI * 2) > 0.4; }
}
