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

export function buildOverworld(scene, ZONES, extras = {}) {
  const t = CONFIG.tile;
  // Clearings (gates, signposts, waystone) keep scatter props off their footprint.
  const clearings = extras.clearings || [];
  const cleared = (x, y) => clearings.some((c) => Math.hypot(c.x - x, c.y - y) < c.r);
  const W = CONFIG.worldCols * t, H = CONFIG.worldRows * t;

  // Textured ground per zone (generated 16×16 noise tiles).
  // Largest-area-first so enclaves (town inside meadow) draw ON TOP —
  // same-depth TileSprites render in creation order.
  const byAreaDesc = [...ZONES].sort((a, b) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
  for (const z of byAreaDesc) {
    const r = z.rect;
    scene.add.tileSprite((r.x + r.w / 2) * t, (r.y + r.h / 2) * t, r.w * t, r.h * t, TILE_TEX[z.id] || 'tile.meadow').setDepth(-10);
  }
  // Meadow base under everything (zones tile over it)
  scene.add.tileSprite(W / 2, H / 2, W, H, 'tile.meadow').setDepth(-11);

  // Water border + foam
  const g = scene.add.graphics().setDepth(-8);
  g.fillStyle(0x2e86c1, 1).fillRect(0, 0, W, 24).fillRect(0, H - 24, W, 24).fillRect(0, 0, 24, H).fillRect(W - 24, 0, 24, H);
  g.lineStyle(3, 0xaed6f1, 0.8).strokeRect(24, 24, W - 48, H - 48);

  // Feathered biome edges: 6-step alpha gradient bands (zone colour fading
  // into the neighbour) so woods/ruins melt instead of hard-cutting.
  // Base colours mirror the generated tile.* textures in loader.js.
  // Bands are 4 tiles wide — 2 tiles read as a hard edge on a zoomed camera.
  const feather = (x, y, w, h, color, horizontal, flip) => {
    const fg = scene.add.graphics().setDepth(-9);
    const steps = [0.08, 0.16, 0.26, 0.38, 0.50, 0.62];
    for (let i = 0; i < 6; i++) {
      fg.fillStyle(color, flip ? steps[5 - i] : steps[i]);
      if (horizontal) fg.fillRect(x, y + i * 8, w, 8);
      else fg.fillRect(x + i * 8, y, 8, h);
    }
  };
  const woodsR = ZONES.find((z) => z.id === 'woods').rect;
  const ruinsR = ZONES.find((z) => z.id === 'ruins').rect;
  feather((woodsR.x - 4) * t, woodsR.y * t, 64, woodsR.h * t, 0x3e8e41, false, false); // W
  feather(woodsR.x * t, (woodsR.y - 4) * t, woodsR.w * t, 64, 0x3e8e41, true, false);  // N
  feather(woodsR.x * t, (woodsR.y + woodsR.h) * t, woodsR.w * t, 64, 0x3e8e41, true, true); // S
  feather((woodsR.x + woodsR.w) * t, woodsR.y * t, 64, woodsR.h * t, 0x3e8e41, false, true); // E
  feather(ruinsR.x * t, (ruinsR.y - 4) * t, ruinsR.w * t, 64, 0x6b7f8e, true, false);  // N
  feather((ruinsR.x - 4) * t, ruinsR.y * t, 64, ruinsR.h * t, 0x6b7f8e, false, false); // W
  feather((ruinsR.x + ruinsR.w) * t, ruinsR.y * t, 64, ruinsR.h * t, 0x6b7f8e, false, true); // E

  let seed = 1234567;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const solids = scene.physics.add.staticGroup();

  // — Tileset availability flags (houses + ruins pillars use real tiles;
  // trees/rocks are procedural — see comments at their builders) —
  const useHouse  = scene.textures.exists('ts.house');
  const useRuins  = scene.textures.exists('ts.ruins');
  // Columns per row for each spritesheet (frameWidth=16)
  const HC = 33; // TilesetHouse   528px wide
  const RC = 20; // TilesetVillageAbandoned 320px wide

  // Position-based hash for visual variant selection — never consumes from
  // the seeded rnd() stream so the procedural placement layout stays identical.
  const vh = (tx, ty) => ((tx * 31 + ty * 17) >>> 0) & 0xFF;

  const makeTree = (x, y, big) => {
    const c = scene.add.container(x, y).setDepth(y);
    // Ground shadow — same char.shadow blob as NPCs/enemies/player so every
    // shadow in the world matches (ellipse fallback if the texture is missing).
    if (scene.textures.exists('char.shadow')) c.add(scene.add.image(0, 4, 'char.shadow').setScale(1.4, 1));
    else c.add(scene.add.ellipse(0, 4, 20, 7, 0x000000, 0.2));

    // Procedural canopy: three overlapping crowns + trunk. Reads cleanly at
    // 2-3x zoom and never mismatches (tileset-slice trees were retired —
    // arbitrary 3×2 blocks cut canopies mid-leaf and mixed dead/live pieces).
    const s = big ? 1.4 : 1;
    const leaf = big ? 0x2d6a33 : 0x3e8e41;
    const leafHi = big ? 0x3e8e41 : 0x5cc46a;
    const leafLo = 0x1e5b26;
    c.add(scene.add.rectangle(0, 0, 4 * s, 8 * s, 0x5a3a1e)); // trunk
    c.add(scene.add.circle(-4 * s, -8 * s, 7 * s, leafLo));
    c.add(scene.add.circle(4 * s, -8 * s, 7 * s, leaf));
    c.add(scene.add.circle(-2 * s, -11 * s, 5 * s, leafHi));
    c.add(scene.add.circle(3 * s, -10 * s, 4 * s, leaf));
    if (big) c.add(scene.add.circle(0, -15 * s, 5 * s, leafHi));

    const hit = scene.add.rectangle(x, y - 2, 8, 8, 0xffffff, 0);
    solids.add(hit);
  };

  const makeHouse = (x, y, roof) => {
    const c = scene.add.container(x, y).setDepth(y);
    let win;

    if (useHouse) {
      // 4×3 tile house from TilesetHouse. First building assembly:
      // row 0 = roof/eaves, row 1 = upper walls, row 2 = lower walls/base.
      // cols 0-3 per row. Roof tiles are tinted with the house colour.
      for (const [row, col, ox, oy] of [
        [0, 0, -24, -28], [0, 1, -8, -28], [0, 2, 8, -28], [0, 3, 24, -28],
        [1, 0, -24, -12], [1, 1, -8, -12], [1, 2, 8, -12], [1, 3, 24, -12],
        [2, 0, -24,   4], [2, 1, -8,   4], [2, 2, 8,   4], [2, 3, 24,   4],
      ]) {
        const img = scene.add.image(ox, oy, 'ts.house', row * HC + col);
        if (row === 0) img.setTint(roof);
        c.add(img);
      }
      // Invisible window rect returned for night-glow system
      win = scene.add.rectangle(14, -20, 6, 5, 0xf7dc6f, 0.0);
      c.add(win);
      solids.add(scene.add.rectangle(x, y - 12, 48, 36, 0xffffff, 0));
    } else {
      const base   = scene.add.rectangle(0, -8, 30, 20, 0xd9c08a);
      const timber = scene.add.rectangle(0, -8, 30, 3, 0x8d5524);
      const roofT  = scene.add.triangle(0, -28, -20, -18, 20, -18, 0, -32, roof);
      const door   = scene.add.rectangle(0, -4, 7, 12, 0x5a3a1e);
      win = scene.add.rectangle(-9, -10, 6, 5, 0xf7dc6f);
      c.add([base, timber, roofT, door, win]);
      solids.add(scene.add.rectangle(x, y - 8, 30, 20, 0xffffff, 0));
    }

    return win; // window glows at night
  };

  const windows = [];
  const glows = [];

  // Town plaza: spawn + fixed houses, placed first so scattered houses below
  // can avoid overlapping them (real tileset houses have a much bigger
  // footprint than the old primitive-shape ones, so spacing matters now).
  const town = ZONES[0].rect;
  const spawn = { x: (town.x + town.w / 2) * t, y: (town.y + town.h / 2) * t };
  scene.add.circle(spawn.x, spawn.y, 30, 0xf7dc6f, 0.35).setDepth(0);
  const housePositions = [];
  const placeHouse = (x, y, roof) => {
    windows.push(makeHouse(x, y, roof));
    housePositions.push({ x, y });
  };
  const HOUSE_MIN_DIST = useHouse ? 76 : 40;
  // Fixed plaza houses stand wide apart so the pair reads as intentional
  // variety, not a mismatched duplex; NPC row + torches sit south in the open.
  placeHouse(spawn.x - 60, spawn.y - 32, 0xb03a2e);
  placeHouse(spawn.x + 60, spawn.y - 32, 0x2e86c1);
  placeHouse(spawn.x, spawn.y - 124, 0xd68910); // the inn (enterable, see world/overworldFeatures.js)

  for (let i = 0; i < 900; i++) {
    const tx = 2 + Math.floor(rnd() * (CONFIG.worldCols - 4));
    const ty = 2 + Math.floor(rnd() * (CONFIG.worldRows - 4));
    const zone = zoneAt(tx, ty, ZONES);
    const x = tx * t + 8, y = ty * t + 8;
    if (zone.id === 'town') {
      const tooClose = housePositions.some((p) => Math.hypot(p.x - x, p.y - y) < HOUSE_MIN_DIST);
      if (rnd() < 0.05) { if (!tooClose && !cleared(x, y)) placeHouse(x, y, pick([0xb03a2e, 0x2e86c1, 0x7d3c98])); }
      else if (rnd() < 0.06) {
        const fk = ['flora.flowerA', 'flora.flowerB', 'env.flower'].find((k) => scene.textures.exists(k));
        if (fk) scene.add.image(x, y, fk).setDepth(1).setScale(1.5);
      }
      continue;
    }
    const r = rnd();
    if (cleared(x, y)) { if (zone.id === 'ruins' && r >= 0.40 && r < 0.46) rnd(); continue; } // keeps the RNG stream identical
    if (zone.id === 'woods' ? r < 0.24 : r < 0.06) {
      makeTree(x, y, zone.id === 'woods' && r < 0.08);
    } else if (r < 0.32) {
      // Flora band subdivided by the same r (no extra RNG draws, so tile
      // positions stay identical — only the sprite choice varies).
      const fk = r < 0.13 ? 'flora.tuft'
        : r < 0.19 ? 'flora.flowerA'
        : r < 0.24 ? 'flora.flowerB' : 'env.flower';
      if (scene.textures.exists(fk)) scene.add.image(x, y, fk).setDepth(1).setScale(fk === 'env.flower' ? 1.5 : 2);
    } else if (r < 0.36 && scene.textures.exists('env.plant')) {
      scene.add.sprite(x, y, 'env.plant', 0).play('env.plant.sway').setDepth(1);
    } else if (r < 0.40) {
      // Rocks — procedural mossy boulders. Tileset-slice rocks retired: every
      // "verified" frame guess turned out to be bush canopy on inspection,
      // and guessing costs more than the clean procedural look loses.
      // Variant picked by position hash; layout RNG untouched.
      const v = vh(tx, ty);
      const rc = scene.add.container(x, y).setDepth(y);
      if (scene.textures.exists('char.shadow')) rc.add(scene.add.image(0, 3, 'char.shadow').setScale(1.1, 1));
      else rc.add(scene.add.ellipse(0, 3, 16, 5, 0x000000, 0.22));
      rc.add(scene.add.circle(-2, -1, 5 + (v % 3), 0x7f8c8d));
      rc.add(scene.add.circle(3, -3, 3 + ((v >> 2) % 3), 0x95a5a6));
      rc.add(scene.add.circle(-3, -2, 2, 0x5da24a, 0.85)); // moss dab
      solids.add(scene.add.rectangle(x, y, 10, 8, 0xffffff, 0));
    } else if (zone.id === 'ruins' && r < 0.46) {
      // Ruins pillars via the shared builder below (same rnd draws as the
      // original branch, so the scatter layout doesn't shift).
      const h = 14 + Math.floor(rnd() * 12);
      buildPillar(x, y, h, vh(tx, ty));
    }
  }

  // Ruins pillar builder, shared by the scatter loop above and the dedicated
  // ruins pass further down (which uses its own seed so the main layout
  // never shifts). Tileset frames per the verified comment inside.
  // Function declaration (not const arrow) so it hoists above the 900-loop.
  function buildPillar(x, y, h, v) {
    if (cleared(x, y)) return;
    const c = scene.add.container(x, y).setDepth(y);
    if (useRuins) {
      // Column 2, rows 3-5 of TilesetVillageAbandoned is a genuine
      // standalone stackable pillar (row5=base, row4=shaft, row3=mossy
      // cap). Columns 0-4 at rows 0-2 are slices of one big archway
      // building scene, not stackable segments.
      const numRows = h > 22 ? 3 : 2;
      const pillarRows = [5, 4, 3]; // ground → up: base, shaft, cap
      let isStatue = false;
      if (v % 8 === 0) {
        // Occasional big mossy statue landmark: 2-wide × 2-tall, cols 0-1,
        // rows 3 (head) over 4 (seated base).
        isStatue = true;
        const statueRows = [4, 3]; // ground → up: base, head
        for (let i = 0; i < 2; i++) {
          c.add(scene.add.image(-8, -16 * i, 'ts.ruins', statueRows[i] * RC + 0));
          c.add(scene.add.image(8, -16 * i, 'ts.ruins', statueRows[i] * RC + 1));
        }
      } else {
        for (let i = 0; i < numRows; i++) {
          c.add(scene.add.image(0, -16 * i, 'ts.ruins', pillarRows[i] * RC + 2));
        }
      }
      solids.add(isStatue
        ? scene.add.rectangle(x, y - 16, 24, 28, 0xffffff, 0)
        : scene.add.rectangle(x, y - h / 2, 9, h, 0xffffff, 0));
    } else {
      c.add([
        scene.add.rectangle(0, -h / 2, 9, h, 0xaab7b8),
        scene.add.rectangle(0, -h, 11, 3, 0x7f8c8d),
        scene.add.rectangle(0, -h - 1, 11, 3, 0x5da24a, 0.7),
      ]);
      solids.add(scene.add.rectangle(x, y - h / 2, 9, h, 0xffffff, 0));
    }
  }

  // Dedicated ruins pass: the scatter loop only yields ~7 pillars across the
  // whole ruins (too barren). Own seed, so nothing above moves. Keeps clear
  // of the north gate row so the entrance stays readable.
  let pseed = 777001;
  const prnd = () => { pseed = (pseed * 16807) % 2147483647; return pseed / 2147483647; };
  for (let i = 0; i < 46; i++) {
    const tx = ruinsR.x + 2 + Math.floor(prnd() * (ruinsR.w - 4));
    const ty = ruinsR.y + 3 + Math.floor(prnd() * (ruinsR.h - 5));
    buildPillar(tx * t + 8, ty * t + 8, 14 + Math.floor(prnd() * 12), (tx * 31 + ty * 17) & 0xff);
  }

  // Torches with night glow (plaza corners south + gate torch south-centre,
// clear of the NPC row at y+30 and Old Tob up the middle)
  for (const [dx, dy] of [[-36, 28], [36, 28], [0, 54]]) {
    const tx = spawn.x + dx, ty = spawn.y + dy;
    scene.add.rectangle(tx, ty, 3, 12, 0x5a3a1e).setDepth(ty);
    const flame = scene.add.circle(tx, ty - 8, 3, 0xe67e22).setDepth(ty + 1);
    scene.tweens.add({ targets: flame, scale: 1.4, duration: 300, yoyo: true, repeat: -1, ease: 'sine.inout' });
    if (scene.textures.exists('fx.glow')) {
      const glow = scene.add.image(tx, ty - 8, 'fx.glow').setDepth(2900).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5).setScale(0.8);
      scene.tweens.add({ targets: glow, alpha: 0.3, duration: 700, yoyo: true, repeat: -1, ease: 'sine.inout' });
      glows.push(glow);
    }
    const hit = scene.add.rectangle(tx, ty + 2, 4, 8, 0xffffff, 0);
    solids.add(hit);
  }

  // Biome fringe + town flower ring: flora-only transition planting (no
  // solids, own RNG seed so the main scatter layout above stays identical).
  let fseed = 424242;
  const frnd = () => { fseed = (fseed * 16807) % 2147483647; return fseed / 2147483647; };
  const floraAt = (tx, ty, p) => {
    if (frnd() > p) return;
    const fx = tx * t + 8, fy = ty * t + 8;
    const v = frnd();
    if (v < 0.35 && scene.textures.exists('env.plant')) {
      scene.add.sprite(fx, fy, 'env.plant', 0).play('env.plant.sway').setDepth(1);
    } else if (v < 0.50 && scene.textures.exists('flora.tuft')) {
      scene.add.image(fx, fy, 'flora.tuft').setDepth(1).setScale(2);
    } else if (v < 0.62 && scene.textures.exists('flora.flowerA')) {
      scene.add.image(fx, fy, 'flora.flowerA').setDepth(1).setScale(2);
    } else if (v < 0.72 && scene.textures.exists('flora.flowerB')) {
      scene.add.image(fx, fy, 'flora.flowerB').setDepth(1).setScale(2);
    } else if (scene.textures.exists('env.flower')) {
      scene.add.image(fx, fy, 'env.flower').setDepth(1).setScale(1.5);
    }
  };
  for (let ty = woodsR.y; ty < woodsR.y + woodsR.h; ty++) { floraAt(woodsR.x - 1, ty, 0.4); floraAt(woodsR.x - 2, ty, 0.25); }
  for (let tx = woodsR.x; tx < woodsR.x + woodsR.w; tx++) { floraAt(tx, woodsR.y - 1, 0.35); floraAt(tx, woodsR.y + woodsR.h, 0.35); floraAt(tx, woodsR.y + woodsR.h + 1, 0.2); }
  for (let tx = ruinsR.x; tx < ruinsR.x + ruinsR.w; tx++) { floraAt(tx, ruinsR.y - 1, 0.35); floraAt(tx, ruinsR.y - 2, 0.2); }
  for (let ty = ruinsR.y; ty < ruinsR.y + ruinsR.h; ty++) { floraAt(ruinsR.x - 1, ty, 0.3); }
  const townR = ZONES[0].rect;
  // Town ring: sand-patch decals bleed the plaza floor outward with flora
  // between — reads as a worn town edge, not a tile cut.
  const ringAt = (tx, ty) => {
    if (scene.textures.exists('flora.sandpatch') && frnd() < 0.35) {
      scene.add.image(tx * t + 8, ty * t + 8, 'flora.sandpatch').setDepth(0).setScale(1.5);
    } else floraAt(tx, ty, 0.5);
  };
  for (let tx = townR.x - 1; tx <= townR.x + townR.w; tx++) { ringAt(tx, townR.y - 1); ringAt(tx, townR.y + townR.h); }
  for (let ty = townR.y; ty < townR.y + townR.h; ty++) { ringAt(townR.x - 1, ty); ringAt(townR.x + townR.w, ty); }

  scene.physics.world.setBounds(32, 32, W - 64, H - 64);
  return { spawn, solids, W, H, windows, glows, houses: housePositions.slice(0, 3) };
}
