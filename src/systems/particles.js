import Phaser from 'phaser';

// Shared, fixed-size particle pool for all ambient / weather effects. Every
// particle is a pre-allocated Image that samples one small atlas texture, so the
// whole pool batches into a couple of draw calls and nothing is allocated or
// destroyed at runtime. Budget scales with the quality setting.

export const ATLAS = 'fx.atlas';
const F = {
  px: [0, 0, 2, 2], soft: [4, 0, 16, 16], streak: [22, 0, 2, 9], leaf: [26, 0, 5, 4],
  flake: [33, 0, 3, 3], ring: [38, 0, 24, 12], foot: [64, 0, 5, 4], puddle: [0, 18, 40, 20],
  spark: [44, 18, 5, 5], blade: [52, 18, 2, 5],
};

export function makeFxAtlas(scene) {
  if (scene.textures.exists(ATLAS)) return;
  const tex = scene.textures.createCanvas(ATLAS, 96, 40);
  const c = tex.getContext();
  const fill = (n, fn) => { const [x, y, w, h] = F[n]; c.save(); c.translate(x, y); fn(w, h); c.restore(); };
  fill('px', (w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); });
  fill('soft', (w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  fill('streak', (w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  fill('leaf', () => {
    c.fillStyle = '#fff'; c.fillRect(1, 0, 3, 1); c.fillRect(0, 1, 5, 2); c.fillRect(1, 3, 3, 1);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(2, 1, 1, 2);
  });
  fill('flake', () => { c.fillStyle = '#fff'; c.fillRect(1, 0, 1, 3); c.fillRect(0, 1, 3, 1); });
  fill('ring', (w, h) => {
    c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(w / 2, h / 2, w / 2 - 1.5, h / 2 - 1.5, 0, 0, 7); c.stroke();
  });
  fill('foot', () => { c.fillStyle = '#fff'; c.fillRect(1, 0, 3, 3); c.fillRect(0, 1, 5, 1); c.fillRect(1, 3, 3, 1); });
  fill('puddle', (w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.save(); c.translate(w / 2, h / 2); c.scale(1, h / w); c.translate(-w / 2, -w / 2);
    c.fillStyle = g; c.fillRect(0, 0, w, w); c.restore();
  });
  fill('spark', () => { c.fillStyle = '#fff'; c.fillRect(2, 0, 1, 5); c.fillRect(0, 2, 5, 1); c.fillRect(1, 1, 3, 3); });
  fill('blade', () => { c.fillStyle = '#fff'; c.fillRect(0, 0, 2, 5); });
  tex.refresh();
  for (const [n, [x, y, w, h]] of Object.entries(F)) tex.add(n, 0, x, y, w, h);
}

const ADD = Phaser.BlendModes.ADD;
const NORMAL = Phaser.BlendModes.NORMAL;

export class ParticlePool {
  constructor(scene, cap) {
    this.scene = scene;
    makeFxAtlas(scene);
    this.cap = 0;
    this.all = [];
    this.free = [];
    this.live = [];
    this.resize(cap);
  }

  resize(cap) {
    // grow only; shrinking just lowers the usable limit
    while (this.all.length < cap) {
      const img = this.scene.add.image(0, 0, ATLAS, 'px').setVisible(false).setActive(false);
      const p = { img, on: false };
      this.all.push(p); this.free.push(p);
    }
    this.cap = cap;
  }

  get freeCount() { return Math.max(0, this.cap - this.live.length); }

  // o: frame,x,y,vx,vy,ax,ay,drag,life,s0,s1,sx(stretchX mult),sy,a0,a1,tint,add,depth,rot,vr,swx,swy,swf,tw,fadeIn,cull,face
  // reserve: particles that must stay free for higher-priority effects
  spawn(o, reserve = 0) {
    if (this.live.length >= this.cap - reserve) return null;
    const p = this.free.pop();
    if (!p) return null;
    p.on = true;
    p.x = o.x; p.y = o.y; p.vx = o.vx || 0; p.vy = o.vy || 0; p.ax = o.ax || 0; p.ay = o.ay || 0; p.drag = o.drag || 0;
    p.age = 0; p.life = o.life || 1;
    p.s0 = o.s0 ?? 1; p.s1 = o.s1 ?? p.s0; p.sx = o.sx ?? 1; p.sy = o.sy ?? 1;
    p.a0 = o.a0 ?? 1; p.a1 = o.a1 ?? 0; p.fadeIn = o.fadeIn || 0; p.tw = o.tw || 0; p.ph = o.ph ?? Math.random() * 6.283;
    p.swx = o.swx || 0; p.swy = o.swy || 0; p.swf = o.swf || 2;
    p.rot = o.rot || 0; p.vr = o.vr || 0; p.face = !!o.face; p.cull = !!o.cull;
    p.land = o.land || null; // callback(x,y) on natural death
    const im = p.img;
    im.setFrame(o.frame || 'px').setPosition(p.x, p.y).setDepth(o.depth ?? 2600).setBlendMode(o.add ? ADD : NORMAL)
      .setScale(p.s0 * p.sx, p.s0 * p.sy).setAlpha(0).setRotation(p.rot).setVisible(true).setActive(true);
    if (o.tint !== undefined) im.setTint(o.tint); else im.clearTint();
    this.live.push(p);
    return p;
  }

  kill(i) {
    const p = this.live[i];
    p.on = false; p.img.setVisible(false).setActive(false);
    this.free.push(p);
    const last = this.live.pop();
    if (i < this.live.length) this.live[i] = last;
  }

  clear() { for (let i = this.live.length - 1; i >= 0; i--) this.kill(i); }

  update(dt, view) {
    const live = this.live;
    const vx0 = view.x - 60, vy0 = view.y - 60, vx1 = view.right + 60, vy1 = view.bottom + 80;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      if (p.age >= p.life) { const cb = p.land; const lx = p.x, ly = p.y; this.kill(i); if (cb) cb(lx, ly); continue; }
      if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
      p.vx += p.ax * dt; p.vy += p.ay * dt;
      let dx = p.vx, dy = p.vy;
      if (p.swx) dx += Math.sin(p.age * p.swf + p.ph) * p.swx;
      if (p.swy) dy += Math.cos(p.age * p.swf * 0.8 + p.ph) * p.swy;
      p.x += dx * dt; p.y += dy * dt;
      if (p.cull && (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1)) { this.kill(i); continue; }
      const k = p.age / p.life;
      let a = p.a0 + (p.a1 - p.a0) * k;
      if (p.fadeIn && p.age < p.fadeIn) a *= p.age / p.fadeIn;
      if (p.tw) a *= 0.55 + 0.45 * Math.sin(p.age * p.tw + p.ph);
      const s = p.s0 + (p.s1 - p.s0) * k;
      const im = p.img;
      im.x = p.x; im.y = p.y;
      im.setScale(s * p.sx, s * p.sy);
      im.alpha = a;
      if (p.face) im.rotation = -Math.atan2(dx, dy);
      else if (p.vr) im.rotation = p.rot + p.vr * p.age;
    }
  }
}
