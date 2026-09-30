// Quest system v2: data-driven (data/quests.js), up to 8 active quests, chains
// via prerequisites, 9 objective types, NPC '!' / '?' markers, turn-in dialogue
// with reward choices, notice-board bounties, HUD tracker text, journal hooks.
// WorldScene owns one instance (`scene.quests`). Persistent state lives in
// scene.meta.quests ({active, done, tracked, bounty}) and is saved with the hero.
import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { ENEMY_TABLE } from '../data/jobs.js';
import { AREAS, ZONES } from '../data/zones.js';
import { gearById, RARITY } from '../data/gear.js';
import { matById } from '../data/materials.js';
import { QUEST_LIST, QUESTS_BY_ID, LEGACY_MAIN, LEGACY_SIDE, BOUNTY_TEMPLATES, POIS, LORE, LORE_ON_ENTER, CHAINS } from '../data/quests.js';
import { addMat, takeMat, matCount } from './pack.js';

const T = CONFIG.tile;
const FONT = '"Silkscreen", monospace';
export const MAX_ACTIVE = 8;
export const MAX_TRACKED = 3;
const INTERACT_NAMES = { garrick_net: "Garrick's net" };
const BOARD = 'Notice Board';

const dayKey = () => new Date().toISOString().slice(0, 10);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const zoneName = (id) => ZONES.find((z) => z.id === id)?.name || AREAS[id]?.name || id;

export function objText(o) {
  switch (o.t) {
    case 'kill': return `Defeat ${ENEMY_TABLE[o.id]?.name || o.id}`;
    case 'collect': return `Gather ${matById(o.id)?.name || o.id}`;
    case 'deliver': return `Deliver ${matById(o.id)?.name || o.id} to ${o.npc}`;
    case 'talk': return `Talk to ${o.npc}`;
    case 'explore': return `Visit ${o.poi ? POIS[o.poi]?.name : zoneName(o.zone || o.area)}`;
    case 'escort': return `Escort ${o.npc} to ${POIS[o.to]?.name}`;
    case 'use': return `Use ${matById(o.id)?.name || o.id}`;
    case 'interact': return `Find ${INTERACT_NAMES[o.id] || o.id}`;
    case 'craft': return `Craft ${matById(o.id)?.name || o.id}`;
    default: return o.t;
  }
}
const needOf = (o) => (o.n ? o.n : 1);

export function rewardLines(r = {}) {
  const L = [];
  if (r.xp) L.push(`${r.xp} XP`);
  if (r.gold) L.push(`${r.gold} gold`);
  if (r.gear) { const g = gearById(r.gear); if (g) L.push(g.name); }
  for (const [id, n] of Object.entries(r.mats || {})) L.push(`${matById(id)?.name || id}${n > 1 ? ` x${n}` : ''}`);
  for (const id of r.recipes || []) L.push(`Recipe: ${id.replace(/_/g, ' ')}`);
  if (r.statPoints) L.push(`+${r.statPoints} stat points`);
  if (r.lore && LORE[r.lore]) L.push(`Lore: ${LORE[r.lore].name}`);
  return L;
}

export class QuestSystem {
  constructor(scene, legacy) {
    this.scene = scene;
    this.npcs = new Map();      // name -> {c, area}
    this.escorts = {};          // questId -> {c, from, to}
    this.beacons = {};          // key -> {g, x, y, area}
    this.acc = 0; this.markAcc = 0;
    const meta = scene.meta;
    if (!meta.quests) { meta.quests = { active: {}, done: {}, tracked: [], bounty: {} }; this.migrate(legacy); }
    this.s = meta.quests;
    // drop active quests whose def vanished (old build) / keep bounty defs
    for (const id of Object.keys(this.s.active)) if (!this.def(id)) delete this.s.active[id];
    this.s.tracked = this.s.tracked.filter((id) => this.s.active[id]);
    if (!this.s.tracked.length) this.autoTrack();
    this.offs = [
      bus.on(Events.LEVEL_UP, () => this.refresh()),
      bus.on(Events.ZONE, () => this.checkLoreAndExplore()),
    ];
  }

