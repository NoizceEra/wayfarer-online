import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { JOBS, ADVANCED } from '../data/jobs.js';
import {
  STAT_IDS, MAX_LEVEL, MAX_STAT, CLASS_CHANGE_LEVEL, SKILL_MAX, SKILL_POINTS_PER_LEVEL,
  xpToNext, statPointsForLevel, statCost, skillCdMul, newProg, computeDerived,
  SPEC_NODES_MAX, ensureSpecState, normalizeSpecNode, findSpecNode,
  specStatBonus, specSkillBoosts, specDerivedBonus, meetsClassGate,
} from '../data/stats.js';
import { sanitizeProgression } from '../core/save.js';
import { bus, Events } from '../core/events.js';
import { HAIR_COLORS, TOPS, SKINS } from '../data/customization.js';
import { gearById, getEquipBonuses, equipBlock, SLOTS } from '../data/gear.js';
import { bodyVariant, hairTexture, scarfTexture, faceTexture, BARE_HEAD } from '../systems/heroArt.js';
import { wearTexture, itemTint } from '../systems/gearArt.js';
import { levelUpFx } from '../systems/skillVfx.js';

// Modular hero: a real CC0 16x16 Ninja Adventure body, palette-swapped at
// runtime for skin / outfit / hair (systems/heroArt.js), so the hero has the
// same pixel quality and scale as the NPCs. On top sit a face overlay (eyes,
// markings), pixel hair, the legacy accessory, the 8-slot gear system
// (head/face/body/back/weapon/offhand/feet/charm — procedural per-facing layers
// from systems/wearArt.js, dye-aware) and the in-hand weapon posed per facing.
//
// Layering is facing-aware (see layout()):
//   down/left/right: back, [offhand], body, bodyGear, feet, acc, charm, face, hair,
//                    faceGear, headGear, [offhand: down only], weapon
//   up:              [offhand, weapon, back behind], body, bodyGear, feet, back (cape
//                    covers the back), acc, charm, hair, faceGear, headGear
// `opts.remote` builds a physics-free puppet (RemotePlayer + the equipment paper doll).
const BODY_TEX   = { knight: 'Villager', mangreen: 'ManGreen', sorcererorange: 'SorcererOrange', ninjadark: 'NinjaDark' };
const WEAPON_TEX = { sword: 'weapon.sword', bigSword: 'weapon.bigSword', bow: 'weapon.bow', wand: 'weapon.wand', sai: 'weapon.sai', ninjaku: 'weapon.ninjaku' };
const BASE_KIND  = { sword: 'melee', bigSword: 'melee', bow: 'bow', wand: 'wand', sai: 'melee', ninjaku: 'melee' };
const DIR_ANGLE  = { right: 0, down: 90, left: 180, up: 270 };
const WEAPON_FX  = { // arc look per weapon texture: radius, sweep (deg), width, colour, thrust
  'weapon.sword':    { r: 17, sweep: 120, w: 3, color: 0xfff1b0 },
  'weapon.sword2':   { r: 17, sweep: 125, w: 3, color: 0xfff1b0 },
  'weapon.katana':   { r: 17, sweep: 135, w: 2, color: 0xe6f2ff },
  'weapon.bigSword': { r: 21, sweep: 150, w: 5, color: 0xe6f2ff },
  'weapon.axe':      { r: 19, sweep: 140, w: 4, color: 0xffe6b0 },
  'weapon.hammer':   { r: 18, sweep: 110, w: 5, color: 0xffd9a0 },
  'weapon.sai':      { r: 13, sweep: 60,  w: 2, color: 0xffd9a0, thrust: true },
  'weapon.bone':     { r: 12, sweep: 60,  w: 2, color: 0xf4ecd8, thrust: true },
  'weapon.rapier':   { r: 16, sweep: 40,  w: 2, color: 0xe6f2ff, thrust: true },
  'weapon.ninjaku':  { r: 16, sweep: 200, w: 2, color: 0xd9ffd0 },
};
const isBowTex = (t) => t === 'weapon.bow' || t === 'weapon.bow2';

// Held-weapon pose per facing. In-hand sprites are vertical (hilt at top), so
// the carry pose rotates them tip-up at the hand; bows are turned sideways.
// `upright` sprites (axe/hammer/staff) are drawn head-up: same pose minus 180.
function weaponPose(tex, dir, upright) {
  if (isBowTex(tex)) {
    return {
      down:  { x: 6,  y: -4, a: 0,   behind: false },
      up:    { x: 0,  y: -6, a: 0,   behind: true },
      left:  { x: -7, y: -5, a: -90, behind: false },
      right: { x: 7,  y: -5, a: 90,  behind: false },
    }[dir];
  }
  const p = {
    down:  { x: 7,  y: -3, a: 196, behind: false },
    up:    { x: -7, y: -5, a: 164, behind: true },
    left:  { x: -6, y: -4, a: 158, behind: false },
    right: { x: 6,  y: -4, a: 202, behind: false },
  }[dir];
  return upright ? { ...p, a: p.a - 180 } : p;
}
const ACC_POS = {
  scarf:  { down: [0, -8], up: [0, -8], left: [0, -8], right: [0, -8] },
  cape:   { down: [0, -8], up: [0, -8], left: [2, -8], right: [-2, -8] },
  shades: { down: [0, -8], up: [0, -8], left: [-3, -8], right: [3, -8] },
  flower: { down: [5, -14], up: [-5, -14], left: [-3, -14], right: [3, -14] },
};

