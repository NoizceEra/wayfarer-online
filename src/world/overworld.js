import { CONFIG } from '../config.js';

// Builds one large open world (128×128 tiles) from textured ground +
// scattered props. Zones: town (safe), meadow, woods, ruins.
// Gameplay reads zoneAt(); visuals can be re-skinned without touching rules.
export function zoneAt(tx, ty, ZONES) {
  // Smallest-area-first: enclaves (town inside meadow) win over their parent.
  const sorted = [...ZONES].sort((a, b) => (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h));
  for (const z of sorted) {
    const r = z.rect;
    if (tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h) return z;
  }
  return ZONES[1];
}

const TILE_TEX = { town: 'tile.town', meadow: 'tile.meadow', woods: 'tile.woods', ruins: 'tile.ruins' };

export function buildOverworld(scene, ZONES) {
  const t = CONFIG.tile;
  const W = CONFIG.worldCols * t, H = CONFIG.worldRows * t;

  // Textured ground per zone (generated 16×16 noise tiles)
  for (const z of ZONES) {
    const r = z.rect;
    scene.add.tileSprite((r.x + r.w / 2) * t, (r.y + r.h / 2) * t, r.w * t, r.h * t, TILE_TEX[z.id] || 'tile.meadow').setDepth(-10);
  }
  // Meadow base under everything (zones tile over it)
  scene.add.tileSprite(W / 2, H / 2, W, H, 'tile.meadow').setDepth(-11);

  // Water border + foam
  const g = scene.add.graphics().setDepth(-8);
  g.fillStyle(0x2e86c1, 1).fillRect(0, 0, W, 24).fillRect(0, H - 24, W, 24).fillRect(0, 0, 24, H).fillRect(W - 24, 0, 24, H);
  g.lineStyle(3, 0xaed6f1, 0.8).strokeRect(24, 24, W - 48, H - 48);

  let seed = 1234567;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const solids = scene.physics.add.staticGroup();

  const makeTree = (x, y, big) => {
    const c = scene.add.container(x, y).setDepth(y);
    const s = big ? 1.4 : 1;
    const sh = scene.add.ellipse(0, 4, 16 * s, 6 * s, 0x000000, 0.25);
    const trunk = scene.add.rectangle(0, 0, 4 * s, 7 * s, 0x5a3a1e);
    const leaf1 = scene.add.circle(-3 * s, -7 * s, 6 * s, 0x1e6b2f);
    const leaf2 = scene.add.circle(3 * s, -7 * s, 6 * s, 0x27ae60);
    const leaf3 = scene.add.circle(0, -11 * s, 5 * s, 0x2ecc71);
    c.add([sh, trunk, leaf1, leaf2, leaf3]);
    const hit = scene.add.rectangle(x, y - 2, 8, 8, 0xffffff, 0);
    solids.add(hit);
  };

  const makeHouse = (x, y, roof) => {
    const c = scene.add.container(x, y).setDepth(y);
    const base = scene.add.rectangle(0, -8, 30, 20, 0xd9c08a);
    const timber = scene.add.rectangle(0, -8, 30, 3, 0x8d5524);
    const roofT = scene.add.triangle(0, -28, -20, -18, 20, -18, 0, -32, roof);
    const door = scene.add.rectangle(0, -4, 7, 12, 0x5a3a1e);
    const win = scene.add.rectangle(-9, -10, 6, 5, 0xf7dc6f);
    c.add([base, timber, roofT, door, win]);
    const hit = scene.add.rectangle(x, y - 8, 30, 20, 0xffffff, 0);
    solids.add(hit);
    return win; // window glows at night
  };

  const windows = [];
  const glows = [];

  for (let i = 0; i < 900; i++) {
    const tx = 2 + Math.floor(rnd() * (CONFIG.worldCols - 4));
    const ty = 2 + Math.floor(rnd() * (CONFIG.worldRows - 4));
    const zone = zoneAt(tx, ty, ZONES);
    const x = tx * t + 8, y = ty * t + 8;
    if (zone.id === 'town') {
      if (rnd() < 0.05) windows.push(makeHouse(x, y, pick([0xb03a2e, 0x2e86c1, 0x7d3c98])));
      else if (rnd() < 0.06 && scene.textures.exists('env.flower')) {
        scene.add.image(x, y, 'env.flower').setDepth(1).setScale(2);
      }
      continue;
    }
    const r = rnd();
    if (zone.id === 'woods' ? r < 0.24 : r < 0.06) {
      makeTree(x, y, zone.id === 'woods' && r < 0.08);
    } else if (r < 0.32 && scene.textures.exists('env.flower')) {
      scene.add.image(x, y, 'env.flower').setDepth(1).setScale(2);
    } else if (r < 0.36 && scene.textures.exists('env.plant')) {
      scene.add.sprite(x, y, 'env.plant', 0).play('env.plant.sway').setDepth(1);
    } else if (r < 0.40) {
      const rock = scene.add.container(x, y).setDepth(y);
      rock.add([scene.add.ellipse(0, 2, 12, 5, 0x000000, 0.25), scene.add.circle(-2, -1, 5, 0x7f8c8d), scene.add.circle(3, -3, 3, 0x95a5a6)]);
      const hit = scene.add.rectangle(x, y, 10, 8, 0xffffff, 0);
      solids.add(hit);
    } else if (zone.id === 'ruins' && r < 0.46) {
      const c = scene.add.container(x, y).setDepth(y);
      const h = 14 + Math.floor(rnd() * 12);
      c.add([
        scene.add.rectangle(0, -h / 2, 9, h, 0xaab7b8),
        scene.add.rectangle(0, -h, 11, 3, 0x7f8c8d),
        scene.add.rectangle(0, -h - 1, 11, 3, 0x5da24a, 0.7),
      ]);
      const hit = scene.add.rectangle(x, y - h / 2, 9, h, 0xffffff, 0);
      solids.add(hit);
    }
  }

  // Town plaza: spawn + fixed houses + torches with night glow
  const town = ZONES[0].rect;
  const spawn = { x: (town.x + town.w / 2) * t, y: (town.y + town.h / 2) * t };
  scene.add.circle(spawn.x, spawn.y, 30, 0xf7dc6f, 0.35).setDepth(0);
  windows.push(makeHouse(spawn.x - 40, spawn.y - 20, 0xb03a2e));
  windows.push(makeHouse(spawn.x + 40, spawn.y - 20, 0x2e86c1));
  for (const [dx, dy] of [[-16, 18], [16, 18], [0, -34]]) {
    const tx = spawn.x + dx, ty = spawn.y + dy;
    scene.add.rectangle(tx, ty, 3, 12, 0x5a3a1e).setDepth(ty);
    const flame = scene.add.circle(tx, ty - 8, 3, 0xe67e22).setDepth(ty + 1);
    scene.tweens.add({ targets: flame, scale: 1.4, duration: 300, yoyo: true, repeat: -1, ease: 'sine.inout' });
    if (scene.textures.exists('fx.glow')) {
      const glow = scene.add.image(tx, ty - 8, 'fx.glow').setDepth(60).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5).setScale(0.8);
      scene.tweens.add({ targets: glow, alpha: 0.3, duration: 700, yoyo: true, repeat: -1, ease: 'sine.inout' });
      glows.push(glow);
    }
    const hit = scene.add.rectangle(tx, ty + 2, 4, 8, 0xffffff, 0);
    solids.add(hit);
  }

  scene.physics.world.setBounds(32, 32, W - 64, H - 64);
  return { spawn, solids, W, H, windows, glows };
}
