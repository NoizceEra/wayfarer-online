// Procedural 16x16 HUD icon set. Every icon is drawn from flat fills on a
// shared palette, then an automatic 1px dark outline is stamped around the
// silhouette, so all icons share one style. Textures are keyed `hud.<name>`.
export const HUD_PAL = {
  outline: '#1a1024',
  steel: '#c9d3dc', steelHi: '#ffffff', steelLo: '#7d8a9a',
  wood: '#8a5a2b', woodLo: '#5a3a1a',
  red: '#e0493e', redHi: '#ff8f7a', redLo: '#9c2a2a',
  orange: '#f08a2a', yellow: '#ffd84a', gold: '#e8b22a',
  green: '#58c05a', greenHi: '#a6ec8a', greenLo: '#2f8040',
  blue: '#4a8ee0', blueHi: '#9cd0ff', blueLo: '#2a58a8',
  purple: '#a66ad8', purpleHi: '#e0b8ff',
  gray: '#9aa0aa', grayLo: '#626874', white: '#ffffff',
};

class Grid {
  constructor(n = 16) { this.n = n; this.p = new Array(n * n).fill(null); }
  px(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.n && y < this.n) this.p[y * this.n + x] = HUD_PAL[c]; return this; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); return this; }
  line(x0, y0, x1, y1, c, th = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
      this.px(x, y, c);
      if (th > 1) { this.px(x + 1, y, c); }
    }
    return this;
  }
  disc(cx, cy, r, c) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.px(cx + x, cy + y, c);
    return this;
  }
  get(x, y) { return x < 0 || y < 0 || x >= this.n || y >= this.n ? null : this.p[y * this.n + x]; }
  // stamp a 1px outline (4-neighbour) into empty cells touching the silhouette
  outline() {
    const n = this.n, add = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push(y * n + x);
    }
    for (const i of add) this.p[i] = HUD_PAL.outline;
    return this;
  }
}

