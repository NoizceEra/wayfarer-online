// Gathering nodes: herbs, berry bushes, wood logs, ore/bone/crystal veins and
// fishing spots. `placeGatherNodes(scene, area, b)` scatters them per biome
// with a seeded RNG (overworld: area = null; map: area = AREAS def + built data).
// Nodes register as E-interactables with the AreaManager, yield into the
// material pack (data/materials.js), respawn on timers and burst particles.
import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { ZONES, PORTALS, SIGNS } from '../data/zones.js';
import { zoneAt } from '../world/overworld.js';
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { ramp } from './heroArt.js';
import { G } from './matArt.js';
import { matById } from '../data/materials.js';
import { addMat } from './pack.js';
import { NPC_SPOTS } from '../data/quests.js';
import { STATION_SPOTS } from './crafting.js';
import { EXTRA_NODE_TYPES, EXTRA_FISH, EXTRA_AREA_PLAN } from '../data/gatherExtra.js';

const T = CONFIG.tile;

// yield: [min,max]; respawn seconds
export const NODE_TYPES = {
  sunpetal: { kind: 'herb', mat: 'sunpetal', label: 'Pick Sunpetal', yield: [1, 2], respawn: 45, color: 0xf4c542 },
  moonmoss: { kind: 'herb', mat: 'moonmoss', label: 'Pick Moonmoss', yield: [1, 2], respawn: 60, color: 0x3fb6a8 },
  bogbloom: { kind: 'herb', mat: 'bogbloom', label: 'Pick Bogbloom', yield: [1, 2], respawn: 75, color: 0x9b59b6 },
  frostbell: { kind: 'herb', mat: 'frostbell', label: 'Pick Frostbell', yield: [1, 2], respawn: 80, color: 0x9fd8ff },
  dewberry: { kind: 'bush', mat: 'dewberry', label: 'Pick Dewberries', yield: [2, 3], respawn: 60, color: 0xc0392b },
  thornberry: { kind: 'bush', mat: 'thornberry', label: 'Pick Thornberries', yield: [2, 3], respawn: 70, color: 0x6c3483 },
  oak: { kind: 'log', mat: 'oak_log', label: 'Chop Oak Log', yield: [1, 2], respawn: 90, color: 0x8d5a2b },
  driftwood: { kind: 'log', mat: 'driftwood', label: 'Collect Driftwood', yield: [1, 2], respawn: 90, color: 0xb9a27c },
  iron: { kind: 'ore', mat: 'iron_ore', label: 'Mine Iron Vein', yield: [1, 2], respawn: 120, color: 0x8a929a },
  bone: { kind: 'bone', mat: 'bone_shard', label: 'Dig Bone Deposit', yield: [1, 2], respawn: 140, color: 0xe8e0c8 },
  frostcrystal: { kind: 'crystal', mat: 'frost_crystal', label: 'Mine Frost Crystal', yield: [1, 2], respawn: 150, color: 0x8fd8ff },
  pond: { kind: 'fish', spot: 'pond', label: 'Fish in Pond', respawn: 20, color: 0x4aa8e0 },
  harbour: { kind: 'fish', spot: 'harbour', label: 'Fish off the Pier', respawn: 20, color: 0x2e86c1 },
  icehole: { kind: 'fish', spot: 'ice', label: 'Ice Fishing Hole', respawn: 20, color: 0x2a5a8a },
};

// weighted catch tables (weights; koi is boosted slightly by LUK)
export const FISH_TABLES = {
  pond: { pond_carp: 80, golden_koi: 2, old_button: 10, tattered_cloth: 8 },
  harbour: { silver_mackerel: 52, harbor_eel: 22, pond_carp: 14, golden_koi: 1.5, old_button: 6, tattered_cloth: 4 },
  ice: { frost_trout: 86, golden_koi: 1.5, old_button: 6, tattered_cloth: 4 },
};

