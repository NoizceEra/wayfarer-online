import { bus, Events } from '../core/events.js';
import { econ } from '../net/economyNet.js';

// RevivePanel — shown when the hero dies. Offers a premium revive for tokens
// (no gold/xp loss, instant respawn) or a normal respawn (5% gold loss).
// The panel is created by reviveSystem.js and driven by the Events.PLAYER_DIED
// / Events.REVIVE_OFFER bus events.
export class RevivePanel {
  constructor(scene) {
    this.scene = scene;
    this.c = null;
    this.destroyed = false;
    // Opening the offer is driven by reviveSystem.js (single owner of the
    // death flow). This panel only renders and requests the spend once.
    this.offHp = bus.on(Events.PLAYER_HP, () => { if (!this._isDead()) this.destroy(); });
    scene.events.once('shutdown', () => this.destroy());
  }

  _isDead() {
    const p = this.scene.player;
    return !!p?.dead;
  }

  show() {
    if (!this._isDead() || this.c) return;
    const s = this.scene;
    const { w: W, h: H } = s.view();
    const c = this.c = s.add.container(W / 2, H / 2).setDepth(3000).setScrollFactor(0);

    const pw = Math.min(W - 24, 320), ph = 150;
    const panel = s.add.rectangle(0, 0, pw, ph, 0x0a0e1a, 0.97).setStrokeStyle(2, 0x14f195);
    c.add(panel);

    const title = s.add.text(0, -ph / 2 + 22, 'YOU HAVE FALLEN', {
      fontFamily: '"Silkscreen", monospace', fontSize: '13px', color: '#14f195', fontStyle: 'bold',
    }).setOrigin(0.5);
    c.add(title);

    const cost = 25;
    const tokens = s.player?.wayfarerTokens ?? 0;
    const canPay = tokens >= cost;

    const sub = s.add.text(0, -12, `Premium revive: ${cost} Wayfarer Tokens\n(You have ${tokens})`, {
      fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#e1e8f0', align: 'center', lineSpacing: 5,
    }).setOrigin(0.5);
    c.add(sub);

    const mkBtn = (x, y, w, label, color, border, cb, disabled = false) => {
      const r = s.add.rectangle(x, y, w, 28, color).setStrokeStyle(2, border).setInteractive({ useHandCursor: !disabled }).setAlpha(disabled ? 0.5 : 1);
      const t = s.add.text(x, y, label, { fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: disabled ? '#6b7a99' : '#0a0e1a' }).setOrigin(0.5);
      if (!disabled) r.on('pointerdown', cb);
      c.add([r, t]);
      return r;
    };

    mkBtn(-78, ph / 2 - 30, 140, `Revive (${cost})`, 0x14f195, 0x03e1ff, () => {
      if (!canPay) { bus.emit(Events.SYSTEM, 'Not enough Wayfarer Tokens.'); return; }
      econ.spendTokens('revive', cost);
    }, !canPay);
    mkBtn(78, ph / 2 - 30, 140, 'Respawn (-5% gold)', 0x1a103c, 0x9945ff, () => {
      this.destroy();
      // normal respawn is handled by combat.onPlayerDeath / update loop
      bus.emit(Events.SYSTEM, 'Respawning with the usual penalty...');
    });

    s.input.enabled = true;
    if (s.input.keyboard) s.input.keyboard.enabled = false;
  }

  _onOffer() { /* spend is owned by reviveSystem.js — never re-spend here */ }

  destroy() {
    this.destroyed = true;
    if (this.c) { this.c.destroy(); this.c = null; }
    if (this.offHp) { this.offHp(); this.offHp = null; }
    if (this.scene?.input?.keyboard) this.scene.input.keyboard.enabled = true;
  }
}
