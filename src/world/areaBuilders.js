import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { SHOP_STOCK } from '../data/gear.js';
import { potionPrice } from '../systems/economy.js';

// One builder per AREAS[*].builder. Each receives ctx = { scene, mgr, def, b, o,
// P (props), solid(x,y,w,h), wall(x,y,w,h), px(tx,ty) } and lays out ground,
// props, NPCs, triggers and interactables for that space.
const T = CONFIG.tile;
const FONT = '"Silkscreen", monospace';
const house = (scene, solid, x, y, roof) => {
  const c = scene.add.container(x, y).setDepth(y);
  const HC = 33;
  if (scene.textures.exists('ts.house')) {
    for (const [row, col, ox, oy] of [
      [0, 0, -24, -28], [0, 1, -8, -28], [0, 2, 8, -28], [0, 3, 24, -28],
      [1, 0, -24, -12], [1, 1, -8, -12], [1, 2, 8, -12], [1, 3, 24, -12],
      [2, 0, -24, 4], [2, 1, -8, 4], [2, 2, 8, 4], [2, 3, 24, 4],
    ]) {
      const img = scene.add.image(ox, oy, 'ts.house', row * HC + col);
      if (row === 0) img.setTint(roof);
      c.add(img);
    }
  } else {
    c.add([scene.add.rectangle(0, -8, 40, 24, 0xd9c08a), scene.add.triangle(0, -28, -26, -18, 26, -18, 0, -34, roof)]);
  }
  solid(x, y - 12, 48, 36);
  return c;
};
const label = (scene, x, y, text, color = '#fff') =>
  scene.add.text(x, y, text, { fontFamily: FONT, fontSize: '8px', color, backgroundColor: '#00000088' }).setOrigin(0.5).setDepth(2790);

// ——— interiors ———
function room(ctx) {
  const { scene, def, o, P, wall, mgr } = ctx;
  const w = def.size.w * T, h = def.size.h * T;
  scene.add.tileSprite(o.x, o.y + 2 * T, w, h - 2 * T, def.floor).setOrigin(0).setDepth(-10);
  scene.add.tileSprite(o.x, o.y, w, 2 * T, def.wall).setOrigin(0).setDepth(-10);
  const g = scene.add.graphics().setDepth(-9);
  g.fillStyle(0x3d2712, 1).fillRect(o.x, o.y + 2 * T - 4, w, 4); // wainscot rail
  g.fillStyle(0xb57b3c, 1).fillRect(o.x, o.y + 2 * T - 5, w, 1);
  g.fillStyle(0x24160a, 1)
    .fillRect(o.x - 10, o.y - 10, 10, h + 20).fillRect(o.x + w, o.y - 10, 10, h + 20)
    .fillRect(o.x - 10, o.y - 10, w + 20, 10);
  // bottom wall with a door gap
  const cx = o.x + w / 2, gap = 30;
  g.fillRect(o.x - 10, o.y + h, w / 2 - gap / 2 + 10, 10).fillRect(cx + gap / 2, o.y + h, w / 2 - gap / 2 + 10, 10);
  g.fillStyle(0xffe9a8, 0.55).fillRect(cx - gap / 2, o.y + h, gap, 12); // daylight from the door
  g.fillStyle(0x24160a, 1).fillRect(cx - gap / 2 - 3, o.y + h - 2, 3, 14).fillRect(cx + gap / 2, o.y + h - 2, 3, 14);
  P.doorMat(cx, o.y + h - 7);
  // collision shell
  wall(o.x, o.y - 16, w, 16 + 30);
  wall(o.x - 16, o.y - 16, 16, h + 32); wall(o.x + w, o.y - 16, 16, h + 32);
  wall(o.x - 16, o.y + h, w / 2 - gap / 2 + 16, 18); wall(cx + gap / 2, o.y + h, w / 2 - gap / 2 + 16, 18);
  wall(cx - gap / 2, o.y + h + 18, gap, 14);
  const exitY = o.y + h - 2;
  mgr.addTrigger({ area: def.id, x: cx, y: exitY, r: 13, onEnter: () => mgr.exit() });
  mgr.addInteract({ area: def.id, x: cx, y: exitY - 6, r: 22, label: 'Leave', onUse: () => mgr.exit() });
  return { w, h, cx };
}