export const emptyEquipped = () => Object.fromEntries(SLOTS.map((s) => [s, null]));
// Accepts any saved/remote shape (incl. legacy chest/trinket keys) → {slot: id|null}.
export function normalizeEquipped(eq) {
  const out = emptyEquipped();
  const legacy = { chest: 'body', trinket: 'charm' };
  for (const [k, id] of Object.entries(eq || {})) {
    const slot = SLOTS.includes(k) ? k : legacy[k];
    const g = id && gearById(id);
    if (slot && g && g.slot === slot) out[slot] = id;
  }
  return out;
}

export class ModularPlayer extends Phaser.GameObjects.Container {
  constructor(scene, x, y, hero, opts = {}) {
    super(scene, x, y);
    scene.add.existing(this);
    this.hero = hero;
    this.remote = !!opts.remote;
    const job = JOBS[hero.job] || JOBS.wayfarer;
    this.job = job;
    this.maxHp = job.hp; this.hp = job.hp;
    this.maxMp = job.mp; this.mp = job.mp;
    this.atk = job.atk;
    this.level = 1; this.xp = 0; this.xpNext = xpToNext(1);
    this.prog = ensureSpecState(newProg());   // RPG progression (stats/skills/advanced class/spec), see data/stats.js
    this._specData = null; // injected spec catalogue (data/skillTrees.js); see setSpecData + docs/SPEC_ENGINE.md
    this.buff = null;        // temporary skill buff {until, atkMul, spdMul}
    this.gold = 20; this.potions = 3;
    this.tokenPoints = 0;
    this.wayfarerTokens = 0;
    this.speed = job.spd || CONFIG.playerSpeed;
    this.facing = 'down';
    this.moving = false;
    this.dead = false;
    this.invulnUntil = 0;
    this.cooldowns = {};
    this.questKills = {};
    // Gear: 8 equip slots + bag (item ids) + per-item dye ids.
    this.inventory = [];
    this.equipped = normalizeEquipped(this.remote ? hero.equipped : null);
    this.dyes = this.remote ? { ...(hero.dyes || {}) } : {};

    if (!this.remote) {
      scene.physics.add.existing(this);
      this.body.setSize(12, 12);
      this.body.setOffset(-6, -2);
    }

    this.shadow = scene.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
    this.rig    = scene.add.container(0, 0); // everything that bobs
    this.sprite = scene.add.sprite(0, -8, 'char.Villager', 0);
    const layer = () => scene.add.image(0, -8, 'char.shadow').setVisible(false);
    this.hair   = layer();
    this.face   = layer();
    this.L = Object.fromEntries(['head', 'face', 'body', 'back', 'offhand', 'feet', 'charm'].map((k) => [k, layer()]));
    this.acc    = scene.add.image(0, -8, 'acc.scarf').setVisible(false);
    this.weapon = scene.add.image(6, -4, 'weapon.sword').setOrigin(0.5, 0.25);
    this.add([this.shadow, this.rig]);

    this.applyHero(hero);
    this.setDepth(10);
    this.startBob();
    this.recalc(true);
  }

