import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { JOBS, ADVANCED } from '../data/jobs.js';
import {
  STAT_IDS, MAX_LEVEL, MAX_STAT, CLASS_CHANGE_LEVEL, SKILL_MAX, SKILL_POINTS_PER_LEVEL,
  xpToNext, statPointsForLevel, statCost, skillCdMul, newProg, computeDerived,
} from '../data/stats.js';
import { sanitizeProgression } from '../core/save.js';
import { bus, Events } from '../core/events.js';
import { HAIR_COLORS, TOPS, SKINS } from '../data/customization.js';
import { gearById } from '../data/gear.js';
import { bodyVariant, hairTexture, scarfTexture, BARE_HEAD } from '../systems/heroArt.js';

// Modular hero: a real CC0 16x16 Ninja Adventure body, palette-swapped at
// runtime for skin / outfit / hair (systems/heroArt.js), so the hero has the
// same pixel quality and scale as the NPCs. On top sit a pixel hair overlay,
// accessory, head gear, and the in-hand weapon posed per facing.
//
// Layering is facing-aware (see layout()):
//   down/left/right: shadow, [cape], body, hair, headGear, acc, weapon
//   up:              shadow, [weapon, cape behind], body, hair, headGear, acc
const BODY_TEX   = { knight: 'Villager', mangreen: 'ManGreen', sorcererorange: 'SorcererOrange', ninjadark: 'NinjaDark' };
const WEAPON_TEX = { sword: 'weapon.sword', bigSword: 'weapon.bigSword', bow: 'weapon.bow', wand: 'weapon.wand', sai: 'weapon.sai', ninjaku: 'weapon.ninjaku' };
const BASE_KIND  = { sword: 'melee', bigSword: 'melee', bow: 'bow', wand: 'wand', sai: 'melee', ninjaku: 'melee' };
const DIR_ANGLE  = { right: 0, down: 90, left: 180, up: 270 };
const WEAPON_FX  = { // arc look per weapon texture: radius, sweep (deg), width, colour
  'weapon.sword':    { r: 17, sweep: 120, w: 3, color: 0xfff1b0 },
  'weapon.bigSword': { r: 21, sweep: 150, w: 5, color: 0xe6f2ff },
  'weapon.sai':      { r: 13, sweep: 60,  w: 2, color: 0xffd9a0 },
  'weapon.ninjaku':  { r: 16, sweep: 200, w: 2, color: 0xd9ffd0 },
};

// Held-weapon pose per facing. Sprites are vertical (hilt at top), so the
// carry pose rotates them tip-up at the hand; bows are turned sideways.
function weaponPose(tex, dir) {
  if (tex === 'weapon.bow') {
    return {
      down:  { x: 6,  y: -4, a: 0,   behind: false },
      up:    { x: 0,  y: -6, a: 0,   behind: true },
      left:  { x: -7, y: -5, a: -90, behind: false },
      right: { x: 7,  y: -5, a: 90,  behind: false },
    }[dir];
  }
  return {
    down:  { x: 7,  y: -3, a: 196, behind: false },
    up:    { x: -7, y: -5, a: 164, behind: true },
    left:  { x: -6, y: -4, a: 158, behind: false },
    right: { x: 6,  y: -4, a: 202, behind: false },
  }[dir];
}
const ACC_POS = {
  scarf:  { down: [0, -8], up: [0, -8], left: [0, -8], right: [0, -8] },
  cape:   { down: [0, -8], up: [0, -8], left: [2, -8], right: [-2, -8] },
  shades: { down: [0, -8], up: [0, -8], left: [-3, -8], right: [3, -8] },
  flower: { down: [5, -14], up: [-5, -14], left: [-3, -14], right: [3, -14] },
};

