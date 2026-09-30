// Procedural 16x16 ground/wall tiles for the expansion maps, in the same chunky
// noise style as the generated tile.* textures in assets/loader.js.
function rng(seedStr) {
  let s = 0; for (const ch of seedStr) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  s = s || 7919;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

export function makeBiomeTextures(scene) {
  const T = scene.textures;
  const gen = (key, draw, size = 16) => {
    if (T.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g, rng(key));
    g.generateTexture(key, size, size);
    g.destroy();
  };
  const flecks = (g, r, base, cols, n, w = 2, h = 1) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle(cols[Math.floor(r() * cols.length)] ?? base, 1).fillRect(Math.floor(r() * 16), Math.floor(r() * 16), w, h);
    }
  };

  gen('tile.sand', (g, r) => { g.fillStyle(0xe3cf8f, 1).fillRect(0, 0, 16, 16); flecks(g, r, 0xe3cf8f, [0xd4bd78, 0xf0e0a8, 0xd9c585], 16); });
  gen('tile.snow', (g, r) => { g.fillStyle(0xeaf2f8, 1).fillRect(0, 0, 16, 16); flecks(g, r, 0xeaf2f8, [0xd2e2ee, 0xffffff, 0xdcebf5], 16); });
  gen('tile.snowpack', (g, r) => { g.fillStyle(0xc3d3de, 1).fillRect(0, 0, 16, 16); flecks(g, r, 0xc3d3de, [0xb3c5d2, 0xd3e0e9, 0xa9bccb], 16); });
  gen('tile.ice', (g, r) => {
    g.fillStyle(0x8fc5e6, 1).fillRect(0, 0, 16, 16);
    flecks(g, r, 0x8fc5e6, [0xa8d8f0, 0x7ab4d8, 0xd2efff], 10, 3, 1);
    g.fillStyle(0xd2efff, 1).fillRect(3, 11, 1, 1).fillRect(4, 10, 1, 1).fillRect(10, 4, 1, 1);
  });
  gen('tile.cobble', (g, r) => {
    g.fillStyle(0x8c9199, 1).fillRect(0, 0, 16, 16);
    g.fillStyle(0x6f747c, 1);
    g.fillRect(0, 7, 16, 1).fillRect(0, 15, 16, 1).fillRect(5, 0, 1, 7).fillRect(11, 8, 1, 7);
    flecks(g, r, 0x8c9199, [0x9da2aa, 0x7d828a], 10);
  });
  gen('tile.pier', (g, r) => {
    g.fillStyle(0x8d5a2b, 1).fillRect(0, 0, 16, 16);
    g.fillStyle(0x5e3a1a, 1).fillRect(0, 0, 16, 1).fillRect(0, 5, 16, 1).fillRect(0, 10, 16, 1).fillRect(0, 15, 16, 1);
    flecks(g, r, 0x8d5a2b, [0x9d6a38, 0x7a4c22], 10, 3, 1);
    g.fillStyle(0x3d2712, 1).fillRect(2, 2, 1, 1).fillRect(13, 7, 1, 1).fillRect(3, 12, 1, 1);
  });
  gen('tile.water', (g, r) => {
    g.fillStyle(0x2e86c1, 1).fillRect(0, 0, 16, 16);
    g.fillStyle(0x3a96d2, 1).fillRect(1, 3, 5, 1).fillRect(9, 9, 6, 1).fillRect(3, 13, 4, 1);
    g.fillStyle(0x7cc4ee, 1).fillRect(2, 3, 2, 1).fillRect(11, 9, 2, 1);
    g.fillStyle(0x276fa3, 1).fillRect(8, 5, 4, 1).fillRect(0, 10, 3, 1);
  });
  gen('tile.crypt', (g, r) => {
    g.fillStyle(0x2b2833, 1).fillRect(0, 0, 16, 16);
    g.fillStyle(0x36323f, 1).fillRect(1, 1, 6, 6).fillRect(9, 1, 6, 6).fillRect(1, 9, 6, 6).fillRect(9, 9, 6, 6);
    g.fillStyle(0x423d4d, 1).fillRect(1, 1, 6, 1).fillRect(9, 9, 6, 1);
    g.fillStyle(0x1e1c24, 1).fillRect(0, 7, 16, 2).fillRect(7, 0, 2, 7).fillRect(7, 9, 2, 7);
    flecks(g, r, 0x2b2833, [0x23202b, 0x4a4556], 7, 1, 1);
  });
  gen('tile.cryptwall', (g, r) => {
    g.fillStyle(0x15131a, 1).fillRect(0, 0, 16, 16);
    g.fillStyle(0x1f1c26, 1).fillRect(0, 0, 16, 7).fillRect(0, 9, 16, 7);
    g.fillStyle(0x2c2936, 1).fillRect(1, 1, 6, 5).fillRect(9, 10, 6, 5);
    g.fillStyle(0x0d0c11, 1).fillRect(0, 7, 16, 2);
    flecks(g, r, 0x1f1c26, [0x0d0c11, 0x33303f], 5, 2, 1);
  });
  gen('tile.plank', (g, r) => {
    g.fillStyle(0xa0703c, 1).fillRect(0, 0, 16, 16);
    g.fillStyle(0x7d5228, 1).fillRect(0, 0, 16, 1).fillRect(0, 8, 16, 1);
    g.fillStyle(0x7d5228, 1).fillRect(5, 1, 1, 7).fillRect(11, 9, 1, 7);
    flecks(g, r, 0xa0703c, [0xb08048, 0x94642f], 10, 3, 1);
  });
  gen('tile.wallwood', (g, r) => {
    g.fillStyle(0x6b4426, 1).fillRect(0, 0, 16, 16);
    g.fillStyle(0x553619, 1).fillRect(0, 0, 1, 16).fillRect(8, 0, 1, 16);
    g.fillStyle(0x7a5030, 1).fillRect(1, 0, 2, 16).fillRect(9, 0, 2, 16);
    g.fillStyle(0x3d2712, 1).fillRect(0, 14, 16, 2);
    flecks(g, r, 0x6b4426, [0x5d3a1f], 6, 1, 2);
  });
  gen('px.white', (g) => { g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2); }, 2);
}