  // — RPG progression —
  advClass() { return this.prog.adv ? ADVANCED[this.prog.adv] : null; }
  // Recompute derived stats (maxHp/maxMp/atk/speed) from level + stats + class.
  // Spec flat bonuses (STAT_IDS-only) ride in the computeDerived `bonus`, the
  // same channel adv.bonus uses via totalStats — gear atk/def/hp/mp/spd untouched.
  specBonus() { try { return specStatBonus(this.prog.nodes, (id) => this.resolveSpecNode(id)); } catch { return {}; } }
  combinedBonuses() { return { ...this.equipBonuses(), ...this.specBonus() }; }
  recalc(fill = false) {
    // Spec derived-slot deltas (hpMul/mpMul/crit/aspd/move) ride an adv-like
    // overlay so they use the exact slots computeDerived already reads.
    let adv = this.advClass();
    try {
      const s = specDerivedBonus(this.prog.nodes, (id) => this.resolveSpecNode(id));
      if (s && (s.hpMul !== 1 || s.mpMul !== 1 || s.crit || s.aspd || s.move)) {
        adv = {
          ...(adv || {}),
          hpMul: (adv?.hpMul || 1) * s.hpMul, mpMul: (adv?.mpMul || 1) * s.mpMul,
          crit: (adv?.crit || 0) + s.crit, aspd: (adv?.aspd || 0) + s.aspd, move: (adv?.move || 0) + s.move,
        };
      }
    } catch { adv = this.advClass(); }
    this.derived = computeDerived({ job: this.job, adv, level: this.level, alloc: this.prog.alloc, weaponKind: this.weaponKind(), bonus: this.combinedBonuses() });
    this.maxHp = this.derived.maxHp; this.maxMp = this.derived.maxMp;
    this.atk = this.derived.atk; this.speed = this.derived.moveSpeed;
    if (fill) { this.hp = this.effMaxHp(); this.mp = this.effMaxMp(); }
    else { this.hp = Math.min(this.hp, this.effMaxHp()); this.mp = Math.min(this.mp, this.effMaxMp()); }
  }
  applyProgression(raw) {
    this.prog = ensureSpecState(sanitizeProgression(raw, this.level, this.job.id));
    this.xpNext = xpToNext(this.level);
    this.recalc(true);
  }
  // — Specialization (spec catalogue injected; never statically imported) —
  // Wiring (see docs/SPEC_ENGINE.md): scene calls player.setSpecData(trees) once
  // data/skillTrees.js lands, or sets globalThis.__WAYFARER_SKILL_TREES__. Until
  // then every spec op safely no-ops (unknown ids → null → buy returns false).
  setSpecData(data) { this._specData = data || null; return this; }
  specData() { return this._specData || (typeof globalThis !== 'undefined' && globalThis.__WAYFARER_SKILL_TREES__) || null; }
  resolveSpecNode(id) {
    try {
      const data = this.specData();
      if (!data) return null;
      if (typeof data === 'function') return normalizeSpecNode(data(id));
      return normalizeSpecNode(findSpecNode(data, id));
    } catch { return null; }
  }
  // Base abilities (keys 1-4) + advanced-class abilities (keys 5-6).
  skillList() { return [...this.job.abilities, ...(this.advClass()?.abilities || [])]; }
  abilityForKey(k) { return this.skillList().find((a) => a.key === String(k)) || null; }
  // Base skills start at Lv1; advanced skills at Lv0 until learned with a skill point.
  // Spec path skill-level boosts stack on top, capped at SKILL_MAX (unknown ids ignored).
  skillLv(id) {
    const base = this.job.abilities.some((a) => a.id === id) ? 1 : 0;
    let boost = 0;
    try {
      const boosts = specSkillBoosts(this.prog.nodes, (nid) => this.resolveSpecNode(nid));
      boost = boosts[id] || 0;
    } catch { boost = 0; }
    return Math.min(SKILL_MAX, Math.max(base, this.prog.skills[id] || 0) + boost);
  }
  skillCd(ab) { return ab.cd * skillCdMul(this.skillLv(ab.id)); }
  buffMul(k) { return this.buff && this.scene.time.now < this.buff.until ? (this.buff[k] || 1) : 1; }
  attackDelay() { return this.derived.attackDelay; }
  // Crit roll on outgoing damage (shows a CRIT! tag). Returns final damage.
  rollCrit(dmg) {
    if (Math.random() * 100 >= this.derived.crit) return dmg;
    this.scene.damageNumber?.(this.x, this.y - 14, 'CRIT!', '#ffd24a');
    return dmg * 1.5;
  }
  tryDodge() {
    const now = this.scene.time.now;
    if (now < this.invulnUntil || this.dead || Math.random() * 100 >= this.derived.dodge) return false;
    this.invulnUntil = now + 400;
    this.scene.damageNumber?.(this.x, this.y - 6, 'Miss', '#9bd0ff');
    return true;
  }
  _emitProgress() { bus.emit(Events.PROGRESS, { level: this.level, statPoints: this.prog.statPoints, skillPoints: this.prog.skillPoints, adv: this.prog.adv, paths: { ...this.prog.paths }, nodes: (this.prog.nodes || []).length }); }
  canChooseClass() { return this.level >= CLASS_CHANGE_LEVEL && !this.prog.adv; }
  // Path-investment gate for an advanced class (data contract, tolerant):
  // adv.specGate first, then a catalogue-level gate map. No gate data → true.
  classGateStatus(id) {
    try {
      const adv = ADVANCED[id];
      if (!adv) return { ok: false, reason: 'unknown' };
      const data = this.specData();
      const gate = adv.specGate ?? adv.gate ?? adv.reqSpec ?? adv.pathGate ?? data?.advGates?.[id] ?? data?.classGates?.[id] ?? null;
      const ok = meetsClassGate(adv, this.prog, gate);
      return ok ? { ok: true } : { ok: false, reason: 'path', gate };
    } catch { return { ok: true }; }
  }
  chooseClass(id) {
    const adv = ADVANCED[id];
    if (!adv || adv.base !== this.job.id || !this.canChooseClass()) return false;
    try { if (!this.classGateStatus(id).ok) return false; } catch { /* gate never blocks on error */ }
    this.prog.adv = id;
    this.recalc(true);
    this._emitProgress();
    return true;
  }
  // Buy a specialization node: validates level, skill points, prereq order and
  // base-job match; deducts, records, recalcs, emits. Returns true/false, never throws.
  buySpecNode(nodeId) {
    try {
      if (typeof nodeId !== 'string' || !nodeId) return false;
      ensureSpecState(this.prog);
      if ((this.prog.nodes || []).includes(nodeId)) return false;
      if ((this.prog.nodes || []).length >= SPEC_NODES_MAX) return false;
      const def = this.resolveSpecNode(nodeId);
      if (!def) return false;
      if (def.base && !def.base.includes(this.job.id)) return false;
      if (this.level < def.reqLv) return false;
      if ((this.prog.skillPoints || 0) < def.cost) return false;
      for (const pre of def.prereq) if (!(this.prog.nodes || []).includes(pre)) return false;
      this.prog.skillPoints -= def.cost;
      this.prog.nodes.push(def.id);
      if (def.path) this.prog.paths[def.path] = (this.prog.paths[def.path] || 0) + 1;
      this.recalc();
      this._emitProgress();
      return true;
    } catch { return false; }
  }
  // Gold-sink respec price: 500g x (times-respecced + 1). Never throws.
  respecCost() {
    try {
      const n = Number.isFinite(+this.prog?.respecs) ? Math.min(999, Math.max(0, Math.floor(+this.prog.respecs))) : 0;
      return 500 * (n + 1);
    } catch { return 500; }
  }
  // Reset specializations: requires level>=10 (CLASS_CHANGE_LEVEL), costs
  // respecCost() gold via the same direct `gold -= price` path merchants use
  // (see world/townfolk.js, world/areaBuilders.js — no spendGold helper exists).
  // On success clears prog.nodes, zeroes prog.paths, bumps prog.respecs,
  // recalcs, emits. Spent skill points are NOT refunded (no refund path exists).
  // Returns true/false, never throws. No-op (false, no charge) when idle
  // (nothing owned) or when gold/level gates fail.
  resetSpec() {
    try {
      ensureSpecState(this.prog);
      if (this.level < CLASS_CHANGE_LEVEL) return false;
      const owned = Array.isArray(this.prog.nodes) ? this.prog.nodes.length : 0;
      const paths = this.prog.paths || {};
      const invested = (paths.might | 0) + (paths.ward | 0) + (paths.spirit | 0);
      if (!owned && !invested) return false;
      const n = Number.isFinite(+this.prog.respecs) ? Math.min(999, Math.max(0, Math.floor(+this.prog.respecs))) : 0;
      this.prog.respecs = n;
      const cost = 500 * (n + 1);
      const gold = Number.isFinite(+this.gold) ? Math.floor(+this.gold) : 0;
      if (gold < cost) return false;
      this.gold = gold - cost;
      this.prog.nodes = [];
      this.prog.paths = { might: 0, ward: 0, spirit: 0 };
      this.prog.respecs = n + 1;
      this.recalc();
      this._emitProgress();
      return true;
    } catch { return false; }
  }
  // Commit staged stat increments ({str:+n,...}); validates cost against points.
  applyStats(delta) {
    let cost = 0;
    const alloc = { ...this.prog.alloc };
    for (const s of STAT_IDS) {
      for (let i = 0; i < Math.max(0, delta[s] || 0); i++) {
        const cur = (this.job.base[s] || 5) + alloc[s];
        if (cur >= MAX_STAT) break;
        cost += statCost(cur); alloc[s] += 1;
      }
    }
    if (cost > this.prog.statPoints) return false;
    this.prog.alloc = alloc; this.prog.statPoints -= cost;
    this.recalc();
    this._emitProgress();
    return true;
  }
  upgradeSkill(id) {
    const ab = this.skillList().find((a) => a.id === id);
    const lv = this.prog.skills[id] || 0;
    const min = this.job.abilities.some((a) => a.id === id) ? 1 : 0;
    if (!ab || this.prog.skillPoints < 1 || Math.max(lv, min) >= SKILL_MAX) return false;
    this.prog.skills[id] = Math.max(lv, min) + 1;
    this.prog.skillPoints -= 1;
    this._emitProgress();
    return true;
  }