// Overworld scatter plan: [node, count, zone]
const OVERWORLD_PLAN = [
  ['sunpetal', 30, 'meadow'], ['dewberry', 16, 'meadow'], ['oak', 12, 'meadow'],
  ['moonmoss', 18, 'woods'], ['thornberry', 11, 'woods'], ['oak', 12, 'woods'], ['iron', 8, 'woods'],
  ['iron', 14, 'ruins'], ['bogbloom', 12, 'ruins'],
];
// Fishing ponds on the overworld (tile coords, inside the meadow)
export const PONDS = [{ tx: 29, ty: 40 }, { tx: 96, ty: 104 }, { tx: 24, ty: 62 }];
// Map plans: rects are tile rects [x,y,w,h] relative to the area origin.
const AREA_PLAN = {
  dock: {
    scatter: [['driftwood', 7, [40, 3, 15, 22]]],
    fixed: [['harbour', 9.8, 33.5], ['harbour', 17.2, 31.5], ['harbour', 21.8, 34], ['harbour', 33.8, 32]],
  },
  crypt: {
    scatter: [['bone', 3, [3, 13, 6, 10]], ['bone', 3, [36, 13, 6, 10]], ['bone', 3, [12, 12, 21, 8]], ['iron', 4, [12, 12, 21, 8]]],
    fixed: [],
  },
  frost: {
    scatter: [['frostbell', 9, [2, 2, 52, 21]], ['frostcrystal', 7, [2, 2, 52, 21]], ['frostbell', 3, [2, 26, 15, 13]]],
    fixed: [['icehole', 33.2, 12.5], ['icehole', 42.6, 13.2]],
  },
};

Object.assign(NODE_TYPES, EXTRA_NODE_TYPES); // expansion maps (data/gatherExtra.js)
Object.assign(FISH_TABLES, EXTRA_FISH);
Object.assign(AREA_PLAN, EXTRA_AREA_PLAN);

// Tiles the overworld scatter must keep clear of (ponds, wild NPCs, stations).
export function contentClearings(spawn) {
  const out = [];
  for (const p of PONDS) out.push({ x: p.tx * T + 8, y: p.ty * T + 8, r: 46 });
  for (const n of Object.values(NPC_SPOTS)) out.push({ x: n.tx * T + 8, y: n.ty * T + 8, r: 30 });
  for (const s of STATION_SPOTS) if (!s.area) out.push({ x: spawn.x + s.dx, y: spawn.y + s.dy, r: 30 });
  return out;
}

const mkRnd = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

