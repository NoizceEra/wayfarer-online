import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { settings, impl } from './fxSettings.js';

// Day/night cycle (6-minute days, t: 0 = midnight, 0.25 dawn, 0.5 noon, 0.75 dusk)
// with a proper colour-grade curve: night blue -> dawn pink -> morning cream ->
// noon neutral -> golden hour -> dusk orange -> violet -> night blue. The grade is a
// single MULTIPLY quad glued to the camera (cheap, no per-pixel work on our side);
// weather multiplies its own tint on top via `extra`. The darkness-with-light-holes
// lives in lighting.js (this module only exposes the curves it needs).

const GRADE = [ // [t, r, g, b]  (multiply colour, 255 = neutral)
  [0.00, 92, 104, 158],
  [0.14, 96, 106, 162],
  [0.21, 150, 130, 176],
  [0.25, 255, 186, 186], // dawn pink
  [0.30, 255, 212, 196],
  [0.38, 255, 244, 232],
  [0.46, 255, 255, 255], // noon neutral
  [0.58, 255, 252, 242],
  [0.67, 255, 226, 178], // golden hour
  [0.74, 255, 168, 104], // dusk orange
  [0.79, 214, 132, 136],
  [0.85, 128, 112, 168],
  [0.92, 98, 106, 160],
  [1.00, 92, 104, 158],
];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function gradeAt(t, out = [255, 255, 255]) {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < GRADE.length - 2 && t > GRADE[i + 1][0]) i++;
  const a = GRADE[i], b = GRADE[i + 1];
  const k = sstep(a[0], b[0], t);
  out[0] = a[1] + (b[1] - a[1]) * k; out[1] = a[2] + (b[2] - a[2]) * k; out[2] = a[3] + (b[3] - a[3]) * k;
  return out;
}
// 0 (day) .. 1 (full night): darkness overlay strength
export function nightAmt(t) {
  t = ((t % 1) + 1) % 1;
  if (t >= 0.74) return sstep(0.74, 0.88, t);
  if (t <= 0.28) return 1 - sstep(0.14, 0.28, t);
  return 0;
}
// 0..1: lamps / windows / torch glow (switch on a little before it is really dark)
export function lampAmt(t) {
  t = ((t % 1) + 1) % 1;
  if (t >= 0.66) return sstep(0.66, 0.78, t);
  if (t <= 0.31) return 1 - sstep(0.2, 0.31, t);
  return 0;
}
// Sun for shadows: elevation 0..1 and horizontal direction (-1 east .. +1 west)
export function sunAt(t) {
  t = ((t % 1) + 1) % 1;
  const a = ((t - 0.25) / 0.5) * Math.PI; // 0 at dawn, PI at dusk
  const up = a > 0 && a < Math.PI;
  const elev = up ? Math.sin(a) : 0;
  return { elev, dir: up ? Math.cos(a) : 0 };
}

export class DayNight {
  constructor(scene) {
    this.scene = scene;
    this.t = 0.3; // start mid-morning
    this.frozen = false;
    this.extra = [1, 1, 1]; // weather tint (multiplied into the grade)
    this.indoor = 0;
    this._rgb = [255, 255, 255];
    this.nightColor = [255, 255, 255]; // light-map base colour (used by lighting.js)
    this.nightA = 0; this.lamp = 0;
    // Kept for compatibility (AreaManager toggles its visibility). Night darkness now
    // comes from lighting.js (med/high) or the deeper grade (low), so it stays transparent.
    this.overlay = scene.add.rectangle(0, 0, 10, 10, 0x0b1026, 0).setOrigin(0).setDepth(3000);
    // Depth 2330: above every y-sorted world object (<= 2048), below glows / weather /
    // damage numbers so lights and readable text are not tinted.
    this.grade = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 1).setOrigin(0).setDepth(2330).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.vig = scene.add.image(0, 0, this.makeVignette()).setOrigin(0).setDepth(2999).setAlpha(0.5);
    this.fitQuads();
    impl.isNight = () => this.isNight;
    impl.time = () => this.t;
    impl.setTime = (t) => { this.t = ((t % 1) + 1) % 1; };
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
  // Glue screen-sized quads to the camera's world view (works at any camera zoom).
  fitQuads() {
    const v = this.scene.cameras.main.worldView;
    const x = Math.floor(v.x) - 8, y = Math.floor(v.y) - 8, w = Math.ceil(v.width) + 16, h = Math.ceil(v.height) + 16;
    this.grade.setPosition(x, y).setDisplaySize(w, h);
    this.vig.setPosition(Math.floor(v.x), Math.floor(v.y)).setDisplaySize(Math.ceil(v.width), Math.ceil(v.height));
  }
  fitOverlay() { this.fitQuads(); }

  update(dt) {
    if (!this.frozen) this.t = (this.t + dt / 360) % 1;
    const a = this.scene.areas?.current;
    const inside = !!a && (a.kind === 'interior' || a.kind === 'dungeon');
    this.indoor += ((inside ? 1 : 0) - this.indoor) * Math.min(1, dt * 6);
    if (Math.abs(this.indoor - (inside ? 1 : 0)) < 0.01) this.indoor = inside ? 1 : 0;

    const n = nightAmt(this.t);
    this.nightA = n; this.lamp = lampAmt(this.t);
    gradeAt(this.t, this._rgb);
    const rgb = this._eff || (this._eff = [0, 0, 0]);
    rgb[0] = this._rgb[0]; rgb[1] = this._rgb[1]; rgb[2] = this._rgb[2];
    const lit = settings.q.lighting;
    // with the light map (med/high) the night darkness lives in lighting.js and the grade
    // fades to neutral as it takes over; without it (low) the grade itself carries the night
    const deep = lit ? 0 : n;
    const nc = this.nightColor, k = n * (1 - this.indoor);
    nc[0] = 255 + (52 - 255) * k; nc[1] = 255 + (64 - 255) * k; nc[2] = 255 + (122 - 255) * k;
    if (lit) { const f = sstep(0.45, 1, n); rgb[0] += (255 - rgb[0]) * f; rgb[1] += (255 - rgb[1]) * f; rgb[2] += (255 - rgb[2]) * f; }
    const e = this.extra, ind = this.indoor;
    const r = (rgb[0] * (1 - 0.4 * deep * 0.95) * e[0]) * (1 - ind) + 255 * ind * 0.96;
    const g = (rgb[1] * (1 - 0.4 * deep) * e[1]) * (1 - ind) + 255 * ind * 0.93;
    const b = (rgb[2] * (1 - 0.25 * deep) * e[2]) * (1 - ind) + 255 * ind * 0.88;
    const col = ((Math.min(255, r) | 0) << 16) | ((Math.min(255, g) | 0) << 8) | (Math.min(255, b) | 0);
    const neutral = r > 251 && g > 251 && b > 251;
    this.grade.setVisible(!neutral);
    if (!neutral) this.grade.setFillStyle(col, 1);
    this.vig.setAlpha(0.42 + n * 0.14 * (1 - ind));
    this.fitQuads();
    bus.emit(Events.TIME, { t: this.t, night: n * 0.42, nightAmt: n, isNight: this.isNight });
  }
  // `isNight` stays a property for existing callers; `nightAmount()` / `night()` for new code.
  get isNight() { return this.nightA > 0.5; }
  night() { return this.isNight; }
  nightAmount() { return this.nightA; }
  lampAmount() { return this.lamp; }
  sun() { return sunAt(this.t); }
}
