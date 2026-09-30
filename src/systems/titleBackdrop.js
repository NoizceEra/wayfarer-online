// Procedural dusk-over-the-hills title backdrop (pixel art, drawn once to a
// 480x270 canvas and scaled with nearest-neighbour). Olive/gold palette to
// match the title type; a lone wayfarer with a lantern stands on the ridge.
const W = 480, H = 270;
const hash = (x, y = 0) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function ensureTitleBackdrop(scene) {
  const key = 'title.bg';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, W, H);
  const c = tex.getContext();
  c.imageSmoothingEnabled = false;
  const rect = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w | 0, h | 0); };

  // sky: banded gradient (dark forest → olive → lantern gold at the horizon)
  const bands = ['#07200d', '#0a2a10', '#0d3513', '#124216', '#1a5219', '#2a6a1c', '#4a8320', '#7aa22a', '#b3b93a', '#e0c850'];
  const skyH = 190;
  for (let i = 0; i < bands.length; i++) rect(0, (i * skyH) / bands.length, W, skyH / bands.length + 1, bands[i]);
  // dithered band edges
  for (let i = 1; i < bands.length; i++) {
    const y = Math.round((i * skyH) / bands.length);
    for (let x = 0; x < W; x += 2) rect(x + (hash(x, i) > 0.5 ? 1 : 0), y - 1, 1, 1, bands[i]);
  }
  // stars in the upper sky
  for (let i = 0; i < 90; i++) {
    const x = hash(i, 3) * W, y = hash(i, 9) * 90;
    rect(x, y, 1, 1, hash(i, 5) > 0.85 ? '#fff6c0' : '#9fc88a');
  }
  // low sun glow
  for (let r = 70; r > 0; r -= 5) {
    c.globalAlpha = 0.05;
    c.fillStyle = '#fff2a0';
    c.beginPath(); c.ellipse(330, 178, r * 1.6, r * 0.7, 0, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  rect(322, 172, 16, 7, '#fff3b0'); rect(325, 169, 10, 3, '#fff3b0'); // sun disc peeking over the ridge

  // ridge layers (far → near), each with pines
  const ridge = (base, amp, freq, seed, col, rim, pines) => {
    const tops = [];
    for (let x = 0; x < W; x++) {
      const y = Math.round(base + Math.sin(x * freq + seed) * amp + Math.sin(x * freq * 2.3 + seed * 2) * amp * 0.4);
      tops.push(y);
      rect(x, y, 1, H - y, col);
      rect(x, y, 1, 1, rim);
    }
    for (let i = 0; i < pines; i++) {
      const x = Math.floor(hash(i, seed) * (W - 6)) + 3, y = tops[x];
      const h = 8 + Math.floor(hash(i, seed + 4) * 8);
      for (let k = 0; k < h; k++) rect(x - Math.floor((h - k) / 4), y - k, 1 + 2 * Math.floor((h - k) / 4), 1, col);
    }
    return tops;
  };
  ridge(186, 7, 0.02, 1.3, '#16401a', '#2e6a24', 30);
  ridge(206, 9, 0.027, 4.1, '#0f3014', '#1f5220', 36);
  const near = ridge(232, 8, 0.018, 7.7, '#092410', '#16411a', 26);

  // wayfarer + lantern silhouette on the near ridge
  const px = 120, py = near[px];
  rect(px - 2, py - 12, 4, 10, '#04140a');            // body
  rect(px - 3, py - 15, 6, 4, '#04140a');             // hood
  rect(px - 1, py - 2, 1, 2, '#04140a'); rect(px + 1, py - 2, 1, 2, '#04140a');
  rect(px + 4, py - 14, 1, 10, '#04140a');            // staff
  rect(px + 5, py - 9, 3, 4, '#ffd34a');              // lantern
  rect(px + 6, py - 8, 1, 2, '#fff6c0');
  for (let r = 18; r > 0; r -= 3) { c.globalAlpha = 0.07; c.fillStyle = '#ffe27a'; c.beginPath(); c.arc(px + 6.5, py - 7, r, 0, Math.PI * 2); c.fill(); }
  c.globalAlpha = 1;
  tex.refresh();
  return key;
}

// Adds the backdrop + drifting fireflies to a container, sized to cover the
// visible area of a zoomed/scrolled menu camera. Returns nothing; caller owns container.
export function addTitleBackdrop(scene, root, menu) {
  const key = ensureTitleBackdrop(scene);
  const { W: mw, H: mh, zoom, pw, ph } = menu;
  const vw = pw / zoom, vh = ph / zoom;
  const cx = mw / 2, cy = mh / 2;
  const s = Math.max(vw / W, vh / H);
  root.add(scene.add.image(cx, cy, key).setScale(s).setDepth(-50));
  // fireflies
  const n = 22;
  for (let i = 0; i < n; i++) {
    const x = cx - vw / 2 + hash(i, 1) * vw, y = cy - vh / 2 + vh * (0.45 + hash(i, 2) * 0.5);
    const f = scene.add.rectangle(x, y, 2, 2, 0xfff2a0, 0.9).setBlendMode(1);
    root.add(f);
    scene.tweens.add({ targets: f, x: x + (hash(i, 7) - 0.5) * 50, y: y - 10 - hash(i, 8) * 30, alpha: { from: 0.15, to: 0.95 }, duration: 2200 + hash(i, 4) * 2600, yoyo: true, repeat: -1, ease: 'sine.inout', delay: hash(i, 6) * 2000 });
  }
}