// ——— procedural 16px node art ———
function painters(type) {
  const a = ramp(type.color);
  const g = new G();
  const dep = new G();
  const grass = [72, 140, 62], grassHi = [104, 172, 84], grassLo = [44, 98, 44];
  const tuft = (gg, x, y) => { gg.px(x, y, grass).px(x - 1, y + 1, grassLo).px(x + 1, y + 1, grass).px(x, y + 1, grassHi); };
  switch (type.kind) {
    case 'herb': {
      for (const [x, y] of [[4, 11], [8, 9], [11, 12]]) { g.line(x, y + 3, x, y, grass); g.px(x - 1, y + 2, grassLo); g.px(x + 1, y + 2, grass); }
      for (const [x, y] of [[4, 9], [8, 7], [11, 10]]) { g.disc(x, y, 1, a.mid); g.px(x, y - 1, a.hi); g.px(x, y, [255, 255, 255]); }
      g.r(3, 14, 10, 1, grassLo);
      tuft(dep, 4, 12); tuft(dep, 9, 11); dep.r(3, 14, 10, 1, grassLo);
      break;
    }
    case 'bush': {
      g.disc(8, 9, 5, grassLo); g.disc(7, 8, 4, grass); g.disc(10, 8, 3, grass); g.px(5, 6, grassHi); g.px(6, 5, grassHi); g.px(9, 5, grassHi);
      for (const [x, y] of [[5, 9], [9, 7], [10, 11], [7, 11], [12, 9]]) { g.px(x, y, a.mid); g.px(x, y - 1, a.hi); }
      g.r(4, 14, 8, 1, [50, 70, 40]);
      dep.disc(8, 9, 5, grassLo); dep.disc(7, 8, 4, grass); dep.disc(10, 8, 3, grass); dep.px(5, 6, grassHi); dep.px(6, 5, grassHi); dep.r(4, 14, 8, 1, [50, 70, 40]);
      break;
    }
    case 'log': {
      g.r(2, 8, 12, 6, a.mid); g.r(2, 8, 12, 2, a.hi); g.r(2, 13, 12, 1, a.lo); g.disc(13, 11, 2, ramp(0xc9a06a).mid); g.px(13, 11, a.lo); g.px(5, 11, a.lo); g.px(8, 10, a.lo2);
      g.px(6, 7, grass); g.px(7, 6, grass); g.px(9, 7, grassHi);
      dep.r(5, 10, 6, 4, a.lo); dep.r(5, 10, 6, 1, a.mid); dep.disc(8, 11, 1, ramp(0xc9a06a).mid);
      break;
    }
    case 'ore': case 'bone': case 'crystal': {
      const rock = ramp(type.kind === 'bone' ? 0x6a6478 : type.kind === 'crystal' ? 0x9bb4c8 : 0x6b7078);
      g.rows([[5, 6, 10], [6, 4, 12], [7, 3, 13], [8, 2, 13], [9, 2, 13], [10, 3, 12], [11, 3, 12], [12, 4, 11], [13, 5, 10]], rock.mid);
      g.r(4, 6, 4, 2, rock.hi); g.r(9, 10, 4, 2, rock.lo); g.r(3, 13, 10, 1, rock.lo2);
      if (type.kind === 'ore') for (const [x, y] of [[5, 9], [9, 8], [7, 11], [11, 10]]) { g.r(x, y, 2, 2, [217, 121, 58]); g.px(x, y, [255, 190, 120]); }
      if (type.kind === 'bone') { g.line(4, 9, 11, 6, a.mid); g.line(5, 10, 12, 7, a.hi); g.disc(4, 9, 1, a.hi); g.disc(12, 6, 1, a.mid); g.px(8, 11, a.mid); g.px(7, 11, a.lo); }
      if (type.kind === 'crystal') { for (const [x, y, h] of [[6, 11, 6], [9, 11, 5], [11, 11, 3]]) { g.r(x, y - h, 2, h, a.mid); g.px(x, y - h, [255, 255, 255]); g.r(x, y - h + 1, 1, h - 1, a.hi); } }
      dep.rows([[9, 5, 10], [10, 3, 12], [11, 3, 12], [12, 4, 11], [13, 5, 10]], rock.lo); dep.r(4, 10, 3, 1, rock.mid); dep.r(9, 11, 3, 1, rock.mid); dep.r(3, 13, 10, 1, rock.lo2);
      break;
    }
    case 'fish': {
      const w = ramp(type.color), ring = [228, 244, 255];
      for (const [x, y] of [[7, 6], [8, 6], [5, 7], [10, 7], [4, 8], [11, 8], [4, 9], [11, 9], [5, 10], [10, 10], [7, 11], [8, 11]]) g.px(x, y, ring);
      for (const [x, y] of [[6, 7], [9, 7], [5, 8], [10, 8], [6, 10], [9, 10]]) g.px(x, y, w.hi);
      g.px(8, 8, [255, 255, 255]).px(7, 9, w.mid).px(9, 8, w.mid);
      g.px(2, 8, ring).px(13, 8, ring).px(3, 11, w.hi).px(12, 5, w.hi);
      dep.px(7, 9, w.mid).px(8, 9, w.mid);
      break;
    }
    default: break;
  }
  if (type.kind !== 'fish') { g.outline(); dep.outline(); }
  return [g.canvas(), dep.canvas()];
}
function nodeTex(scene, key) {
  const live = `node.${key}`, dead = `node.${key}.dep`;
  if (!scene.textures.exists(live)) {
    const [a, b] = painters(NODE_TYPES[key]);
    scene.textures.addCanvas(live, a); scene.textures.addCanvas(dead, b);
  }
  return [live, dead];
}

function pickWeighted(table, boost = {}) {
  const e = Object.entries(table).map(([k, w]) => [k, w * (boost[k] || 1)]);
  let r = Math.random() * e.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of e) { r -= w; if (r <= 0) return k; }
  return e[0][0];
}