  // ——— legacy migration (questState.idx / kills / side / sideDone) ———
  migrate(q) {
    if (!q) return;
    const done = this.scene.meta.quests.done, active = this.scene.meta.quests.active;
    const idx = Number(q.idx) || 0;
    LEGACY_MAIN.forEach((id, i) => { if (i < idx) done[id] = 1; });
    const cur = LEGACY_MAIN[idx];
    if (cur && (q.kills && Object.keys(q.kills).length || idx > 0)) {
      const d = QUESTS_BY_ID[cur];
      if (d) active[cur] = { p: d.obj.map((o) => Math.min(needOf(o), q.kills?.[o.id] || 0)), t: Date.now() };
    }
    for (const id of LEGACY_SIDE) {
      if (q.sideDone?.[id]) done[id] = 1;
      else if (q.side?.[id]) { const d = QUESTS_BY_ID[id]; if (d) active[id] = { p: d.obj.map((o) => Math.min(needOf(o), q.side[id])), t: Date.now() }; }
    }
    // chain A/B/C ordering: legacy players may have finished later steps; prerequisites that were skipped count as done.
    for (const id of Object.keys(done)) for (const pre of QUESTS_BY_ID[id]?.pre || []) if (!done[pre]) done[pre] = 1;
  }

  destroy() { this.offs?.forEach((o) => o()); }

  get p() { return this.scene.player; }
  get areaId() { return this.scene.areas?.current?.id || null; }

  // ——— lookups ———
  def(id) { return QUESTS_BY_ID[id] || this.s?.active?.[id]?.def || null; }
  isDone(id) { return !!this.s.done[id]; }
  isActive(id) { return !!this.s.active[id]; }
  activeIds() { return Object.keys(this.s.active); }
  activeCount() { return this.activeIds().length; }
  turnNpc(q) { return q.turnIn || q.giver; }
  levelOk(q) { return this.p.level >= Math.max(1, q.lv - 1); }
  preOk(q) { return (q.pre || []).every((id) => this.s.done[id]); }
  status(id) {
    if (this.s.done[id] && !this.def(id)?.repeat) return 'done';
    if (this.s.active[id]) return 'active';
    const q = QUESTS_BY_ID[id];
    if (!q) return 'locked';
    return this.preOk(q) && this.levelOk(q) ? 'available' : 'locked';
  }
  available() { return QUEST_LIST.filter((q) => this.status(q.id) === 'available'); }
  lockedList() { return QUEST_LIST.filter((q) => this.status(q.id) === 'locked'); }
  doneList() { return Object.keys(this.s.done).map((id) => this.def(id) || QUESTS_BY_ID[id]).filter(Boolean); }

  // objective progress -> {cur, need, done}
  prog(id, i) {
    const q = this.def(id), o = q.obj[i], st = this.s.active[id];
    const need = needOf(o);
    let cur = st?.p?.[i] || 0;
    if (o.t === 'collect') cur = matCount(this.scene, o.id);
    if (o.t === 'deliver') cur = matCount(this.scene, o.id) > 0 ? 1 : 0;
    cur = Math.min(need, cur);
    return { cur, need, done: cur >= need };
  }
  isReady(id) { const q = this.def(id); return !!q && q.obj.every((_, i) => this.prog(id, i).done); }
  // objectives done except delivery-at-target ones (for remote-progress display)
  pct(id) { const q = this.def(id); let a = 0, b = 0; q.obj.forEach((o, i) => { const p = this.prog(id, i); a += p.cur; b += p.need; }); return b ? a / b : 1; }

  // ——— accept / abandon / complete ———
  accept(id, silent = false) {
    const q = this.def(id);
    if (!q || this.s.active[id]) return false;
    if (this.activeCount() >= MAX_ACTIVE) { bus.emit(Events.SYSTEM, `Quest log full (${MAX_ACTIVE}). Abandon one in the Journal (L).`); audio.play('error', 0.7); return false; }
    this.s.active[id] = { p: q.obj.map(() => 0), t: Date.now() };
    if (q.give) for (const [m, n] of Object.entries(q.give)) if (matCount(this.scene, m) < n) addMat(this.scene, m, n, { quiet: true, noQuest: true });
    if (this.s.tracked.length < MAX_TRACKED) this.s.tracked.push(id);
    if (!silent) {
      audio.play('quest', 0.8);
      bus.emit(Events.SYSTEM, `Quest accepted: ${q.name}`);
      bus.emit(Events.TOAST, { title: 'Quest accepted', text: q.name, color: '#ffd84a' });
    }
    this.onPack(true);
    this.changed();
    return true;
  }
  abandon(id) {
    const q = this.def(id);
    if (!q || !this.s.active[id]) return false;
    if (q.give) for (const [m, n] of Object.entries(q.give)) takeMat(this.scene, m, Math.min(n, matCount(this.scene, m)));
    delete this.s.active[id];
    this.s.tracked = this.s.tracked.filter((x) => x !== id);
    this.autoTrack(true);
    this.dropEscort(id);
    bus.emit(Events.SYSTEM, `Quest abandoned: ${q.name}`);
    this.changed();
    return true;
  }
  track(id, on) {
    if (!this.s.active[id]) return;
    const has = this.s.tracked.includes(id);
    if (on === undefined) on = !has;
    if (on && !has) { if (this.s.tracked.length >= MAX_TRACKED) this.s.tracked.shift(); this.s.tracked.push(id); }
    if (!on && has) this.s.tracked = this.s.tracked.filter((x) => x !== id);
    this.changed();
  }
  autoTrack(force) {
    if (this.s.tracked.length && !force) return;
    for (const id of this.activeIds()) { if (this.s.tracked.length >= MAX_TRACKED) break; if (!this.s.tracked.includes(id)) this.s.tracked.push(id); }
  }