  bodyName() { return BODY_TEX[this.hero.body] || 'Villager'; }
  bodyKey()  { return `char.${this.bodyName()}`; }

  // Active recoloured sheet key for the current hero (skin / outfit / hair).
  variantKey() {
    const skin  = SKINS.find((s) => s.id === this.hero.skin) || SKINS[3];
    const top   = TOPS.find((s) => s.id === this.hero.top) || TOPS[0];
    const hc    = HAIR_COLORS.find((s) => s.id === this.hero.hairColor) || HAIR_COLORS[1];
    return bodyVariant(this.scene, this.bodyName(), skin.tint, top.tint, hc.tint);
  }

  // look: optional {equipped, dyes} (remote players / paper doll push it in).
  applyHero(hero, look) {
    this.hero = hero;
    if (look) this.setLook(look, true);
    else if (this.remote && hero.equipped) this.setLook({ equipped: hero.equipped, dyes: hero.dyes }, true);
    this.refreshLook();
    this.applyGearVisuals();
  }

  // Equipment state that other clients need (sent over the existing 'hero' message).
  lookState() { return { equipped: { ...this.equipped }, dyes: { ...this.dyes } }; }
  lookHero() { return { ...this.hero, ...this.lookState() }; }
  setLook(look, silent) {
    this.equipped = normalizeEquipped(look.equipped);
    this.dyes = { ...(look.dyes || {}) };
    if (!silent) this.applyGearVisuals();
  }