export class GatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.nodes = [];
    this.placed = {};
    this.ponds = [];
  }

  // Place one node (sprite + interact). Returns the node.
  addNode(key, x, y, areaId) {
    const s = this.scene, type = NODE_TYPES[key];
    const [live, dead] = nodeTex(s, key);
    const fish = type.kind === 'fish';
    const img = s.add.image(x, y, live).setOrigin(0.5, 0.75).setScale(fish ? 2 : 1.2).setDepth(fish ? y - 400 : y);
    if (fish) { img.setAlpha(0.95); s.tweens.add({ targets: img, scale: 2.7, alpha: 0.2, duration: 1300, repeat: -1, ease: 'sine.out' }); }
    else if (type.kind === 'herb' || type.kind === 'bush') s.tweens.add({ targets: img, angle: { from: -2, to: 2 }, duration: 1200 + (x % 7) * 90, yoyo: true, repeat: -1, ease: 'sine.inout' });
    const node = { key, type, x, y, area: areaId, img, live, dead, ready: true, at: 0 };
    node.it = { area: areaId, x, y, r: fish ? 40 : 26, label: type.label, node: true, onUse: () => this.use(node) };
    s.areas.interacts.push({ ...node.it });
    node.itRef = s.areas.interacts[s.areas.interacts.length - 1];
    this.nodes.push(node);
    return node;
  }

  use(node) {
    const s = this.scene;
    if (!node.ready) { bus.emit(Events.SYSTEM, 'Already picked clean. Give it time to regrow.'); return; }
    if (node.type.kind === 'fish') { bus.emit(Events.FISH, { node, table: node.type.spot }); return; }
    this.harvest(node);
    void s;
  }

  harvest(node) {
    const s = this.scene, t = node.type;
    const n = Phaser.Math.Between(t.yield[0], t.yield[1]);
    const got = addMat(s, t.mat, n);
    if (!got) return;
    // luck: bonus extra
    if (Math.random() < 0.08 + (s.player.equipBonuses().luk || 0) * 0.004) addMat(s, t.mat, 1, { quiet: true });
    this.burst(node.x, node.y - 6, t.color, t.kind);
    audio.play('coin', 0.6);
    bus.emit(Events.ACH_EVENT, { k: 'gather', n });
    this.deplete(node);
  }

  deplete(node) {
    const s = this.scene, t = node.type;
    node.ready = false; node.at = s.time.now + t.respawn * 1000;
    if (t.kind !== 'fish') { node.img.setTexture(node.dead); s.tweens.killTweensOf(node.img); node.img.setAngle(0); }
    else node.img.setVisible(false);
    const i = s.areas.interacts.indexOf(node.itRef);
    if (i >= 0) s.areas.interacts.splice(i, 1);
  }
  respawn(node) {
    const s = this.scene;
    node.ready = true;
    node.img.setTexture(node.live).setVisible(true);
    if (!s.areas.interacts.includes(node.itRef)) s.areas.interacts.push(node.itRef);
  }

  burst(x, y, color, kind) {
    const s = this.scene;
    if (kind === 'ore' || kind === 'bone') {
      const count = Phaser.Math.Between(8, 12);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 20;
        const p = s.add.rectangle(x, y, Phaser.Math.Between(2, 4), Phaser.Math.Between(2, 4), color).setDepth(2700);
        s.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, angle: Math.random() * 360, duration: 400 + Math.random() * 300, onComplete: () => p.destroy() });
      }
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2, d = 15 + Math.random() * 15;
        const p = s.add.rectangle(x, y, 2, 2, 0xffe270).setDepth(2700);
        s.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, scale: 0, duration: 300 + Math.random() * 200, ease: 'quad.out', onComplete: () => p.destroy() });
      }
    } else if (kind === 'crystal') {
      const count = Phaser.Math.Between(8, 12);
      const cols = [0x00ffff, 0xff00ff, color];
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, d = 15 + Math.random() * 20;
        const c = cols[Math.floor(Math.random() * cols.length)];
        const p = s.add.rectangle(x, y, 3, 3, c).setDepth(2700).setBlendMode(Phaser.BlendModes.ADD);
        s.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y - Math.random() * 15 + Math.sin(a) * d, alpha: 0, angle: Math.random() * 180, duration: 600 + Math.random() * 400, onComplete: () => p.destroy() });
      }
    } else if (kind === 'herb' || kind === 'bush' || kind === 'berry') {
      const count = Phaser.Math.Between(8, 10);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 15;
        const p = s.add.circle(x, y, Phaser.Math.Between(2, 3), color).setDepth(2700);
        s.tweens.add({ targets: p, x: x + Math.cos(a) * d + (Math.random() * 10 - 5), y: y + Math.sin(a) * d + 15, alpha: 0, scale: 0.5, duration: 1000 + Math.random() * 500, ease: 'sine.inout', onComplete: () => p.destroy() });
      }
    } else if (kind === 'log' || kind === 'wood') {
      const count = Phaser.Math.Between(8, 10);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 18;
        const p = s.add.rectangle(x, y, Phaser.Math.Between(3, 5), Phaser.Math.Between(2, 3), 0x8b5a2b).setDepth(2700);
        s.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d - 5, alpha: 0, angle: Math.random() * 360, duration: 500 + Math.random() * 200, ease: 'quad.out', onComplete: () => p.destroy() });
      }
    } else if (kind === 'fish') {
      for (let i = 0; i < 2; i++) {
        const p = s.add.circle(x, y + 4, 2).setStrokeStyle(1, 0xbfe4ff).setDepth(y - 300);
        s.tweens.add({ targets: p, scale: 3 + i * 2, alpha: 0, duration: 600 + i * 200, ease: 'quad.out', onComplete: () => p.destroy() });
      }
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 15;
        const p = s.add.circle(x, y, 2, 0xbfe4ff).setDepth(2700);
        s.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d + 5, alpha: 0, scale: 0.5, duration: 400 + Math.random() * 200, ease: 'quad.out', onComplete: () => p.destroy() });
      }
    } else {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5, d = 10 + Math.random() * 14;
        const p = s.add.rectangle(x, y, 3, 3, color).setDepth(2700);
        s.tweens.add({ targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d - 8, alpha: 0, angle: 180, duration: 420 + Math.random() * 200, onComplete: () => p.destroy() });
      }
    }
    const p2 = s.add.circle(x, y, 4, 0xffffff, 0.7).setDepth(2700);
    s.tweens.add({ targets: p2, scale: 3, alpha: 0, duration: 300, onComplete: () => p2.destroy() });
  }

  // Fishing result (called by ui/FishingGame on success)
  onCatch(node, spot) {
    const s = this.scene;
    const luk = s.player.equipBonuses().luk || 0;
    const id = pickWeighted(FISH_TABLES[spot] || FISH_TABLES.pond, { golden_koi: 1 + luk * 0.05 });
    const m = matById(id);
    addMat(s, id, 1, { quiet: true, noQuest: true });
    s.quests?.onPack();
    this.burst(node.x, node.y - 4, 0xbfe4ff, 'fish');
    bus.emit(Events.SYSTEM, `You caught a ${m.name}!`);
    if (m.kind === 'fish') { bus.emit(Events.ACH_EVENT, { k: 'fish', id }); bus.emit(Events.TOAST, { title: id === 'golden_koi' ? 'Legendary catch!' : 'Caught', text: m.name, color: id === 'golden_koi' ? '#ffd84a' : '#9fd8ff' }); }
    audio.play('gold', 0.7);
    return id;
  }

  update() {
    const now = this.scene.time.now;
    for (const n of this.nodes) {
      if (!n.ready && now >= n.at) this.respawn(n);
      else if (n.ready) {
        if ((n.type.kind === 'crystal' || n.type.kind === 'herb') && Math.random() < 0.005) {
          const x = n.x + (Math.random() * 16 - 8);
          const y = n.y - (Math.random() * 16);
          const p = this.scene.add.rectangle(x, y, 2, 2, 0xffffff).setDepth(2700);
          this.scene.tweens.add({ targets: p, y: y - 10, alpha: { from: 1, to: 0 }, duration: 800, onComplete: () => p.destroy() });
        }
      }
    }
  }
}

