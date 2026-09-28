import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { JOBS } from '../data/jobs.js';
import { HAIR_COLORS, TOPS } from '../data/customization.js';
import { gearById } from '../data/gear.js';

// Modular hero: real CC0 16×16 body sprite (char.*) + customization overlays:
// hair swatch, outfit tabard tint, accessory, real in-hand weapon sprite,
// plus the gear system: equipable head/chest/weapon/trinket items with
// runtime-authored 16×16 worn overlays (see systems/gearArt.js).
const BODY_TEX = { knight: 'Knight', mangreen: 'ManGreen', sorcererorange: 'SorcererOrange', ninjadark: 'NinjaDark' };
const WEAPON_TEX = { sword: 'weapon.sword', bigSword: 'weapon.bigSword', bow: 'weapon.bow', wand: 'weapon.wand', sai: 'weapon.sai', ninjaku: 'weapon.ninjaku' };
const BASE_KIND = { sword: 'melee', bigSword: 'melee', bow: 'bow', wand: 'wand', sai: 'melee', ninjaku: 'melee' };

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
    this.level = 1; this.xp = 0; this.xpNext = 100;
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

    this.shadow = scene.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
    this.sprite = scene.add.sprite(0, -8, 'char.Knight', 0);
    this.sprite.setScale(1);
    // Outfit tabard: translucent tint so the pixel art shows through
    this.tabard = scene.add.rectangle(0, -6, 10, 7, 0x5da24a, 0.45);
    this.hair = scene.add.rectangle(0, -15, 12, 4, 0x5a3a1e);
    this.headGear = scene.add.image(0, -8, 'gear.head.straw_hat').setVisible(false);
    this.trim = scene.add.rectangle(0, -3, 10, 2, 0xffffff, 0.85).setVisible(false);
    this.acc = scene.add.rectangle(0, -3, 14, 3, 0xd35400);
    this.weapon = scene.add.image(10, -8, 'weapon.sword').setScale(1);
    this.weapon.setOrigin(0.1, 0.9);
    this.add([this.shadow, this.sprite, this.tabard, this.trim, this.hair, this.headGear, this.acc, this.weapon]);
    this.applyHero(hero);
    this.setDepth(10);
  }

  bodyKey() { return `char.${BODY_TEX[this.hero.body] || 'Knight'}`; }

  applyHero(hero) {
    this.hero = hero;
    const hc = HAIR_COLORS.find((s) => s.id === hero.hairColor) || HAIR_COLORS[1];
    const top = TOPS.find((s) => s.id === hero.top) || TOPS[0];
    const key = this.bodyKey();
    if (this.scene.textures.exists(key)) this.sprite.setTexture(key, 0);
    this.playAnim();
    this.tabard.fillColor = top.tint;
    this.hair.fillColor = hc.tint;
    this.hair.setVisible(hero.hair !== 'none');
    const widths = { none: 0, crop: 11, bob: 13, mop: 14, tail: 9, bun: 7 };
    this.hair.setSize(widths[hero.hair] ?? 12, hero.hair === 'tail' ? 7 : 4);
    this.hair.setY(hero.hair === 'bun' ? -17 : -15);
    this.acc.setVisible(hero.accessory !== 'none');
    if (hero.accessory === 'cape') { this.acc.fillColor = top.tint; this.acc.setSize(11, 9); this.acc.setPosition(-4, -8); }
    else if (hero.accessory === 'scarf') { this.acc.fillColor = 0xd35400; this.acc.setSize(13, 3); this.acc.setPosition(0, -12); }
    else if (hero.accessory === 'shades') { this.acc.fillColor = 0x111111; this.acc.setSize(9, 2); this.acc.setPosition(0, -11); }
    else if (hero.accessory === 'flower') { this.acc.fillColor = 0xff6b9d; this.acc.setSize(4, 4); this.acc.setPosition(4, -17); }
    const wtex = WEAPON_TEX[hero.weapon] || 'weapon.sword';
    if (this.scene.textures.exists(wtex)) this.weapon.setTexture(wtex);
    this.weapon.setVisible(hero.weapon !== 'none');
    this.weapon.setFlipX(this.facing === 'left');
    this.weapon.setPosition(this.facing === 'left' ? -10 : 10, -8);
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
  effAtk() { return this.atk + this.equippedStats().atk; }
  effDef() { return this.equippedStats().def; }
  effMaxHp() { return this.maxHp + this.equippedStats().hp; }
  effMaxMp() { return this.maxMp + this.equippedStats().mp; }
  effSpeed() { return this.speed + this.equippedStats().spd; }
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
    // clamp current pools to new maxima
    this.hp = Math.min(this.hp, this.effMaxHp());
    this.mp = Math.min(this.mp, this.effMaxMp());
    this.applyGearVisuals();
    return true;
  }
  unequip(slot) {
    const prev = this.equipped[slot];
    if (!prev) return false;
    this.equipped[slot] = null;
    if (gearById(prev)) this.inventory.push(prev);
    this.hp = Math.min(this.hp, this.effMaxHp());
    this.mp = Math.min(this.mp, this.effMaxMp());
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
    if (head?.hidesHair) this.hair.setVisible(false);
    else this.hair.setVisible(this.hero.hair !== 'none');
    // chest: item tint drives the tabard, trim line shows it off
    const chest = this.equipped.chest && gearById(this.equipped.chest);
    const top = TOPS.find((s) => s.id === this.hero.top) || TOPS[0];
    const tint = chest?.tint ?? top.tint;
    this.tabard.fillColor = tint;
    if (chest && chest.id !== 'worn_tunic') {
      this.trim.setVisible(true);
      this.trim.fillColor = Phaser.Display.Color.IntegerToColor(tint).brighten(40).color;
    } else this.trim.setVisible(false);
    // weapon: gear overrides base sprite with tier tint
    const w = this.equipped.weapon && gearById(this.equipped.weapon);
    const wtex = (w?.tex) || WEAPON_TEX[this.hero.weapon] || 'weapon.sword';
    if (this.scene.textures.exists(wtex)) this.weapon.setTexture(wtex);
    if (w?.tint) this.weapon.setTint(w.tint);
    else this.weapon.clearTint();
  }

  setFacing(dir) {
    const changed = dir !== this.facing;
    this.facing = dir;
    this.weapon.setFlipX(dir === 'left');
    this.weapon.setPosition(dir === 'left' ? -10 : 10, -8);
    // head overlays are front-facing art: hide when back is turned
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

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }
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
    this.xp += n;
    let leveled = false;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext; this.level += 1;
      this.xpNext = Math.floor(this.xpNext * 1.35);
      this.maxHp += 12; this.hp = this.maxHp;
      this.maxMp += 6; this.mp = this.maxMp;
      this.atk += 2; leveled = true;
    }
    return leveled;
  }
}