function buildInn(ctx) {
  const { scene, mgr, def, o, P, b } = ctx;
  room(ctx);
  const at = (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T });
  P.window(...Object.values(at(3.5, 1.95)));
  P.window(...Object.values(at(14, 1.95)));
  P.banner(...Object.values(at(6, 2.2)), 0x2e86c1);
  P.banner(...Object.values(at(16.9, 2.2)), 0xc0392b);
  const fp = at(8.4, 2.2); P.fireplace(fp.x, fp.y + 2);
  const rug = at(7.4, 6.3); P.rug(rug.x, rug.y, 72, 44, 0x7d2c2c, 0xd9b64a);
  // bar
  const barC = at(13.1, 5.4); P.counter(barC.x, barC.y, 100);
  P.shelf(...Object.values(at(11.6, 2.35)), 26, false);
  P.shelf(...Object.values(at(14.6, 2.35)), 26, false);
  P.barrel(...Object.values(at(10.0, 3.4)));
  P.barrel(...Object.values(at(16.5, 3.3)));
  for (const dx of [-30, -6, 20, 36]) P.mug(barC.x + dx, barC.y - 4);
  // tables + chairs
  for (const [tx, ty] of [[3.2, 6.6], [3.6, 9.8], [8.4, 9.4]]) {
    const t = at(tx, ty);
    P.table(t.x, t.y, 30);
    P.chair(t.x - 22, t.y + 3); P.chair(t.x + 22, t.y + 3);
    P.mug(t.x - 5, t.y - 4); P.mug(t.x + 7, t.y - 3);
  }
  // guest beds
  const b1 = at(14.4, 10.6), b2 = at(16.4, 10.6);
  P.bed(b1.x, b1.y, 0x2e86c1); P.bed(b2.x, b2.y, 0xc0392b);
  const lab = at(15.4, 7.6);
  label(scene, lab.x, lab.y, 'Guest beds', '#f4e0b0');
  P.plant(...Object.values(at(1.0, 3.4)));
  P.plant(...Object.values(at(1.0, 10.8)));
  P.barrel(...Object.values(at(1.0, 5.2)));
  // NPCs
  const ik = at(13.1, 4.0);
  mgr.addNpc(def.id, {
    name: 'Hester', tex: 'Woman', x: ik.x, y: ik.y,
    onUse: () => {
      scene.uiLock = true;
      mgr.say('Hester (Innkeeper)', 'Welcome to the Sleepy Lantern! A bed and a hot bowl of stew, 10 gold, and you will wake good as new.', [
        { label: 'Rest (10g) - full HP/MP', cb: () => mgr.rest(10) },
        { label: `Buy potion (${potionPrice(scene.player.level)}g)`, cb: () => { const p = scene.player, pr = potionPrice(p.level); if (p.gold < pr) { audio.play('error', 0.7); bus.emit(Events.SYSTEM, 'Hester: Not enough gold, dear.'); } else { p.gold -= pr; p.potions += 1; audio.play('gold'); bus.emit(Events.PLAYER_HP, scene.hpPayload()); bus.emit(Events.SYSTEM, `Bought a potion from Hester (${pr}g).`); } } },
        { label: 'Leave', cb: () => {} },
      ]);
    },
  });
  const rusk = at(8.4, 8.3);
  mgr.addNpc(def.id, { name: 'Captain Rusk', tex: 'Inspector', x: rusk.x, y: rusk.y, facing: 'down', text: [
    'Dock Town is a day south-east of here. Fine fishing, finer crabs.',
    'They say the Crypt of Ashenmoor opens beneath Tidehollow. I would not go below level nine.',
    'Frostpeak Pass, far north-west. Bring a warm cloak and a stronger blade.',
  ] });
  const wil = at(6.0, 7.6);
  mgr.addNpc(def.id, { name: 'Ranger Wil', tex: 'Hunter', x: wil.x, y: wil.y, wander: 36, text: [
    'Waystones! Touch one and it remembers you. Touch another later and you can jump between them.',
    'Press N for the world map. It shows every zone and the level it is meant for.',
  ] }, b.group);
}

