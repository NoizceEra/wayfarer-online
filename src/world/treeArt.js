// Procedural pixel-art trees: clustered crowns with 3-tone light shading and a
// dark outline, plus a forked trunk. Baked once into canvas textures.
const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

const STYLES = {
  // key: [w, h, crown blobs [cx, cy, r], palette, trunk width]
  'tree.a': { w: 34, h: 40, blobs: [[17, 14, 10], [9, 19, 7], [25, 19, 7], [17, 24, 8]], pal: [0x1c5426, 0x2f7d36, 0x4fae52, 0x8ad66e], trunk: 4 },
  'tree.b': { w: 30, h: 38, blobs: [[15, 12, 9], [8, 18, 6], [22, 17, 7], [15, 22, 7]], pal: [0x1f5a2a, 0x36883c, 0x5cbc5a, 0x97e07a], trunk: 4 },
  'tree.c': { w: 28, h: 40, blobs: [[14, 8, 6], [14, 16, 9], [14, 24, 10]], pal: [0x174a2a, 0x27703a, 0x3f9a4c, 0x73c76a], trunk: 4 }, // round-conifer
  'tree.big': { w: 50, h: 58, blobs: [[25, 18, 14], [12, 28, 10], [38, 28, 10], [25, 34, 12], [25, 8, 8]], pal: [0x143f22, 0x225f30, 0x367f3f, 0x62b35a], trunk: 7 },
};

export function makeTreeTextures(scene) {
  for (const [key, st] of Object.entries(STYLES)) {
    if (scene.textures.exists(key)) continue;
    const { w, h, blobs, pal, trunk } = st;
    const tex = scene.textures.createCanvas(key, w, h);
    const ctx = tex.getContext();
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const cols = pal.map(hex);
    const outline = hex(0x0f2a18);
    const trunkCols = [hex(0x3d2614), hex(0x5a3a1e), hex(0x7a5230)];
    const trunkTop = h - 14, cx = w / 2;
    const inCrown = (x, y) => blobs.some(([bx, by, r]) => (x - bx) ** 2 + ((y - by) * 1.05) ** 2 <= r * r);
    const inTrunk = (x, y) => y >= trunkTop && Math.abs(x + 0.5 - cx) <= trunk / 2 + (y > h - 4 ? 1.5 : 0);
    const put = (x, y, c) => { const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const crown = inCrown(x, y);
        if (crown) {
          // light from upper-left: distance from nearest blob's highlight point
          let best = 9;
          for (const [bx, by, r] of blobs) {
            if ((x - bx) ** 2 + (y - by) ** 2 > r * r) continue;
            const lx = (x - (bx - r * 0.35)), ly = (y - (by - r * 0.4));
            best = Math.min(best, Math.hypot(lx, ly) / r);
          }
          let tone = best < 0.45 ? 3 : best < 0.85 ? 2 : best < 1.2 ? 1 : 0;
          if (hash(x, y, 7) > 0.88 && tone > 0) tone -= 1;          // leaf clumping
          else if (hash(x, y, 9) > 0.93 && tone < 3) tone += 1;
          put(x, y, cols[tone]);
        } else if (inTrunk(x, y)) {
          const t = x + 0.5 < cx - trunk / 4 ? 2 : x + 0.5 > cx + trunk / 4 ? 0 : 1;
          put(x, y, trunkCols[t]);
        }
      }
    }
    // 1px outline around everything opaque
    const snap = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (snap[(y * w + x) * 4 + 3]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && snap[(ny * w + nx) * 4 + 3]) { put(x, y, outline); break; }
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }
}
