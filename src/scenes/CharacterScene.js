import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { ADVANCED } from '../data/jobs.js';
import { input } from '../core/input.js';
import { settings, uiZoomFor } from '../core/settings.js';
import {
  STAT_IDS, STAT_INFO, MAX_LEVEL, MAX_STAT, SKILL_MAX, CLASS_CHANGE_LEVEL,
  computeDerived, statCost, skillDmgMul, skillCdMul,
} from '../data/stats.js';

// RPG overlay: Character panel (C), Skills tab (K), level-up toast, HUD
// buttons with a "points available" badge, advanced-skill bar (keys 5/6) and
// the Lv10 class-change modal. Lives in its own scene so UIScene/WorldScene
// only need tiny hooks. Reads/writes the player via ModularPlayer methods
// (applyStats / upgradeSkill / chooseClass) and listens on the event bus.
const FONT = '"Silkscreen", monospace';
const T = (size = 10, color = '#e6f2c0', extra = {}) => ({ fontFamily: FONT, fontSize: `${size}px`, color, ...extra });

export class CharacterScene extends Phaser.Scene {
  constructor() { super('character'); }
  world() { return this.scene.get('world'); }
  player() { return this.world()?.player || null; }
  // UI scale (Settings) = camera zoom with origin 0,0; lay out in view() units.
  applyZoom() { this.uiZoom = uiZoomFor(this.scale.width, this.scale.height); this.cameras.main.setZoom(this.uiZoom).setOrigin(0, 0).setScroll(0, 0); }
  view() { const z = this.uiZoom || 1; return { w: this.scale.width / z, h: this.scale.height / z }; }

  create() {
    this.open = false; this.tab = 'char';
    this.stage = this.emptyStage();
    this.cells = []; this.hudObjs = []; this.advObjs = []; this.advCells = [];
    this.modal = null; this.toastObjs = [];
    this.panel = this.add.container(0, 0).setDepth(185).setVisible(false);

    const offs = [
      bus.on(Events.LEVEL_UP, (m) => this.onLevelUp(m)),
      bus.on(Events.PROGRESS, () => this.onProgress()),
      bus.on(Events.PLAYER_XP, () => { if (this.open) this.render(); }),
    ];
    this.applyZoom();
    const onResize = () => { this.applyZoom(); this.layout(); };
    this.scale.on('resize', onResize);
    // hotkeys via core/input.js (rebindable); Esc closes modal -> panel before pausing
    offs.push(
      input.on('character', () => this.toggle('char')),
      input.on('skills', () => this.toggle('skills')),
      input.addCloser({ id: 'class-modal', priority: 600, isOpen: () => !!this.modal, close: () => this.closeModal() }),
      input.addCloser({ id: 'character', priority: 500, isOpen: () => this.open, close: () => this.setOpen(false) }),
      input.onChange(() => { this.buildHud(); this.buildAdvBar(); }),
      settings.onChange((k) => { if (k === 'uiScale') onResize(); }),
    );
    const w = this.world();
    const stop = () => this.scene.stop();
    w?.events.once('shutdown', stop);
    this.events.once('shutdown', () => { offs.forEach((o) => o()); this.scale.off('resize', onResize); w?.events.off('shutdown', stop); if (w) w.chatOpen = false; });

    this.layout();
    // Saved character already Lv10+ without a specialisation: offer it once.
    this.time.delayedCall(900, () => { if (this.player()?.canChooseClass()) this.showClassModal(); });
  }

  // ── layout: HUD buttons, advanced bar, panel anchor ─────────────────────────
  layout() {
    const { w: W, h: H } = this.view();
    this.small = W < 560;
    this.panel.setPosition(W / 2, H / 2);
    this.buildHud();
    this.buildAdvBar();
    if (this.open) this.render();
    if (this.modal) { this.closeModal(); this.showClassModal(); }
  }

