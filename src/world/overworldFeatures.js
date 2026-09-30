import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { DOORS, PORTALS, SIGNS, WAYSTONES, AREAS } from '../data/zones.js';
import { makeProps } from './propsExtra.js';
import { installTownfolk } from './townfolk.js';

const T = CONFIG.tile;
const FONT = '"Silkscreen", monospace';

// Keep scatter trees/rocks off the footprint of gates, signs and the waystone.
export function overworldClearings(spawn) {
  const out = [];
  const ws = WAYSTONES.find((w) => !w.area);
  out.push({ x: spawn.x + ws.offset.x, y: spawn.y + ws.offset.y, r: 52 });
  for (const p of PORTALS) out.push({ x: p.tile.x * T + 8, y: p.tile.y * T + 8, r: 44 });
  for (const s of SIGNS) out.push({ x: s.tx * T + 8, y: s.ty * T + 8, r: 22 });
  return out;
}

// Doors on the plaza houses, map gates, signposts, town waystone, wandering villagers.
export function buildOverworldFeatures(scene, areas, info) {
  const { spawn, houses, solids } = info;
  const P = makeProps(scene, solids);
  const txt = (x, y, s, color = '#fff', size = '8px') =>
    scene.add.text(x, y, s, { fontFamily: FONT, fontSize: size, color, backgroundColor: '#00000088' }).setOrigin(0.5).setDepth(2790);

  // — enterable houses —
  for (const d of DOORS) {
    const h = houses[d.house];
    if (!h) continue;
    const { x, y } = h;
    const g = scene.add.graphics().setDepth(y + 1);
    g.fillStyle(0x24160a, 1).fillRect(x - 7, y - 4, 14, 16);
    g.fillStyle(0x6d3f10, 1).fillRect(x - 6, y - 3, 12, 15);
    g.fillStyle(0x8d5a2b, 1).fillRect(x - 6, y - 3, 5, 15);
    g.fillStyle(0xf4c542, 1).fillRect(x + 3, y + 5, 2, 2);
    g.fillStyle(0x24160a, 1).fillRect(x - 1, y - 3, 1, 15);
    P.doorMat(x, y + 15);
    const isInn = d.area === 'inn';
    txt(x, y - 42, d.label, isInn ? '#ffd27a' : '#ffe8a0');
    if (isInn) { // hanging lantern sign
      const sg = scene.add.graphics().setDepth(y + 2);
      sg.fillStyle(0x3d2712, 1).fillRect(x + 20, y - 12, 12, 2).fillRect(x + 31, y - 12, 2, 12);
      sg.fillStyle(0x8d5a2b, 1).fillRect(x + 20, y - 4, 13, 9);
      sg.fillStyle(0xf7dc6f, 1).fillCircle(x + 26, y + 0, 3);
      P.glow(x + 26, y, 0.7, 0.4, 0xffc070);
    }
    areas.returnPos[d.area] = { x, y: y + 24 };
    areas.addTrigger({ area: null, x, y: y + 17, r: 10, onEnter: () => areas.enter(d.area) });
    areas.addInteract({ area: null, x, y: y + 16, r: 30, label: `Enter ${d.label}`, onUse: () => areas.enter(d.area) });
  }

  // — gates to the big maps —
  for (const p of PORTALS) {
    const x = p.tile.x * T + 8, y = p.tile.y * T + 8;
    const def = AREAS[p.area];
    const deco = scene.add.graphics().setDepth(0);
    if (p.area === 'frost') { deco.fillStyle(0xf4fbff, 0.85); for (let i = 0; i < 16; i++) deco.fillEllipse(x + Math.cos(i * 2.4) * (20 + (i % 5) * 7), y + 6 + Math.sin(i * 1.7) * (10 + (i % 4) * 4), 14, 6); }
    if (p.area === 'dock') { deco.fillStyle(0xe3cf8f, 0.9); for (let i = 0; i < 14; i++) deco.fillEllipse(x + Math.cos(i * 2.1) * (18 + (i % 5) * 6), y + 6 + Math.sin(i * 1.3) * (8 + (i % 4) * 4), 14, 6); }
    if (p.area === 'crypt') { deco.fillStyle(0x3a3645, 0.9); deco.fillEllipse(x, y + 4, 52, 16); deco.fillStyle(0x15131a, 1).fillEllipse(x, y + 2, 28, 9); }
    P.archway(x, y, p.color, p.area === 'crypt' ? 0x4a4658 : 0x7d8791);
    txt(x, y - 52, p.label, '#ffffff');
    txt(x, y - 43, `Lv ${def.lv[0]}-${def.lv[1]}`, def.lv[0] > 8 ? '#ff9a7a' : '#a8ff9a', '7px');
    areas.returnPos[p.area] = { x, y: y + 30 };
    areas.addTrigger({ area: null, x, y: y - 6, r: 14, onEnter: () => areas.tryEnter(p.area) });
    areas.addInteract({ area: null, x, y: y - 4, r: 36, label: `Enter ${def.name}`, onUse: () => areas.tryEnter(p.area) });
  }

  // — signposts —
  for (const s of SIGNS) {
    const x = s.tx * T + 8, y = s.ty * T + 8;
    P.signpost(x, y, s.planks);
    const arrow = { n: '^', e: '>', s: 'v', w: '<' };
    const lines = s.planks.map((p) => `${arrow[p.dir]} ${p.text}  (${p.lv})`);
    const t = txt(x, y - 52, lines.join('\n'), '#ffe8a0', '7px').setAlign('center').setLineSpacing(3);
    areas.addProximity({ area: null, x, y, r: 64, obj: t });
    areas.addInteract({
      area: null, x, y, r: 30, label: 'Read signpost',
      onUse: () => areas.say('Signpost', lines.join('\n')),
    });
  }

  // — town waystone —
  const ws = WAYSTONES.find((w) => !w.area);
  const wx = spawn.x + ws.offset.x, wy = spawn.y + ws.offset.y;
  P.waystone(wx, wy);
  txt(wx, wy - 52, 'Waystone', '#9fe8ff', '7px');
  areas.addInteract({ area: null, x: wx, y: wy, r: 36, label: 'Touch waystone', onUse: () => areas.openWaystone('town') });

  // — ambient villagers wandering the plaza —
  const vill = [
    { name: 'Tilly', tex: 'Child', dx: -74, dy: 66, r: 70, text: ['Mama says never go to Tidehollow! But the crypt under it groans at night...', 'Race you to the torch! ...Okay, you are too slow.'] },
    { name: 'Bram', tex: 'Villager3', dx: 66, dy: 12, r: 60, text: ['Dock Town has a waystone too. Touch one, then the other, and you can hop between them.', 'Press N to open the world map. It shows the level range for every zone.'] },
    { name: 'Nessa', tex: 'Villager4', dx: 40, dy: -92, r: 50, text: ['The inn takes 10 gold for a full night. Hester makes a wonderful stew.', 'Brom sells Maren\'s wares from the little red-roofed house - same prices, fewer shouts.'] },
    { name: 'Old Wick', tex: 'OldMan2', dx: -96, dy: -16, r: 40, text: ['Frostpeak Pass is far to the north-west. Cold enough to freeze your thoughts.', 'Back in my day the Harbour Gate was just a rotten plank. Now look at it!'] },
  ];
  for (const v of vill) areas.addNpc(null, { name: v.name, tex: v.tex, x: spawn.x + v.dx, y: spawn.y + v.dy, wander: v.r, text: v.text }, solids);
  installTownfolk(scene, areas, info); // data-driven NPC roster + ambient life (data/npcs.js, world/ambient.js)
  void Phaser;
}
