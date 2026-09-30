import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { JOBS, ADVANCED } from '../data/jobs.js';
import {
  STAT_IDS, MAX_LEVEL, MAX_STAT, CLASS_CHANGE_LEVEL, SKILL_MAX, SKILL_POINTS_PER_LEVEL,
  xpToNext, statPointsForLevel, statCost, skillCdMul, newProg, computeDerived,
} from '../data/stats.js';
import { sanitizeProgression } from '../core/save.js';
import { bus, Events } from '../core/events.js';
import { HAIR_COLORS, TOPS } from '../data/customization.js';
import { gearById } from '../data/gear.js';

// Modular hero: real CC0 16×16 body sprite (char.*) + customization overlays:
// hair swatch, outfit tabard tint, accessory, real in-hand weapon sprite,
// plus the gear system: equipable head/chest/weapon/trinket items with
// runtime-authored 16×16 worn overlays (see systems/gearArt.js).
//
// Overlay layering order (bottom → top):
//   shadow, sprite, tabardOutline, tabard, trim, hairOutline, hair, hairShine,
//   headGear, accOutline, acc, weapon
// Each colored overlay (hair, tabard, acc) has a 1px dark outline rect behind
// it and a 1px highlight strip on top for chunky-pixel shading consistency.
const BODY_TEX   = { knight: 'Knight', mangreen: 'ManGreen', sorcererorange: 'SorcererOrange', ninjadark: 'NinjaDark' };
const WEAPON_TEX = { sword: 'weapon.sword', bigSword: 'weapon.bigSword', bow: 'weapon.bow', wand: 'weapon.wand', sai: 'weapon.sai', ninjaku: 'weapon.ninjaku' };
const BASE_KIND  = { sword: 'melee', bigSword: 'melee', bow: 'bow', wand: 'wand', sai: 'melee', ninjaku: 'melee' };

