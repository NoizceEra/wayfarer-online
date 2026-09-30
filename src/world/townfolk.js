import { input } from '../core/input.js';
import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { NPCS, GENERIC_HINTS } from '../data/npcs.js';
import { AREAS } from '../data/zones.js';
import { ITEMS, giveItem, useItem, bestOwned } from '../data/items.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { AmbientLife } from './ambient.js';

const T = CONFIG.tile;

// Builds the data-driven roster (data/npcs.js) through the shared AreaManager.addNpc factory, adds
// portrait + typewriter dialogue (ui/DialogBox.js via OverlayScene.dialog), merchant menus (consumables from
// data/items.js, gear shops through the existing GEAR shop event) and the day/night schedule.
//   Thistle Town (overworld): 'sleep' NPCs fade indoors at night, 'stay' keep their posts, [dx,dy] walk to a night post.
//   Dock / Frostpeak are separate maps without a night overlay, so their folk keep daytime posts.
export function installTownfolk(scene, areas, info) {
  const folk = new Townfolk(scene, areas);
  for (const n of NPCS.filter((n) => n.area === 'town')) folk.place(n, null, { x: info.spawn.x + n.at[0], y: info.spawn.y + n.at[1] }, info.solids);
  scene.life = new AmbientLife(scene, areas, info);
  scene.townfolk = folk;
  installItemKeys(scene);
  return folk;
}

// Called by AreaManager after a map's builder ran (dock / frost).
export function populateArea(mgr, id, ctx) {
  const scene = mgr.scene;
  if (!scene.townfolk) scene.townfolk = new Townfolk(scene, mgr);
  const o = AREAS[id].origin;
  for (const n of NPCS.filter((n) => n.area === id)) scene.townfolk.place(n, id, { x: o.x + n.at[0] * T, y: o.y + n.at[1] * T }, ctx.b.group);
  scene.life?.buildArea(id, ctx);
}

class Townfolk {
  constructor(scene, areas) { this.scene = scene; this.areas = areas; this.list = []; this.wasNight = null; }

  place(n, areaId, pos, solids) {
    const hint = n.lines.length < 3 && n.role !== 'merchant' ? [...n.lines, GENERIC_HINTS[this.list.length % GENERIC_HINTS.length]] : n.lines;
    const cfg = {
      name: n.name, tex: n.sheet, x: pos.x, y: pos.y, facing: n.face || 'down',
      wander: n.wander || 0, text: hint,
      onUse: () => this.talk(n, hint),
    };
    const c = this.areas.addNpc(areaId, cfg, solids);
    const inter = this.areas.interacts.find((i) => i.ref === c);
    const rec = { n, c, inter, asleep: false, day: { x: pos.x, y: pos.y } };
    c.npcId = n.id;
    if (n.role === 'guard' || n.role === 'trainer') c.list?.[2]?.setColor?.(n.role === 'guard' ? '#ffd27a' : '#9fe8ff');
    this.list.push(rec);
    return c;
  }

  talk(n, lines) {
    const scene = this.scene;
    const o = this.areas.ov();
    const base = { name: n.name, title: n.title || ({ guard: 'Guard', trainer: 'Trainer' }[n.role]), face: scene.textures.exists(`face.${n.sheet}`) ? `face.${n.sheet}` : undefined };
    if (!o) { bus.emit(Events.SYSTEM, `${n.name}: ${lines[0]}`); return; }
    scene.uiLock = true;
    const page = (i) => {
      const last = i >= lines.length - 1;
      const options = last ? this.finalOptions(n, base, o) : [{ label: 'Next', cb: () => page(i + 1) }, { label: 'Goodbye', cb: () => {} }];
      o.dialog({ ...base, text: lines[i], options });
    };
    page(0);
  }