  // Grant a reward bundle. Returns display lines.
  grant(r = {}) {
    const sc = this.scene, p = this.p;
    if (r.xp) {
      const before = p.level;
      p.gainXp(r.xp);
      if (p.level > before) { audio.play('level'); bus.emit(Events.SYSTEM, `${sc.pname} reached Lv ${p.level}!`); }
    }
    if (r.gold) p.gold += r.gold;
    if (r.gear) sc.grantGear(r.gear, 'Quest reward');
    for (const [id, n] of Object.entries(r.mats || {})) addMat(sc, id, n, { quiet: true, noQuest: true });
    for (const id of r.recipes || []) sc.craft?.learn(id);
    if (r.statPoints) { p.prog.statPoints = (p.prog.statPoints || 0) + r.statPoints; bus.emit(Events.PROGRESS, {}); bus.emit(Events.SYSTEM, `+${r.statPoints} stat points! Press C to spend them.`); }
    if (r.lore) this.unlockLore(r.lore);
    bus.emit(Events.PLAYER_HP, sc.hpPayload()); bus.emit(Events.PLAYER_XP, sc.xpPayload());
  }

  unlockLore(id) {
    if (!LORE[id] || this.scene.meta.lore[id]) return;
    this.scene.meta.lore[id] = 1;
    bus.emit(Events.TOAST, { title: 'Lore unlocked', text: LORE[id].name, color: '#c8a8ff' });
    bus.emit(Events.SYSTEM, `Journal: lore entry "${LORE[id].name}".`);
  }

  complete(id, choice) {
    const q = this.def(id), sc = this.scene;
    if (!q || !this.s.active[id] || !this.isReady(id)) return false;
    // consume collect + deliver items
    for (const o of q.obj) if (o.t === 'collect' || o.t === 'deliver') takeMat(sc, o.id, needOf(o));
    const isBounty = !!this.s.active[id].def;
    delete this.s.active[id];
    this.s.tracked = this.s.tracked.filter((x) => x !== id);
    this.s.done[id] = Date.now();
    this.dropEscort(id);
    this.grant(q.reward);
    if (choice?.reward) this.grant(choice.reward);
    audio.play('quest');
    sc.spawnFx?.(this.p.x, this.p.y - 12, 'fx.circleOrange', 1.6);
    bus.emit(Events.SYSTEM, `Quest complete: ${q.name}! ${rewardLines({ ...q.reward, ...(choice?.reward || {}), mats: { ...(q.reward.mats || {}), ...(choice?.reward?.mats || {}) } }).join(', ')}`);
    bus.emit(Events.TOAST, { title: isBounty ? 'Bounty complete' : 'Quest complete', text: q.name, color: '#ffd84a' });
    bus.emit(Events.ACH_EVENT, { k: 'quest', id, bounty: isBounty });
    if (q.chain) {
      const all = QUEST_LIST.filter((x) => x.chain === q.chain);
      if (all.every((x) => this.s.done[x.id])) {
        bus.emit(Events.ACH_EVENT, { k: 'chain', id: q.chain });
        bus.emit(Events.TOAST, { title: 'Questline complete', text: CHAINS[q.chain]?.name || q.chain, color: '#ffb04a' });
      }
    }
    this.autoTrack();
    this.changed();
    sc.saveNow();
    return true;
  }

