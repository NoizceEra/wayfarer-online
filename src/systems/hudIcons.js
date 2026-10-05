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
  // Solana theme palette — used ONLY by the combat-readability status /
  // feedback glyphs added below, so they match ui/hudPolish.js POLISH_PALETTE.
  solGreen: '#14F195', solPurple: '#9945FF', solCyan: '#03E1FF', solMagenta: '#DC1FFF',
  solWhite: '#E1E8F0', solMuted: '#6B7A99', solBg: '#0A0E1A',
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

  // — advanced class skills (same flat fills + auto outline as above) —
  bash(g) { // shield hitting with an impact star
    g.disc(6, 9, 5, 'steel'); g.disc(6, 9, 3, 'steelLo'); g.disc(6, 9, 1, 'gold'); g.px(6, 9, 'yellow'); g.px(3, 6, 'steelHi'); g.px(4, 5, 'steelHi'); g.px(5, 5, 'steelHi');
    g.line(11, 9, 15, 9, 'yellow'); g.line(11, 6, 15, 2, 'orange'); g.line(11, 12, 15, 15, 'orange'); g.line(11, 7, 14, 5, 'yellow'); g.line(11, 11, 14, 13, 'yellow'); g.px(15, 9, 'white'); g.px(15, 2, 'yellow'); g.px(14, 15, 'yellow');
  },
  bulwark(g) { // tall golden-trimmed shield with a glow
    g.rect(4, 1, 8, 9, 'gold'); g.rect(5, 10, 6, 2, 'gold'); g.rect(6, 12, 4, 2, 'gold'); g.rect(7, 14, 2, 1, 'gold');
    g.rect(5, 2, 6, 8, 'blue'); g.rect(6, 10, 4, 2, 'blue'); g.rect(7, 12, 2, 1, 'blue');
    g.rect(5, 2, 6, 1, 'blueHi'); g.rect(5, 2, 1, 7, 'blueHi'); g.rect(10, 3, 1, 7, 'blueLo');
    g.rect(7, 4, 2, 6, 'yellow'); g.rect(6, 6, 4, 2, 'yellow'); g.px(7, 4, 'white'); g.px(2, 4, 'yellow'); g.px(13, 4, 'yellow'); g.px(2, 9, 'orange'); g.px(13, 9, 'orange');
  },
  beacon(g) { // lantern with a rising beam
    g.rect(7, 0, 2, 7, 'yellow'); g.px(7, 0, 'white'); g.px(8, 1, 'white'); g.px(5, 2, 'yellow'); g.px(10, 2, 'yellow'); g.px(4, 4, 'orange'); g.px(11, 4, 'orange');
    g.rect(5, 7, 6, 5, 'gold'); g.rect(6, 8, 4, 3, 'yellow'); g.px(7, 9, 'white'); g.px(8, 9, 'white');
    g.rect(4, 7, 8, 1, 'woodLo'); g.rect(4, 12, 8, 1, 'woodLo'); g.rect(5, 13, 6, 1, 'wood'); g.px(7, 6, 'steel'); g.px(8, 6, 'steel');
  },
  sunburst(g) { // big sun, long rays
    g.disc(8, 8, 3, 'orange'); g.disc(8, 8, 2, 'yellow'); g.px(8, 8, 'white'); g.px(7, 7, 'white');
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * Math.PI * 2, long = a % 3 === 0;
      g.px(8 + Math.cos(t) * 5.5, 8 + Math.sin(t) * 5.5, long ? 'yellow' : 'orange');
      if (long) g.px(8 + Math.cos(t) * 7, 8 + Math.sin(t) * 7, 'gold');
    }
  },
  pierce(g) { // one heavy arrow through a ring
    for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; g.px(9 + Math.cos(t) * 4.5, 8 + Math.sin(t) * 4.5, 'red'); }
    g.px(9, 8, 'redHi');
    g.line(1, 8, 13, 8, 'wood'); g.line(1, 7, 13, 7, 'woodLo');
    g.rect(13, 6, 2, 4, 'steel'); g.px(15, 7, 'steelHi'); g.px(15, 8, 'steelHi'); g.px(12, 5, 'steel'); g.px(12, 10, 'steel');
    g.rect(1, 5, 2, 1, 'green'); g.rect(1, 10, 2, 1, 'green'); g.rect(2, 6, 1, 1, 'greenHi'); g.rect(2, 9, 1, 1, 'greenHi');
  },
  arrowrain(g) { // three arrows falling from a cloud
    g.disc(5, 3, 2, 'gray'); g.disc(9, 3, 2, 'steel'); g.disc(12, 4, 1, 'gray'); g.rect(3, 4, 11, 1, 'gray');
    for (const x of [4, 8, 12]) { g.line(x, 6, x, 12, 'wood'); g.px(x, 13, 'steel'); g.px(x, 14, 'steelHi'); g.px(x - 1, 6, 'green'); g.px(x + 1, 6, 'green'); }
    g.px(6, 11, 'steelLo'); g.px(10, 9, 'steelLo');
  },
  thornwall(g) { // row of thorns out of the ground
    g.rect(1, 12, 14, 3, 'woodLo'); g.rect(1, 12, 14, 1, 'wood');
    for (const [x, h] of [[2, 6], [5, 9], [8, 11], [11, 8], [14, 5]]) { g.line(x, 12, x, 12 - h + 1, 'green'); g.px(x, 12 - h, 'greenHi'); g.px(x - 1, 12 - h + 2, 'greenLo'); g.px(x + 1, 12 - h + 4, 'greenLo'); }
    g.px(8, 2, 'greenHi');
  },
  wildmend(g) { // leaf with a heart-cross
    g.disc(8, 8, 5, 'green'); g.disc(7, 7, 3, 'greenHi'); g.line(2, 14, 13, 3, 'greenLo');
    g.rect(9, 8, 4, 1, 'white'); g.rect(10, 7, 2, 3, 'white'); g.px(4, 10, 'greenLo'); g.px(5, 11, 'greenLo'); g.px(12, 12, 'greenLo');
  },
  meteor(g) { // fireball with a streaking tail
    g.line(1, 2, 8, 9, 'redLo'); g.line(2, 1, 9, 8, 'red'); g.line(1, 5, 6, 10, 'orange'); g.line(4, 1, 9, 6, 'orange');
    g.disc(10, 10, 4, 'orange'); g.disc(10, 10, 3, 'yellow'); g.disc(10, 10, 1, 'white'); g.px(14, 14, 'red'); g.px(14, 6, 'orange'); g.px(6, 14, 'orange');
  },
  chain(g) { // chained lightning bolts
    g.line(9, 1, 5, 6, 'yellow'); g.line(5, 6, 10, 7, 'yellow'); g.line(10, 7, 6, 14, 'yellow'); g.line(10, 1, 6, 6, 'orange'); g.line(11, 7, 7, 14, 'orange');
    g.px(9, 1, 'white'); g.px(5, 6, 'white'); g.px(10, 7, 'white');
    g.disc(3, 13, 1, 'red'); g.disc(13, 3, 1, 'red'); g.px(3, 13, 'redHi'); g.px(13, 3, 'redHi'); g.px(2, 12, 'orange'); g.px(14, 4, 'orange');
  },
  tidal(g) { // breaking wave
    g.rect(1, 11, 14, 3, 'blueLo'); g.rect(1, 11, 14, 1, 'blue');
    g.rect(2, 8, 4, 3, 'blue'); g.rect(4, 5, 4, 3, 'blue'); g.rect(6, 3, 5, 3, 'blue'); g.rect(10, 3, 3, 2, 'blue'); g.rect(11, 5, 2, 2, 'blue');
    g.rect(6, 3, 5, 1, 'blueHi'); g.rect(4, 5, 2, 1, 'blueHi'); g.px(12, 3, 'white'); g.px(13, 4, 'white'); g.px(10, 6, 'white'); g.px(8, 8, 'blueHi'); g.px(3, 9, 'blueHi'); g.px(13, 7, 'blueHi');
  },
  mist(g) { // pale cloud with healing droplets
    g.disc(5, 6, 3, 'blueHi'); g.disc(9, 5, 3, 'white'); g.disc(12, 7, 2, 'blueHi'); g.rect(3, 7, 11, 2, 'blueHi'); g.rect(4, 6, 9, 1, 'white');
    g.px(5, 11, 'blue'); g.px(5, 12, 'blueHi'); g.px(9, 12, 'blue'); g.px(9, 13, 'blueHi'); g.px(12, 11, 'blue');
    g.rect(7, 10, 1, 3, 'green'); g.rect(6, 11, 3, 1, 'green'); g.px(14, 3, 'white');
  },
  shadowstep(g) { // fading silhouettes with a blade
    g.rect(1, 4, 3, 8, 'purpleHi'); g.rect(5, 4, 3, 8, 'purple'); g.rect(9, 4, 3, 8, 'grayLo');
    g.rect(10, 2, 2, 2, 'grayLo'); g.rect(6, 2, 2, 2, 'purple'); g.rect(2, 2, 2, 2, 'purpleHi');
    g.line(11, 13, 15, 8, 'steel'); g.px(15, 7, 'steelHi'); g.px(10, 14, 'woodLo'); g.px(12, 13, 'steelLo');
  },
  fangdance(g) { // two crossed curved fangs in a circle of motion
    for (let a = 0; a < 14; a++) { const t = (a / 14) * Math.PI * 2; g.px(8 + Math.cos(t) * 6, 8 + Math.sin(t) * 6, a % 2 ? 'steelLo' : 'steel'); }
    g.line(3, 12, 12, 3, 'steel'); g.line(4, 12, 13, 4, 'steelLo'); g.line(3, 4, 12, 13, 'redHi'); g.line(4, 3, 13, 12, 'red');
    g.px(8, 8, 'white'); g.px(3, 12, 'steelHi'); g.px(12, 13, 'redHi');
  },
  caltrops(g) { // jacks on the ground
    for (const [cx, cy] of [[4, 5], [11, 6], [7, 11]]) {
      g.line(cx, cy - 3, cx, cy + 3, 'steel'); g.line(cx - 3, cy, cx + 3, cy, 'steel'); g.px(cx, cy, 'steelHi'); g.px(cx - 2, cy - 2, 'steelLo'); g.px(cx + 2, cy + 2, 'steelLo');
      g.px(cx, cy - 3, 'steelHi'); g.px(cx, cy + 3, 'red');
    }
  },
  feint(g) { // double chevron buff over a twin-blade glint
    g.line(3, 7, 8, 2, 'yellow'); g.line(8, 2, 13, 7, 'yellow'); g.line(3, 11, 8, 6, 'orange'); g.line(8, 6, 13, 11, 'orange');
    g.line(3, 8, 8, 3, 'gold'); g.line(8, 3, 13, 8, 'gold'); g.line(3, 12, 8, 7, 'red'); g.line(8, 7, 13, 12, 'red');
    g.px(8, 2, 'white'); g.px(8, 6, 'white'); g.rect(2, 14, 12, 1, 'purple'); g.px(5, 14, 'purpleHi'); g.px(10, 14, 'purpleHi');
  },
  // Wave 2 expanded abilities
  whirlwind(g) { // swirling dual curved wind arcs with center spark
    g.line(4, 3, 8, 2, 'steelHi'); g.line(8, 2, 12, 3, 'white'); g.line(12, 3, 13, 6, 'blueHi'); g.line(13, 6, 11, 8, 'blue'); g.line(11, 8, 9, 8, 'blueHi');
    g.line(5, 4, 8, 3, 'blue'); g.line(8, 3, 11, 4, 'blueHi'); g.line(11, 4, 12, 6, 'steelLo');
    g.line(11, 12, 7, 13, 'steelHi'); g.line(7, 13, 3, 12, 'white'); g.line(3, 12, 2, 9, 'blueHi'); g.line(2, 9, 4, 7, 'blue'); g.line(4, 7, 6, 7, 'blueHi');
    g.line(10, 11, 7, 12, 'blue'); g.line(7, 12, 4, 11, 'blueHi'); g.line(4, 11, 3, 9, 'steelLo');
    g.disc(7, 8, 1, 'yellow'); g.px(7, 8, 'white'); g.px(8, 7, 'white');
    g.px(6, 8, 'white'); g.px(9, 7, 'white'); g.px(7, 6, 'yellow'); g.px(8, 9, 'yellow');
    g.px(2, 5, 'steelHi'); g.px(13, 10, 'steelHi'); g.px(13, 2, 'blueHi'); g.px(2, 13, 'blueHi');
  },
  earthshatter(g) { // jagged cracked ground fissure with rising brown rock spikes
    g.rect(1, 13, 14, 2, 'woodLo'); g.line(2, 12, 13, 12, 'wood');
    g.line(3, 12, 5, 14, 'orange'); g.line(5, 14, 8, 13, 'yellow'); g.line(8, 13, 10, 14, 'white'); g.line(10, 14, 13, 12, 'orange'); g.px(9, 13, 'gold');
    g.line(6, 12, 8, 2, 'wood'); g.line(8, 2, 10, 12, 'woodLo'); g.line(7, 4, 8, 12, 'steelHi'); g.line(8, 3, 9, 11, 'gold'); g.px(8, 2, 'steelHi');
    g.line(2, 12, 3, 5, 'woodLo'); g.line(3, 5, 5, 12, 'wood'); g.line(3, 6, 4, 11, 'gold'); g.px(3, 5, 'steel');
    g.line(10, 12, 12, 6, 'wood'); g.line(12, 6, 14, 12, 'woodLo'); g.line(12, 7, 13, 11, 'gold'); g.px(12, 6, 'steel');
    g.line(5, 8, 6, 11, 'wood'); g.px(5, 7, 'steelHi');
    g.line(10, 8, 11, 11, 'woodLo'); g.px(10, 7, 'steelHi');
    g.px(4, 3, 'orange'); g.px(12, 4, 'yellow'); g.px(7, 1, 'yellow');
  },
  arcanebeam(g) { // vertical prismatic beam with celestial diamond star
    g.rect(6, 1, 4, 14, 'purple'); g.rect(7, 1, 2, 14, 'blueHi'); g.line(7, 1, 7, 14, 'white'); g.line(8, 1, 8, 14, 'purpleHi');
    g.line(5, 3, 5, 12, 'blue'); g.line(10, 3, 10, 12, 'purpleHi'); g.line(4, 6, 4, 9, 'blueLo'); g.line(11, 6, 11, 9, 'purple');
    g.disc(7, 7, 2, 'yellow'); g.rect(6, 6, 4, 4, 'white');
    g.line(7, 2, 7, 5, 'white'); g.line(8, 2, 8, 5, 'white'); g.px(7, 1, 'yellow'); g.px(8, 1, 'yellow');
    g.line(7, 10, 7, 13, 'white'); g.line(8, 10, 8, 13, 'white'); g.px(7, 14, 'yellow'); g.px(8, 14, 'yellow');
    g.line(2, 7, 5, 7, 'white'); g.line(2, 8, 5, 8, 'white'); g.px(1, 7, 'yellow'); g.px(1, 8, 'yellow');
    g.line(10, 7, 13, 7, 'white'); g.line(10, 8, 13, 8, 'white'); g.px(14, 7, 'yellow'); g.px(14, 8, 'yellow');
    g.px(5, 5, 'yellow'); g.px(10, 5, 'yellow'); g.px(5, 10, 'yellow'); g.px(10, 10, 'yellow');
    g.px(7, 7, 'white'); g.px(8, 8, 'white');
    g.px(3, 4, 'purpleHi'); g.px(12, 4, 'blueHi'); g.px(3, 11, 'blueHi'); g.px(12, 11, 'purpleHi');
  },
  voidcleave(g) { // dark shadow crescent cutting through purple void aura
    g.disc(8, 8, 5, 'purple'); g.disc(8, 8, 3, 'purpleHi');
    g.px(3, 3, 'purple'); g.px(4, 2, 'purpleHi'); g.px(12, 12, 'purple'); g.px(13, 13, 'purpleHi');
    g.px(13, 4, 'purple'); g.px(2, 11, 'purple');
    g.line(13, 2, 9, 5, 'white'); g.line(9, 5, 5, 9, 'white'); g.line(5, 9, 2, 13, 'white');
    g.line(12, 3, 9, 6, 'steelLo'); g.line(9, 6, 6, 9, 'steelLo'); g.line(6, 9, 3, 12, 'steelLo');
    g.line(11, 4, 8, 7, 'grayLo'); g.line(8, 7, 7, 8, 'grayLo'); g.line(7, 8, 4, 11, 'grayLo');
    g.line(10, 5, 8, 8, 'outline'); g.line(8, 8, 5, 10, 'outline'); g.px(7, 7, 'outline');
    g.px(14, 1, 'purpleHi'); g.px(1, 14, 'purpleHi'); g.px(5, 4, 'blueHi'); g.px(11, 10, 'blueHi');
    g.px(7, 3, 'white'); g.px(3, 8, 'white');
  },
  healingbloom(g) { // opening radiant lotus flower with green sepals and white core
    g.line(4, 13, 11, 13, 'greenLo'); g.line(3, 12, 12, 12, 'green'); g.line(5, 14, 10, 14, 'greenLo');
    g.px(2, 10, 'greenHi'); g.px(2, 11, 'green'); g.px(13, 10, 'greenHi'); g.px(13, 11, 'green');
    g.line(3, 9, 2, 5, 'purpleHi'); g.line(2, 5, 4, 4, 'white'); g.line(4, 4, 6, 8, 'purpleHi'); g.px(3, 6, 'redHi');
    g.line(12, 9, 13, 5, 'purpleHi'); g.line(13, 5, 11, 4, 'white'); g.line(11, 4, 9, 8, 'purpleHi'); g.px(12, 6, 'redHi');
    g.line(6, 8, 8, 2, 'white'); g.line(8, 2, 9, 8, 'white'); g.px(8, 2, 'yellow'); g.px(8, 1, 'white');
    g.disc(7, 8, 2, 'white'); g.disc(8, 8, 2, 'white');
    g.px(7, 8, 'yellow'); g.px(8, 8, 'yellow'); g.px(7, 7, 'yellow'); g.px(8, 7, 'yellow');
    g.px(4, 2, 'greenHi'); g.px(11, 2, 'greenHi'); g.px(1, 7, 'yellow'); g.px(14, 7, 'yellow');
    g.px(7, 4, 'white'); g.px(8, 4, 'white');
  },
  thunderlance(g) { // charged electric spear surrounded by lightning rings
    g.line(2, 13, 7, 8, 'gold'); g.line(3, 14, 8, 9, 'woodLo'); g.px(1, 14, 'steel');
    g.line(7, 8, 13, 2, 'steelHi'); g.line(8, 7, 14, 1, 'white'); g.line(8, 9, 14, 3, 'steel'); g.line(6, 8, 12, 2, 'steelLo');
    g.px(13, 1, 'white');
    g.line(2, 10, 5, 13, 'yellow'); g.line(3, 9, 6, 12, 'blueHi'); g.px(4, 10, 'white');
    g.line(6, 5, 9, 8, 'yellow'); g.line(7, 4, 10, 7, 'blueHi'); g.px(8, 6, 'white');
    g.line(9, 2, 12, 5, 'yellow'); g.line(10, 1, 13, 4, 'blueHi'); g.px(11, 3, 'white');
    g.px(5, 3, 'blueHi'); g.px(6, 2, 'yellow'); g.px(12, 8, 'blueHi'); g.px(13, 9, 'yellow');
    g.px(3, 6, 'yellow'); g.px(11, 12, 'blueHi'); g.px(14, 5, 'yellow'); g.px(8, 12, 'white');
  },
  frostnova(g) { // hexagonal ice crystal surrounded by frost shards
    g.line(8, 4, 12, 6, 'blueHi'); g.line(12, 6, 12, 10, 'blue'); g.line(12, 10, 8, 12, 'blueLo');
    g.line(8, 12, 4, 10, 'blueLo'); g.line(4, 10, 4, 6, 'blue'); g.line(4, 6, 8, 4, 'blueHi');
    g.disc(8, 8, 2, 'blue'); g.line(8, 4, 8, 12, 'steelHi'); g.line(4, 6, 12, 10, 'blueHi'); g.line(4, 10, 12, 6, 'blueHi');
    g.disc(8, 8, 1, 'white'); g.px(8, 8, 'white');
    g.line(8, 1, 8, 2, 'blueHi'); g.px(8, 1, 'white');
    g.line(8, 13, 8, 14, 'blueLo'); g.px(8, 13, 'blueHi');
    g.line(2, 3, 3, 4, 'blueHi'); g.px(2, 3, 'white');
    g.line(13, 3, 14, 4, 'blueHi'); g.px(14, 3, 'white');
    g.line(2, 12, 3, 11, 'blueLo'); g.px(2, 12, 'blueHi');
    g.line(13, 12, 14, 11, 'blueLo'); g.px(13, 12, 'blueHi');
    g.px(1, 8, 'blueHi'); g.px(14, 8, 'blueHi'); g.px(7, 7, 'white'); g.px(9, 9, 'white');
  },

  // — status / combat-feedback glyphs (Solana palette; driven by the existing
  //   StatusSet in systems/status.js + player.invulnUntil / player.buff) —
  burn(g) { // magenta flame (STATUS.burn)
    g.rect(7, 1, 2, 2, 'solMagenta'); g.rect(6, 2, 4, 2, 'solMagenta');
    g.rect(5, 3, 6, 3, 'solMagenta'); g.rect(4, 6, 8, 4, 'solMagenta');
    g.rect(5, 10, 6, 3, 'solMagenta'); g.rect(6, 12, 4, 2, 'solMagenta'); g.rect(7, 14, 2, 1, 'solMagenta');
    g.rect(7, 4, 2, 3, 'solWhite'); g.rect(6, 7, 4, 4, 'solWhite'); g.rect(7, 11, 2, 3, 'solWhite');
    g.px(5, 8, 'solWhite'); g.px(10, 8, 'solWhite');
  },
  slow(g) { // cyan snowflake (STATUS.slow)
    g.line(8, 2, 8, 13, 'solCyan'); g.line(2, 8, 13, 8, 'solCyan');
    g.line(4, 4, 12, 12, 'solCyan'); g.line(12, 4, 4, 12, 'solCyan');
    g.px(8, 2, 'solWhite'); g.px(2, 8, 'solWhite'); g.px(4, 4, 'solWhite'); g.px(12, 4, 'solWhite');
    g.px(8, 4, 'solWhite'); g.px(8, 12, 'solWhite'); g.px(4, 8, 'solWhite'); g.px(12, 8, 'solWhite');
    g.disc(8, 8, 1, 'solWhite');
  },
  stun(g) { // green impact starburst (STATUS.stun)
    g.disc(8, 8, 3, 'solGreen'); g.disc(8, 8, 1, 'solWhite');
    for (const [x, y] of [[8, 1], [8, 14], [1, 8], [14, 8], [3, 3], [13, 3], [3, 13], [13, 13]]) g.px(x, y, 'solGreen');
    g.px(8, 3, 'solGreen'); g.px(8, 12, 'solGreen'); g.px(3, 8, 'solGreen'); g.px(12, 8, 'solGreen');
    g.px(8, 2, 'solWhite'); g.px(8, 13, 'solWhite'); g.px(2, 8, 'solWhite'); g.px(13, 8, 'solWhite');
    g.px(4, 4, 'solWhite'); g.px(12, 4, 'solWhite'); g.px(4, 12, 'solWhite'); g.px(12, 12, 'solWhite');
  },
  poison(g) { // green bubbling flask (STATUS.poison)
    g.rect(6, 1, 4, 3, 'solGreen'); g.rect(7, 4, 2, 3, 'solGreen');
    g.rect(4, 7, 8, 5, 'solGreen'); g.rect(5, 12, 6, 2, 'solGreen'); g.rect(6, 14, 4, 1, 'solGreen');
    g.px(6, 8, 'solWhite'); g.px(7, 10, 'solWhite'); g.px(10, 9, 'solWhite'); g.px(9, 12, 'solWhite');
    g.px(2, 4, 'solGreen'); g.px(13, 4, 'solGreen'); g.px(3, 3, 'solWhite'); g.px(12, 3, 'solWhite');
  },
  bleed(g) { // magenta droplets (STATUS.bleed)
    g.px(6, 2, 'solMagenta'); g.rect(5, 3, 3, 2, 'solMagenta'); g.rect(4, 5, 5, 4, 'solMagenta'); g.rect(5, 9, 3, 2, 'solMagenta');
    g.px(5, 6, 'solWhite');
    g.px(11, 7, 'solMagenta'); g.rect(10, 8, 3, 3, 'solMagenta'); g.px(11, 11, 'solMagenta');
    g.px(10, 9, 'solWhite');
  },
  shieldUp(g) { // purple shield — Ward / invulnerability buff
    g.rect(3, 2, 10, 7, 'solPurple'); g.rect(4, 9, 8, 2, 'solPurple'); g.rect(5, 11, 6, 2, 'solPurple'); g.rect(7, 13, 2, 1, 'solPurple');
    g.rect(4, 3, 8, 1, 'solWhite'); g.rect(4, 3, 1, 5, 'solWhite');
    g.rect(7, 5, 2, 5, 'solWhite'); g.rect(5, 7, 6, 2, 'solWhite');
  },
  boost(g) { // green double up-chevron — active buff / empower
    g.line(3, 8, 8, 3, 'solGreen'); g.line(8, 3, 13, 8, 'solGreen');
    g.line(3, 13, 8, 8, 'solGreen'); g.line(8, 8, 13, 13, 'solGreen');
    g.px(8, 3, 'solWhite'); g.px(8, 8, 'solWhite'); g.px(4, 7, 'solWhite'); g.px(12, 7, 'solWhite');
  },
  noMp(g) { // cyan mana droplet slashed by magenta — "not enough MP" affordance
    g.px(8, 2, 'solCyan'); g.rect(7, 3, 2, 2, 'solCyan'); g.rect(6, 5, 4, 2, 'solCyan');
    g.rect(5, 7, 6, 5, 'solCyan'); g.rect(6, 12, 4, 2, 'solCyan');
    g.rect(6, 8, 1, 3, 'solWhite'); g.px(7, 7, 'solWhite');
    g.line(2, 13, 13, 2, 'solMagenta'); g.line(3, 13, 13, 3, 'solMagenta');
    g.px(2, 13, 'solWhite'); g.px(13, 2, 'solWhite');
  },
  ready(g) { // green double chevron — skill came off cooldown / ready flash
    g.line(3, 3, 8, 8, 'solGreen'); g.line(8, 8, 3, 13, 'solGreen');
    g.line(7, 3, 12, 8, 'solGreen'); g.line(12, 8, 7, 13, 'solGreen');
    g.px(3, 3, 'solWhite'); g.px(3, 13, 'solWhite'); g.px(7, 3, 'solWhite'); g.px(7, 13, 'solWhite'); g.px(8, 8, 'solWhite');
  },
};

