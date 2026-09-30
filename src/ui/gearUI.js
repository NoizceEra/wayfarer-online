// Shared bits for the equipment + shop panels: fonts, item tooltip text,
// a floating tooltip, and small drawing helpers. Drawn rects only (no
// nine-slices) so everything renders identically on WebGL and ?renderer=canvas.
import { RARITY, SLOT_LABEL, STAT_KEYS, statLabel, gearById, sellPrice, dyeById } from '../data/gear.js';
import { iconKey } from '../systems/gearArt.js';

export const FONT = '"Silkscreen", monospace';
export const GOLD = '#f4c542';

export function label(scene, x, y, s, size = 10, color = '#e8e4cc', extra = {}) {
  return scene.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color, ...extra });
}

// Rect + 2px border (+ optional inner shade). Returns the Graphics so callers can restyle.
export function box(scene, x, y, w, h, fill = 0x10140f, alpha = 0.96, border = 0xc8a840, bw = 2) {
  const g = scene.add.graphics();
  g.fillStyle(fill, alpha).fillRect(x, y, w, h);
  if (bw) { g.lineStyle(bw, border, 1).strokeRect(x + bw / 2, y + bw / 2, w - bw, h - bw); }
  return g;
}

export function addIcon(scene, cont, item, dyeId, x, y, scale = 2) {
  const im = scene.add.image(x, y, iconKey(scene, item, dyeId)).setScale(scale);
  cont.add(im);
  return im;
}

// [{t, c, s}] text lines for an item. `eqId` = item worn in the same slot (for
// stat deltas), `player` = gates (level/class) shown red when unmet.
export function itemLines(item, dyeId, player, eqId) {
  const R = RARITY[item.rarity];
  const L = [{ t: item.name, c: R.color, s: 11, b: true }];
  L.push({ t: `${R.name} ${SLOT_LABEL[item.slot]}${item.kind ? ` · ${item.kind === 'melee' ? 'melee' : 'ranged'}` : ''}`, c: R.color, s: 8 });
  const lvBad = player && player.level < item.lvl;
  L.push({ t: `Requires Lv ${item.lvl}`, c: lvBad ? '#ff7a6a' : '#9fb0a0', s: 8 });
  if (item.cls) {
    const bad = player && !item.cls.includes(player.job.id);
    L.push({ t: `Class: ${item.cls.map((c) => c[0].toUpperCase() + c.slice(1)).join(', ')}`, c: bad ? '#ff7a6a' : '#9fb0a0', s: 8 });
  }
  const eq = eqId && eqId !== item.id ? gearById(eqId) : null;
  for (const k of STAT_KEYS) {
    const v = item.stats[k] || 0, e = eq ? eq.stats[k] || 0 : 0;
    if (!v && !(eq && e)) continue;
    const d = v - e;
    let t = v ? `${v > 0 ? '+' : ''}${v} ${statLabel(k)}` : `  0 ${statLabel(k)}`;
    if (eq && d) t += `  (${d > 0 ? '+' : ''}${d})`;
    L.push({ t, c: v ? (v > 0 ? '#9be88a' : '#ff8a7a') : '#7a8a7a', s: 9, d: eq ? d : 0 });
  }
  if (item.desc) L.push({ t: item.desc, c: '#b9b39a', s: 8, wrap: true });
  const dye = dyeId && dyeById(dyeId);
  if (dye) L.push({ t: `Dyed ${dye.name}`, c: '#e0b8ff', s: 8 });
  else if (item.dyeable === false) L.push({ t: 'Cannot be dyed', c: '#7a7a7a', s: 7 });
  L.push({ t: `Sells for ${sellPrice(item)}g`, c: GOLD, s: 8 });
  return L;
}

// Floating tooltip (scene-level so it is never clipped or scaled by a panel).
export class Tip {
  constructor(scene) {
    this.scene = scene;
    this.c = scene.add.container(0, 0).setDepth(600).setVisible(false);
    this.kids = [];
  }
  show(lines, sx, sy) {
    this.clear();
    const sc = this.scene;
    const pad = 6, maxW = 190;
    let y = pad, w = 0;
    for (const l of lines) {
      const t = label(sc, pad, y, l.t, l.s || 9, l.c, { wordWrap: { width: maxW }, fontStyle: l.b ? 'bold' : 'normal' });
      this.kids.push(t); this.c.add(t);
      y += t.height + 2; w = Math.max(w, t.width);
    }
    const bw = w + pad * 2, bh = y + pad - 2;
    const bg = box(sc, 0, 0, bw, bh, 0x0c100a, 0.97, 0xc8a840, 2);
    this.c.addAt(bg, 0); this.kids.push(bg);
    const W = sc.scale.width, H = sc.scale.height;
    let x = sx + 14, yy = sy + 10;
    if (x + bw > W - 4) x = sx - bw - 10;
    if (yy + bh > H - 4) yy = H - bh - 4;
    this.c.setPosition(Math.max(4, x), Math.max(4, yy)).setVisible(true);
  }
  clear() { this.kids.forEach((k) => k.destroy()); this.kids = []; }
  hide() { this.c.setVisible(false); this.clear(); }
  destroy() { this.clear(); this.c.destroy(); }
}
