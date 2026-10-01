import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { DOORS, PORTALS, SIGNS, WAYSTONES, AREAS } from '../data/zones.js';
import { LANDMARKS, BRIDGES } from '../data/worldLayout.js';
import { makeProps } from './propsExtra.js';
import { makePropsBiome } from './propsBiome.js';
import { installTownfolk } from './townfolk.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { LIGHTHOUSE } from './waterways.js';

const T = CONFIG.tile;
const FONT = '"Silkscreen", monospace';

// Keep scatter trees/rocks off the footprint of gates, signs and the waystone.
export function overworldClearings(spawn) {
  const out = [];
  const ws = WAYSTONES.find((w) => !w.area);
  out.push({ x: spawn.x + ws.offset.x, y: spawn.y + ws.offset.y, r: 52 });
  for (const p of PORTALS) out.push({ x: p.tile.x * T + 8, y: p.tile.y * T + 8, r: 44 });
  for (const s of SIGNS) out.push({ x: s.tx * T + 8, y: s.ty * T + 8, r: 22 });
  for (const m of LANDMARKS) out.push({ x: m.tx * T, y: m.ty * T, r: m.type === 'light' ? 64 : m.type === 'mill' || m.type === 'tower' ? 48 : 32 });
  for (const b of BRIDGES) out.push({ x: b.x * T, y: b.y * T, r: Math.max(b.len * 8, 28) });
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
  buildLandmarks(scene, areas, P, solids);
  void Phaser;
}

function px(m) { return { x: m.tx * T, y: m.ty * T }; }