  refreshLook() {
    this.vkey = this.variantKey();
    if (this.scene.textures.exists(this.vkey)) this.sprite.setTexture(this.vkey, 0);
    this.playAnim();
    this.refreshHair();
    this.refreshFace();
    this.refreshAcc();
    this.refreshWeapon();
    this.layout();
  }

  headItem() { return this.equipped.head && gearById(this.equipped.head); }

  refreshHair() {
    const hero = this.hero;
    const hc = HAIR_COLORS.find((s) => s.id === hero.hairColor) || HAIR_COLORS[1];
    const head = this.headItem();
    const on = BARE_HEAD[this.bodyName()] && hero.hair && hero.hair !== 'none' && !head?.hidesHair;
    this.hairOn = !!on;
    if (on) this.hair.setTexture(hairTexture(this.scene, hero.hair, this.facing, hc.tint));
    this.hair.setVisible(!!on);
  }

  // Eyes + markings overlay (Villager head only; other bodies have painted faces).
  refreshFace() {
    const skin = SKINS.find((s) => s.id === this.hero.skin) || SKINS[3];
    const k = BARE_HEAD[this.bodyName()] ? faceTexture(this.scene, this.hero, this.facing, skin.tint) : null;
    if (k) this.face.setTexture(k).setVisible(true); else this.face.setVisible(false);
  }

  refreshAcc() {
    const a = this.hero.accessory;
    const top = TOPS.find((s) => s.id === this.hero.top) || TOPS[0];
    this.acc.setVisible(a && a !== 'none');
    if (!a || a === 'none') return;
    this.acc.setTexture(a === 'scarf' ? scarfTexture(this.scene, this.facing) : `acc.${a}`);
    if (a === 'cape') this.acc.setTint(top.tint); else this.acc.clearTint();
    const [ax, ay] = ACC_POS[a][this.facing];
    this.acc.setPosition(ax, ay);
    this.acc.setFlipX(this.facing === 'left' && a !== 'shades');
    // shades hide from behind; flower only on the face side
    if (a === 'shades' && this.facing === 'up') this.acc.setVisible(false);
  }

  // Worn layers for the 7 visual slots in the current facing.
  refreshWear() {
    const head = this.headItem();
    for (const slot of Object.keys(this.L)) {
      const img = this.L[slot];
      const item = this.equipped[slot] && gearById(this.equipped[slot]);
      let k = null;
      if (item && !(slot === 'face' && head?.hidesFace)) k = wearTexture(this.scene, item, this.facing, itemTint(item, this.dyes[item.id]));
      if (k) img.setTexture(k).setVisible(true); else img.setVisible(false);
    }
    // a legacy cape accessory would z-fight a real back item
    this.acc.setAlpha(this.equipped.back && this.hero.accessory === 'cape' ? 0 : 1);
  }

  weaponItem() { return this.equipped.weapon && gearById(this.equipped.weapon); }
  weaponTex() {
    const w = this.weaponItem();
    return (w?.tex) || WEAPON_TEX[this.hero.weapon] || 'weapon.sword';
  }

  refreshWeapon() {
    const w = this.weaponItem();
    const tex = this.weaponTex();
    if (this.scene.textures.exists(tex)) this.weapon.setTexture(tex);
    this.weapon.setOrigin(0.5, w?.upright ? 0.85 : 0.25);
    const t = w ? itemTint(w, this.dyes[w.id]) : 0xffffff;
    if (t !== 0xffffff) this.weapon.setTint(t); else this.weapon.clearTint();
    this.weapon.setVisible(this.hero.weapon !== 'none' || !!w);
    this.poseWeapon();
  }

  poseWeapon() {
    const p = weaponPose(this.weaponTex(), this.facing, this.weaponItem()?.upright);
    this.weapon.setPosition(p.x, p.y).setAngle(p.a);
    this.weaponRest = p;
  }

