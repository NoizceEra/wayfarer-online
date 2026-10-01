import Phaser from 'phaser';
import { AREAS } from '../data/zones.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { net } from '../net/NetworkManager.js';
import { social } from '../systems/social/index.js';
import { genHollowFloor, HD, hollowSolid, hashStr, rng32, minimapLayers, HOLLOW } from './areaGen.js';
import { T, bakeArea, mkRnd, mix, hex, clamp, label, addDarkness } from './areaKit.js';
import { makePropsBiome } from './propsBiome.js';
import { makeProps } from './propsExtra.js';
import { grantLoot } from '../systems/lootUtil.js';
import { RANKS } from '../data/combatMath.js';
import { vnoise } from './ground.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hollow Depths: a seeded, instanced-feel dungeon.
//   · 3-5 floors (seeded), each a fresh room + corridor graph (world/areaGen.js genHollowFloor)
//   · rooms: start (stairs up / exit), combat, treasure (chest, sometimes an ambush), mini-boss
//     on the middle floor (seals the stairs), stairs down, and the final boss arena
//   · traps: spike plates and arrow slits, both with a red telegraph before they fire
//   · boss mechanics: Hollow Warden (calls help + telegraph zones), Hollow King (soul-lantern
//     shield phases) - entities/MechBoss.js, data in data/enemiesExtra.js
//   · difficulty rises per floor: enemy level, pack size, elite chance, trap damage
//   · the run ends with a guaranteed rare+ chest and an exit portal
// Co-op: the seed derives from the party id (else the room code) plus a 15-minute epoch, so
// everyone who enters together walks the same dungeon. Solo entries are fully random.
// Enemies are local-only (not part of the co-op enemy sync), see README notes in the PR.
// ─────────────────────────────────────────────────────────────────────────────

const EPOCH_MS = 15 * 60 * 1000;
const PAL = [
  { floor: 0x4c4464, floor2: 0x574d72, corr: 0x3a344e, accent: 0xb080ff },
  { floor: 0x3a5866, floor2: 0x466878, corr: 0x2c4450, accent: 0x5ad8e0 },
  { floor: 0x664048, floor2: 0x744c54, corr: 0x4a2c34, accent: 0xff6a7a },
  { floor: 0x5c5a44, floor2: 0x6a6850, corr: 0x423f30, accent: 0xffd84a },
  { floor: 0x2e2c48, floor2: 0x3a3858, corr: 0x201e36, accent: 0xd0a0ff },
];
const POOL = [['hcrawler', 'hwraith', 'hknight'], ['hcrawler', 'hwraith', 'hknight', 'hhound'], ['hwraith', 'hknight', 'hhound', 'shadehound'], ['hknight', 'hhound', 'shadehound', 'bloodeye'], ['hhound', 'shadehound', 'bloodeye', 'cgolem']];

export function entrySeed(scene, forced) {
  if (forced != null) return forced >>> 0;
  let key = null;
  try { key = social?.party?.id || (net.connected ? net.code : null); } catch { key = null; }
  if (key) return hashStr(`${key}|${Math.floor(Date.now() / EPOCH_MS)}`);
  return (Math.random() * 4294967296) >>> 0;
}
export const floorsFor = (seed) => 3 + Math.floor(rng32(seed ^ 0xA5A5A5A5)() * 3);

// Area builder: only the shell (void, walls, darkness); floors are built by DungeonRun.
export function buildHollowShell(ctx) {
  ctx.b.ctx = ctx;
  addDarkness(ctx);
}
export const HOLLOW_BUILDER = { hollow: buildHollowShell };

export class DungeonRun {
  constructor(scene) {
    this.s = scene;
    this.run = null;
    this.b = null;
    this.objs = [];
    this.solids = [];
    this.enemies = [];
    this.spikes = [];
    this.arrows = [];
    this.L = null;
    this.tg = null;
    this.forceSeed = null;
    this.forceFloors = null;
    this.offKill = bus.on(Events.KILL, (k) => this.onKill(k));
    scene.events.once('shutdown', () => { this.offKill?.(); });
  }
  get active() { return !!this.run && this.s.areas?.current?.id === 'hollow'; }
  get mgr() { return this.s.areas; }

