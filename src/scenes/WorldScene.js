import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { JOBS, ENEMY_TABLE } from '../data/jobs.js';
import { ZONES, QUESTS, AREAS } from '../data/zones.js';
import { buildOverworld, zoneAt } from '../world/overworld.js';
import { ModularPlayer } from '../entities/ModularPlayer.js';
import { Enemy } from '../entities/Enemy.js';
import { bus, Events } from '../core/events.js';
import { WorldSync } from '../net/WorldSync.js';
import { net } from '../net/NetworkManager.js';
import { DayNight } from '../systems/daynight.js';
import { Fx } from '../systems/fx.js';
import { audio } from '../systems/audio.js';
import { installWorldZoom } from '../core/display.js';
import { input } from '../core/input.js';
import { applyShakeSetting } from '../core/settings.js';
import { loadProgress, saveProgress, normalizeExtras } from '../core/save.js';
import { gearById, rollGearDrop, statLine, RARITY, sellPrice } from '../data/gear.js';
import { BAG_SIZE } from '../core/save.js';
import { initPrompt, updatePrompt, showRoomCode } from '../systems/worldFeel.js';
import { castFx } from '../systems/skillFx.js';
import { castVfx, attachShotFx } from '../systems/skillVfx.js';
import { skillDmgMul } from '../data/stats.js';
import { Boss } from '../entities/Boss.js';
import { MechBoss } from '../entities/MechBoss.js';
import { DungeonRun } from '../world/dungeons.js';
import { WorldEvents } from '../systems/worldEvents.js';
import { AreaManager } from '../world/areas.js';
import { buildOverworldFeatures, overworldClearings } from '../world/overworldFeatures.js';
import { rollDefDrop, rollItemDrops, EXTRA_OVERWORLD_SPAWNS } from '../data/worldEnemies.js';
import { installSocialWorld, remoteAt } from '../systems/social/world.js';
import { social } from '../systems/social/index.js';
import { QuestSystem, BOARD } from '../systems/questSystem.js';
import { GatherSystem, placeGatherNodes, contentClearings } from '../systems/gathering.js';
import { CraftSystem } from '../systems/crafting.js';
import { Achievements } from '../systems/achievements.js';
import { addMat } from '../systems/pack.js';
import { rollMatDrops } from '../data/materials.js';
import { NPC_SPOTS } from '../data/quests.js';
import { Combat } from '../systems/combat.js';
import { Spawner } from '../systems/spawner.js';
import { RANKS, rollRank, rollMobLevel } from '../data/combatMath.js';

// Open world: town (safe) + meadow + woods + ruins in ONE 128×128 map.
// Solo = full simulation. Host = authoritative + broadcasts. Guest = applies
// host snapshots, keeps own XP/gold (RO/Heartwood-style drop-in co-op).
export class WorldScene extends Phaser.Scene {
  constructor() { super('world'); }
  init(data) { this.heroData = data.hero; this.mode = data.mode || 'solo'; this.pname = data.name || 'Pip'; }