  // pixel button: olive fill + dark text (same as pause menu buttons)
  btn(parent, x, y, w, h, label, cb, { color = 0x9bbc0f, hover = 0xb8d820, text = '#3a1f00', size = 10, enabled = true } = {}) {
    const fill = this.add.rectangle(x, y, w, h, enabled ? color : 0x5a5a48).setOrigin(0.5).setStrokeStyle(1, 0x1a1a22);
    const t = this.add.text(x, y, label, T(size, enabled ? text : '#2a2a20')).setOrigin(0.5);
    const objs = [fill, t];
    if (enabled) {
      fill.setInteractive({ useHandCursor: true });
      fill.on('pointerover', () => fill.setFillStyle(hover));
      fill.on('pointerout', () => fill.setFillStyle(color));
      fill.on('pointerdown', () => { audio.play('ui', 0.6); cb(); });
    }
    parent?.add(objs);
    return objs;
  }

  buildHud() {
    for (const o of this.hudObjs) o.destroy();
    this.hudObjs = [];
    const y = this.small ? 144 : 124;
    const p = this.player();
    const mk = (x, label, cb, opts) => { const o = this.btn(null, x, y, 62, 20, label, cb, { size: 9, ...opts }); this.hudObjs.push(...o); o.forEach((e) => e.setDepth(120)); return o; };
    mk(8 + 31, `CHAR ${input.labelFor('character')}`, () => this.toggle('char'));
    mk(8 + 31 + 66, `SKILL ${input.labelFor('skills')}`, () => this.toggle('skills'));
    const badge = (x, n) => {
      const c = this.add.circle(x, y - 10, 8, 0xd63c2f).setStrokeStyle(1, 0xffffff).setDepth(121);
      const t = this.add.text(x, y - 10, String(n), T(9, '#ffffff')).setOrigin(0.5).setDepth(122);
      this.tweens.add({ targets: [c, t], scale: 1.18, duration: 520, yoyo: true, repeat: -1 });
      this.hudObjs.push(c, t);
    };
    if (p) {
      if (p.prog.statPoints > 0) badge(8 + 62 - 2, p.prog.statPoints);
      if (p.prog.skillPoints > 0) badge(8 + 66 + 62 - 2, p.prog.skillPoints);
      if (p.canChooseClass()) {
        const o = this.btn(null, 8 + 62, y + 26, 124, 20, 'CLASS CHANGE!', () => this.showClassModal(), { color: 0xf4c542, hover: 0xffe07a, size: 9 });
        o.forEach((e) => e.setDepth(120)); this.hudObjs.push(...o);
        this.tweens.add({ targets: o, alpha: 0.65, duration: 600, yoyo: true, repeat: -1 });
      }
    }
    this.refreshAdvHint();
  }

  refreshAdvHint() { /* placeholder for future hints */ }

