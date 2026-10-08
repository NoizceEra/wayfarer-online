// Wild pet encounter + capture system.
// Purely additive. Spawns a non-hostile "wisp" after kills, lets the player
// capture it with a Wayfarer Orb, and persists caught pets in scene.meta.pets.roster.
import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';
import { ENEMY_TABLE } from '../data/jobs.js';
import { baseFor, makePet, movesFor, PETS, statsAt } from '../data/pets.js';
import { ITEMS, takeItem } from '../data/items.js';
import { audio } from './audio.js';
import { input } from '../core/input.js';
import { CapturePrompt } from '../ui/CapturePrompt.js';
import { PetBattlePanel } from '../ui/PetBattlePanel.js';

const ENCOUNTER_CHANCE = 0.065; // 6.5% kill-roll
const WISP_LIFETIME_MS = 15000;
const INTERACT_RADIUS = 26;

export class PetEncounterSystem {
  constructor(scene) {
    this.scene = scene;
    this.wisps = []; // active capturable wisps
    this.busy = false;
    this.panel = null;        // PetBattlePanel — lazily created on first battle
    this._battleWisp = null;  // the wisp currently "engaged" in a battle
    this._rosterRefs = [];    // battle playerTeam index -> roster index
    this._offKill = bus.on(Events.KILL, (payload) => this._onKill(payload));
    // Wild pet battles are the encounter system's own gameplay action: pressing
    // the key challenges the nearest wild wisp (or conjures one) into the
    // turn-based PET BATTLE panel. Registered here (like combat.js registers
    // dodge/target) so the action shows up in the rebindable hotkey list.
    this._offAction = input.registerAction({
      id: 'petBattle', label: 'Battle wild pet', group: 'World', keys: ['KeyR'], gameplay: true,
    });
    scene.events.once('shutdown', () => this.destroy());
  }