function buildShop(ctx) {
  const { scene, mgr, def, o, P, b } = ctx;
  room(ctx);
  const at = (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T });
  P.window(...Object.values(at(2.2, 1.95)));
  P.window(...Object.values(at(9.8, 1.95)));
  for (const tx of [4.3, 7.6]) P.shelf(...Object.values(at(tx, 2.35)), 26, false);
  P.banner(...Object.values(at(6, 2.2)), 0x27ae60);
  const rug = at(6, 6.8); P.rug(rug.x, rug.y, 64, 30, 0x2e5a7d, 0xd9b64a);
  const cn = at(6, 4.6); P.counter(cn.x, cn.y, 112);
  P.mug(cn.x - 30, cn.y - 4); P.mug(cn.x + 24, cn.y - 4);
  P.crate(...Object.values(at(1.2, 3.6)), 1); P.crate(...Object.values(at(1.2, 4.6)), 0);
  P.sack(...Object.values(at(10.6, 3.7))); P.sack(...Object.values(at(10.6, 4.9)));
  P.barrel(...Object.values(at(10.7, 7.6)));
  P.crate(...Object.values(at(1.3, 7.6)), 1);
  P.plant(...Object.values(at(9.8, 7.8)));
  const bp = at(6, 3.35);
  mgr.addNpc(def.id, {
    name: 'Brom', tex: 'Sultan', x: bp.x, y: bp.y,
    onUse: () => {
      scene.uiLock = true;
      mgr.say('Brom (Shopkeeper)', "Maren's my sister, and her stock ships through me. Same prices, less shouting. What'll it be?", [
        { label: 'Browse wares', cb: () => { bus.emit(Events.GEAR, { open: 'shop', stock: SHOP_STOCK }); } },
        { label: 'Any news?', cb: () => mgr.say('Brom', 'Coast road to Dock Town is open. Shore crabs aplenty - Dockmaster Orla pays well to thin them out.') },
        { label: 'Leave', cb: () => {} },
      ]);
    },
  });
  const cat = at(2.3, 7.2);
  void cat; void b;
}

function buildElda(ctx) {
  const { scene, mgr, def, o, P, b } = ctx;
  room(ctx);
  const at = (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T });
  P.window(...Object.values(at(6.3, 1.95)));
  const fp = at(2.8, 2.2); P.fireplace(fp.x, fp.y + 2);
  P.cauldron(...Object.values(at(5.0, 3.2)));
  P.shelf(...Object.values(at(8.6, 2.35)), 26, true);
  P.shelf(...Object.values(at(10.6, 2.35)), 22, false);
  const rug = at(4.2, 6.6); P.rug(rug.x, rug.y, 60, 38, 0x4a5d8a, 0xe0c88a);
  const tb = at(7.6, 6.4); P.table(tb.x, tb.y, 28); P.chair(tb.x - 20, tb.y + 3); P.chair(tb.x + 20, tb.y + 3); P.mug(tb.x, tb.y - 4);
  P.bed(...Object.values(at(10.6, 8.5)), 0x7d3c98);
  P.plant(...Object.values(at(1.0, 3.6))); P.plant(...Object.values(at(1.0, 8.2)));
  P.cat(...Object.values(at(3.2, 6.9)));
  // chest (one-time)
  const cp = at(1.4, 6.0);
  const opened = !!mgr.qs.opened.elda_chest;
  const chest = P.chest(cp.x, cp.y, opened);
  const chestOpen = () => {
    if (mgr.qs.opened.elda_chest) { bus.emit(Events.SYSTEM, 'The chest is empty now.'); return; }
    mgr.qs.opened.elda_chest = true;
    audio.play('chest');
    scene.player.gold += 25; scene.player.potions += 2;
    bus.emit(Events.SYSTEM, "Granny Elda's chest: +25g and 2 potions. She waves it off - 'Take it, dear.'");
    bus.emit(Events.PLAYER_HP, scene.hpPayload());
    scene.saveNow();
    chest.destroy();
    P.chest(cp.x, cp.y, true);
  };
  mgr.addInteract({ area: def.id, x: cp.x, y: cp.y, r: 26, label: 'Open chest', onUse: chestOpen });
  const ep = at(5.6, 5.0);
  mgr.addNpc(def.id, { name: 'Granny Elda', tex: 'OldWoman', x: ep.x, y: ep.y, wander: 24, text: [
    'Mind the cat, dear. She bites. Sit, sit - there is tea.',
    'I gathered frostbloom on Frostpeak once, in my youth. Never again. The wisps there hold a grudge.',
    'The Crypt of Ashenmoor sleeps because the Warden keeps it so. Do not wake him unprepared.',
  ] }, b.group);
}

