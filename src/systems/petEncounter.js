// Wild pet encounter + capture system.
// Purely additive. Spawns a non-hostile "wisp" after kills, lets the player
// capture it with a Wayfarer Orb, and persists caught pets in scene.meta.pets.roster.
import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';
import { ENEMY_TABLE } from '../data/jobs.js';
import { baseFor, makePet, PETS } from '../data/pets.js';
import { ITEMS, takeItem } from '../data/items.js';
import { audio } from './audio.js';
import { CapturePrompt } from '../ui/CapturePrompt.js';

const ENCOUNTER_CHANCE = 0.065; // 6.5% kill-roll
const WISP_LIFETIME_MS = 15000;
const INTERACT_RADIUS = 26;

export class PetEncounterSystem {
  constructor(scene) {
    this.scene = scene;
    this.wisps = []; // active capturable wisps
    this.busy = false;
    this._offKill = bus.on(Events.KILL, (payload) => this._onKill(payload));
    scene.events.once('shutdown', () => this.destroy());
  }

  destroy() {
    if (this._offKill) { this._offKill(); this._offKill = null; }
    for (const w of this.wisps) this._destroyWisp(w);
    this.wisps = [];
    if (this.prompt) { this.prompt.destroy(); this.prompt = null; }
  }

  update() {
    const s = this.scene;
    const now = s.time.now;
    const p = s.player;
    const here = s.areas?.current?.id || null;

    // expire old wisps
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const w = this.wisps[i];
      if (!w.active || now >= w.expiresAt) {
        this._fadeOutWisp(w);
        this.wisps.splice(i, 1);
      }
    }

    if (!p || p.dead || this.busy || s.uiLock) return;