  finalOptions(n, base, o) {
    const scene = this.scene;
    const opts = [];
    const reopen = (text) => { scene.uiLock = true; o.dialog({ ...base, text, options: this.finalOptions(n, base, o) }); };
    for (const id of n.sells || []) {
      const it = ITEMS[id];
      if (!it) continue;
      opts.push({
        label: `Buy ${it.name} (${it.price}g)`,
        cb: () => {
          const p = scene.player;
          if (p.gold < it.price) { audio.play('error', 0.7); return reopen('Not enough gold, friend.'); }
          p.gold -= it.price; giveItem(scene, id, 1); audio.play('gold');
          bus.emit(Events.PLAYER_HP, scene.hpPayload());
          bus.emit(Events.SYSTEM, `Bought ${it.name} (${it.price}g). ${it.use ? (it.kind === 'scroll' ? 'Press Y to read.' : 'Press H to use.') : ''}`);
          reopen(`${it.name}: ${it.desc}`);
        },
      });
    }
    if (n.shop) opts.push({ label: 'Browse gear', cb: () => bus.emit(Events.GEAR, { open: 'shop', shop: n.shop }) });
    opts.push({ label: 'Goodbye', cb: () => {} });
    return opts.length === 1 ? [] : opts.slice(0, 5);
  }

  // Day/night schedule for Thistle Town folk.
  update(time, delta) {
    const night = !!this.scene.daynight?.isNight;
    if (night === this.wasNight) return;
    this.wasNight = night;
    for (const r of this.list) {
      const { n, c } = r;
      if (n.area !== 'town') continue;
      if (night && n.night === 'sleep' && !r.asleep) this.sleep(r, true);
      else if (!night && r.asleep) this.sleep(r, false);
      else if (Array.isArray(n.night) && c.w) {
        // night post: swing the wander home point
        const base = r.day;
        const to = night ? { x: base.x + 26, y: base.y - 18 } : base;
        c.w.home = { ...to }; c.w.tx = to.x; c.w.ty = to.y; c.w.wait = 0;
      }
    }
  }

  sleep(r, on) {
    const { c, inter } = r;
    r.asleep = on;
    if (inter) inter.r = on ? -1 : 30;
    if (c.body) c.body.enable = !on;
    if (c.w) c.w.wait = on ? 1e9 : 0;
    this.scene.tweens.killTweensOf(c);
    if (on) this.scene.tweens.add({ targets: c, alpha: 0, duration: 900, onComplete: () => c.setVisible(false) });
    else { c.setVisible(true); if (c.w) { c.x = r.day.x; c.y = r.day.y; /* never c.setPosition(): Phaser's Transform.w would clobber addNpc's c.w wander state */ } this.scene.tweens.add({ targets: c, alpha: 1, duration: 900 }); }
  }
}

// H = eat best food/potion from the pack, Y = read a scroll (Homecoming first).
function installItemKeys(scene) {
  const kb = scene.input.keyboard;
  const go = (kind) => {
    if (scene.chatOpen || scene.uiLock || scene.player.dead) return;
    const id = bestOwned(scene, kind === 'scroll' ? 'scroll' : 'food') || (kind === 'food' ? bestOwned(scene, 'potion') : null);
    const msg = id ? useItem(scene, id) : null;
    if (msg) { audio.play('potion'); bus.emit(Events.SYSTEM, msg); bus.emit(Events.PLAYER_HP, scene.hpPayload()); }
    else bus.emit(Events.SYSTEM, id ? (kind === 'scroll' ? 'The scroll fizzles here. (Homecoming only works outdoors.)' : 'You are already full.') : (kind === 'scroll' ? 'No scrolls in your pack.' : 'No food in your pack. Try Hopper, Lotte or the fishmonger.'));
  };
  input.registerAction({ id: 'eat', label: 'Eat food / potion', group: 'Combat', keys: ['KeyF'], gameplay: true });
  input.registerAction({ id: 'scroll', label: 'Read scroll', group: 'Combat', keys: ['KeyY'], gameplay: true });
  input.on('eat', () => { go('food'); return true; }, { scene });
  input.on('scroll', () => { go('scroll'); return true; }, { scene });
}

void Phaser;