// ——— Coastal Dock Town ———
function paintLayers(ctx, extra) {
  const { scene, def, o } = ctx;
  const sprites = [];
  for (const l of def.layers) {
    const [x, y, w, h] = l.r;
    const ts = scene.add.tileSprite(o.x + x * T, o.y + y * T, w * T, h * T, l.tex).setOrigin(0).setDepth(-10 + (l.tex === 'tile.pier' ? 0.2 : 0));
    if (l.tex === 'tile.water') { ts.setDepth(-11); sprites.push(ts); }
    extra?.(l, ts);
  }
  // gentle water scroll
  if (sprites.length) scene.tweens.add({ targets: sprites, tilePositionX: 16, duration: 5200, repeat: -1 });
}

function buildDock(ctx) {
  const { scene, mgr, def, o, P, b, solid } = ctx;
  paintLayers(ctx);
  const at = (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T });
  // water solids + foam line along the shore
  for (const [x, y, w, h] of def.solids) solid(o.x + (x + w / 2) * T, o.y + (y + h / 2) * T, w * T, h * T);
  const foam = scene.add.graphics().setDepth(-9);
  foam.fillStyle(0xdff3ff, 0.55);
  for (let tx = 0; tx < 56; tx++) {
    if ([6, 7, 8, 18, 19, 20, 30, 31, 32].includes(tx)) continue;
    foam.fillRect(o.x + tx * T + ((tx * 7) % 5), o.y + 28 * T - 2, 7, 2);
  }
  // pier rails + bollards
  const rails = scene.add.graphics().setDepth(3);
  for (const px of [6, 18, 30]) {
    rails.fillStyle(0x3d2712, 1).fillRect(o.x + px * T - 1, o.y + 28 * T, 2, 10 * T).fillRect(o.x + (px + 3) * T - 1, o.y + 28 * T, 2, 10 * T);
    for (let k = 0; k < 10; k += 3) {
      rails.fillStyle(0x24160a, 1).fillRect(o.x + px * T - 2, o.y + (28 + k) * T, 4, 4).fillRect(o.x + (px + 3) * T - 2, o.y + (28 + k) * T, 4, 4);
    }
  }
  // buildings
  const hs = [[9.5, 7, 0xb03a2e, 'Net Loft'], [18.5, 6, 0x2e86c1, 'Harbour Office'], [29.5, 8.5, 0x7d3c98, 'Chandlery'], [12.5, 17.5, 0xd68910, 'The Salty Gull'], [31, 18, 0x27ae60, 'Fishmonger']];
  for (const [tx, ty, roof, name] of hs) {
    const p = at(tx, ty);
    house(scene, solid, p.x, p.y, roof);
    const dg = scene.add.graphics().setDepth(p.y + 1);
    dg.fillStyle(0x24160a, 1).fillRect(p.x - 6, p.y - 1, 12, 14).fillStyle(0x6d3f10, 1).fillRect(p.x - 5, p.y, 10, 13).fillStyle(0xf4c542, 1).fillRect(p.x + 2, p.y + 6, 1, 1);
    label(scene, p.x, p.y - 38, name, '#ffe8a0');
  }
  // plaza dressing
  const wp = at(def.waystone[0], def.waystone[1]);
  P.waystone(wp.x, wp.y);
  mgr.addInteract({ area: def.id, x: wp.x, y: wp.y, r: 34, label: 'Touch waystone', onUse: () => mgr.openWaystone('dock') });
  for (const [tx, ty] of [[15, 12.5], [23.5, 12.5], [16, 21], [27, 21], [35, 14]]) P.lamp(...Object.values(at(tx, ty)));
  for (const [tx, ty, v] of [[3, 25.4, 0], [4, 25.6, 1], [14, 25.5, 0], [24.5, 25.6, 1], [25.5, 25.4, 0], [34, 25.6, 1]]) {
    const p = at(tx, ty); if (v) P.crate(p.x, p.y, 1); else P.barrel(p.x, p.y);
  }
  // pier dressing
  for (const [px, ty] of [[7.5, 29.3], [19.5, 29.3], [31.5, 29.3]]) { P.barrel(at(px - 0.7, ty).x, at(px, ty).y); P.crate(at(px + 0.7, ty).x, at(px, ty).y + 2, 0); }
  // boats
  const boats = [[12.3, 32.5, { mast: true, hull: 0x8b5a2b }], [14.6, 36, { hull: 0x2e6f9e }], [25.6, 31.6, { mast: true, hull: 0x9b4a2b, sail: 0xf4f0e6 }], [27.6, 35.4, { hull: 0x7a5a30 }], [37.5, 33, { mast: true, hull: 0x2f6f4f, sail: 0xf7dc6f }], [43.5, 35.5, { hull: 0x8b5a2b }], [50, 32, { mast: true, hull: 0xb03a2e }]];
  for (const [tx, ty, opt] of boats) { const p = at(tx, ty); P.boat(p.x, p.y, opt); }
  P.lighthouse(...Object.values(at(36.6, 27.3)));
  // exit arch (west)
  const ex = at(def.exit[0] + 0.1, def.exit[1] + 1.05);
  P.archway(ex.x, ex.y, 0xf7dc6f, 0x8c9199);
  label(scene, ex.x, ex.y - 50, 'To Thistle Town', '#ffe8a0');
  mgr.addTrigger({ area: def.id, x: o.x + def.exit[0] * T, y: o.y + def.exit[1] * T, r: 12, onEnter: () => mgr.exit() });
  // beach dressing
  let seed = 9001;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 9; i++) P.palm(o.x + (40 + rnd() * 15) * T, o.y + (3 + rnd() * 22) * T);
  for (let i = 0; i < 10; i++) P.driftwood(o.x + (39.5 + rnd() * 16) * T, o.y + (2 + rnd() * 24.5) * T, i);
  for (let i = 0; i < 18; i++) P.shell(o.x + (39 + rnd() * 16.5) * T, o.y + (2 + rnd() * 25) * T, i);
  for (let i = 0; i < 6; i++) P.palm(o.x + (1 + rnd() * 36) * T, o.y + (0.6 + rnd() * 1.4) * T);
  // Garrick's net (quest interactable)
  const np = at(53.6, 4.6);
  P.net(np.x, np.y);
  mgr.addInteract({ area: def.id, x: np.x, y: np.y, r: 28, label: 'Search the tangled net', onUse: () => {
    audio.play('pickup');
    if (!mgr.onUse('garrick_net')) bus.emit(Events.SYSTEM, 'A tangle of old fishing net. It looks like Garrick\'s... but you are not looking for it yet.');
    else bus.emit(Events.SYSTEM, "You untangle Garrick's net. He will be thrilled.");
  } });
  label(scene, np.x, np.y - 14, 'fishing net', '#d8c890').setAlpha(0.8);
  // NPCs
  const npc = (name, tex, tx, ty, text, extra = {}) => { const p = at(tx, ty); return mgr.addNpc(def.id, { name, tex, x: p.x, y: p.y, text, ...extra }, b.group); };
  npc('Dockmaster Orla', 'Inspector', 24.5, 14.6, [
    'Welcome to Dock Town! Shore crabs are pinching our nets. Six of them, off the beach - I will make it worth your while.',
    'East beach is Driftwood Beach. Crabs there hit softer than a wet rope, but do not turn your back.',
    'Touch the waystone in the plaza and you can hop home to Thistle Town any time.',
  ]);
  const gar = npc('Old Garrick', 'OldMan2', 19.5, 36.4, [
    'Ahh... the fish are not biting, but the crabs are. I lost my good net on the north-east beach. Bah, my knees!',
    'That net was my grandfather\'s. If you find it, keep the crabs, I only want the net.',
  ]);
  P.fishingLine(gar.x + 6, gar.y, 18, 26);
  const fs1 = npc('Fisher Dunn', 'Hunter', 7.5, 36.6, ['Quiet, you will scare them off. Good mackerel run this season.', 'Crypt? Nah. I only go down to the water.']);
  P.fishingLine(fs1.x - 6, fs1.y, -16, 24);
  const fs2 = npc('Fisher Mae', 'Villager3', 31.5, 34.5, ['Tide is turning. You can tell by the gulls.', 'The lighthouse keeper sleeps all day and lights up all night. Lucky man.']);
  P.fishingLine(fs2.x + 6, fs2.y, 16, 20);
  npc('Pippa', 'Child', 15, 20, ['I saw a boat with a yellow sail! Did you?', 'Do not go on the beach at night. Crabs wear little hats then.'], { wander: 70 });
  npc('Sailor Finn', 'Villager4', 28, 19.5, ['Another day, another knot.', 'Word is something big sleeps beneath Tidehollow. Not my problem, I have a boat.'], { wander: 80 });
  npc('Dockhand Bo', 'Villager', 6, 14, ['Crates, crates, crates. Mind your feet.'], { wander: 60 });
}

