import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { CONFIG } from '../config.js';
import { RemotePlayer } from '../entities/RemotePlayer.js';
import { audio } from '../systems/audio.js';
import { net } from './NetworkManager.js';
import { SnapBuffer, INTERP_DELAY } from './interp.js';
import {
  netAreaOf, enemyNetArea, focusTarget, applySnapFields, spawnFromSnap, hitConfirm,
  tickReplica, appendEnemyDelta, takeoverArea, sendDungeonState, onDungeonState,
  sendEventProgress, onEventProgress,
} from './coopSync.js';

// Glue between WorldScene and the relay. WorldScene hooks (all no-ops solo):
//   sync.attach(scene, player, hero)       once, after enemies exist
//   sync.registerEnemy(e)                  from makeEnemy (stable net ids)
//   sync.driveEnemy(e, time, delta)        enemy AI loop: true = handled here
//   sync.interceptHit(ed, dmg, fromRemote) top of damageEnemy: true = swallowed
//   sync.update(dt)                        every frame
//
// Enemy model: per-area authority (server assigns one player per area).
//  - authority: runs the normal AI (plus chasing remote players who are
//    closer than the local hero), streams changed enemy fields ('esnap') for
//    enemies near any player, applies remote hits, announces deaths.
//  - replica: enemies are snapshot-interpolated (100 ms buffer); local hits
//    are sent to the authority with instant (predicted) damage numbers.
//  - kill rewards: everyone who hit the enemy in the last 20 s gets full
//    XP/gold/quest credit; loot is rolled locally per player (instanced).
// Enemy ids derive from spawn data (area:type:homeX,homeY[#n]) so every
// client's deterministic spawns (and respawns) line up without a handshake.
const SEND_MS = 66;          // ~15 Hz move / enemy snapshots
const AOI = 400;
const CONTRIB_MS = 20000;
const STATES = ['idle', 'windup', 'lunge', 'recover'];
const stateIdx = (e) => Math.max(0, STATES.indexOf(e.aiState));

export class WorldSync {
  attach(scene, player, hero) {
    this.scene = scene; this.player = player; this.hero = hero;
    this.remotes = new Map();
    this.enemyById = new Map();
    this.enemyLast = new Map();   // authority: last sent enemy fields
    this.sendAcc = 0; this.last = null; this.actT = [];
    this.jitter = { frames: 0 };  // debug metrics (tests)
    net.inWorld = true;
    scene.enemies?.getChildren().forEach((e) => this.registerEnemy(e));
    this.off = [
      bus.on(Events.NET_PLAYER_JOINED, ({ id, name, hero: h, a }) => this.addRemote(id, name, h, a)),
      bus.on(Events.NET_PLAYER_LEFT, ({ id }) => this.removeRemote(id)),
      bus.on(Events.NET_RECONNECTED, () => this.resync()),
      net.on('hero', (m) => { if (m.sessionId !== net.sessionId) this.remotes.get(m.sessionId)?.setHero(m.hero); }),
      net.on('snap', (m) => this.onSnap(m)),
      net.on('hit', (m) => this.onRemoteHit(m)),
      net.on('ehit', (m) => this.onEnemyHit(m)),
      net.on('edeath', (m) => this.onEnemyDeath(m)),
      net.on('adead', (m) => this.onDeadList(m)),
      net.on('act', (m) => this.onAct(m)),
      net.on('correct', (m) => this.onCorrect(m)),
      net.on('auth', (m) => {
        this.enemyLast.clear();
        this._dstSent = null; this._evpSent = null;
        if (m?.sid === net.sessionId && m.a) takeoverArea(this, m.a);
      }),
      net.on('peer-status', (m) => this.remotes.get(m.sessionId)?.setDisconnected(m.dc)),
      net.on('dst', (m) => onDungeonState(this, m)),
      net.on('evp', (m) => onEventProgress(this, m)),
    ];
    // Peers that joined before world entry (lobby on the title screen).
    net.peers.forEach((p, id) => this.addRemote(id, p.name, p.hero, p.a));
    this.hookActions();
    if (net.connected) this.resync();
  }

  myArea() { return netAreaOf(this.scene); }
  focusTarget(e) { return focusTarget(this, e); }

  // Ask the server for a full replication refresh (everything we missed
  // while on the title/creator screens or during a reconnect).
  resync() {
    this.last = null; this.enemyLast.clear();
    net.send('resync', {});
  }

