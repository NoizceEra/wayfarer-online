// Crafting: recipes, stations (campfire / anvil / alchemy table), timed crafts,
// recipe discovery (starters, quests, scroll drops, first-gather), food/potion
// buffs and simple gear tempering. UI lives in ui/CraftPanel.js.
import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { matById } from '../data/materials.js';
import { gearById } from '../data/gear.js';
import { addMat, takeMat, matCount } from './pack.js';

export const STATIONS = {
  campfire: { id: 'campfire', name: 'Campfire', verb: 'Cook', color: '#ffb04a' },
  anvil: { id: 'anvil', name: 'Anvil', verb: 'Forge', color: '#c9d3dc' },
  alchemy: { id: 'alchemy', name: 'Alchemy Table', verb: 'Brew', color: '#7ee0a0' },
};

const FISH = ['pond_carp', 'silver_mackerel', 'harbor_eel', 'frost_trout'];
export const MAX_UPGRADE = 5;

// in: {matId:n} fixed inputs; inAny: {ids, n} any-of (first available used first)
// out: {matId:n}; upgrade: slot (tempering); fee: gold; time: seconds.
const R = (id, name, station, o) => ({ id, name, station, fee: 0, time: 3, in: {}, out: {}, ...o });
export const RECIPES = [
  // — alchemy table —
  R('herbal_tonic', 'Herbal Tonic', 'alchemy', { in: { sunpetal: 2, empty_vial: 1 }, out: { herbal_tonic: 1 }, fee: 2, time: 3, start: true, desc: 'Basic healing draught.' }),
  R('mana_draught', 'Mana Draught', 'alchemy', { in: { sunpetal: 2, slime_gel: 1, empty_vial: 1 }, out: { mana_draught: 1 }, fee: 3, time: 3, desc: 'Restores magic.' }),
  R('greater_potion', 'Greater Potion', 'alchemy', { in: { moonmoss: 2, sunpetal: 2, empty_vial: 1 }, out: { greater_potion: 1 }, fee: 8, time: 5, desc: 'Strong healing. Learn from a Scroll.' }),
  R('swift_tonic', 'Swift Tonic', 'alchemy', { in: { sunpetal: 2, bat_wing: 2, empty_vial: 1 }, out: { swift_tonic: 1 }, fee: 6, time: 4, desc: 'Move faster for 2 minutes.' }),
  R('might_elixir', 'Elixir of Might', 'alchemy', { in: { thorn_spike: 3, bogbloom: 1, empty_vial: 1 }, out: { might_elixir: 1 }, fee: 12, time: 6, desc: '+6 ATK for 3 minutes.' }),
  R('guard_elixir', 'Elixir of Warding', 'alchemy', { in: { rust_scrap: 2, moonmoss: 2, empty_vial: 1 }, out: { guard_elixir: 1 }, fee: 12, time: 6, desc: '+5 DEF for 3 minutes.' }),
  R('clover_tea', 'Four-Leaf Tea', 'alchemy', { in: { moonmoss: 2, dewberry: 2, thornberry: 1 }, out: { clover_tea: 1 }, fee: 10, time: 5, desc: '+8 LUK for 5 minutes.' }),
  // — campfire —
  R('grilled_fish', 'Grilled Fish', 'campfire', { inAny: { ids: FISH, n: 1 }, in: { oak_log: 1 }, out: { grilled_fish: 1 }, fee: 0, time: 3, start: true, desc: 'Any fish, over the fire.' }),
  R('fish_stew', 'Fish Stew', 'campfire', { inAny: { ids: FISH, n: 2 }, in: { thornberry: 1, oak_log: 1 }, out: { fish_stew: 1 }, fee: 4, time: 5, desc: 'Hearty. +DEF buff. Learn from a Scroll.' }),
  R('berry_tart', 'Berry Tart', 'campfire', { in: { dewberry: 4, sunpetal: 1, oak_log: 1 }, out: { berry_tart: 1 }, fee: 2, time: 4, desc: 'Sweet. Grants bonus max HP.' }),
  R('mushroom_skewer', 'Mushroom Skewer', 'campfire', { in: { cap_spore: 2, thornberry: 1, oak_log: 1 }, out: { mushroom_skewer: 1 }, fee: 2, time: 3, desc: 'Spirited. +ATK buff.' }),
  R('ice_broth', 'Frostbell Broth', 'campfire', { in: { frostbell: 2, oak_log: 1 }, inAny: { ids: FISH, n: 1 }, out: { ice_broth: 1 }, fee: 8, time: 5, discoverOn: 'frostbell', desc: 'Warming broth. Found by gathering Frostbell.' }),
  // — anvil —
  R('iron_ingot', 'Iron Ingot', 'anvil', { in: { iron_ore: 2, oak_log: 1 }, out: { iron_ingot: 1 }, fee: 4, time: 4, discoverOn: 'iron_ore', desc: 'Smelt ore into ingots.' }),
  R('whetstone', 'Whetstone', 'anvil', { in: { iron_ore: 1, slime_gel: 1 }, out: { whetstone: 1 }, fee: 3, time: 3, discoverOn: 'iron_ore', desc: 'Needed for tempering.' }),
  R('temper_weapon', 'Temper Weapon', 'anvil', { upgrade: 'weapon', time: 6, desc: 'Permanently +2 ATK on your equipped weapon (max +5).' }),
  R('temper_armor', 'Temper Armour', 'anvil', { upgrade: 'body', time: 6, desc: 'Permanently +1 DEF on your equipped body armour (max +5).' }),
  R('temper_helm', 'Temper Helm', 'anvil', { upgrade: 'head', time: 6, desc: 'Permanently +1 DEF on your equipped headgear (max +5).' }),
];
export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
export const START_RECIPES = RECIPES.filter((r) => r.start).map((r) => r.id);

