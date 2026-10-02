import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy.js';
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { net } from '../net/NetworkManager.js';
import { input } from '../core/input.js';
import { StatusSet } from './status.js';
import { STATUS, RANKS, heroDmgMul, mobDmgMul, heroMissChance, xpMul } from '../data/combatMath.js';
import { gearById, rollGearDrop, RARITY } from '../data/gear.js';
import { rollDefDrop, rollItemDrops } from '../data/worldEnemies.js';
import { WAYSTONES } from '../data/zones.js';
import { iconKey } from './gearArt.js';
import { CombatHudScene } from '../scenes/CombatHudScene.js';
import { hitSpark } from './skillVfx.js';

const FONT = '"Silkscreen", monospace';
const POOL = 48;           // pooled floating combat texts
const STAM_MAX = 100, ROLL_COST = 32, ROLL_MS = 300, ROLL_SPEED = 250, IFRAME_MS = 270;
const OOC_MS = 5000;       // out-of-combat after 5s without hitting / being hit

// Hero-side combat for WorldScene (`scene.combat`): floating numbers (pooled),
// hit-stop, combo counter, target lock (Tab / click), dodge roll with i-frames +
// stamina, status effects, out-of-combat regen, death + respawn, loot (coins +
// item drops that bounce out, rarity beams, pickup magnet), and the per-frame
// enemy AI driver. Bus events: emits Events.KILL / PLAYER_DIED; consumes
// Events.PARTY_KILL (a party system forwarding a party-mate's kill share).
export class Combat {
  constructor(scene) {
    this.s = scene;
    this.p = scene.player;
    this.statuses = new StatusSet();
    this.target = null;
    this.combo = { n: 0, until: 0, best: 0, bumpAt: 0 };
    this.chain = { step: 0, until: 0 };
    this.stamina = STAM_MAX; this.stamUsedAt = 0;
    this.rollUntil = 0; this.rollV = { x: 0, y: 0 };
    this.pKnockUntil = 0; this.pKnock = { x: 0, y: 0 };
    this.lastCombat = -1e9;
    this.stunImmuneUntil = 0;
    this.eshots = [];
    this.coins = [];
    this.goldAcc = 0; this.goldAccAt = 0;
    this.death = null;
    this.critFrame = -1; this.critDmg = 0;

    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const t = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '10px', color: '#fff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5).setDepth(2800).setVisible(false).setActive(false);
      this.pool.push(t);
    }
    this.poolIdx = 0;
    this.teleG = scene.add.graphics().setDepth(4);
    this.ringG = scene.add.graphics().setDepth(5);
    this.stamG = scene.add.graphics().setDepth(2850);

    // Crit tracking: the hero's rollCrit is wrapped so a crit is shown as a big
    // number on the enemy (not a tag over the hero) and triggers hit-stop.
    const p = this.p;
    p.rollCrit = (dmg) => {
      if (Math.random() * 100 >= p.derived.crit) return dmg;
      this.critFrame = scene.game.loop.frame; this.critDmg = dmg * 1.5;
      return dmg * 1.5;
    };

    // Keys (own handlers so the shared key block stays untouched)
    const kb = scene.input.keyboard;
    const typing = () => { const el = typeof document !== 'undefined' ? document.activeElement : null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };
    kb.addCapture('TAB');
    input.registerAction({ id: 'dodge', label: 'Dodge roll', group: 'Combat', keys: ['ShiftLeft', 'ShiftRight'], gameplay: true });
    input.registerAction({ id: 'target', label: 'Cycle target', group: 'Combat', keys: ['Tab'], gameplay: true });
    // Space also rolls (dialogs use it to confirm first) — never while a menu/help modal owns the keyboard
    kb.on('keydown-SPACE', () => { if (!typing() && !input.modal) this.dodge(); });
    input.on('dodge', () => { this.dodge(); return true; }, { scene });
    input.on('target', () => { this.cycleTarget(); return true; }, { scene });
    scene.input.on('pointerdown', (ptr) => { if (ptr.button === 0 && !scene.chatOpen && !scene.uiLock && !scene.uiModal) this.pickTarget(ptr.worldX, ptr.worldY); });

    this.offParty = bus.on(Events.PARTY_KILL, (k) => this.onPartyKill(k));