    // find nearest wisp in range
    let best = null, bd = INTERACT_RADIUS;
    for (const w of this.wisps) {
      if (w.areaId !== here) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, w.x, w.y);
      if (d < bd) { bd = d; best = w; }
    }

    if (best) {
      // auto-open prompt on approach; sets uiLock so movement doesn't cancel it
      // (the player must press interact; we won't auto-lock here to avoid fights)
    }
  }

  tryPrompt() {
    if (this.busy) return true;
    const s = this.scene;
    const here = s.areas?.current?.id || null;
    const p = s.player;
    if (!p || p.dead) return false;
    let best = null, bd = INTERACT_RADIUS;
    for (const w of this.wisps) {
      if (w.areaId !== here) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, w.x, w.y);
      if (d < bd) { bd = d; best = w; }
    }
    if (best) { this._openPrompt(best); return true; }
    return false;
  }

  _onKill(payload) {
    if (!payload || !payload.typeId) return;
    if (Math.random() >= ENCOUNTER_CHANCE) return;
    const s = this.scene;
    const def = ENEMY_TABLE[payload.typeId];
    if (!def) return;
    // skip bosses and things without a known sprite
    if (def.boss) return;
    // resolve capture target: an actual pet id if mapped, else a "wild" capture id based on enemy type
    const petId = this._petIdForEnemy(payload.typeId);
    if (!petId) return;
    this._spawnWisp(payload.x, payload.y, payload.typeId, petId, payload.areaId);
  }

  _petIdForEnemy(typeId) {
    // Direct enemy -> pet mappings for capturable wild forms.
    const map = {
      fieldmouse: 'emberling',
      gelgreen: 'dewdrop',
      gelblue: 'dewdrop',
      gorselizard: 'sprig',
      burrower: 'emberling',
      meadowcap: 'sprig',
      dewslime: 'dewdrop',
      mossbat: 'emberling',
    };
    if (map[typeId]) return map[typeId];
    // Fallback: use the enemy's family to pick a thematic starter line.
    const def = ENEMY_TABLE[typeId];
    if (!def) return null;
    const family = (def.family || def.sprite || '').toLowerCase();
    if (family.includes('slime') || family.includes('gel') || family.includes('axolot') || family.includes('fish')) return 'dewdrop';
    if (family.includes('bat') || family.includes('mouse') || family.includes('racoon') || family.includes('beast')) return 'emberling';
    if (family.includes('plant') || family.includes('mushroom') || family.includes('snake') || family.includes('lizard') || family.includes('panda')) return 'sprig';
    return null;
  }

  _spawnWisp(x, y, typeId, petId, areaId) {
    const s = this.scene;
    const def = ENEMY_TABLE[typeId];
    const petDef = baseFor(petId);
    const texKey = petDef?.sprite ? `mon.${petDef.sprite}` : (s.textures.exists(`mon.${def.sprite}`) ? `mon.${def.sprite}` : 'mon.Slime');
    if (!s.textures.exists(texKey)) return;

    const c = s.add.container(x, y).setDepth(y).setAlpha(0);
    const sc = def.scale || 1;
    const shadow = s.add.image(0, 3, 'char.shadow').setScale(1.2 * sc, sc).setAlpha(0.4);
    const sprite = s.add.sprite(0, -6 * sc, texKey, 0).setScale(sc);
    const glow = s.add.ellipse(0, -4, 22 * sc, 18 * sc, 0x9fd8ff, 0.35).setBlendMode(Phaser.BlendModes.ADD);
    c.add([shadow, glow, sprite]);

    const idleKey = `${texKey}.move.down`;
    if (s.anims.exists(idleKey)) sprite.play(idleKey, true);

    // wisp tint: pale blue-white, slightly ghostly
    sprite.setTint(0xc8e8ff);
    sprite.setAlpha(0.92);
    c.setBlendMode(Phaser.BlendModes.ADD);

    // gentle float
    s.tweens.add({
      targets: sprite, y: -8 * sc, duration: 900, yoyo: true, repeat: -1, ease: 'sine.inout',
    });
    s.tweens.add({
      targets: glow, scaleX: 1.25, scaleY: 1.25, alpha: 0.55, duration: 800, yoyo: true, repeat: -1, ease: 'sine.inout',
    });

    // fade in
    s.tweens.add({ targets: c, alpha: 1, duration: 240 });

    const w = {
      c, sprite, glow, shadow,
      x, y, typeId, petId,
      areaId: areaId || null,
      active: true,
      expiresAt: s.time.now + WISP_LIFETIME_MS,
      name: this._wispName(def, petDef),
    };
    this.wisps.push(w);

    bus.emit(Events.SYSTEM, `A wild ${w.name} wisp shimmered into being!`);
  }

  _wispName(def, petDef) {
    if (petDef) return `${def.name} Wisp`;
    return def.name;
  }

  _openPrompt(w) {
    if (this.prompt?.wisp === w) return;
    this._closePrompt();
    this.busy = true;
    this.scene.uiLock = true;
    this.prompt = new CapturePrompt(this.scene, w.name, (action) => {
      if (action === 'capture') this._attemptCapture(w);
      else this._letGo(w);
      this._closePrompt();
    });
  }

  _closePrompt() {
    if (this.prompt) { this.prompt.destroy(); this.prompt = null; }
    this.busy = false;
    this.scene.uiLock = false;
    this.scene.uiLockUntil = this.scene.time.now + 120;
  }

  _attemptCapture(w) {
    const s = this.scene;
    // consume orb
    if (!ITEMS.wayfarer_orb) {
      bus.emit(Events.SYSTEM, 'Wayfarer Orbs are not available yet.');
      audio.play('error', 0.7);
      this._letGo(w);
      return;
    }
    if (takeItem(s, 'wayfarer_orb', 1) === false) {
      bus.emit(Events.SYSTEM, 'You need a Wayfarer Orb to capture it!');
      audio.play('error', 0.7);
      this._letGo(w);
      return;
    }

    // capture formula
    const hpFrac = 1; // wisp is at full "spirit" HP
    const orbQuality = 1;
    const chance = 0.30 + (1 - hpFrac) * 0.50 + orbQuality * 0.10; // = 0.40 base for full-HP wisp
    const roll = Math.random();

    // capture animation
    this._playCaptureFx(w.x, w.y - 8);
    audio.play('cast', 0.9);

    if (roll < chance) {
      // success
      const level = Math.max(1, s.player.level - 1 + Math.floor(Math.random() * 3));
      const pet = makePet(w.petId, level);
      const pets = s.meta.pets || (s.meta.pets = { unlocked: true, roster: [] });
      pets.unlocked = true;
      if (pet) pets.roster.push(pet);
      s.saveNow();
      bus.emit(Events.SYSTEM, `Captured ${w.name}! ${PETS[w.petId]?.name || w.petId} joins your roster.`);
      bus.emit(Events.TOAST, { title: 'Pet captured!', text: `${PETS[w.petId]?.name || w.petId} Lv${level}`, color: '#9fd8ff' });
      this._absorbWisp(w);
    } else {
      // fail: shake and flee
      s.cameras.main.shake(80, 0.002);
      s.tweens.add({
        targets: w.c, x: w.x + (Math.random() < 0.5 ? -1 : 1) * 8, duration: 60, yoyo: true, repeat: 3,
        onComplete: () => {
          bus.emit(Events.SYSTEM, `${w.name} broke free and fled!`);
          this._fleeWisp(w);
        },
      });
    }
  }

  _letGo(w) {
    bus.emit(Events.SYSTEM, `The ${w.name} wisp fades away.`);
    this._fadeOutWisp(w);
  }

  _absorbWisp(w) {
    const s = this.scene;
    s.tweens.add({
      targets: w.c, scale: 0.1, alpha: 0, duration: 400, ease: 'back.in',
      onComplete: () => this._destroyWisp(w),
    });
    const idx = this.wisps.indexOf(w);
    if (idx >= 0) this.wisps.splice(idx, 1);
  }

  _fleeWisp(w) {
    const s = this.scene;
    const a = Math.random() * Math.PI * 2;
    s.tweens.add({
      targets: w.c, x: w.x + Math.cos(a) * 80, y: w.y + Math.sin(a) * 80, alpha: 0, duration: 450, ease: 'quad.in',
      onComplete: () => this._destroyWisp(w),
    });
    const idx = this.wisps.indexOf(w);
    if (idx >= 0) this.wisps.splice(idx, 1);
  }

  _fadeOutWisp(w) {
    if (!w || !w.active) return;
    const s = this.scene;
    s.tweens.add({
      targets: w.c, alpha: 0, duration: 500,
      onComplete: () => this._destroyWisp(w),
    });
  }

  _destroyWisp(w) {
    if (!w) return;
    w.active = false;
    try { w.c?.destroy(); } catch { /* ignore */ }
  }

  _playCaptureFx(x, y) {
    const s = this.scene;
    // try the white circle anim, fall back to spark
    const key = s.anims.exists('fx.circleWhite') ? 'fx.circleWhite' : 'fx.spark';
    const fx = s.add.sprite(x, y, key, 0).setDepth(2700).setScale(1.8).setBlendMode(Phaser.BlendModes.ADD);
    if (s.anims.exists(key)) fx.play(key);
    fx.once('animationcomplete', () => fx.destroy());
    // little stars
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = s.add.ellipse(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 3, 3, 0xffffff, 0.9).setDepth(2700).setBlendMode(Phaser.BlendModes.ADD);
      s.tweens.add({ targets: p, x: x + Math.cos(a) * 28, y: y + Math.sin(a) * 28, alpha: 0, duration: 500, onComplete: () => p.destroy() });
    }
  }
}
