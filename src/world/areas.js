import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { AREAS, WAYSTONES } from '../data/zones.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { makeBiomeTextures } from './biomeTextures.js';
import { makeProps } from './propsExtra.js';
import { BUILDERS } from './areaBuilders.js';

const T = CONFIG.tile;
const FONT = '"Silkscreen", monospace';

// Runtime for interiors + expansion maps. WorldScene owns one instance
// (`scene.areas`) and forwards: update(), interact(), zoneHere(), questLine(),
// onKill(), savePos(). Areas are built lazily on first entry (under the fade).
export class AreaManager {
  constructor(scene, over) {
    this.scene = scene;
    this.over = over; // { solids, W, H, spawn }
    this.current = null; // area def or null (= overworld)
    this.built = {};
    this.triggers = [];
    this.interacts = [];
    this.wanderers = [];
    this.prox = []; // objects shown only when the player is near
    this.returnPos = {}; // areaId -> overworld px the exit door returns to
    this.busy = false;
    this.armed = true;
    this.prompt = '';
    this.boss = null;
    makeBiomeTextures(scene);
    this.shotCd = 0;
    // Discovered waystones (persisted inside questState, which saveNow stores whole)
    const qs = scene.questState;
    qs.ways = qs.ways || { town: true };
    qs.side = qs.side || {};
    qs.sideDone = qs.sideDone || {};
    qs.opened = qs.opened || {};
  }

  ov() { const o = this.scene.scene.get('overlay'); return o && o.scene.isActive() && o.ready ? o : null; }
  get qs() { return this.scene.questState; }

  // — registration (used by overworldFeatures + builders) —
  addTrigger(t) { this.triggers.push({ r: 14, ...t }); return t; }
  addProximity(p) { p.obj.setVisible(false); this.prox.push(p); return p; }
  addInteract(i) { this.interacts.push({ r: 28, ...i }); return i; }

  // Shared NPC factory (matches the overworld NPC look in WorldScene).
  addNpc(area, cfg, solidsGroup) {
    const s = this.scene;
    const c = s.add.container(cfg.x, cfg.y);
    const tex = `char.${cfg.tex}`;
    const sh = s.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
    const b = s.add.sprite(0, -8, tex, 0);
    const face = cfg.facing || 'down';
    const idle = `${tex}.idle.${face}`;
    if (s.anims.exists(idle)) b.play(idle);
    const l = s.add.text(0, -26, cfg.name, { fontFamily: FONT, fontSize: '8px', color: '#fff', backgroundColor: '#00000088' }).setOrigin(0.5);
    c.add([sh, b, l]); c.setDepth(cfg.y);
    c.sprite = b; c.texKey = tex; c.face = face; c.cfg = cfg; c.areaId = area;
    if (cfg.wander) {
      s.physics.add.existing(c);
      c.body.setSize(10, 8); c.body.setOffset(-5, -2);
      if (solidsGroup) s.physics.add.collider(c, solidsGroup);
      c.w = { home: { x: cfg.x, y: cfg.y }, r: cfg.wander, tx: null, ty: null, wait: Math.random() * 2, t: 0 };
      this.wanderers.push(c);
    }
    let line = 0;
    s.quests?.registerNpc(cfg.name, c, area); // quest '!' / '?' markers (content systems)
    this.addInteract({
      area, x: cfg.x, y: cfg.y, r: 30, label: `Talk to ${cfg.name}`, ref: c,
      onUse: () => {
        audio.play('npc');
        s.spawnFx?.(c.x, c.y - 20, 'fx.spark', 0.9);
        const plain = () => {
          if (cfg.onUse) return cfg.onUse(c);
          const lines = Array.isArray(cfg.text) ? cfg.text : [cfg.text];
          this.say(cfg.name, lines[line++ % lines.length]);
        };
        if (s.quests?.talk(cfg.name, plain, cfg.onUse ? 'Talk' : 'Chat', c)) return;
        plain();
      },
    });
    return c;
  }

  say(name, text, options) {
    const o = this.ov();
    if (o) o.dialog({ name, text, options });
    else bus.emit(Events.SYSTEM, `${name}: ${text}`);
  }