  create() {
    audio.attach(this);
    const t = CONFIG.tile;
    const tz = ZONES[0].rect;
    const { spawn, solids, W, H, houses, windows } = buildOverworld(this, ZONES, { clearings: [...overworldClearings({ x: (tz.x + tz.w / 2) * t, y: (tz.y + tz.h / 2) * t }), ...contentClearings({ x: (tz.x + tz.w / 2) * t, y: (tz.y + tz.h / 2) * t })] });
    this.spawn = spawn;
    this.touchInput = { x: 0, y: 0 }; // written by UIScene touch controls
    this.uiLock = false; this.uiLockUntil = 0; this.transitioning = false; // set by OverlayScene / AreaManager

    this.player = new ModularPlayer(this, spawn.x, spawn.y, this.heroData);
    // Restore solo/guest-local progress (level, gold, pos, quest)
    const saved = loadProgress(this.pname);
    if (saved && saved.job === this.player.job.id) {
      this.player.level = saved.level || 1; this.player.xp = saved.xp || 0;
      this.player.gold = saved.gold ?? 20; this.player.potions = saved.potions ?? 3;
      this.player.applyProgression(saved.prog); // derived HP/MP/ATK come from stats now
      this.player.hp = this.player.effMaxHp(); this.player.mp = this.player.effMaxMp();
      this.player.setPosition(saved.x || spawn.x, saved.y || spawn.y);
      this.questState = saved.quest || { idx: 0, kills: {} };
      // gear state is normalised by loadProgress (old saves: chest/trinket migrate, unknown ids dropped)
      this.player.inventory = saved.inventory;
      this.player.setLook({ equipped: saved.equipped, dyes: saved.dyes });
      this.player.hp = Math.min(this.player.hp, this.player.effMaxHp());
    } else {
      this.questState = { idx: 0, kills: {} };
      // New hero: wear the starter cosmetics picked in the creator.
      const st = this.heroData.starter || {};
      const eq = {};
      for (const [slot, id] of Object.entries(st)) { const g = id && gearById(id); if (g && g.slot === slot) eq[slot] = id; }
      this.player.setLook({ equipped: eq, dyes: {} });
    }
    // Content-depth state (quests v2, materials, recipes, achievements...): progress.ext, safe defaults for old saves.
    this.meta = (saved && saved.job === this.player.job.id && saved.ext) || normalizeExtras(null);
    this.gather = new GatherSystem(this);
    this.craft = new CraftSystem(this);
    this.quests = new QuestSystem(this, this.questState);
    this.ach = new Achievements(this);
    this.player.onLookChange = () => net.pushHero(this.player.lookHero());
    this.saveAcc = 0;
    this.physics.add.collider(this.player, solids);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.zoomCtl = installWorldZoom(this); // integer zoom (auto-fit, or - / = / 0 keys); UIScene stays unzoomed
    applyShakeSetting(this.cameras.main); // Settings: screen shake / reduce motion
    this.cameras.main.setBounds(0, 0, W, H);

    // NPCs: Pip (quests), Maren (shop/potions), Old Tob (lore) — real sprites
    this.npcs = [];
    // Plaza layout: houses stand north (±60), NPCs in an open south row and
    // Old Tob up the middle — nothing stacks on torches (±36,+28 / 0,+54).
    const npcDefs = [
      { name: 'Pip', tex: 'Villager', dx: -30, dy: 30, text: 'Slimes in the meadow, friend! 5 of them. Come back after.' },
      { name: 'Maren', tex: 'Woman', dx: 30, dy: 30, shop: 'maren', text: 'Potions: press Q (3 gold). Stay safe out there!' },
      { name: 'Dovey', tex: 'Noble', dx: 138, dy: 78, shop: 'dovey', text: 'Hats, masks and capes! Dyes are free at the wardrobe (press I).' },
      { name: 'Bram', tex: 'GladiatorBlue', dx: -82, dy: 78, shop: 'bram', text: 'Steel for every class. Sell me your spares.' },
      { name: 'Old Tob', tex: 'OldMan', dx: 0, dy: -46, text: 'Tidehollow sleeps below the south cliffs. Lv 8, or not at all.' },
    ];
    for (const [name, sp] of Object.entries(NPC_SPOTS)) npcDefs.push({ name, tex: sp.tex, ax: sp.tx * t + 8, ay: sp.ty * t + 8, text: sp.text });
    for (const n of npcDefs) {
      const c = this.add.container(n.ax ?? spawn.x + n.dx, n.ay ?? spawn.y + (n.dy || 8));
      const sh = this.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
      const b = this.add.sprite(0, -8, `char.${n.tex}`, 0);
      const idle = `char.${n.tex}.idle.down`;
      if (this.anims.exists(idle)) b.play(idle);
      const l = this.add.text(0, -26, n.name, { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#fff', backgroundColor: '#00000088' }).setOrigin(0.5);
      c.add([sh, b, l]); c.setDepth(c.y); c.setData('def', n); // y-sorted with world
      this.npcs.push(c);
      this.quests.registerNpc(n.name, c, null);
    }

    // Enemies scattered per zone
    this.enemies = this.physics.add.group();
    this.spawner = new Spawner(this); // zone caps + respawn timers (systems/spawner.js)
    this.spawnEnemies(solids);
    this.physics.add.collider(this.enemies, solids);
    // Interiors, expansion maps, portals, signs, waystones, ambient NPCs (world/areas.js)
    this.areas = new AreaManager(this, { solids, W, H, spawn });
    buildOverworldFeatures(this, this.areas, { spawn, houses, solids });
    placeGatherNodes(this, null);
    this.craft.buildStations(this, null, spawn);
    this.dungeon = new DungeonRun(this); // Hollow Depths (world/dungeons.js)
    this.worldEvents = new WorldEvents(this); // timed world events + world boss (systems/worldEvents.js)
    { // notice board (prop drawn by the overworld builder): bounties + '!' marker
      const bx = spawn.x - 118, by = spawn.y - 22;
      const bc = this.add.container(bx, by + 6).setDepth(by + 10);
      this.quests.registerNpc(BOARD, bc, null);
      this.areas.addInteract({ area: null, x: bx, y: by + 6, r: 38, label: 'Read Notice Board', onUse: () => this.quests.openBoard() });
    }
    // Enemy damage is dealt by their telegraphed lunges / shots (Enemy.aiTick → combat.enemyHitPlayer),
    // not by body contact.

    // Projectiles
    this.shots = this.physics.add.group();
    this.physics.add.overlap(this.shots, this.enemies, (s, e) => {
      const ed = e instanceof Enemy ? e : null;
      if (!ed || s.getData('dead')) return;
      s.setData('dead', true); s.destroy();
      this.damageEnemy(ed, s.getData('dmg') || 10, s.getData('owner') === 'remote', { crit: s.getData('crit'), status: s.getData('status'), knock: 110 });
    });

    // Hotkeys: central input manager (core/input.js) — rebindable, layout-safe,
    // gamepad-aware, auto-unsubscribed on shutdown. Movement is read in update().
    const on = (id, fn) => input.on(id, fn, { scene: this });
    for (let i = 1; i <= 6; i++) on(`skill${i}`, () => this.cast(String(i))); // 5/6 = advanced-class skills
    on('attack', () => this.attack());
    on('potion', () => this.drinkPotion());
    on('interact', () => this.interact());
    on('bag', () => { if (!this.chatOpen) bus.emit(Events.GEAR, { open: 'inventory' }); });
    on('minimap', () => bus.emit(Events.SYSTEM, 'toggle-minimap'));
    this.input.on('pointerdown', (p) => {
      if (p.button !== 0 || this.chatOpen || this.uiLock || this.uiModal || input.modal) return;
      if (this.pointerOnHud(p)) return; // clicks on HUD panels/buttons never swing
      // Tapping a fellow wayfarer opens their menu instead of attacking.
      const peer = remoteAt(this, p.worldX, p.worldY);
      if (peer) {
        audio.play('ui', 0.5);
        social.act('contextMenu', { id: peer.id, name: peer.name, x: p.event?.clientX ?? p.x, y: p.event?.clientY ?? p.y });
        return;
      }
      this.attack(p.worldX, p.worldY);
    });

    // Loot pickups (gear drops + bonus gold)
    this.drops = this.physics.add.group();
    this.physics.add.overlap(this.player, this.drops, (p, d) => { if (this.time.now >= (d.getData('ready') || 0)) this.collectDrop(d); });
    // Hero combat: damage numbers, target lock (Tab/click), dodge (Space/Shift), statuses, loot, death (systems/combat.js)
    this.combat = new Combat(this);

    this.daynight = new DayNight(this);
    // Visual systems: weather, dynamic night lighting, water, foliage sway, ambient particles (systems/fx.js)
    this.fx = new Fx(this, { windows, spawn });
    this.weather = this.fx.weather;
    this.sync = new WorldSync();
    this.sync.attach(this, this.player, this.heroData);
    installSocialWorld(this); // speech/emote bubbles, nameplate tags, right-click hero menu (systems/social/world.js)
    if (net.connected) net.pushHero(this.player.lookHero()); // Creator choices + worn gear > join-time snapshot

    this.zoneId = 'town';
    audio.musicFor('town');
    const resumed = loadProgress(this.pname);
    bus.emit(Events.SYSTEM, resumed && resumed.job === this.player.job.id
      ? `Welcome back, ${this.pname}! (Lv ${this.player.level} · ${this.mode}${net.connected ? ` · room ${net.code}` : ' · solo'})`
      : `Welcome to Embervale, ${this.pname}! (${this.mode}${net.connected ? ` · room ${net.code}` : ' · solo'})`);
    bus.emit(Events.QUEST, this.questText());
    bus.emit(Events.PLAYER_HP, this.hpPayload());
    bus.emit(Events.PLAYER_XP, this.xpPayload());
    this.events.once('shutdown', () => { this.saveNow(); this.quests.destroy(); this.ach.destroy(); this.sync.destroy(); this.scene.stop('overlay'); });
    this.scene.launch('ui', { hero: this.heroData, name: this.pname, job: this.player.job });
    initPrompt(this); showRoomCode(this);
    this.scene.launch('character'); // RPG panels (C / K) + level-up toasts, see CharacterScene.js
    this.scene.launch('overlay');
  }

  // True when a pointer is over any interactive HUD object in the UI scenes.
  pointerOnHud(p) {
    for (const k of ['overlay', 'character', 'ui']) {
      const sc = this.scene.get(k);
      if (sc?.sys.isActive() && sc.input?.enabled && sc.input.hitTestPointer(p).length) return true;
    }
    return false;
  }

  hpPayload() { return { hp: Math.ceil(this.player.hp), maxHp: this.player.effMaxHp(), mp: Math.ceil(this.player.mp), maxMp: this.player.effMaxMp(), potions: this.player.potions, gold: this.player.gold, level: this.player.level, atk: Math.round(this.player.effAtk()), def: this.player.effDef() }; }
  xpPayload() { return { xp: this.player.xp, xpNext: this.player.xpNext, level: this.player.level }; }
  questText() {
    return this.quests ? this.quests.trackerText() : '';
  }

  spawnEnemies() {
    this.spawner.populateOverworld();
  }

  // Factory shared by the overworld spawner, area spawns and respawns (bosses get their own class).
  // Level rolls inside the zone's range; non-boss enemies may roll an elite / champion rank.
  makeEnemy(x, y, typeId, areaId = null, opts = {}) {
    const def = ENEMY_TABLE[typeId] || ENEMY_TABLE.dewslime;
    const rnd = opts.rnd || Math.random;
    const zoneLv = areaId ? AREAS[areaId]?.lv : this.zoneHere(x, y).lv;
    // opts.eo overrides level / rank / zoneLv (dungeon floors, boss adds); opts.local keeps the enemy out of co-op enemy sync
    const eo = { zoneLv, level: rollMobLevel(def, zoneLv, rnd), rank: def.boss ? RANKS.normal : rollRank(rnd), ...(opts.eo || {}) };
    const e = def.boss ? new (def.mech ? MechBoss : Boss)(this, x, y, typeId, eo) : new Enemy(this, x, y, typeId, eo);
    e.areaId = areaId;
    this.enemies.add(e);
    if (opts.local) e.localOnly = true; else this.sync?.registerEnemy(e); // net: stable id for co-op enemy sync
    return e;
  }

  // Which zone (overworld rect or area/sub-zone) contains this world position.
  zoneHere(x, y) {
    const a = this.areas?.zoneHere(x, y);
    if (a) return a;
    const t = CONFIG.tile;
    return zoneAt(Math.floor(x / t), Math.floor(y / t), ZONES);
  }

  saveNow() {
    saveProgress(this.pname, {
      job: this.player.job.id, level: this.player.level, xp: this.player.xp, xpNext: this.player.xpNext,
      gold: this.player.gold, potions: this.player.potions,
      maxHp: this.player.maxHp, maxMp: this.player.maxMp, atk: this.player.atk,
      x: Math.round(this.areas?.savePos()?.x ?? this.player.x), y: Math.round(this.areas?.savePos()?.y ?? this.player.y), quest: this.questState,
      inventory: [...this.player.inventory], equipped: { ...this.player.equipped }, dyes: { ...this.player.dyes },
      prog: this.player.prog, ext: this.meta,
    });
  }

  // — loot drops —
  spawnDrop(x, y, gearId) {
    return this.combat?.spawnItemDrop(x, y, gearId) || null; // bounce-out + rarity beam + magnet
  }

  collectDrop(d) {
    const id = d.getData('gearId');
    const g = id && gearById(id);
    if (!g || this.player.dead || !d.active) return;
    d.destroy();
    this.combat?.floatText(this.player.x, this.player.y - 34, g.name, RARITY[g.rarity]?.color || '#fff', 'small');
    if (this.player.inventory.length >= BAG_SIZE) {
      const v = sellPrice(g); this.player.gold += v;
      bus.emit(Events.SYSTEM, `Bag full! Sold ${g.name} on the spot (+${v}g).`);
      bus.emit(Events.PLAYER_HP, this.hpPayload());
      return;
    }
    this.player.inventory.push(id);
    audio.play('gold');
    this.spawnFx(this.player.x, this.player.y - 12, 'fx.spark', 1.2);
    bus.emit(Events.SYSTEM, `Loot: ${g.name} [${RARITY[g.rarity].name}] (${statLine(g.stats)}) — press I to equip`);
    bus.emit(Events.GEAR, { changed: true });
    bus.emit(Events.PLAYER_HP, this.hpPayload());
    this.saveNow();
  }

  // Put an item in the bag (used by quest rewards).
  grantGear(id, why = 'Reward') {
    const g = id && gearById(id);
    if (!g) return false;
    if (this.player.inventory.length >= BAG_SIZE) { this.player.gold += sellPrice(g); bus.emit(Events.SYSTEM, `${why}: ${g.name} (bag full, sold +${sellPrice(g)}g)`); return false; }
    this.player.inventory.push(id);
    bus.emit(Events.SYSTEM, `${why}: ${g.name} [${RARITY[g.rarity].name}] — press I to equip`);
    bus.emit(Events.GEAR, { changed: true });
    return true;
  }

  // Floating combat text (pooled in systems/combat.js).
  damageNumber(x, y, text, color = '#ffffff') {
    this.combat?.floatText(x, y - 20, text, color);
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

  // opts: { status: {id, chance}, scale }
  fireShot(x, y, angle, dmg, kind, opts = {}) {
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
    s.setData('crit', this.combat ? this.combat.isCrit(dmg) : false);
    s.setData('status', opts.status || (kind === 'fire' ? { id: 'burn', chance: 0.35 } : null));
    if (opts.scale) s.setScale(opts.scale);
    this.shots.add(s);
    attachShotFx(this, s, kind);
    s.body.setVelocity(Math.cos(angle) * 280, Math.sin(angle) * 280);
    if (kind === 'shuriken') this.tweens.add({ targets: s, angle: 360, duration: 400, repeat: -1 });
    this.time.delayedCall(900, () => s.destroy?.());
    return s;
  }

  // opts: { crit, knock, status:{id,chance,secs}, dot } — see systems/combat.js
  damageEnemy(ed, dmg, fromRemote = false, opts = {}) {
    return this.combat.damageEnemy(ed, dmg, fromRemote, opts);
  }

  // Quest / side-quest kill credit (also used for party kill shares; ed may be null).
  creditKill(typeId, ed) {
    // quest / bestiary / material / achievement credit is handled by onKillContent (quests v2)
    this.areas?.onKill(ed || { typeId });
    this.player.questKills[typeId] = (this.player.questKills[typeId] || 0) + 1;
    this.questState.kills[typeId] = (this.questState.kills[typeId] || 0) + 1;
  }

  // Quests v2 / bestiary / material drops / achievements on a kill.
  onKillContent(ed, dropId) {
    const b = this.meta.bestiary[ed.typeId] || (this.meta.bestiary[ed.typeId] = { kills: 0, drops: {} });
    b.kills += 1;
    if (dropId) b.drops[dropId] = 1;
    for (const id of rollMatDrops(ed.typeId, this.player.equipBonuses().luk)) { if (addMat(this, id, 1)) b.drops[id] = 1; }
    bus.emit(Events.ACH_EVENT, { k: 'kill', boss: !!ed.def.boss });
    this.quests.onKill(ed.typeId);
  }

  // Called by AreaManager once a map/interior is built: nodes + stations for that space.
  onAreaBuilt(def, b) {
    placeGatherNodes(this, def, b);
    this.craft.buildStations(this, def.id, def.origin);
  }

  // Basic attack: 3-hit chain (1.0x / 1.1x / 1.6x finisher). Melee hits a frontal arc;
  // bows / wands fire at the pointer, else the locked target, else the facing.
  attack(tx, ty) {
    if (!this.combat.canAct()) return;
    const p = this.player, now = this.time.now;
    const cd = p.cooldowns.slash || 0;
    if (now < cd) return;
    const ch = this.combat.chain;
    const step = now < ch.until ? (ch.step % 3) + 1 : 1;
    ch.step = step;
    const delay = p.attackDelay() * (step === 3 ? 1.5 : 1);
    p.cooldowns.slash = now + delay;
    ch.until = now + delay + 650;
    const kind = p.weaponKind();
    const bow = kind === 'bow';
    const mage = kind === 'wand';
    const mul = [1, 1.1, 1.6][step - 1];
    const dmg = p.rollCrit((p.effAtk() + Math.floor(Math.random() * 4)) * mul);
    let a = tx !== undefined ? Math.atan2(ty - p.y, tx - p.x) : this.combat.targetAngle(bow || mage ? 230 : 48);
    if (a === null) a = this.facingAngle();
    else if (tx === undefined) { // turn to face the locked target
      const deg = Phaser.Math.RadToDeg(a);
      p.setFacing(deg > -45 && deg <= 45 ? 'right' : deg > 45 && deg <= 135 ? 'down' : deg > -135 && deg <= -45 ? 'up' : 'left');
    }
    p.attackPose();
    if (bow || mage) {
      audio.play(mage ? 'cast' : 'arrow');
      if (step === 3 && bow) {
        for (let i = -1; i <= 1; i++) this.fireShot(p.x, p.y - 8, a + i * 0.16, dmg * (i ? 0.6 : 1), 'arrow', { status: { id: 'slow', chance: 0.5, secs: 2 } });
      } else if (step === 3) {
        this.fireShot(p.x, p.y - 8, a, dmg, 'fire', { status: { id: 'burn', chance: 0.6 }, scale: 1.4 });
      } else this.fireShot(p.x, p.y - 8, a, dmg, mage ? 'energy' : 'arrow');
      this.pvpArc(a, 230, 0.22, dmg);
    } else {
      audio.play('swing');
      const range = step === 3 ? 40 : 32;
      this.spawnFx(p.x + Math.cos(a) * 6, p.y - 8 + Math.sin(a) * 6, 'fx.slashArc', step === 3 ? 1.6 : 1.2, Phaser.Math.RadToDeg(a) + (step === 2 ? 180 : 0));
      if (step === 3) this.cameras.main.shake(70, 0.0018);
      const here = this.areas.current?.id || null;
      this.enemies.children.each((e) => {
        if (!(e instanceof Enemy) || !e.alive || (e.areaId || null) !== here) return true;
        const d = Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y);
        const off = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(e.y - p.y, e.x - p.x) - a));
        if (d < range + 4 * (e.vscale - 1) && (d < 14 || off < 1.9)) {
          this.damageEnemy(e, dmg, false, step === 3 ? { knock: 280, status: { id: 'bleed', chance: 0.3 } } : { knock: 140 });
        }
        return true;
      });
      this.pvpArc(a, range, 1.9, dmg);
    }
  }

