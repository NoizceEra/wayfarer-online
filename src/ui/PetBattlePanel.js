import { MOVES, baseFor } from '../data/pets.js';
import { PetBattle } from '../systems/petBattle.js';
import { audio } from '../systems/audio.js';
import { input } from '../core/input.js';

const FONT = '"Silkscreen", monospace';
const T = (size, color, extra = {}) => ({ fontFamily: FONT, fontSize: `${size}px`, color, ...extra });
const TYPE_COLORS = {
  fire: '#ff7040', water: '#44aadd', nature: '#66bb44', earth: '#c8a06a',
  wind: '#9bd0ff', dark: '#a060c0',
};

export class PetBattlePanel {
  // hooks: { onClose(battle), playerTeam, opponentTeam, isPvp?, net? }
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.isOpen = false;
    this.battle = null;
    this.c = null;
    this.petSprites = {};
    this.hpBars = {};
    this.hpTexts = {};
    this.moveBtns = [];
    this.busy = false;
    this.queue = [];
    this.small = scene.scale.width / scene.scale.height < 1.0 || scene.scale.width < 560;
  }

  open(playerTeam, opponentTeam, options = {}) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.opts = options;
    input.pushModal('petBattle');
    this.battle = new PetBattle(this.scene, playerTeam, opponentTeam, {
      seed: options.seed,
      isPvp: options.isPvp,
      net: options.net,
      rewardScale: options.rewardScale ?? 1,
      onEvent: (ev) => this._onEvent(ev),
      onReward: (r) => this._onReward(r),
    });
    this.build();
    audio.play('ui', 0.5);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    input.popModal('petBattle');
    this.battle?.destroy();
    this.battle = null;
    this.c?.destroy();
    this.c = null;
    this.petSprites = {};
    this.hpBars = {};
    this.hpTexts = {};
    this.moveBtns = [];
    this.queue = [];
    this.hooks.onClose?.(this);
  }

  build() {
    const s = this.scene;
    this.c?.destroy();
    const { w: W, h: H } = s.view();
    const c = this.c = s.add.container(0, 0).setDepth(220);
    this.dim = s.add.rectangle(0, 0, W * 2, H * 2, 0x1a1024, 0.94).setOrigin(0).setInteractive();
    c.add(this.dim);

    const pw = Math.min(W - 16, 720);
    const ph = Math.min(H - 16, 460);
    const ox = (W - pw) / 2;
    const oy = (H - ph) / 2;

    // pixel border panel
    const panel = s.add.rectangle(ox, oy, pw, ph, 0x2a1d10, 0.98).setOrigin(0);
    const frame = s.add.graphics();
    frame.lineStyle(4, 0x8a5a2b, 1).strokeRect(ox + 2, oy + 2, pw - 4, ph - 4);
    frame.lineStyle(2, 0xd8b070, 1).strokeRect(ox + 6, oy + 6, pw - 12, ph - 12);
    c.add([panel, frame]);

    // title
    c.add(s.add.text(ox + pw / 2, oy + 18, 'PET BATTLE', T(16, '#ffe07a', { fontStyle: 'bold' })).setOrigin(0.5));
    this.logT = s.add.text(ox + 12, oy + ph - 46, '', T(9, '#d8c8a8', { wordWrap: { width: pw - 24 } })).setOrigin(0, 0);
    c.add(this.logT);

    // arena layout
    const arenaTop = oy + 46;
    const arenaH = ph - 110;
    const pad = 18;
    this.playerX = ox + pad + 48;
    this.opponentX = ox + pw - pad - 48;
    this.arenaY = arenaTop + arenaH / 2;

    this._buildPet('player', this.playerX, this.arenaY + 18, true);
    this._buildPet('opponent', this.opponentX, this.arenaY - 18, false);

    // controls
    this._buildControls(ox, oy, pw, ph);

    this.refresh();
  }

  _buildPet(side, x, y, isPlayer) {
    const s = this.scene;
    const pet = this.battle.active(side);
    if (!pet) return;
    const def = baseFor(pet.id);

    const baseY = isPlayer ? y + 40 : y - 40;
    const platform = s.add.ellipse(x, baseY + 36, 80, 20, 0x000000, 0.35);
    this.c.add(platform);

    let sprite = null;
    // PETS[*].sprite already carries its full texture key (e.g. 'mon.Mouse'), so
    // resolve it as-is and only fall back to the 'mon.' prefix when the raw value
    // does not resolve. Re-prefixing unconditionally produced 'mon.mon.Mouse',
    // which made the texture check fail and every pet battle render no sprite.
    const key = s.textures.exists(def.sprite) ? def.sprite : `mon.${def.sprite}`;
    if (s.textures.exists(key)) {
      sprite = s.add.sprite(x, baseY, key).setScale(3);
      sprite.setFlipX(!isPlayer);
      try { sprite.anims.play(`${key}.idle.down`, true); } catch {}
    } else {
      sprite = s.add.rectangle(x, baseY, 48, 48, def.tint || 0xffffff).setStrokeStyle(2, 0x000000);
    }
    this.c.add(sprite);
    this.petSprites[side] = sprite;

    // name + level
    const nameCol = isPlayer ? '#9be88a' : '#ff9a8a';
    this.c.add(s.add.text(x, baseY - 46, `${pet.name} Lv${pet.level}`, T(10, nameCol, { fontStyle: 'bold' })).setOrigin(0.5));
    const badge = s.add.text(x + (isPlayer ? -40 : 40), baseY - 62, (def.type || 'nature').toUpperCase(), T(7, '#1a1024', { backgroundColor: TYPE_COLORS[def.type] || '#999', padding: { x: 3, y: 1 } })).setOrigin(0.5);
    this.c.add(badge);

    // HP bar
    const barW = 96;
    const barH = 10;
    const barX = x - barW / 2;
    const barY = baseY - 32;
    this.c.add(s.add.rectangle(barX - 1, barY - 1, barW + 2, barH + 2, 0x000000, 1).setOrigin(0));
    this.c.add(s.add.rectangle(barX, barY, barW, barH, 0x3a1014, 1).setOrigin(0));
    const fill = s.add.rectangle(barX, barY, barW, barH, 0x4cc060, 1).setOrigin(0);
    this.c.add(fill);
    const hpT = s.add.text(x, barY + barH / 2, '', T(8, '#ffffff', { stroke: '#1a1024', strokeThickness: 2 })).setOrigin(0.5);
    this.c.add(hpT);

    this.hpBars[side] = { fill, barW, barH, barX, barY };
    this.hpTexts[side] = hpT;
  }

  _buildControls(ox, oy, pw, ph) {
    const s = this.scene;
    this.moveBtns = [];
    const pet = this.battle.active('player');
    const moves = pet?.moves?.map((id) => MOVES[id]).filter(Boolean) || [];

    const rowY = oy + ph - 100;
    const colW = 112;
    const startX = ox + pw / 2 - (moves.length * colW) / 2 + colW / 2;

    moves.forEach((m, i) => {
      const x = startX + i * colW;
      const btn = this._makeBtn(x, rowY, colW - 8, 34, m.name, TYPE_COLORS[m.type] || '#b9b9b9', () => this._act({ action: 'move', moveId: m.id, targetSide: 'opponent', targetSlot: this.battle.active('opponent').slot }));
      this.moveBtns.push(btn);
      this.c.add(btn.parts);
    });

    // secondary row: switch / item / flee
    const secY = rowY + 44;
    const secW = 86;
    const secStart = ox + pw / 2 - (3 * secW) / 2 + secW / 2;
    const mkSec = (i, label, col, cb) => {
      const btn = this._makeBtn(secStart + i * secW, secY, secW - 8, 28, label, col, cb);
      this.c.add(btn.parts);
      return btn;
    };
    mkSec(0, 'SWITCH', '#ffe07a', () => this._openSwitch());
    mkSec(1, 'ITEM', '#7bd84a', () => this._act({ action: 'item', targetSide: 'player', targetSlot: this.battle.active('player').slot, itemId: 'potion' }));
    mkSec(2, 'FLEE', '#ff7a6a', () => this._act({ action: 'flee' }));

    // close X (desktop)
    const x = s.add.text(ox + pw - 18, oy + 14, 'X', T(12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 6, y: 2 } })).setOrigin(0.5).setDepth(221).setInteractive({ useHandCursor: true });
    x.on('pointerdown', () => { audio.play('ui', 0.5); this.close(); });
    this.c.add(x);
  }

  _makeBtn(x, y, w, h, label, color, cb) {
    const s = this.scene;
    const r = s.add.rectangle(x, y, w, h, 0x1a1510, 0.95).setStrokeStyle(2, color).setInteractive({ useHandCursor: true }).setDepth(221);
    const t = s.add.text(x, y, label, T(9, color, { fontStyle: 'bold' })).setOrigin(0.5).setDepth(222);
    const hover = () => { r.setFillStyle(0x2a2520); audio.play('ui', 0.35); };
    const out = () => r.setFillStyle(0x1a1510);
    r.on('pointerover', hover);
    r.on('pointerout', out);
    r.on('pointerdown', () => { r.setFillStyle(0x0f0b08); cb(); });
    r.on('pointerup', () => r.setFillStyle(0x2a2520));
    return { parts: [r, t], disable: (d) => { r.setInteractive(!d); t.setAlpha(d ? 0.4 : 1); } };
  }

  _openSwitch() {
    if (this.busy) return;
    const s = this.scene;
    const { w: W, h: H } = s.view();
    if (this.switchMenu) { this.switchMenu.destroy(); this.switchMenu = null; return; }
    const alive = this.battle.alive('player');
    const c = this.switchMenu = s.add.container(W / 2, H / 2).setDepth(223);
    const pw = 180;
    const ph = 24 + alive.length * 30;
    const bg = s.add.rectangle(0, 0, pw, ph, 0x1a1024, 0.98).setStrokeStyle(2, 0x8a5a2b);
    c.add(bg);
    c.add(s.add.text(0, -ph / 2 + 12, 'SWITCH PET', T(10, '#ffe07a', { fontStyle: 'bold' })).setOrigin(0.5));
    alive.forEach((p, i) => {
      const y = -ph / 2 + 34 + i * 28;
      const r = s.add.rectangle(0, y, pw - 12, 24, 0x2a1d10).setInteractive({ useHandCursor: true });
      const t = s.add.text(0, y, `${p.name} Lv${p.level} ${Math.ceil(p.hp)}/${p.stats.hp}`, T(9, p.slot === this.battle.active('player')?.slot ? '#6b7a6a' : '#e6f2c0')).setOrigin(0.5);
      r.on('pointerover', () => r.setFillStyle(0x3a2d20));
      r.on('pointerout', () => r.setFillStyle(0x2a1d10));
      r.on('pointerdown', () => {
        audio.play('ui', 0.5);
        this.switchMenu?.destroy();
        this.switchMenu = null;
        this._act({ action: 'switch', switchId: p.slot });
      });
      c.add([r, t]);
    });
  }

  _act(cmd) {
    if (this.busy || this.battle.phase !== 'input') return;
    this._setBusy(true);
    const ok = this.battle.queueCommand(cmd);
    if (!ok) this._setBusy(false);
  }

  _setBusy(v) {
    this.busy = v;
    for (const b of this.moveBtns) b.disable(v);
  }

  // ── event handling + animations ───────────────────────────────────────────

  _onEvent(ev) {
    this.queue.push(ev);
    if (this.queue.length === 1) this._processQueue();
  }

  _processQueue() {
    if (!this.queue.length) {
      this._setBusy(false);
      if (this.battle.winner) this.scene.time.delayedCall(1400, () => this.close());
      return;
    }
    const ev = this.queue.shift();
    this._playEvent(ev, () => this._processQueue());
  }

  _playEvent(ev, done) {
    switch (ev.type) {
      case 'move': this._animMove(ev, done); break;
      case 'heal': this._animHeal(ev, done); break;
      case 'buff':
      case 'debuff': this._animBuff(ev, done); break;
      case 'miss': this._animMiss(ev, done); break;
      case 'item': this._animHeal(ev, done); break;
      case 'switch': this._animSwitch(ev, done); break;
      case 'faint': this._animFaint(ev, done); break;
      case 'flee': this._log(ev.success ? 'Got away safely!' : 'Couldn\'t escape!'); done(); break;
      case 'win': this._log(`You won! ${Object.values(ev.rewards.xpMap).map((r) => `${r.id} +${r.xp} XP`).join(', ')}`); done(); break;
      case 'lose': this._log('Your pet fainted…'); done(); break;
      default: done();
    }
  }

  _animMove(ev, done) {
    const src = this.petSprites[ev.side];
    const dst = this.petSprites[ev.targetSide];
    if (!src || !dst) { this.refresh(); done(); return; }
    const startX = src.x;
    const startY = src.y;
    const isPlayer = ev.side === 'player';
    const lungeX = startX + (isPlayer ? 28 : -28);
    this._log(`${this.battle.active(ev.side).name} used ${MOVES[ev.moveId]?.name || ev.moveId}!`);
    audio.play('swing', 0.7);

    this.scene.tweens.add({
      targets: src,
      x: lungeX,
      y: startY - 6,
      duration: 150,
      yoyo: true,
      onComplete: () => {
        audio.play(ev.crit ? 'slam' : 'hit', 0.8);
        this._floatingNumber(dst.x, dst.y - 30, ev.damage, ev.crit ? '#ffee55' : '#ffffff', ev.crit);
        this._shake(dst);
        if (ev.effect) this._playEvent(ev.effect, () => {});
        this.refresh();
        if (ev.fainted) {
          this.scene.time.delayedCall(300, () => this._playEvent({ type: 'faint', side: ev.targetSide, slot: ev.targetSlot }, done));
        } else {
          done();
        }
      },
    });
  }

  _animHeal(ev, done) {
    const sprite = this.petSprites[ev.side];
    if (sprite) {
      this.scene.tweens.add({ targets: sprite, alpha: 0.7, duration: 120, yoyo: true });
      this._floatingNumber(sprite.x, sprite.y - 50, `+${ev.amount}`, '#7dff9a', false);
    }
    this._log(`${this.battle.active(ev.side).name} recovered ${ev.amount} HP!`);
    audio.play('heal', 0.7);
    this.refresh();
    done();
  }

  _animBuff(ev, done) {
    const sprite = this.petSprites[ev.side];
    const word = ev.type === 'buff' ? `${ev.stat.toUpperCase()} ↑` : `${ev.stat.toUpperCase()} ↓`;
    if (sprite) this._floatingNumber(sprite.x, sprite.y - 60, word, ev.type === 'buff' ? '#7bd84a' : '#ff7a6a', false);
    this._log(`${this.battle.active(ev.side).name} ${ev.type === 'buff' ? 'raised' : 'lowered'} ${ev.stat}!`);
    audio.play('cast', 0.5);
    this.refresh();
    done();
  }

  _animMiss(ev, done) {
    const dst = this.petSprites[ev.targetSide];
    if (dst) this._floatingNumber(dst.x, dst.y - 40, 'MISS', '#a0a0a0', false);
    this._log('It missed!');
    audio.play('error', 0.4);
    done();
  }

  _animSwitch(ev, done) {
    this._log(`Switched to ${ev.name}!`);
    audio.play('ui', 0.5);
    this._rebuildSprites();
    this.refresh();
    done();
  }

  _animFaint(ev, done) {
    const sprite = this.petSprites[ev.side];
    if (sprite) {
      audio.play('monsterDie', 0.8);
      this.scene.tweens.add({
        targets: sprite,
        alpha: 0,
        angle: ev.side === 'player' ? -25 : 25,
        y: sprite.y + 12,
        duration: 450,
        onComplete: () => {
          this._rebuildSprites();
          this.refresh();
          done();
        },
      });
    } else { done(); }
  }

  // ── visual helpers ───────────────────────────────────────────────────

  _shake(obj) {
    if (!obj) return;
    this.scene.tweens.add({ targets: obj, x: obj.x + 5, duration: 40, yoyo: true, repeat: 3 });
  }

  _floatingNumber(x, y, text, color, big) {
    const s = this.scene;
    const t = s.add.text(x, y, String(text), T(big ? 13 : 10, color, { fontStyle: 'bold', stroke: '#1a1024', strokeThickness: 3 })).setOrigin(0.5).setDepth(225);
    this.c.add(t);
    s.tweens.add({
      targets: t,
      y: y - 32,
      alpha: 0,
      duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  _log(text) {
    this.logT?.setText(text);
  }

  _rebuildSprites() {
    if (!this.c) return;
    for (const k of Object.keys(this.petSprites)) this.petSprites[k]?.destroy();
    this.hpBars = {};
    this.hpTexts = {};
    this._buildPet('player', this.playerX, this.arenaY + 18, true);
    this._buildPet('opponent', this.opponentX, this.arenaY - 18, false);
  }

  refresh() {
    if (!this.battle) return;
    for (const side of ['player', 'opponent']) {
      const pet = this.battle.active(side);
      const bar = this.hpBars[side];
      const txt = this.hpTexts[side];
      if (!pet || !bar || !txt) continue;
      const frac = Math.max(0, pet.hp / Math.max(1, pet.stats.hp));
      bar.fill.setDisplaySize(Math.max(frac ? 1 : 0, bar.barW * frac), bar.barH);
      bar.fill.setFillStyle(frac > 0.35 ? 0x4cc060 : 0xe74c3c);
      txt.setText(`${Math.ceil(pet.hp)}/${pet.stats.hp}`);
    }
  }

  _onReward(rewards) {
    for (const r of Object.values(rewards.xpMap || {})) {
      const res = this.battle.addXp(r.slot, r.xp);
      if (res.leveled) {
        this.scene.time.delayedCall(800, () => {
          audio.play('level', 0.8);
          this._log(`${r.id} grew to level ${res.newLevel}!`);
          this.refresh();
        });
      }
    }
  }
}