    if (!scene.scene.get('combathud')) scene.scene.add('combathud', CombatHudScene, false);
    scene.scene.launch('combathud');
    scene.events.once('shutdown', () => {
      this.offParty?.();
      scene.scene.stop('combathud');
    });
  }

  isCrit(dmg) { return this.critFrame === this.s.game.loop.frame && Math.abs(dmg - this.critDmg) < 0.01; }
  get inCombat() { return this.s.time.now - this.lastCombat < OOC_MS; }
  get rolling() { return this.s.time.now < this.rollUntil; }
  canAct() {
    const s = this.s, p = this.p;
    return !(p.dead || s.uiLock || s.transitioning || s.time.now < s.uiLockUntil || this.statuses.has('stun', s.time.now));
  }

  // ── floating combat text (pooled) ─────────────────────────────────────────
  // style: normal | crit | small | big
  floatText(x, y, text, color = '#ffffff', style = 'normal') {
    const t = this.pool[this.poolIdx];
    this.poolIdx = (this.poolIdx + 1) % POOL;
    if (t._tw) { t._tw.stop(); t._tw = null; }
    if (t._tw2) { t._tw2.stop(); t._tw2 = null; }
    const size = style === 'crit' ? 15 : style === 'big' ? 12 : style === 'small' ? 8 : 10;
    t.setText(String(text)).setColor(color).setFontSize(size).setPosition(x + Phaser.Math.Between(-5, 5), y)
      .setAlpha(1).setScale(1).setVisible(true).setActive(true).setDepth(2800 + (style === 'crit' ? 5 : 0));
    const rise = style === 'crit' ? 22 : 15;
    const dur = style === 'crit' ? 850 : style === 'small' ? 600 : 700;
    if (style === 'crit') {
      t.setScale(1.9);
      t._tw2 = this.s.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'back.out' });
    }
    t._tw = this.s.tweens.add({
      targets: t, y: y - rise, alpha: { from: 1, to: 0 }, duration: dur, ease: 'quad.out', delay: style === 'crit' ? 90 : 0,
      onComplete: () => { t.setVisible(false).setActive(false); t._tw = null; },
    });
    return t;
  }

  hitStop(ms) {
    const s = this.s;
    if (this.stopping) return;
    this.stopping = true;
    const w = s.physics.world;
    w.pause(); s.anims.pauseAll(); s.tweens.pauseAll();
    setTimeout(() => {
      this.stopping = false;
      try { w.resume(); s.anims.resumeAll(); s.tweens.resumeAll(); } catch (e) { /* scene gone */ }
    }, ms);
  }

  bumpCombo() {
    const now = this.s.time.now;
    if (now > this.combo.until) this.combo.n = 0;
    this.combo.n += 1; this.combo.until = now + 2200; this.combo.bumpAt = now;
    this.combo.best = Math.max(this.combo.best, this.combo.n);
  }

  // ── hero → enemy ──────────────────────────────────────────────────────────
  // opts: { crit, knock, status:{id,chance?,secs?}, dot:statusId }
  damageEnemy(ed, dmg, fromRemote = false, opts = {}) {
    const s = this.s, p = this.p;
    if (!(ed instanceof Enemy) || !ed.alive) return false;
    if (s.sync?.interceptHit?.(ed, dmg, fromRemote)) return true; // co-op: non-authority hits go to the area authority
    const now = s.time.now;
    if (ed.mode === 'return') { this.floatText(ed.x, ed.y - 20, 'Evade', '#c8c8c8', 'small'); return false; }
    if (ed.invuln) { this.floatText(ed.x, ed.y - 22, 'Shielded', '#d0a0ff', 'small'); return false; } // MechBoss shield phase
    const dot = opts.dot || null;
    const crit = opts.crit ?? this.isCrit(dmg);
    if (!dot && !fromRemote && Math.random() < heroMissChance(p.level, ed.level)) {
      this.floatText(ed.x, ed.y - 20, 'Miss', '#9bd0ff', 'small');
      this.s.combat.aggro(ed);
      return false;
    }
    const n = Math.max(1, Math.round(dmg * (dot ? 1 : heroDmgMul(p.level, ed.level))));
    this.lastCombat = now;
    const died = ed.hurt(n, { knock: dot ? 0 : (opts.knock ?? (crit ? 230 : 150)), flashMs: dot ? 0 : 70 });
    if (dot) {
      this.floatText(ed.x, ed.y - 18, n, STATUS[dot]?.text || '#fff', 'small');
    } else {
      audio.play('hit', crit ? 1 : 0.8);
      s.spawnFx(ed.x, ed.y - 8, 'fx.cut', crit ? 1.4 : 1);
      hitSpark(s, ed.x, ed.y - 8, crit);
      if (crit) this.floatText(ed.x, ed.y - 22, `${n}!`, '#ffd24a', 'crit');
      else this.floatText(ed.x, ed.y - 20, n, '#ffffff');
      if (!fromRemote) this.bumpCombo();
      if (crit) { this.hitStop(60); s.cameras.main.shake(70, 0.0022); }
    }
    if (!died && opts.status && Math.random() < (opts.status.chance ?? 1)) this.applyEnemyStatus(ed, opts.status.id, opts.status.secs);
    if (!died) this.aggro(ed);
    else this.killEnemy(ed, fromRemote);
    return died;
  }

  applyEnemyStatus(ed, id, secs) {
    if (!ed?.alive) return;
    const def = STATUS[id];
    if (ed.isBoss && id === 'stun') { this.floatText(ed.x, ed.y - 26, 'Immune', '#c8c8c8', 'small'); return; }
    const now = this.s.time.now;
    const fresh = ed.statuses.apply(id, now, { secs: ed.isBoss && id === 'slow' ? (secs ?? def.secs) * 0.5 : secs, dmg: def.dot ? this.p.effAtk() * def.dot : 0 });
    if (fresh) this.floatText(ed.x, ed.y - 28, def.name, def.text, 'small');
    if (id === 'slow') ed.restoreTint();
  }

  // Pull an enemy into combat (+ social kin nearby).
  aggro(ed, social = true) {
    if (!ed.alive || ed.isBoss) return;
    const now = this.s.time.now;
    this.lastCombat = Math.max(this.lastCombat, now - OOC_MS + 1500);
    if (ed.mode === 'chase' || ed.mode === 'flee') return;
    if (ed.mode === 'return') return;
    ed.mode = 'chase'; ed.nextAtk = Math.max(ed.nextAtk, now + 250);
    ed.showBars(true);
    if (social && ed.def.social) {
      this.s.enemies.children.each((o) => {
        if (o !== ed && o instanceof Enemy && o.alive && o.mode === 'idle' && !o.isBoss && o.areaId === ed.areaId
          && (o.typeId === ed.typeId || o.def.social) && Phaser.Math.Distance.Between(o.x, o.y, ed.x, ed.y) < 85) {
          o.mode = 'chase'; o.nextAtk = now + 400 + Math.random() * 400; o.showBars(true);
        }
        return true;
      });
    }
  }

  killEnemy(ed, fromRemote) {
    const s = this.s, p = this.p;
    audio.play('monsterDie');
    s.spawnFx(ed.x, ed.y - 6, 'fx.smoke', 1.2 * ed.vscale);
    const xp = Math.max(1, Math.round(ed.xpValue * xpMul(p.level, ed.level)));
    const payload = {
      typeId: ed.typeId, name: ed.displayName, level: ed.level, rank: ed.rank.id, boss: !!ed.isBoss,
      xp, x: Math.round(ed.x), y: Math.round(ed.y), areaId: ed.areaId || null, by: s.pname,
    };
    // Party hook: a party system may take a share (return value = our XP).
    let myXp = xp;
    const party = typeof window !== 'undefined' ? window.__party : null;
    if (party && typeof party.shareKill === 'function') {
      try { const r = party.shareKill(payload); if (typeof r === 'number' && r >= 0) myXp = Math.round(r); } catch (e) { console.error(e); }
    }
    bus.emit(Events.KILL, payload);
    this.grantXp(myXp, ed.x, ed.y - 30);
    // Token points from kills
    const tp = Math.max(1, Math.round(ed.level * (ed.rank?.xp || 1)));
    p.tokenPoints = (p.tokenPoints || 0) + tp;
    this.floatText(ed.x, ed.y - 44, `+${tp} TP`, '#7dff9a', 'small');
    if (!fromRemote || !net.connected) this.dropLoot(ed);
    ed.onSlain?.(s);
    s.creditKill?.(ed.typeId, ed);
    if (this.target === ed) this.setTarget(null);
    s.spawner?.onDeath(ed);
    ed.die();
    bus.emit(Events.PLAYER_HP, s.hpPayload());
    bus.emit(Events.PLAYER_XP, s.xpPayload());
    bus.emit(Events.QUEST, s.questText());
    s.saveNow();
  }

  grantXp(xp, x, y) {
    const s = this.s, p = this.p;
    if (xp <= 0) return false;
    this.floatText(x ?? p.x, y ?? p.y - 30, `+${xp} XP`, '#c79bff', 'small');
    const leveled = p.gainXp(xp);
    if (leveled) {
      audio.play('level');
      s.spawnFx(p.x, p.y - 10, 'fx.boost', 1.4);
      bus.emit(Events.SYSTEM, `${s.pname} reached Lv ${p.level}!`);
    }
    return leveled;
  }

  // A party system forwards a party-mate's kill: { typeId, xp, by, level? }.
  onPartyKill(k) {
    if (!k || k.by === this.s.pname || this.p.dead) return;
    const xp = Math.max(0, Math.round(k.xp || 0));
    this.grantXp(xp);
    if (k.typeId && k.questCredit !== false) this.s.creditKill?.(k.typeId, null);
    bus.emit(Events.PLAYER_XP, this.s.xpPayload());
    bus.emit(Events.QUEST, this.s.questText());
  }

  // ── enemy → hero ──────────────────────────────────────────────────────────
  enemyHitPlayer(ed) {
    const s = this.s, p = this.p;
    if (p.dead || s.zoneHere(p.x, p.y).safe) return;
    if (s.time.now < p.invulnUntil) { if (this.rolling) this.floatText(p.x, p.y - 26, 'Dodge', '#9bd0ff', 'small'); return; }
    if (p.tryDodge()) return; // FLEE-based dodge (shows Miss)
    const raw = ed.hitDmg * mobDmgMul(p.level, ed.level);
    const n = Math.max(1, Math.round(raw - p.effDef() * 0.5));
    if (this.hitPlayer(n, ed)) {
      const inf = ed.def.inflict;
      if (inf && Math.random() < inf.chance) this.applyPlayerStatus(inf.id, ed.atk);
    }
  }

  // Boss / scripted hits: raw damage before level + DEF mitigation.
  hitPlayerFrom(src, raw, status) {
    const p = this.p;
    if (p.dead) return false;
    const n = Math.max(1, Math.round(raw * mobDmgMul(p.level, src.level || p.level) - p.effDef() * 0.5));
    const ok = this.hitPlayer(n, src, true);
    if (ok && status) this.applyPlayerStatus(status.id, src.atk || raw, status.secs);
    return ok;
  }

  hitPlayer(n, src, heavy = false) {
    const s = this.s, p = this.p;
    if (!p.hurt(n)) return false;
    this.lastCombat = s.time.now;
    bus.emit(Events.PLAYER_HP, s.hpPayload());
    audio.play('hurt');
    const f = Math.min(1, (n / p.effMaxHp()) * 4);
    s.cameras.main.shake(heavy ? 180 : 70 + 90 * f, (heavy ? 0.006 : 0.0015 + 0.003 * f));
    this.floatText(p.x, p.y - 22, `-${n}`, '#ff6b6b', heavy ? 'big' : 'normal');
    this.combo.n = 0; // getting hit breaks the combo
    if (src && src.x !== undefined) { // small knockback
      const a = Math.atan2(p.y - src.y, p.x - src.x);
      this.pKnock = { x: Math.cos(a) * (heavy ? 200 : 120), y: Math.sin(a) * (heavy ? 200 : 120) };
      this.pKnockUntil = s.time.now + (heavy ? 140 : 90);
    }
    if (p.dead) s.onDeath();
    return true;
  }

  applyPlayerStatus(id, srcAtk = 10, secs) {
    const s = this.s, now = s.time.now;
    const def = STATUS[id];
    if (!def || this.p.dead) return;
    if (id === 'stun') {
      if (now < this.stunImmuneUntil) return;
      this.stunImmuneUntil = now + 4000;
      secs = secs ?? 1.0;
      this.rollUntil = 0;
    }
    const fresh = this.statuses.apply(id, now, { secs, dmg: def.dot ? Math.max(1, srcAtk * def.dot) : 0 });
    if (fresh) {
      this.floatText(this.p.x, this.p.y - 32, `${def.name}!`, def.text, 'small');
      audio.play('alert', 0.35);
    }
  }

  // ── dodge roll ────────────────────────────────────────────────────────────
  dodge() {
    const s = this.s, p = this.p, now = s.time.now;
    if (s.chatOpen || !this.canAct() || now < this.rollUntil + 120) return;
    if (this.stamina < ROLL_COST) { this.floatText(p.x, p.y - 26, 'Tired', '#c8c8c8', 'small'); audio.play('error', 0.5); return; }
    this.stamina -= ROLL_COST; this.stamUsedAt = now;
    // roll toward the held movement direction (rebindable keys + gamepad via core/input), else facing
    const mv = input.axis();
    let vx = mv.x, vy = mv.y;
    vx += s.touchInput?.x || 0; vy += s.touchInput?.y || 0;
    let len = Math.hypot(vx, vy);
    if (len < 0.15) { const a = s.facingAngle(); vx = Math.cos(a); vy = Math.sin(a); len = 1; }
    const spd = ROLL_SPEED * (this.statuses.has('slow', now) ? 0.75 : 1);
    this.rollV = { x: (vx / len) * spd, y: (vy / len) * spd };
    this.rollUntil = now + ROLL_MS;
    p.invulnUntil = Math.max(p.invulnUntil, now + IFRAME_MS);
    audio.play('dash', 0.7);
    s.spawnFx(p.x, p.y - 2, 'fx.dust', 1.1);
    s.tweens.add({ targets: p, scaleY: 0.78, scaleX: 1.12, duration: ROLL_MS / 2, yoyo: true, onComplete: () => p.setScale(1) });
    for (let i = 1; i <= 3; i++) {
      s.time.delayedCall(i * 70, () => {
        if (!p.active) return;
        const g = s.add.ellipse(p.x, p.y - 8, 12, 18, 0xbfe6ff, 0.35).setDepth(p.depth - 1);
        s.tweens.add({ targets: g, alpha: 0, scale: 0.6, duration: 260, onComplete: () => g.destroy() });
      });
    }
  }

  // ── targeting ─────────────────────────────────────────────────────────────
  setTarget(e) {
    if (this.target === e) return;
    this.target = e;
    if (e) { audio.play('npc', 0.35); e.showBars(true); }
  }
  enemiesHere() {
    const here = this.s.areas?.current?.id || null;
    return this.s.enemies.getChildren().filter((e) => e instanceof Enemy && e.alive && (e.areaId || null) === here);
  }
  cycleTarget() {
    const s = this.s, p = this.p;
    if (s.chatOpen || p.dead) return;
    const list = this.enemiesHere()
      .map((e) => ({ e, d: Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y) }))
      .filter((o) => o.d < 220).sort((a, b) => a.d - b.d);
    if (!list.length) { this.setTarget(null); return; }
    const i = list.findIndex((o) => o.e === this.target);
    this.setTarget(list[(i + 1) % list.length].e);
  }
  pickTarget(wx, wy) {
    let best = null, bd = 1e9;
    for (const e of this.enemiesHere()) {
      const d = Phaser.Math.Distance.Between(wx, wy, e.x, e.y - 6 * e.vscale);
      if (d < 12 + 6 * e.vscale && d < bd) { bd = d; best = e; }
    }
    if (best) this.setTarget(best);
  }
  // Angle to the locked target if it is in range, else null.
  targetAngle(range) {
    const t = this.target, p = this.p;
    if (!t?.alive) return null;
    if (Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y) > range) return null;
    return Math.atan2(t.y - p.y, t.x - p.x);
  }

  // ── enemy projectiles (ranged types) ──────────────────────────────────────
  enemyShot(ed, angle) {
    const s = this.s;
    const col = ed.def.shot || 0xffe07a;
    const x = ed.x, y = ed.y - 8 * ed.vscale;
    const glow = s.add.circle(x, y, 6, col, 0.3).setDepth(2590).setBlendMode(Phaser.BlendModes.ADD);
    const core = s.add.circle(x, y, 3, col, 1).setDepth(2591).setStrokeStyle(1, 0xffffff, 0.9);
    const sp = 125;
    this.eshots.push({ glow, core, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp, until: s.time.now + 1800, ed: { x, y, atk: ed.atk, level: ed.level, hitDmg: ed.hitDmg, def: ed.def } });
    audio.play('cast', 0.35);
  }
  updateShots(dt, now) {
    const p = this.p;
    for (let i = this.eshots.length - 1; i >= 0; i--) {
      const b = this.eshots[i];
      b.core.x += b.vx * dt; b.core.y += b.vy * dt;
      b.glow.setPosition(b.core.x, b.core.y).setScale(1 + 0.2 * Math.sin(now / 50));
      let dead = now > b.until;
      if (!dead && !p.dead && Math.hypot(p.x - b.core.x, (p.y - 8) - b.core.y) < 9) {
        dead = true;
        this.s.spawnFx(b.core.x, b.core.y, 'fx.spark', 0.8);
        b.ed.x = b.core.x - b.vx; b.ed.y = b.core.y - b.vy; // knock along travel
        this.enemyHitPlayer(b.ed);
      }
      if (dead) { b.core.destroy(); b.glow.destroy(); this.eshots.splice(i, 1); }
    }
  }

  // ── loot ──────────────────────────────────────────────────────────────────
  dropLoot(ed) {
    const s = this.s, p = this.p;
    const [g0, g1] = ed.goldRange;
    const gold = g0 + Math.floor(Math.random() * (Math.max(g0, g1) - g0 + 1));
    const nCoins = Math.min(8, 1 + Math.floor(gold / 5));
    let left = gold;
    for (let i = 0; i < nCoins && left > 0; i++) {
      const v = i === nCoins - 1 ? left : Math.max(1, Math.floor(gold / nCoins));
      left -= v;
      this.spawnCoin(ed.x, ed.y, v, ed.areaId || null);
    }
    const luk = p.equipBonuses().luk || 0;
    const drops = [];
    const first = rollGearDrop(ed.typeId, luk) || rollDefDrop(ed.typeId, gearById);
    if (first) drops.push(first);
    for (let r = 0; r < ed.rank.loot; r++) { // elites / champions: guaranteed bonus rolls
      let id = null;
      for (let t = 0; t < 8 && !id; t++) id = rollGearDrop(ed.typeId, 200 + luk);
      if (id) drops.push(id);
    }
    drops.forEach((id, i) => s.time.delayedCall(i * 140, () => this.spawnItemDrop(ed.x, ed.y - 4, id)));
    try { rollItemDrops(s, ed); } catch (e) { console.error(e); } // food / scrolls / resources (data/items.js)
    s.onKillContent?.(ed, first || null); // quests v2 / bestiary / materials / achievements
    if (ed.rank !== RANKS.normal) bus.emit(Events.SYSTEM, `${ed.displayName} defeated! Bonus loot dropped.`);
  }

  spawnCoin(x, y, value, areaId) {
    const s = this.s;
    const img = s.add.image(x, y - 4, 'fx.coin').setScale(1.3).setDepth(y + 1);
    const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 18;
    const tx = x + Math.cos(a) * r, ty = y + Math.sin(a) * r * 0.6 + 4;
    const c = { img, value, areaId, ready: s.time.now + 550, born: s.time.now, h: 0, flying: false };
    s.tweens.add({ targets: img, x: tx, duration: 480, ease: 'quad.out' });
    s.tweens.addCounter({ from: 0, to: 1, duration: 480, onUpdate: (tw) => {
      const k = tw.getValue();
      c.h = Math.sin(k * Math.PI) * (16 + r * 0.4) * (1 - k * 0.4);
      if (img.active) img.y = Phaser.Math.Linear(y - 4, ty, k) - c.h;
    } });
    this.coins.push(c);
  }

  updateCoins(dt, now) {
    const s = this.s, p = this.p;
    const here = s.areas?.current?.id || null;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (!c.img.active) { this.coins.splice(i, 1); continue; }
      if (now - c.born > 45000) { c.img.destroy(); this.coins.splice(i, 1); continue; }
      c.img.setVisible(c.areaId === here);
      if (c.areaId !== here || p.dead || now < c.ready) continue;
      const dx = p.x - c.img.x, dy = (p.y - 6) - c.img.y, d = Math.hypot(dx, dy);
      // magnet: close coins fly in; after 1.2s coins within 170px vacuum to you
      if (!c.flying && (d < 56 || (now - c.born > 1200 && d < 170))) c.flying = true;
      if (c.flying) {
        const sp = Math.min(520, 160 + (now - c.ready) * 0.5);
        c.img.x += (dx / (d || 1)) * sp * dt; c.img.y += (dy / (d || 1)) * sp * dt;
        c.img.setDepth(c.img.y + 1);
        if (d < 8) {
          c.img.destroy(); this.coins.splice(i, 1);
          p.gold += c.value;
          this.goldAcc += c.value; this.goldAccAt = now + 180;
          audio.play('coin', 0.45);
        }
      }
    }
    if (this.goldAcc && now > this.goldAccAt) {
      this.floatText(p.x, p.y - 30, `+${this.goldAcc}g`, '#f4c542');
      this.goldAcc = 0;
      bus.emit(Events.PLAYER_HP, s.hpPayload());
    }
  }

  // Gear pickup: bounces out, rarity beam, label; collected by WorldScene.collectDrop.
  spawnItemDrop(x, y, gearId) {
    const s = this.s;
    if (s.drops.getLength() > 24) return null;
    const g = gearById(gearId);
    if (!g) return null;
    const R = RARITY[g.rarity] || RARITY.common;
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 14;
    const tx = x + Math.cos(a) * r, ty = y + Math.sin(a) * r * 0.6 + 6;
    const c = s.add.container(x, y).setDepth(y);
    const parts = [];
    const glow = s.add.ellipse(0, 2, g.rarity === 'epic' ? 26 : 20, 9, R.tint, g.rarity === 'common' ? 0.25 : 0.45);
    parts.push(glow);
    if (g.rarity !== 'common') {
      const hgt = { uncommon: 34, rare: 52, epic: 72 }[g.rarity] || 34;
      const beam = s.add.rectangle(0, 2, g.rarity === 'epic' ? 7 : 5, hgt, R.tint, 0.4).setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD);
      const core = s.add.rectangle(0, 2, 2, hgt * 0.9, 0xffffff, 0.35).setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD);
      parts.push(beam, core);
      s.tweens.add({ targets: [beam, core], alpha: 0.12, scaleX: 1.6, duration: 650, yoyo: true, repeat: -1, ease: 'sine.inout' });
      s.tweens.add({ targets: glow, scale: 1.35, alpha: 0.15, duration: 700, yoyo: true, repeat: -1 });
    }
    const bob = s.add.container(0, 0);
    const icon = s.add.image(0, -4, iconKey(s, g, null)); // AI icon when baked, else procedural
    icon.setScale(16 / Math.max(icon.width, 1) * 1.25);
    bob.add(icon);
    const label = s.add.text(0, 11, g.name, { fontFamily: FONT, fontSize: '8px', color: R.color, backgroundColor: '#000000aa' }).setOrigin(0.5).setResolution(2);
    parts.push(bob, label);
    c.add(parts);
    s.physics.add.existing(c);
    c.body.setSize(20, 20);
    c.setData('gearId', g.id);
    c.setData('ready', s.time.now + 600);
    c.areaId = s.areas?.current?.id || null;
    s.drops.add(c);
    label.setAlpha(0);
    s.tweens.add({ targets: c, x: tx, y: ty, duration: 520, ease: 'quad.out', onComplete: () => c.active && c.setDepth(c.y) });
    s.tweens.add({ targets: bob, y: -22, duration: 260, ease: 'quad.out', yoyo: true, onComplete: () => {
      if (!c.active) return;
      label.setAlpha(1);
      s.tweens.add({ targets: icon, y: -8, duration: 600, yoyo: true, repeat: -1, ease: 'sine.inout' });
      if (g.rarity === 'rare' || g.rarity === 'epic') audio.play('quest', 0.5);
    } });
    s.time.delayedCall(60000, () => { if (c.active) c.destroy(); });
    return c;
  }

  updateItemDrops(dt, now) {
    const s = this.s, p = this.p;
    if (p.dead) return;
    s.drops.children.each((d) => {
      if (!d.active || now < (d.getData('ready') || 0)) return true;
      const dx = p.x - d.x, dy = p.y - d.y, dist = Math.hypot(dx, dy);
      if (dist < 11) { s.collectDrop(d); return true; }
      if (dist < 40) { // pickup magnet
        const sp = 90 + (40 - dist) * 5;
        d.x += (dx / dist) * sp * dt; d.y += (dy / dist) * sp * dt;
      }
      return true;
    });
  }

  // ── death / respawn ───────────────────────────────────────────────────────
  respawnPoint() {
    const s = this.s, a = s.areas;
    const here = a?.current?.id || null;
    const ways = s.questState.ways || { town: true };
    let w = here && WAYSTONES.find((q) => q.area === here && ways[q.id]);
    if (!w) w = WAYSTONES.find((q) => q.id === 'town');
    const d = a?.waystoneDest(w.id) || { area: null, x: s.spawn.x, y: s.spawn.y };
    return { ...d, name: w.name };
  }

  onPlayerDeath() {
    const s = this.s, p = this.p;
    if (this.death) return;
    const xpLoss = Math.min(p.xp, Math.round(p.xpNext * 0.05));
    const goldLoss = Math.floor(p.gold * 0.05);
    p.xp -= xpLoss; p.gold -= goldLoss;
    const dest = this.respawnPoint();
    this.death = { at: s.time.now, respawnAt: s.time.now + 3000, xpLoss, goldLoss, dest: dest.name };
    this.statuses.clear(); this.setTarget(null); this.rollUntil = 0; this.combo.n = 0;
    this.eshots.forEach((b) => { b.core.destroy(); b.glow.destroy(); }); this.eshots = [];
    p.body.setVelocity(0, 0);
    audio.play('hurt');
    s.spawnFx(p.x, p.y - 8, 'fx.smoke', 1.6);
    // ghost fade: hero turns translucent and a wisp rises
    s.tweens.add({ targets: p, alpha: 0.35, duration: 600 });
    const wisp = s.add.ellipse(p.x, p.y - 10, 10, 14, 0xdfefff, 0.7).setDepth(2900).setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: wisp, y: p.y - 60, alpha: 0, scaleX: 0.5, duration: 1600, ease: 'sine.out', onComplete: () => wisp.destroy() });
    // every enemy drops aggro and walks home
    s.enemies.children.each((e) => { if (e instanceof Enemy && e.alive && (e.mode === 'chase' || e.mode === 'flee')) e.startReturn(); return true; });
    bus.emit(Events.PLAYER_DIED, { xpLoss, goldLoss, respawn: dest.name });
    bus.emit(Events.SYSTEM, `You have fallen! Lost ${xpLoss} XP and ${goldLoss}g. Respawning at ${dest.name}...`);
    bus.emit(Events.PLAYER_HP, s.hpPayload()); bus.emit(Events.PLAYER_XP, s.xpPayload());
    s.saveNow();
    this.death.destObj = dest; // update() respawns once time.now passes respawnAt (matches the HUD countdown)
  }

  respawn(dest) {
    const s = this.s, p = this.p;
    if (!s.sys.isActive()) return;
    p.hp = p.effMaxHp(); p.mp = p.effMaxMp();
    p.dead = false;
    p.revivePose?.();
    p.invulnUntil = s.time.now + 2500;
    this.death = null;
    this.lastCombat = -1e9;
    const here = s.areas?.current?.id || null;
    const land = () => {
      s.tweens.add({ targets: p, alpha: 1, duration: 500 });
      s.spawnFx(p.x, p.y - 8, 'fx.boost', 1.2);
      bus.emit(Events.PLAYER_HP, s.hpPayload());
      s.saveNow();
    };
    if (s.areas && !s.areas.busy && (dest.area !== here || Phaser.Math.Distance.Between(p.x, p.y, dest.x, dest.y) > 40)) {
      s.areas.warp(dest.area, dest.x, dest.y, { label: `Respawning at ${dest.name}...`, quick: true });
      s.time.delayedCall(700, land);
    } else {
      if (dest.area !== here && s.areas) s.areas._apply(dest.area, dest.x, dest.y);
      else p.setPosition(dest.x, dest.y);
      land();
    }
  }

  // ── per-frame ─────────────────────────────────────────────────────────────
  regen(dt, time, delta) {
    const s = this.s, p = this.p;
    if (p.dead) return;
    const ooc = !this.inCombat;
    const mMax = p.effMaxMp(), hMax = p.effMaxHp();
    let changed = false;
    if (p.mp < mMax) { p.mp = Math.min(mMax, p.mp + dt * (ooc ? Math.max(3, mMax * 0.04) : 2)); changed = true; }
    if (ooc && p.hp < hMax) { p.hp = Math.min(hMax, p.hp + dt * Math.max(1.5, hMax * 0.03)); changed = true; }
    if (changed && Math.floor(time / 500) !== Math.floor((time - delta) / 500)) bus.emit(Events.PLAYER_HP, s.hpPayload());
  }

  update(time, delta) {
    const s = this.s, p = this.p;
    const dt = delta / 1000;
    // hero statuses (DoTs bypass i-frames, never re-trigger the hurt flash)
    if (!p.dead && this.statuses.size) {
      this.statuses.tick(time, (id, dmg) => {
        const n = Math.max(1, Math.round(dmg));
        p.hp -= n; this.lastCombat = time;
        this.floatText(p.x, p.y - 20, `-${n}`, STATUS[id].text, 'small');
        if (p.hp <= 0) { p.hp = 0; p.dead = true; s.onDeath(); }
        bus.emit(Events.PLAYER_HP, s.hpPayload());
      });
    }
    // movement overrides (runs after WorldScene's input movement)
    if (!p.dead && !s.transitioning) {
      if (this.statuses.has('stun', time)) p.body.setVelocity(0, 0);
      else if (time < this.rollUntil) p.body.setVelocity(this.rollV.x, this.rollV.y);
      else if (time < this.pKnockUntil) p.body.setVelocity(this.pKnock.x, this.pKnock.y);
      else if (this.statuses.has('slow', time)) p.body.setVelocity(p.body.velocity.x * STATUS.slow.speed, p.body.velocity.y * STATUS.slow.speed);
    }
    if (this.death && !this.death.going && time >= this.death.respawnAt) { this.death.going = true; this.respawn(this.death.destObj); }
    if (time - this.stamUsedAt > 700 && this.stamina < STAM_MAX) this.stamina = Math.min(STAM_MAX, this.stamina + dt * 42);
    if (time > this.combo.until) this.combo.n = 0;
    this.updateShots(dt, time);
    this.updateCoins(dt, time);
    this.updateItemDrops(dt, time);
    this.drawHeroBits(time);
    this.drawTargetRing(time);
  }

  drawHeroBits(time) {
    const g = this.stamG, p = this.p;
    g.clear();
    if (p.dead) return;
    if (this.stamina < STAM_MAX) {
      const w = 18, x = p.x - w / 2, y = p.y + 6;
      g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 4);
      g.fillStyle(this.stamina < ROLL_COST ? 0x9a6a2a : 0xf4d03f, 1).fillRect(x, y, w * (this.stamina / STAM_MAX), 2);
    }
    if (this.statuses.has('stun', time)) {
      for (let i = 0; i < 3; i++) {
        const a = time / 160 + i * 2.09;
        g.fillStyle(0xffe14a, 1).fillCircle(p.x + Math.cos(a) * 8, p.y - 26 + Math.sin(a) * 2.5, 1.6);
      }
    }
  }

  drawTargetRing(time) {
    const g = this.ringG, t = this.target, p = this.p;
    g.clear();
    if (!t) return;
    const here = this.s.areas?.current?.id || null;
    if (!t.alive || (t.areaId || null) !== here || Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y) > 320) { this.setTarget(null); return; }
    const c = t.con(p.level);
    const rx = 11 * t.vscale, ry = 5 * t.vscale;
    g.setDepth(t.depth - 0.5);
    g.lineStyle(1.5, c.tint, 0.95).strokeEllipse(t.x, t.y + 3, rx * 2, ry * 2);
    for (let i = 0; i < 4; i++) { // rotating corner ticks
      const a = time / 400 + i * Math.PI / 2;
      g.fillStyle(0xffffff, 0.9).fillCircle(t.x + Math.cos(a) * (rx + 2), t.y + 3 + Math.sin(a) * (ry + 1.5), 1.2);
    }
  }

  // Per-frame enemy AI driver (replaces the old inline loop in WorldScene).
  updateEnemies(time, delta) {
    const s = this.s, p = this.p;
    const here = s.areas?.current?.id || null;
    const playerSafe = s.zoneHere(p.x, p.y).safe;
    const tg = this.teleG;
    tg.clear();
    // one reused env object (was a fresh object + 2 closures per frame)
    const env = this._env || (this._env = {
      p: null, nightBoost: 1, playerOk: false,
      safeAt: (x, y) => s.zoneHere(x, y).safe,
      drawLane: (e, a, len, t) => {
        const ex = e.x + Math.cos(a) * len, ey = e.y + Math.sin(a) * len;
        tg.lineStyle(7 * e.vscale, 0xff3030, 0.12 + 0.18 * t).lineBetween(e.x, e.y, ex, ey);
        tg.lineStyle(1, 0xff5040, 0.8).lineBetween(e.x, e.y, e.x + Math.cos(a) * len * t, e.y + Math.sin(a) * len * t);
      },
    });
    env.p = p; env.nightBoost = s.daynight?.isNight ? 1.25 : 1;
    env.playerOk = !p.dead && !playerSafe && !s.transitioning && !this.death;
    const plv = p.level;
    const wv = s.cameras.main.worldView;
    s.enemies.children.each((e) => {
      if (!(e instanceof Enemy) || e.dying) return true;
      if ((e.areaId || null) !== here) { e.body.setVelocity(0, 0); return true; }
      if (s.sync?.driveEnemy?.(e, time, delta)) return true; // co-op: replicas interpolate
      if (e.statuses.size) e.statuses.tick(time, (id, dmg) => this.damageEnemy(e, dmg, false, { dot: id }));
      if (!e.alive) return true;
      // AI sleep: idle, off-screen, non-boss enemies only think every 4th frame (accumulated delta); rendering is culled in core/cull.js
      if (e.mode === 'idle' && !e.isBoss && !e.aiUpdate && !e.engaged && (e.aiState === 'idle' || e.aiState === undefined)
        && (e.x < wv.x - 80 || e.x > wv.right + 80 || e.y < wv.y - 80 || e.y > wv.bottom + 80)) {
        e._sleepDt = (e._sleepDt || 0) + delta;
        e._sleepF = ((e._sleepF ?? (Math.random() * 4 | 0)) + 1) % 4;
        if (e._sleepF) return true;
        delta = e._sleepDt; e._sleepDt = 0; // eslint-disable-line no-param-reassign
        e.aiTick(s, time, delta, env);
        return true;
      }
      e._sleepDt = 0;
      if (e.aiUpdate) e.aiUpdate(s, delta); else e.aiTick(s, time, delta, env);
      e.setDepth(e.y);
      const d = Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y);
      const near = e.isBoss ? 200 : e.rank !== RANKS.normal ? 150 : 105;
      const show = e === this.target || d < near || e.mode === 'chase';
      e.setPlate(show && !p.dead && !e.isBoss, plv, e === this.target ? 1 : Phaser.Math.Clamp(1 - (d - near + 30) / 30, 0.35, 1));
      if ((e.mode === 'chase' || e.engaged) && d < 200) this.lastCombat = Math.max(this.lastCombat, time - OOC_MS + 1500);
      return true;
    });
  }
}