  // — building —
  _build(id) {
    if (this.built[id]) return this.built[id];
    const def = AREAS[id];
    const s = this.scene;
    const o = def.origin;
    const w = def.size.w * T, h = def.size.h * T;
    const group = s.physics.add.staticGroup();
    const rects = []; // px rects of everything solid (for enemy spawn rejection)
    const solidSink = { add: (r) => { group.add(r); rects.push(new Phaser.Geom.Rectangle(r.x - r.width / 2, r.y - r.height / 2, r.width, r.height)); return r; } };
    const b = { id, def, group, rects, lights: [], o, w, h, bounds: new Phaser.Geom.Rectangle(o.x, o.y, w, h), enemies: [] };
    this.built[id] = b;
    s.physics.add.collider(s.player, group);
    s.physics.add.collider(s.enemies, group);
    // black void around the area (hides neighbouring areas / overworld)
    s.add.rectangle(o.x - 900, o.y - 700, w + 1800, h + 1400, 0x05040a).setOrigin(0).setDepth(-20);
    // perimeter walls (player has no world-bounds collision)
    const wall = (x, y, ww, hh) => solidSink.add(s.add.rectangle(x + ww / 2, y + hh / 2, ww, hh, 0xffffff, 0));
    if (def.kind !== 'interior') {
      wall(o.x - 40, o.y - 40, w + 80, 40 + 6); wall(o.x - 40, o.y + h - 6, w + 80, 46);
      wall(o.x - 40, o.y - 40, 40 + 6, h + 80); wall(o.x + w - 6, o.y - 40, 46, h + 80);
    }
    const P = makeProps(s, solidSink, b.lights);
    b.P = P;
    const ctx = {
      scene: s, mgr: this, def, b, o, P, solid: (x, y, ww, hh) => solidSink.add(s.add.rectangle(x, y, ww, hh, 0xffffff, 0)),
      wall, px: (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T }),
      tex: (key) => key,
    };
    BUILDERS[def.builder](ctx);
    // default layers → tilesprites (builders may also add their own)
    // enemies
    if (def.enemies) {
      let seed = 4242 + id.length * 97;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (const [type, n, rectId] of def.enemies) {
        const rr = def.spawnRects[rectId];
        for (let i = 0; i < n; i++) {
          for (let tries = 0; tries < 30; tries++) {
            const x = o.x + (rr[0] + rnd() * rr[2]) * T, y = o.y + (rr[1] + rnd() * rr[3]) * T;
            const bad = rects.some((r) => Phaser.Geom.Rectangle.Contains(Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(r), 10, 10), x, y));
            if (bad && tries < 29) continue;
            const e = s.makeEnemy(x, y, type, id);
            b.enemies.push(e);
            break;
          }
        }
      }
    }
    b.boss = b.enemies.find((e) => e.isBoss) || null;
    s.onAreaBuilt?.(def, b); // gather nodes + craft stations (WorldScene)
    return b;
  }

  // — zone info for the active space —
  zoneHere(x, y) {
    const a = this.current;
    if (!a) return null;
    const o = a.origin;
    const base = { id: a.id, name: a.name, safe: a.safe, level: a.lv[0], lv: a.lv, desc: a.desc };
    for (const z of a.zones || []) {
      const [zx, zy, zw, zh] = z.rect;
      if (x >= o.x + zx * T && y >= o.y + zy * T && x < o.x + (zx + zw) * T && y < o.y + (zy + zh) * T) {
        return { id: z.id, name: z.name, safe: z.safe, level: z.lv[0], lv: z.lv, desc: z.desc, area: a.id };
      }
    }
    return { ...base, area: a.id };
  }

  // Movement helpers for abilities that teleport (Wisp Blink): stay inside the active space.
  bounds() {
    const a = this.current;
    if (!a) return { x0: 40, y0: 40, x1: this.over.W - 40, y1: this.over.H - 40 };
    const b = this.built[a.id];
    return { x0: b.o.x + 8, y0: b.o.y + 8, x1: b.o.x + b.w - 8, y1: b.o.y + b.h - 8 };
  }
  blockedAt(x, y) {
    const a = this.current;
    if (!a) return false;
    return this.built[a.id].rects.some((r) => x > r.x - 7 && x < r.right + 7 && y > r.y - 5 && y < r.bottom + 9);
  }

  savePos() { return this.current ? (this.returnPos[this.current.id] || null) : null; }

  // Small rooms: widen the camera bounds to the view size (centred on the room) so
  // the room sits in the middle of the screen instead of hugging a corner.
  _fitCamera(b, force) {
    const cam = this.scene.cameras.main;
    const vw = cam.width / cam.zoom, vh = cam.height / cam.zoom;
    if (!force && b._vw === vw && b._vh === vh) return;
    b._vw = vw; b._vh = vh;
    const ah = b.h + (b.def.kind === 'interior' ? T : 0);
    const bw = Math.max(b.w, vw), bh = Math.max(ah, vh);
    cam.setBounds(b.o.x + b.w / 2 - bw / 2, b.o.y + ah / 2 - bh / 2, bw, bh);
  }

  // — transitions —
  // Fade out → switch space → fade in. `opts.loading` shows a "Loading…" card.
  warp(areaId, x, y, opts = {}) {
    if (this.busy) return;
    this.busy = true;
    this.scene.transitioning = true;
    this.scene.player.body.setVelocity(0, 0);
    const done = () => { this.busy = false; this.scene.transitioning = false; };
    const go = () => this._apply(areaId, x, y);
    const o = this.ov();
    if (o) o.fade(go, { label: opts.label, loading: opts.loading, quick: opts.quick, done });
    else { go(); done(); }
  }

  enter(areaId) {
    const def = AREAS[areaId];
    const [sx, sy] = def.spawn || [def.size.w / 2, def.size.h - 2.5];
    const ret = this.returnPos[areaId];
    const big = def.kind !== 'interior';
    this.warp(areaId, def.origin.x + sx * T, def.origin.y + sy * T, {
      loading: big, label: big ? `Travelling to ${def.name}…` : undefined, quick: !big,
    });
    void ret;
  }

  exit() {
    const a = this.current;
    if (!a) return;
    const r = this.returnPos[a.id] || this.over.spawn;
    const big = a.kind !== 'interior';
    this.warp(null, r.x, r.y, { loading: big, label: big ? 'Leaving…' : undefined, quick: !big });
  }

  // Attempt to enter a map gate; asks first when under-levelled.
  tryEnter(areaId) {
    const def = AREAS[areaId];
    const lvl = this.scene.player.level;
    if (def.kind !== 'interior' && lvl < def.lv[0] - 1) {
      this.armed = false;
      const o = this.ov();
      if (o) {
        audio.play('alert', 0.8);
        this.scene.uiLock = true;
        o.dialog({
          name: 'DANGER', danger: true,
          text: `${def.name} is for Lv ${def.lv[0]}-${def.lv[1]}.\nYou are Lv ${lvl}. Enemies here hit hard.`,
          options: [{ label: 'Enter anyway', cb: () => this.enter(areaId) }, { label: 'Turn back', cb: () => {} }],
        });
        return;
      }
    }
    this.enter(areaId);
  }

  _apply(areaId, x, y) {
    const s = this.scene;
    const p = s.player;
    const prev = this.current;
    this.current = null;
    const cam = s.cameras.main;
    if (areaId) {
      const b = this._build(areaId);
      this.current = b.def;
      this._fitCamera(b, true);
    } else {
      cam.setBounds(0, 0, this.over.W, this.over.H);
    }
    p.setPosition(x, y);
    p.body.setVelocity(0, 0);
    cam.stopFollow(); cam.centerOn(x, y); cam.startFollow(p, true, 0.12, 0.12);
    s.daynight.overlay.setVisible(!areaId);
    this.armed = false;
    this.boss = null; this._bossMusic = false;
    s.zoneId = '__reset__'; // forces WorldScene's zone tracker to re-announce (label, music)
    bus.emit(Events.QUEST, s.questText());
    const o = this.ov();
    if (areaId && prev?.id !== areaId) {
      const def = AREAS[areaId];
      o?.banner(def.name, `Lv ${def.lv[0]}-${def.lv[1]}${def.safe ? '  ·  safe' : ''}`, def.safe ? 0x9bbc0f : 0xe67e22);
    }
    if (areaId === 'crypt') audio.play('warp');
    audio.play(areaId && AREAS[areaId].kind === 'interior' ? 'door' : 'warp', 0.7);
    // snap remote players that teleported between spaces (handled in RemotePlayer too)
  }

  leaveInstant() {
    if (!this.current) return;
    this._apply(null, this.over.spawn.x, this.over.spawn.y);
    this.busy = false; this.scene.transitioning = false;
  }

  // fast travel
  waystoneDest(id) {
    const w = WAYSTONES.find((q) => q.id === id);
    if (!w) return null;
    if (!w.area) return { area: null, x: this.over.spawn.x + w.offset.x, y: this.over.spawn.y + w.offset.y + 18 };
    const def = AREAS[w.area];
    return { area: w.area, x: def.origin.x + def.waystone[0] * T, y: def.origin.y + (def.waystone[1] + 2) * T };
  }
  openWaystone(id) {
    const s = this.scene;
    const w = WAYSTONES.find((q) => q.id === id);
    if (!this.qs.ways[id]) {
      this.qs.ways[id] = true;
      audio.play('quest');
      s.spawnFx?.(s.player.x, s.player.y - 12, 'fx.circleOrange', 1.6);
      bus.emit(Events.SYSTEM, `Waystone attuned: ${w.name}. You can now fast travel here.`);
      s.saveNow();
    }
    const here = this.current ? this.current.id : null;
    const hereWay = WAYSTONES.find((q) => q.area === here)?.id;
    const options = WAYSTONES.filter((q) => this.qs.ways[q.id] && q.id !== hereWay).map((q) => ({
      label: `${q.name}`,
      cb: () => {
        const d = this.waystoneDest(q.id);
        this.warp(d.area, d.x, d.y, { loading: true, label: `Travelling to ${q.name}…` });
      },
    }));
    options.push({ label: 'Stay', cb: () => {} });
    s.uiLock = true;
    this.say('Waystone', options.length > 1 ? 'The stone hums. Where to?' : 'The stone hums softly. No other waystones attuned yet — find them in Dock Town and Frostpeak.', options);
  }

  // Inn: fade, heal fully, skip to morning.
  rest(cost) {
    const s = this.scene, p = s.player;
    if (p.gold < cost) { audio.play('error', 0.7); bus.emit(Events.SYSTEM, 'Hester: Not enough gold, dear.'); return; }
    if (this.busy) return;
    p.gold -= cost;
    this.busy = true; s.transitioning = true;
    const done = () => { this.busy = false; s.transitioning = false; };
    const go = () => {
      p.hp = p.effMaxHp(); p.mp = p.effMaxMp();
      s.daynight.t = 0.3;
      audio.play('heal');
      bus.emit(Events.PLAYER_HP, s.hpPayload());
      bus.emit(Events.SYSTEM, `You slept soundly (-${cost}g). HP and MP fully restored. It is morning.`);
      s.saveNow();
    };
    const o = this.ov();
    if (o) o.fade(go, { label: 'Zzz…', loading: true, quick: true, done }); else { go(); done(); }
  }

  // — side quests —
  // Superseded by the data-driven quest system (systems/questSystem.js): these
  // stay as thin delegates so builders/WorldScene keep calling them.
  activeQuest() { return null; }
  questLine() { return null; }
  onKill() {}
  onUse(id) { return !!this.scene.quests?.onInteract(id); }

  // — per-frame —
  interact() {
    const s = this.scene;
    if (s.uiLock || s.time.now < (s.uiLockUntil || 0) || this.busy) return true; // swallow while a dialog/transition is up
    const p = s.player;
    const here = this.current ? this.current.id : null;
    let best = null, bd = 1e9;
    for (const i of this.interacts) {
      if (i.area !== here) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, i.x, i.y);
      if (d < i.r && d < bd) { bd = d; best = i; }
    }
    if (!best) return false;
    best.onUse();
    return true;
  }

  update(time, delta) {
    const s = this.scene;
    const dt = delta / 1000;
    const p = s.player;
    const here = this.current ? this.current.id : null;
    for (const q of this.prox) q.obj.setVisible(q.area === here && Phaser.Math.Distance.Between(p.x, p.y, q.x, q.y) < q.r);
    // wanderers: only simulate the ones in the current space
    for (const n of this.wanderers) {
      if (n.areaId !== here) { n.body.setVelocity(0, 0); continue; }
      this._wander(n, dt);
    }
    if (this.current) {
      const b = this.built[here];
      this._fitCamera(b);
      this._light(b, time);
      this._snow(b);
      if (b.def.id === 'crypt') this._bossWatch(b);
    }
    if (this.busy || s.uiLock) { this._setPrompt(''); return; }
    // walk-on triggers
    let nearTrig = false;
    for (const t of this.triggers) {
      if (t.area !== here) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y);
      if (d < t.r + 10) nearTrig = true;
      if (d < t.r && this.armed && !p.dead) { t.onEnter(); return; }
    }
    if (!this.armed && !nearTrig) this.armed = true;
    // prompt for nearest interactable
    let lab = '', bd = 1e9;
    for (const i of this.interacts) {
      if (i.area !== here) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, i.x, i.y);
      if (d < i.r && d < bd) { bd = d; lab = i.label; }
    }
    this._setPrompt(lab ? `E  ${lab}` : '');
  }

  _setPrompt(t) {
    if (t === this.prompt) return;
    this.prompt = t;
    this.ov()?.setPrompt(t);
  }

  _wander(n, dt) {
    const w = n.w;
    const tex = n.texKey;
    const setAnim = (kind) => {
      const k = `${tex}.${kind}.${n.face}`;
      if (this.scene.anims.exists(k) && n.sprite.anims.currentAnim?.key !== k) n.sprite.play(k, true);
    };
    if (w.wait > 0) { w.wait -= dt; n.body.setVelocity(0, 0); setAnim('idle'); n.setDepth(n.y); return; }
    if (w.tx === null) {
      const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * w.r;
      w.tx = w.home.x + Math.cos(a) * d; w.ty = w.home.y + Math.sin(a) * d; w.t = 0;
    }
    const dx = w.tx - n.x, dy = w.ty - n.y, d = Math.hypot(dx, dy);
    w.t += dt;
    if (d < 3 || w.t > 4) { w.tx = null; w.wait = 1.5 + Math.random() * 3.5; n.body.setVelocity(0, 0); return; }
    n.body.setVelocity((dx / d) * 22, (dy / d) * 22);
    n.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    setAnim('walk');
    n.setDepth(n.y);
  }

  // Crypt darkness: world-space RenderTexture with soft holes erased around the
  // player and every torch (uses the shared fx.glow soft light texture).
  _light(b, time) {
    if (!b.rt) return;
    const s = this.scene, p = s.player;
    const rt = b.rt;
    rt.clear();
    rt.fill(0x000000, b.def.dark ?? 0.93);
    const img = b.lightImg;
    const draw = (x, y, r) => { img.setScale((r * 2) / 128); rt.erase(img, x - b.o.x, y - b.o.y); };
    const flick = 1 + Math.sin(time / 130) * 0.03 + Math.sin(time / 57) * 0.02;
    draw(p.x, p.y - 6, 88 * flick);
    for (const l of b.lights) {
      if (Math.abs(l.x - p.x) > 260 || Math.abs(l.y - p.y) > 220) continue;
      draw(l.x, l.y, l.r * (1 + Math.sin(time / 170 + l.x) * 0.04));
    }
  }

  _snow(b) {
    if (!b.snow) return;
    const cam = this.scene.cameras.main;
    const v = cam.worldView;
    b.snow.setPosition(v.x - 40, v.y - 6);
  }

  // Boss music + state while the warden is engaged.
  _bossWatch(b) {
    if (!b.boss || !b.boss.active) b.boss = this.scene.enemies.getChildren().find((e) => e.isBoss && e.areaId === b.id && e.active) || null;
    const boss = b.boss;
    if (!boss) { if (this._bossMusic) { this._bossMusic = false; this.boss = null; audio.musicFor(this.scene.zoneId); } return; }
    const engaged = boss.active && boss.engaged;
    this.boss = engaged ? boss : null;
    if (engaged && !this._bossMusic) { this._bossMusic = true; audio.musicFor('mus_boss'); }
    if (!engaged && this._bossMusic) { this._bossMusic = false; audio.musicFor(this.scene.zoneId); }
  }
}