// Tempering: bonus per level by slot
export const upgradeBonus = (slot, lv) => (slot === 'weapon' ? { atk: 2 * lv } : { def: 1 * lv });
export function upgradeCost(lv) {
  // lv = current level (0..4) -> next
  return { in: { iron_ingot: 1 + lv, whetstone: 1 }, fee: 25 * (lv + 1) };
}

// Town/area stations: [type, area|null, dx/dy from town spawn (overworld) or area tile]
export const STATION_SPOTS = [
  { type: 'alchemy', area: null, dx: 112, dy: 96 },
  { type: 'anvil', area: null, dx: -56, dy: 74 },
  { type: 'campfire', area: null, dx: 10, dy: 92 },
  { type: 'campfire', area: 'dock', tx: 28.5, ty: 16.5 },
  { type: 'campfire', area: 'frost', tx: 8, ty: 33 },
];

export class CraftSystem {
  constructor(scene) {
    this.scene = scene;
    this.buffs = [];       // {stat, amt, until, name}
    this.job = null;       // active timed craft
    this.stations = [];    // {type, area, x, y}
    this.unsaved = false;
    const meta = scene.meta;
    meta.recipes = Array.isArray(meta.recipes) ? meta.recipes.filter((id) => RECIPE_BY_ID[id]) : [];
    for (const id of START_RECIPES) if (!meta.recipes.includes(id)) meta.recipes.push(id);
    this.patchPlayer();
  }

  get meta() { return this.scene.meta; }
  recipe(id) { return RECIPE_BY_ID[id] || null; }
  known(id) { return this.meta.recipes.includes(id); }

  // Wraps the player's equipBonuses() once so buffs + tempering feed every
  // effAtk/effDef/effSpeed/effMaxHp/luck read without touching ModularPlayer.
  patchPlayer() {
    const p = this.scene.player;
    if (!p || p.__craftPatched) return;
    p.__craftPatched = true;
    const base = p.equipBonuses.bind(p);
    const sys = this;
    p.equipBonuses = function () {
      const b = base();
      const now = sys.scene.time.now;
      for (const f of sys.buffs) if (f.until > now) b[f.stat] = (b[f.stat] || 0) + f.amt;
      for (const [slot, id] of Object.entries(p.equipped || {})) {
        const lv = id && sys.meta.upg[id];
        if (!lv) continue;
        const add = upgradeBonus(slot, lv);
        for (const k of Object.keys(add)) b[k] = (b[k] || 0) + add[k];
      }
      return b;
    };
  }