  // Facing-aware draw order.
  layout() {
    const p = this.weaponRest || weaponPose(this.weaponTex(), this.facing, this.weaponItem()?.upright);
    const d = this.facing, up = d === 'up';
    const capeBehind = this.hero.accessory === 'cape' && !up;
    const L = this.L;
    const back = [];
    if (!up) back.push(L.back);
    if (up) back.push(L.offhand);
    if (p.behind) back.push(this.weapon);
    if (capeBehind) back.push(this.acc);
    const front = [L.body, L.feet];
    if (up) front.push(L.back);
    if (!capeBehind) front.push(this.acc);
    front.push(L.charm, this.face, this.hair, L.face, L.head);
    if (!up) front.push(L.offhand);
    if (!p.behind) front.push(this.weapon);
    this.rig.removeAll(false);
    this.rig.add([...back, this.sprite, ...front]);
  }

  // — gear —
  equipBonuses() { return getEquipBonuses(this.equipped); }
  equippedStats() { return this.equipBonuses(); }
  effAtk()   { return ((this.weaponKind() === 'wand' ? this.derived.matk : this.atk) + this.equipBonuses().atk) * this.buffMul('atkMul'); }
  effDef()   { return this.derived.def + this.equipBonuses().def; }
  effMaxHp() { return this.maxHp + this.equipBonuses().hp; }
  effMaxMp() { return this.maxMp + this.equipBonuses().mp; }
  effSpeed() { return (this.speed + this.equipBonuses().spd) * this.buffMul('spdMul'); }
  weaponKind() {
    const g = this.weaponItem();
    if (g?.kind) return g.kind;
    return BASE_KIND[this.hero.weapon] || 'melee';
  }
  // null when equippable, else the reason (level / class gate).
  equipBlockReason(id) { return equipBlock(gearById(id), this.level, this.job.id); }
  equip(id, force) {
    const g = gearById(id);
    if (!g) return false;
    this.lastBlock = force ? null : this.equipBlockReason(id);
    if (this.lastBlock) return false;
    const prev = this.equipped[g.slot] || null;
    this.equipped[g.slot] = id;
    const i = this.inventory.indexOf(id);
    if (i >= 0) this.inventory.splice(i, 1);
    if (prev && gearById(prev) && prev !== id) this.inventory.push(prev);
    this.recalc(); // gear changes stats (STR..LUK), weapon kind changes ATK/MATK basis; clamps HP/MP
    this.applyGearVisuals();
    this.onLookChange?.();
    return true;
  }
  unequip(slot) {
    const prev = this.equipped[slot];
    if (!prev) return false;
    this.equipped[slot] = null;
    if (gearById(prev)) this.inventory.push(prev);
    this.recalc();
    this.applyGearVisuals();
    this.onLookChange?.();
    return true;
  }
  setDye(itemId, dyeId) {
    if (dyeId) this.dyes[itemId] = dyeId; else delete this.dyes[itemId];
    this.applyGearVisuals();
    this.onLookChange?.();
  }
  clampVitals() {
    this.hp = Math.min(this.hp, this.effMaxHp());
    this.mp = Math.min(this.mp, this.effMaxMp());
  }
  applyGearVisuals() {
    this.refreshHair();
    this.refreshWear();
    this.refreshWeapon();
    this.layout();
  }

  setFacing(dir) {
    const changed = dir !== this.facing;
    this.facing = dir;
    if (!changed) return;
    this.refreshHair();
    this.refreshFace();
    this.refreshAcc();
    this.refreshWear();
    this.poseWeapon();
    this.layout();
    this.playAnim();
  }

  setMoving(moving) {
    if (moving === this.moving) return;
    this.moving = moving;
    this.playAnim();
    this.startBob();
    if (this.dustEvt) { this.dustEvt.remove(false); this.dustEvt = null; }
    if (moving && !this.noDust) {
      this.dustEvt = this.scene.time.addEvent({ delay: 210, loop: true, callback: () => this.puff() });
    }
  }