  // ——— run lifecycle ———
  begin(b) {
    this.b = b;
    const seed = entrySeed(this.s, this.forceSeed);
    const floors = this.forceFloors || floorsFor(seed);
    this.run = { seed, floors, floor: 0, kills: 0, done: false, sealed: false, startedAt: Date.now(), bossDown: false };
    this.tg = this.tg && this.tg.active ? this.tg : this.s.add.graphics().setDepth(3);
    bus.emit(Events.SYSTEM, `Hollow Depths: ${floors} floors below. Seed ${seed.toString(36).toUpperCase()}${social?.party?.id ? ' (shared with your party)' : ''}.`);
    this.buildFloor(0, true);
  }

  end() {
    this.teardown();
    if (this.run && !this.run.done) bus.emit(Events.SYSTEM, 'You climb out of the Hollow Depths. The halls will rearrange themselves before your next descent.');
    this.run = null;
    this.b = null;
  }

  teardown() {
    const s = this.s, b = this.b;
    for (const o of this.objs) { if (o && o.scene) { s.tweens.killTweensOf(o); o.destroy(); } }
    this.objs = [];
    for (const sd of this.solids) { b?.group?.remove(sd.r, true, true); }
    if (b) b.rects = b.rects.filter((r) => !this.solids.some((sd) => sd.pr === r));
    this.solids = [];
    for (const e of this.enemies) if (e && e.active) { e.hp = 0; e.dying = true; s.enemies.remove(e); e.destroy(); }
    this.enemies = [];
    if (b) { b.enemies = []; b.boss = null; b.lights.length = 0; }
    if (this.mgr) { this.mgr.interacts = this.mgr.interacts.filter((i) => !i.dun); this.mgr.boss = null; }
    this.spikes = []; this.arrows = []; this.boss = null; this.seal = null; this.stairsLabel = null;
    this.tg?.clear();
    // leftovers of the previous floor: coins / gear drops dropped in this dungeon
    if (s.combat?.coins) { s.combat.coins = s.combat.coins.filter((c) => { if (c.areaId === 'hollow') { c.img?.destroy(); return false; } return true; }); }
    s.drops?.children?.each?.((d) => { if (d.areaId === 'hollow') d.destroy(); return true; });
    if (this.texKey && s.textures.exists(this.texKey)) s.textures.remove(this.texKey);
    this.texKey = null;
    // stray enemy shots from the previous floor
    s.combat?.eshots?.forEach((sh) => { sh.core?.destroy(); sh.glow?.destroy(); });
    if (s.combat) s.combat.eshots = [];
  }

  track(o) { if (o) this.objs.push(o); return o; }
  addSolid(x, y, w, h) {
    const s = this.s, b = this.b;
    const r = s.add.rectangle(x, y, w, h, 0xffffff, 0);
    b.group.add(r);
    const pr = new Phaser.Geom.Rectangle(x - w / 2, y - h / 2, w, h);
    b.rects.push(pr);
    this.solids.push({ r, pr });
    return r;
  }