  // Consensual PvP: duel opponents inside the swing/shot arc take the hit via
  // the relay (recipient validates the pairing before applying damage).
  pvpArc(angle, range, halfArc, dmg) {
    if (!net.connected || !this.sync) return;
    const p = this.player;
    let hitAny = false;
    this.sync.remotes.forEach((r, id) => {
      if (!social.duelingWith(id) || r.otherArea || r.dc) return;
      const d = Phaser.Math.Distance.Between(p.x, p.y, r.x, r.y);
      if (d > range) return;
      const off = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(r.y - p.y, r.x - p.x) - angle));
      if (d > 14 && off > halfArc) return;
      net.send('pvp-hit', { to: id, dmg: Math.round(dmg), x: Math.round(p.x), y: Math.round(p.y) });
      this.spawnFx(r.x, r.y - 8, 'fx.cut', 1);
      hitAny = true;
    });
    return hitAny;
  }

  facingAngle() {
    return { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[this.player.facing] ?? 0;
  }

  cast(slot) {
    const ab = this.player.abilityForKey(slot);
    if (!ab || !this.combat.canAct()) return;
    const lv = this.player.skillLv(ab.id); // skill level 1-5 scales dmg/effect (+15%/lv) and cooldown (-6%/lv)
    if (lv < 1) { bus.emit(Events.SYSTEM, `Learn ${ab.name} in Skills (K) first.`); audio.play('error', 0.7); return; }
    const dm = skillDmgMul(lv);
    const cd = this.player.cooldowns[ab.id] || 0;
    if (this.time.now < cd) { audio.play('error', 0.7); return; }
    const setCd = () => { this.player.cooldowns[ab.id] = this.time.now + this.player.skillCd(ab) * 1000; bus.emit(Events.PLAYER_HP, this.hpPayload()); castVfx(this, ab, lv); };
    if (castFx(this, ab, lv, setCd)) return;
    if (ab.id === 'camp') {
      setCd();
      audio.play('heal');
      this.spawnFx(this.player.x, this.player.y - 4, 'fx.aura', 1.6);
      const f = this.add.circle(this.player.x, this.player.y + 6, 8, 0xe67e22).setDepth(2600);
      this.tweens.add({ targets: f, scale: 1.3, duration: 400, yoyo: true, repeat: 9, onComplete: () => f.destroy() });
      this.time.addEvent({ delay: 1000, repeat: 9, callback: () => {
        const h = Math.round(4 * dm); this.player.heal(h); this.damageNumber(this.player.x, this.player.y, `+${h}`, '#2ecc71');
        bus.emit(Events.PLAYER_HP, this.hpPayload());
      } });
      bus.emit(Events.SYSTEM, `${ab.name}: campfire heals 4 HP/s`);
      return;
    }
    if (ab.id === 'ward') {
      if (this.player.mp < 20) { audio.play('error', 0.7); bus.emit(Events.SYSTEM, 'Not enough MP!'); return; }
      this.player.mp -= 20;
      this.player.invulnUntil = this.time.now + 3000 * dm;
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
        const bb = this.areas.bounds(); // stay inside the current space; never blink into a wall
        let bd = 64;
        const tx = () => Phaser.Math.Clamp(this.player.x + Math.cos(a) * bd, bb.x0, bb.x1);
        const ty = () => Phaser.Math.Clamp(this.player.y + Math.sin(a) * bd, bb.y0, bb.y1);
        while (bd > 0 && this.areas.blockedAt(tx(), ty())) bd -= 8;
        this.player.setPosition(tx(), ty());
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
        if (e instanceof Enemy && e.alive && Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < 70) {
          this.combat.applyEnemyStatus(e, ab.id === 'snare' ? 'slow' : 'stun', ab.id === 'snare' ? 4 : 1.5);
          if (ab.id === 'smoke') this.damageEnemy(e, this.player.effAtk() * dm);
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
      for (let i = -1; i <= 1; i++) this.fireShot(this.player.x, this.player.y - 8, this.facingAngle() + i * 0.3, this.player.effAtk() * dm, 'kunai');
    } else if (ab.id === 'burst') {
      audio.play('explosion');
      this.spawnFx(this.player.x, this.player.y - 8, 'fx.explosion', 2);
      this.cameras.main.shake(120, 0.003);
      this.enemies.children.each((e) => {
        if (e instanceof Enemy && Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y) < 56) this.damageEnemy(e, (this.player.effAtk() + 6) * dm);
        return true;
      });
    } else {
      audio.play('fireball');
      this.fireShot(this.player.x, this.player.y - 8, this.facingAngle(), (this.player.effAtk() + 4) * dm, ab.id === 'bolt' ? 'fire' : 'shuriken');
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
    if (!this.areas?.current) {
      for (const n of this.npcs) {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y);
        if (d < bd) { bd = d; best = n; }
      }
    }
    // doors, signs, waystones, stations, area/ambient NPCs — unless a town NPC is closer
    if (this.areas?.interact(best ? bd : 1e9)) return;
    if (best) {
      audio.play('npc');
      this.spawnFx(best.x, best.y - 20, 'fx.spark', 0.9);
      const def = best.getData('def');
      const plain = () => {
        if (def.shop) {
          bus.emit(Events.GEAR, { open: 'shop', shop: def.shop });
          bus.emit(Events.SYSTEM, `${def.name}: have a look at my wares!`);
        } else {
          bus.emit(Events.SYSTEM, `${def.name}: ${def.text}`);
        }
      };
      if (this.quests.talk(def.name, plain, def.shop ? 'Browse wares' : 'Chat', best)) return;
      plain();
    }
  }

  // Ghost fade, 5% XP / gold penalty, respawn at the nearest attuned waystone (systems/combat.js).
  onDeath() {
    this.combat.onPlayerDeath();
  }

  // Nameplates: fade with distance to the hero and nudge upward so labels of
  // nearby NPCs / remote players never overprint each other.
  updateNameplates() {
    const me = this.player;
    if (!me) return;
    const items = [];
    const add = (c, l) => { if (c && l && l.active) items.push({ c, l }); };
    for (const n of this.npcs || []) add(n, n.list?.[2]);
    this.sync?.remotes?.forEach((r) => add(r, r.label));
    const placed = [];
    items.sort((a, b) => a.c.y - b.c.y);
    for (const it of items) {
      const d = Math.hypot(it.c.x - me.x, it.c.y - me.y);
      const a = Phaser.Math.Clamp(1 - (d - 70) / 50, 0, 1);
      it.l.setAlpha(a).setVisible(a > 0.03);
      if (a <= 0.03) continue;
      let off = 0;
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((q) => Math.abs(q.x - it.c.x) < 44 && Math.abs(q.y - (it.c.y + off)) < 11);
        if (!hit) break;
        off -= 11;
      }
      it.l.y = -26 + off;
      placed.push({ x: it.c.x, y: it.c.y + off });
    }
  }

  update(time, delta) {
    const dt = delta / 1000;
    this.daynight.update(dt);
    this.combat.regen(dt, time, delta); // MP always, HP too once out of combat
    // movement (keyboard + touch stick)
    const mv = input.axis(); // keys (rebindable) + gamepad stick/d-pad
    let vx = mv.x, vy = mv.y;
    vx += this.touchInput.x; vy += this.touchInput.y;
    if (!this.player.dead && !this.uiLock && !this.transitioning) {
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
    this.areas.update(time, delta);
    this.dungeon?.update(time, delta); this.worldEvents?.update(time, delta);
    this.life?.update(time, delta); this.townfolk?.update(time, delta); // ambient critters + NPC schedules
    this.gather.update();
    this.craft.update(dt);
    this.quests.update(dt);
    this.ach.update(dt);
    this.combat.update(time, delta); // roll / stun / slow overrides, statuses, loot magnet
    this.spawner.update(time);

    // zone tracking
    const t = CONFIG.tile;
    const z = this.zoneHere(this.player.x, this.player.y);
    if (z.id !== this.zoneId) {
      this.zoneId = z.id;
      audio.musicFor(z.id);
      bus.emit(Events.ZONE, z);
      bus.emit(Events.SYSTEM, `${z.safe ? '— ' : ''}${z.name}: ${z.desc}`);
      if (!z.safe && this.player.level < z.level - 1 && !this.areas.current) {
        audio.play('alert', 0.8);
        bus.emit(Events.SYSTEM, `Careful: ${z.name} is Lv ${z.level}+!`);
        this.scene.get('overlay')?.warn?.(`DANGER: ${z.name} is Lv ${z.lv ? z.lv[0] : z.level}+  (you are Lv ${this.player.level})`);
      }
    }

    // enemy AI: aggro / leash / wander / per-type attacks (Enemy.aiTick, Boss.aiUpdate)
    this.combat.updateEnemies(time, delta);

    updatePrompt(this, dt);
    this.fx.update(time, dt);

    // autosave progress every 10s
    this.saveAcc += dt;
    if (this.saveAcc > 10) { this.saveAcc = 0; this.saveNow(); }

    // net
    this.sync.update(dt);
    this.updateNameplates();
  }
}
