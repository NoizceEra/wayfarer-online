import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { RANKS } from '../data/combatMath.js';
import { EVENT_TYPES, WORLD_BOSS, scheduleAt, WARN_MS, BOSS_WINDOW_MS } from '../data/worldEvents.js';
import { grantLoot } from './lootUtil.js';
import { giveItem, ITEMS } from '../data/items.js';
import { addMat } from './pack.js';
import { EventHudScene } from '../scenes/EventHudScene.js';

const T = CONFIG.tile;
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// World events + world boss (data/worldEvents.js): announces in chat / toast / banner, simulates
// the encounter locally, rewards every participant, and feeds the achievement counters.
// Deterministic by wall-clock time - no server needed. Debug handle: window.__worldEvents.
export class WorldEvents {
  constructor(scene) {
    this.s = scene;
    this.cur = null;       // active slot event: { key, def, ev, objs, ... }
    this.boss = null;      // active world boss: { key, arena, ev, e (Boss), ... }
    this.warned = new Set();
    this.acc = 0;
    this.skew = 0;         // tests: shift the clock
    this.override = null;  // tests: { active, boss } fake schedule entries
    this.hud = { lines: [], boss: null };
    this.offKill = bus.on(Events.KILL, (k) => this.onKill(k));
    if (typeof window !== 'undefined') window.__worldEvents = this;
    const mgr = scene.scene;
    if (!mgr.get('eventhud')) mgr.add('eventhud', EventHudScene, false);
    scene.time.delayedCall(800, () => { if (scene.sys.isActive() && !mgr.isActive('eventhud')) mgr.launch('eventhud'); });
    scene.events.once('shutdown', () => this.destroy());
  }
  get qs() { return this.s.questState; }
  clock() { return Date.now() + this.skew; }
  claimed(key) { return !!this.qs.evt?.claimed?.[key]; }
  claim(key) {
    const e = this.qs.evt || (this.qs.evt = { claimed: {} });
    e.claimed[key] = 1;
    const ks = Object.keys(e.claimed); if (ks.length > 60) for (const k of ks.slice(0, ks.length - 60)) delete e.claimed[k];
  }

  destroy() {
    this.offKill?.();
    this.endEvent(true); this.endBoss(true);
    try { this.s.scene.stop('eventhud'); } catch { /* ignore */ }
    if (typeof window !== 'undefined' && window.__worldEvents === this) delete window.__worldEvents;
  }

  // ——— announcements ———
  announce(title, text, color = '#ffd84a', banner = true) {
    bus.emit(Events.SYSTEM, `[World Event] ${text}`);
    bus.emit(Events.TOAST, { title, text: text.length > 60 ? text.slice(0, 58) + '..' : text, color });
    if (banner) this.s.scene.get('overlay')?.banner?.(title, 'World event', 0xffd84a);
    audio.play('alert', 0.5);
  }