  addBuff(buff) {
    const until = this.scene.time.now + buff.secs * 1000;
    this.buffs = this.buffs.filter((b) => b.stat !== buff.stat);
    this.buffs.push({ stat: buff.stat, amt: buff.amt, until, name: buff.name });
    const p = this.scene.player;
    bus.emit(Events.SYSTEM, `${buff.name}: +${buff.amt} ${buff.stat.toUpperCase()} for ${Math.round(buff.secs / 60 * 10) / 10} min.`);
    if (buff.stat === 'hp') p.heal(0);
    bus.emit(Events.PLAYER_HP, this.scene.hpPayload());
  }
  activeBuffs() { const now = this.scene.time.now; return this.buffs.filter((b) => b.until > now); }

  learn(id, info = {}) {
    const r = RECIPE_BY_ID[id];
    if (!r || this.known(id)) return false;
    this.meta.recipes.push(id);
    bus.emit(Events.SYSTEM, `Recipe learned: ${r.name}${info.from ? ` (${info.from})` : ''}! Press U to craft.`);
    bus.emit(Events.TOAST, { title: 'Recipe learned', text: r.name, color: '#9be88a' });
    audio.play('quest', 0.7);
    bus.emit(Events.CRAFT, { changed: true });
    return true;
  }
  onMatDiscovered(matId) {
    for (const r of RECIPES) if (r.discoverOn === matId && !this.known(r.id)) this.learn(r.id, { from: 'discovered' });
  }