export const HUD_ABILITY_ICON = {
  slash: 'slash', flare: 'flare', dash: 'dash', camp: 'camp',
  shot: 'shot', volley: 'volley', snare: 'snare',
  bolt: 'bolt', burst: 'burst', blink: 'blink', ward: 'ward',
  stab: 'stab', fan: 'fan', smoke: 'smoke',
  // advanced classes (jobs.js ADVANCED) — every skill has its own icon
  bash: 'bash', bulwark: 'bulwark', beacon: 'beacon', sunburst: 'sunburst',
  pierce: 'pierce', arrowrain: 'arrowrain', thornwall: 'thornwall', wildmend: 'wildmend',
  meteor: 'meteor', chain: 'chain', tidal: 'tidal', mist: 'mist',
  shadowstep: 'shadowstep', fangdance: 'fangdance', caltrops: 'caltrops', feint: 'feint',
  // Wave 2 expanded abilities
  whirlwind: 'whirlwind', earthshatter: 'earthshatter', arcanebeam: 'arcanebeam',
  voidcleave: 'voidcleave', healingbloom: 'healingbloom', thunderlance: 'thunderlance',
  frostnova: 'frostnova',
};
// texture key for an ability id (null when unknown)
export const hudIconKey = (id) => (HUD_ABILITY_ICON[id] ? `hud.${HUD_ABILITY_ICON[id]}` : null);

// Status-effect id -> icon name. Ids match STATUS in data/combatMath.js plus
// the two player-buff sources (`shield` = Ward / invulnUntil, `buff` = empower).
// The `hud.<name>` textures are built by makeHudIcons() like every other icon.
export const HUD_STATUS_ICON = {
  poison: 'poison', burn: 'burn', bleed: 'bleed', slow: 'slow', stun: 'stun',
  shield: 'shieldUp', buff: 'boost',
};
export const hudStatusIconKey = (id) => (HUD_STATUS_ICON[id] ? `hud.${HUD_STATUS_ICON[id]}` : null);

// Non-status combat-feedback glyphs (skill-bar affordances).
export const HUD_FEEDBACK_ICON = { noMp: 'noMp', ready: 'ready' };
export const hudFeedbackIconKey = (name) => (HUD_FEEDBACK_ICON[name] ? `hud.${HUD_FEEDBACK_ICON[name]}` : null);

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