  // ─── remote players ────────────────────────────────────────────────
  addRemote(id, name, hero, a) {
    if (!id || id === net.sessionId || this.remotes.has(id)) return;
    const r = new RemotePlayer(this.scene, name || '???', hero || {});
    r.setArea(a || 'ow');
    this.remotes.set(id, r);
  }
  removeRemote(id) { this.remotes.get(id)?.destroy(); this.remotes.delete(id); }

  onSnap(m) {
    const t = m.t;
    for (const d of m.p || []) {
      const r = this.remotes.get(d.i);
      if (!r) continue;
      if (d.a !== undefined) r.setArea(d.a);
      if (d.dc !== undefined) r.setDisconnected(d.dc);
      if (d.h !== undefined) r.hp = d.h;
      r.pushSample(t - (d.d || 0), d.x, d.y, d.f, d.m);
    }
    for (const d of m.e || []) {
      let e = this.enemyById.get(d.i);
      if (!e || !e.active) e = spawnFromSnap(this, d);
      if (!e || !e.active) continue;
      if (!e._nb) e._nb = new SnapBuffer(16);
      if (d.x !== undefined) e._nb.push(t - (d.d || 0), d.x, d.y);
      if (d.h !== undefined) this.setEnemyHp(e, d.h);
      if (d.s !== undefined) this.setEnemyState(e, d.s);
      applySnapFields(this, e, d);
    }
  }

  onCorrect(m) {
    // server rejected a move (speed/teleport check): snap back
    const p = this.player;
    if (m.a !== undefined && m.a !== this.myArea()) return; // area mismatch: our next move re-syncs it
    p.setPosition(m.x, m.y);
    p.body?.setVelocity(0, 0);
    this.last = null;
  }

  // ─── enemies ───────────────────────────────────────────────────────
  registerEnemy(e) {
    if (!e || e.localOnly) return;
    if (!e.netId) {
      if (!e.home) return;
      const na = enemyNetArea(e, this.scene);
      e.netArea = na;
      const base = `${na}:${e.typeId}:${Math.round(e.home.x)},${Math.round(e.home.y)}`;
      let id = base, k = 1;
      while (this.enemyById.get(id)?.active) id = `${base}#${k++}`;
      e.netId = id;
    } else {
      e.netArea = e.netArea || enemyNetArea(e, this.scene);
      const prev = this.enemyById.get(e.netId);
      if (prev && prev !== e && prev.active) return prev;
    }
    const id = e.netId;
    this.enemyById.set(id, e);
    e.once('destroy', () => {
      if (this.enemyById.get(id) === e) this.enemyById.delete(id);
      this.enemyLast.delete(id);
    });
    return e;
  }