  playAnim() {
    const k = this.vkey || this.bodyKey();
    const key = `${k}.${this.moving ? 'walk' : 'idle'}.${this.facing}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
  }

  // Idle breathing bob / walking hop on the rig (shadow stays planted).
  startBob() {
    if (this.bobTween) { this.bobTween.remove(); this.bobTween = null; }
    this.rig.y = 0;
    this.bobTween = this.scene.tweens.add({
      targets: this.rig, y: this.moving ? -1 : -1,
      duration: this.moving ? 130 : 620, yoyo: true, repeat: -1, ease: 'sine.inout',
    });
  }

  // Small dust puff at the feet while walking.
  puff() {
    const s = this.scene;
    if (this.noDust || !s || !s.anims.exists('fx.dust') || !this.active) return;
    const sc = Math.abs(this.scaleX) || 1;
    const back = { right: -1, left: 1, down: 0, up: 0 }[this.facing];
    const sp = s.add.sprite(this.x + back * 4 * sc, this.y + 2 * sc, 'fx.dust', 0)
      .setScale(0.45 * sc).setAlpha(0.75).setDepth((this.depth || 10) - 0.5);
    if (this.facing === 'up') sp.setDepth(this.depth + 0.5);
    sp.setTint(0xe8e0b8);
    sp.play('fx.dust');
    sp.once('animationcomplete', () => sp.destroy());
  }

  attackPose() {
    const dir = this.facing;
    this._atkUntil = this.scene.time.now + 210;
    const key = `${this.vkey || this.bodyKey()}.attack.${dir}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    this.scene.time.delayedCall(150, () => this.playAnim());
    const tex = this.weaponTex();
    const kind = this.weaponKind();
    const rest = this.weaponRest || weaponPose(tex, dir, this.weaponItem()?.upright);
    const sgn = dir === 'left' || dir === 'up' ? -1 : 1;
    this.scene.tweens.killTweensOf(this.weapon);
    const w = this.weapon;
    const fwd = { right: [3, 0], left: [-3, 0], down: [0, 3], up: [0, -3] }[dir];
    if (kind === 'bow') {
      this.scene.tweens.add({ targets: w, x: rest.x - fwd[0], y: rest.y - fwd[1], duration: 70, yoyo: true, onComplete: () => this.poseWeapon() });
    } else if (kind === 'wand') {
      this.scene.tweens.add({ targets: w, angle: rest.a + sgn * 50, x: rest.x + fwd[0], y: rest.y + fwd[1], duration: 80, yoyo: true, onComplete: () => this.poseWeapon() });
    } else {
      w.setAngle(rest.a - sgn * 70);
      this.scene.tweens.add({
        targets: w, angle: rest.a + sgn * 70, x: rest.x + fwd[0], y: rest.y + fwd[1], duration: 95, ease: 'quad.out',
        onComplete: () => this.scene.tweens.add({ targets: w, angle: rest.a, x: rest.x, y: rest.y, duration: 110, onComplete: () => this.poseWeapon() }),
      });
    }
    this.weaponFx(tex, kind, dir);
  }

  // Slash / thrust / shot visuals that match the equipped weapon.
  weaponFx(tex, kind, dir) {
    const s = this.scene;
    const sc = Math.abs(this.scaleX) || 1;
    const gw = this.weaponItem();
    const base = WEAPON_FX[tex] || WEAPON_FX['weapon.sword'];
    const wt = gw ? itemTint(gw, this.dyes[gw.id]) : 0xffffff;
    const color = wt !== 0xffffff ? wt : base.color;
    const ang = Phaser.Math.DegToRad(DIR_ANGLE[dir]);
    const ox = this.x, oy = this.y - 7 * sc;
    if (kind === 'bow' || kind === 'wand') {
      const tip = 11 * sc;
      const fx = s.add.circle(ox + Math.cos(ang) * tip, oy + Math.sin(ang) * tip, 3 * sc, kind === 'wand' ? (wt !== 0xffffff ? wt : 0xffb36b) : 0xfff1b0, 0.95)
        .setDepth((this.depth || 10) + 1);
      s.tweens.add({ targets: fx, scale: 2.6, alpha: 0, duration: 170, onComplete: () => fx.destroy() });
      return;
    }
    const g = s.add.graphics({ x: ox, y: oy }).setDepth((this.depth || 10) + 1);
    const half = Phaser.Math.DegToRad(base.sweep / 2);
    const r = base.r * sc;
    if (base.thrust) {
      // quick double thrust lines
      for (const off of [-2, 2]) {
        g.lineStyle(base.w * sc, color, 0.95);
        const px = -Math.sin(ang) * off * sc, py = Math.cos(ang) * off * sc;
        g.lineBetween(px + Math.cos(ang) * 6 * sc, py + Math.sin(ang) * 6 * sc, px + Math.cos(ang) * r, py + Math.sin(ang) * r);
      }
      s.tweens.add({ targets: g, alpha: 0, duration: 140, onComplete: () => g.destroy() });
      return;
    }
    // crescent made of 3 stacked strokes: soft glow, body, bright core
    [[base.w * 2.6, 0.22, color], [base.w * 1.4, 0.55, color], [Math.max(1, base.w * 0.6), 0.95, 0xffffff]].forEach(([w, a, c]) => {
      g.lineStyle(w * sc, c, a);
      g.beginPath();
      g.arc(0, 0, r, ang - half, ang + half, false);
      g.strokePath();
    });
    g.setRotation(-0.35);
    s.tweens.add({
      targets: g, rotation: 0.35, alpha: 0, scale: 1.12, duration: tex === 'weapon.ninjaku' ? 190 : 150, ease: 'quad.out',
      onComplete: () => g.destroy(),
    });
  }

  flash(color = 0xffffff) {
    this.sprite.setTintFill(color);
    this.scene.time.delayedCall(90, () => { if (!this.sprite.active) return; this.sprite.setTint(0xff7a7a); this.scene.time.delayedCall(110, () => this.sprite.active && this.sprite.clearTint()); });
  }