// ——— Crypt of Ashenmoor ———
function buildCrypt(ctx) {
  const { scene, mgr, def, o, P, b, solid } = ctx;
  const W = def.size.w, H = def.size.h;
  const floor = new Uint8Array(W * H);
  for (const l of def.layers) {
    const [x, y, w, h] = l.r;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) floor[j * W + i] = 1;
    const ts = scene.add.tileSprite(o.x + x * T, o.y + y * T, w * T, h * T, l.tex).setOrigin(0).setDepth(-10);
    if (l.color === 0x6a4a4a) ts.setTint(0xe8b0b0);
  }
  // wall cells = non-floor cells touching floor (8-neigh); merge per-row runs into solids
  const isF = (i, j) => i >= 0 && j >= 0 && i < W && j < H && floor[j * W + i] === 1;
  const isWall = (i, j) => !isF(i, j) && [-1, 0, 1].some((dj) => [-1, 0, 1].some((di) => isF(i + di, j + dj)));
  for (let j = -1; j <= H; j++) {
    let run = 0;
    for (let i = -1; i <= W + 1; i++) {
      const wl = i <= W && isWall(i, j);
      if (wl) {
        scene.add.image(o.x + i * T, o.y + j * T, 'tile.cryptwall').setOrigin(0).setDepth(-9);
        run++;
      }
      if ((!wl || i === W + 1) && run > 0) {
        solid(o.x + (i - run / 2) * T, o.y + (j + 0.5) * T, run * T, T);
        run = 0;
      }
    }
  }
  const at = (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T });
  const tor = (tx, ty, big) => { const p = at(tx, ty); P.torch(p.x, p.y + 2, big); };
  [[18, 28], [26, 28], [22, 20.1]].forEach(([x, y]) => tor(x, y));
  [[13, 11], [18, 11], [26, 11], [31, 11], [22, 11]].forEach(([x, y]) => tor(x, y));
  [[4, 12], [8, 12], [37, 12], [41, 12]].forEach(([x, y]) => tor(x, y));
  [[15, 1], [20, 1], [25, 1], [30, 1]].forEach(([x, y]) => tor(x, y, true));
  [[12.5, 19.3], [32.3, 19.3], [4, 22.4], [39, 22.4], [14.6, 4.3], [30.6, 4.3], [17.5, 33.3], [27.7, 33.3]].forEach(([x, y]) => P.brazier(at(x, y).x, at(x, y).y));
  for (const [x, y] of [[14.5, 13.5], [14.5, 18], [29.8, 13.5], [29.8, 18], [18, 4], [26.5, 4]]) P.cryptPillar(at(x, y).x, at(x, y).y);
  for (const [x, y] of [[5.5, 15], [5.5, 19.5], [38, 15], [38, 19.5]]) P.sarcophagus(at(x, y).x, at(x, y).y);
  for (const [x, y] of [[17.2, 31], [27.5, 31], [12, 16], [33, 16]]) P.tomb(at(x, y).x, at(x, y).y, x | 0);
  let seed = 31337;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const l of def.layers) {
    const [x, y, w, h] = l.r;
    for (let i = 0; i < Math.floor(w * h / 18); i++) P.bones(o.x + (x + 0.5 + rnd() * (w - 1)) * T, o.y + (y + 0.8 + rnd() * (h - 1.4)) * T, i);
  }
  const st = at(22.5, 34.6); P.stairs(st.x, st.y - 4);
  label(scene, st.x, st.y - 28, 'Stairs up', '#c8c0e0').setDepth(2790);
  mgr.addTrigger({ area: def.id, x: o.x + def.exit[0] * T, y: o.y + def.exit[1] * T, r: 14, onEnter: () => mgr.exit() });
  // treasure chest (one-time)
  const cp = at(3.3, 22.4);
  const done = !!mgr.qs.opened.crypt_chest;
  let chest = P.chest(cp.x, cp.y, done);
  mgr.addInteract({ area: def.id, x: cp.x, y: cp.y, r: 26, label: 'Open chest', onUse: () => {
    if (mgr.qs.opened.crypt_chest) { bus.emit(Events.SYSTEM, 'Empty. Someone beat you to it - centuries ago.'); return; }
    mgr.qs.opened.crypt_chest = true;
    audio.play('chest');
    scene.player.gold += 80; scene.player.potions += 3;
    bus.emit(Events.SYSTEM, 'Crypt chest: +80g and 3 potions.');
    bus.emit(Events.PLAYER_HP, scene.hpPayload());
    scene.saveNow();
    chest.destroy(); chest = P.chest(cp.x, cp.y, true);
  } });
  // darkness
  b.rt = scene.add.renderTexture(o.x, o.y, W * T, H * T).setOrigin(0).setDepth(2500);
  b.lightImg = scene.make.image({ x: 0, y: 0, key: 'fx.glow', add: false });
}