  // ——— helpers ———
  overworld() { return !this.s.areas?.current; }
  posOf(at) { return { x: at.tx * T + 8, y: at.ty * T + 8 }; }
  freeSpot(x, y, r = 14) {
    const w = this.s.physics;
    for (let k = 0; k < 40; k++) {
      const a = k * 2.4, d = k === 0 ? 0 : 10 + k * 4;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (!w.overlapRect(px - r / 2, py - r / 2, r, r, false, true).length) return { x: px, y: py };
    }
    return { x, y };
  }
  remotesNear(x, y, rad = 900) {
    let n = 0;
    this.s.sync?.remotes?.forEach((r) => { if (r && Math.hypot((r.x ?? 1e9) - x, (r.y ?? 1e9) - y) < rad) n++; });
    return n;
  }
  bearing(dx, dy) { return COMPASS[Math.round(((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1) * 8) % 8]; }

  // ——— tick ———
  // world events are garnish: a bug here must never take gameplay down (same policy as systems/fx.js)
  update(time, delta) {
    try { this._update(time, delta); } catch (e) {
      this._errs = (this._errs || 0) + 1;
      if (this._errs < 4) console.error('worldEvents', e);
      if (this._errs > 20) this.update = () => {};
    }
  }
  _update(time, delta) {
    this.acc += delta;
    this.frame(delta);
    if (this.acc < 500) return;
    this.acc = 0;
    const now = this.clock();
    const sch = this.override ? { active: this.override.active || null, next: null, boss: this.override.boss || null, nextBoss: null } : scheduleAt(now);
    // warnings (30 s ahead)
    for (const [ev, what] of [[sch.next, 'event'], [sch.nextBoss, 'boss']]) {
      if (ev && ev.start - now < WARN_MS && !this.warned.has(ev.key)) {
        this.warned.add(ev.key);
        if (what === 'event') this.announce('Event incoming', `${ev.def.name} in 30 seconds (${ev.def.where}).`, '#9fe8ff', false);
        else this.announce('World boss stirs', `A world boss awakens in 30 seconds near ${ev.arena.name}!`, '#ff9a7a', false);
      }
    }
    if (sch.active && this.cur?.key !== sch.active.key) { this.endEvent(false); this.startEvent(sch.active, now); }
    else if (!sch.active && this.cur && !this.cur.over) this.endEvent(false, true);
    if (sch.boss && this.boss?.key !== sch.boss.key) { this.endBoss(false); this.startBoss(sch.boss, now); }
    else if (!sch.boss && this.boss && !this.boss.over) this.endBoss(false, true);
    if (this.cur && !this.cur.over) this.ensureEvent();
    this.updateHud(sch, now);
  }

  // per-frame visuals / tracking
  frame() {
    const b = this.boss;
    if (b && !b.over && b.e?.active && b.e.alive) {
      b.dealt = Math.max(b.dealt, 1 - b.e.hp / b.e.maxHp);
      const eng = b.e.engaged;
      if (eng && !b.music) { b.music = true; audio.musicFor('mus_boss_alt'); }
      if (!eng && b.music) { b.music = false; audio.musicFor(this.s.zoneId); }
    }
    const c = this.cur;
    if (c && c.boss?.active && c.boss.alive) c.dealt = Math.max(c.dealt || 0, 1 - c.boss.hp / c.boss.maxHp);
  }

  // ——— slot events ———
  startEvent(ev, now) {
    const def = ev.def;
    this.cur = { key: ev.key, def, ev, objs: [], dealt: 0, spawned: false, over: false, joined: false };
    const left = ev.end - now;
    this.announce(def.name, `${def.text} (${fmt(left)} left)`, '#ffd84a');
  }

  ensureEvent() {
    const c = this.cur, def = c.def, s = this.s;
    if (def.kind === 'caravan') return this.ensureCaravan();
    if (c.spawned) return; // overworld objects persist while you are inside a map, so spawn regardless
    c.spawned = true;
    const p = this.posOf(def.at);
    if (def.kind === 'boss') {
      const pos = this.freeSpot(p.x, p.y, 40);
      const lv = Math.max(4, Math.min(10, s.player.level));
      const e = s.makeEnemy(pos.x, pos.y, def.boss, null, { local: true, eo: { level: Math.max(4, lv), rank: RANKS.normal, zoneLv: [1, 99] } });
      e.noRespawn = true; e.eventKey = c.key;
      c.boss = e; c.objs.push(e);
      s.spawnFx?.(pos.x, pos.y - 10, 'fx.explosion', 3);
      this.beacon(c, p, 0x5fe0a0);
    } else if (def.kind === 'star') {
      this.spawnStar(c, p);
    } else if (def.kind === 'raid') {
      const lv = Math.max(8, Math.min(14, s.player.level));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.283, d = 50 + (i % 2) * 28;
        const pos = this.freeSpot(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.7);
        const e = s.makeEnemy(pos.x, pos.y, def.types[i % def.types.length], null, { local: true, eo: { level: lv, rank: i === 0 ? RANKS.champion : RANKS.elite, zoneLv: [8, 14] } });
        e.noRespawn = true; e.eventKey = c.key;
        c.objs.push(e);
      }
      this.beacon(c, p, 0xff6a4a);
    }
  }