  // Advanced-class skill bar (keys 5/6), above the main hotbar.
  buildAdvBar() {
    for (const o of this.advObjs) o.destroy();
    this.advObjs = []; this.advCells = [];
    const p = this.player();
    const adv = p?.advClass();
    if (!adv) return;
    const { w: W, h: H } = this.view();
    const S = this.small ? 40 : 44, gap = 8;
    const y = H - (this.small ? 104 : 108);
    adv.abilities.forEach((ab, i) => {
      const x = W / 2 - (adv.abilities.length * (S + gap) - gap) / 2 + i * (S + gap) + S / 2;
      const bg = this.add.rectangle(x, y, S, S, 0x2a1d10, 0.92).setStrokeStyle(2, 0x9bbc0f).setDepth(120);
      const items = [bg];
      if (this.textures.exists(ab.icon)) items.push(this.add.image(x, y, ab.icon).setScale((S - 10) / 24).setDepth(121));
      items.push(this.add.text(x, y - S / 2 + 2, input.labelFor(`skill${ab.key}`), T(8, '#9bbc0f')).setOrigin(0.5, 0).setDepth(122));
      const lv = p.skillLv(ab.id);
      const lvT = this.add.text(x + S / 2 - 3, y + S / 2 - 3, lv ? `L${lv}` : '--', T(7, lv ? '#ffe8a0' : '#ff9d8a')).setOrigin(1, 1).setDepth(122);
      const cdBg = this.add.rectangle(x, y, S - 2, S - 2, 0x000000, 0.7).setDepth(123).setVisible(false);
      const cdT = this.add.text(x, y, '', T(13, '#ffffff')).setOrigin(0.5).setDepth(124).setVisible(false);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => { audio.play('ui', 0.6); this.world()?.cast(ab.key); });
      items.push(lvT, cdBg, cdT);
      this.advObjs.push(...items);
      this.advCells.push({ ab, cdBg, cdT, S });
    });
  }

  update() {
    const w = this.world(), p = w?.player;
    if (!p) return;
    for (const c of this.advCells) {
      const remain = Math.max(0, ((p.cooldowns[c.ab.id] || 0) - w.time.now) / 1000);
      const on = remain > 0;
      c.cdBg.setVisible(on); c.cdT.setVisible(on);
      if (on) {
        c.cdBg.setDisplaySize(c.S - 2, (c.S - 2) * Math.min(1, remain / p.skillCd(c.ab)));
        c.cdT.setText(remain > 1 ? remain.toFixed(0) : remain.toFixed(1));
      }
    }
  }

  // ── events ──────────────────────────────────────────────────────────────────
  onProgress() {
    this.buildHud();
    this.buildAdvBar();
    if (this.open) this.render();
  }

  onLevelUp(m) {
    const { w: W, h: H } = this.view();
    for (const o of this.toastObjs) o.destroy();
    this.toastObjs = [];
    const y = Math.round(H * 0.3);
    const big = this.add.text(W / 2, y, `LEVEL UP!  Lv ${m.level}`, T(this.small ? 18 : 24, '#ffe07a', { fontStyle: 'bold', stroke: '#3a1f00', strokeThickness: 4 })).setOrigin(0.5).setDepth(220);
    const sub = this.add.text(W / 2, y + (this.small ? 22 : 28),
      `${m.statPoints} stat pts  ·  ${m.skillPoints} skill pts  ·  press ${input.labelFor('character')} / ${input.labelFor('skills')}`,
      T(this.small ? 8 : 10, '#e6f2c0', { stroke: '#1a1a22', strokeThickness: 3, align: 'center', wordWrap: { width: W - 24 } })).setOrigin(0.5, 0).setDepth(220);
    this.toastObjs = [big, sub];
    if (m.needsClass) {
      const cls = this.add.text(W / 2, y + (this.small ? 50 : 58), 'A new path awaits: choose your class!', T(this.small ? 9 : 11, '#f4c542', { stroke: '#1a1a22', strokeThickness: 3 })).setOrigin(0.5).setDepth(220);
      this.toastObjs.push(cls);
    }
    big.setScale(0.6);
    this.tweens.add({ targets: big, scale: 1, duration: 260, ease: 'back.out' });
    this.tweens.add({ targets: this.toastObjs, alpha: 0, y: '-=16', delay: 2800, duration: 700, onComplete: () => { this.toastObjs.forEach((o) => o.destroy()); this.toastObjs = []; } });
    if (m.needsClass) this.time.delayedCall(1600, () => { if (this.player()?.canChooseClass() && !this.modal) this.showClassModal(); });
  }

  // ── panel open/close ────────────────────────────────────────────────────────
  toggle(tab) {
    if (this.modal) return;
    if (this.open && this.tab === tab) this.setOpen(false);
    else { this.tab = tab; this.setOpen(true); }
  }

  setOpen(on) {
    this.open = on;
    if (on) { this.stage = this.emptyStage(); this.render(); }
    this.panel.setVisible(on);
    this.syncBlock();
    audio.play('ui', 0.5);
  }

  syncBlock() { const w = this.world(); if (w) w.chatOpen = this.open || !!this.modal; } // WorldScene ignores clicks while set

  emptyStage() { return { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 }; }

  stagedCost(p) {
    let c = 0;
    for (const s of STAT_IDS) for (let i = 0; i < this.stage[s]; i++) c += statCost((p.job.base[s] || 5) + p.prog.alloc[s] + i);
    return c;
  }

  derivedFor(p, stage) {
    const alloc = {}; for (const s of STAT_IDS) alloc[s] = p.prog.alloc[s] + (stage?.[s] || 0);
    const d = computeDerived({ job: p.job, adv: p.advClass(), level: p.level, alloc, weaponKind: p.weaponKind() });
    const g = p.equippedStats();
    return {
      d,
      rows: [
        ['Max HP', d.maxHp + g.hp], ['Max MP', d.maxMp + g.mp],
        ['ATK', d.atk + g.atk], ['MATK', d.matk + g.atk],
        ['DEF', d.def + g.def], ['MDEF', d.mdef],
        ['HIT', d.hit], ['FLEE', d.flee],
        ['CRIT %', d.crit], ['ASPD x', Math.round(d.atkSpd * 100) / 100],
        ['MOVE', d.moveSpeed + g.spd], ['DODGE %', Math.round(d.dodge * 10) / 10],
      ],
    };
  }

  // ── panel rendering ─────────────────────────────────────────────────────────
  clearCells() { for (const c of this.cells) c.destroy(); this.cells = []; }
  put(o) { this.panel.add(o); this.cells.push(o); return o; }
  putAll(list) { list.forEach((o) => this.put(o)); return list; }

  render() {
    const p = this.player();
    if (!p) return;
    const { w: W, h: H } = this.view();
    this.clearCells();
    const pw = Math.min(W - 16, this.small ? 344 : 460);
    const ph = Math.min(H - 24, this.small ? 470 : 480);
    const L = -pw / 2, top = -ph / 2;
    // swallow clicks on the panel body so they never reach the game world
    this.put(this.add.rectangle(0, 0, pw, ph, 0x2a1d10, 0.97)).setInteractive();
    this.put(this.add.nineslice(0, 0, 'ui.panelBg', null, pw, ph, 4, 4, 4, 4).setOrigin(0.5).setAlpha(0.97));

    const adv = p.advClass();
    const cls = adv ? `${p.job.name} > ${adv.name}` : p.job.name;
    this.put(this.add.text(L + 14, top + 12, `${this.world().pname || 'Hero'}  ·  ${cls}`, T(12, '#f4c542', { fontStyle: 'bold' })));
    const close = this.put(this.add.text(pw / 2 - 22, top + 14, 'X', T(13, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 7, y: 3 } })).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    close.on('pointerdown', () => this.setOpen(false));

    // tabs
    const tabY = top + 44;
    this.putAll(this.btn(null, L + 14 + 62, tabY, 124, 20, 'CHARACTER', () => { this.tab = 'char'; this.render(); }, { color: this.tab === 'char' ? 0xf4c542 : 0x7a7a52, size: 9 }));
    this.putAll(this.btn(null, L + 14 + 62 + 130, tabY, 124, 20, 'SKILLS', () => { this.tab = 'skills'; this.render(); }, { color: this.tab === 'skills' ? 0xf4c542 : 0x7a7a52, size: 9 }));

    if (this.tab === 'char') this.renderChar(p, pw, ph); else this.renderSkills(p, pw, ph);
  }

  renderChar(p, pw, ph) {
    const L = -pw / 2, R = pw / 2, top = -ph / 2;
    let y = top + 70;
    // class / level line + XP bar
    const capped = p.level >= MAX_LEVEL;
    this.put(this.add.text(L + 14, y, `Lv ${p.level}${capped ? ' (MAX)' : ''}`, T(11, '#ffe8a0', { fontStyle: 'bold' })));
    if (p.canChooseClass()) {
      this.putAll(this.btn(null, R - 82, y + 6, 136, 18, 'CHOOSE CLASS', () => this.showClassModal(), { color: 0xf4c542, hover: 0xffe07a, size: 9 }));
    } else if (!p.advClass()) {
      this.put(this.add.text(R - 14, y + 2, `Class change at Lv ${CLASS_CHANGE_LEVEL}`, T(8, '#c8b878')).setOrigin(1, 0));
    } else {
      this.put(this.add.text(R - 14, y + 2, p.advClass().desc.split('.')[0], T(8, '#c8b878')).setOrigin(1, 0));
    }
    y += 22;
    const bw = pw - 28;
    this.put(this.add.rectangle(L + 14, y, bw, 10, 0x160e00, 0.95).setOrigin(0, 0).setStrokeStyle(1, 0x1a1a22));
    const frac = capped ? 1 : Math.min(1, p.xp / p.xpNext);
    this.put(this.add.rectangle(L + 14, y, Math.max(1, bw * frac), 10, 0xf1c40f).setOrigin(0, 0));
    this.put(this.add.text(0, y + 1, capped ? 'MAX LEVEL' : `XP ${p.xp} / ${p.xpNext}  (${Math.floor(frac * 100)}%)`, T(8, '#ffffff', { stroke: '#1a1200', strokeThickness: 3 })).setOrigin(0.5, 0));
    y += 20;

    // stat points + rows
    const remaining = p.prog.statPoints - this.stagedCost(p);
    this.put(this.add.text(L + 14, y, `Stat points: ${remaining}`, T(10, remaining > 0 ? '#9bf06b' : '#c8b878', { fontStyle: 'bold' })));
    this.put(this.add.text(R - 14, y + 1, 'cost rises with stat', T(8, '#8a7a5a')).setOrigin(1, 0));
    y += 18;
    const { d, rows } = this.derivedFor(p, this.stage);
    const cur = this.derivedFor(p, null);
    STAT_IDS.forEach((s, i) => {
      const ry = y + i * 24 + 10;
      const base = (p.job.base[s] || 5) + p.prog.alloc[s];
      const st = this.stage[s];
      const cost = statCost(base + st);
      this.put(this.add.rectangle(0, ry, pw - 20, 22, 0x000000, i % 2 ? 0.18 : 0.3));
      this.put(this.add.text(L + 16, ry, STAT_INFO[s].name, T(11, '#ffe8a0', { fontStyle: 'bold' })).setOrigin(0, 0.5));
      this.put(this.add.text(L + 56, ry, String(d.T[s]), T(11, '#ffffff', { fontStyle: 'bold' })).setOrigin(0, 0.5));
      if (st) this.put(this.add.text(L + 84, ry, `+${st}`, T(9, '#9bf06b')).setOrigin(0, 0.5));
      this.put(this.add.text(L + 112, ry, STAT_INFO[s].desc, T(8, '#b8c890')).setOrigin(0, 0.5));
      const canAdd = remaining >= cost && base + st < MAX_STAT;
      this.putAll(this.btn(null, R - 88, ry, 22, 18, '-', () => { this.stage[s] -= 1; this.render(); }, { enabled: st > 0, size: 11, color: 0xc0705a, hover: 0xe08a70 }));
      this.putAll(this.btn(null, R - 62, ry, 22, 18, '+', () => { this.stage[s] += 1; this.render(); }, { enabled: canAdd, size: 11 }));
      this.put(this.add.text(R - 40, ry, `${cost}pt`, T(8, canAdd ? '#d8c090' : '#6a6a50')).setOrigin(0, 0.5));
    });
    y += STAT_IDS.length * 24 + 12;

    // derived stats (preview incl. staged + gear; green = changes)
    this.put(this.add.text(L + 14, y, 'DERIVED', T(9, '#9bbc0f')));
    y += 14;
    const colW = (pw - 28) / 2;
    rows.forEach(([label, val], i) => {
      const cx = L + 14 + (i % 2) * colW, cy = y + Math.floor(i / 2) * 15;
      const changed = val !== cur.rows[i][1];
      this.put(this.add.text(cx, cy, label, T(9, '#c8b878')));
      this.put(this.add.text(cx + colW - 14, cy, String(val), T(9, changed ? '#9bf06b' : '#ffffff')).setOrigin(1, 0));
    });
    // buttons
    const by = ph / 2 - 24;
    const any = STAT_IDS.some((s) => this.stage[s] > 0);
    this.putAll(this.btn(null, -62, by, 116, 24, 'APPLY', () => {
      if (p.applyStats(this.stage)) { this.stage = this.emptyStage(); audio.play('quest', 0.6); this.world().saveNow(); bus.emit(Events.PLAYER_HP, this.world().hpPayload()); }
      this.render();
    }, { enabled: any, size: 11 }));
    this.putAll(this.btn(null, 62, by, 116, 24, 'RESET', () => { this.stage = this.emptyStage(); this.render(); }, { enabled: any, size: 11, color: 0xc0705a, hover: 0xe08a70 }));
  }

  renderSkills(p, pw, ph) {
    const L = -pw / 2, R = pw / 2, top = -ph / 2;
    let y = top + 70;
    this.put(this.add.text(L + 14, y, `Skill points: ${p.prog.skillPoints}`, T(11, p.prog.skillPoints > 0 ? '#9bf06b' : '#c8b878', { fontStyle: 'bold' })));
    this.put(this.add.text(R - 14, y + 2, `Skills Lv 1-${SKILL_MAX}: +15% power, -6% cooldown`, T(8, '#8a7a5a')).setOrigin(1, 0));
    y += 20;
    const list = p.skillList();
    const rh = this.small ? 54 : 52;
    const rowsToShow = [...list];
    rowsToShow.forEach((ab, i) => {
      const ry = y + i * (rh + 4) + rh / 2;
      const lv = p.skillLv(ab.id);
      const isAdv = !p.job.abilities.some((a) => a.id === ab.id);
      this.put(this.add.rectangle(0, ry, pw - 20, rh, 0x000000, 0.3).setStrokeStyle(1, isAdv ? 0xf4c542 : 0x3a2a14));
      const icon = ab.icon || this.iconFor(ab.id);
      if (icon && this.textures.exists(icon)) this.put(this.add.image(L + 36, ry, icon).setScale(1.5));
      this.put(this.add.text(L + 62, ry - rh / 2 + 6, `[${ab.key}] ${ab.name}`, T(10, isAdv ? '#ffe07a' : '#fff8e0', { fontStyle: 'bold' })));
      this.put(this.add.text(L + 62, ry - rh / 2 + 20, ab.desc, T(8, '#b8c890', { wordWrap: { width: pw - 150 } })));
      const cdNow = ab.cd * skillCdMul(Math.max(1, lv));
      const eff = lv ? `Lv${lv}: power +${Math.round((skillDmgMul(lv) - 1) * 100)}%  cd ${cdNow.toFixed(1)}s` : 'Not learned';
      this.put(this.add.text(L + 62, ry + rh / 2 - 13, eff, T(8, lv ? '#aed6f1' : '#ff9d8a')));
      // pips
      for (let k = 0; k < SKILL_MAX; k++) {
        this.put(this.add.rectangle(R - 54 + k * 8, ry - rh / 2 + 10, 6, 6, k < lv ? 0xf4c542 : 0x3a2a14).setStrokeStyle(1, 0x1a1a22));
      }
      const can = p.prog.skillPoints > 0 && lv < SKILL_MAX;
      this.putAll(this.btn(null, R - 34, ry + 8, 46, 20, lv ? '+' : 'LEARN', () => {
        if (p.upgradeSkill(ab.id)) { audio.play('quest', 0.6); this.world().saveNow(); }
        this.render();
      }, { enabled: can, size: lv ? 12 : 8 }));
    });
    if (!p.advClass()) {
      const ny = y + list.length * (rh + 4) + 20;
      this.put(this.add.text(0, ny, p.level >= CLASS_CHANGE_LEVEL ? 'Choose a class to unlock 2 advanced skills!' : `Reach Lv ${CLASS_CHANGE_LEVEL} to specialise and unlock advanced skills.`, T(9, '#f4c542', { align: 'center', wordWrap: { width: pw - 40 } })).setOrigin(0.5, 0));
    }
  }

  iconFor(id) { const M = { slash: 'icon.slash', flare: 'icon.flare', dash: 'icon.dash', camp: 'icon.camp', shot: 'icon.shot', volley: 'icon.volley', snare: 'icon.snare', bolt: 'icon.bolt', burst: 'icon.burst', blink: 'icon.blink', ward: 'icon.ward', stab: 'icon.stab', fan: 'icon.fan', smoke: 'icon.smoke' }; return M[id]; }

  // ── class-change modal ──────────────────────────────────────────────────────
  showClassModal() {
    const p = this.player();
    if (!p || !p.canChooseClass() || this.modal) return;
    this.setOpen(false);
    const { w: W, h: H } = this.view();
    const opts = p.job.advanced.map((id) => ADVANCED[id]);
    const objs = [];
    const add = (o) => { o.setDepth(210); objs.push(o); return o; };
    const dim = add(this.add.rectangle(0, 0, W, H, 0x000000, 0.72).setOrigin(0).setInteractive()); // blocks input below
    const cw = Math.min(216, (W - 32) / 2 - 4), ch = Math.min(H - 150, this.small ? 300 : 250);
    const cy = H / 2 + 6;
    add(this.add.text(W / 2, cy - ch / 2 - 44, 'CHOOSE YOUR PATH', T(this.small ? 16 : 20, '#ffe07a', { fontStyle: 'bold', stroke: '#3a1f00', strokeThickness: 4 })).setOrigin(0.5));
    add(this.add.text(W / 2, cy - ch / 2 - 22, `${p.job.name}, Lv ${p.level}: this choice is permanent.`, T(9, '#e6f2c0', { stroke: '#1a1a22', strokeThickness: 3 })).setOrigin(0.5));
    let chosen = null;
    const cards = [];
    const confirmObjs = [];
    const drawConfirm = () => {
      confirmObjs.forEach((o) => o.destroy()); confirmObjs.length = 0;
      const o = this.btn(null, W / 2 + 70, cy + ch / 2 + 30, 130, 26, chosen ? `BECOME ${ADVANCED[chosen].name.toUpperCase()}` : 'PICK A CLASS', () => {
        if (!chosen) return;
        if (p.chooseClass(chosen)) {
          audio.play('quest'); audio.play('level', 0.8);
          this.world().spawnFx?.(p.x, p.y - 10, 'fx.boost', 1.6);
          bus.emit(Events.SYSTEM, `${this.world().pname} became a ${ADVANCED[chosen].name}!`);
          bus.emit(Events.PLAYER_HP, this.world().hpPayload());
          this.world().saveNow();
          this.closeModal();
          this.toast(`Class: ${ADVANCED[chosen].name}!`, 'Learn your new skills in Skills (K)');
        }
      }, { enabled: !!chosen, size: 8, color: 0xf4c542, hover: 0xffe07a });
      o.forEach((e) => { e.setDepth(212); objs.push(e); confirmObjs.push(e); });
    };
    opts.forEach((a, i) => {
      const x = W / 2 + (i === 0 ? -1 : 1) * (cw / 2 + 6);
      const frame = add(this.add.rectangle(x, cy, cw, ch, 0x2a1d10, 0.98).setStrokeStyle(3, 0x6b4a22));
      frame.setInteractive({ useHandCursor: true });
      let ty = cy - ch / 2 + 12;
      add(this.add.text(x, ty, a.name, T(this.small ? 11 : 13, '#f4c542', { fontStyle: 'bold' })).setOrigin(0.5, 0)); ty += 22;
      const dsc = add(this.add.text(x, ty, a.desc, T(8, '#e6f2c0', { wordWrap: { width: cw - 16 }, align: 'center' })).setOrigin(0.5, 0)); ty += dsc.height + 8;
      const bonus = STAT_IDS.filter((s) => a.bonus[s]).map((s) => `+${a.bonus[s]} ${STAT_INFO[s].name}`).join('  ');
      add(this.add.text(x, ty, bonus, T(9, '#9bf06b', { wordWrap: { width: cw - 16 }, align: 'center' })).setOrigin(0.5, 0)); ty += 26;
      const mods = [a.hpMul && `HP +${Math.round((a.hpMul - 1) * 100)}%`, a.mpMul && `MP +${Math.round((a.mpMul - 1) * 100)}%`, a.crit && `Crit +${a.crit}%`, a.aspd && `ASPD +${Math.round(a.aspd * 100)}%`, a.move && `Move +${Math.round(a.move * 100)}%`].filter(Boolean).join('  ');
      if (mods) { add(this.add.text(x, ty, mods, T(8, '#aed6f1', { wordWrap: { width: cw - 16 }, align: 'center' })).setOrigin(0.5, 0)); ty += 18; }
      add(this.add.text(x, ty, 'SKILLS', T(8, '#9bbc0f')).setOrigin(0.5, 0)); ty += 14;
      for (const ab of a.abilities) {
        if (this.textures.exists(ab.icon)) add(this.add.image(x - cw / 2 + 18, ty + 12, ab.icon).setScale(1));
        add(this.add.text(x - cw / 2 + 34, ty, `[${ab.key}] ${ab.name}`, T(8, '#fff8e0', { fontStyle: 'bold' })));
        add(this.add.text(x - cw / 2 + 34, ty + 11, ab.desc, T(7, '#b8c890', { wordWrap: { width: cw - 44 } })));
        ty += 34;
      }
      cards.push({ id: a.id, frame });
      frame.on('pointerdown', () => { chosen = a.id; audio.play('ui', 0.6); cards.forEach((c) => c.frame.setStrokeStyle(3, c.id === chosen ? 0xf4c542 : 0x6b4a22)); drawConfirm(); });
    });
    const later = this.btn(null, W / 2 - 70, cy + ch / 2 + 30, 110, 26, 'LATER', () => this.closeModal(), { color: 0x7a7a52, hover: 0x9a9a6a, size: 10 });
    later.forEach((e) => { e.setDepth(212); objs.push(e); });
    drawConfirm();
    this.modal = objs;
    this.syncBlock();
  }

  closeModal() {
    if (!this.modal) return;
    this.modal.forEach((o) => o.destroy());
    this.modal = null;
    this.syncBlock();
    this.buildHud();
  }

  toast(title, sub) {
    const { w: W, h: H } = this.view();
    const a = this.add.text(W / 2, Math.round(H * 0.3), title, T(this.small ? 16 : 22, '#ffe07a', { fontStyle: 'bold', stroke: '#3a1f00', strokeThickness: 4 })).setOrigin(0.5).setDepth(220);
    const b = this.add.text(W / 2, Math.round(H * 0.3) + 26, sub, T(9, '#e6f2c0', { stroke: '#1a1a22', strokeThickness: 3 })).setOrigin(0.5, 0).setDepth(220);
    this.tweens.add({ targets: [a, b], alpha: 0, y: '-=16', delay: 2600, duration: 700, onComplete: () => { a.destroy(); b.destroy(); } });
  }
}