// ——— Frostpeak Pass ———
function buildFrost(ctx) {
  const { scene, mgr, def, o, P, b, solid } = ctx;
  paintLayers(ctx);
  const at = (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T });
  for (const [x, y, w, h] of def.solids) solid(o.x + (x + w / 2) * T, o.y + (y + h / 2) * T, w * T, h * T);
  // pond rim + shimmer
  const pg = scene.add.graphics().setDepth(-9);
  pg.lineStyle(3, 0xf4fbff, 1).strokeRect(o.x + 32 * T, o.y + 8 * T, 12 * T, 9 * T);
  pg.lineStyle(1, 0xd2efff, 0.8).lineBetween(o.x + 34 * T, o.y + 10 * T, o.x + 37 * T, o.y + 12 * T).lineBetween(o.x + 38 * T, o.y + 14 * T, o.x + 41 * T, o.y + 13 * T);
  const camp = { x: 1, y: 25, w: 17, h: 16 };
  const inCamp = (tx, ty, pad = 0) => tx > camp.x - pad && tx < camp.x + camp.w + pad && ty > camp.y - pad && ty < camp.y + camp.h + pad;
  const inPond = (tx, ty) => tx > 31 && tx < 45 && ty > 7 && ty < 18;
  let seed = 55555;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 90; i++) {
    const tx = 1 + rnd() * 54, ty = 1 + rnd() * 40, kind = rnd();
    if (inCamp(tx, ty, 1) || inPond(tx, ty) || (tx < 6 && ty > 22)) continue;
    const p = at(tx, ty);
    if (kind < 0.55) P.pine(p.x, p.y, 0.9 + rnd() * 0.5);
    else if (kind < 0.75) P.iceRock(p.x, p.y, i);
    else P.drift(p.x, p.y);
  }
  for (let i = 0; i < 28; i++) { const tx = 1 + rnd() * 54, ty = 1 + rnd() * 40; if (!inPond(tx, ty)) P.drift(at(tx, ty).x, at(tx, ty).y); }
  // outpost
  P.tent(...Object.values(at(6, 29)), 0xb5651d);
  P.tent(...Object.values(at(13.5, 28.5)), 0x6d8fb5);
  P.tent(...Object.values(at(14.5, 37)), 0xa04040);
  P.campfire(...Object.values(at(9.6, 35)));
  const wp = at(def.waystone[0], def.waystone[1]);
  P.waystone(wp.x, wp.y);
  mgr.addInteract({ area: def.id, x: wp.x, y: wp.y, r: 34, label: 'Touch waystone', onUse: () => mgr.openWaystone('frost') });
  for (const [tx, ty] of [[3, 27], [16.5, 33], [5, 39]]) P.crate(at(tx, ty).x, at(tx, ty).y, tx | 0);
  P.barrel(...Object.values(at(16.5, 35.4)));
  const ex = at(def.exit[0] + 0.1, def.exit[1] + 1.05);
  P.archway(ex.x, ex.y, 0xdff6ff, 0x8792a0);
  label(scene, ex.x, ex.y - 50, 'To Thistle Town', '#d8f0ff');
  mgr.addTrigger({ area: def.id, x: o.x + def.exit[0] * T, y: o.y + def.exit[1] * T, r: 12, onEnter: () => mgr.exit() });
  const npc = (name, tex, tx, ty, text, extra = {}) => { const p = at(tx, ty); return mgr.addNpc(def.id, { name, tex, x: p.x, y: p.y, text, ...extra }, b.group); };
  npc('Scout Ilka', 'Eskimo', 11.5, 32.8, [
    'Frost Wisps circle the pass at dusk. Six of them and the caravan road opens again. You look capable.',
    'Rime Crawlers nest under the drifts. They are slow, but they hit like an avalanche.',
    'The waystone here keeps the outpost on the map. Touch it, then you can come back any time.',
  ]);
  npc('Old Brannoch', 'Master', 7, 32.5, ['Sit by the fire, traveller. The wind out there knows no mercy.', 'I saw the Warden once. Bigger than this tent. Stay out of the glowing circles, lad.'], { wander: 18 });
  // snowfall: emitter follows the camera top edge (see AreaManager._snow)
  const vw = Math.ceil(scene.scale.width / 1.5) + 120;
  b.snow = scene.add.particles(0, 0, 'px.white', {
    x: { min: 0, max: vw }, y: 0, lifespan: 4200, speedY: { min: 26, max: 52 }, speedX: { min: -28, max: -6 },
    scale: { min: 0.6, max: 1.4 }, alpha: { min: 0.5, max: 0.95 }, frequency: 38, quantity: 1,
  }).setDepth(2550);
}

export const BUILDERS = { inn: buildInn, shop: buildShop, elda: buildElda, dock: buildDock, crypt: buildCrypt, frost: buildFrost };
void Phaser;
