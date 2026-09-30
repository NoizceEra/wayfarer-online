// Procedural world props: buildings, town furniture, fences, trees, logs and
// broken walls. All drawn with Phaser Graphics inside y-sorted containers
// whose base sits at (x, y); solids are sized to match what is drawn.

const shade = (c, f) => {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
};

function box(scene, x, y, w, h) {
  const r = scene.add.rectangle(x, y, w, h, 0xffffff, 0);
  return r;
}

export function makeProps(scene, solids, ground) {
  const newC = (x, y, depth) => { const c = scene.add.container(x, y).setDepth(depth ?? y); const g = scene.add.graphics(); c.add(g); return [c, g]; };
  const solid = (x, y, w, h) => solids.add(box(scene, x, y, w, h));

  // ---- cottage: w 34..62, roof/wall colours vary ----
  function house(x, y, o) {
    const { w = 44, h = 24, roof = 0xb03a2e, wall = 0xd9c08a, chimney = true, door = 0x5a3a1e } = o;
    const rh = 12 + Math.round(w / 6);
    const [c, g] = newC(x, y);
    ground.D.shadow(x + 8, y + 1, w + 22, 12, 0.22);
    const hw = w / 2;
    // walls
    g.fillStyle(wall, 1).fillRect(-hw, -h, w, h);
    g.fillStyle(shade(wall, 0.82), 1).fillRect(-hw, -4, w, 4); // stone footing
    g.fillStyle(shade(wall, 0.9), 1).fillRect(-hw, -h, 3, h).fillRect(hw - 3, -h, 3, h);
    g.fillStyle(0x7a4a24, 1).fillRect(-hw, -h, w, 2).fillRect(-hw, -h / 2, w, 1);
    // chimney behind roof
    if (chimney) { g.fillStyle(0x7f8c8d, 1).fillRect(hw - 14, -h - rh - 6, 7, 14); g.fillStyle(0x566061, 1).fillRect(hw - 15, -h - rh - 7, 9, 3); }
    // roof (trapezoid with shingle rows, eave shadow)
    g.fillStyle(roof, 1).fillPoints([{ x: -hw - 5, y: -h + 3 }, { x: hw + 5, y: -h + 3 }, { x: hw - 7, y: -h - rh }, { x: -hw + 7, y: -h - rh }], true);
    g.fillStyle(shade(roof, 0.8), 1);
    for (let i = 1; i < 4; i++) { const yy = -h + 3 - (i * (rh + 3)) / 4; g.fillRect(-hw - 5 + i * 2.2, yy, w + 10 - i * 4.4, 1); }
    g.fillStyle(shade(roof, 1.25), 1).fillRect(-hw + 7, -h - rh, w - 14, 2);
    g.fillStyle(shade(roof, 0.6), 1).fillRect(-hw - 5, -h + 1, w + 10, 3);
    // door + windows
    g.fillStyle(door, 1).fillRect(-4, -14, 8, 14);
    g.fillStyle(0xd9b25c, 1).fillRect(2, -7, 1, 1);
    const win = scene.add.rectangle(hw - 10, -h + 9, 6, 6, 0xf7dc6f, 1);
    g.fillStyle(0x4a2f18, 1).fillRect(-hw + 4, -h + 5, 10, 10).fillRect(hw - 15, -h + 5, 10, 10);
    g.fillStyle(0x9fd0e8, 1).fillRect(-hw + 5, -h + 6, 8, 8).fillRect(hw - 14, -h + 6, 8, 8);
    g.fillStyle(0x4a2f18, 1).fillRect(-hw + 8, -h + 6, 1, 8).fillRect(hw - 11, -h + 6, 1, 8);
    c.add(win); win.setAlpha(0.0); win.setData('chim', !!chimney); // fx: chimney smoke + window lights
    solid(x, y - (h + 6) / 2, w, h + 6);
    return win;
  }

  // ---- the inn: big two-storey landmark with porch, sign and lanterns ----
  function inn(x, y) {
    const w = 104, h = 38, hw = w / 2, rh = 30;
    const [c, g] = newC(x, y);
    ground.D.shadow(x + 10, y + 1, w + 30, 16, 0.25);
    const wall = 0xe4d2a8, roof = 0x7b2d26;
    // wing (left, lower)
    g.fillStyle(0xd9c08a, 1).fillRect(-hw - 16, -24, 20, 24);
    g.fillStyle(0x5e2622, 1).fillPoints([{ x: -hw - 20, y: -21 }, { x: -hw + 6, y: -21 }, { x: -hw + 2, y: -38 }, { x: -hw - 16, y: -38 }], true);
    g.fillStyle(0x3a2516, 1).fillRect(-hw - 12, -13, 7, 7);
    g.fillStyle(0xf7dc6f, 0.9).fillRect(-hw - 11, -12, 5, 5);
    // main walls with timber frame
    g.fillStyle(wall, 1).fillRect(-hw, -h, w, h);
    g.fillStyle(0x7a4a24, 1);
    for (let i = 0; i <= 6; i++) g.fillRect(-hw + i * (w - 3) / 6, -h, 3, h);
    g.fillRect(-hw, -h, w, 3).fillRect(-hw, -h / 2 - 2, w, 3);
    g.fillStyle(0x8a8f92, 1).fillRect(-hw, -5, w, 5);
    // chimneys
    g.fillStyle(0x7f8c8d, 1).fillRect(hw - 22, -h - rh - 8, 9, 18).fillRect(-hw + 14, -h - rh - 4, 9, 16);
    g.fillStyle(0x566061, 1).fillRect(hw - 23, -h - rh - 9, 11, 3).fillRect(-hw + 13, -h - rh - 5, 11, 3);
    // roof with gabled dormer
    g.fillStyle(roof, 1).fillPoints([{ x: -hw - 7, y: -h + 4 }, { x: hw + 7, y: -h + 4 }, { x: hw - 9, y: -h - rh }, { x: -hw + 9, y: -h - rh }], true);
    g.fillStyle(shade(roof, 0.8), 1);
    for (let i = 1; i < 6; i++) g.fillRect(-hw - 7 + i * 1.6, -h + 4 - (i * (rh + 4)) / 6, w + 14 - i * 3.2, 1);
    g.fillStyle(shade(roof, 1.3), 1).fillRect(-hw + 9, -h - rh, w - 18, 2);
    g.fillStyle(shade(roof, 0.55), 1).fillRect(-hw - 7, -h + 2, w + 14, 3);
    // dormer
    g.fillStyle(wall, 1).fillRect(-9, -h - 16, 18, 14);
    g.fillStyle(shade(roof, 0.9), 1).fillPoints([{ x: -12, y: -h - 15 }, { x: 12, y: -h - 15 }, { x: 0, y: -h - 27 }], true);
    g.fillStyle(0xf7dc6f, 1).fillRect(-4, -h - 13, 8, 9);
    g.fillStyle(0x4a2f18, 1).fillRect(-0.5, -h - 13, 1, 9);
    // upper windows
    for (const wx of [-hw + 10, -hw + 30, hw - 40, hw - 20]) {
      g.fillStyle(0x4a2f18, 1).fillRect(wx, -h + 8, 12, 11);
      g.fillStyle(0x9fd0e8, 1).fillRect(wx + 1, -h + 9, 10, 9);
      g.fillStyle(0x4a2f18, 1).fillRect(wx + 5.5, -h + 9, 1, 9);
    }
    // porch awning + double door
    g.fillStyle(0x4a2f18, 1).fillRect(-14, -17, 28, 17);
    g.fillStyle(0x6b4423, 1).fillRect(-13, -16, 12, 16).fillRect(1, -16, 12, 16);
    g.fillStyle(0xd9b25c, 1).fillRect(-3, -8, 2, 2).fillRect(1, -8, 2, 2);
    g.fillStyle(0xb03a2e, 1).fillRect(-22, -22, 44, 4);
    for (let i = 0; i < 6; i++) { g.fillStyle(i % 2 ? 0xf4ecd8 : 0xb03a2e, 1).fillRect(-22 + i * 7.33, -18, 7.33, 4); }
    g.fillStyle(0x3a2516, 1).fillRect(-22, -24, 2, 24).fillRect(20, -24, 2, 24);
    // lit windows low
    g.fillStyle(0x4a2f18, 1).fillRect(-hw + 8, -22, 14, 13).fillRect(hw - 22, -22, 14, 13);
    g.fillStyle(0xf7dc6f, 1).fillRect(-hw + 9, -21, 12, 11).fillRect(hw - 21, -21, 12, 11);
    g.fillStyle(0xd9a13a, 1).fillRect(-hw + 14, -21, 1, 11).fillRect(hw - 16, -21, 1, 11);
    // hanging sign
    g.fillStyle(0x3a2516, 1).fillRect(hw - 4, -34, 14, 2).fillRect(hw + 8, -34, 2, 3);
    g.fillStyle(0x7a4a24, 1).fillRect(hw + 2, -31, 12, 10);
    g.fillStyle(0xf4c542, 1).fillRect(hw + 5, -28, 6, 4).fillRect(hw + 7, -25, 2, 2);
    // barrels + flower box
    for (const [bx, by] of [[hw + 10, 0], [hw + 20, 1]]) {
      g.fillStyle(0x8a5a2b, 1).fillRect(bx - 5, by - 11, 10, 11);
      g.fillStyle(0x4a3018, 1).fillRect(bx - 5, by - 8, 10, 1).fillRect(bx - 5, by - 3, 10, 1);
      g.fillStyle(0xa8743a, 1).fillRect(bx - 4, by - 11, 3, 11);
    }
    g.fillStyle(0x7a4a24, 1).fillRect(-hw + 8, -9, 14, 4);
    for (let i = 0; i < 5; i++) g.fillStyle([0xec7063, 0xf4d03f, 0xfdfefe][i % 3], 1).fillRect(-hw + 9 + i * 3, -11, 2, 2);
    // lanterns
    if (scene.textures.exists('fx.glow')) {
      for (const lx of [-22, 22]) {
        g.fillStyle(0xf7dc6f, 1).fillRect(lx - 1, -14, 3, 4);
        const gl = scene.add.image(lx, -12, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35).setScale(0.6);
        c.add(gl);
        scene.tweens.add({ targets: gl, alpha: 0.2, duration: 800, yoyo: true, repeat: -1, ease: 'sine.inout' });
      }
    }
    const win = scene.add.rectangle(-hw + 15, -16, 6, 5, 0xf7dc6f, 0);
    c.add(win); win.setData('inn', true); // fx: inn chimneys/steam + window lights
    solid(x + 2, y - (h + 6) / 2, w + 4, h + 6);
    solid(x - hw - 6, y - 12, 22, 24);
    return win;
  }

  // ---- market stall with striped canopy ----
  function stall(x, y, cols = [0xc0392b, 0xf4ecd8], goods = 0xe74c3c, w = 30) {
    const [c, g] = newC(x, y);
    ground.D.shadow(x + 3, y + 1, w + 8, 9, 0.2);
    g.fillStyle(0x5a3a1e, 1).fillRect(-w / 2, -24, 2, 24).fillRect(w / 2 - 2, -24, 2, 24);
    g.fillStyle(0x8a5a2b, 1).fillRect(-w / 2 + 1, -10, w - 2, 10);
    g.fillStyle(0xa8743a, 1).fillRect(-w / 2 + 1, -10, w - 2, 2);
    g.fillStyle(0x6b4423, 1).fillRect(-w / 2 + 1, -5, w - 2, 1);
    // goods
    for (let i = 0; i < 5; i++) { g.fillStyle(i % 2 ? goods : shade(goods, 1.2), 1).fillRect(-w / 2 + 3 + i * 5, -14 - (i % 2), 4, 4); }
    g.fillStyle(0x3a2516, 1).fillRect(-w / 2 + 2, -13, w - 4, 1);
    // canopy
    const n = 6, sw = (w + 8) / n;
    for (let i = 0; i < n; i++) { g.fillStyle(cols[i % 2], 1).fillRect(-w / 2 - 4 + i * sw, -34, sw, 11); g.fillStyle(cols[i % 2], 1).fillTriangle(-w / 2 - 4 + i * sw, -23, -w / 2 - 4 + (i + 1) * sw, -23, -w / 2 - 4 + (i + 0.5) * sw, -19); }
    g.fillStyle(0x000000, 0.18).fillRect(-w / 2 - 4, -24, w + 8, 1);
    solid(x, y - 5, w, 10);
  }

  function well(x, y) {
    const [c, g] = newC(x, y);
    ground.D.shadow(x + 3, y, 30, 10, 0.22);
    g.fillStyle(0x6d7a80, 1).fillEllipse(0, -6, 26, 14);
    g.fillStyle(0x1f3a52, 1).fillEllipse(0, -8, 16, 8);
    g.fillStyle(0x3d6d9a, 1).fillEllipse(-1, -8, 10, 4);
    g.fillStyle(0x929fa5, 1).fillRect(-13, -7, 26, 7);
    g.fillStyle(0x6d7a80, 1);
    for (let i = 0; i < 5; i++) g.fillRect(-12 + i * 5, -6 + (i % 2) * 3, 4, 2);
    g.fillStyle(0x5a3a1e, 1).fillRect(-11, -28, 2, 22).fillRect(9, -28, 2, 22).fillRect(-11, -28, 22, 2);
    g.fillStyle(0x8a3a2a, 1).fillTriangle(-15, -27, 15, -27, 0, -38);
    g.fillStyle(0xd9c08a, 1).fillRect(-1, -26, 2, 10);
    g.fillStyle(0x7a4a24, 1).fillRect(-3, -17, 6, 5);
    solid(x, y - 5, 24, 10);
  }

  function board(x, y) {
    const [c, g] = newC(x, y);
    ground.D.shadow(x + 3, y, 26, 7, 0.2);
    g.fillStyle(0x4a2f18, 1).fillRect(-11, -24, 3, 24).fillRect(8, -24, 3, 24);
    g.fillStyle(0x8a5a2b, 1).fillRect(-14, -30, 28, 18);
    g.fillStyle(0x6b4423, 1).fillRect(-14, -30, 28, 2).fillRect(-14, -14, 28, 2);
    g.fillStyle(0xf4ecd8, 1).fillRect(-11, -26, 8, 10).fillRect(0, -27, 9, 7).fillRect(2, -19, 8, 5);
    g.fillStyle(0xd9c08a, 1).fillRect(-10, -25, 6, 1).fillRect(1, -26, 7, 1);
    g.fillStyle(0xc0392b, 1).fillRect(-8, -27, 2, 2).fillRect(5, -28, 2, 2);
    g.fillStyle(0x5a3a1e, 1).fillTriangle(-17, -30, 17, -30, 0, -37);
    solid(x, y - 5, 26, 8);
  }

  // Fence run between two points (horizontal or vertical), with rails + posts.
  function fence(x1, y1, x2, y2, o = {}) {
    const horiz = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    const len = horiz ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    const x0 = Math.min(x1, x2), yy0 = Math.min(y1, y2);
    const [c, g] = newC(0, 0, Math.max(y1, y2));
    const wood = o.wood ?? 0x8a5a2b, dark = shade(wood, 0.6);
    const n = Math.max(1, Math.round(len / 12));
    if (horiz) {
      ground.D.shadow(x0 + len / 2 + 2, y1 + 1, len, 4, 0.16);
      g.fillStyle(dark, 1).fillRect(x0, y1 - 9, len, 2).fillRect(x0, y1 - 5, len, 2);
      g.fillStyle(wood, 1).fillRect(x0, y1 - 9, len, 1).fillRect(x0, y1 - 5, len, 1);
      for (let i = 0; i <= n; i++) { const px = x0 + (i * len) / n; g.fillStyle(dark, 1).fillRect(px - 1, y1 - 12, 3, 13); g.fillStyle(wood, 1).fillRect(px - 1, y1 - 12, 2, 12); }
      solid(x0 + len / 2, y1 - 2, len, 5);
    } else {
      ground.D.shadow(x1 + 2, yy0 + len / 2 + 1, 4, len, 0.16);
      g.fillStyle(dark, 1).fillRect(x1 - 1, yy0 - 6, 2, len + 6);
      g.fillStyle(wood, 1).fillRect(x1 - 1, yy0 - 6, 1, len + 6);
      for (let i = 0; i <= n; i++) { const py = yy0 + (i * len) / n; g.fillStyle(dark, 1).fillRect(x1 - 2, py - 12, 4, 13); g.fillStyle(wood, 1).fillRect(x1 - 2, py - 12, 3, 12); g.fillStyle(shade(wood, 1.3), 1).fillRect(x1 - 2, py - 12, 3, 1); }
      solid(x1, yy0 + len / 2 - 2, 5, len + 4);
    }
  }

  function log(x, y, len = 30, flip = false) {
    const [c, g] = newC(x, y);
    ground.D.shadow(x + 2, y + 1, len + 4, 9, 0.22);
    g.fillStyle(0x4a2f18, 1).fillRoundedRect(-len / 2, -9, len, 10, 4);
    g.fillStyle(0x6b4423, 1).fillRoundedRect(-len / 2, -9, len, 6, 3);
    g.fillStyle(0x8a5a2b, 1).fillRect(-len / 2 + 4, -8, len - 10, 1);
    g.fillStyle(0xd9b07a, 1).fillEllipse(flip ? len / 2 - 2 : -len / 2 + 2, -4, 5, 9);
    g.fillStyle(0xa8743a, 1).fillEllipse(flip ? len / 2 - 2 : -len / 2 + 2, -4, 2.5, 5);
    g.fillStyle(0x4f9a45, 1).fillRect(-len / 6, -10, len / 3, 2).fillRect(len / 5, -9, 5, 2);
    solid(x, y - 4, len, 8);
  }

  // Broken ruin wall: row of stone blocks with gaps, mossy cap; optional L-return.
  function ruinWall(x, y, len, v) {
    const [c, g] = newC(x, y);
    ground.D.shadow(x + len / 2 + 3, y + 1, len + 6, 8, 0.25);
    let cx = 0;
    const blocks = [];
    while (cx < len) {
      const bw = 8 + ((cx * 7 + v) % 5) * 2;
      const hgt = 5 + ((cx * 13 + v * 3) % 4) * 5;
      const gap = ((cx + v) % 23 === 0) && cx > 0 && cx < len - 12;
      if (!gap) blocks.push({ x: cx, w: Math.min(bw, len - cx), h: hgt });
      cx += bw + (gap ? 6 : 0);
    }
    for (const b of blocks) {
      g.fillStyle(0x6d7a82, 1).fillRect(b.x, -b.h, b.w, b.h);
      g.fillStyle(0x93a1a8, 1).fillRect(b.x, -b.h, b.w, 3);
      g.fillStyle(0x525f66, 1).fillRect(b.x, -3, b.w, 3);
      g.fillStyle(0x525f66, 1).fillRect(b.x + b.w - 1, -b.h, 1, b.h);
      for (let yy = 5; yy < b.h; yy += 5) g.fillStyle(0x525f66, 1).fillRect(b.x, -yy, b.w, 1);
      if ((b.x + v) % 3 === 0) g.fillStyle(0x4f9a45, 0.9).fillRect(b.x, -b.h - 1, b.w * 0.7, 2);
      if ((b.x + v) % 4 === 0) g.fillStyle(0x3a7a4a, 0.8).fillRect(b.x + 1, -6, 2, 6);
      solid(x + b.x + b.w / 2, y - b.h / 2 + 1, b.w, b.h);
    }
  }

  // ---- trees: oak / pine / birch / willow ----
  function tree(x, y, kind, big) {
    const [c, g] = newC(x, y);
    c.setData('tree', kind || 'oak'); // fx: wind sway + time-of-day shadow
    if (scene.textures.exists('char.shadow')) c.addAt(scene.add.image(0, 4, 'char.shadow').setScale(big ? 2.2 : 1.6, big ? 1.4 : 1.1).setAlpha(0.9), 0);
    else ground.D.shadow(x, y + 4, 24, 8, 0.2);
    const s = big ? 1.35 : 1;
    const R = (cx, cy, r, col) => g.fillStyle(col, 1).fillCircle(cx * s, cy * s, r * s);
    if (kind === 'pine') {
      g.fillStyle(0x4a2f18, 1).fillRect(-2 * s, -6 * s, 4 * s, 8 * s);
      const cols = [0x1a4f2c, 0x236338, 0x2f7d45];
      for (let i = 0; i < 3; i++) {
        const by = -4 * s - i * 9 * s, hw = (13 - i * 3) * s;
        g.fillStyle(cols[0], 1).fillTriangle(-hw, by, hw, by, 0, by - 14 * s);
        g.fillStyle(cols[1], 1).fillTriangle(-hw * 0.6, by, hw, by, 0, by - 14 * s);
        g.fillStyle(cols[2], 1).fillTriangle(-hw * 0.15, by - 3 * s, hw * 0.55, by - 1 * s, 0, by - 14 * s);
      }
    } else if (kind === 'birch') {
      g.fillStyle(0xe8e4d8, 1).fillRect(-2 * s, -18 * s, 4 * s, 20 * s);
      g.fillStyle(0x3a3a3a, 1).fillRect(-2 * s, -12 * s, 3 * s, 1).fillRect(-1 * s, -6 * s, 3 * s, 1).fillRect(-2 * s, -16 * s, 2 * s, 1);
      R(-4, -18, 6, 0x6cab4e); R(4, -19, 6, 0x88c264); R(0, -24, 6, 0xa4d878); R(-3, -22, 3, 0xb8e48c);
    } else if (kind === 'willow') {
      g.fillStyle(0x4a3a24, 1).fillRect(-3 * s, -14 * s, 6 * s, 16 * s);
      R(0, -20, 10, 0x4b8a52); R(-6, -15, 6, 0x3f7a48); R(6, -15, 6, 0x3f7a48); R(0, -25, 6, 0x6fae70);
      for (let i = -3; i <= 3; i++) g.fillStyle(i % 2 ? 0x3f7a48 : 0x5a9a5e, 1).fillRect((i * 3.4 - 1) * s, -16 * s, 2 * s, (8 + ((i * i) % 4) * 2) * s);
    } else if (scene.textures.exists('tree.a')) {
      const v = (Math.floor(x / 16) * 31 + Math.floor(y / 16) * 17) & 255;
      const key = big ? 'tree.big' : ['tree.a', 'tree.b', 'tree.c'][v % 3];
      c.add(scene.add.image(0, 3, key).setOrigin(0.5, 1).setFlipX(((v >> 3) & 1) === 1));
    } else {
      const leaf = big ? 0x2d6a33 : 0x3e8e41, hi = big ? 0x3e8e41 : 0x5cc46a, lo = 0x1e5b26;
      g.fillStyle(0x5a3a1e, 1).fillRect(-2 * s, -8 * s, 4 * s, 10 * s);
      R(-4, -8, 7, lo); R(4, -8, 7, leaf); R(-2, -11, 5, hi); R(3, -10, 4, leaf);
      if (big) R(0, -15, 5, hi);
    }
    solids.add(scene.add.rectangle(x, y - 2, 8, 8, 0xffffff, 0));
  }

  return { house, inn, stall, well, board, fence, log, ruinWall, tree, shade };
}
