import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { JOBS, ENEMY_TABLE } from '../data/jobs.js';
import { ZONES, QUESTS } from '../data/zones.js';
import { buildOverworld, zoneAt } from '../world/overworld.js';
import { ModularPlayer } from '../entities/ModularPlayer.js';
import { Enemy } from '../entities/Enemy.js';
import { bus, Events } from '../core/events.js';
import { WorldSync } from '../net/WorldSync.js';
import { net } from '../net/NetworkManager.js';
import { DayNight } from '../systems/daynight.js';
import { audio } from '../systems/audio.js';
import { installWorldZoom } from '../core/display.js';
import { loadProgress, saveProgress } from '../core/save.js';
import { gearById, rollGearDrop, statLine } from '../data/gear.js';
import { SHOP_STOCK } from '../data/gear.js';

// Open world: town (safe) + meadow + woods + ruins in ONE 128×128 map.
// Solo = full simulation. Host = authoritative + broadcasts. Guest = applies
// host snapshots, keeps own XP/gold (RO/Heartwood-style drop-in co-op).
export class WorldScene extends Phaser.Scene {
  constructor() { super('world'); }
  init(data) { this.heroData = data.hero; this.mode = data.mode || 'solo'; this.pname = data.name || 'Pip'; }

  create() {
    audio.attach(this);
    const t = CONFIG.tile;
    const { spawn, solids, W, H } = buildOverworld(this, ZONES);
    this.spawn = spawn;
    this.touchInput = { x: 0, y: 0 }; // written by UIScene touch controls

    this.player = new ModularPlayer(this, spawn.x, spawn.y, this.heroData);
    // Restore solo/guest-local progress (level, gold, pos, quest)
    const saved = loadProgress(this.pname);
    if (saved && saved.job === this.player.job.id) {
      this.player.level = saved.level || 1; this.player.xp = saved.xp || 0;
      this.player.xpNext = saved.xpNext || 100;
      this.player.gold = saved.gold ?? 20; this.player.potions = saved.potions ?? 3;
      this.player.maxHp = saved.maxHp || this.player.maxHp;
      this.player.maxMp = saved.maxMp || this.player.maxMp;
      this.player.atk = saved.atk || this.player.atk;
      this.player.hp = this.player.effMaxHp(); this.player.mp = this.player.effMaxMp();
      this.player.setPosition(saved.x || spawn.x, saved.y || spawn.y);
      this.questState = saved.quest || { idx: 0, kills: {} };
      if (Array.isArray(saved.inventory)) this.player.inventory = saved.inventory.filter((id) => gearById(id));
      if (saved.equipped) {
        for (const slot of ['head', 'chest', 'weapon', 'trinket']) {
          const id = saved.equipped[slot];
          if (id && gearById(id)) this.player.equipped[slot] = id;
        }
        this.player.applyGearVisuals();
      }
    } else {
      this.questState = { idx: 0, kills: {} };
    }
    this.saveAcc = 0;
    this.physics.add.collider(this.player, solids);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    installWorldZoom(this); // integer zoom (auto-fit, or - / = / 0 keys); UIScene stays unzoomed
    this.cameras.main.setBounds(0, 0, W, H);

    // NPCs: Pip (quests), Maren (shop/potions), Old Tob (lore) — real sprites
    this.npcs = [];
    // Plaza layout: houses stand north (±60), NPCs in an open south row and
    // Old Tob up the middle — nothing stacks on torches (±36,+28 / 0,+54).
    const npcDefs = [
      { name: 'Pip', tex: 'Villager', dx: -30, dy: 30, text: 'Slimes in the meadow, friend! 5 of them. Come back after.' },
      { name: 'Maren', tex: 'Woman', dx: 30, dy: 30, text: 'Potions: press Q (3 gold). Stay safe out there!' },
      { name: 'Old Tob', tex: 'OldMan', dx: 0, dy: -46, text: 'Tidehollow sleeps below the south cliffs. Lv 8, or not at all.' },
    ];
    for (const n of npcDefs) {
      const c = this.add.container(spawn.x + n.dx, spawn.y + (n.dy || 8));
      const sh = this.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
      const b = this.add.sprite(0, -8, `char.${n.tex}`, 0);
      const idle = `char.${n.tex}.idle.down`;
      if (this.anims.exists(idle)) b.play(idle);
      const l = this.add.text(0, -26, n.name, { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#fff', backgroundColor: '#00000088' }).setOrigin(0.5);
      c.add([sh, b, l]); c.setDepth(c.y); c.setData('def', n); // y-sorted with world
      this.npcs.push(c);
    }

    // Enemies scattered per zone
    this.enemies = this.physics.add.group();
    this.spawnEnemies(solids);
    this.physics.add.collider(this.enemies, solids);
    this.physics.add.overlap(this.player, this.enemies, (p, e) => {
      const ed = e instanceof Enemy ? e : null;
      if (!ed) return;
      // Safe zones (town) are truly safe: no contact damage
      const pt = CONFIG.tile;
      if (zoneAt(Math.floor(this.player.x / pt), Math.floor(this.player.y / pt), ZONES).safe) return;
      const raw = ed.def.atk * 0.15 + 1;
      const n = Math.max(1, Math.round(raw - this.player.effDef() * 0.5));
      if (this.player.hurt(n)) {
        bus.emit(Events.PLAYER_HP, this.hpPayload());
        audio.play('hurt');
        this.cameras.main.shake(80, 0.002);
        if (this.player.dead) this.onDeath();
      }
    });

    // Projectiles
    this.shots = this.physics.add.group();
    this.physics.add.overlap(this.shots, this.enemies, (s, e) => {
      const ed = e instanceof Enemy ? e : null;
      if (!ed || s.getData('dead')) return;
      s.setData('dead', true); s.destroy();
      this.damageEnemy(ed, s.getData('dmg') || 10, s.getData('owner') === 'remote' ? true : false);
    });

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,J,E,Q,M,ENTER,ONE,TWO,THREE,FOUR,I');
    Object.entries({ ONE: '1', TWO: '2', THREE: '3', FOUR: '4' }).forEach(([k, n]) => {
      this.input.keyboard.on(`keydown-${n}`, () => this.cast(n));
    });
    this.input.keyboard.on('keydown-J', () => this.attack());
    this.input.keyboard.on('keydown-Q', () => this.drinkPotion());
    this.input.keyboard.on('keydown-E', () => this.interact());
    this.input.keyboard.on('keydown-I', () => bus.emit(Events.GEAR, { open: 'inventory' }));
    this.input.keyboard.on('keydown-M', () => bus.emit(Events.SYSTEM, 'toggle-minimap'));
    this.input.on('pointerdown', (p) => { if (p.button === 0 && !this.chatOpen) this.attack(p.worldX, p.worldY); });

    // Loot pickups (gear drops + bonus gold)
    this.drops = this.physics.add.group();
    this.physics.add.overlap(this.player, this.drops, (p, d) => this.collectDrop(d));

    this.daynight = new DayNight(this);
    this.sync = new WorldSync();
    this.sync.attach(this, this.player, this.heroData);
    if (net.connected) net.pushHero(this.heroData); // Creator choices > join-time snapshot

    this.zoneId = 'town';
    audio.musicFor('town');
    const resumed = loadProgress(this.pname);
    bus.emit(Events.SYSTEM, resumed && resumed.job === this.player.job.id
      ? `Welcome back, ${this.pname}! (Lv ${this.player.level} · ${this.mode}${net.connected ? ` · room ${net.code}` : ' · solo'})`
      : `Welcome to Embervale, ${this.pname}! (${this.mode}${net.connected ? ` · room ${net.code}` : ' · solo'})`);
    bus.emit(Events.QUEST, this.questText());
    bus.emit(Events.PLAYER_HP, this.hpPayload());
    bus.emit(Events.PLAYER_XP, this.xpPayload());
    this.events.once('shutdown', () => { this.saveNow(); this.sync.destroy(); });
    this.scene.launch('ui', { hero: this.heroData, name: this.pname, job: this.player.job });
  }

  hpPayload() { return { hp: Math.ceil(this.player.hp), maxHp: this.player.effMaxHp(), mp: Math.ceil(this.player.mp), maxMp: this.player.effMaxMp(), potions: this.player.potions, gold: this.player.gold, level: this.player.level, atk: this.player.effAtk(), def: this.player.effDef() }; }
  xpPayload() { return { xp: this.player.xp, xpNext: this.player.xpNext, level: this.player.level }; }
  questText() {
    const q = QUESTS[this.questState.idx];
    if (!q) return 'All errands done! The ruins are yours, Wayfarer.';
    const got = this.questState.kills[q.need.enemy] || 0;
    return `${q.name}: ${q.text} (${got}/${q.need.count})`;
  }

  spawnEnemies(solids) {
    const t = CONFIG.tile;
    const table = [
      ['dewslime', 26, 'meadow'], ['mossbat', 14, 'meadow'],
      ['thornmite', 16, 'woods'], ['capling', 12, 'woods'], ['willowisp', 10, 'woods'],
      ['bogspirit', 10, 'ruins'], ['rustskull', 10, 'ruins'], ['tideeye', 6, 'ruins'],
    ];
    let seed = 987654;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const [type, n, zoneId] of table) {
      const z = ZONES.find((zz) => zz.id === zoneId);
      for (let i = 0; i < n; i++) {
        const tx = z.rect.x + 1 + Math.floor(rnd() * (z.rect.w - 2));
        const ty = z.rect.y + 1 + Math.floor(rnd() * (z.rect.h - 2));
        const e = new Enemy(this, tx * t + 8, ty * t + 8, type);
        this.enemies.add(e);
      }
    }
  }

  saveNow() {
    saveProgress(this.pname, {
      job: this.player.job.id, level: this.player.level, xp: this.player.xp, xpNext: this.player.xpNext,
      gold: this.player.gold, potions: this.player.potions,
      maxHp: this.player.maxHp, maxMp: this.player.maxMp, atk: this.player.atk,
      x: Math.round(this.player.x), y: Math.round(this.player.y), quest: this.questState,
      inventory: [...this.player.inventory], equipped: { ...this.player.equipped },
    });
  }

  // — loot drops —
  spawnDrop(x, y, gearId) {
    if (this.drops.getLength() > 24) return;
    const g = gearById(gearId);
    if (!g) return;
    const c = this.add.container(x, y).setDepth(y); // y-sorted pickup
    const glow = this.add.circle(0, 0, 10, 0xf4c542, 0.35);
    const icon = this.add.image(0, -4, `gear.icon.${g.id}`).setScale(3);
    const label = this.add.text(0, 10, g.name, { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#fff', backgroundColor: '#00000088' }).setOrigin(0.5);
    c.add([glow, icon, label]);
    this.physics.add.existing(c);
    c.body.setSize(20, 20);
    c.setData('gearId', g.id);
    this.tweens.add({ targets: icon, y: -8, duration: 600, yoyo: true, repeat: -1, ease: 'sine.inout' });
    this.drops.add(c);
    this.time.delayedCall(60000, () => { if (c.active) c.destroy(); });
  }

  collectDrop(d) {
    const id = d.getData('gearId');
    const g = id && gearById(id);
    if (!g || this.player.dead) return;
    d.destroy();
    this.player.inventory.push(id);
    audio.play('gold');
    this.spawnFx(this.player.x, this.player.y - 12, 'fx.spark', 1.2);
    bus.emit(Events.SYSTEM, `Loot: ${g.name} (${statLine(g.stats)}) — press I to equip`);
    bus.emit(Events.GEAR, { changed: true });
    bus.emit(Events.PLAYER_HP, this.hpPayload());
    this.saveNow();
  }

  damageNumber(x, y, text, color = '#ffffff') {
    const d = this.add.text(x + Phaser.Math.Between(-6, 6), y - 20, String(text), {
      fontFamily: '"Silkscreen", monospace', fontSize: '11px', color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(2800);
    this.tweens.add({ targets: d, y: d.y - 14, alpha: 0, duration: 650, onComplete: () => d.destroy() });
  }

  spawnFx(x, y, key, scale = 1.5, angle = 0) {
    if (!this.anims.exists(key)) return null;
    // mobile perf: skip minor hit-spark FX when the screen is already busy
    if (CONFIG.isMobile && (key === 'fx.cut' || key === 'fx.dust') && this.tweens.getTweens().length > 14) return null;
    const s = this.add.sprite(x, y, key, 0).setDepth(2700).setScale(scale).setAngle(angle);
    s.play(key);
    s.once('animationcomplete', () => s.destroy());
    return s;
  }

  fireShot(x, y, angle, dmg, kind) {
    // kind: arrow | kunai | energy | fire | shuriken
    let s;
    if (kind === 'arrow' && this.textures.exists('proj.arrow')) {
      s = this.add.image(x, y, 'proj.arrow').setDepth(2600).setRotation(angle);
    } else if (kind === 'kunai' && this.textures.exists('proj.kunai')) {
      s = this.add.image(x, y, 'proj.kunai').setDepth(2600).setRotation(angle);
    } else {
      const key = kind === 'fire' ? 'proj.fireball' : kind === 'shuriken' ? 'proj.shuriken' : 'proj.energyBall';
      s = this.add.sprite(x, y, key, 0).setDepth(2600).setRotation(angle);
      if (this.anims.exists(key)) s.play(key);
    }
    this.physics.add.existing(s);
    s.setData('dmg', dmg);
    this.shots.add(s);
    s.body.setVelocity(Math.cos(angle) * 280, Math.sin(angle) * 280);
    if (kind === 'shuriken') this.tweens.add({ targets: s, angle: 360, duration: 400, repeat: -1 });
    this.time.delayedCall(900, () => s.destroy?.());
    return s;
  }

  damageEnemy(ed, dmg, fromRemote = false) {
    if (net.connected && !net.isHost && !fromRemote) return; // guests wait for host
    dmg = Math.max(1, Math.round(dmg));
    const died = ed.hurt(dmg);
    audio.play('hit', 0.8);
    this.damageNumber(ed.x, ed.y, dmg);
    this.spawnFx(ed.x, ed.y - 8, 'fx.cut', 1);
    if (died) {
      audio.play('monsterDie');
      this.spawnFx(ed.x, ed.y - 6, 'fx.smoke', 1.2);
      const coin = this.add.image(ed.x, ed.y, 'fx.coin').setDepth(2600).setScale(2);
      this.tweens.add({ targets: coin, y: ed.y - 14, duration: 250, yoyo: true, onComplete: () => coin.destroy() });
      const dropId = rollGearDrop(ed.typeId);
      if (dropId) this.spawnDrop(ed.x, ed.y - 4, dropId);
      const gold = ed.def.gold[0] + Math.floor(Math.random() * (ed.def.gold[1] - ed.def.gold[0]));
      this.player.gold += gold;
      this.damageNumber(ed.x, ed.y - 8, `+${gold}g`, '#f4c542');
      const leveled = this.player.gainXp(ed.def.xp);
      audio.play('coin', 0.7);
      if (leveled) {
        audio.play('level');
        this.spawnFx(this.player.x, this.player.y - 10, 'fx.boost', 1.4);
        bus.emit(Events.SYSTEM, `${this.pname} reached Lv ${this.player.level}!`);
      }
      this.player.questKills[ed.typeId] = (this.player.questKills[ed.typeId] || 0) + 1;
      this.questState.kills[ed.typeId] = (this.questState.kills[ed.typeId] || 0) + 1;
      const q = QUESTS[this.questState.idx];
      if (q && this.questState.kills[q.need.enemy] >= q.need.count) {
        this.player.gainXp(q.reward.xp); this.player.gold += q.reward.gold;
        bus.emit(Events.SYSTEM, `Quest complete: ${q.name}! +${q.reward.xp} XP, +${q.reward.gold}g`);
        audio.play('quest');
        this.spawnFx(this.player.x, this.player.y - 12, 'fx.circleOrange', 1.6);
        this.questState.idx += 1; this.questState.kills = {};
      }
      bus.emit(Events.PLAYER_HP, this.hpPayload());
      bus.emit(Events.PLAYER_XP, this.xpPayload());
      bus.emit(Events.QUEST, this.questText());
      this.saveNow();
      // respawn after 12s (host or solo)
      const { x, y, typeId } = { x: ed.home.x, y: ed.home.y, typeId: ed.typeId };
      ed.destroy();
      this.time.delayedCall(12000, () => { if (this.scene.isActive()) this.enemies.add(new Enemy(this, x, y, typeId)); });
    }
  }

  attack(tx, ty) {
    if (this.player.dead) return;
    const cd = this.player.cooldowns.slash || 0;
    if (this.time.now < cd) return;
    this.player.cooldowns.slash = this.time.now + 350;
    this.player.attackPose();
    const kind = this.player.weaponKind();
    const bow = kind === 'bow';
    const mage = kind === 'wand';
    const dmg = this.player.effAtk() + Math.floor(Math.random() * 4);
    const ang = { right: 0, down: 90, left: 180, up: 270 }[this.player.facing] ?? 0;
    if (bow || mage) {
      audio.play(mage ? 'cast' : 'arrow');
      const a = tx !== undefined ? Math.atan2(ty - this.player.y, tx - this.player.x) : this.facingAngle();
      this.fireShot(this.player.x, this.player.y - 8, a, dmg, mage ? 'energy' : 'arrow');
    } else {
      audio.play('swing');
      this.spawnFx(this.player.x, this.player.y - 8, 'fx.slashArc', 1.2, ang);
      this.enemies.children.each((e) => {
        if (e instanceof Enemy && Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < 32) this.damageEnemy(e, dmg);
        return true;
      });
    }
  }

  facingAngle() {
    return { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[this.player.facing] ?? 0;
  }

  cast(slot) {
    const ab = this.player.job.abilities[Number(slot) - 1];
    if (!ab || this.player.dead) return;
    const cd = this.player.cooldowns[ab.id] || 0;
    if (this.time.now < cd) { audio.play('error', 0.7); return; }
    const setCd = () => { this.player.cooldowns[ab.id] = this.time.now + ab.cd * 1000; bus.emit(Events.PLAYER_HP, this.hpPayload()); };
    if (ab.id === 'camp') {
      setCd();
      audio.play('heal');
      this.spawnFx(this.player.x, this.player.y - 4, 'fx.aura', 1.6);
      const f = this.add.circle(this.player.x, this.player.y + 6, 8, 0xe67e22).setDepth(2600);
      this.tweens.add({ targets: f, scale: 1.3, duration: 400, yoyo: true, repeat: 9, onComplete: () => f.destroy() });
      this.time.addEvent({ delay: 1000, repeat: 9, callback: () => {
        this.player.heal(4); this.damageNumber(this.player.x, this.player.y, '+4', '#2ecc71');
        bus.emit(Events.PLAYER_HP, this.hpPayload());
      } });
      bus.emit(Events.SYSTEM, `${ab.name}: campfire heals 4 HP/s`);
      return;
    }
    if (ab.id === 'ward') {
      if (this.player.mp < 20) { audio.play('error', 0.7); bus.emit(Events.SYSTEM, 'Not enough MP!'); return; }
      this.player.mp -= 20;
      this.player.invulnUntil = this.time.now + 3000;
      setCd();
      audio.play('cast');
      const sh = this.spawnFx(this.player.x, this.player.y - 8, 'fx.shieldBlue', 1.4);
      if (sh) this.tweens.add({ targets: sh, alpha: 0.4, duration: 500, yoyo: true, repeat: 5 });
      bus.emit(Events.SYSTEM, `${ab.name}: shielded 3s`);
      return;
    }
    if (ab.id === 'dash' || ab.id === 'blink') {
      setCd();
      audio.play('dash');
      const a = this.facingAngle();
      this.spawnFx(this.player.x, this.player.y - 8, 'fx.dust', 1.4);
      if (ab.id === 'blink') {
        this.player.setPosition(
          Phaser.Math.Clamp(this.player.x + Math.cos(a) * 64, 40, 2048 - 40),
          Phaser.Math.Clamp(this.player.y + Math.sin(a) * 64, 40, 2048 - 40),
        );
        this.spawnFx(this.player.x, this.player.y - 8, 'fx.spark', 1.2);
      } else {
        this.player.body.setVelocity(Math.cos(a) * 420, Math.sin(a) * 420);
        this.player.invulnUntil = this.time.now + 350;
      }
      return;
    }
    if (ab.id === 'snare' || ab.id === 'smoke') {
      const cost = 12;
      if (this.player.mp < cost) { audio.play('error', 0.7); bus.emit(Events.SYSTEM, 'Not enough MP!'); return; }
      this.player.mp -= cost; setCd();
      audio.play('cast');
      this.spawnFx(this.player.x, this.player.y - 8, 'fx.explosion', 1.2);
      let n = 0;
      this.enemies.children.each((e) => {
        if (e instanceof Enemy && Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < 70) {
          e.setData('slowUntil', this.time.now + 4000);
          e.sprite.setTint(0x88ccff);
          this.time.delayedCall(4000, () => e.active && e.sprite.clearTint());
          if (ab.id === 'smoke') this.damageEnemy(e, this.player.effAtk());
          n += 1;
        }
        return true;
      });
      bus.emit(Events.SYSTEM, `${ab.name}: ${n} enemies ${ab.id === 'snare' ? 'snared' : 'blinded'}!`);
      return;
    }
    // Default: single-target bolt/stab/shot + AoE burst
    const cost = ab.id === 'burst' ? 25 : 8;
    if (this.player.mp < cost) { audio.play('error', 0.7); bus.emit(Events.SYSTEM, 'Not enough MP!'); return; }
    this.player.mp -= cost; setCd();
    this.player.attackPose();
    if (ab.id === 'fan' || ab.id === 'volley') {
      audio.play('arrow');
      for (let i = -1; i <= 1; i++) this.fireShot(this.player.x, this.player.y - 8, this.facingAngle() + i * 0.3, this.player.effAtk(), 'kunai');
    } else if (ab.id === 'burst') {
      audio.play('explosion');
      this.spawnFx(this.player.x, this.player.y - 8, 'fx.explosion', 2);
      this.cameras.main.shake(120, 0.003);
      this.enemies.children.each((e) => {
        if (e instanceof Enemy && Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < 56) this.damageEnemy(e, this.player.effAtk() + 6);
        return true;
      });
    } else {
      audio.play('fireball');
      this.fireShot(this.player.x, this.player.y - 8, this.facingAngle(), this.player.effAtk() + 4, ab.id === 'bolt' ? 'fire' : 'shuriken');
    }
  }

  drinkPotion() {
    if (this.player.potions <= 0) {
      if (this.player.gold >= 3) { this.player.gold -= 3; this.player.potions += 1; bus.emit(Events.SYSTEM, 'Bought a potion from Maren (3g).'); }
      else { bus.emit(Events.SYSTEM, 'No potions! Earn gold from monsters.'); audio.play('error', 0.7); return; }
    }
    if (this.player.hp >= this.player.effMaxHp()) { bus.emit(Events.SYSTEM, 'HP already full.'); return; }
    this.player.potions -= 1;
    this.player.heal(45);
    audio.play('potion');
    this.spawnFx(this.player.x, this.player.y - 10, 'fx.spark', 1.2);
    this.damageNumber(this.player.x, this.player.y, '+45', '#2ecc71');
    bus.emit(Events.PLAYER_HP, this.hpPayload());
  }

  interact() {
    let best = null, bd = CONFIG.interactRadius;
    for (const n of this.npcs) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) {
      audio.play('npc');
      this.spawnFx(best.x, best.y - 20, 'fx.spark', 0.9);
      const def = best.getData('def');
      if (def.name === 'Maren') {
        bus.emit(Events.GEAR, { open: 'shop', stock: SHOP_STOCK });
        bus.emit(Events.SYSTEM, 'Maren: have a look at my wares!');
      } else {
        bus.emit(Events.SYSTEM, `${def.name}: ${def.text}`);
      }
    }
  }

  onDeath() {
    audio.play('hurt');
    this.spawnFx(this.player.x, this.player.y - 8, 'fx.smoke', 1.6);
    this.saveNow();
    bus.emit(Events.SYSTEM, 'You fainted! Woke up back in Thistle Town.');
    this.time.delayedCall(1200, () => {
      this.player.hp = this.player.effMaxHp(); this.player.mp = this.player.effMaxMp();
      this.player.dead = false;
      this.player.setPosition(this.spawn.x, this.spawn.y);
      this.spawnFx(this.spawn.x, this.spawn.y - 8, 'fx.boost', 1.2);
      bus.emit(Events.PLAYER_HP, this.hpPayload());
    });
  }

  applyHostSnapshot(list) {
    // Guest: reconcile enemy positions/hp from host
    if (!Array.isArray(list)) return;
    const kids = this.enemies.getChildren();
    list.forEach((s, i) => { const e = kids[i]; if (e instanceof Enemy) { e.setPosition(s.x, s.y); if (typeof s.hp === 'number') { e.hp = s.hp; } } });
  }

  update(time, delta) {
    const dt = delta / 1000;
    this.daynight.update(dt);
    // regen
    if (!this.player.dead && this.player.mp < this.player.maxMp) {
      this.player.mp = Math.min(this.player.maxMp, this.player.mp + dt * 2);
      if (Math.floor(time / 500) !== Math.floor((time - delta) / 500)) bus.emit(Events.PLAYER_HP, this.hpPayload());
    }
    // movement (keyboard + touch stick)
    const k = this.keys;
    let vx = 0, vy = 0;
    if (k.A.isDown || k.LEFT.isDown) vx -= 1;
    if (k.D.isDown || k.RIGHT.isDown) vx += 1;
    if (k.W.isDown || k.UP.isDown) vy -= 1;
    if (k.S.isDown || k.DOWN.isDown) vy += 1;
    vx += this.touchInput.x; vy += this.touchInput.y;
    if (!this.player.dead) {
      const len = Math.hypot(vx, vy);
      const mag = Math.min(1, len);
      const nx = len > 0.15 ? vx / (len || 1) : 0, ny = len > 0.15 ? vy / (len || 1) : 0;
      const spd = this.player.effSpeed();
      this.player.body.setVelocity(nx * spd * mag, ny * spd * mag);
      if (Math.abs(vx) > Math.abs(vy)) this.player.setFacing(vx > 0 ? 'right' : 'left');
      else if (Math.abs(vy) > 0.15) this.player.setFacing(vy > 0 ? 'down' : 'up');
      const moving = len > 0.15;
      this.player.setMoving(moving);
      if (moving) audio.footstep(time);
    } else this.player.body.setVelocity(0, 0);
    this.player.setDepth(this.player.y); // y-sort against trees/props/NPCs

    // zone tracking
    const t = CONFIG.tile;
    const z = zoneAt(Math.floor(this.player.x / t), Math.floor(this.player.y / t), ZONES);
    if (z.id !== this.zoneId) {
      this.zoneId = z.id;
      audio.musicFor(z.id);
      bus.emit(Events.ZONE, z);
      bus.emit(Events.SYSTEM, `${z.safe ? '— ' : ''}${z.name}: ${z.desc}`);
      if (!z.safe && this.player.level < z.level - 1) {
        audio.play('alert', 0.8);
        bus.emit(Events.SYSTEM, `Careful: ${z.name} is Lv ${z.level}+!`);
      }
    }

    // enemy AI: hop toward player when close, leash home otherwise
    const nightBoost = this.daynight.isNight ? 1.25 : 1;
    this.enemies.children.each((e) => {
      if (!(e instanceof Enemy)) return true;
      const slowed = this.time.now < (e.getData('slowUntil') || 0);
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
      const safe = zoneAt(Math.floor(e.x / t), Math.floor(e.y / t), ZONES).safe;
      let evx = 0, evy = 0;
      if (this.player.dead || safe || d > 130) {
        const hx = e.home.x - e.x, hy = e.home.y - e.y;
        const hd = Math.hypot(hx, hy);
        if (hd > 6) { evx = (hx / hd) * 25; evy = (hy / hd) * 25; }
      } else {
        const a = Math.atan2(this.player.y - e.y, this.player.x - e.x);
        const sp = CONFIG.enemySpeed * nightBoost * (slowed ? 0.25 : 1);
        evx = Math.cos(a) * sp; evy = Math.sin(a) * sp;
      }
      // knockback decays: only steer when slow-moving
      const cvx = e.body.velocity.x, cvy = e.body.velocity.y;
      if (Math.hypot(cvx, cvy) < 100) { e.body.setVelocity(evx, evy); e.setFacingByVelocity(evx, evy); }
      e.setDepth(e.y); // y-sort
      return true;
    });

    // autosave progress every 10s
    this.saveAcc += dt;
    if (this.saveAcc > 10) { this.saveAcc = 0; this.saveNow(); }

    // net
    this.sync.update(dt);
    if (net.connected && net.isHost && Math.floor(time / 300) !== Math.floor((time - delta) / 300)) {
      net.sendSnapshot(this.enemies.getChildren().filter((e) => e instanceof Enemy).slice(0, 40).map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp) })));
    }
  }
}
