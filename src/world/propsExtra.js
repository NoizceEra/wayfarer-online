import Phaser from 'phaser';

// Procedural props for the expansion maps, drawn from primitives in the same
// chunky style as the overworld trees/rocks (see overworld.js makeTree). Each
// factory returns a y-sorted container whose origin is at its "feet".
// `solids` (optional) is the static group that blocks the player/enemies.
export function makeProps(scene, solids, lights) {
  const hasShadow = () => scene.textures.exists('char.shadow');
  const cont = (x, y, shadowW = 0) => {
    const c = scene.add.container(x, y).setDepth(y);
    if (shadowW && hasShadow()) c.add(scene.add.image(0, 3, 'char.shadow').setScale(shadowW, 1).setAlpha(0.55));
    return c;
  };
  const gfx = (c) => { const g = scene.add.graphics(); c.add(g); return g; };
  const solid = (x, y, w, h) => { if (solids) solids.add(scene.add.rectangle(x, y, w, h, 0xffffff, 0)); };
  const glow = (x, y, scale, alpha, tint, depthBoost = 2900) => {
    if (!scene.textures.exists('fx.glow')) return null;
    const g = scene.add.image(x, y, 'fx.glow').setDepth(depthBoost).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha).setScale(scale);
    if (tint) g.setTint(tint);
    scene.tweens.add({ targets: g, alpha: alpha * 0.6, duration: 600 + Math.random() * 300, yoyo: true, repeat: -1, ease: 'sine.inout' });
    return g;
  };
  const flame = (c, x, y, r = 3, color = 0xe67e22) => {
    const f = scene.add.circle(x, y, r, color);
    const f2 = scene.add.circle(x, y + 1, r * 0.55, 0xf7dc6f);
    c.add([f, f2]);
    scene.tweens.add({ targets: [f, f2], scale: 1.35, duration: 260 + Math.random() * 120, yoyo: true, repeat: -1, ease: 'sine.inout' });
  };

  const P = {};

  // ——— Frostpeak ———
  P.pine = (x, y, s = 1) => {
    const c = cont(x, y, 1.6 * s);
    const g = gfx(c);
    g.fillStyle(0x5a3a1e, 1).fillRect(-2 * s, -7 * s, 4 * s, 8 * s);
    g.fillStyle(0x24583b, 1).fillTriangle(0, -24 * s, -13 * s, -6 * s, 13 * s, -6 * s);
    g.fillStyle(0x2e6b48, 1).fillTriangle(0, -34 * s, -10 * s, -15 * s, 10 * s, -15 * s);
    g.fillStyle(0x3a7d57, 1).fillTriangle(0, -42 * s, -7 * s, -26 * s, 7 * s, -26 * s);
    g.fillStyle(0xf4fbff, 1).fillTriangle(0, -42 * s, -3.5 * s, -34 * s, 3.5 * s, -34 * s);
    g.fillTriangle(0, -32 * s, -5 * s, -24 * s, 5 * s, -24 * s);
    g.fillTriangle(0, -22 * s, -7 * s, -14 * s, 7 * s, -14 * s);
    g.fillStyle(0xdcebf5, 1).fillRect(-11 * s, -7 * s, 22 * s, 2 * s);
    solid(x, y - 2, 8, 8);
    return c;
  };
  P.iceRock = (x, y, v = 0) => {
    const c = cont(x, y, 1.2);
    const g = gfx(c);
    g.fillStyle(0x6f8fa8, 1).fillCircle(-2, -2, 6 + (v % 3));
    g.fillStyle(0xa8c8dc, 1).fillCircle(3, -4, 4 + ((v >> 2) % 3));
    g.fillStyle(0xf4fbff, 1).fillCircle(-3, -6, 3);
    g.fillStyle(0xd2efff, 1).fillRect(1, -8, 2, 3);
    solid(x, y, 10, 8);
    return c;
  };
  P.drift = (x, y) => {
    const c = cont(x, y);
    const g = gfx(c);
    g.fillStyle(0xc9dbe8, 1).fillEllipse(0, 1, 18, 6);
    g.fillStyle(0xf4fbff, 1).fillEllipse(-1, -1, 15, 5);
    c.setDepth(1);
    return c;
  };
  P.tent = (x, y, color = 0xb5651d) => {
    const c = cont(x, y, 2.2);
    const g = gfx(c);
    g.fillStyle(0x6d3f10, 1).fillTriangle(0, -26, -18, 4, 18, 4);
    g.fillStyle(color, 1).fillTriangle(0, -24, -16, 3, 16, 3);
    g.fillStyle(0xe8d5a8, 1).fillTriangle(0, -24, -5, 3, 5, 3);
    g.fillStyle(0x2b1808, 1).fillTriangle(0, -12, -5, 3, 5, 3);
    g.fillStyle(0xf4fbff, 1).fillTriangle(0, -26, -4, -18, 4, -18);
    solid(x, y - 6, 26, 14);
    return c;
  };
  P.campfire = (x, y) => {
    const c = cont(x, y, 1.3);
    const g = gfx(c);
    g.fillStyle(0x4a3018, 1).fillRect(-7, -1, 14, 3).fillRect(-5, -3, 10, 2);
    g.fillStyle(0x7a7a7a, 1).fillCircle(-8, 0, 2).fillCircle(8, 0, 2).fillCircle(0, 3, 2);
    flame(c, 0, -6, 4);
    glow(x, y - 6, 1.1, 0.5, 0xffb060);
    return c;
  };

  // ——— Dock / beach ———
  P.palm = (x, y) => {
    const c = cont(x, y, 1.4);
    const g = gfx(c);
    g.fillStyle(0x7a5a30, 1).fillRect(-1, -14, 3, 15).fillRect(0, -22, 3, 9).fillRect(2, -30, 2, 9);
    g.fillStyle(0x5a4020, 1).fillRect(0, -12, 1, 2).fillRect(1, -20, 1, 2);
    const fr = (dx, dy, col) => { g.fillStyle(col, 1).fillTriangle(3, -30, 3 + dx, -30 + dy - 4, 3 + dx * 0.8, -30 + dy + 4); };
    fr(-16, 5, 0x2f8f3a); fr(16, 5, 0x2f8f3a); fr(-10, -5, 0x3faa4a); fr(12, -6, 0x3faa4a); fr(0, -10, 0x4cc05a);
    g.fillStyle(0x6b4a1e, 1).fillCircle(2, -28, 1.5).fillCircle(5, -27, 1.5);
    solid(x + 1, y - 2, 6, 6);
    return c;
  };
  P.driftwood = (x, y, v = 0) => {
    const c = cont(x, y, 1);
    const g = gfx(c);
    g.fillStyle(0x9b8a70, 1).fillRect(-8, -2, 15 + (v % 4), 3);
    g.fillStyle(0x7d6c52, 1).fillRect(-8, 0, 15 + (v % 4), 1).fillRect(-5, -4, 3, 2);
    c.setDepth(y - 6);
    return c;
  };
  P.shell = (x, y, v = 0) => {
    const c = cont(x, y);
    const g = gfx(c);
    const col = [0xf4b6c2, 0xf7e7ce, 0xe8a87c][v % 3];
    g.fillStyle(col, 1).fillCircle(0, 0, 2.2);
    g.fillStyle(0xffffff, 0.6).fillRect(-1, -1, 1, 1);
    c.setDepth(1);
    return c;
  };
  P.boat = (x, y, opts = {}) => {
    const { hull = 0x8b5a2b, trim = 0x5e3a1a, sail = 0xf4f0e6, mast = false, flip = 1 } = opts;
    const c = scene.add.container(x, y).setDepth(y);
    const hullC = scene.add.container(0, 0);
    const g = scene.add.graphics();
    g.fillStyle(0x1c5d8f, 0.35).fillEllipse(0, 6, 36, 8);
    g.fillStyle(trim, 1).fillRoundedRect(-17, -6, 34, 13, 6);
    g.fillStyle(hull, 1).fillRoundedRect(-16, -6, 32, 10, 5);
    g.fillStyle(0x3d2712, 1).fillRoundedRect(-13, -4, 26, 5, 3);
    g.fillStyle(0xb8844a, 1).fillRect(-6, -5, 2, 6).fillRect(6, -5, 2, 6);
    g.fillStyle(0xd9b87a, 1).fillRect(-16 * flip, -5, 2, 2);
    hullC.add(g);
    if (mast) {
      const m = scene.add.graphics();
      m.fillStyle(0x5e3a1a, 1).fillRect(-1, -34, 2, 30);
      m.fillStyle(sail, 1).fillTriangle(1, -33, 1, -9, 17 * flip, -9);
      m.fillStyle(0xd5cfc1, 1).fillTriangle(-1, -30, -1, -10, -11 * flip, -10);
      m.fillStyle(0xc0392b, 1).fillTriangle(-1, -37, -1, -33, 5, -35);
      hullC.add(m);
    }
    c.add(hullC);
    scene.tweens.add({ targets: hullC, y: { from: -1.2, to: 1.2 }, duration: 1500 + Math.random() * 500, yoyo: true, repeat: -1, ease: 'sine.inout' });
    scene.tweens.add({ targets: hullC, angle: { from: -1.5, to: 1.5 }, duration: 2100 + Math.random() * 500, yoyo: true, repeat: -1, ease: 'sine.inout' });
    return c;
  };
  P.lighthouse = (x, y) => {
    const c = cont(x, y, 2.2);
    const g = gfx(c);
    for (let i = 0; i < 5; i++) {
      const top = -14 - i * 14, w = 26 - i * 2.4;
      g.fillStyle(i % 2 ? 0xc0392b : 0xf0ede4, 1).fillRect(-w / 2, top, w, 14);
      g.fillStyle(0x00000022, 1).fillRect(w / 2 - 3, top, 3, 14);
    }
    g.fillStyle(0x34495e, 1).fillRect(-11, -88, 22, 4);
    g.fillStyle(0xf7dc6f, 1).fillRect(-7, -98, 14, 10);
    g.fillStyle(0xc0392b, 1).fillTriangle(0, -108, -10, -98, 10, -98);
    g.fillStyle(0x3d2712, 1).fillRect(-3, -12, 6, 12);
    glow(x, y - 93, 2.4, 0.55, 0xffe9a0);
    solid(x, y - 6, 24, 14);
    return c;
  };
  P.fishingLine = (x, y, dx, dy) => {
    const c = cont(x, y);
    const g = gfx(c);
    g.lineStyle(1, 0xe8e8e8, 0.9).lineBetween(0, -10, dx, dy);
    g.lineStyle(2, 0x5e3a1a, 1).lineBetween(-4, -6, 0, -14);
    const bob = scene.add.circle(dx, dy, 1.6, 0xe74c3c);
    c.add(bob);
    scene.tweens.add({ targets: bob, y: dy + 1.5, duration: 900, yoyo: true, repeat: -1, ease: 'sine.inout' });
    c.setDepth(y + 2);
    return c;
  };
  P.lamp = (x, y) => {
    const c = cont(x, y, 0.8);
    const g = gfx(c);
    g.fillStyle(0x2c3e50, 1).fillRect(-1, -20, 2, 21).fillRect(-3, 0, 6, 2);
    g.fillStyle(0x34495e, 1).fillRect(-4, -26, 8, 7);
    g.fillStyle(0xf7dc6f, 1).fillRect(-3, -25, 6, 5);
    glow(x, y - 22, 1, 0.3, 0xffd890);
    solid(x, y, 4, 4);
    return c;
  };
  P.net = (x, y) => {
    const c = cont(x, y, 1.2);
    const g = gfx(c);
    g.fillStyle(0x8a7a4a, 1).fillEllipse(0, -2, 18, 9);
    g.lineStyle(1, 0x5e5030, 1);
    for (let i = -6; i <= 6; i += 4) g.lineBetween(i, -6, i, 2);
    for (let j = -4; j <= 1; j += 3) g.lineBetween(-8, j, 8, j);
    g.fillStyle(0xe67e22, 1).fillCircle(-8, -2, 1.5).fillCircle(8, 1, 1.5);
    return c;
  };

  // ——— Crypt ———
  P.torch = (x, y, big = false) => {
    const c = cont(x, y);
    const g = gfx(c);
    g.fillStyle(0x3d2712, 1).fillRect(-1, -10, 2, 10);
    g.fillStyle(0x5a5a5a, 1).fillRect(-3, -11, 6, 2);
    flame(c, 0, -14, big ? 4 : 3);
    c.setDepth(y + 1);
    glow(x, y - 14, big ? 1.3 : 0.95, 0.5, 0xffa050, 2550);
    lights?.push({ x, y: y - 14, r: big ? 92 : 70 });
    return c;
  };
  P.brazier = (x, y) => {
    const c = cont(x, y, 1.1);
    const g = gfx(c);
    g.fillStyle(0x34302a, 1).fillRect(-5, -6, 10, 6).fillRect(-2, 0, 4, 3);
    g.fillStyle(0x6b5b3a, 1).fillRect(-6, -8, 12, 3);
    flame(c, 0, -12, 4, 0x8e44ad);
    c.add(scene.add.circle(0, -12, 2, 0xd7b8ff));
    solid(x, y - 2, 10, 8);
    glow(x, y - 12, 1.5, 0.5, 0xc090ff, 2550);
    lights?.push({ x, y: y - 12, r: 100 });
    return c;
  };
  P.tomb = (x, y, v = 0) => {
    const c = cont(x, y, 1.3);
    const g = gfx(c);
    g.fillStyle(0x5d5a66, 1).fillRoundedRect(-6, -16, 12, 17, { tl: 6, tr: 6, bl: 0, br: 0 });
    g.fillStyle(0x7a7684, 1).fillRoundedRect(-5, -15, 10, 5, { tl: 5, tr: 5, bl: 0, br: 0 });
    g.fillStyle(0x3e3b46, 1).fillRect(-1, -12, 2, 8).fillRect(-3, -10, 6, 2);
    if (v % 3 === 0) g.fillStyle(0x4f7a4a, 0.8).fillRect(-5, -2, 4, 2);
    solid(x, y - 4, 12, 8);
    return c;
  };
  P.sarcophagus = (x, y) => {
    const c = cont(x, y, 2.2);
    const g = gfx(c);
    g.fillStyle(0x3e3b46, 1).fillRect(-16, -9, 32, 11);
    g.fillStyle(0x6a6676, 1).fillRect(-16, -14, 32, 8);
    g.fillStyle(0x8a8698, 1).fillRect(-14, -13, 28, 3);
    g.fillStyle(0xd5cfc1, 1).fillCircle(-9, -10, 3);
    g.fillStyle(0x15131a, 1).fillRect(-10, -11, 1, 1).fillRect(-8, -11, 1, 1);
    g.fillStyle(0x4a4658, 1).fillRect(-2, -13, 14, 1).fillRect(-2, -10, 12, 1);
    solid(x, y - 6, 32, 14);
    return c;
  };
  P.cryptPillar = (x, y) => {
    const c = cont(x, y, 1.3);
    const g = gfx(c);
    g.fillStyle(0x2f2c38, 1).fillRect(-6, -26, 12, 28);
    g.fillStyle(0x4a4658, 1).fillRect(-5, -26, 4, 28);
    g.fillStyle(0x5d5a66, 1).fillRect(-8, -30, 16, 5).fillRect(-8, -3, 16, 4);
    g.fillStyle(0x1e1c24, 1).fillRect(2, -25, 2, 26);
    solid(x, y - 12, 12, 24);
    return c;
  };
  P.bones = (x, y, v = 0) => {
    const c = cont(x, y);
    const g = gfx(c);
    g.fillStyle(0xd5cfc1, 1).fillRect(-5, 0, 7, 1).fillRect(-2, -2, 1, 5);
    g.fillCircle(4 + (v % 2), -1, 2);
    g.fillStyle(0x15131a, 1).fillRect(3, -2, 1, 1).fillRect(5, -2, 1, 1);
    c.setDepth(2);
    return c;
  };
  P.chest = (x, y, opened = false) => {
    const c = cont(x, y, 1.2);
    const g = gfx(c);
    g.fillStyle(0x6d4211, 1).fillRect(-8, -9, 16, 10);
    g.fillStyle(opened ? 0x2b1808 : 0x8d5a1c, 1).fillRect(-8, -13, 16, opened ? 3 : 5);
    g.fillStyle(0xf4c542, 1).fillRect(-8, -9, 16, 2).fillRect(-1, -11, 3, 5);
    if (opened) g.fillStyle(0xf7dc6f, 1).fillRect(-6, -10, 12, 2);
    solid(x, y - 4, 16, 8);
    c.setData('g', g);
    return c;
  };
  P.stairs = (x, y) => {
    const c = cont(x, y);
    const g = gfx(c);
    for (let i = 0; i < 5; i++) g.fillStyle(0x3a3645 + i * 0x0a0a0a, 1).fillRect(-22 + i * 2, i * 5 - 16, 44 - i * 4, 5);
    g.fillStyle(0x0d0c11, 1).fillRect(-16, -18, 32, 3);
    c.setDepth(1);
    return c;
  };

  // ——— Interiors ———
  P.table = (x, y, w = 24) => {
    const c = cont(x, y, w / 14);
    const g = gfx(c);
    g.fillStyle(0x5e3a1a, 1).fillRect(-w / 2 + 1, -2, 3, 5).fillRect(w / 2 - 4, -2, 3, 5);
    g.fillStyle(0x8d5524, 1).fillRect(-w / 2, -10, w, 9);
    g.fillStyle(0xb57b3c, 1).fillRect(-w / 2, -10, w, 4);
    g.fillStyle(0x3d2712, 1).fillRect(-w / 2, -1, w, 1);
    solid(x, y - 5, w, 10);
    return c;
  };
  P.mug = (x, y) => {
    const g = scene.add.graphics().setDepth(y + 2);
    g.fillStyle(0xf0ede4, 1).fillRect(x - 2, y - 3, 4, 4);
    g.fillStyle(0xd4a017, 1).fillRect(x - 1, y - 2, 2, 2);
    g.fillStyle(0xf0ede4, 1).fillRect(x + 2, y - 2, 1, 2);
    return g;
  };
  P.chair = (x, y, dir = 'down') => {
    const c = cont(x, y, 0.8);
    const g = gfx(c);
    g.fillStyle(0x6b4426, 1).fillRect(-4, -5, 8, 6);
    g.fillStyle(0x8d5524, 1).fillRect(-4, -5, 8, 3);
    if (dir === 'down') g.fillStyle(0x553619, 1).fillRect(-4, -11, 8, 3);
    if (dir === 'up') g.fillStyle(0x553619, 1).fillRect(-4, -2, 8, 3);
    return c;
  };
  P.counter = (x, y, w) => {
    const c = cont(x, y, 0);
    const g = gfx(c);
    g.fillStyle(0x553619, 1).fillRect(-w / 2, -6, w, 12);
    g.fillStyle(0xb57b3c, 1).fillRect(-w / 2 - 1, -10, w + 2, 6);
    g.fillStyle(0xd09a55, 1).fillRect(-w / 2 - 1, -10, w + 2, 2);
    g.fillStyle(0x3d2712, 1);
    for (let i = -w / 2 + 4; i < w / 2 - 2; i += 12) g.fillRect(i, -3, 8, 7);
    solid(x, y - 2, w + 2, 12);
    return c;
  };
  P.barrel = (x, y) => {
    const c = cont(x, y, 1);
    const g = gfx(c);
    g.fillStyle(0x6b4426, 1).fillRoundedRect(-5, -12, 10, 13, 3);
    g.fillStyle(0x8d5524, 1).fillRect(-4, -11, 3, 11);
    g.fillStyle(0x2c2c2c, 1).fillRect(-5, -9, 10, 1).fillRect(-5, -3, 10, 1);
    solid(x, y - 4, 10, 8);
    return c;
  };
  P.crate = (x, y, v = 0) => {
    const c = cont(x, y, 1.1);
    const g = gfx(c);
    g.fillStyle(0x7d5228, 1).fillRect(-6, -12, 12, 13);
    g.fillStyle(0xa0703c, 1).fillRect(-5, -11, 10, 11);
    g.fillStyle(0x553619, 1).fillRect(-6, -12, 12, 1).fillRect(-6, 0, 12, 1).fillRect(-1, -11, 2, 11);
    if (v % 2) g.fillStyle(0xc0392b, 1).fillCircle(-2, -13, 2).fillStyle(0xe67e22, 1).fillCircle(2, -13, 2);
    solid(x, y - 5, 12, 10);
    return c;
  };
  P.sack = (x, y) => {
    const c = cont(x, y, 1);
    const g = gfx(c);
    g.fillStyle(0xc9b47a, 1).fillEllipse(0, -5, 12, 11);
    g.fillStyle(0xa8945a, 1).fillRect(-2, -12, 4, 3);
    g.fillStyle(0x6d3f10, 1).fillRect(-3, -10, 6, 1);
    solid(x, y - 3, 10, 7);
    return c;
  };
  P.bed = (x, y, color = 0xc0392b) => {
    const c = cont(x, y, 1.6);
    const g = gfx(c);
    g.fillStyle(0x553619, 1).fillRect(-9, -26, 18, 28);
    g.fillStyle(0x7a5030, 1).fillRect(-9, -30, 18, 6);
    g.fillStyle(0xf0ede4, 1).fillRect(-8, -24, 16, 7);
    g.fillStyle(color, 1).fillRect(-8, -17, 16, 16);
    g.fillStyle(0x000000, 0.22).fillRect(-8, -5, 16, 3);
    g.fillStyle(0xe8e4d8, 1).fillRect(-6, -23, 12, 4);
    solid(x, y - 14, 18, 28);
    return c;
  };
  P.rug = (x, y, w, h, c1 = 0x8e2b2b, c2 = 0xd9b64a) => {
    const g = scene.add.graphics().setDepth(2);
    g.fillStyle(c2, 1).fillRect(x - w / 2, y - h / 2, w, h);
    g.fillStyle(c1, 1).fillRect(x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4);
    g.fillStyle(c2, 1).fillRect(x - w / 2 + 6, y - h / 2 + 6, w - 12, h - 12);
    g.fillStyle(c1, 1).fillRect(x - w / 2 + 8, y - h / 2 + 8, w - 16, h - 16);
    return g;
  };
  P.fireplace = (x, y) => {
    const c = cont(x, y, 0);
    const g = gfx(c);
    g.fillStyle(0x6f747c, 1).fillRect(-18, -34, 36, 34);
    g.fillStyle(0x8c9199, 1).fillRect(-18, -34, 36, 4).fillRect(-20, -38, 40, 5);
    g.fillStyle(0x4d5158, 1).fillRect(-18, -29, 3, 29).fillRect(15, -29, 3, 29);
    g.fillStyle(0x15100c, 1).fillRect(-12, -24, 24, 24);
    g.fillStyle(0x3d2712, 1).fillRect(-9, -3, 18, 3);
    flame(c, -4, -9, 5);
    flame(c, 4, -8, 4, 0xf39c12);
    c.setDepth(y - 1);
    glow(x, y - 8, 2.2, 0.45, 0xffa040, 2400);
    solid(x, y - 10, 36, 20);
    return c;
  };
  P.shelf = (x, y, w = 24, books = true) => {
    const c = cont(x, y, 0);
    const g = gfx(c);
    g.fillStyle(0x553619, 1).fillRect(-w / 2, -32, w, 32);
    g.fillStyle(0x3d2712, 1).fillRect(-w / 2 + 2, -30, w - 4, 28);
    for (let r = 0; r < 3; r++) {
      const ry = -29 + r * 9;
      g.fillStyle(0x7a5030, 1).fillRect(-w / 2 + 2, ry + 7, w - 4, 2);
      for (let i = 0; i < (w - 6) / 3; i++) {
        const col = books ? [0xc0392b, 0x2e86c1, 0x27ae60, 0xd4a017, 0x8e44ad][(i + r * 2) % 5] : [0x5da24a, 0xe67e22, 0x2e86c1][(i + r) % 3];
        if (books) g.fillStyle(col, 1).fillRect(-w / 2 + 3 + i * 3, ry + (i % 3 === 0 ? 1 : 2), 2, 6 - (i % 3 === 0 ? 1 : 0));
        else if (i % 2 === 0) g.fillStyle(col, 1).fillRect(-w / 2 + 3 + i * 3, ry + 2, 3, 5).fillRect(-w / 2 + 4 + i * 3, ry, 1, 2);
      }
    }
    solid(x, y - 10, w, 20);
    return c;
  };
  P.window = (x, y) => {
    const c = cont(x, y, 0);
    const g = gfx(c);
    g.fillStyle(0x3d2712, 1).fillRect(-9, -14, 18, 16);
    g.fillStyle(0x9fd6f5, 1).fillRect(-7, -12, 14, 12);
    g.fillStyle(0xd6f0ff, 1).fillRect(-7, -12, 6, 5);
    g.fillStyle(0x3d2712, 1).fillRect(-1, -12, 2, 12).fillRect(-7, -7, 14, 2);
    g.fillStyle(0x8d5524, 1).fillRect(-10, 2, 20, 2);
    c.setDepth(1);
    return c;
  };
  P.banner = (x, y, color = 0xc0392b) => {
    const c = cont(x, y, 0);
    const g = gfx(c);
    g.fillStyle(0x3d2712, 1).fillRect(-7, -22, 14, 2);
    g.fillStyle(color, 1).fillRect(-6, -20, 12, 16).fillTriangle(-6, -4, 6, -4, 0, 2);
    g.fillStyle(0xf4c542, 1).fillRect(-1, -16, 2, 7).fillRect(-3, -13, 6, 2);
    c.setDepth(1);
    return c;
  };
  P.cauldron = (x, y) => {
    const c = cont(x, y, 1.3);
    const g = gfx(c);
    g.fillStyle(0x2c2c2c, 1).fillRoundedRect(-8, -12, 16, 13, 5);
    g.fillStyle(0x4a7a3a, 1).fillEllipse(0, -11, 13, 4);
    g.fillStyle(0x7fbf5a, 1).fillCircle(-2, -11, 1).fillCircle(3, -12, 1);
    g.fillStyle(0x3d2712, 1).fillRect(-7, 0, 3, 3).fillRect(4, 0, 3, 3);
    solid(x, y - 5, 16, 10);
    return c;
  };
  P.plant = (x, y) => {
    const c = cont(x, y, 0.8);
    const g = gfx(c);
    g.fillStyle(0xa0522d, 1).fillRect(-3, -5, 6, 5);
    g.fillStyle(0x2f8f3a, 1).fillCircle(0, -8, 4).fillCircle(-3, -6, 3).fillCircle(3, -6, 3);
    solid(x, y - 2, 6, 6);
    return c;
  };
  P.cat = (x, y) => {
    const c = cont(x, y, 0.8);
    const g = gfx(c);
    g.fillStyle(0xd98a3d, 1).fillEllipse(0, -3, 11, 6).fillCircle(5, -5, 3);
    g.fillTriangle(3, -8, 4, -5, 6, -8);
    g.fillStyle(0xf0c890, 1).fillRect(-5, -3, 3, 1);
    g.fillStyle(0xd98a3d, 1).fillRect(-7, -5, 3, 1);
    const z = scene.add.text(6, -14, 'z', { fontFamily: '"Silkscreen", monospace', fontSize: '7px', color: '#fff' }).setOrigin(0.5);
    c.add(z);
    scene.tweens.add({ targets: z, y: -20, alpha: 0, duration: 1600, repeat: -1 });
    return c;
  };

  // ——— Shared landmarks ———
  P.waystone = (x, y) => {
    const c = cont(x, y, 1.6);
    const g = gfx(c);
    g.fillStyle(0x4a5560, 1).fillRect(-9, -4, 18, 6);
    g.fillStyle(0x6b7a88, 1).fillRect(-7, -26, 14, 24);
    g.fillStyle(0x8da0b0, 1).fillRect(-7, -26, 5, 24);
    g.fillStyle(0x3c4650, 1).fillTriangle(-7, -26, 7, -26, 0, -32);
    g.fillStyle(0x5ad1ff, 1).fillRect(-1, -20, 2, 8).fillRect(-3, -17, 6, 2);
    const crystal = scene.add.graphics();
    crystal.fillStyle(0x9fe8ff, 1).fillTriangle(0, -44, -4, -38, 4, -38).fillTriangle(0, -32, -4, -38, 4, -38);
    c.add(crystal);
    scene.tweens.add({ targets: crystal, y: -3, duration: 1100, yoyo: true, repeat: -1, ease: 'sine.inout' });
    glow(x, y - 20, 1.2, 0.55, 0x66ddff);
    solid(x, y - 2, 16, 8);
    return c;
  };
  P.archway = (x, y, color = 0x5ad1ff, stone = 0x7d8791) => {
    const c = cont(x, y, 0);
    const g = gfx(c);
    g.fillStyle(0x000000, 0.22).fillEllipse(0, 2, 44, 8);
    g.fillStyle(stone, 1).fillRect(-18, -34, 7, 36).fillRect(11, -34, 7, 36);
    g.fillStyle(0xa2adb8, 1).fillRect(-18, -34, 3, 36).fillRect(11, -34, 3, 36);
    g.fillStyle(0x5d6772, 1).fillRect(-21, -40, 42, 8);
    g.fillStyle(0x8792a0, 1).fillRect(-21, -40, 42, 3);
    const inner = scene.add.ellipse(0, -16, 22, 34, color, 0.42);
    const core = scene.add.ellipse(0, -16, 12, 22, 0xffffff, 0.5);
    c.add([inner, core]);
    scene.tweens.add({ targets: [inner, core], alpha: { from: 0.25, to: 0.6 }, scaleX: 1.12, duration: 900, yoyo: true, repeat: -1, ease: 'sine.inout' });
    glow(x, y - 16, 1.6, 0.55, color);
    solid(x - 14, y - 10, 8, 16);
    solid(x + 14, y - 10, 8, 16);
    return c;
  };
  P.signpost = (x, y, planks) => {
    const c = cont(x, y, 1);
    const g = gfx(c);
    g.fillStyle(0x5a3a1e, 1).fillRect(-2, -34, 4, 36);
    g.fillStyle(0x3d2712, 1).fillRect(1, -34, 1, 36);
    planks.forEach((p, i) => {
      const py = -30 + i * 11;
      const right = p.dir === 'e' || p.dir === 's';
      const dirSign = right ? 1 : -1;
      g.fillStyle(0xc99a5a, 1).fillRect(right ? -2 : -22, py, 24, 8);
      g.fillTriangle(right ? 22 : -22, py, right ? 22 : -22, py + 8, right ? 28 : -28, py + 4);
      g.fillStyle(0x8d5a2b, 1).fillRect(right ? -2 : -22, py + 6, 24, 2);
      g.fillStyle(0x3d2712, 1);
      for (let k = 0; k < 4; k++) g.fillRect((right ? 2 : -18) + k * 5 * 1, py + 3, 3, 1);
      if (p.dir === 'n') g.fillStyle(0x3d2712, 1).fillTriangle(-6, py - 1, -10, py + 4, -2, py + 4);
      if (p.dir === 's') g.fillStyle(0x3d2712, 1).fillTriangle(-6, py + 10, -10, py + 5, -2, py + 5);
      void dirSign;
    });
    solid(x, y - 2, 6, 6);
    return c;
  };
  P.doorMat = (x, y) => {
    const g = scene.add.graphics().setDepth(2);
    g.fillStyle(0x6d3f10, 1).fillRect(x - 8, y - 3, 16, 7);
    g.fillStyle(0x9d6a38, 1).fillRect(x - 7, y - 2, 14, 5);
    return g;
  };
  P.flame = flame;
  P.glow = glow;
  return P;
}