export class ModularPlayer extends Phaser.GameObjects.Container {
  constructor(scene, x, y, hero) {
    super(scene, x, y);
    scene.add.existing(this);
    this.hero = hero;
    const job = JOBS[hero.job] || JOBS.wayfarer;
    this.job = job;
    this.maxHp = job.hp; this.hp = job.hp;
    this.maxMp = job.mp; this.mp = job.mp;
    this.atk = job.atk;
    this.level = 1; this.xp = 0; this.xpNext = xpToNext(1);
    this.prog = newProg();   // RPG progression (stats/skills/advanced class), see data/stats.js
    this.buff = null;        // temporary skill buff {until, atkMul, spdMul}
    this.gold = 20; this.potions = 3;
    this.speed = job.spd || CONFIG.playerSpeed;
    this.facing = 'down';
    this.moving = false;
    this.dead = false;
    this.invulnUntil = 0;
    this.cooldowns = {};
    this.questKills = {};
    // Gear: equip slots + inventory (item ids). Chest starts equipped so the
    // outfit colour always has meaning; everything else is found/bought.
    this.inventory = [];
    this.equipped = { head: null, chest: 'worn_tunic', weapon: null, trinket: null };

    scene.physics.add.existing(this);
    this.body.setSize(12, 12);
    this.body.setOffset(-6, -2);

    this.shadow = scene.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
    this.rig    = scene.add.container(0, 0); // everything that bobs
    this.sprite = scene.add.sprite(0, -8, 'char.Villager', 0);
    this.hair   = scene.add.image(0, -8, 'char.shadow').setVisible(false);
    this.headGear = scene.add.image(0, -8, 'gear.head.straw_hat').setVisible(false);
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
  recalc(fill = false) {
    this.derived = computeDerived({ job: this.job, adv: this.advClass(), level: this.level, alloc: this.prog.alloc, weaponKind: this.weaponKind() });
    this.maxHp = this.derived.maxHp; this.maxMp = this.derived.maxMp;
    this.atk = this.derived.atk; this.speed = this.derived.moveSpeed;
    if (fill) { this.hp = this.effMaxHp(); this.mp = this.effMaxMp(); }
    else { this.hp = Math.min(this.hp, this.effMaxHp()); this.mp = Math.min(this.mp, this.effMaxMp()); }
  }
  applyProgression(raw) {
    this.prog = sanitizeProgression(raw, this.level, this.job.id);
    this.xpNext = xpToNext(this.level);
    this.recalc(true);
  }
  // Base abilities (keys 1-4) + advanced-class abilities (keys 5-6).
  skillList() { return [...this.job.abilities, ...(this.advClass()?.abilities || [])]; }
  abilityForKey(k) { return this.skillList().find((a) => a.key === String(k)) || null; }
  // Base skills start at Lv1; advanced skills at Lv0 until learned with a skill point.
  skillLv(id) {
    const base = this.job.abilities.some((a) => a.id === id) ? 1 : 0;
    return Math.max(base, this.prog.skills[id] || 0);
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
  _emitProgress() { bus.emit(Events.PROGRESS, { level: this.level, statPoints: this.prog.statPoints, skillPoints: this.prog.skillPoints, adv: this.prog.adv }); }
  canChooseClass() { return this.level >= CLASS_CHANGE_LEVEL && !this.prog.adv; }
  chooseClass(id) {
    const adv = ADVANCED[id];
    if (!adv || adv.base !== this.job.id || !this.canChooseClass()) return false;
    this.prog.adv = id;
    this.recalc(true);
    this._emitProgress();
    return true;
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

  // Active recoloured sheet key for the current hero + gear.
  variantKey() {
    const skin  = SKINS.find((s) => s.id === this.hero.skin) || SKINS[1];
    const top   = TOPS.find((s) => s.id === this.hero.top) || TOPS[0];
    const hc    = HAIR_COLORS.find((s) => s.id === this.hero.hairColor) || HAIR_COLORS[1];
    const chest = this.equipped?.chest && gearById(this.equipped.chest);
    const tint  = chest && chest.id !== 'worn_tunic' && chest.tint != null ? chest.tint : top.tint;
    return bodyVariant(this.scene, this.bodyName(), skin.tint, tint, hc.tint);
  }

  applyHero(hero) {
    this.hero = hero;
    this.refreshLook();
    this.applyGearVisuals();
  }

  refreshLook() {
    const hero = this.hero;
    this.vkey = this.variantKey();
    if (this.scene.textures.exists(this.vkey)) this.sprite.setTexture(this.vkey, 0);
    this.playAnim();
    this.refreshHair();
    this.refreshAcc();
    this.refreshWeapon();
    this.layout();
  }

  refreshHair() {
    const hero = this.hero;
    const hc = HAIR_COLORS.find((s) => s.id === hero.hairColor) || HAIR_COLORS[1];
    const head = this.equipped.head && gearById(this.equipped.head);
    const on = BARE_HEAD[this.bodyName()] && hero.hair && hero.hair !== 'none' && !head?.hidesHair;
    this.hairOn = !!on;
    if (on) this.hair.setTexture(hairTexture(this.scene, hero.hair, this.facing, hc.tint));
    this.hair.setVisible(!!on);
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

  weaponTex() {
    const w = this.equipped.weapon && gearById(this.equipped.weapon);
    return (w?.tex) || WEAPON_TEX[this.hero.weapon] || 'weapon.sword';
  }

  refreshWeapon() {
    const w = this.equipped.weapon && gearById(this.equipped.weapon);
    const tex = this.weaponTex();
    if (this.scene.textures.exists(tex)) this.weapon.setTexture(tex);
    if (w?.tint) this.weapon.setTint(w.tint); else this.weapon.clearTint();
    this.weapon.setVisible(this.hero.weapon !== 'none' || !!w);
    this.poseWeapon();
  }

  poseWeapon() {
    const p = weaponPose(this.weaponTex(), this.facing);
    this.weapon.setPosition(p.x, p.y).setAngle(p.a);
    this.weaponRest = p;
  }

  // Facing-aware draw order.
  layout() {
    const p = this.weaponRest || weaponPose(this.weaponTex(), this.facing);
    const up = this.facing === 'up';
    const capeBehind = this.hero.accessory === 'cape' && !up;
    const back = [];
    if (p.behind) back.push(this.weapon);
    if (capeBehind) back.push(this.acc);
    const front = [this.hair, this.headGear];
    if (!capeBehind) front.push(this.acc);
    if (!p.behind) front.push(this.weapon);
    this.rig.removeAll(false);
    this.rig.add([...back, this.sprite, ...front]);
  }

  // — gear —
  equippedStats() {
    const total = { atk: 0, def: 0, hp: 0, mp: 0, spd: 0 };
    for (const id of Object.values(this.equipped)) {
      const g = id && gearById(id);
      if (!g) continue;
      for (const k of Object.keys(total)) total[k] += g.stats[k] || 0;
    }
    return total;
  }
  effAtk()   { return ((this.weaponKind() === 'wand' ? this.derived.matk : this.atk) + this.equippedStats().atk) * this.buffMul('atkMul'); }
  effDef()   { return this.derived.def + this.equippedStats().def; }
  effMaxHp() { return this.maxHp + this.equippedStats().hp; }
  effMaxMp() { return this.maxMp + this.equippedStats().mp; }
  effSpeed() { return (this.speed + this.equippedStats().spd) * this.buffMul('spdMul'); }
  weaponKind() {
    const g = this.equipped.weapon && gearById(this.equipped.weapon);
    if (g?.kind) return g.kind;
    return BASE_KIND[this.hero.weapon] || 'melee';
  }
  equip(id) {
    const g = gearById(id);
    if (!g) return false;
    const prev = this.equipped[g.slot] || null;
    this.equipped[g.slot] = id;
    this.inventory = this.inventory.filter((x) => x !== id);
    if (prev && gearById(prev)) this.inventory.push(prev);
    this.recalc(); // weapon kind can change ATK vs MATK basis; also clamps HP/MP
    this.applyGearVisuals();
    return true;
  }
  unequip(slot) {
    const prev = this.equipped[slot];
    if (!prev) return false;
    this.equipped[slot] = null;
    if (gearById(prev)) this.inventory.push(prev);
    this.recalc();
    this.applyGearVisuals();
    return true;
  }
  applyGearVisuals() {
    const head = this.equipped.head && gearById(this.equipped.head);
    const hkey = head?.overlay && `gear.head.${head.overlay}`;
    if (hkey && this.scene.textures.exists(hkey)) {
      this.headGear.setTexture(hkey).setVisible(this.facing !== 'up');
      this.headGear.setFlipX(this.facing === 'left');
    } else this.headGear.setVisible(false);
    // chest tint recolours the outfit palette; hair/weapon follow gear too
    this.refreshLook();
  }

  setFacing(dir) {
    const changed = dir !== this.facing;
    this.facing = dir;
    if (!changed) return;
    const head = this.equipped.head && gearById(this.equipped.head);
    if (head?.overlay) { this.headGear.setVisible(dir !== 'up'); this.headGear.setFlipX(dir === 'left'); }
    this.refreshHair();
    this.refreshAcc();
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
    if (moving) {
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
    const key = `${this.vkey || this.bodyKey()}.attack.${dir}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    this.scene.time.delayedCall(150, () => this.playAnim());
    const tex = this.weaponTex();
    const kind = this.weaponKind();
    const rest = this.weaponRest || weaponPose(tex, dir);
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
    const gw = this.equipped.weapon && gearById(this.equipped.weapon);
    const base = WEAPON_FX[tex] || WEAPON_FX['weapon.sword'];
    const color = gw?.tint && gw.tint !== 0xffffff ? gw.tint : base.color;
    const ang = Phaser.Math.DegToRad(DIR_ANGLE[dir]);
    const ox = this.x, oy = this.y - 7 * sc;
    if (kind === 'bow' || kind === 'wand') {
      const tip = 11 * sc;
      const fx = s.add.circle(ox + Math.cos(ang) * tip, oy + Math.sin(ang) * tip, 3 * sc, kind === 'wand' ? (gw?.tint || 0xffb36b) : 0xfff1b0, 0.95)
        .setDepth((this.depth || 10) + 1);
      s.tweens.add({ targets: fx, scale: 2.6, alpha: 0, duration: 170, onComplete: () => fx.destroy() });
      return;
    }
    const g = s.add.graphics({ x: ox, y: oy }).setDepth((this.depth || 10) + 1);
    const half = Phaser.Math.DegToRad(base.sweep / 2);
    const r = base.r * sc;
    if (tex === 'weapon.sai') {
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

  flash() {
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => this.sprite.clearTint());
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
    this.scene.tweens.add({ targets: this, alpha: 0.5, duration: 90, yoyo: true, repeat: 2, onComplete: () => this.setAlpha(1) });
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
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
    bus.emit(Events.LEVEL_UP, { level: this.level, gained, statPoints: this.prog.statPoints, skillPoints: this.prog.skillPoints, needsClass: this.canChooseClass() });
    this._emitProgress();
    return true;
  }
}
