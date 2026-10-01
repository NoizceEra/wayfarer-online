import Phaser from 'phaser';

// Procedural props for the expansion biomes, drawn with primitives into cached textures
// (one texture per variant) so hundreds of cacti / reeds / crystals cost one image each.
// Each placer returns the image (origin = feet, y-sorted). `solids` blocks movement.
export function makePropsBiome(scene, solids, lights) {
  const solid = (x, y, w, h) => { if (solids) solids.add(scene.add.rectangle(x, y, w, h, 0xffffff, 0)); };
  const tex = (key, w, h, draw) => {
    if (!scene.textures.exists(key)) {
      const g = scene.make.graphics({ x: 0, y: 0, add: false });
      draw(g, w, h);
      g.generateTexture(key, w, h);
      g.destroy();
    }
    return key;
  };
  const put = (key, x, y, ox = 0.5, oy = 1) => scene.add.image(x, y, key).setOrigin(ox, oy).setDepth(y);
  const shadow = (g, cx, cy, w, h = 5, a = 0.22) => g.fillStyle(0x000000, a).fillEllipse(cx, cy, w, h);
  const glow = (x, y, scale, alpha, tint, radius = 0, depth = 2550) => {
    if (!scene.textures.exists('fx.glow')) return null;
    const g = scene.add.image(x, y, 'fx.glow').setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha).setScale(scale).setTint(tint);
    scene.tweens.add({ targets: g, alpha: alpha * 0.6, duration: 650 + ((x * 13 + y * 7) % 500), yoyo: true, repeat: -1, ease: 'sine.inout' });
    if (radius) lights?.push({ x, y, r: radius });
    return g;
  };
  const B = { glow, tex, put, solid };

  // ——————————————— Desert ———————————————
  B.cactus = (x, y, v = 0) => {
    v %= 3;
    const key = tex(`pb.cactus${v}`, 26, 36, (g) => {
      const body = 0x3f9a48, hi = 0x63c166, lo = 0x27653a;
      shadow(g, 13, 34, 20);
      if (v === 2) { // barrel cactus
        g.fillStyle(lo).fillEllipse(13, 26, 18, 14); g.fillStyle(body).fillEllipse(13, 25, 16, 12); g.fillStyle(hi).fillEllipse(10, 22, 5, 7);
        g.fillStyle(0xf06a9a).fillCircle(13, 18, 2.4); g.fillStyle(0xffe27a).fillCircle(13, 18, 1);
        for (let i = 0; i < 6; i++) g.fillStyle(0xf4ecc8).fillRect(6 + i * 3, 21 + (i % 2) * 4, 1, 1);
        return;
      }
      g.fillStyle(lo).fillRoundedRect(9, 5, 8, 29, 3);
      g.fillStyle(body).fillRoundedRect(9, 5, 6, 29, 3);
      g.fillStyle(hi).fillRect(10, 8, 1, 22);
      const arm = (side, yy, up) => {
        const x0 = side < 0 ? 2 : 17;
        g.fillStyle(lo).fillRoundedRect(x0, yy, 7, 4, 2); g.fillStyle(body).fillRoundedRect(x0, yy, 6, 3, 2);
        g.fillStyle(lo).fillRoundedRect(side < 0 ? 2 : 21, yy - up, 4, up + 4, 2); g.fillStyle(body).fillRoundedRect(side < 0 ? 2 : 21, yy - up, 3, up + 3, 2);
      };
      arm(-1, 18, 8); if (v === 0) arm(1, 12, 9); else arm(1, 20, 5);
      g.fillStyle(0xf06a9a).fillCircle(13, 5, 2); g.fillStyle(0xffe27a).fillCircle(13, 5, 0.8);
      for (let i = 0; i < 5; i++) g.fillStyle(0xf4ecc8).fillRect(9 + (i % 2) * 6, 10 + i * 4, 1, 1);
    });
    solid(x, y - 3, 8, 8);
    return put(key, x, y);
  };
  B.deadTree = (x, y, v = 0) => {
    const key = tex(`pb.deadtree${v % 2}`, 40, 48, (g) => {
      shadow(g, 20, 46, 24);
      g.fillStyle(0x5a4028).fillRect(18, 18, 5, 28); g.fillStyle(0x7a5a3a).fillRect(18, 18, 2, 28);
      g.lineStyle(3, 0x5a4028, 1);
      g.beginPath(); g.moveTo(20, 26); g.lineTo(8, 14); g.lineTo(5, 6); g.strokePath();
      g.beginPath(); g.moveTo(21, 22); g.lineTo(32, 10); g.lineTo(35, 4); g.strokePath();
      g.lineStyle(2, 0x5a4028, 1);
      g.beginPath(); g.moveTo(9, 16); g.lineTo(14, 8); g.strokePath();
      g.beginPath(); g.moveTo(31, 11); g.lineTo(26, 5); g.strokePath();
      if (v % 2) { g.beginPath(); g.moveTo(21, 32); g.lineTo(31, 28); g.strokePath(); }
    });
    solid(x, y - 2, 6, 6);
    return put(key, x, y);
  };
  B.sandRock = (x, y, v = 0) => {
    const w = 18 + (v % 3) * 6;
    const key = tex(`pb.srock${v % 3}`, w + 6, 22 + (v % 3) * 3, (g, W, H) => {
      shadow(g, W / 2, H - 3, w, 6, 0.26);
      g.fillStyle(0x9a6f40).fillEllipse(W / 2, H - 9, w, 14 + (v % 3) * 3);
      g.fillStyle(0xc8965c).fillEllipse(W / 2 - 1, H - 11, w - 4, 11 + (v % 3) * 3);
      g.fillStyle(0xe6bb80).fillEllipse(W / 2 - 3, H - 14, w / 2, 6);
      g.fillStyle(0x7a5530).fillRect(W / 2 + 2, H - 10, 4, 1).fillRect(W / 2 - 6, H - 7, 5, 1);
    });
    solid(x, y - 4, w * 0.7, 9);
    return put(key, x, y);
  };
  B.skull = (x, y, v = 0) => {
    const key = tex(`pb.skull${v % 2}`, 20, 14, (g) => {
      shadow(g, 10, 12, 14, 4);
      g.fillStyle(0xe8e0c8).fillEllipse(10, 8, 11, 8); g.fillStyle(0xfffdf0).fillEllipse(9, 6, 6, 4);
      g.fillStyle(0x2a2418).fillCircle(7, 8, 1.4).fillCircle(12, 8, 1.4);
      g.fillStyle(0xd8d0b0); g.fillTriangle(3, 6, 0, 2, 5, 4); g.fillTriangle(17, 6, 20, 2, 15, 4);
    });
    return put(key, x, y);
  };
  B.sandPillar = (x, y, v = 0) => {
    const h = 26 + (v % 3) * 8;
    const key = tex(`pb.spillar${v % 3}`, 24, h + 6, (g, W, H) => {
      shadow(g, W / 2, H - 3, 20, 6);
      g.fillStyle(0xa88858).fillRect(5, H - 8, 14, 6);
      g.fillStyle(0xd8c090).fillRect(7, 8 + (v % 3) * 2, 10, H - 14); g.fillStyle(0xeedab0).fillRect(7, 8 + (v % 3) * 2, 4, H - 14);
      g.fillStyle(0x9a7c4c).fillRect(7, H - 12, 10, 1).fillRect(7, H - 20, 10, 1);
      if (v % 3 === 2) { g.fillStyle(0xd8c090).fillRect(3, 4, 18, 5); g.fillStyle(0xeedab0).fillRect(3, 4, 18, 2); } else { g.fillStyle(0xd8c090).fillTriangle(7, 10, 17, 8, 12, 4); }
    });
    solid(x, y - 4, 12, 9);
    return put(key, x, y);
  };
  B.obelisk = (x, y) => {
    const key = tex('pb.obelisk', 26, 60, (g) => {
      shadow(g, 13, 57, 22, 6, 0.28);
      g.fillStyle(0x8a6c40).fillRect(3, 50, 20, 6);
      g.fillStyle(0xb99a64).fillTriangle(13, 2, 5, 12, 21, 12); g.fillRect(5, 12, 16, 38);
      g.fillStyle(0xdcbf88).fillTriangle(13, 2, 5, 12, 11, 12); g.fillRect(5, 12, 6, 38);
      g.fillStyle(0xffd24a).fillTriangle(13, 2, 10, 7, 16, 7);
      g.fillStyle(0x6a4c26);
      for (let i = 0; i < 6; i++) g.fillRect(9 + (i % 2) * 5, 16 + i * 5, 3, 2);
    });
    solid(x, y - 4, 16, 9);
    const im = put(key, x, y);
    glow(x, y - 52, 0.5, 0.5, 0xffd24a);
    return im;
  };
  B.archRuin = (x, y) => {
    const key = tex('pb.arch', 56, 50, (g) => {
      shadow(g, 28, 47, 50, 7);
      for (const px of [6, 40]) { g.fillStyle(0xa88858).fillRect(px, 38, 10, 7); g.fillStyle(0xd8c090).fillRect(px + 1, 10, 8, 30); g.fillStyle(0xeedab0).fillRect(px + 1, 10, 3, 30); }
      g.fillStyle(0xc9ac78).fillRect(4, 4, 30, 8); g.fillStyle(0xe2c890).fillRect(4, 4, 30, 3);
      g.fillStyle(0xc9ac78).fillRect(34, 6, 8, 6);
    });
    solid(x - 18, y - 6, 10, 9); solid(x + 18, y - 6, 10, 9);
    return put(key, x, y);
  };
  B.sunStatue = (x, y) => {
    const key = tex('pb.sunstatue', 40, 54, (g) => {
      shadow(g, 20, 51, 36, 7, 0.3);
      g.fillStyle(0x9a7c4c).fillRect(6, 40, 28, 10); g.fillStyle(0xc9ac78).fillRect(8, 42, 24, 6);
      g.fillStyle(0xb8955c).fillRect(14, 20, 12, 22); g.fillStyle(0xdcbf88).fillRect(14, 20, 4, 22);
      g.fillStyle(0xffc83a).fillCircle(20, 14, 11); g.fillStyle(0xffe27a).fillCircle(20, 14, 7); g.fillStyle(0xfff6c0).fillCircle(18, 12, 3);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.fillStyle(0xffc83a).fillTriangle(20 + Math.cos(a) * 11, 14 + Math.sin(a) * 11, 20 + Math.cos(a + 0.2) * 15, 14 + Math.sin(a + 0.2) * 15, 20 + Math.cos(a - 0.2) * 15, 14 + Math.sin(a - 0.2) * 15); }
    });
    solid(x, y - 6, 26, 10);
    const im = put(key, x, y);
    glow(x, y - 40, 1.1, 0.4, 0xffd24a, 0);
    return im;
  };
  B.tumbleweed = (x, y) => {
    const key = tex('pb.tumble', 14, 14, (g) => {
      g.lineStyle(1, 0x8a6a3a, 1);
      for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(7, 7, 2 + i * 0.7, i * 0.9, i * 0.9 + 4.2); g.strokePath(); }
    });
    return put(key, x, y, 0.5, 0.75);
  };
  B.sandMound = (x, y, v = 0) => {
    const key = tex(`pb.mound${v % 2}`, 34, 12, (g) => {
      g.fillStyle(0xc8a866).fillEllipse(17, 8, 30, 8); g.fillStyle(0xeed898).fillEllipse(14, 6, 20, 5);
    });
    const im = put(key, x, y); im.setDepth(1);
    return im;
  };

  // ——————————————— Marsh ———————————————
  B.reeds = (x, y, v = 0) => {
    const key = tex(`pb.reeds${v % 3}`, 28, 34, (g) => {
      shadow(g, 14, 31, 22, 5, 0.2);
      const n = 5 + (v % 3);
      for (let i = 0; i < n; i++) {
        const bx = 4 + i * (20 / n) + (i % 2), h = 16 + ((i * 7 + v * 3) % 12), lean = (i % 2 ? 2 : -2);
        g.lineStyle(1.6, i % 2 ? 0x7fa04a : 0x5f8a3c, 1);
        g.beginPath(); g.moveTo(bx, 31); g.lineTo(bx + lean, 31 - h * 0.6); g.lineTo(bx + lean * 1.6, 31 - h); g.strokePath();
        if (i % 2 === 0) { g.fillStyle(0x6b4422).fillRect(bx + lean * 1.6 - 1, 31 - h - 4, 3, 6); }
      }
    });
    return put(key, x, y);
  };
  B.swampTree = (x, y, v = 0) => {
    const key = tex(`pb.swtree${v % 2}`, 56, 64, (g) => {
      shadow(g, 28, 62, 34, 8, 0.28);
      g.fillStyle(0x3a2e22).fillRect(24, 26, 8, 36); g.fillStyle(0x54432f).fillRect(24, 26, 3, 36);
      g.lineStyle(4, 0x3a2e22, 1);
      g.beginPath(); g.moveTo(28, 34); g.lineTo(14, 22); g.lineTo(8, 12); g.strokePath();
      g.beginPath(); g.moveTo(29, 30); g.lineTo(44, 18); g.lineTo(50, 10); g.strokePath();
      g.fillStyle(0x4a6a3a, 0.95).fillEllipse(14, 14, 22, 12).fillEllipse(42, 12, 22, 12).fillEllipse(28, 10, 26, 13);
      g.fillStyle(0x5f8a48, 0.9).fillEllipse(12, 12, 12, 7).fillEllipse(40, 10, 12, 7);
      g.fillStyle(0x7fa060, 0.7);
      for (let i = 0; i < 7; i++) g.fillRect(6 + i * 7, 16 + (i % 3) * 3, 1, 10 + ((i * 5) % 9));
      if (v % 2) { g.fillStyle(0xb8d8a0, 0.9).fillRect(18, 8, 2, 2).fillRect(36, 12, 2, 2); }
    });
    solid(x, y - 2, 8, 7);
    return put(key, x, y);
  };
  B.giantMushroom = (x, y, v = 0) => {
    const caps = [0x9a70c0, 0x5fc0a0, 0xd06a8a];
    const cap = caps[v % 3];
    const key = tex(`pb.gmush${v % 3}`, 36, 40, (g) => {
      shadow(g, 18, 37, 22, 5);
      g.fillStyle(0xe8e0c8).fillRect(15, 20, 6, 17); g.fillStyle(0xfffaf0).fillRect(15, 20, 2, 17);
      g.fillStyle(cap).fillEllipse(18, 18, 32, 18); g.fillStyle(0x000000, 0.18).fillEllipse(18, 22, 28, 6);
      g.fillStyle(0xffffff, 0.5).fillCircle(10, 14, 2.4).fillCircle(22, 11, 2).fillCircle(27, 17, 1.6);
    });
    solid(x, y - 3, 8, 8);
    const im = put(key, x, y);
    glow(x, y - 18, 0.55, 0.3, cap, 0);
    return im;
  };
  B.lanternPost = (x, y) => {
    const key = tex('pb.lpost', 14, 40, (g) => {
      shadow(g, 7, 38, 10, 4);
      g.fillStyle(0x4a3422).fillRect(5, 8, 3, 30); g.fillStyle(0x6a4c30).fillRect(5, 8, 1, 30);
      g.fillStyle(0x3a2a1a).fillRect(3, 6, 8, 3); g.fillStyle(0xffd27a).fillRect(4, 9, 6, 7); g.fillStyle(0xfff0b0).fillRect(5, 10, 3, 4);
    });
    solid(x, y - 2, 4, 5);
    const im = put(key, x, y);
    glow(x + 0.5, y - 29, 0.85, 0.5, 0xffb060, 0, 2400);
    return im;
  };
  B.stiltHut = (x, y, roof = 0x7a5a30) => {
    const key = tex(`pb.hut${roof}`, 64, 66, (g) => {
      shadow(g, 32, 63, 54, 7, 0.26);
      for (const px of [8, 24, 40, 54]) g.fillStyle(0x4a3422).fillRect(px, 40, 4, 22);
      g.fillStyle(0x6a4c30).fillRect(4, 36, 56, 6);
      g.fillStyle(0xa0703c).fillRect(8, 16, 48, 22); g.fillStyle(0x7d5228).fillRect(8, 26, 48, 1).fillRect(8, 33, 48, 1);
      g.fillStyle(roof).fillTriangle(32, 2, 0, 18, 64, 18); g.fillStyle(0x000000, 0.2).fillTriangle(32, 2, 32, 18, 64, 18);
      g.fillStyle(0x24160a).fillRect(26, 24, 12, 14); g.fillStyle(0xffd27a, 0.9).fillRect(11, 22, 8, 7).fillRect(45, 22, 8, 7);
    });
    solid(x, y - 10, 54, 18);
    const im = put(key, x, y);
    glow(x - 18, y - 36, 0.6, 0.35, 0xffd27a, 0, 2400);
    return im;
  };
  B.stump = (x, y) => {
    const key = tex('pb.stump', 18, 16, (g) => {
      shadow(g, 9, 14, 14, 4);
      g.fillStyle(0x4a3a2a).fillRect(3, 6, 12, 8); g.fillStyle(0x6a5238).fillEllipse(9, 6, 12, 5); g.fillStyle(0x8a6a48).fillEllipse(9, 6, 7, 3);
    });
    solid(x, y - 3, 10, 7);
    return put(key, x, y);
  };
  B.wisp = (x, y) => { // decorative drifting light (the night light map treats 0xd8ff7a small glows as fireflies)
    if (!scene.textures.exists('fx.glow')) return null;
    const f = scene.add.image(x, y, 'fx.glow').setDepth(2850).setBlendMode(Phaser.BlendModes.ADD).setTint(0xd8ff7a).setScale(0.2).setAlpha(0.35);
    scene.tweens.add({ targets: f, alpha: 0.9, duration: 800 + (x % 700), yoyo: true, repeat: -1, ease: 'sine.inout' });
    scene.tweens.add({ targets: f, x: x + ((x * 3) % 50 - 25), y: y + ((y * 5) % 30 - 15), duration: 3000 + (y % 2000), yoyo: true, repeat: -1, ease: 'sine.inout' });
    return f;
  };

  // ——————————————— Caverns ———————————————
  const CRY = [[0xff6a3a, 0xffb080], [0xff9a2a, 0xffe0a0], [0xd04aff, 0xf0b0ff], [0x4ac8ff, 0xc0f0ff]];
  B.crystal = (x, y, v = 0, light = true) => {
    const [c, hi] = CRY[v % 4];
    const key = tex(`pb.crystal${v % 4}`, 34, 38, (g) => {
      shadow(g, 17, 35, 26, 6, 0.3);
      const shard = (cx, base, w, h, col) => {
        g.fillStyle(col).fillTriangle(cx, base - h, cx - w, base, cx + w, base);
        g.fillStyle(0xffffff, 0.35).fillTriangle(cx, base - h, cx - w, base, cx, base);
        g.fillStyle(hi, 0.8).fillTriangle(cx, base - h, cx - 1, base - h + 5, cx + 1, base - h + 5);
      };
      shard(10, 34, 6, 22, c); shard(24, 34, 5, 17, c); shard(17, 34, 7, 30, c);
    });
    solid(x, y - 3, 14, 8);
    const im = put(key, x, y);
    if (light) glow(x, y - 14, 0.9, 0.42, c, 70);
    return im;
  };
  B.stalagmite = (x, y, v = 0) => {
    const h = 18 + (v % 3) * 6;
    const key = tex(`pb.stal${v % 3}`, 22, h + 6, (g, W, H) => {
      shadow(g, W / 2, H - 3, 18, 5, 0.3);
      g.fillStyle(0x4a3a4a).fillTriangle(W / 2, 2, 3, H - 4, W - 3, H - 4);
      g.fillStyle(0x6a5868).fillTriangle(W / 2, 2, 3, H - 4, W / 2, H - 4);
      g.fillStyle(0x2a2030).fillRect(3, H - 6, W - 6, 2);
    });
    solid(x, y - 2, 8, 6);
    return put(key, x, y);
  };
  B.minecart = (x, y) => {
    const key = tex('pb.cart', 34, 28, (g) => {
      shadow(g, 17, 25, 28, 5, 0.3);
      g.fillStyle(0x4a4858).fillRect(3, 10, 28, 12); g.fillStyle(0x6a6878).fillRect(3, 10, 28, 3);
      g.fillStyle(0x2a2834).fillCircle(9, 24, 3).fillCircle(25, 24, 3);
      g.fillStyle(0xff9a4a).fillEllipse(17, 10, 22, 7); g.fillStyle(0xffd080).fillCircle(13, 8, 2).fillCircle(20, 7, 2);
    });
    solid(x, y - 6, 26, 12);
    return put(key, x, y);
  };
  B.forge = (x, y) => {
    const key = tex('pb.forge', 48, 44, (g) => {
      shadow(g, 24, 41, 42, 7, 0.3);
      g.fillStyle(0x4a4450).fillRect(4, 14, 40, 26); g.fillStyle(0x6a6474).fillRect(4, 14, 40, 4);
      g.fillStyle(0x2a2630).fillRect(12, 22, 24, 18); g.fillStyle(0xff6a2a).fillRect(14, 28, 20, 10); g.fillStyle(0xffd060).fillRect(18, 31, 12, 6);
      g.fillStyle(0x3a3640).fillRect(30, 2, 10, 14);
    });
    solid(x, y - 8, 40, 16);
    const im = put(key, x, y);
    glow(x, y - 12, 1.7, 0.55, 0xff8a3a, 120, 2440);
    return im;
  };
  B.anvil = (x, y) => {
    const key = tex('pb.anvil', 24, 18, (g) => {
      shadow(g, 12, 16, 20, 4, 0.3);
      g.fillStyle(0x3a3844).fillRect(6, 10, 12, 6); g.fillStyle(0x5a5866).fillRect(2, 4, 20, 6); g.fillTriangle(22, 4, 22, 9, 28, 6);
      g.fillStyle(0x7a788a).fillRect(2, 4, 20, 2);
    });
    solid(x, y - 4, 18, 8);
    return put(key, x, y);
  };
  B.emberBrazier = (x, y) => {
    const key = tex('pb.ebraz', 16, 22, (g) => {
      shadow(g, 8, 20, 12, 4);
      g.fillStyle(0x34302a).fillRect(3, 10, 10, 6).fillRect(6, 15, 4, 5); g.fillStyle(0x6b5b3a).fillRect(2, 8, 12, 3);
      g.fillStyle(0xff7a2a).fillCircle(8, 6, 4); g.fillStyle(0xffd060).fillCircle(8, 7, 2);
    });
    solid(x, y - 2, 8, 6);
    const im = put(key, x, y);
    glow(x, y - 10, 1.4, 0.5, 0xff9a3a, 100, 2450);
    return im;
  };
  B.lavaGlow = (x, y, r) => glow(x, y, r, 0.35, 0xff7a2a, 90, 2300);

  // ——————————————— Hollow Depths ———————————————
  B.spikeTex = () => {
    tex('pb.spikeDown', 16, 16, (g) => { g.fillStyle(0x2a2438).fillRect(0, 0, 16, 16); g.fillStyle(0x0d0b14); for (const [sx, sy] of [[3, 3], [11, 3], [3, 11], [11, 11]]) g.fillCircle(sx, sy, 1.4); });
    tex('pb.spikeUp', 16, 16, (g) => {
      g.fillStyle(0x2a2438).fillRect(0, 0, 16, 16);
      g.fillStyle(0xd8dce8);
      for (const [sx, sy] of [[3, 3], [11, 3], [3, 11], [11, 11]]) { g.fillTriangle(sx, sy - 3, sx - 2, sy + 3, sx + 2, sy + 3); }
      g.fillStyle(0xffffff).fillRect(3, 1, 1, 2).fillRect(11, 1, 1, 2);
    });
  };
  B.arrowSlit = (x, y) => { // wall deco (x,y = tile centre-bottom)
    const key = tex('pb.slit', 16, 16, (g) => { g.fillStyle(0x15131a).fillRect(0, 0, 16, 16); g.fillStyle(0x000000).fillRect(6, 3, 4, 10); g.fillStyle(0x6a3a3a, 0.9).fillRect(7, 5, 2, 6); });
    return put(key, x, y).setDepth(y + 3);
  };

  // ——————————————— Overworld landmarks ———————————————
  B.windmill = (x, y) => {
    const base = tex('pb.windbase', 54, 72, (g) => {
      shadow(g, 27, 69, 46, 8, 0.28);
      g.fillStyle(0xb8a078).fillTriangle(27, 20, 6, 66, 48, 66); g.fillStyle(0xd8c498).fillTriangle(27, 20, 6, 66, 27, 66);
      g.fillStyle(0x8a3a2a).fillTriangle(27, 4, 10, 26, 44, 26); g.fillStyle(0xb04a36).fillTriangle(27, 4, 10, 26, 27, 26);
      g.fillStyle(0x24160a).fillRect(22, 50, 10, 16); g.fillStyle(0xffd27a, 0.9).fillRect(23, 34, 8, 8);
    });
    solid(x, y - 10, 34, 16);
    const c = scene.add.container(x, y).setDepth(y);
    const b = scene.add.image(0, 0, base).setOrigin(0.5, 1);
    const sails = scene.add.container(0, -52);
    const sk = tex('pb.sail', 50, 10, (g) => { g.fillStyle(0x6a4a2a).fillRect(0, 4, 50, 2); g.fillStyle(0xf0e8d0).fillRect(6, 0, 18, 10).fillRect(26, 0, 18, 10); g.fillStyle(0xd8ccb0).fillRect(6, 7, 18, 3).fillRect(26, 7, 18, 3); });
    for (let i = 0; i < 4; i++) { const s = scene.add.image(0, 0, sk).setOrigin(0, 0.5).setRotation(i * Math.PI / 2); sails.add(s); }
    c.add([b, sails]);
    scene.tweens.add({ targets: sails, rotation: Math.PI * 2, duration: 9000, repeat: -1 });
    return c;
  };
  B.ruinTower = (x, y) => {
    const key = tex('pb.ruintower', 52, 76, (g) => {
      shadow(g, 26, 73, 46, 7, 0.28);
      g.fillStyle(0x6a7680).fillRect(8, 20, 36, 52); g.fillStyle(0x8a98a4).fillRect(8, 20, 12, 52);
      g.fillStyle(0x56626c); for (let j = 0; j < 6; j++) g.fillRect(8, 28 + j * 8, 36, 1);
      // broken crenellations
      g.fillStyle(0x6a7680).fillRect(8, 12, 8, 8).fillRect(22, 14, 8, 6).fillRect(38, 10, 6, 10);
      g.fillStyle(0x8a98a4).fillRect(8, 12, 3, 8);
      g.fillStyle(0x15131a).fillRect(22, 44, 8, 12); g.fillStyle(0x24202c).fillRect(24, 28, 4, 8);
      g.fillStyle(0x4f8a4a, 0.9).fillEllipse(14, 44, 10, 28).fillEllipse(40, 56, 8, 22); g.fillStyle(0x6fb05a, 0.8).fillEllipse(12, 40, 4, 10);
    });
    solid(x, y - 10, 36, 18);
    return put(key, x, y);
  };
  B.bannerFlag = (x, y, col = 0xc0392b) => {
    const key = tex(`pb.flag${col}`, 18, 40, (g) => { g.fillStyle(0x4a3422).fillRect(2, 2, 2, 36); g.fillStyle(col).fillRect(4, 3, 12, 8).fillTriangle(16, 3, 16, 11, 12, 7); });
    return put(key, x, y);
  };
  return B;
}