// Seeded scatter. `area` = null (overworld) | AREAS def; `b` = built area data (rects, o) for maps.
export function placeGatherNodes(scene, area, b) {
  const g = scene.gather;
  if (!g) return;
  const key = area ? area.id : 'overworld';
  if (g.placed[key]) return;
  g.placed[key] = true;
  const rnd = mkRnd(77123 + key.length * 131 + (key.charCodeAt(0) || 1) * 17);
  const spawn = scene.spawn;
  const avoid = [];
  const free = (x, y, r = 18) => !avoid.some((a) => Math.hypot(a.x - x, a.y - y) < r + (a.r || 0));
  let rects;
  if (!area) {
    rects = scene.areas.over.solids.getChildren().map((c) => ({ x: c.body.x - 8, y: c.body.y - 8, r: c.body.x + c.body.width + 8, b: c.body.y + c.body.height + 8 }));
    for (const p of PORTALS) avoid.push({ x: p.tile.x * T + 8, y: p.tile.y * T + 8, r: 50 });
    for (const s of SIGNS) avoid.push({ x: s.tx * T + 8, y: s.ty * T + 8, r: 24 });
    for (const c of contentClearings(spawn)) avoid.push(c);
    avoid.push({ x: spawn.x + 84, y: spawn.y + 58, r: 54 });
    // ponds: solid water + fishing spot
    PONDS.forEach((p) => {
      const x = p.tx * T + 8, y = p.ty * T + 8;
      drawPond(scene, x, y);
      const wall = scene.add.rectangle(x, y + 2, 44, 20, 0xffffff, 0);
      scene.areas.over.solids.add(wall);
      g.addNode('pond', x, y + 2, null);
    });
    for (const [nodeKey, count, zone] of OVERWORLD_PLAN) {
      let placed = 0;
      for (let tries = 0; tries < count * 40 && placed < count; tries++) {
        const z = ZONES.find((zz) => zz.id === zone).rect;
        const tx = z.x + 1 + Math.floor(rnd() * (z.w - 2)), ty = z.y + 1 + Math.floor(rnd() * (z.h - 2));
        if (zoneAt(tx, ty, ZONES).id !== zone) continue;
        const x = tx * T + 8 + (rnd() - 0.5) * 6, y = ty * T + 8 + (rnd() - 0.5) * 6;
        if (rects.some((r) => x > r.x && x < r.r && y > r.y && y < r.b)) continue;
        if (!free(x, y, 16)) continue;
        g.addNode(nodeKey, x, y, null);
        avoid.push({ x, y, r: 0 });
        placed++;
      }
    }
    return;
  }
  const plan = AREA_PLAN[area.id];
  if (!plan) return;
  const o = area.origin;
  rects = (b?.rects || []).map((r) => ({ x: r.x - 8, y: r.y - 8, r: r.right + 8, b: r.bottom + 8 }));
  for (const [nodeKey, tx, ty] of plan.fixed) g.addNode(nodeKey, o.x + tx * T, o.y + ty * T, area.id);
  for (const [nodeKey, count, rr] of plan.scatter) {
    let placed = 0;
    for (let tries = 0; tries < count * 40 && placed < count; tries++) {
      const x = o.x + (rr[0] + rnd() * rr[2]) * T, y = o.y + (rr[1] + rnd() * rr[3]) * T;
      if (rects.some((r) => x > r.x && x < r.r && y > r.y && y < r.b)) continue;
      if (b?.walkable && !b.walkable(x, y)) continue; // procedural maps: skip pockets the hero can't reach
      if (!free(x, y, 22) || g.nodes.some((n) => n.area === area.id && Math.hypot(n.x - x, n.y - y) < 22)) continue;
      g.addNode(nodeKey, x, y, area.id);
      avoid.push({ x, y, r: 0 });
      placed++;
    }
  }
}

function drawPond(scene, x, y) {
  const gr = scene.add.graphics().setDepth(y - 500);
  gr.fillStyle(0x4f7c3a, 1).fillEllipse(x, y + 2, 58, 34);
  gr.fillStyle(0xd8c78a, 1).fillEllipse(x, y + 2, 52, 29);
  gr.fillStyle(0x2f86c9, 1).fillEllipse(x, y + 2, 46, 24);
  gr.fillStyle(0x5db2e8, 1).fillEllipse(x - 4, y, 30, 14);
  gr.fillStyle(0xbfe4ff, 0.7).fillRect(x - 12, y - 3, 6, 1).fillRect(x + 3, y + 3, 7, 1);
  // reeds
  gr.fillStyle(0x3f7a3a, 1).fillRect(x + 22, y - 10, 1, 8).fillRect(x + 24, y - 12, 1, 9).fillRect(x - 25, y + 6, 1, 7);
  gr.fillStyle(0x6b4426, 1).fillRect(x + 22, y - 12, 2, 3).fillRect(x + 24, y - 14, 2, 3);
}