  // ——— progress hooks ———
  _bump(type, id, n = 1) {
    let any = false;
    for (const qid of this.activeIds()) {
      const q = this.def(qid), st = this.s.active[qid];
      q.obj.forEach((o, i) => {
        if (o.t !== type || o.id !== id) return;
        const before = this.prog(qid, i).done;
        st.p[i] = Math.min(needOf(o), (st.p[i] || 0) + n);
        any = true;
        this.notifyObj(qid, i, before);
      });
    }
    if (any) this.changed();
    return any;
  }
  onKill(typeId) { this._bump('kill', typeId, 1); }
  onUse(id) { this._bump('use', id, 1); }
  onCraft(id, n = 1) { this._bump('craft', id, n); }
  onInteract(id) { return this._bump('interact', id, 1); }
  // collected-items progress is live; just detect completion transitions.
  onPack(silent) {
    if (!this.s) return;
    let any = false;
    for (const qid of this.activeIds()) {
      const q = this.def(qid), st = this.s.active[qid];
      q.obj.forEach((o, i) => {
        if (o.t !== 'collect') return;
        const now = this.prog(qid, i).done;
        if (now !== !!st.cdone?.[i]) { st.cdone = st.cdone || []; st.cdone[i] = now; any = true; if (now && !silent) this.notifyObj(qid, i, false); }
      });
    }
    if (any || !silent) this.changed();
  }
  notifyObj(qid, i, before) {
    const q = this.def(qid);
    const pr = this.prog(qid, i);
    if (pr.done && !before) {
      audio.play('coin', 0.6);
      bus.emit(Events.SYSTEM, `Objective complete: ${objText(q.obj[i])}`);
      if (this.isReady(qid)) {
        bus.emit(Events.SYSTEM, `${q.name}: ready to turn in to ${this.turnNpc(q)}.`);
        bus.emit(Events.TOAST, { title: 'Ready to turn in', text: `${q.name} -> ${this.turnNpc(q)}`, color: '#9be88a' });
      }
    } else if (!pr.done && q.obj[i].n > 1 && ['kill', 'use', 'craft'].includes(q.obj[i].t)) {
      this.scene.damageNumber?.(this.p.x, this.p.y - 18, `${objText(q.obj[i]).split(' ').slice(-2).join(' ')} ${pr.cur}/${pr.need}`, '#ffd84a');
    }
  }
  changed() {
    this.refreshMarkers();
    this.refreshBeacons();
    bus.emit(Events.QUEST, this.scene.questText());
    bus.emit(Events.QUEST_CHANGED, {});
  }
  refresh() { this.changed(); }

  // ——— NPC registry + '!' / '?' markers ———
  registerNpc(name, c, area = null) {
    if (this.npcs.has(name)) return;
    const m = this.scene.add.text(0, -42, '!', { fontFamily: FONT, fontSize: '15px', color: '#ffd84a', stroke: '#3a2400', strokeThickness: 4 }).setOrigin(0.5).setVisible(false);
    c.add(m);
    this.scene.tweens.add({ targets: m, y: -46, duration: 450, yoyo: true, repeat: -1, ease: 'sine.inout' });
    this.npcs.set(name, { c, area, m, kind: null });
    this.refreshMarkers();
  }
  npcKind(name) {
    for (const id of this.activeIds()) {
      const q = this.def(id);
      if (this.turnNpc(q) === name && this.isReady(id)) return '?';
    }
    if (name === BOARD) return this.offeredBounties().some((b) => this.bountyStatus(b) === 'offer') ? '!' : null;
    if (QUEST_LIST.some((q) => q.giver === name && this.status(q.id) === 'available')) return '!';
    for (const id of this.activeIds()) {
      const q = this.def(id);
      if (q.obj.some((o, i) => o.t === 'talk' && o.npc === name && !this.prog(id, i).done)) return 'talk';
    }
    return null;
  }
  refreshMarkers() {
    if (!this.npcs) return;
    for (const [name, n] of this.npcs) {
      const k = this.npcKind(name);
      n.kind = k;
      n.m.setVisible(!!k);
      if (k) n.m.setText(k === 'talk' ? '?' : k).setColor(k === '!' ? '#ffd84a' : k === '?' ? '#ffd84a' : '#7fdcff');
    }
  }
  // For the minimaps: [{x, y, kind, area}]
  markerList() {
    const out = [];
    for (const [, n] of this.npcs) if (n.kind) out.push({ x: n.c.x, y: n.c.y, kind: n.kind, area: n.area });
    return out;
  }