  // — stations —
  addStation(type, area, x, y) { this.stations.push({ type, area, x, y }); }
  curArea() { return this.scene.areas?.current?.id || null; }
  near(type, radius = 64) {
    const p = this.scene.player, a = this.curArea();
    return this.stations.some((s) => s.type === type && s.area === a && Phaser.Math.Distance.Between(p.x, p.y, s.x, s.y) < radius);
  }
  nearest() {
    const p = this.scene.player, a = this.curArea();
    let best = null, bd = 90;
    for (const s of this.stations) {
      if (s.area !== a) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, s.x, s.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // Resolve inputs/fee for a recipe (upgrades are dynamic).
  needs(r) {
    if (r.upgrade) {
      const id = this.scene.player.equipped[r.upgrade];
      const lv = id ? this.meta.upg[id] || 0 : 0;
      return { in: upgradeCost(lv).in, fee: upgradeCost(lv).fee, target: id ? gearById(id) : null, lv };
    }
    return { in: r.in || {}, fee: r.fee || 0 };
  }
  // Returns {ok, reason, plan} where plan lists the exact material removals.
  check(r) {
    const p = this.scene.player;
    const n = this.needs(r);
    const plan = { ...n.in };
    if (r.upgrade) {
      if (!n.target) return { ok: false, reason: `Nothing equipped in ${r.upgrade}` };
      if (n.lv >= MAX_UPGRADE) return { ok: false, reason: 'Already +5' };
    }
    if (!this.known(r.id)) return { ok: false, reason: 'Unknown recipe' };
    if (this.job) return { ok: false, reason: 'Busy crafting' };
    if (!this.near(r.station)) return { ok: false, reason: `Need ${STATIONS[r.station].name}` };
    for (const [id, c] of Object.entries(plan)) if (matCount(this.scene, id) < c) return { ok: false, reason: `Missing ${matById(id).name}` };
    if (r.inAny) {
      let need = r.inAny.n;
      const take = {};
      for (const id of r.inAny.ids) { const have = Math.min(need, matCount(this.scene, id) - (plan[id] || 0)); if (have > 0) { take[id] = have; need -= have; } if (!need) break; }
      if (need > 0) return { ok: false, reason: 'Missing a fish' };
      for (const [id, c] of Object.entries(take)) plan[id] = (plan[id] || 0) + c;
    }
    if (p.gold < n.fee) return { ok: false, reason: `Need ${n.fee}g` };
    return { ok: true, plan, fee: n.fee };
  }
  // Static "can I hold the ingredients" (ignores station) for list colouring.
  haveAll(r) {
    const n = this.needs(r);
    for (const [id, c] of Object.entries(n.in)) if (matCount(this.scene, id) < c) return false;
    if (r.inAny) { let t = 0; for (const id of r.inAny.ids) t += matCount(this.scene, id); if (t < r.inAny.n) return false; }
    return !(r.upgrade && (!n.target || n.lv >= MAX_UPGRADE));
  }

  start(r) {
    const c = this.check(r);
    if (!c.ok) { audio.play('error', 0.6); bus.emit(Events.SYSTEM, `Cannot craft: ${c.reason}.`); return false; }
    const p = this.scene.player;
    for (const [id, n] of Object.entries(c.plan)) takeMat(this.scene, id, n);
    p.gold -= c.fee;
    const st = this.nearest();
    this.job = { r, t: 0, dur: r.time, area: this.curArea(), plan: c.plan, fee: c.fee, at: st ? { x: st.x, y: st.y } : { x: p.x, y: p.y }, target: r.upgrade ? p.equipped[r.upgrade] : null };
    audio.play('ui', 0.6);
    bus.emit(Events.PLAYER_HP, this.scene.hpPayload());
    bus.emit(Events.CRAFT, { changed: true });
    return true;
  }
  cancel(why) {
    const j = this.job;
    if (!j) return;
    for (const [id, n] of Object.entries(j.plan)) addMat(this.scene, id, n, { quiet: true, noQuest: true });
    this.scene.player.gold += j.fee;
    this.job = null;
    bus.emit(Events.SYSTEM, `Crafting cancelled${why ? ` (${why})` : ''}. Materials refunded.`);
    bus.emit(Events.PLAYER_HP, this.scene.hpPayload());
    bus.emit(Events.CRAFT, { changed: true });
  }
  finish() {
    const j = this.job, s = this.scene;
    this.job = null;
    const r = j.r;
    if (r.upgrade) {
      const id = j.target;
      const lv = (this.meta.upg[id] || 0) + 1;
      this.meta.upg[id] = lv;
      const g = gearById(id);
      bus.emit(Events.SYSTEM, `${g.name} tempered to +${lv}!`);
      bus.emit(Events.ACH_EVENT, { k: 'upgrade', lv });
      bus.emit(Events.PLAYER_HP, s.hpPayload());
    } else {
      for (const [id, n] of Object.entries(r.out)) {
        const got = addMat(s, id, n, { quiet: true, noQuest: true });
        if (!got) s.player.gold += 0; // pack cap: lost, but capped stacks are rare
        bus.emit(Events.SYSTEM, `Crafted ${matById(id).name}${n > 1 ? ` x${n}` : ''}.`);
        s.quests?.onCraft(id, n);
        bus.emit(Events.ACH_EVENT, { k: 'craft', id, n });
      }
    }
    if (r.upgrade) s.quests?.onCraft(r.id, 1);
    bus.emit(Events.ACH_EVENT, { k: 'craftAny' });
    audio.play('quest', 0.8);
    s.spawnFx?.(j.at.x, j.at.y - 10, 'fx.spark', 1.4);
    s.quests?.onPack();
    bus.emit(Events.CRAFT, { changed: true });
    s.saveNow();
  }

  update(dt) {
    const j = this.job, p = this.scene.player;
    if (!j) return;
    if (p.dead) return this.cancel('you fainted');
    if (Phaser.Math.Distance.Between(p.x, p.y, j.at.x, j.at.y) > 110 || this.curArea() !== j.area) return this.cancel('you moved away');
    j.t += dt;
    if (Math.floor(j.t * 4) !== Math.floor((j.t - dt) * 4)) bus.emit(Events.CRAFT, { tick: true });
    if (j.t >= j.dur) this.finish();
  }

  // Place procedural station props (called once per space that has them).
  buildStations(scene, where, origin) {
    const T = CONFIG.tile;
    for (const s of STATION_SPOTS) {
      if ((s.area || null) !== where) continue;
      const x = s.area ? origin.x + s.tx * T : origin.x + s.dx;
      const y = s.area ? origin.y + s.ty * T : origin.y + s.dy;
      this.addStation(s.type, s.area || null, x, y);
      drawStation(scene, s.type, x, y);
      const label = STATIONS[s.type].name;
      scene.areas.addInteract({ area: s.area || null, x, y, r: 34, label: `${STATIONS[s.type].verb} at ${label} (U)`, onUse: () => bus.emit(Events.CRAFT, { open: true, station: s.type }) });
      const t = scene.add.text(x, y - 26, label, { fontFamily: '"Silkscreen", monospace', fontSize: '7px', color: STATIONS[s.type].color, backgroundColor: '#00000088' }).setOrigin(0.5).setDepth(y + 30);
      scene.areas.addProximity({ area: s.area || null, x, y, r: 70, obj: t });
    }
  }
}

// ——— procedural station art (Graphics, y-sorted) ———
export function drawStation(scene, type, x, y) {
  const g = scene.add.graphics().setDepth(y + 6);
  const sh = scene.add.ellipse(x, y + 8, 26, 8, 0x000000, 0.25).setDepth(y + 2);
  void sh;
  if (type === 'campfire') {
    g.fillStyle(0x6d6d72, 1); for (let i = 0; i < 8; i++) g.fillRect(x + Math.cos(i * 0.785) * 9 - 2, y + 4 + Math.sin(i * 0.785) * 4 - 1, 4, 3);
    g.fillStyle(0x5a3a1a, 1).fillRect(x - 8, y + 2, 16, 3).fillRect(x - 6, y - 1, 12, 3);
    const f1 = scene.add.ellipse(x, y - 4, 10, 14, 0xff8a1a, 1).setDepth(y + 7);
    const f2 = scene.add.ellipse(x, y - 2, 5, 9, 0xffd84a, 1).setDepth(y + 8);
    scene.tweens.add({ targets: f1, scaleY: 1.25, scaleX: 0.85, duration: 180, yoyo: true, repeat: -1 });
    scene.tweens.add({ targets: f2, scaleY: 1.3, duration: 130, yoyo: true, repeat: -1 });
    const glow = scene.add.ellipse(x, y, 54, 30, 0xffa040, 0.14).setDepth(y + 1);
    scene.tweens.add({ targets: glow, alpha: 0.24, duration: 420, yoyo: true, repeat: -1 });
  } else if (type === 'anvil') {
    g.fillStyle(0x6a4a2a, 1).fillRect(x - 9, y + 2, 18, 8);          // stump
    g.fillStyle(0x8d6a3a, 1).fillRect(x - 9, y + 2, 18, 2);
    g.fillStyle(0x2a2e34, 1).fillRect(x - 11, y - 6, 22, 5).fillRect(x - 6, y - 1, 12, 4).fillRect(x - 14, y - 6, 4, 3);
    g.fillStyle(0x6a737c, 1).fillRect(x - 11, y - 6, 22, 1);
    g.fillStyle(0xff7a2a, 1).fillRect(x + 4, y - 8, 3, 2);
  } else if (type === 'alchemy') {
    g.fillStyle(0x6b4426, 1).fillRect(x - 13, y - 2, 26, 4).fillRect(x - 11, y + 2, 3, 8).fillRect(x + 8, y + 2, 3, 8);
    g.fillStyle(0x8d5a2b, 1).fillRect(x - 13, y - 2, 26, 1);
    g.fillStyle(0x2f3a30, 1).fillRect(x - 8, y - 11, 10, 9);
    g.fillStyle(0x7ee0a0, 1).fillRect(x - 7, y - 11, 8, 2);
    g.fillStyle(0xe74c3c, 1).fillRect(x + 4, y - 9, 3, 7);
    g.fillStyle(0x5d8fd8, 1).fillRect(x + 8, y - 7, 3, 5);
    g.fillStyle(0xffffff, 0.8).fillRect(x + 4, y - 9, 1, 2).fillRect(x + 8, y - 7, 1, 2);
    const bub = scene.add.circle(x - 3, y - 13, 2, 0xbff5d0, 0.9).setDepth(y + 8);
    scene.tweens.add({ targets: bub, y: y - 24, alpha: 0, duration: 1200, repeat: -1 });
  }
  return g;
}