  destroy() {
    if (this._offKill) { this._offKill(); this._offKill = null; }
    if (this._offAction) { this._offAction(); this._offAction = null; }
    for (const w of this.wisps) this._destroyWisp(w);
    this.wisps = [];
    if (this.prompt) { this.prompt.destroy(); this.prompt = null; }
    if (this.panel) { this.panel.destroy(); this.panel = null; }
    this._battleWisp = null;
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

  // Nearest wisp the player can interact with, in the current area.
  _nearestWisp() {
    const s = this.scene;
    const p = s.player;
    if (!p || p.dead) return null;
    const here = s.areas?.current?.id || null;
    let best = null, bd = INTERACT_RADIUS;
    for (const w of this.wisps) {
      if (w.areaId !== here) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, w.x, w.y);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  tryPrompt() {
    if (this.busy) return true;
    const best = this._nearestWisp();
    if (best) { this._openPrompt(best); return true; }
    return false;
  }

  // ── wild pet battles ────────────────────────────────────────────────────────
  // The turn-based PET BATTLE (PetBattle engine + PetBattlePanel UI). Reached
  // from gameplay by the `petBattle` action (KeyR by default, wired in
  // WorldScene): it challenges the nearest wild wisp, conjuring one if none is
  // in range. Uses the existing encounter machinery — no parallel battle system.

  // The panel is a screen-space modal; it must live on the UI scene so it renders
  // above the HUD (and because only the UI scene exposes view()).
  _uiScene() {
    const ui = this.scene.scene?.get?.('ui');
    return (ui && typeof ui.view === 'function') ? ui : null;
  }

  // Build the player's battle team from the live roster (progress.ext.pets.roster).
  // Returns { team, refs } where refs[i] is the roster index behind team[i], so the
  // finished battle can be written back even if some roster entries were invalid.
  _playerTeam() {
    const roster = this.scene.meta?.pets?.roster;
    const team = [], refs = [];
    if (!Array.isArray(roster)) return { team, refs };
    roster.forEach((p, i) => {
      const def = baseFor(p?.id);
      if (!def) return;
      const level = Math.max(1, Math.floor(p.level || 1));
      const stats = p.stats || statsAt(p.id, level);
      if (!stats) return;
      const moves = (p.moves && p.moves.length ? p.moves : movesFor(def, level).map((m) => m.id)).slice(0, 4);
      if (!moves.length) return;
      team.push({
        id: p.id,
        name: p.name || def.name,
        level,
        xp: p.xp || 0,
        hp: typeof p.hp === 'number' ? p.hp : stats.hp,
        stats,
        moves,
      });
      refs.push(i);
    });
    return { team, refs };
  }

  // Challenge the nearest wild wisp — or conjure one at the player's feet so the
  // battle is reachable anywhere, not only on a 6.5% kill-roll. Returns true if a
  // battle (or a "need a pet" notice) was handled.
  challengeWild() {
    if (this.busy || this.panel?.isOpen) return true;
    const s = this.scene;
    const p = s.player;
    if (!p || p.dead) return false;
    if (!this._uiScene()) return false;
    if (!this._playerTeam().team.length) {
      bus.emit(Events.SYSTEM, 'You need a pet to battle — hatch one from the Pet Master first.');
      audio.play('error', 0.6);
      return true;
    }
    const w = this._nearestWisp() || this._conjureWisp();
    if (!w) return false;
    return this.startBattle(w);
  }

  _conjureWisp() {
    const s = this.scene;
    // ENEMY_TABLE ids that resolve to a capturable pet line via _petIdForEnemy.
    const pool = ['dewslime', 'mossbat', 'capling'];
    const typeId = pool[Math.floor(Math.random() * pool.length)];
    const def = ENEMY_TABLE[typeId];
    const petId = def && this._petIdForEnemy(typeId);
    if (!petId) return null;
    const p = s.player;
    this._spawnWisp(p.x, p.y + 6, typeId, petId, s.areas?.current?.id || null, 1);
    return this.wisps[this.wisps.length - 1] || null;
  }

  // Open the PET BATTLE panel for a wild wisp. `opts.level` overrides the wild
  // pet's level (defaults to the hero's).
  startBattle(w, opts = {}) {
    const s = this.scene;
    if (!w || this.panel?.isOpen) return false;
    const ui = this._uiScene();
    if (!ui) return false;
    const { team, refs } = this._playerTeam();
    if (!team.length) return false;
    const level = Math.max(1, Math.round(opts.level ?? (s.player?.level || 1)));
    const opp = makePet(w.petId, level);
    if (!opp) return false;
    opp.isWild = true;
    opp.name = baseFor(w.petId)?.name || w.petId;

    // Pull the wisp out of the expiry loop — it "engages" for the battle and is
    // faded out when the battle closes.
    const idx = this.wisps.indexOf(w);
    if (idx >= 0) this.wisps.splice(idx, 1);
    this._battleWisp = w;
    this._rosterRefs = refs;
    this.busy = true;
    s.uiLock = true;
    this.panel = this.panel || new PetBattlePanel(ui, { onClose: (panel, battle) => this._onBattleClosed(panel, battle) });
    this.panel.open(team, [opp], { isWild: true, rewardScale: 1 });
    bus.emit(Events.SYSTEM, `Pet battle! Your team faces the wild ${opp.name} Lv${opp.level}.`);
    return true;
  }

  _onBattleClosed(panel, battle) {
    const s = this.scene;
    this.busy = false;
    s.uiLock = false;
    s.uiLockUntil = s.time.now + 120;
    if (battle) this._persistBattleResult(battle);
    const w = this._battleWisp;
    this._battleWisp = null;
    if (w) this._fadeOutWisp(w);
  }

  // The PetBattle engine is side-effect-free by design (petBattle.js header), so
  // the opener persists the outcome: level/xp/stats back onto the real roster.
  // Pets are left at full HP between battles (there is no pet-heal UI yet).
  _persistBattleResult(battle) {
    const s = this.scene;
    const roster = s.meta?.pets?.roster;
    if (!Array.isArray(roster) || !Array.isArray(battle?.playerTeam)) return;
    let changed = false;
    battle.playerTeam.forEach((p, i) => {
      const r = roster[this._rosterRefs?.[i]];
      if (!r || r.id !== p.id) return;
      if (r.level !== p.level || (r.xp || 0) !== (p.xp || 0)) changed = true;
      r.level = p.level;
      r.xp = p.xp || 0;
      r.stats = p.stats;
      r.hp = p.stats?.hp ?? r.hp;
    });
    if (changed) s.saveNow?.();
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
    const hpFrac = typeof payload.hpFrac === 'number' ? payload.hpFrac : 1;
    this._spawnWisp(payload.x, payload.y, payload.typeId, petId, payload.areaId, hpFrac);
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

  _spawnWisp(x, y, typeId, petId, areaId, hpFrac = 1) {
    const s = this.scene;
    const def = ENEMY_TABLE[typeId];
    const petDef = baseFor(petId);
    const texKey = petDef?.sprite || (def?.sprite && s.textures.exists(`mon.${def.sprite}`) ? `mon.${def.sprite}` : 'mon.Slime');
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
      hpFrac: Math.max(0, Math.min(1, hpFrac)),
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
    const orbs = this._ownedOrbs();
    this.prompt = new CapturePrompt(this.scene, w.name, w.hpFrac, orbs, (action, orbId) => {
      if (action === 'capture') this._attemptCapture(w, orbId);
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

  _ownedOrbs() {
    // Prefer upgraded orbs if owned; fall back to base orbs.
    const ids = ['wayfarer_orb_plus', 'wayfarer_orb', 'golden_orb_plus', 'golden_orb'];
    const seen = new Set();
    return ids
      .map((id) => ({ id, ...ITEMS[id], n: packCount(this.scene, id) }))
      .filter((o) => { if (o.n <= 0) return false; if (seen.has(o.name)) return false; seen.add(o.name); return true; });
  }

  _attemptCapture(w, orbId) {
    const s = this.scene;
    const orbs = this._ownedOrbs();
    let orb = orbs.find((o) => o.id === orbId) || orbs[0];
    if (orb) {
      // If the selected id is the base but the player owns the plus version,
      // promote the selection to the plus variant for capture stats.
      const plusId = orb.id === 'wayfarer_orb' ? 'wayfarer_orb_plus' : orb.id === 'golden_orb' ? 'golden_orb_plus' : null;
      if (plusId && packCount(this.scene, plusId) > 0) {
        const plus = { id: plusId, ...ITEMS[plusId], n: packCount(this.scene, plusId) };
        orb = plus;
      }
    }

    // consume orb
    if (!orb) {
      bus.emit(Events.SYSTEM, 'You need a Wayfarer Orb to capture it!');
      audio.play('error', 0.7);
      this._letGo(w);
      return;
    }
    if (takeItem(s, orb.id, 1) === false) {
      bus.emit(Events.SYSTEM, 'You need a Wayfarer Orb to capture it!');
      audio.play('error', 0.7);
      this._letGo(w);
      return;
    }

    // capture formula: base + lower HP bonus + orb quality bonus
    const base = 0.30;
    const hpBonus = (1 - w.hpFrac) * 0.50;
    const orbStats = orb.use?.capture || { quality: 1, bonus: 0 };
    const orbQualityBonus = orbStats.bonus + (orbStats.quality - 1) * 0.04;
    const chance = Math.min(0.95, base + hpBonus + orbQualityBonus);
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
      bus.emit(Events.PET_HATCH, { id: w.petId });
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