  // ——— escort ———
  poiPos(key) {
    const p = POIS[key];
    if (!p) return null;
    if (p.area) { const o = AREAS[p.area].origin; return { x: o.x + p.tx * T + 8, y: o.y + p.ty * T + 8, r: p.r, area: p.area }; }
    return { x: p.tx * T + 8, y: p.ty * T + 8, r: p.r, area: null };
  }
  escortObj(id) { const q = this.def(id); const i = q?.obj.findIndex((o) => o.t === 'escort'); return i >= 0 ? { o: q.obj[i], i } : null; }
  spawnEscort(id) {
    const e = this.escortObj(id);
    if (!e || this.escorts[id] || this.prog(id, e.i).done) return;
    const from = this.poiPos(e.o.from);
    const s = this.scene;
    const c = s.add.container(from.x, from.y);
    const sh = s.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
    const b = s.add.sprite(0, -8, `char.${e.o.tex}`, 0);
    const l = s.add.text(0, -26, e.o.npc, { fontFamily: FONT, fontSize: '8px', color: '#9be88a', backgroundColor: '#00000088' }).setOrigin(0.5);
    c.add([sh, b, l]); c.setDepth(c.y);
    c.spr = b; c.face = 'down'; c.texKey = `char.${e.o.tex}`;
    this.escorts[id] = { c, i: e.i, o: e.o, area: from.area };
    bus.emit(Events.SYSTEM, `${e.o.npc} is waiting at ${POIS[e.o.from].name}. Stay close so she can follow.`);
  }
  dropEscort(id) { const e = this.escorts[id]; if (e) { e.c.destroy(); delete this.escorts[id]; } }
  updateEscorts(dt) {
    for (const id of Object.keys(this.escorts)) {
      const e = this.escorts[id], c = e.c, p = this.p;
      if (!this.s.active[id]) { this.dropEscort(id); continue; }
      const follow = e.following || Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y) < 52;
      const here = this.areaId;
      if (follow && !e.following) { e.following = true; bus.emit(Events.SYSTEM, `${e.o.npc}: I'll follow you!`); }
      if (!e.following) { this.animEsc(c, false); continue; }
      if (e.area !== here) { e.area = here; c.setPosition(p.x - 16, p.y + 4); }
      let d = Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y);
      if (d > 280) { c.setPosition(p.x - 16, p.y + 6); d = 20; }
      let moving = false;
      if (d > 26) {
        const a = Math.atan2(p.y - c.y, p.x - c.x), sp = Math.min(CONFIG.playerSpeed * 0.95, d * 2.4);
        c.x += Math.cos(a) * sp * dt; c.y += Math.sin(a) * sp * dt;
        c.face = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 'right' : 'left') : (Math.sin(a) > 0 ? 'down' : 'up');
        moving = true;
      }
      c.setDepth(c.y);
      this.animEsc(c, moving);
      const to = this.poiPos(e.o.to);
      if (to && to.area === here && Phaser.Math.Distance.Between(c.x, c.y, to.x, to.y) < to.r && Phaser.Math.Distance.Between(c.x, c.y, p.x, p.y) < 70) {
        const st = this.s.active[id];
        st.p[e.i] = 1;
        this.scene.spawnFx?.(c.x, c.y - 14, 'fx.spark', 1.2);
        bus.emit(Events.SYSTEM, `${e.o.npc}: Thank you! I can find my way from here.`);
        this.dropEscort(id);
        this.notifyObj(id, e.i, false);
        this.changed();
      }
    }
  }
  animEsc(c, moving) {
    const s = this.scene, k = `${c.texKey}.${moving ? 'walk' : 'idle'}.${c.face}`;
    if (s.anims.exists(k) && c.spr.anims.currentAnim?.key !== k) c.spr.play(k, true);
  }

  // ——— beacons for explore/poi targets ———
  refreshBeacons() {
    const want = {};
    for (const id of this.s.tracked) {
      const q = this.def(id); if (!q) continue;
      q.obj.forEach((o, i) => {
        if (this.prog(id, i).done) return;
        const key = o.t === 'explore' && o.poi ? o.poi : o.t === 'escort' ? o.to : null;
        if (key && POIS[key]) want[key] = true;
      });
    }
    for (const k of Object.keys(this.beacons)) if (!want[k]) { this.beacons[k].g.destroy(); delete this.beacons[k]; }
    for (const k of Object.keys(want)) {
      if (this.beacons[k]) continue;
      const pos = this.poiPos(k), s = this.scene;
      const g = s.add.container(pos.x, pos.y).setDepth(pos.y + 40);
      const ring = s.add.ellipse(0, 4, 36, 14, 0xffd84a, 0.18).setStrokeStyle(2, 0xffd84a, 0.8);
      const arrow = s.add.triangle(0, -22, 0, 0, 12, 0, 6, 10, 0xffd84a).setStrokeStyle(2, 0x3a2400);
      g.add([ring, arrow]);
      s.tweens.add({ targets: arrow, y: -28, duration: 500, yoyo: true, repeat: -1 });
      s.tweens.add({ targets: ring, scale: 1.3, alpha: 0.4, duration: 800, yoyo: true, repeat: -1 });
      this.beacons[k] = { g, area: pos.area };
    }
  }
  updateBeacons() { const a = this.areaId; for (const b of Object.values(this.beacons)) b.g.setVisible(b.area === a); }

  // ——— explore / lore ———
  checkLoreAndExplore() {
    const sc = this.scene, z = sc.zoneHere(this.p.x, this.p.y);
    if (!z) return;
    const areaId = this.areaId;
    const zone = z.id, key = areaId || zone;
    if (!sc.meta.visited[key]) { sc.meta.visited[key] = 1; bus.emit(Events.ACH_EVENT, { k: 'visit', id: key }); }
    if (!sc.meta.visited[zone]) { sc.meta.visited[zone] = 1; bus.emit(Events.ACH_EVENT, { k: 'visit', id: zone }); }
    const lore = LORE_ON_ENTER[key] || LORE_ON_ENTER[zone];
    if (lore) this.unlockLore(lore);
    let any = false;
    for (const id of this.activeIds()) {
      const q = this.def(id);
      q.obj.forEach((o, i) => {
        if (o.t !== 'explore' || this.prog(id, i).done) return;
        let hit = false;
        if (o.poi) { const pos = this.poiPos(o.poi); hit = pos.area === areaId && Phaser.Math.Distance.Between(this.p.x, this.p.y, pos.x, pos.y) < pos.r; }
        else if (o.area) hit = areaId === o.area;
        else if (o.zone) hit = !areaId && zone === o.zone;
        if (hit) { this.s.active[id].p[i] = 1; any = true; this.notifyObj(id, i, false); }
      });
    }
    if (any) this.changed();
  }

  update(dt) {
    this.acc += dt; this.markAcc += dt;
    if (this.acc > 0.4) { this.acc = 0; this.checkLoreAndExplore(); this.updateBeacons(); }
    if (this.markAcc > 2.5) { this.markAcc = 0; this.refreshMarkers(); }
    // resume escorts after load / re-accept
    for (const id of this.activeIds()) if (this.escortObj(id) && !this.escorts[id]) this.spawnEscort(id);
    this.updateEscorts(dt);
  }

  // ——— HUD tracker text ———
  trackerText() {
    const ids = this.s.tracked.filter((id) => this.s.active[id]);
    if (!ids.length) {
      if (!this.activeCount()) return "No active quests.\nLook for '!' over townsfolk. Journal: L";
      return 'Nothing tracked. Open the Journal (L) and press Track.';
    }
    const out = [];
    for (const id of ids) {
      const q = this.def(id);
      const ready = this.isReady(id);
      out.push(`> ${q.name}`);
      if (ready) out.push(`  Turn in: ${this.turnNpc(q)}`);
      else q.obj.forEach((o, i) => {
        const p = this.prog(id, i);
        if (p.done && q.obj.length > 1) return;
        out.push(`  ${objText(o).replace(/^(Defeat|Gather|Craft|Use) /, '')} ${p.need > 1 ? `${p.cur}/${p.need}` : p.done ? '(done)' : ''}`.trimEnd());
      });
    }
    return out.join('\n');
  }

  // ——— dialogue ———
  say(name, text, options) { this.scene.areas ? this.scene.areas.say(name, text, options) : bus.emit(Events.SYSTEM, `${name}: ${text}`); }

  objBlock(q) { return q.obj.map((o) => `- ${objText(o)}${o.n > 1 ? ` x${o.n}` : ''}`).join('\n'); }

  offerDialog(q, back) {
    const lines = rewardLines(q.reward);
    const ch = q.choices ? '\n(+ your pick of a bonus)' : '';
    const full = this.activeCount() >= MAX_ACTIVE;
    const opts = [
      { label: full ? 'Quest log is full' : 'Accept', cb: () => { if (!full && this.accept(q.id)) this.say(q.giver, q.remind || 'Good luck.', [{ label: 'Thanks', cb: () => {} }]); } },
      { label: 'Not now', cb: () => back?.() },
    ];
    this.say(q.giver, `${q.offer}\n\n${this.objBlock(q)}\nReward: ${lines.join(', ') || '-'}${ch}`, opts);
  }
  turnInDialog(q, back) {
    const id = q.id;
    const choose = (choice) => {
      if (this.complete(id, choice)) {
        const follow = QUEST_LIST.find((x) => x.giver === this.turnNpc(q) && this.status(x.id) === 'available');
        if (follow) this.say(this.turnNpc(q), `${q.done}\n\nI have more work for you, if you want it.`, [{ label: `! ${follow.name}`, cb: () => this.offerDialog(follow) }, { label: 'Later', cb: () => {} }]);
        else this.say(this.turnNpc(q), q.done, [{ label: 'Thanks', cb: () => {} }]);
      }
    };
    const opts = q.choices
      ? q.choices.map((c) => ({ label: c.label, cb: () => choose(c) }))
      : [{ label: `Complete quest  (${rewardLines(q.reward).slice(0, 3).join(', ')})`, cb: () => choose(null) }];
    opts.push({ label: 'Not yet', cb: () => back?.() });
    this.say(this.turnNpc(q), `${q.name}: you have everything I asked for.`, opts);
  }

  // Returns true if a quest dialogue was shown (caller then skips its default).
  // fallback(): the NPC's ordinary behaviour (shop / chat); label used for menu entry.
  talk(name, fallback, fallbackLabel = 'Chat', who = null) {
    const reg = this.npcs.get(name);
    if (who && reg && reg.c !== who) return false; // same-named ambient NPC: not the quest giver
    // 1. talk objectives
    let marked = false;
    for (const id of this.activeIds()) {
      const q = this.def(id);
      q.obj.forEach((o, i) => {
        if (o.t === 'talk' && o.npc === name && !this.prog(id, i).done) { this.s.active[id].p[i] = 1; marked = true; this.notifyObj(id, i, false); }
      });
    }
    if (marked) this.changed();
    const ready = this.activeIds().map((id) => this.def(id)).filter((q) => this.turnNpc(q) === name && this.isReady(q.id));
    const avail = QUEST_LIST.filter((q) => q.giver === name && this.status(q.id) === 'available');
    const ongoing = this.activeIds().map((id) => this.def(id)).filter((q) => q.giver === name && !this.isReady(q.id) && !ready.includes(q));
    if (!ready.length && !avail.length && !ongoing.length) return marked ? (fallback?.(), true) : false;
    const again = () => this.talk(name, fallback, fallbackLabel, who);
    // direct path: exactly one actionable quest and nothing else to offer
    if (!fallback && ready.length + avail.length === 1 && !ongoing.length) {
      ready.length ? this.turnInDialog(ready[0], again) : this.offerDialog(avail[0], again);
      return true;
    }
    const opts = [];
    for (const q of ready) opts.push({ label: `? ${q.name}`, cb: () => this.turnInDialog(q, again) });
    for (const q of avail) opts.push({ label: `! ${q.name}`, cb: () => this.offerDialog(q, again) });
    for (const q of ongoing) opts.push({ label: `... ${q.name}`, cb: () => this.say(name, `${q.remind || 'Keep at it.'}\n\n${q.obj.map((o, i) => `- ${objText(o)}${o.n > 1 ? ` (${this.prog(q.id, i).cur}/${o.n})` : this.prog(q.id, i).done ? ' (done)' : ''}`).join('\n')}`, [{ label: 'Back', cb: again }, { label: 'Bye', cb: () => {} }]) });
    if (fallback) opts.push({ label: fallbackLabel, cb: () => fallback() });
    opts.push({ label: 'Goodbye', cb: () => {} });
    const greet = ready.length ? 'You look like you have news.' : avail.length ? 'Got a minute? I could use some help.' : 'How goes the work?';
    this.say(name, greet, opts.slice(0, 7));
    return true;
  }

  // ——— notice-board bounties ———
  offeredBounties() {
    const lvl = this.p.level, day = dayKey();
    const b = this.s.bounty;
    if (b.day !== day) { this.s.bounty = { day, taken: {}, done: {} }; }
    const pool = BOUNTY_TEMPLATES.filter((t) => lvl >= t.lv[0] && lvl <= t.lv[1]);
    const ranked = pool.map((t) => ({ t, h: hash(`${day}:${t.id}`) })).sort((a, z) => a.h - z.h).slice(0, 3).map((x) => x.t);
    return ranked.map((t) => this.makeBounty(t));
  }
  makeBounty(t) {
    const lvl = this.p.level;
    const n = t.obj.n || 1;
    const xp = Math.round(30 + lvl * 14 + n * 6), gold = Math.round(14 + lvl * 5 + n * 3);
    return {
      id: `bounty_${t.id}`, name: t.name, giver: BOARD, turnIn: BOARD, lv: t.lv[0], zone: t.zone, repeat: true, chain: null,
      story: 'Daily bounty from the Thistle Town notice board.', remind: t.text, offer: t.text, done: 'Well done. The board pays on the spot.',
      obj: [{ ...t.obj }], reward: { xp, gold, mats: lvl >= 4 ? { empty_vial: 1 } : {} }, tpl: t.id,
    };
  }
  bountyStatus(b) {
    if (this.s.active[b.id]) return this.isReady(b.id) ? 'ready' : 'active';
    if (this.s.bounty.done?.[b.tpl]) return 'done';
    return 'offer';
  }
  acceptBounty(b) {
    if (this.activeCount() >= MAX_ACTIVE) { bus.emit(Events.SYSTEM, `Quest log full (${MAX_ACTIVE}).`); return false; }
    this.s.active[b.id] = { p: [0], t: Date.now(), def: b };
    this.s.bounty.taken[b.tpl] = 1;
    if (this.s.tracked.length < MAX_TRACKED) this.s.tracked.push(b.id);
    audio.play('quest', 0.8);
    bus.emit(Events.SYSTEM, `Bounty accepted: ${b.name}`);
    bus.emit(Events.TOAST, { title: 'Bounty accepted', text: b.name, color: '#ffd84a' });
    this.onPack(true);
    this.changed();
    return true;
  }
  openBoard() {
    const list = this.offeredBounties();
    const opts = [];
    const readyB = list.filter((b) => this.bountyStatus(b) === 'ready');
    for (const b of readyB) opts.push({ label: `? Turn in: ${b.name}`, cb: () => { if (this.complete(b.id)) { this.s.bounty.done[b.tpl] = 1; this.changed(); bus.emit(Events.SYSTEM, 'Bounty paid. New bounties post at dawn (tomorrow).'); } } });
    // a bounty finished earlier can vanish from the offered list when level changes; also allow turn-in of any ready active bounty
    for (const id of this.activeIds()) { const a = this.s.active[id]; if (a.def && this.isReady(id) && !readyB.some((b) => b.id === id)) opts.push({ label: `? Turn in: ${a.def.name}`, cb: () => { if (this.complete(id)) { this.s.bounty.done[a.def.tpl] = 1; this.changed(); } } }); }
    for (const b of list) {
      const st = this.bountyStatus(b);
      if (st === 'offer') opts.push({ label: `! ${b.name}  (${b.reward.xp}xp ${b.reward.gold}g)`, cb: () => this.offerBountyDialog(b) });
      else if (st === 'active') opts.push({ label: `... ${b.name} (in progress)`, cb: () => this.say(BOARD, `${b.offer}\n${this.prog(b.id, 0).cur}/${this.prog(b.id, 0).need}`, [{ label: 'OK', cb: () => {} }]) });
      else if (st === 'done') opts.push({ label: `x ${b.name} (done today)`, cb: () => {} });
    }
    opts.push({ label: 'Close', cb: () => {} });
    this.say('Notice Board', `Thistle Town bounties. They refresh daily.\n(${this.activeCount()}/${MAX_ACTIVE} quests active)`, opts);
    return true;
  }
  offerBountyDialog(b) {
    this.say('Notice Board', `${b.offer}\n\nReward: ${rewardLines(b.reward).join(', ')}`, [
      { label: 'Accept bounty', cb: () => { if (this.acceptBounty(b)) bus.emit(Events.SYSTEM, `${b.name}: ${b.offer}`); } },
      { label: 'Back', cb: () => this.openBoard() },
    ]);
  }
  boardOffers() { return this.offeredBounties(); }
}

export { BOARD };
void RARITY;
