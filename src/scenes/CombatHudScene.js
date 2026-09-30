import Phaser from 'phaser';
import { STATUS, RANKS } from '../data/combatMath.js';

const FONT = '"Silkscreen", monospace';
const MAX_BUFFS = 8;

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
    // — death overlay —
    this.deathBg = this.add.rectangle(0, 0, 10, 10, 0x0a0614, 0).setOrigin(0).setDepth(20);
    this.deathT = this.add.text(0, 0, 'YOU HAVE FALLEN', F(20, '#e8d8ff', { strokeThickness: 5 })).setOrigin(0.5).setDepth(21).setVisible(false);
    this.deathSub = this.add.text(0, 0, '', F(10, '#c8b8e8', { align: 'center' })).setOrigin(0.5).setDepth(21).setVisible(false);
  }

  world() { const w = this.scene.get('world'); return w && w.sys.isActive() && w.combat ? w : null; }

  update() {
    const w = this.world();
    const { width: W, height: H } = this.scale;
    const small = W < 560;
    if (!w) { this.tf.setVisible(false); return; }
    const cb = w.combat, p = w.player, now = w.time.now;
    this.drawTarget(w, cb, p, W, small);
    this.drawBuffs(cb, p, now, small);
    // combo
    const n = cb.combo.n;
    if (n >= 2) {
      const bump = Math.max(0, 1 - (now - cb.combo.bumpAt) / 140);
      const x = W - 14, y = small ? H * 0.42 : H * 0.36;
      this.comboT.setText(`${n} HITS`).setPosition(x, y).setScale(1 + 0.35 * bump).setVisible(true)
        .setColor(n >= 20 ? '#ff6a4a' : n >= 10 ? '#ffb04a' : '#ffe14a')
        .setAlpha(Phaser.Math.Clamp((cb.combo.until - now) / 600, 0.25, 1));
      this.comboSub.setPosition(x, y + 15).setVisible(true).setAlpha(this.comboT.alpha);
    } else { this.comboT.setVisible(false); this.comboSub.setVisible(false); }
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

  drawTarget(w, cb, p, W, small) {
    const t = cb.target;
    if (!t || !t.alive) { this.tf.setVisible(false); return; }
    const boss = w.areas?.boss;
    const bossBar = boss && boss.active && boss.hp > 0;
    const fw = small ? 170 : 200, fh = 34;
    const x = Math.round(W / 2 - fw / 2);
    const y = small ? (bossBar ? 146 : 144) : (bossBar ? 80 : 42);
    this.tf.setPosition(x, y).setVisible(true);
    const c = t.con(p.level);
    const g = this.tfG;
    g.clear();
    g.fillStyle(0x1a1024, 0.92).fillRoundedRect(0, 0, fw, fh, 4);
    g.lineStyle(1, t.rank !== RANKS.normal ? t.rank.tint : 0x8d5a2b, 1).strokeRoundedRect(0.5, 0.5, fw - 1, fh - 1, 4);
    // level badge in con colour
    g.fillStyle(c.tint, 1).fillRoundedRect(4, 4, 20, 12, 2);
    const frac = Phaser.Math.Clamp(t.hp / t.maxHp, 0, 1);
    const bx = 6, by = 20, bw = fw - 12, bh = 9;
    g.fillStyle(0x000000, 1).fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    g.fillStyle(0x3a1014, 1).fillRect(bx, by, bw, bh);
    g.fillStyle(frac > 0.5 ? 0x4cc060 : frac > 0.25 ? 0xf39c12 : 0xe74c3c, 1).fillRect(bx, by, bw * frac, bh);
    // statuses on the target
    const list = t.statuses.list(w.time.now);
    list.forEach((s, i) => { g.fillStyle(STATUS[s.id].color, 1).fillRect(fw - 10 - i * 8, 6, 6, 6); });
    this.tfName.setPosition(28, 4).setText(t.displayName).setColor(c.color);
    g.fillStyle(0x000000, 0); // badge number drawn as text overlay
    if (!this.tfLv) { this.tfLv = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '8px', color: '#1a1024' }).setOrigin(0.5); this.tf.add(this.tfLv); }
    this.tfLv.setPosition(14, 10).setText(String(t.level));
    this.tfRank.setPosition(fw - 8 - list.length * 8, 4).setText(t.isBoss ? 'BOSS' : t.rank !== RANKS.normal ? t.rank.id.toUpperCase() : '')
      .setColor(t.isBoss ? '#ff6a6a' : t.rank.tint ? `#${t.rank.tint.toString(16).padStart(6, '0')}` : '#fff');
    this.tfHp.setPosition(fw / 2, by + bh / 2).setText(`${Math.max(0, Math.ceil(t.hp))} / ${t.maxHp}`);
    let st = t.mode === 'return' ? 'EVADING' : t.mode === 'flee' ? 'FLEEING' : '';
    if (t.isBoss && t.engaged) {
      const left = Math.max(0, t.enrageAt - w.time.now);
      st = left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : 'BERSERK';
    }
    this.tfState.setPosition(fw - 8, by + bh / 2).setText(st).setColor(st === 'BERSERK' ? '#ff5a5a' : '#c8c8c8');
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
}
