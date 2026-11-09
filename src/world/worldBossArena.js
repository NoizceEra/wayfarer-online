import { CONFIG } from '../config.js';
import { hash2, vnoise } from './ground.js';

const T = CONFIG.tile;
const FONT = '"Silkscreen", monospace';
const THEMES = {
  meadow: { base: [82, 142, 64], edge: 0x365c32, ring: 0xd0ad62, accent: 0x7dde72, stone: 0x786c55 },
  woods: { base: [34, 72, 47], edge: 0x172f25, ring: 0x8aa05e, accent: 0x8ee66b, stone: 0x485846 },
  ruins: { base: [70, 82, 94], edge: 0x303844, ring: 0x78a8be, accent: 0x69d8ee, stone: 0x65717d },
};

const rgb = (c, d = 0) => `rgb(${Math.max(0, Math.min(255, c[0] + d)) | 0},${Math.max(0, Math.min(255, c[1] + d)) | 0},${Math.max(0, Math.min(255, c[2] + d)) | 0})`;

export function buildWorldBossArena(ctx) {
  const { scene, mgr, def, o, P, b, solid } = ctx;
  const theme = THEMES[def.arenaTheme] || THEMES.meadow;
  const W = def.size.w * T, H = def.size.h * T;
  const key = `worldboss.arena.${def.arenaTheme}`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, W, H);
    const c = tex.getContext();
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      const edge = Math.min(x, y, W - x, H - y);
      const shade = (vnoise(x / 70, y / 70, 81) - 0.5) * 20 - Math.max(0, 70 - edge) * 0.18;
      c.fillStyle = rgb(theme.base, shade); c.fillRect(x, y, 4, 4);
    }
    const cx = W / 2, cy = 16 * T;
    c.strokeStyle = `#${theme.ring.toString(16).padStart(6, '0')}`; c.lineWidth = 5; c.globalAlpha = 0.65;
    c.beginPath(); c.ellipse(cx, cy, 154, 104, 0, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2; c.globalAlpha = 0.45;
    c.beginPath(); c.ellipse(cx, cy, 116, 76, 0, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.18; c.fillStyle = '#ffffff';
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, r = 96 + (i % 3) * 19;
      c.beginPath(); c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.68, 2 + (i % 2), 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1; tex.refresh();
  }
  scene.add.image(o.x, o.y, key).setOrigin(0).setDepth(-10);

  const cx = o.x + def.bossSpot[0] * T, cy = o.y + def.bossSpot[1] * T;
  const deco = scene.add.graphics().setDepth(-1);
  deco.lineStyle(2, theme.accent, 0.35).strokeEllipse(cx, cy, 310, 210);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + hash2(i, 7, 92) * 0.12;
    const rx = 265 + (i % 3) * 34, ry = 170 + (i % 2) * 30;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    const r = 9 + (i % 4) * 2;
    deco.fillStyle(theme.stone, 0.95).fillCircle(x, y, r).fillCircle(x + 7, y - 4, Math.max(4, r - 4));
    solid(x, y, r * 1.35, r * 1.1);
  }

  // A visible return arch keeps the arena from becoming a one-way trap.
  const ex = { x: o.x + def.exit[0] * T, y: o.y + def.exit[1] * T };
  P.archway(ex.x, ex.y + 12, theme.accent, theme.stone);
  scene.add.text(ex.x, ex.y - 42, 'RETURN TO THISTLE TOWN', {
    fontFamily: FONT, fontSize: '8px', color: '#ffe9c4', backgroundColor: '#00000099',
  }).setOrigin(0.5).setDepth(2790);
  mgr.addTrigger({ area: def.id, x: ex.x, y: ex.y + 10, r: 13, onEnter: () => mgr.exit() });
  mgr.addInteract({ area: def.id, x: ex.x, y: ex.y, r: 34, label: 'Leave the boss arena', onUse: () => mgr.exit() });

  b.bossSpot = { x: cx, y: cy };
}

export const WORLD_BOSS_BUILDERS = { worldBossArena: buildWorldBossArena };