const DARK_OUTLINE = 0x1a1a22;

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
    // tabard always has meaning; everything else is found/bought.
    this.inventory = [];
    this.equipped = { head: null, chest: 'worn_tunic', weapon: null, trinket: null };

    scene.physics.add.existing(this);
    this.body.setSize(12, 12);
    this.body.setOffset(-6, -2);

    this.shadow   = scene.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
    this.sprite   = scene.add.sprite(0, -8, 'char.Knight', 0);

    // — Tabard (chest outfit tint) with 1px dark outline behind it —
    // Alpha 0.8 so the chosen outfit colour actually reads (was 0.45 → grey wash).
    this.tabardOutline = scene.add.rectangle(0, -6, 12, 9, DARK_OUTLINE, 0.5);
    this.tabard        = scene.add.rectangle(0, -6, 10, 7, 0x5da24a, 0.8);

    // — Trim highlight (shown when non-default chest gear is equipped) —
    this.trim = scene.add.rectangle(0, -3, 10, 2, 0xffffff, 0.85).setVisible(false);

    // — Hair with dark outline behind + 1px highlight strip on top —
    this.hairOutline = scene.add.rectangle(0, -15, 14, 6, DARK_OUTLINE, 1.0);
    this.hair        = scene.add.rectangle(0, -15, 12, 4, 0x5a3a1e);
    this.hairShine   = scene.add.rectangle(-1, -16, 7, 1, 0xffffff, 0.30);

    // — Head gear overlay (generated pixel-art hat/helm texture) —
    this.headGear = scene.add.image(0, -8, 'gear.head.straw_hat').setVisible(false);

    // — Accessory sprite (real 16×16 pixel-art PNG per accessory type) —
    // accOutline kept hidden; each PNG has its own baked outline.
    this.accOutline = scene.add.rectangle(0, -3, 16, 5, DARK_OUTLINE, 0).setVisible(false);
    this.acc        = scene.add.image(0, -12, 'acc.scarf').setVisible(false);

    // — Weapon (held at hand height so it reads equipped, not floating) —
    // x=6: the sword texture carries transparent left padding, so the anchor
    // must overlap the body edge for the pixels to touch.
    this.weapon = scene.add.image(6, -4, 'weapon.sword').setScale(1);
    this.weapon.setOrigin(0.1, 0.9);

    this.add([
      this.shadow, this.sprite,
      this.tabardOutline, this.tabard, this.trim,
      this.hairOutline, this.hair, this.hairShine,
      this.headGear,
      this.accOutline, this.acc,
      this.weapon,
    ]);
    this.applyHero(hero);
    this.setDepth(10);
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

  bodyKey() { return `char.${BODY_TEX[this.hero.body] || 'Knight'}`; }

  applyHero(hero) {
    this.hero = hero;
    const hc  = HAIR_COLORS.find((s) => s.id === hero.hairColor) || HAIR_COLORS[1];
    const top = TOPS.find((s) => s.id === hero.top) || TOPS[0];
    const key = this.bodyKey();
    if (this.scene.textures.exists(key)) this.sprite.setTexture(key, 0);
    this.playAnim();

    // — Tabard —
    this.tabard.fillColor = top.tint;
    // Keep outline slightly smaller alpha when tabard is translucent
    this.tabardOutline.setVisible(true);

    // — Hair —
    this.hair.fillColor = hc.tint;
    const hairVis = hero.hair !== 'none';
    const widths  = { none: 0, crop: 11, bob: 13, mop: 14, tail: 9, bun: 7 };
    const hairW   = widths[hero.hair] ?? 12;
    const hairH   = hero.hair === 'tail' ? 7 : 4;
    const hairY   = hero.hair === 'bun' ? -17 : -15;
    this.hair.setSize(hairW, hairH).setY(hairY).setVisible(hairVis);
    this.hairOutline.setSize(hairW + 2, hairH + 2).setY(hairY).setVisible(hairVis);
    this.hairShine.setSize(Math.max(3, hairW - 4), 1).setY(hairY - 1).setVisible(hairVis);

    // — Accessory (real pixel-art sprite) —
    const accVis = hero.accessory !== 'none';
    this.acc.setVisible(accVis);
    this.accOutline.setVisible(false); // outline baked into PNG
    if (hero.accessory === 'cape') {
      // Cape reuses the outfit tint; PNG is white-based so setTint() colorizes it
      this.acc.setTexture('acc.cape').setPosition(-4, -8).setTint(top.tint);
    } else if (hero.accessory === 'scarf') {
      this.acc.setTexture('acc.scarf').setPosition(0, -12).clearTint();
    } else if (hero.accessory === 'shades') {
      this.acc.setTexture('acc.shades').setPosition(0, -11).clearTint();
    } else if (hero.accessory === 'flower') {
      this.acc.setTexture('acc.flower').setPosition(4, -17).clearTint();
    }
    this.acc.setFlipX(this.facing === 'left');

    // — Weapon —
    const wtex = WEAPON_TEX[hero.weapon] || 'weapon.sword';
    if (this.scene.textures.exists(wtex)) this.weapon.setTexture(wtex);
    this.weapon.setVisible(hero.weapon !== 'none');
    this.weapon.setFlipX(this.facing === 'left');
    this.weapon.setPosition(this.facing === 'left' ? -6 : 6, -4);

    this.applyGearVisuals();
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
    // head overlay
    const head = this.equipped.head && gearById(this.equipped.head);
    const hkey = head?.overlay && `gear.head.${head.overlay}`;
    if (hkey && this.scene.textures.exists(hkey)) {
      this.headGear.setTexture(hkey).setVisible(this.facing !== 'up');
      this.headGear.setFlipX(this.facing === 'left');
    } else this.headGear.setVisible(false);
    if (head?.hidesHair) {
      this.hair.setVisible(false);
      this.hairOutline.setVisible(false);
      this.hairShine.setVisible(false);
    } else {
      const hairVis = this.hero.hair !== 'none';
      this.hair.setVisible(hairVis);
      this.hairOutline.setVisible(hairVis);
      this.hairShine.setVisible(hairVis);
    }
    // chest: item tint drives the tabard, trim line shows it off
    const chest = this.equipped.chest && gearById(this.equipped.chest);
    const top   = TOPS.find((s) => s.id === this.hero.top) || TOPS[0];
    const tint  = chest?.tint ?? top.tint;
    this.tabard.fillColor = tint;
    if (chest && chest.id !== 'worn_tunic') {
      this.trim.setVisible(true);
      this.trim.fillColor = Phaser.Display.Color.IntegerToColor(tint).brighten(40).color;
    } else this.trim.setVisible(false);
    // weapon: gear overrides base sprite with tier tint
    const w    = this.equipped.weapon && gearById(this.equipped.weapon);
    const wtex = (w?.tex) || WEAPON_TEX[this.hero.weapon] || 'weapon.sword';
    if (this.scene.textures.exists(wtex)) this.weapon.setTexture(wtex);
    if (w?.tint) this.weapon.setTint(w.tint);
    else this.weapon.clearTint();
  }

  setFacing(dir) {
    const changed = dir !== this.facing;
    this.facing = dir;
    this.weapon.setFlipX(dir === 'left');
    this.weapon.setPosition(dir === 'left' ? -6 : 6, -4);
    this.acc.setFlipX(dir === 'left');
    const head = this.equipped.head && gearById(this.equipped.head);
    if (head?.overlay) this.headGear.setVisible(dir !== 'up');
    if (changed) this.playAnim();
  }

  setMoving(moving) {
    if (moving === this.moving) return;
    this.moving = moving;
    this.playAnim();
  }

  playAnim() {
    const key = `${this.bodyKey()}.${this.moving ? 'walk' : 'idle'}.${this.facing}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
  }

  attackPose() {
    const key = `${this.bodyKey()}.attack.${this.facing}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    this.scene.time.delayedCall(140, () => this.playAnim());
    this.scene.tweens.add({ targets: this.weapon, angle: this.facing === 'left' ? -70 : 70, duration: 90, yoyo: true, onComplete: () => this.weapon.setAngle(0) });
  }

  flash() {
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => this.sprite.clearTint());
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