  // ——— one floor ———
  buildFloor(i, entering = false) {
    const s = this.s, b = this.b, run = this.run, o = b.o;
    this.teardown();
    run.floor = i;
    const L = genHollowFloor(run.seed, i, run.floors);
    this.L = L;
    const pal = PAL[i % PAL.length];
    const g = L.grid;
    const rnd = mkRnd(((run.seed ^ Math.imul(i + 7, 0x85ebca6b)) >>> 0) || 1);
    const at = (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T });
    const cellC = (tx, ty) => at(tx + 0.5, ty + 0.5);
    const nearFloor = (tx, ty) => { for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const c = g.get(tx + k, ty + j); if (c !== HD.ROCK && c !== 255) return true; } return false; };
    const wallCell = (tx, ty) => g.get(tx, ty) === HD.ROCK && nearFloor(tx, ty);
    const roomAt = (tx, ty) => L.rooms.find((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);

    // ground + walls
    this.texKey = `bake.hollow.${run.seed}.${i}`;
    const fl = hex(pal.floor), fl2 = hex(pal.floor2), cr = hex(pal.corr);
    const baked = bakeArea(s, this.texKey, g, o, {
      jitter: 0,
      color: (cls, px, py, tx, ty) => {
        const n2 = vnoise(px / 8, py / 8, 7);
        if (cls === HD.ROCK) {
          if (!nearFloor(tx, ty)) return hex(0x07060b);
          const south = g.get(tx, ty + 1) !== HD.ROCK && g.get(tx, ty + 1) !== 255;
          if (south && py % T > T - 6) return mix(hex(pal.corr), hex(0x000000), 0.55);
          const row = Math.floor(py / 8), seam = py % 8 === 0 || (px + (row % 2) * 8) % 16 < 1;
          return seam ? mix(hex(pal.corr), hex(0x000000), 0.6) : mix(hex(pal.corr), hex(pal.floor2), 0.35 + n2 * 0.25);
        }
        const r = roomAt(tx, ty);
        const checker = ((tx + ty) & 1) ? fl : fl2;
        let c = cls === HD.CORR && !r ? mix(cr, fl, 0.35 + n2 * 0.2) : mix(checker, hex(0xffffff), n2 * 0.06);
        const seam = px % T === 0 || py % T === 0;
        if (seam) c = mix(c, hex(0x000000), 0.28);
        if (r?.role === 'treasure') c = mix(c, hex(0xd8b04a), 0.22);
        if (r?.role === 'boss' || r?.role === 'miniboss') c = mix(c, hex(0xc04a5a), 0.14);
        if (r?.role === 'stairs' || r?.role === 'start') c = mix(c, hex(0x9ab8d8), 0.1);
        return c;
      },
      detail: (pt) => {
        const dr = mkRnd(run.seed % 99991 + i * 13 + 1);
        for (let k = 0; k < 260; k++) {
          const x = dr() * g.w * T, y = dr() * g.h * T, c = g.get(Math.floor(x / T), Math.floor(y / T));
          if (c === HD.ROCK || c === 255) continue;
          const q = dr();
          if (q < 0.5) pt.dot(x, y, 1.1, 'rgba(0,0,0,0.4)');
          else if (q < 0.8) pt.line(x, y, x + 5, y + 2, 'rgba(0,0,0,0.35)');
          else pt.dot(x, y, 1, 'rgba(255,255,255,0.12)');
        }
        // ritual rings in boss / mini-boss arenas, stair glyphs
        for (const r of L.rooms) {
          const cx = (r.x + r.w / 2) * T, cy = (r.y + r.h / 2) * T;
          if (r.role === 'boss' || r.role === 'miniboss') {
            const rr = Math.min(r.w, r.h) * T * 0.4;
            for (const [k2, a] of [[1, 0.35], [0.74, 0.3], [0.45, 0.25]]) { pt.ctx.strokeStyle = `rgba(${(pal.accent >> 16) & 255},${(pal.accent >> 8) & 255},${pal.accent & 255},${a + 0.15})`; pt.ctx.lineWidth = 2; pt.ctx.beginPath(); pt.ctx.ellipse(cx, cy, rr * k2, rr * k2 * 0.72, 0, 0, 7); pt.ctx.stroke(); }
            for (let q = 0; q < 10; q++) { const a = (q / 10) * 6.283; pt.dot(cx + Math.cos(a) * rr * 0.87, cy + Math.sin(a) * rr * 0.87 * 0.72, 2, `rgb(${(pal.accent >> 16) & 255},${(pal.accent >> 8) & 255},${pal.accent & 255})`); }
          }
          if (r.role === 'stairs' || r.role === 'start') { pt.ell(cx, cy + 6, 26, 14, 'rgba(10,8,20,0.45)'); pt.ell(cx, cy + 6, 18, 9, 'rgba(10,8,20,0.6)'); }
        }
      },
    });
    this.track(baked.img);

    // walls -> solids (only the ring touching floor; rows merged)
    {
      const rects = [];
      for (let ty = -1; ty <= g.h; ty++) {
        let run0 = -1;
        for (let tx = -1; tx <= g.w + 1; tx++) {
          const w = tx <= g.w && wallCell(tx, ty);
          if (w && run0 < 0) run0 = tx;
          if ((!w || tx === g.w + 1) && run0 >= 0) { rects.push([run0, ty, tx - run0, 1]); run0 = -1; }
        }
      }
      // merge identical vertical spans
      const merged = [];
      const open = new Map();
      for (const r of rects.sort((a, c) => a[1] - c[1] || a[0] - c[0])) {
        const key = `${r[0]}:${r[2]}`, prev = open.get(key);
        if (prev && prev[1] + prev[3] === r[1]) { prev[3]++; } else { const nr = [...r]; merged.push(nr); open.set(key, nr); }
      }
      for (const [x, y, w, h] of merged) this.addSolid(o.x + (x + w / 2) * T, o.y + (y + h / 2) * T, w * T, h * T);
    }

    // minimap layers for this floor (overlay reads def.layers)
    AREAS.hollow.layers = minimapLayers(g, (c) => (c === HD.ROCK ? null : (c === HD.CORR ? 0x3a3450 : 0x6a5a8a)), 2);

    // ——— props, decor, traps (tracked by display-list snapshot) ———
    const snap = new Set(s.children.list);
    const sinkR = { add: (r) => { this.addSolid(r.x, r.y, r.width, r.height); r.destroy(); return r; } };
    const P = makeProps(s, sinkR, b.lights);
    const PB = makePropsBiome(s, sinkR, b.lights);
    PB.spikeTex();
    const inner = (r, m = 1) => ({ x0: r.x + m, y0: r.y + m, x1: r.x + r.w - m, y1: r.y + r.h - m });
    const rndIn = (r, m = 1.5) => { const q = inner(r, m); return { tx: Math.floor(q.x0 + rnd() * Math.max(1, q.x1 - q.x0)), ty: Math.floor(q.y0 + rnd() * Math.max(1, q.y1 - q.y0)) }; };
    // torches on north walls
    for (const r of L.rooms) {
      for (let tx = r.x + 2; tx < r.x + r.w - 1; tx += 4) {
        if (g.get(tx, r.y - 1) === HD.ROCK) { const p = at(tx + 0.5, r.y + 0.35); P.torch(p.x, p.y, r.role === 'boss' || r.role === 'miniboss'); }
      }
    }
    // pillars / bones in combat rooms
    for (const r of L.rooms) {
      if (r.role === 'combat' || r.role === 'miniboss') {
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) { const t = rndIn(r, 2); const p = cellC(t.tx, t.ty); if (rnd() < 0.5) P.cryptPillar(p.x, p.y + 6); else P.bones(p.x, p.y, k); }
      }
    }
    // start room: stairs up / leave
    const sr = L.sr;
    const sp = at(sr.cx + 0.5, sr.cy + 0.9);
    P.stairs(sp.x, sp.y - 4);
    label(this.s, sp.x, sp.y - 30, i === 0 ? 'Stairs up (leave)' : 'Stairs up (leave the depths)', '#c8c0e0');
    this.dunInteract({ x: sp.x, y: sp.y, r: 30, label: 'Climb out of the Hollow Depths', onUse: () => this.confirmLeave() });
    // goal room: stairs down (or the boss arena)
    if (!L.finalFloor) {
      const gr = L.gr, gp = at(gr.cx + 0.5, gr.cy + 0.9);
      P.stairs(gp.x, gp.y - 4);
      const lbl = label(this.s, gp.x, gp.y - 30, 'Stairs down', '#ffe8a0');
      this.stairsLabel = lbl;
      this.stairsPos = gp;
      run.sealed = L.midFloor;
      if (run.sealed) {
        const seal = s.add.graphics().setDepth(gp.y + 2);
        for (const [rr, col] of [[26, 0xff3a4a], [18, 0xff6a5a]]) { seal.lineStyle(2, col, 0.85).strokeEllipse(gp.x, gp.y, rr * 2, rr * 1.4); }
        seal.fillStyle(0xff3a4a, 0.18).fillEllipse(gp.x, gp.y, 52, 36);
        this.seal = seal;
        lbl.setText('Stairs down (sealed)').setColor('#ff9aa0');
      }
      this.dunInteract({ x: gp.x, y: gp.y, r: 30, label: 'Descend', onUse: () => {
        if (this.run.sealed) { bus.emit(Events.SYSTEM, 'A red seal holds the stairs shut. Defeat the Hollow Warden to break it.'); audio.play('error', 0.7); return; }
        this.descend();
      } });
    }
    // treasure room
    const tr = L.rooms.find((r) => r.role === 'treasure');
    if (tr) {
      const cp = at(tr.cx + 0.5, tr.cy + 0.7);
      let ch = this.track(P.chest(cp.x, cp.y, false));
      P.brazier(at(tr.x + 1.5, tr.y + 1.6).x, at(tr.x + 1.5, tr.y + 1.6).y);
      P.brazier(at(tr.x + tr.w - 1.5, tr.y + 1.6).x, at(tr.x + tr.w - 1.5, tr.y + 1.6).y);
      for (let k = 0; k < 5; k++) { const t = rndIn(tr, 1.5); PB.crystal(cellC(t.tx, t.ty).x, cellC(t.tx, t.ty).y + 6, k + i, true); }
      const ambush = rnd() < 0.4 + i * 0.08;
      let opened = false;
      this.dunInteract({ x: cp.x, y: cp.y, r: 26, label: 'Open chest', onUse: () => {
        if (opened) return;
        opened = true;
        const rare = i >= 1 && rnd() < 0.5;
        grantLoot(this.s, { gold: [40 + i * 40, 90 + i * 60], potions: 1 + (i > 1 ? 1 : 0), mats: { hollow_shard: 1 + (i > 0 ? 1 : 0) }, gear: rnd() < 0.55 + i * 0.1 ? { rarity: rare ? 'rare' : 'uncommon' } : null }, 'Treasure room', cp.x, cp.y);
        this.s.spawnFx?.(cp.x, cp.y - 10, 'fx.spark', 1.5);
        ch.destroy(); ch = this.track(P.chest(cp.x, cp.y, true));
        if (ambush) {
          bus.emit(Events.SYSTEM, 'It was a trap! Hollow guardians rise around the chest.');
          audio.play('alert', 0.9);
          this.s.cameras.main.shake(260, 0.004);
          for (let k = 0; k < 3; k++) this.spawnMob(cp.x + Math.cos(k * 2.1) * 34, cp.y + 8 + Math.sin(k * 2.1) * 20, this.floorLevel(i) + 1, true, true);
        }
        this.s.saveNow();
      } });
    }
    // traps
    this.buildTraps(L, at, PB, rnd);
    // capture all objects made above
    for (const o2 of s.children.list) if (!snap.has(o2)) this.objs.push(o2);

    // ——— enemies + bosses ———
    const lvl = this.floorLevel(i);
    const pool = POOL[Math.min(POOL.length - 1, i)];
    for (const r of L.rooms) {
      if (r.role === 'combat') {
        const n = Math.min(7, 2 + i + Math.floor(rnd() * 2));
        for (let k = 0; k < n; k++) { const t = rndIn(r, 1.5); const p = cellC(t.tx, t.ty); this.spawnMob(p.x, p.y, lvl + Math.floor(rnd() * 2), false, false, pool[Math.floor(rnd() * pool.length)], rnd); }
      } else if (r.role === 'stairs' || r.role === 'treasure') {
        const n = r.role === 'stairs' ? 1 + Math.floor(i / 2) : 1;
        for (let k = 0; k < n; k++) { const t = rndIn(r, 1.5); const p = cellC(t.tx, t.ty); this.spawnMob(p.x, p.y, lvl, false, false, pool[Math.floor(rnd() * pool.length)], rnd); }
      } else if (r.role === 'miniboss') {
        const p = at(r.cx + 0.5, r.cy + 0.5);
        this.boss = this.spawnBoss('hwarden', p.x, p.y, lvl + 1);
        for (let k = 0; k < 2; k++) { const t = rndIn(r, 2); const q = cellC(t.tx, t.ty); this.spawnMob(q.x, q.y, lvl, false, false, pool[k % pool.length], rnd); }
      } else if (r.role === 'boss') {
        const p = at(r.cx + 0.5, r.cy - 0.5);
        this.boss = this.spawnBoss('hking', p.x, p.y, lvl + 2);
        for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.4; const q = { x: p.x + Math.cos(a) * 70, y: p.y + 30 + Math.sin(a) * 40 }; this.spawnMob(q.x, q.y, lvl + 1, false, false, pool[k % pool.length], rnd); }
        for (const [dx, dy] of [[-4, -2], [4, -2], [-4, 3], [4, 3]]) { const q = at(r.cx + dx + 0.5, r.cy + dy + 0.5); P.brazier(q.x, q.y); }
      }
    }
    // capture braziers spawned after the enemy loop too
    for (const o2 of s.children.list) if (!snap.has(o2) && !this.objs.includes(o2) && !(o2 instanceof Phaser.GameObjects.Container && o2.def) && !this.enemies.includes(o2)) this.objs.push(o2);

    // place the hero at the start room
    const p = s.player, ent = at(sr.cx + 0.5, sr.cy + 2.1);
    p.setPosition(ent.x, ent.y); p.body.setVelocity(0, 0);
    const cam = s.cameras.main;
    cam.stopFollow(); cam.centerOn(ent.x, ent.y); cam.startFollow(p, true, 0.12, 0.12);
    this.mgr._fitCamera(b, true);
    b.boss = this.boss || null;
    // announce
    const fLabel = `Floor ${i + 1} / ${run.floors}`;
    s.scene.get('overlay')?.banner?.('Hollow Depths', `${fLabel}${L.finalFloor ? '  ·  the Hollow King' : L.midFloor ? '  ·  the Hollow Warden' : ''}`, pal.accent);
    bus.emit(Events.SYSTEM, `${fLabel}: ${L.finalFloor ? 'the Hollow King waits at the end of the halls.' : L.midFloor ? 'the stairs are sealed by the Hollow Warden.' : 'find the stairs down.'} Traps ahead: ${L.traps.length}.`);
    if (entering) audio.play('warp', 0.7);
  }

  floorLevel(i) { return 12 + i * 2; }

  dunInteract(cfg) { const it = this.mgr.addInteract({ area: 'hollow', dun: true, ...cfg }); return it; }

  spawnMob(x, y, level, local = true, ambushed = false, type = null, rnd = Math.random) {
    const i = this.run.floor;
    const pool = POOL[Math.min(POOL.length - 1, i)];
    const t = type || pool[Math.floor(rnd() * pool.length)];
    const eliteP = 0.06 + i * 0.05;
    const r = rnd();
    const rank = r < 0.012 + i * 0.008 ? RANKS.champion : r < eliteP ? RANKS.elite : RANKS.normal;
    const e = this.s.makeEnemy(x, y, t, 'hollow', { local: true, eo: { level, rank, zoneLv: [12, 20] } });
    e.noRespawn = true;
    this.enemies.push(e); this.b.enemies.push(e);
    if (ambushed) this.s.combat?.aggro(e, false);
    return e;
  }
  spawnBoss(type, x, y, level) {
    const e = this.s.makeEnemy(x, y, type, 'hollow', { local: true, eo: { level, rank: RANKS.normal, zoneLv: [12, 20] } });
    e.noRespawn = true;
    this.enemies.push(e); this.b.enemies.push(e);
    return e;
  }

  // ——— traps ———
  buildTraps(L, at, PB, rnd) {
    const s = this.s, g = L.grid, i = L.floorIndex;
    const cellC = (tx, ty) => at(tx + 0.5, ty + 0.5);
    const addSpikes = (cells, phase) => {
      const tiles = cells.map(([tx, ty]) => { const p = cellC(tx, ty); const im = s.add.image(p.x, p.y, 'pb.spikeDown').setDepth(1.5); return { tx, ty, x: p.x, y: p.y, im }; });
      this.spikes.push({ tiles, phase, state: 'down', hit: false });
    };
    // corridor traps
    for (const tr of L.traps) {
      const cells = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = g.get(tr.x + dx, tr.y + dy); if (c === HD.CORR) cells.push([tr.x + dx, tr.y + dy]); }
      if (tr.kind === 'spikes') { addSpikes(cells.slice(0, 6), rnd() * 3400); continue; }
      // arrow slit: a wall next to the lane, firing across (or along) the corridor
      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      let done = false;
      for (const [dx, dy] of dirs.sort(() => rnd() - 0.5)) {
        // slit sits in a wall cell adjacent to the corridor; arrows travel in (-dx,-dy)
        const wx = tr.x + dx, wy = tr.y + dy;
        if (g.get(wx, wy) !== HD.ROCK) continue;
        let len = 0; let cx = tr.x, cy = tr.y;
        while (g.get(cx, cy) !== HD.ROCK && g.get(cx, cy) !== 255 && len < 14) { cx -= dx; cy -= dy; len++; }
        if (len < 2) continue;
        const sp = cellC(wx, wy);
        const slit = PB.arrowSlit(sp.x, sp.y + 8);
        this.arrows.push({ x: sp.x, y: sp.y, dx: -dx, dy: -dy, len: len * T, phase: rnd() * 3000, state: 'idle', slit, fired: false });
        done = true; break;
      }
      if (!done) addSpikes(cells.slice(0, 6), rnd() * 3400);
    }
    // in-room spike fields
    for (const f of L.fields) {
      const cells = [];
      for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) cells.push([f.x + dx, f.y + dy]);
      addSpikes(cells, rnd() * 3400);
    }
    // arrow slits in combat rooms (deeper floors): fire down the room from the north wall
    for (const r of L.rooms) {
      if (r.role !== 'combat' || i < 1 || rnd() > 0.3 + i * 0.1) continue;
      const tx = r.x + 1 + Math.floor(rnd() * (r.w - 2));
      if (g.get(tx, r.y - 1) !== HD.ROCK) continue;
      const sp = cellC(tx, r.y - 1);
      const slit = PB.arrowSlit(sp.x, sp.y + 8);
      this.arrows.push({ x: sp.x, y: sp.y, dx: 0, dy: 1, len: r.h * T, phase: rnd() * 3000, state: 'idle', slit, fired: false });
    }
  }

  trapDamage() { return 9 + this.run.floor * 5; }

  updateTraps(time) {
    const s = this.s, p = s.player, tg = this.tg;
    tg.clear();
    if (p.dead) return;
    const dmg = this.trapDamage();
    const src = (x, y) => ({ x, y, level: this.floorLevel(this.run.floor), atk: dmg });
    // spike plates: 3.4s cycle = 1.8s down, 0.8s warning (flashing red), 0.8s up
    for (const sp of this.spikes) {
      const c = (time + sp.phase) % 3400;
      const state = c < 1800 ? 'down' : c < 2600 ? 'warn' : 'up';
      if (state !== sp.state) {
        sp.state = state;
        for (const t of sp.tiles) t.im.setTexture(state === 'up' ? 'pb.spikeUp' : 'pb.spikeDown');
        if (state === 'up') { sp.hit = false; audio.play('step', 0.6); }
      }
      for (const t of sp.tiles) {
        if (state === 'warn') {
          const f = (c - 1800) / 800;
          const flash = Math.floor(time / 90) % 2 ? 0.55 : 0.25;
          tg.fillStyle(0xff3030, flash * (0.5 + f * 0.5)).fillRect(t.x - 8, t.y - 8, 16, 16);
          tg.lineStyle(1, 0xff6a5a, 0.9).strokeRect(t.x - 8, t.y - 8, 16, 16);
        }
        if (state === 'up' && !sp.hit && Math.abs(p.x - t.x) < 9 && Math.abs(p.y - t.y) < 9) {
          sp.hit = true;
          s.combat.hitPlayerFrom(src(t.x, t.y), dmg, { id: 'bleed' });
          s.spawnFx?.(t.x, t.y - 4, 'fx.cut', 1.2);
        }
      }
    }
    // arrow slits: 3.0s cycle, 0.9s telegraph lane, arrow flies, hitscan at release
    for (const a of this.arrows) {
      const c = (time + a.phase) % 3200;
      const warn = c > 2200;
      if (warn) {
        const f = (c - 2200) / 1000;
        const ex = a.x + a.dx * a.len, ey = a.y + a.dy * a.len;
        tg.lineStyle(6, 0xff3030, 0.12 + 0.2 * f).lineBetween(a.x, a.y, ex, ey);
        tg.lineStyle(1, 0xff6a5a, 0.85).lineBetween(a.x, a.y, a.x + a.dx * a.len * f, a.y + a.dy * a.len * f);
        a.slit.setTint(Math.floor(time / 80) % 2 ? 0xff6a5a : 0xffffff);
        a.fired = false;
      } else if (!a.fired && c < 400 && a.prevWarn) {
        a.fired = true;
        a.slit.clearTint();
        // arrow visual
        const ar = s.add.rectangle(a.x, a.y, a.dx ? 10 : 2, a.dy ? 10 : 2, 0xe8e0d0).setDepth(2600);
        s.tweens.add({ targets: ar, x: a.x + a.dx * a.len, y: a.y + a.dy * a.len, duration: 180, onComplete: () => ar.destroy() });
        audio.play('arrow', 0.7);
        // hitscan along the lane
        const px = p.x - a.x, py = p.y - a.y;
        const along = px * a.dx + py * a.dy, across = Math.abs(px * a.dy - py * a.dx);
        if (along > 4 && along < a.len && across < 8) s.combat.hitPlayerFrom(src(a.x, a.y), dmg * 1.1, { id: 'bleed' });
      }
      a.prevWarn = warn;
    }
  }

  // ——— flow ———
  confirmLeave() {
    const mgr = this.mgr, s = this.s;
    s.uiLock = true;
    mgr.say('Stairs', this.run.floor === 0 ? 'Climb back up to the meadow?' : `Leave the Hollow Depths? Your progress (floor ${this.run.floor + 1}/${this.run.floors}) is lost - the halls rearrange on your next descent.`, [
      { label: 'Leave', cb: () => mgr.exit() }, { label: 'Stay', cb: () => {} },
    ]);
  }

  descend() {
    const s = this.s, mgr = this.mgr;
    if (mgr.busy || !this.run) return;
    const next = this.run.floor + 1;
    if (next >= this.run.floors) return;
    mgr.busy = true; s.transitioning = true;
    const done = () => { mgr.busy = false; s.transitioning = false; };
    const go = () => { try { this.buildFloor(next); } catch (e) { console.error('dungeon floor', e); } };
    const o = mgr.ov();
    if (o) o.fade(go, { label: `Floor ${next + 1}...`, loading: true, quick: true, done }); else { go(); done(); }
  }

  onKill(k) {
    if (!this.run || !this.active) return;
    this.run.kills++;
    if (k.typeId === 'hwarden') this.unseal();
    else if (k.typeId === 'hking') this.complete();
  }

  unseal() {
    const run = this.run;
    if (!run?.sealed) return;
    run.sealed = false;
    this.seal?.destroy(); this.seal = null;
    this.stairsLabel?.setText('Stairs down').setColor('#ffe8a0');
    audio.play('quest', 0.8);
    this.s.cameras.main.shake(300, 0.005);
    bus.emit(Events.SYSTEM, 'The seal on the stairs shatters. The way down is open.');
  }

  complete() {
    const s = this.s, run = this.run, L = this.L;
    if (run.done) return;
    run.done = true;
    const b = this.b, o = b.o, r = L.gr;
    const cx = o.x + (r.cx + 0.5) * T, cy = o.y + (r.cy + 0.5) * T;
    const P = makeProps(s, { add: (rr) => { this.addSolid(rr.x, rr.y, rr.width, rr.height); rr.destroy(); return rr; } }, b.lights);
    const snap = new Set(s.children.list);
    // guaranteed rare+ chest
    let ch = P.chest(cx - 26, cy + 6, false);
    s.spawnFx?.(cx - 26, cy - 6, 'fx.circleOrange', 2);
    s.time.delayedCall(700, () => audio.play('quest'));
    let taken = false;
    this.dunInteract({ x: cx - 26, y: cy + 6, r: 28, label: 'Open the Hollow vault', onUse: () => {
      if (taken) return;
      taken = true;
      grantLoot(s, { gold: [260 + run.floors * 60, 420 + run.floors * 90], potions: 3, mats: { hollow_shard: 3, star_fragment: 1 }, items: { gem_purple: 1 }, gear: { rarity: 'rare+', epicChance: 0.35 + run.floors * 0.04 }, xp: 400 + run.floors * 120 }, 'Hollow vault', cx - 26, cy);
      s.spawnFx?.(cx - 26, cy - 10, 'fx.spark', 1.8);
      ch.destroy(); ch = P.chest(cx - 26, cy + 6, true); this.objs.push(ch);
      s.saveNow();
    } });
    // exit portal
    const ex = P.archway(cx + 30, cy + 10, 0xb080ff, 0x5a5066);
    label(s, cx + 30, cy - 38, 'Exit portal', '#e0c8ff');
    this.dunInteract({ x: cx + 30, y: cy + 4, r: 34, label: 'Step through the exit portal', onUse: () => this.mgr.exit() });
    for (const o2 of s.children.list) if (!snap.has(o2) && !this.objs.includes(o2)) this.objs.push(o2);
    this.objs.push(ch); void ex;
    const secs = Math.round((Date.now() - run.startedAt) / 1000);
    bus.emit(Events.ACH_EVENT, { k: 'dungeon', floors: run.floors, secs });
    bus.emit(Events.TOAST, { title: 'Hollow Depths cleared', text: `${run.floors} floors in ${Math.floor(secs / 60)}m ${secs % 60}s`, color: '#d0a0ff' });
    bus.emit(Events.SYSTEM, 'The Hollow King is no more. A vault and an exit portal shimmer into being.');
  }

  update(time) {
    if (!this.active || this.s.transitioning) { if (this.tg && this.tg.active) this.tg.clear(); return; }
    try { this.updateTraps(time); } catch (e) { this._errs = (this._errs || 0) + 1; if (this._errs < 4) console.error('dungeon traps', e); }
  }
}
void clamp; void HOLLOW; void hollowSolid;
