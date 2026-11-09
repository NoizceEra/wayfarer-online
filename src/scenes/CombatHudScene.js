import Phaser from 'phaser';
import { STATUS, RANKS } from '../data/combatMath.js';
import { input, PAD_LABELS } from '../core/input.js';
import { settings } from '../core/settings.js';

const FONT = '"Silkscreen", monospace';
const MAX_BUFFS = 8;
const ROLE_GUIDE_KEY = 'wayfarer.encounter.roles.v1';
const ROLE_GUIDE_STEPS = [
  { text: '[C] AURA · CAPTAIN BUFFS SQUAD', color: '#ffcf72' },
  { text: '[V] COVER · BREAK BLUE GUARD', color: '#72cfff' },
  { text: '[F] PINCER · DODGE / PARRY PURPLE', color: '#d8a8ff' },
  { text: '[S] RALLY · HIT CYAN CASTER', color: '#72cfff' },
];

// Combat HUD layered over UIScene (added at runtime by systems/combat.js, so
// main.js / UIScene stay untouched): target frame (name, level, con colour,
// HP, statuses), hero buff/debuff bar, combo counter, death overlay.
export class CombatHudScene extends Phaser.Scene {
  constructor() { super('combathud'); }

  create() {
    const F = (size, color, extra = {}) => ({ fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#1a1024', strokeThickness: 3, ...extra });
    // — target frame —
    this.tf = this.add.container(0, 0).setDepth(10).setVisible(false);
    this.tfG = this.add.graphics();
    this.tfName = this.add.text(0, 0, '', F(10, '#fff')).setOrigin(0, 0);
    this.tfRank = this.add.text(0, 0, '', F(8, '#ffd36a')).setOrigin(1, 0);
    this.tfHp = this.add.text(0, 0, '', F(8, '#ffffff')).setOrigin(0.5, 0.5);
    this.tfState = this.add.text(0, 0, '', F(8, '#c8c8c8')).setOrigin(1, 0.5);
    this.tf.add([this.tfG, this.tfName, this.tfRank, this.tfHp, this.tfState]);
    // — buff bar —
    this.buffs = [];
    for (let i = 0; i < MAX_BUFFS; i++) {
      const c = this.add.container(0, 0).setDepth(10).setVisible(false);
      const g = this.add.graphics();
      const glyph = this.add.text(0, -1, '', F(11, '#ffffff', { strokeThickness: 3 })).setOrigin(0.5);
      const secs = this.add.text(0, 12, '', F(8, '#ffffff', { strokeThickness: 3 })).setOrigin(0.5, 0);
      c.add([g, glyph, secs]);
      this.buffs.push({ c, g, glyph, secs });
    }
    // — combo —
    this.comboT = this.add.text(0, 0, '', F(18, '#ffe14a', { strokeThickness: 4 })).setOrigin(1, 0.5).setDepth(10).setVisible(false);
    this.comboSub = this.add.text(0, 0, 'COMBO', F(8, '#ffb04a')).setOrigin(1, 0.5).setDepth(10).setVisible(false);
    this.comboRank = this.add.text(0, 0, '', F(9, '#7dffcf')).setOrigin(1, 0.5).setDepth(10).setVisible(false);
    this.comboG = this.add.graphics().setDepth(9);
    // — class resource / defensive timing —
    this.resourceG = this.add.graphics().setDepth(10);
    this.resourceT = this.add.text(0, 0, '', F(8, '#e1e8f0')).setOrigin(0.5, 1).setDepth(11);
    this.parryT = this.add.text(0, 0, '', F(7, '#9aa8bd')).setOrigin(0.5, 0).setDepth(11);
    this.resourceHit = this.add.rectangle(0, 0, 190, 20, 0x000000, 0.001).setDepth(12).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.world()?.combat?.castUltimate?.());
    this.parryHit = this.add.rectangle(0, 0, 150, 18, 0x000000, 0.001).setDepth(12).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.world()?.combat?.parry?.());
    // Screen-space hit direction stays readable at every camera zoom and on
    // narrow phone viewports where the attacker may sit behind the HUD.
    this.damageCueG = this.add.graphics().setDepth(18);
    // — directed encounter strip —
    this.encounterHud = this.add.container(0, 0).setDepth(17).setVisible(false);
    this.encounterG = this.add.graphics();
    this.encounterHit = this.add.rectangle(0, 16, 340, 32, 0xffffff, 0.001).setInteractive({ useHandCursor: true })
      .on('pointerdown', (_p, _x, _y, ev) => { ev?.stopPropagation?.(); this.world()?.combat?.focusPriorityTarget?.(); });
    this.encounterTitle = this.add.text(0, 0, '', F(9, '#ffcf72')).setOrigin(0.5, 0);
    this.encounterRoles = this.add.text(0, 0, '[C] CAPTAIN · [F] FLANK · [S] RALLY', F(6, '#aab7c8')).setOrigin(0.5, 0);
    // The first directed encounter teaches its four combat roles in-place.
    // It stays non-modal: urgent casts replace the lesson until their window ends.
    this.roleGuideCloseHit = this.add.rectangle(0, 16, 28, 28, 0xffffff, 0.001).setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (_p, _x, _y, ev) => { ev?.stopPropagation?.(); this.dismissRoleGuide(); });
    this.roleGuideClose = this.add.text(0, 0, '×', F(9, '#d6e0ec')).setOrigin(0.5).setVisible(false);
    this.encounterHud.add([this.encounterG, this.encounterHit, this.encounterTitle, this.encounterRoles, this.roleGuideCloseHit, this.roleGuideClose]);
    this.encounterLeft = null;
    this.roleGuideElapsed = 0;
    this.roleGuideLastAt = 0;
    this.roleGuideVisible = false;
    try {
      this.roleGuideSeen = typeof window !== 'undefined' && window.localStorage.getItem(ROLE_GUIDE_KEY) === 'done';
    } catch { this.roleGuideSeen = false; }
    // Escape on keyboard and B on standard controllers dismiss the same guide
    // as the generous touch target above.
    input.addCloser({
      id: 'encounterRoleGuide', priority: 50, scene: this,
      isOpen: () => this.roleGuideVisible,
      close: () => this.dismissRoleGuide(),
    });
    // — compact post-combat report —
    this.recap = this.add.container(0, 0).setDepth(19).setVisible(false);
    this.recapG = this.add.graphics();
    this.recapTitle = this.add.text(0, 0, '', F(10, '#7dffcf')).setOrigin(0.5, 0);
    this.recapMain = this.add.text(0, 0, '', F(8, '#ffffff', { align: 'center' })).setOrigin(0.5, 0);
    this.recapSub = this.add.text(0, 0, '', F(7, '#aab7c8', { align: 'center' })).setOrigin(0.5, 0);
    this.recapExtra = this.add.text(0, 0, '', F(7, '#8fd8ff', { align: 'center' })).setOrigin(0.5, 0);
    this.recapGoal = this.add.text(0, 0, '', F(7, '#7dffcf', { align: 'center' })).setOrigin(0.5, 0);
    this.recapHit = this.add.rectangle(0, 0, 10, 10, 0xffffff, 0.001).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.world()?.combat?.cycleCombatReport?.());
    this.recapClose = this.add.text(0, 0, 'X', F(9, '#ff9a8a')).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', (ptr) => { ptr.event?.stopPropagation?.(); const cb = this.world()?.combat; if (cb?.combatRecap) cb.combatRecap.showUntil = 0; });
    this.recap.add([this.recapG, this.recapTitle, this.recapMain, this.recapSub, this.recapExtra, this.recapGoal, this.recapHit, this.recapClose]);
    this.reportButton = this.add.text(0, 0, 'LAST REPORT', F(7, '#8fd8ff', { backgroundColor: '#08131ce8', padding: { x: 6, y: 4 } }))
      .setOrigin(0.5, 0).setDepth(19).setVisible(false).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.world()?.combat?.showCombatReport?.(0));
    // — death overlay —
    this.deathBg = this.add.rectangle(0, 0, 10, 10, 0x0a0614, 0).setOrigin(0).setDepth(20);
    this.deathT = this.add.text(0, 0, 'YOU HAVE FALLEN', F(20, '#e8d8ff', { strokeThickness: 5 })).setOrigin(0.5).setDepth(21).setVisible(false);
    this.deathSub = this.add.text(0, 0, '', F(10, '#c8b8e8', { align: 'center' })).setOrigin(0.5).setDepth(21).setVisible(false);
  }

  world() { const w = this.scene.get('world'); return w && w.sys.isActive() && w.combat ? w : null; }

  dismissRoleGuide() {
    this.roleGuideSeen = true;
    this.roleGuideVisible = false;
    this.roleGuideCloseHit?.setVisible(false);
    this.roleGuideClose?.setVisible(false);
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(ROLE_GUIDE_KEY, 'done');
    } catch { /* Storage can be unavailable in private browsing; dismissal still lasts for this session. */ }
  }

  update() {
    const w = this.world();
    const { width: W, height: H } = this.scale;
    const small = W < 560;
    if (!w) { this.tf.setVisible(false); return; }
    const cb = w.combat, p = w.player, now = w.time.now;
    this.drawEncounter(w, W, small);
    this.drawTarget(w, cb, p, W, small);
    this.drawBuffs(cb, p, now, small);
    this.drawClassResource(cb, p, now, W, H, small);
    this.drawDamageCue(cb, now, W, H, small);
    this.drawRecap(cb, now, W, H, small);
    // combo
    const n = cb.combo.n;
    if (n >= 2) {
      const bump = Math.max(0, 1 - (now - cb.combo.bumpAt) / 140);
      const x = W - 14, y = small ? H * 0.42 : H * 0.36;
      this.comboT.setText(`${n} HITS`).setPosition(x, y).setScale(1 + 0.35 * bump).setVisible(true)
        .setColor(n >= 20 ? '#ff6a4a' : n >= 10 ? '#ffb04a' : '#ffe14a')
        .setAlpha(Phaser.Math.Clamp((cb.combo.until - now) / 600, 0.25, 1));
      const left = Phaser.Math.Clamp((cb.combo.until - now) / 2200, 0, 1);
      const tier = n >= 20 ? 'LEGEND · +10% DMG' : n >= 10 ? 'SURGE · +5% DMG' : n >= 5 ? 'FLOW' : 'COMBO';
      this.comboSub.setText(tier).setPosition(x, y + 15).setVisible(true).setAlpha(this.comboT.alpha);
      this.comboRank.setText(n < 5 ? `${5 - n} TO FLOW` : n < 10 ? `${10 - n} TO SURGE` : n < 20 ? `${20 - n} TO LEGEND` : 'MAX MOMENTUM')
        .setPosition(x, y + 27).setVisible(true).setAlpha(this.comboT.alpha);
      this.comboG.clear();
      const bw = small ? 92 : 118;
      this.comboG.fillStyle(0x0a0e1a, 0.8).fillRect(x - bw, y + 37, bw, 4);
      this.comboG.fillStyle(n >= 20 ? 0xff6a4a : n >= 10 ? 0xffb04a : 0x14f195, this.comboT.alpha).fillRect(x - bw, y + 37, bw * left, 4);
    } else {
      this.comboT.setVisible(false); this.comboSub.setVisible(false); this.comboRank.setVisible(false); this.comboG.clear();
    }
    // death overlay
    const d = cb.death;
    if (d) {
      const k = Phaser.Math.Clamp((now - d.at) / 700, 0, 1);
      this.deathBg.setSize(W, H).setFillStyle(0x0a0614, 0.55 * k);
      const left = Math.max(0, Math.ceil((d.respawnAt - now) / 1000));
      this.deathT.setPosition(W / 2, H / 2 - 16).setVisible(true).setAlpha(k);
      this.deathSub.setPosition(W / 2, H / 2 + 12).setVisible(true).setAlpha(k)
        .setText(`-${d.xpLoss} XP  ·  -${d.goldLoss}g\nRespawning at ${d.dest}${left ? ` in ${left}` : '...'}`);
    } else if (this.deathT.visible) {
      this.deathBg.setFillStyle(0x0a0614, 0); this.deathT.setVisible(false); this.deathSub.setVisible(false);
    }
  }

  drawEncounter(w, W, small) {
    const e = w.encounters?.active;
    if (!e) {
      this.encounterHud.setVisible(false);
      this.encounterLeft = null;
      this.roleGuideLastAt = 0;
      this.roleGuideVisible = false;
      return;
    }
    const mods = e.modifiers || (e.modifier ? [e.modifier] : []);
    const names = mods.map((m) => m.name).join(' + ') || 'WILDERNESS';
    const width = Math.min(W - 16, small ? 286 : 340), height = 32;
    const x = W / 2, y = small ? 108 : 7;
    this.encounterHud.setPosition(x, y).setVisible(true);
    this.encounterHit.setSize(width, height);
    this.encounterG.clear();
    this.encounterG.fillStyle(0x08131c, 0.92).fillRoundedRect(-width / 2, 0, width, height, 4);
    const priority = w.combat?.priorityThreat?.(false);
    const priorityColor = priority?.attackKind === 'pincer' ? 0xd08cff : 0x72cfff;
    const warningAlpha = settings.get('reduceMotion') ? 1 : 0.72 + Math.sin(w.time.now / 110) * 0.28;
    this.encounterG.lineStyle(priority ? 2 : e.mythic ? 2 : 1, priority ? priorityColor : e.modifier?.tint || 0xffb04a, priority ? warningAlpha : 1)
      .strokeRoundedRect(-width / 2 + 0.5, 0.5, width - 1, height - 1, 4);
    const cleared = Math.max(0, (e.total || e.left) - e.left);
    this.encounterG.fillStyle(0x10212b, 1).fillRect(-width / 2 + 6, 25, width - 12, 3);
    this.encounterG.fillStyle(e.modifier?.tint || 0xffb04a, 1).fillRect(-width / 2 + 6, 25, (width - 12) * (cleared / Math.max(1, e.total || e.left)), 3);
    this.encounterTitle.setPosition(0, 4).setText(`${e.mythic ? 'MYTHIC · ' : ''}${names} · ${e.left}/${e.total || e.left} REMAIN`)
      .setColor(e.modifier?.color || '#ffcf72');
    const moraleLeft = Math.max(0, Math.ceil(((e.moraleBrokenUntil || 0) - w.time.now) / 1000));
    const channelLeft = priority ? Math.max(0, priority.stateUntil - w.time.now) : 0;
    const focusHint = input.lastSource === 'gamepad' ? `[${PAD_LABELS.target}]` : small ? 'TAP' : `[${input.labelFor('target')}] / CLICK`;
    const stepMs = settings.get('reduceMotion') ? 3800 : 3000;
    const frameMs = this.roleGuideLastAt ? Phaser.Math.Clamp(w.time.now - this.roleGuideLastAt, 0, 100) : 0;
    this.roleGuideLastAt = w.time.now;
    if (!this.roleGuideSeen && e.captainAlive && !priority) {
      this.roleGuideElapsed += frameMs;
      if (this.roleGuideElapsed >= ROLE_GUIDE_STEPS.length * stepMs) this.dismissRoleGuide();
    }
    const guide = !this.roleGuideSeen && e.captainAlive && !priority
      ? ROLE_GUIDE_STEPS[Math.min(ROLE_GUIDE_STEPS.length - 1, Math.floor(this.roleGuideElapsed / stepMs))]
      : null;
    const roleLine = priority?.attackKind === 'pincer' ? `PINCER ${Math.ceil(channelLeft / 100) / 10}s · DODGE / PARRY`
      : priority ? `RALLY ${Math.ceil(channelLeft / 100) / 10}s · ${focusHint} TO FOCUS`
      : guide ? guide.text
      : e.captainAlive ? '[C] AURA · [V] COVER · [F] FLANK · [S] RALLY'
      : moraleLeft ? `MORALE BROKEN · WEAKENED ${moraleLeft}s` : 'CAPTAIN DOWN · AURA DISABLED';
    this.encounterRoles.setOrigin(guide ? 0 : 0.5, 0).setPosition(guide ? -width / 2 + 8 : 0, 16)
      .setFontSize(guide ? 7 : 6).setText(roleLine)
      .setColor(priority?.attackKind === 'pincer' ? '#d8a8ff' : priority ? '#72cfff' : guide?.color || (e.captainAlive ? '#aab7c8' : '#7dffcf'));
    this.roleGuideVisible = !!guide;
    this.roleGuideCloseHit.setPosition(width / 2 - 14, 16).setVisible(this.roleGuideVisible);
    const closeLabel = input.lastSource === 'gamepad' ? PAD_LABELS.back : small ? '×' : 'ESC';
    this.roleGuideClose.setPosition(width / 2 - 14, 16).setFontSize(closeLabel === 'ESC' ? 6 : 9)
      .setText(closeLabel).setVisible(this.roleGuideVisible);
    if (this.encounterLeft !== e.left) {
      this.encounterLeft = e.left;
      this.encounterTitle.setScale(1.1);
      this.tweens.add({ targets: this.encounterTitle, scale: 1, duration: 180, ease: 'back.out' });
    }
  }

  drawRecap(cb, now, W, H, small) {
    const r = cb.combatRecap;
    const targetAlive = !!cb.target?.alive;
    const blocked = cb.inCombat || cb.death;
    const hidden = !r || now >= r.showUntil;
    this.reportButton.setPosition(W / 2, targetAlive ? (small ? 194 : 92) : (small ? 102 : 34)).setVisible(hidden && !blocked && cb.combatHistory.length > 0);
    if (hidden || cb.inCombat || cb.death) { this.recap.setVisible(false); return; }
    const w = Math.min(W - 20, small ? 316 : 390), h = small ? 104 : 100;
    const left = Math.max(0, r.showUntil - now), alpha = Phaser.Math.Clamp(left / 500, 0, 1);
    const y = cb.target?.alive ? (small ? 200 : 100) : (small ? 108 : 40);
    this.recap.setPosition(W / 2, y).setVisible(true).setAlpha(alpha);
    this.recapG.clear();
    this.recapG.fillStyle(0x08131c, 0.94).fillRoundedRect(-w / 2, 0, w, h, 5);
    this.recapG.lineStyle(1, r.result === 'DEFEAT' ? 0xff6a6a : 0x14f195, 1).strokeRoundedRect(-w / 2 + 0.5, 0.5, w - 1, h - 1, 5);
    const page = `${cb.combatRecapIndex + 1}/${cb.combatHistory.length}`;
    this.recapTitle.setPosition(0, 7).setText(`${r.result === 'DEFEAT' ? 'DEFEAT' : 'COMBAT'} REPORT ${page} · ${r.duration.toFixed(1)}s`)
      .setColor(r.result === 'DEFEAT' ? '#ff8a8a' : '#7dffcf');
    this.recapMain.setPosition(0, 26).setText(`${r.damage} DMG · ${r.dps} DPS · ${r.kills} KILLS · BEST ${r.bestHit}`);
    this.recapSub.setPosition(0, 45).setText(`TAKEN ${r.damageTaken} · PARRY ${r.parries} · EVADE ${r.perfectDodges} · COMBO ${r.bestCombo}`);
    this.recapExtra.setPosition(0, 63).setText(`CRIT ${r.crits} · REACT ${r.reactions} · BREAK ${r.guardBreaks} · INT ${r.interrupts || 0}`);
    const m = r.mastery;
    const masteryText = !m ? 'TAP TO CYCLE REPORTS' : !m.eligible ? `MASTERY · DEFEAT 2+ FOES · TAP TO CYCLE` : m.complete ? `MASTERY COMPLETE · ${m.label} ${m.value}/${m.target} · +12 ${cb.classResource.name}` : `MASTERY · ${m.label} ${Math.min(m.value, m.target)}/${m.target} · TAP TO CYCLE`;
    this.recapGoal.setPosition(0, 81).setText(masteryText).setColor(m?.complete ? '#7dffcf' : '#ffcf72');
    this.recapHit.setPosition(0, h / 2).setSize(w, h);
    this.recapClose.setPosition(w / 2 - 12, 12);
  }

  drawTarget(w, cb, p, W, small) {
    const t = cb.target;
    if (!t || !t.alive) { this.tf.setVisible(false); return; }
    const boss = w.areas?.boss;
    const bossBar = boss && boss.active && boss.hp > 0;
    const training = t.isTrainingDummy ? w.trainingSnapshot?.() : null;
    const guarded = t.guardMax > 0;
    const fw = small ? 184 : 220, fh = guarded ? 50 : 42;
    const x = Math.round(W / 2 - fw / 2);
    const y = small ? (bossBar ? 146 : 144) : (bossBar ? 80 : 42);
    this.tf.setPosition(x, y).setVisible(true);
    const c = t.con(p.level);
    const g = this.tfG;
    g.clear();
    g.fillStyle(0x1a1024, 0.92).fillRoundedRect(0, 0, fw, fh, 4);
    g.lineStyle(1, training ? 0x5fe7ff : t.encounterTint || t.affix?.color || (t.rank !== RANKS.normal ? t.rank.tint : 0x8d5a2b), 1).strokeRoundedRect(0.5, 0.5, fw - 1, fh - 1, 4);
    // level badge in con colour
    g.fillStyle(c.tint, 1).fillRoundedRect(4, 4, 20, 12, 2);
    const frac = Phaser.Math.Clamp(t.hp / t.maxHp, 0, 1);
    const bx = 6, by = 20, bw = fw - 12, bh = 9;
    g.fillStyle(0x000000, 1).fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    g.fillStyle(0x3a1014, 1).fillRect(bx, by, bw, bh);
    g.fillStyle(frac > 0.5 ? 0x4cc060 : frac > 0.25 ? 0xf39c12 : 0xe74c3c, 1).fillRect(bx, by, bw * frac, bh);
    if (guarded) {
      const gf = Phaser.Math.Clamp(t.guard / Math.max(1, t.guardMax), 0, 1);
      const gy = 33;
      g.fillStyle(0x07111f, 1).fillRect(bx, gy, bw, 5);
      if (gf > 0) g.fillStyle(t.guardBroken ? 0xffd35a : 0x59c8ff, 1).fillRect(bx, gy, bw * gf, 5);
      g.lineStyle(1, t.guardBroken ? 0xffd35a : 0x8de4ff, 0.8).strokeRect(bx - 0.5, gy - 0.5, bw + 1, 6);
    }
    // statuses on the target
    const list = t.statuses.list(w.time.now);
    list.forEach((s, i) => { g.fillStyle(STATUS[s.id].color, 1).fillRect(fw - 10 - i * 8, 6, 6, 6); });
    this.tfName.setPosition(28, 4).setText(t.displayName).setColor(c.color);
    g.fillStyle(0x000000, 0); // badge number drawn as text overlay
    if (!this.tfLv) { this.tfLv = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '8px', color: '#1a1024' }).setOrigin(0.5); this.tf.add(this.tfLv); }
    this.tfLv.setPosition(14, 10).setText(String(t.level));
    const role = t.isSquadCaptain ? '[C]' : ({ vanguard: '[V]', flanker: '[F]', support: '[S]' }[t.squadRole] || '');
    const rank = t.affix ? t.affix.name.toUpperCase() : t.rank !== RANKS.normal ? t.rank.id.toUpperCase() : '';
    this.tfRank.setPosition(fw - 8 - list.length * 8, 4).setText(training ? 'TRAINING' : t.isBoss ? `PHASE ${t.phase || 1}` : [role, rank].filter(Boolean).join(' '))
      .setColor(training ? '#5fe7ff' : t.encounterTint ? `#${t.encounterTint.toString(16).padStart(6, '0')}` : t.isBoss ? '#ff6a6a' : (t.affix?.color || t.rank.tint) ? `#${(t.affix?.color || t.rank.tint).toString(16).padStart(6, '0')}` : '#fff');
    this.tfHp.setPosition(fw / 2, by + bh / 2).setText(training ? `${training.hits} HITS · ${training.total} DMG` : `${Math.max(0, Math.ceil(t.hp))} / ${t.maxHp}`);
    const dist = Math.round(Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y));
    const protector = cb.vanguardProtector?.(t, w.time.now);
    let st = t.mode === 'return' ? 'EVADING' : t.mode === 'flee' ? 'FLEEING' : `${dist}px`;
    if (t.channelingSupport) {
      const left = Math.max(0, t.stateUntil - w.time.now);
      st = `INTERRUPT ${Math.ceil(left / 100) / 10}s`;
      g.fillStyle(0x72cfff, 0.94).fillRect(6, guarded ? 42 : 34, (fw - 12) * Phaser.Math.Clamp(1 - left / 1200, 0, 1), 4);
    } else if (t.windingUp) {
      const left = Math.max(0, t.stateUntil - w.time.now);
      const pincer = t.attackKind === 'pincer';
      st = left <= 220 ? `DODGE ${Math.ceil(left / 100) / 10}s` : `${pincer ? 'PINCER' : 'ATTACK'} ${Math.ceil(left / 100) / 10}s`;
      g.fillStyle(left <= 220 ? 0xff4a4a : pincer ? 0xd08cff : 0xffb04a, 0.92).fillRect(6, guarded ? 42 : 34, (fw - 12) * Phaser.Math.Clamp(1 - left / Math.max(1, t.attackWind || t.pat?.wind || 1), 0, 1), 4);
    }
    if (!t.channelingSupport && !t.windingUp && protector) st = 'VANGUARD COVER';
    if (t.isBoss && t.engaged) {
      const left = Math.max(0, t.enrageAt - w.time.now);
      st = left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : 'BERSERK';
    }
    if (t.guardBroken) st = 'BROKEN · +25%';
    if (training) st = `${training.dps} DPS · BEST ${training.best}`;
    this.tfState.setPosition(fw - 8, by + bh / 2).setText(st).setColor(st === 'BERSERK' || st.startsWith('DODGE') ? '#ff6a6a' : st.startsWith('INTERRUPT') || st.startsWith('VANGUARD') ? '#72cfff' : st.startsWith('PINCER') ? '#d8a8ff' : st.startsWith('ATTACK') ? '#ffcf72' : '#c8c8c8');
  }

  drawBuffs(cb, p, now, small) {
    const items = [];
    for (const s of cb.statuses.list(now)) {
      const d = STATUS[s.id];
      items.push({ color: d.color, glyph: { poison: 'P', burn: 'B', bleed: 'b', slow: 'S', stun: '*' }[s.id], left: s.left, frac: s.frac, debuff: true });
    }
    if (p.buff && now < p.buff.until) {
      const left = p.buff.until - now;
      if (p.buff.atkMul && p.buff.atkMul !== 1) items.push({ color: 0xe0543a, glyph: 'A', left, frac: Math.min(1, left / 8000) });
      if (p.buff.spdMul && p.buff.spdMul !== 1) items.push({ color: 0x3ac0e0, glyph: '>', left, frac: Math.min(1, left / 8000) });
    }
    if (!cb.rolling && now < p.invulnUntil - 450 && p.invulnUntil - now < 60000 && !p.dead) items.push({ color: 0x5aa0ff, glyph: 'W', left: p.invulnUntil - now, frac: 1 });
    if (!cb.inCombat && !p.dead && (p.hp < p.effMaxHp() || p.mp < p.effMaxMp())) items.push({ color: 0x4cc060, glyph: '+', left: 0, frac: 1 });
    const x0 = 10, y0 = small ? 168 : 146;
    for (let i = 0; i < MAX_BUFFS; i++) {
      const b = this.buffs[i], it = items[i];
      if (!it) { b.c.setVisible(false); continue; }
      b.c.setVisible(true).setPosition(x0 + 11 + i * 26, y0 + 11);
      const g = b.g;
      g.clear();
      g.fillStyle(0x1a1024, 0.95).fillRect(-12, -12, 24, 24);
      g.fillStyle(it.color, 0.9).fillRect(-10, -10, 20, 20);
      g.fillStyle(0x000000, 0.5).fillRect(-10, -10, 20, 20 * (1 - it.frac)); // drains top-down
      g.lineStyle(2, it.debuff ? 0xff4a4a : 0xffe8a0, 1).strokeRect(-11, -11, 22, 22);
      b.glyph.setText(it.glyph);
      b.secs.setText(it.left > 0 ? `${Math.ceil(it.left / 1000)}` : '');
    }
  }

  drawClassResource(cb, p, now, W, H, small) {
    const r = cb.classResource;
    if (!r) { this.resourceG.clear(); this.resourceT.setVisible(false); this.parryT.setVisible(false); return; }
    const bw = small ? 146 : 190, bh = 8;
    const x = W / 2, y = H - (small ? 112 : 128);
    const frac = Phaser.Math.Clamp(r.value / Math.max(1, r.max), 0, 1);
    const color = { wayfarer: 0xffd84a, ranger: 0x7dff9a, arcanist: 0x9945ff, bandit: 0xdc1fff }[p.job.id] || 0x14f195;
    const pulse = frac >= 1 ? 0.72 + Math.sin(now / 120) * 0.25 : 0.9;
    const g = this.resourceG; g.clear();
    g.fillStyle(0x0a0e1a, 0.9).fillRoundedRect(x - bw / 2 - 3, y - 3, bw + 6, bh + 6, 3);
    g.fillStyle(0x26324a, 1).fillRect(x - bw / 2, y, bw, bh);
    if (frac > 0) g.fillStyle(color, pulse).fillRect(x - bw / 2, y, bw * frac, bh);
    g.lineStyle(frac >= 1 ? 2 : 1, frac >= 1 ? 0xffffff : color, pulse).strokeRoundedRect(x - bw / 2 - 3, y - 3, bw + 6, bh + 6, 3);
    this.resourceT.setVisible(true).setPosition(x, y - 4)
      .setText(frac >= 1 ? `${r.name.toUpperCase()} READY · ${input.labelFor('ultimate')}` : `${r.name.toUpperCase()} ${Math.floor(r.value)}%`)
      .setColor(frac >= 1 ? '#ffffff' : '#e1e8f0');
    const parryLeft = Math.max(0, cb.parryReadyAt - now);
    this.parryT.setVisible(true).setPosition(x, y + bh + 5)
      .setText(parryLeft > 0 ? `PARRY ${Math.ceil(parryLeft / 100) / 10}s` : `PARRY READY · ${input.labelFor('parry')}`)
      .setColor(parryLeft > 0 ? '#6b7a99' : '#7dffcf');
    this.resourceHit.setPosition(x, y - 4).setSize(bw + 12, 24);
    this.parryHit.setPosition(x, y + bh + 10).setSize(Math.min(150, bw), 18);
  }

  drawDamageCue(cb, now, W, H, small) {
    const g = this.damageCueG; g.clear();
    const cue = cb.lastHitCue;
    if (!cue) return;
    const age = now - cue.at;
    if (age < 0 || age > 900) return;
    const fade = settings.get('reduceMotion') ? 0.72 : Phaser.Math.Clamp(1 - age / 900, 0, 1);
    const r = Math.max(48, Math.min(W, H) * (small ? 0.29 : 0.34));
    const cx = W / 2, cy = H / 2;
    const ca = Math.cos(cue.angle), sa = Math.sin(cue.angle);
    const px = cx + ca * r, py = cy + sa * r;
    const tipX = px + ca * 8, tipY = py + sa * 8;
    const backX = px - ca * 8, backY = py - sa * 8;
    const nx = -sa * (cue.heavy ? 8 : 6), ny = ca * (cue.heavy ? 8 : 6);
    g.fillStyle(cue.heavy ? 0xff3b4f : 0xff6b5f, fade * 0.9)
      .fillTriangle(tipX, tipY, backX + nx, backY + ny, backX - nx, backY - ny);
    g.lineStyle(cue.heavy ? 3 : 2, 0xffffff, fade * 0.85)
      .lineBetween(backX + nx, backY + ny, tipX, tipY)
      .lineBetween(tipX, tipY, backX - nx, backY - ny);
  }
}