  setEnemyHp(e, h) {
    e.hp = h;
    if (!e.hpbar || h >= e.maxHp) return;
    e.hpbarBg.setVisible(true); e.hpbar.setVisible(true);
    const frac = Phaser.Math.Clamp(h / e.maxHp, 0, 1);
    e.hpbar.setDisplaySize(16 * frac, 2);
    e.hpbar.setFillStyle(frac > 0.5 ? 0x2ecc71 : frac > 0.25 ? 0xf39c12 : 0xe74c3c);
  }
  setEnemyState(e, s) {
    const prev = e._rs || 0;
    e._rs = s;
    e.aiState = STATES[s] || 'idle'; // windingUp (no contact damage) follows the authority
    if (prev === 1 && s !== 1) { e.showBang?.(false); this.restoreTint(e); }
    if (s === 1 && prev !== 1) e.showBang?.(true);
  }
  restoreTint(e) { e.sprite?.clearTint(); if (e.def?.tint) e.sprite?.setTint(e.def.tint); }
  flash(e) {
    e.sprite?.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => { if (e.active) this.restoreTint(e); });
  }

  // Called from WorldScene's enemy loop for enemies in the player's space.
  driveEnemy(e, time) {
    if (!net.connected || !e.netId) return false;
    const na = enemyNetArea(e, this.scene);
    if (net.isAuthority(na)) {
      e._netReplica = false;
      return e.aiUpdate ? false : this.chaseRemote(e, time);
    }
    // replica: interpolate authority snapshots + shared telegraphs
    e._netReplica = true;
    e.body?.setVelocity(0, 0);
    const s = e._nb?.sample(net.serverNow() - INTERP_DELAY);
    if (s) {
      const dx = s.x - e.x, dy = s.y - e.y;
      e.setPosition(s.x, s.y);
      if (Math.abs(dx) + Math.abs(dy) > 0.25) e.setFacingByVelocity?.(dx, dy);
    }
    this.animateReplica(e, time);
    tickReplica(this, e);
    e.setDepth(e.y);
    return true;
  }
  animateReplica(e, time) {
    const sp = e.sprite;
    if (!sp || e.isBoss) return;
    const st = e._rs || 0;
    let sx = 1, sy = 1;
    if (st === 0) {
      const amp = e.isSlime ? 0.09 : 0.03;
      const w = Math.sin(time / (e.isSlime ? 240 : 330) + (e.wobblePhase || 0));
      sy = 1 + w * amp; sx = 1 - w * amp * 0.8;
    } else if (st === 1) {
      sy = 0.8; sx = 1.16;
      if (Math.floor(time / 70) % 2) sp.setTintFill(0xff6655); else this.restoreTint(e);
    } else if (st === 2) { sx = 1.25; sy = 0.8; }
    sp.setScale(sx, sy); // same squash as Enemy.updateFeel
    sp.y = (-6 + 8) - 8 * sy;
  }
  // Authority: enemies chase whichever player is closest (the stock AI only knows the local hero).
  chaseRemote(e, time) {
    const me = this.player;
    let bd = me.dead ? Infinity : Phaser.Math.Distance.Between(me.x, me.y, e.x, e.y);
    let best = null;
    const myA = this.myArea();
    this.remotes.forEach((r) => {
      if (r.area !== myA || r.dc || !r.placed || r.hp <= 0) return;
      const d = Phaser.Math.Distance.Between(r.x, r.y, e.x, e.y);
      if (d < bd) { bd = d; best = r; }
    });
    if (!best || bd > 130) return false;
    const s = this.scene;
    if (s.zoneHere?.(e.x, e.y)?.safe) return false;
    const slowed = s.time.now < (e.getData('slowUntil') || 0);
    if (e.updateFeel?.(time, bd, best, !slowed)) { e.setDepth(e.y); return true; }
    const a = Math.atan2(best.y - e.y, best.x - e.x);
    const sp = CONFIG.enemySpeed * (s.daynight?.isNight ? 1.25 : 1) * (slowed ? 0.25 : 1);
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
    if (Math.hypot(e.body.velocity.x, e.body.velocity.y) < 100) { e.body.setVelocity(vx, vy); e.setFacingByVelocity?.(vx, vy); }
    e.setDepth(e.y);
    return true;
  }

  contrib(e, sid) { (e._contrib ||= new Map()).set(sid, Date.now()); }
  contributors(e) {
    const now = Date.now(); const out = [];
    e._contrib?.forEach((t, sid) => { if (now - t < CONTRIB_MS) out.push(sid); });
    return out;
  }
  announceDeath(e) {
    net.send('edeath', { i: e.netId, by: this.contributors(e), r: e.noRespawn ? 0 : (e.def?.respawn || 12000) });
  }

  // Top of WorldScene.damageEnemy. Returns true when the hit was routed to the network.
  interceptHit(ed, dmg, fromRemote) {
    if (!net.connected || fromRemote || !ed?.netId) return false;
    const n = Math.max(1, Math.round(dmg));
    if (net.isAuthority(enemyNetArea(ed, this.scene))) {
      this.contrib(ed, net.sessionId);
      const h = Math.max(0, Math.round(ed.hp - n));
      net.send('ehit', { i: ed.netId, d: n, h, by: net.sessionId });
      if (h <= 0) this.announceDeath(ed);
      return false; // normal local path (damage, rewards, respawn)
    }
    // replica: authority decides; show the hit right away (lag tolerant)
    net.send('hit', { i: ed.netId, d: n });
    this.scene.damageNumber?.(ed.x, ed.y, n, '#fff2b0');
    this.scene.spawnFx?.(ed.x, ed.y - 8, 'fx.cut', 1);
    audio.play?.('hit', 0.8);
    this.flash(ed);
    return true;
  }

  // Authority: a remote player's hit.
  onRemoteHit(m) {
    const e = this.enemyById.get(m.i);
    if (!e || !e.active || !net.isAuthority(enemyNetArea(e, this.scene))) return;
    const n = Math.max(1, Math.round(m.d));
    this.contrib(e, m.by);
    const h = Math.max(0, Math.round(e.hp - n));
    net.send('ehit', { i: e.netId, d: n, h, by: m.by });
    if (h > 0) {
      e.hurt(n);
      this.scene.damageNumber?.(e.x, e.y, n);
      this.scene.spawnFx?.(e.x, e.y - 8, 'fx.cut', 1);
      return;
    }
    this.announceDeath(e);
    if (this.contributors(e).includes(net.sessionId)) this.scene.damageEnemy(e, n, true); // shared kill: we get credit too
    else this.killQuiet(e, e.noRespawn ? 0 : (e.def?.respawn || 12000));
  }

  onEnemyHit(m) {
    const e = this.enemyById.get(m.i);
    if (!e || !e.active || net.isAuthority(enemyNetArea(e, this.scene))) return;
    this.setEnemyHp(e, m.h);
    if (m.by === net.sessionId) hitConfirm(this, e, m);
    else {
      this.scene.damageNumber?.(e.x, e.y, m.d);
      this.flash(e);
    }
  }

  onEnemyDeath(m) {
    const e = this.enemyById.get(m.i);
    if (!e || !e.active) return;
    const typeId = e.typeId;
    if ((m.by || []).includes(net.sessionId)) this.localKill(e);
    else this.killQuiet(e, e.noRespawn ? 0 : (m.r || e.def?.respawn || 12000));
    this.scene.dungeon?.onNetDeath?.(typeId);
  }
  // Run the scene's own death path (XP, gold, quest credit, per-player loot
  // roll, respawn timer) without printing a bogus damage number.
  localKill(e) {
    const s = this.scene;
    e.hp = 1;
    s.damageNumber = function (x, y, text, color) { if (typeof text === 'number') return; return Object.getPrototypeOf(this).damageNumber.call(this, x, y, text, color); };
    try { s.damageEnemy(e, 1, true); } finally { delete s.damageNumber; }
  }
  // Death without rewards (someone else's kill / catching up on arrival).
  killQuiet(e, respawnMs) {
    const s = this.scene;
    if (!e.active) return;
    s.spawnFx?.(e.x, e.y - 6, 'fx.smoke', 1.2);
    const { x, y } = e.home; const typeId = e.typeId; const areaId = e.areaId || null;
    const noRespawn = !!e.noRespawn || !(respawnMs > 0);
    e.destroy();
    if (noRespawn) return;
    s.time.delayedCall(Math.max(500, respawnMs), () => { if (s.scene.isActive()) s.makeEnemy(x, y, typeId, areaId); });
  }
  onDeadList(m) {
    if (m.a !== this.myArea()) return;
    for (const [id, ms] of m.ids || []) {
      const e = this.enemyById.get(id);
      const typeId = e?.typeId;
      if (e?.active) this.killQuiet(e, e.noRespawn ? 0 : ms);
      if (typeId) this.scene.dungeon?.onNetDeath?.(typeId);
    }
  }

  // ─── actions (remote attack/skill visuals) ─────────────────────────
  hookActions() {
    const p = this.player, s = this.scene;
    if (typeof p.attackPose === 'function') {
      const orig = p.attackPose;
      p.attackPose = (...a) => { const r = orig.apply(p, a); this.sendAct({ k: 'atk', f: p.facing }); return r; };
    }
    if (typeof s.fireShot === 'function') {
      const orig = s.fireShot;
      s.fireShot = (x, y, ang, dmg, kind) => {
        const r = orig.call(s, x, y, ang, dmg, kind);
        this.sendAct({ k: 'shot', x: Math.round(x), y: Math.round(y), an: ang, kind });
        return r;
      };
    }
  }
  unhookActions() {
    if (Object.prototype.hasOwnProperty.call(this.player, 'attackPose')) delete this.player.attackPose;
    if (Object.prototype.hasOwnProperty.call(this.scene, 'fireShot')) delete this.scene.fireShot;
  }
  sendAct(a) {
    if (!net.connected) return;
    const now = performance.now();
    this.actT = this.actT.filter((t) => now - t < 1000);
    if (this.actT.length >= 12) return;
    this.actT.push(now);
    net.send('act', a);
  }
  onAct(m) {
    const r = this.remotes.get(m.sessionId);
    if (!r || r.otherArea || !r.visible) return;
    if (m.k === 'atk') r.attackPose(m.f);
    else if (m.k === 'shot') this.visualShot(m.x, m.y, m.an || 0, m.kind);
  }
  visualShot(x, y, ang, kind) {
    const s = this.scene;
    let o;
    if ((kind === 'arrow' || kind === 'kunai') && s.textures.exists(`proj.${kind}`)) o = s.add.image(x, y, `proj.${kind}`);
    else {
      const key = kind === 'fire' ? 'proj.fireball' : kind === 'shuriken' ? 'proj.shuriken' : 'proj.energyBall';
      if (!s.textures.exists(key)) return;
      o = s.add.sprite(x, y, key, 0);
      if (s.anims.exists(key)) o.play(key);
    }
    o.setDepth(2600).setRotation(ang);
    s.tweens.add({ targets: o, x: x + Math.cos(ang) * 250, y: y + Math.sin(ang) * 250, duration: 900, onComplete: () => o.destroy() });
  }

  // ─── per frame ─────────────────────────────────────────────────────
  update(dt) {
    const myA = this.myArea();
    const rt = net.serverNow() - INTERP_DELAY;
    this.remotes.forEach((r) => r.update(rt, myA));
    if (!net.connected) return;
    this.sendAcc += dt * 1000;
    if (this.sendAcc < SEND_MS) return;
    this.sendAcc = Math.min(this.sendAcc - SEND_MS, SEND_MS);
    this.sendMove(myA);
    this.sendEnemies(myA);
    sendDungeonState(this);
    sendEventProgress(this);
  }

  // Delta-compressed move: only changed fields; x/y always travel together.
  sendMove(myA) {
    const p = this.player;
    const cur = { x: Math.round(p.x), y: Math.round(p.y), f: p.facing, h: Math.max(0, Math.round(p.hp)), a: myA, m: p.moving && !p.dead ? 1 : 0 };
    const last = this.last;
    const d = {}; let n = 0;
    for (const k in cur) if (!last || last[k] !== cur[k]) { d[k] = cur[k]; n++; }
    if (!n) return;
    if (d.x !== undefined || d.y !== undefined || d.a !== undefined) { d.x = cur.x; d.y = cur.y; }
    if (!last || d.a !== undefined || Math.hypot(cur.x - last.x, cur.y - last.y) > 120) d.w = 1; // warp: spawn, area change, death, waystone, blink
    if (d.x !== undefined) d.t = Math.round(net.serverNow()); // sender timestamp: interpolation ignores relay jitter
    net.sendMove(d);
    this.last = cur;
  }

  // Authority: stream changed fields of enemies near any player in this area.
  sendEnemies(myA) {
    if (!net.isAuthority(myA)) { if (this.enemyLast.size) this.enemyLast.clear(); return; }
    const pts = [this.player];
    this.remotes.forEach((r) => { if (r.area === myA && r.placed) pts.push(r); });
    if (pts.length < 2) return; // nobody to tell
    const R = AOI + 64;
    const out = [];
    this.enemyById.forEach((e, id) => {
      if (!e.active) return;
      const na = enemyNetArea(e, this.scene);
      if (na !== myA) return;
      if (!pts.some((q) => Math.abs(q.x - e.x) < R && Math.abs(q.y - e.y) < R)) return;
      const cur = { x: Math.round(e.x), y: Math.round(e.y), h: Math.max(0, Math.round(e.hp)), s: stateIdx(e), f: e.facing };
      const last = this.enemyLast.get(id);
      const d = { i: id }; let n = 0;
      if (!last || last.x !== cur.x || last.y !== cur.y) { d.x = cur.x; d.y = cur.y; n++; }
      if (!last || last.h !== cur.h) { d.h = cur.h; n++; }
      if (!last || last.s !== cur.s) { d.s = cur.s; n++; }
      if (!last || last.f !== cur.f) { d.f = cur.f; n++; }
      const extras = appendEnemyDelta(d, e, last?._x);
      if (d.ty || d.lv != null || d.rk || d.mh != null || d.tg !== undefined || d.mt !== undefined || d.ph != null || d.sh != null || d.en != null) n++;
      if (!n) return;
      out.push(d);
      this.enemyLast.set(id, { ...cur, _x: extras });
    });
    if (out.length) net.send('esnap', { a: myA, e: out, t: Math.round(net.serverNow()) });
  }

  destroy() {
    this.off?.forEach((f) => f());
    this.unhookActions();
    this.remotes?.forEach((r) => r.destroy());
    this.remotes?.clear();
    net.inWorld = false;
  }
}