const ICONS = {
  slash(g) {
    g.line(4, 11, 12, 3, 'steel', 2); g.line(5, 12, 13, 4, 'steelLo');
    g.line(3, 10, 11, 2, 'steelHi');
    g.line(2, 12, 6, 8, 'wood'); g.px(1, 13, 'woodLo'); g.line(5, 9, 7, 11, 'gold', 1);
    g.px(5, 10, 'gold'); g.px(6, 11, 'gold');
  },
  flare(g) {
    g.disc(8, 8, 3, 'yellow'); g.disc(8, 8, 1, 'white');
    for (const [x, y] of [[8, 2], [8, 13], [2, 8], [13, 8], [4, 4], [12, 4], [4, 12], [12, 12]]) g.px(x, y, 'orange');
    for (const [x, y] of [[8, 3], [8, 12], [3, 8], [12, 8]]) g.px(x, y, 'yellow');
  },
  dash(g) {
    g.rect(2, 5, 8, 1, 'blueHi'); g.rect(1, 8, 10, 1, 'blue'); g.rect(3, 11, 7, 1, 'blueHi');
    g.line(9, 4, 14, 8, 'steel'); g.line(9, 12, 14, 8, 'steelLo'); g.rect(11, 7, 3, 2, 'white');
  },
  camp(g) { // heal: green cross
    g.rect(6, 2, 4, 12, 'green'); g.rect(2, 6, 12, 4, 'green');
    g.rect(6, 2, 1, 12, 'greenHi'); g.rect(2, 6, 12, 1, 'greenHi'); g.rect(9, 9, 1, 5, 'greenLo'); g.rect(9, 9, 5, 1, 'greenLo');
  },
  shot(g) {
    g.line(3, 13, 12, 4, 'wood'); g.line(11, 3, 14, 2, 'steel'); g.rect(12, 2, 2, 2, 'steel'); g.px(14, 1, 'steelHi');
    g.line(2, 12, 4, 10, 'red'); g.line(3, 14, 5, 12, 'red'); g.px(2, 13, 'redHi');
  },
  volley(g) {
    g.line(3, 13, 9, 4, 'wood'); g.px(9, 3, 'steel'); g.px(10, 3, 'steel');
    g.line(5, 14, 13, 9, 'wood'); g.px(14, 9, 'steel'); g.px(14, 8, 'steel');
    g.line(2, 9, 12, 7, 'green'); g.px(13, 7, 'greenHi'); g.px(13, 6, 'greenHi');
    g.px(3, 13, 'greenLo'); g.px(5, 14, 'greenLo');
  },
  snare(g) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      g.px(8 + Math.cos(t) * 5, 8 + Math.sin(t) * 5, 'wood');
    }
    g.disc(8, 8, 2, 'woodLo'); g.px(8, 8, 'gold');
    for (const [x, y] of [[8, 2], [8, 14], [2, 8], [14, 8]]) g.px(x, y, 'steel');
  },
  bolt(g) {
    g.line(2, 13, 8, 7, 'orange'); g.line(2, 12, 7, 7, 'red'); g.px(3, 14, 'redLo');
    g.disc(10, 6, 3, 'orange'); g.disc(10, 6, 2, 'yellow'); g.px(10, 6, 'white');
  },
  burst(g) {
    g.disc(8, 8, 3, 'green'); g.disc(8, 8, 1, 'greenHi');
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      g.px(8 + Math.cos(t) * 5, 8 + Math.sin(t) * 5, 'greenLo');
      g.px(8 + Math.cos(t) * 6, 8 + Math.sin(t) * 6, 'green');
    }
  },
  blink(g) {
    g.line(8, 2, 13, 8, 'purple'); g.line(13, 8, 8, 14, 'purple'); g.line(8, 14, 3, 8, 'purple'); g.line(3, 8, 8, 2, 'purple');
    g.rect(6, 6, 4, 4, 'purpleHi'); g.px(8, 8, 'white'); g.px(8, 3, 'purpleHi'); g.px(4, 8, 'purpleHi');
  },
  ward(g) {
    g.rect(3, 2, 10, 7, 'blue'); g.rect(4, 9, 8, 2, 'blue'); g.rect(5, 11, 6, 1, 'blue'); g.rect(7, 12, 2, 2, 'blue');
    g.rect(3, 2, 10, 1, 'blueHi'); g.rect(3, 2, 1, 7, 'blueHi'); g.rect(12, 3, 1, 6, 'blueLo');
    g.rect(7, 4, 2, 6, 'white'); g.rect(5, 6, 6, 2, 'white');
  },
  stab(g) {
    g.line(4, 12, 12, 4, 'steel'); g.line(5, 12, 12, 5, 'steelLo'); g.px(13, 3, 'steelHi');
    g.line(2, 14, 5, 11, 'woodLo'); g.line(4, 9, 7, 12, 'gold');
  },
  fan(g) {
    for (const [x0, y0, x1, y1] of [[3, 13, 3, 3], [8, 14, 8, 2], [13, 13, 13, 3]]) {
      g.line(x0, y0, x1, y1, 'steel'); g.px(x1, y1 - 1, 'steelHi'); g.px(x0, y0 + 1, 'woodLo');
    }
    g.rect(2, 12, 12, 1, 'red');
  },
  smoke(g) {
    g.disc(5, 9, 3, 'gray'); g.disc(10, 8, 3, 'gray'); g.disc(8, 6, 3, 'steel'); g.disc(8, 11, 2, 'gray');
    g.px(7, 5, 'white'); g.px(9, 6, 'white'); g.px(10, 11, 'grayLo'); g.px(5, 11, 'grayLo');
  },
  potion(g) {
    g.rect(6, 2, 4, 2, 'wood'); g.rect(6, 4, 4, 2, 'steel');
    g.rect(4, 7, 8, 6, 'red'); g.rect(5, 6, 6, 1, 'red'); g.rect(5, 13, 6, 1, 'red');
    g.rect(5, 7, 1, 5, 'redHi'); g.rect(11, 8, 1, 5, 'redLo'); g.rect(7, 8, 2, 1, 'redHi');
  },
  // status glyphs
  heart(g) {
    g.rect(2, 3, 4, 4, 'red'); g.rect(9, 3, 4, 4, 'red'); g.rect(2, 5, 12, 3, 'red');
    g.rect(3, 8, 10, 1, 'red'); g.rect(4, 9, 8, 1, 'red'); g.rect(5, 10, 6, 1, 'red'); g.rect(6, 11, 4, 1, 'red'); g.rect(7, 12, 2, 1, 'red');
    g.px(3, 4, 'redHi'); g.px(4, 4, 'redHi'); g.px(3, 5, 'redHi'); g.rect(11, 8, 1, 1, 'redLo'); g.rect(9, 10, 1, 1, 'redLo');
  },
  mana(g) {
    g.px(8, 2, 'blue'); g.rect(7, 3, 2, 2, 'blue'); g.rect(6, 5, 4, 2, 'blue'); g.rect(5, 7, 6, 4, 'blue');
    g.rect(6, 11, 4, 2, 'blue'); g.px(6, 8, 'blueHi'); g.px(6, 9, 'blueHi'); g.px(7, 7, 'blueHi'); g.px(10, 10, 'blueLo'); g.px(9, 11, 'blueLo');
  },
  xp(g) {
    g.rect(7, 2, 2, 12, 'yellow'); g.rect(2, 7, 12, 2, 'yellow'); g.rect(5, 5, 6, 6, 'yellow');
    g.rect(7, 4, 2, 2, 'white'); g.px(6, 6, 'white'); g.px(10, 10, 'orange'); g.px(9, 11, 'orange');
  },
  coin(g) {
    g.disc(8, 8, 5, 'gold'); g.disc(8, 8, 3, 'yellow'); g.rect(7, 6, 2, 5, 'gold'); g.px(7, 5, 'gold'); g.px(8, 5, 'gold');
    g.px(5, 6, 'white'); g.px(5, 7, 'white'); g.px(11, 11, 'orange'); g.px(10, 12, 'orange');
  },
  sword(g) { ICONS.slash(g); },
  shield(g) { ICONS.ward(g); },
};

export const HUD_ABILITY_ICON = {
  slash: 'slash', flare: 'flare', dash: 'dash', camp: 'camp',
  shot: 'shot', volley: 'volley', snare: 'snare',
  bolt: 'bolt', burst: 'burst', blink: 'blink', ward: 'ward',
  stab: 'stab', fan: 'fan', smoke: 'smoke',
};

export function makeHudIcons(scene) {
  for (const [name, draw] of Object.entries(ICONS)) {
    const key = `hud.${name}`;
    if (scene.textures.exists(key)) continue;
    const g = new Grid(16);
    draw(g);
    g.outline();
    const tex = scene.textures.createCanvas(key, 16, 16);
    const ctx = tex.getContext();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = g.p[y * 16 + x];
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
    }
    tex.refresh();
    tex.setFilter(0); // NEAREST
  }
}
