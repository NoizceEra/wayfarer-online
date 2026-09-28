import { bus, Events } from '../core/events.js';

// Simple day/night cycle: 6-minute days, overlay alpha + zone label.
export class DayNight {
  constructor(scene) {
    this.scene = scene;
    this.t = 0.3; // start mid-morning
    this.overlay = scene.add.rectangle(0, 0, 10, 10, 0x0b1026, 0).setOrigin(0).setDepth(50).setScrollFactor(0);
    this.overlay.setDisplaySize(scene.scale.width * 2, scene.scale.height * 2);
  }
  update(dt) {
    this.t = (this.t + dt / 360) % 1;
    // alpha peaks at midnight (t=0), zero at noon (t=0.5)
    const night = Math.max(0, Math.cos(this.t * Math.PI * 2)) * 0.42;
    this.overlay.setAlpha(night);
    bus.emit(Events.TIME, { t: this.t, night });
  }
  get isNight() { return Math.cos(this.t * Math.PI * 2) > 0.4; }
}