  // — pose polish (all tween the rig / weapon only, so remote puppets get them for free) —
  // Cast: weapon raised with a pulsing glow at its tip, slight rise on the rig.
  castPose(color = 0xffd9a0) {
    const s = this.scene, now = s.time.now;
    if (!this.active || this.dead || now < (this._atkUntil || 0)) return;
    this._castUntil = now + 260;
    const rest = this.weaponRest || weaponPose(this.weaponTex(), this.facing, this.weaponItem()?.upright);
    s.tweens.killTweensOf(this.weapon);
    const w = this.weapon;
    s.tweens.add({ targets: w, y: rest.y - 4, angle: rest.a + (this.facing === 'left' || this.facing === 'up' ? -28 : 28), duration: 110, yoyo: true, hold: 70, ease: 'quad.out', onComplete: () => this.poseWeapon() });
    s.tweens.add({ targets: this.rig, scaleY: 1.06, scaleX: 0.97, duration: 110, yoyo: true, hold: 60, onComplete: () => { this.rig.setScale(1); } });
    const tip = s.add.circle(this.x + (this.facing === 'left' ? -6 : this.facing === 'right' ? 6 : 4), this.y - 14, 3, color, 0.95)
      .setDepth((this.depth || 10) + 1).setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: tip, scale: 3.4, alpha: 0, duration: 260, onComplete: () => tip.destroy() });
  }
  // Hurt flinch: squash + recoil jolt (flash() is white then red).
  flinch() {
    if (!this.active || !this.rig.active) return;
    const s = this.scene;
    s.tweens.killTweensOf(this.rig);
    const dx = { left: 2, right: -2, up: 0, down: 0 }[this.facing] ?? 0;
    this.rig.setScale(1.08, 0.88); this.rig.x = dx;
    s.tweens.add({ targets: this.rig, scaleX: 1, scaleY: 1, x: 0, duration: 160, ease: 'back.out', onComplete: () => { this.rig.setScale(1); this.rig.x = 0; this.startBob(); } });
  }
  // Death collapse: topple sideways at the feet, shadow widens, hero dims.
  deathCollapse() {
    const s = this.scene;
    if (this.bobTween) { this.bobTween.remove(); this.bobTween = null; }
    s.tweens.killTweensOf(this.rig);
    const sgn = this.facing === 'left' ? -1 : 1;
    this.rig.setScale(1).setAngle(0);
    s.tweens.add({ targets: this.rig, angle: 86 * sgn, y: 4, duration: 320, ease: 'bounce.out' });
    s.tweens.add({ targets: this.shadow, scaleX: 2, duration: 320 });
    this.weapon.setAlpha(0.8);
  }
  revivePose() {
    if (!this.rig?.active) return;
    this.scene.tweens.killTweensOf(this.rig);
    this.scene.tweens.add({ targets: this.rig, angle: 0, y: 0, duration: 180, ease: 'quad.out', onComplete: () => { this.rig.setAngle(0); this.startBob(); } });
    this.shadow.setScale(1.4, 1);
    this.weapon.setAlpha(1);
  }
  // Level-up: a small hop + stretch as the light pillar rises (skillVfx.levelUpFx).
  levelPose() {
    if (!this.active || this.dead) return;
    const s = this.scene;
    s.tweens.killTweensOf(this.rig);
    s.tweens.add({ targets: this.rig, y: -7, scaleY: 1.1, scaleX: 0.94, duration: 160, yoyo: true, ease: 'quad.out', onComplete: () => { this.rig.setScale(1); this.startBob(); } });
  }

  destroy(fromScene) {
    if (this.dustEvt) this.dustEvt.remove(false);
    super.destroy(fromScene);
  }

  heal(n) { this.hp = Math.min(this.effMaxHp(), this.hp + n); }
  hurt(n) {
    const now = this.scene.time.now;
    if (now < this.invulnUntil || this.dead) return false;
    this.hp -= n;
    this.invulnUntil = now + 400;
    this.flash();
    this.flinch();
    this.scene.tweens.add({ targets: this, alpha: 0.5, duration: 90, yoyo: true, repeat: 2, onComplete: () => this.setAlpha(1) });
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.scene.time.delayedCall(60, () => this.deathCollapse()); }
    return true;
  }
  gainXp(n) {
    if (this.level >= MAX_LEVEL) return false;
    this.xp += n;
    let gained = 0;
    while (this.xp >= this.xpNext && this.level < MAX_LEVEL) {
      this.xp -= this.xpNext; this.level += 1; gained += 1;
      this.xpNext = xpToNext(this.level);
      this.prog.statPoints += statPointsForLevel(this.level);
      this.prog.skillPoints += SKILL_POINTS_PER_LEVEL;
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
    if (!gained) return false;
    this.recalc(true);
    levelUpFx(this.scene, this);
    bus.emit(Events.LEVEL_UP, { level: this.level, gained, statPoints: this.prog.statPoints, skillPoints: this.prog.skillPoints, needsClass: this.canChooseClass() });
    this._emitProgress();
    return true;
  }
}