function buildLandmarks(scene, areas, P, solids) {
  const B = makePropsBiome(scene, solids);
  const byId = Object.fromEntries(LANDMARKS.map((m) => [m.id, m]));
  const chest = (id, x, y, gold, pots, line) => {
    const opened = !!areas.qs.opened[id];
    let ch = P.chest(x, y, opened);
    areas.addInteract({
      area: null, x, y, r: 26, label: 'Open chest',
      onUse: () => {
        if (areas.qs.opened[id]) { bus.emit(Events.SYSTEM, 'The chest is empty.'); return; }
        areas.qs.opened[id] = true;
        audio.play('chest');
        scene.player.gold += gold; scene.player.potions += pots;
        bus.emit(Events.SYSTEM, line);
        bus.emit(Events.PLAYER_HP, scene.hpPayload());
        scene.saveNow?.();
        ch.destroy(); ch = P.chest(x, y, true);
      },
    });
  };

  // Mara's lighthouse (north-coast headland). Glow scale 2.4 is picked up as a rotating night beam.
  {
    const m = byId.lighthouse, x = LIGHTHOUSE.x, y = LIGHTHOUSE.y;
    P.lighthouse(x, y);
    areas.addProximity({ area: null, x, y, r: 90, obj: txt(scene, x, y - 118, m.name, '#ffe8a0') });
    areas.addInteract({
      area: null, x, y: y + 8, r: 34, label: 'Read the keeper\'s log',
      onUse: () => areas.say('Keeper\'s Log', 'Night 412. Beam still turns. Mara swears she saw a sail past Frostpeak — no harbour record of it. The rocks below take what the sea does not want.'),
    });
    chest('lm_light', x - 22, y + 10, 40, 1, "Lighthouse chest: +40g and a potion. Mara shrugs. 'Storm stores.'");
    scene.gather?.addNode('driftwood', x - 36, y + 18, null);
  }

  // Meadowfield windmill (turning sails)
  {
    const m = byId.windmill, { x, y } = px(m);
    B.windmill(x, y);
    areas.addProximity({ area: null, x, y, r: 80, obj: txt(scene, x, y - 78, m.name, '#ffe8a0') });
    areas.addNpc(null, {
      name: 'Miller Oat', tex: 'Caveman', x: x + 28, y: y + 8, wander: 28,
      text: ['Wind\'s been kind this week. Flour for the inn, chaff for the hens.', 'Stay on the packed earth if you\'re headed north. The mill pond is only a puddle, the Silverrun is not.'],
    }, solids);
    scene.gather?.addNode('dewberry', x - 30, y + 14, null);
    scene.gather?.addNode('sunpetal', x + 40, y + 18, null);
  }

  // Ruined watchtower
  {
    const m = byId.tower, { x, y } = px(m);
    B.ruinTower(x, y);
    areas.addProximity({ area: null, x, y, r: 80, obj: txt(scene, x, y - 82, m.name, '#d8e0e8') });
    areas.addNpc(null, {
      name: 'Scout Elin', tex: 'Hunter', x: x + 26, y: y + 10, wander: 20,
      text: ['Hollow Depths opened under the hill last winter. The stairs still smell of wet stone.', 'I keep the fire at Hollow Road Rest. If the tower groans, I leave.'],
    }, solids);
    chest('lm_tower', x - 18, y + 8, 55, 2, 'Watchtower chest: +55g and 2 potions. The lock was rust, not a ward.');
    scene.gather?.addNode('iron', x + 22, y + 16, null);
  }

  // Dawnstone Circle: once-per-hour blessing
  {
    const m = byId.shrine, { x, y } = px(m);
    const g = scene.add.graphics().setDepth(y);
    g.fillStyle(0x000000, 0.22).fillEllipse(x, y + 4, 54, 16);
    g.fillStyle(0xc8b898, 1).fillCircle(x, y, 18);
    g.fillStyle(0xe8dcc0, 1).fillCircle(x, y - 2, 12);
    g.fillStyle(0xf4e8c8, 0.9).fillCircle(x, y - 4, 4);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - 0.4, sx = x + Math.cos(a) * 26, sy = y + Math.sin(a) * 14;
      g.fillStyle(0x9aa4ae, 1).fillRect(sx - 3, sy - 16, 6, 18);
      g.fillStyle(0xc5cdd4, 1).fillRect(sx - 3, sy - 16, 2, 18);
    }
    P.glow(x, y - 8, 1.4, 0.4, 0xffe9a0);
    solids.add(scene.add.rectangle(x, y - 4, 22, 14, 0xffffff, 0));
    areas.addProximity({ area: null, x, y, r: 72, obj: txt(scene, x, y - 36, m.name, '#ffe8a0') });
    areas.addInteract({
      area: null, x, y, r: 32, label: 'Kneel at the Dawnstone',
      onUse: () => blessShrine(scene, areas),
    });
  }

  const camps = [
    ['camp1', 'Ranger Willa', 'Hunter', 'Hollow Road Rest. North to the Depths, south to town. Keep the fire fed.', 'sunpetal'],
    ['camp2', 'Hunter Cal', 'Hunter', 'Mosswood after dark belongs to the willowisps. Sit. The fire keeps them polite.', 'moonmoss'],
    ['camp3', 'Shepherd Brin', 'Caveman2', 'Emberdeep wind comes up this valley. Lambs hate it. I hate it. Tea?', 'oak'],
    ['camp4', 'Dockhand Noll', 'Villager', 'Harbour Gate is just down the cobbles. If Orla shouts, I was never here.', 'driftwood'],
  ];
  for (const [id, name, tex, line, node] of camps) {
    const m = byId[id], { x, y } = px(m);
    P.tent(x - 16, y, 0xb5651d);
    P.campfire(x + 10, y + 4);
    areas.addProximity({ area: null, x, y, r: 64, obj: txt(scene, x, y - 40, m.name, '#ffd27a', '7px') });
    areas.addNpc(null, { name, tex, x: x + 22, y: y + 10, wander: 22, text: [line, 'Roads are packed earth until the gates. Follow the posts.'] }, solids);
    scene.gather?.addNode(node, x - 28, y + 12, null);
  }

  // Troll of the Northway
  {
    const m = byId.troll, { x, y } = px(m);
    areas.addNpc(null, {
      name: 'Grum', tex: 'Tengu', x: x + 18, y: y + 12, wander: 16,
      text: ['Toll is a kind word. "Please" works. "Move" does not.', 'I keep the Northway. Frostpeak that way, Hollow the other. Nobody falls in on my watch.'],
    }, solids);
  }
}

function txt(scene, x, y, s, color = '#fff', size = '8px') {
  return scene.add.text(x, y, s, { fontFamily: FONT, fontSize: size, color, backgroundColor: '#00000088' }).setOrigin(0.5).setDepth(2790);
}

const HOUR = 60 * 60 * 1000;
function blessShrine(scene, areas) {
  const now = Date.now();
  const last = areas.qs.shrineAt || 0;
  if (now - last < HOUR) {
    const mins = Math.max(1, Math.ceil((HOUR - (now - last)) / 60000));
    areas.say('Dawnstone Circle', `The stones are still warm from the last blessing. Return in ${mins} minute${mins === 1 ? '' : 's'}.`);
    return;
  }
  areas.qs.shrineAt = now;
  const p = scene.player;
  p.buff = { until: scene.time.now + 8 * 60 * 1000, atkMul: 1.18, spdMul: 1.12, name: 'Dawnstone' };
  p.hp = Math.min(p.effMaxHp(), p.hp + 25);
  audio.play('quest');
  bus.emit(Events.PLAYER_HP, scene.hpPayload());
  bus.emit(Events.TOAST, { title: 'Dawnstone Blessing', text: '+ATK +SPD for 8 minutes. Once an hour.', color: '#ffe8a0' });
  areas.say('Dawnstone Circle', 'Warmth climbs your arms. For a little while the road feels shorter.');
  scene.saveNow?.();
}