  beacon(c, p, color) {
    const s = this.s;
    if (!s.textures.exists('fx.glow')) return;
    const g = s.add.image(p.x, p.y - 4, 'fx.glow').setDepth(2400).setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(2.2).setAlpha(0.35);
    s.tweens.add({ targets: g, alpha: 0.12, scale: 2.6, duration: 900, yoyo: true, repeat: -1 });
    const ring = s.add.ellipse(p.x, p.y + 6, 92, 34, color, 0.12).setStrokeStyle(2, color, 0.7).setDepth(1);
    s.tweens.add({ targets: ring, alpha: 0.4, scaleX: 1.15, duration: 1100, yoyo: true, repeat: -1 });
    c.objs.push(g, ring);
  }

  spawnStar(c, p) {
    const s = this.s, gather = s.gather;
    // the falling streak (visible to anyone on the overworld)
    if (this.overworld()) {
      const g = s.add.graphics().setDepth(2900);
      const sx = p.x - 420, sy = p.y - 620, o = { t: 0 };
      s.tweens.add({ targets: o, t: 1, duration: 1100, ease: 'quad.in', onUpdate: () => {
        g.clear();
        const hx = sx + (p.x - sx) * o.t, hy = sy + (p.y - sy) * o.t;
        g.lineStyle(3, 0xc8f0ff, 0.9).lineBetween(hx - (p.x - sx) * 0.18, hy - (p.y - sy) * 0.18, hx, hy);
        g.fillStyle(0xffffff, 1).fillCircle(hx, hy, 4);
      }, onComplete: () => { g.destroy(); s.spawnFx?.(p.x, p.y - 8, 'fx.explosion', 2.8); if (Math.hypot(s.player.x - p.x, s.player.y - p.y) < 500) s.cameras.main.shake(300, 0.006); } });
    }
    this.beacon(c, p, 0xc8f0ff);
    // crater + crystals
    const cr = s.add.graphics().setDepth(0);
    cr.fillStyle(0x2a2a3a, 0.55).fillEllipse(p.x, p.y + 4, 120, 56); cr.fillStyle(0x161622, 0.65).fillEllipse(p.x, p.y + 4, 84, 38);
    c.objs.push(cr);
    const n = c.def.nodes || 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + 0.3, d = 34 + (i % 3) * 26;
      const pos = this.freeSpot(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.7 + 6);
      const node = gather.addNode('starcrystal', pos.x, pos.y, null);
      const orig = node.itRef.onUse;
      node.itRef.onUse = () => { const was = node.ready; orig(); if (was && !node.ready) { bus.emit(Events.ACH_EVENT, { k: 'star' }); this.markJoined(c); } };
      c.objs.push({ node, destroy: () => this.removeNode(node) });
    }
  }
  removeNode(node) {
    const s = this.s, g = s.gather;
    node.img?.destroy();
    const i = g.nodes.indexOf(node); if (i >= 0) g.nodes.splice(i, 1);
    const j = s.areas.interacts.indexOf(node.itRef); if (j >= 0) s.areas.interacts.splice(j, 1);
  }

  // Merchant caravan: lives inside Dock Town (built lazily), so it is (re)created whenever the map exists.
  ensureCaravan() {
    const c = this.cur, s = this.s, mgr = s.areas;
    const b = mgr.built.dock;
    if (!b || c.spawned) return;
    c.spawned = true;
    const o = b.o, x = o.x + c.def.at.tx * T, y = o.y + c.def.at.ty * T;
    // wagon
    const wg = s.add.container(x + 34, y + 18).setDepth(y + 20);
    const gr = s.add.graphics();
    gr.fillStyle(0x000000, 0.25).fillEllipse(0, 12, 70, 12);
    gr.fillStyle(0x6a4a2a).fillRect(-28, -6, 56, 16); gr.fillStyle(0x8a6a3a).fillRect(-28, -6, 56, 4);
    gr.fillStyle(0xe8d8b0).fillRect(-24, -26, 48, 20); gr.fillStyle(0xc8b890).fillRect(-24, -10, 48, 4); gr.fillStyle(0xc0392b).fillRect(-24, -26, 48, 4);
    gr.fillStyle(0x3a2412).fillCircle(-18, 12, 8).fillCircle(18, 12, 8); gr.fillStyle(0x8a6a3a).fillCircle(-18, 12, 5).fillCircle(18, 12, 5);
    wg.add(gr);
    const sign = s.add.text(x, y - 34, 'Merchant Caravan', { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#ffe8a0', backgroundColor: '#00000099' }).setOrigin(0.5).setDepth(2790);
    const glow = s.textures.exists('fx.glow') ? s.add.image(x, y - 16, 'fx.glow').setDepth(2400).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc070).setScale(1.3).setAlpha(0.35) : null;
    c.objs.push(wg, sign); if (glow) c.objs.push(glow);
    const merchant = mgr.addNpc('dock', { name: 'Caravan Merchant Tariq', tex: 'Sultan', x, y, facing: 'down', onUse: () => this.caravanMenu(merchant) }, b.group);
    const guard = mgr.addNpc('dock', { name: 'Caravan Guard', tex: 'KnightGold', x: x - 30, y: y + 10, facing: 'right', text: ['Keep your hands off the crates, friend. Buy, or move along.', 'We only stop here a few minutes. Tariq hates being late.'] }, b.group);
    const camel = mgr.addNpc('dock', { name: 'Drover Yara', tex: 'Woman', x: x + 62, y: y + 4, facing: 'left', wander: 18, text: ['Rare wares, rare prices. The Sunscorch road is murder on the axles.'] }, b.group);
    for (const n of [merchant, guard, camel]) c.objs.push({ destroy: () => this.removeNpc(n) });
  }
  removeNpc(n) {
    const mgr = this.s.areas;
    mgr.interacts = mgr.interacts.filter((i) => i.ref !== n);
    mgr.wanderers = mgr.wanderers.filter((w) => w !== n);
    this.s.quests?.npcs?.delete(n.cfg?.name);
    n.destroy();
  }
  caravanMenu(npc) {
    const mgr = this.s.areas, s = this.s, p = s.player;
    const buy = (label, price, fn) => ({ label: `${label} (${price}g)`, cb: () => {
      if (p.gold < price) { audio.play('error', 0.7); return mgr.say('Tariq', 'Not enough gold, friend. The caravan does not do credit.'); }
      p.gold -= price; fn(); audio.play('gold');
      bus.emit(Events.PLAYER_HP, s.hpPayload()); bus.emit(Events.ACH_EVENT, { k: 'caravan' }); this.markJoined(this.cur);
      s.saveNow();
    } });
    s.uiLock = true;
    mgr.say('Caravan Merchant Tariq', 'Rare goods from the far roads - but only while the caravan is in town!', [
      buy('Greater Potion x2', 70, () => addMat(s, 'greater_potion', 2)),
      buy('Scroll of Thunder', 60, () => giveItem(s, 'scroll_thunder', 1)),
      buy('Mithril Bar', 150, () => giveItem(s, 'bar_mithril', 1)),
      buy('Mystery gear crate', 420, () => grantLoot(s, { gear: { rarity: 'rare+', epicChance: 0.25, lvSlack: 2 } }, 'Caravan crate')),
      { label: 'Leave', cb: () => {} },
    ]);
    void npc; void ITEMS;
  }

  markJoined(c) {
    if (!c || c.joined) return;
    c.joined = true;
    bus.emit(Events.ACH_EVENT, { k: 'event' });
  }

  endEvent(silent = false, expired = false) {
    const c = this.cur;
    if (!c) return;
    c.over = true;
    // consolation for partial participation
    if (!silent && c.def.consolation && c.dealt >= 0.2 && !c.rewarded && !this.claimed(c.key)) {
      c.rewarded = true; this.claim(c.key);
      grantLoot(this.s, c.def.consolation, `${c.def.name} (participation)`);
      this.markJoined(c);
    }
    for (const o of c.objs) { try { if (o.node || typeof o.destroy === 'function') o.destroy(); } catch { /* ignore */ } }
    if (!silent && expired) bus.emit(Events.SYSTEM, `[World Event] ${c.def.name} has ended.`);
    this.cur = null;
  }

  // ——— world boss ———
  startBoss(ev, now) {
    const s = this.s;
    this.boss = { key: ev.key, ev, arena: ev.arena, e: null, dealt: 0, over: false, music: false, joined: false };
    this.announce('WORLD BOSS', `${WORLD_BOSS.text} Find it in ${ev.arena.name}. (${fmt(ev.end - now)} left)`, '#ff6a4a');
    const p = this.posOf(ev.arena.at);
    const pos = this.freeSpot(p.x, p.y, 60);
    const near = this.remotesNear(pos.x, pos.y, 1400);
    const lv = Math.max(12, s.player.level);
    const e = s.makeEnemy(pos.x, pos.y, WORLD_BOSS.type, null, { local: true, eo: { level: lv, rank: RANKS.normal, zoneLv: [1, 99] } });
    const mul = 1 + WORLD_BOSS.hpPerPlayer * near;
    e.maxHp = Math.round(e.maxHp * mul); e.hp = e.maxHp;
    e.noRespawn = true; e.worldBoss = true; e.isWorldBoss = true;
    this.boss.e = e;
    // the arena marker
    const g = s.add.graphics().setDepth(0);
    g.lineStyle(3, 0xff6a4a, 0.5).strokeEllipse(pos.x, pos.y + 6, 240, 110); g.lineStyle(1, 0xffd0c0, 0.4).strokeEllipse(pos.x, pos.y + 6, 250, 118);
    this.boss.marker = g;
    if (s.textures.exists('fx.glow')) {
      const gl = s.add.image(pos.x, pos.y, 'fx.glow').setDepth(2400).setBlendMode(Phaser.BlendModes.ADD).setTint(0xff6a4a).setScale(3).setAlpha(0.22);
      s.tweens.add({ targets: gl, alpha: 0.06, duration: 1200, yoyo: true, repeat: -1 });
      this.boss.glow = gl;
    }
  }

  endBoss(silent = false, expired = false) {
    const b = this.boss;
    if (!b) return;
    b.over = true;
    if (b.music) audio.musicFor(this.s.zoneId);
    if (!silent && expired && b.e?.active && b.e.alive) {
      bus.emit(Events.SYSTEM, `[World Event] The ${WORLD_BOSS.name} retreats into the wilds.`);
      if (b.dealt >= WORLD_BOSS.minDamageFrac && !this.claimed(b.key)) {
        this.claim(b.key);
        grantLoot(this.s, WORLD_BOSS.consolation, 'World boss (participation)');
        this.markJoinedBoss(b);
      }
    }
    if (b.e?.active) { b.e.hp = 0; b.e.die?.(); }
    b.marker?.destroy(); b.glow?.destroy();
    this.boss = null;
  }
  markJoinedBoss(b) { if (!b.joined) { b.joined = true; bus.emit(Events.ACH_EVENT, { k: 'event' }); } }

  // ——— kills ———
  onKill(k) {
    if (k?.boss) bus.emit(Events.ACH_EVENT, { k: 'bosskill', id: k.typeId });
    if (!k || k.areaId) return;
    const b = this.boss;
    if (b && !b.over && k.typeId === WORLD_BOSS.type) {
      b.over = true; b.dealt = 1;
      if (!this.claimed(b.key)) {
        this.claim(b.key);
        this.s.time.delayedCall(900, () => {
          grantLoot(this.s, WORLD_BOSS.reward, `${WORLD_BOSS.name} felled`, k.x, k.y);
          bus.emit(Events.TOAST, { title: 'World boss defeated', text: WORLD_BOSS.name, color: '#ffb04a', badge: true });
        });
        bus.emit(Events.ACH_EVENT, { k: 'worldboss' });
        this.markJoinedBoss(b);
      }
      bus.emit(Events.SYSTEM, `[World Event] ${this.s.pname} has defeated the ${WORLD_BOSS.name}!`);
      if (b.music) { b.music = false; audio.musicFor(this.s.zoneId); }
      return;
    }
    const c = this.cur;
    if (!c || c.over) return;
    if (c.def.kind === 'boss' && k.typeId === c.def.boss) {
      c.over = true; c.dealt = 1;
      if (!this.claimed(c.key)) {
        this.claim(c.key);
        this.s.time.delayedCall(700, () => grantLoot(this.s, c.def.reward, `${c.def.name} put down`, k.x, k.y));
        bus.emit(Events.ACH_EVENT, { k: c.def.ach || 'eventwin' });
        this.markJoined(c);
      }
      bus.emit(Events.SYSTEM, `[World Event] ${c.def.name} is over - well fought!`);
    } else if (c.def.kind === 'raid' && c.objs.some((e) => e.eventKey === c.key && e.typeId === k.typeId)) {
      c.dealt = Math.max(c.dealt, 0.2); this.markJoined(c);
      const alive = c.objs.filter((e) => e.eventKey === c.key && e.active && e.alive).length;
      if (alive <= 0) {
        c.over = true;
        if (!this.claimed(c.key)) {
          this.claim(c.key);
          this.s.time.delayedCall(700, () => grantLoot(this.s, c.def.reward, `${c.def.name} repelled`, k.x, k.y));
          bus.emit(Events.ACH_EVENT, { k: c.def.ach || 'eventwin' });
        }
        bus.emit(Events.SYSTEM, `[World Event] The ${c.def.name} has been repelled!`);
      }
    }
  }

  // ——— HUD model ———
  updateHud(sch, now) {
    const s = this.s, p = s.player;
    const lines = [];
    const where = (at, areaName) => {
      if (areaName) return this.s.areas.current?.id === at ? '' : ` - ${areaName}`;
      if (!this.overworld()) return ' - (in the overworld)';
      const px = at.tx * T + 8, py = at.ty * T + 8;
      const dx = px - p.x, dy = py - p.y, d = Math.round(Math.hypot(dx, dy) / T);
      return d < 6 ? ' - HERE' : ` - ${d} tiles ${this.bearing(dx, dy)}`;
    };
    const c = this.cur;
    if (c && !c.over) lines.push({ text: `EVENT  ${c.def.name}  ${fmt(c.ev.end - now)}${c.def.area ? ` - ${c.def.where}` : where(c.def.at)}`, color: '#ffd84a' });
    else if (sch.next && !this.override) lines.push({ text: `Next event: ${sch.next.def.name} in ${fmt(sch.next.start - now)}`, color: '#9fb0c0' });
    const b = this.boss;
    let bossBar = null;
    if (b && !b.over && b.e?.active) {
      const e = b.e; const showBar = this.overworld();
      lines.push({ text: `WORLD BOSS  ${WORLD_BOSS.name}  ${fmt(b.ev.end - now)}${where(b.arena.at)}`, color: '#ff8a6a' });
      if (showBar) bossBar = { name: `${WORLD_BOSS.name}  Lv${e.level}`, hp: Math.max(0, e.hp), max: e.maxHp, engaged: !!e.engaged, phase: e.phase || 1 };
    } else if (sch.nextBoss && !this.override) lines.push({ text: `Next world boss in ${fmt(sch.nextBoss.start - now)}`, color: '#8a94a0' });
    this.hud = { lines, boss: bossBar };
  }
}
void BOSS_WINDOW_MS; void EVENT_TYPES;
