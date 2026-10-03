import { bus, Events } from '../core/events.js';

const FONT = '"Silkscreen", monospace';

// Phaser modal shown when another player challenges us to a pet duel.
// Expected payload: { fromName }.
// Emits SOCIAL_UI {panel:'pet-duel-request', open:true|false} on show/hide.
export class PetDuelRequest {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.pending = null;
    this.onAccept = null;
    this.onDecline = null;
    this.off = bus.on(Events.SOCIAL_UI, (m) => {
      if (m.panel === 'pet-duel-request') {
        if (m.open && m.duel) this.show(m.duel);
        else this.hide();
      }
    });
  }

  show({ fromName, onAccept, onDecline }) {
    this.hide();
    this.pending = { fromName };
    this.onAccept = onAccept;
    this.onDecline = onDecline;

    const { w: W, h: H } = this.scene.view ? this.scene.view() : { w: this.scene.scale.width, h: this.scene.scale.height };
    const pw = Math.min(W - 32, 360);
    const ph = 120;

    this.container = this.scene.add.container(W / 2, H / 2 - 30).setDepth(200);

    const bg = this.scene.add.rectangle(0, 0, pw, ph, 0x2a1d10, 0.97).setStrokeStyle(2, 0x8d5a2b);
    const title = this.scene.add.text(0, -ph / 2 + 18, 'PET DUEL CHALLENGE', {
      fontFamily: FONT, fontSize: '12px', color: '#ffd84a', fontStyle: 'bold',
    }).setOrigin(0.5);
    const body = this.scene.add.text(0, -6, `${fromName || 'Someone'} challenges you\nto a pet duel!`, {
      fontFamily: FONT, fontSize: '11px', color: '#f4e8c8', align: 'center', lineSpacing: 4,
    }).setOrigin(0.5);

    const btnW = 90, btnH = 28, gap = 16;
    const accept = this.makeBtn(-(btnW + gap) / 2, ph / 2 - 28, btnW, btnH, 'Accept', 0x4cc060, () => { this._accept(); });
    const decline = this.makeBtn((btnW + gap) / 2, ph / 2 - 28, btnW, btnH, 'Decline', 0xe74c3c, () => { this._decline(); });

    this.container.add([bg, title, body, accept.bg, accept.text, decline.bg, decline.text]);
    this.container.setVisible(true);
    bus.emit(Events.SOCIAL_UI, { panel: 'pet-duel-request', open: true, duel: { fromName } });
  }

  makeBtn(x, y, w, h, label, color, cb) {
    const bg = this.scene.add.rectangle(x, y, w, h, color, 1).setStrokeStyle(2, 0xffffff).setInteractive({ useHandCursor: true });
    const text = this.scene.add.text(x, y, label, { fontFamily: FONT, fontSize: '11px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(this.lighten(color)));
    bg.on('pointerout', () => bg.setFillStyle(color));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev?.stopPropagation?.(); cb(); });
    return { bg, text };
  }

  lighten(hex) {
    const r = Math.min(255, ((hex >> 16) & 0xff) + 30);
    const g = Math.min(255, ((hex >> 8) & 0xff) + 30);
    const b = Math.min(255, (hex & 0xff) + 30);
    return (r << 16) | (g << 8) | b;
  }

  _accept() {
    if (typeof this.onAccept === 'function') this.onAccept(this.pending);
    this.hide();
  }

  _decline() {
    if (typeof this.onDecline === 'function') this.onDecline(this.pending);
    this.hide();
  }

  hide() {
    if (!this.container) return;
    this.container.destroy();
    this.container = null;
    this.pending = null;
    this.onAccept = null;
    this.onDecline = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'pet-duel-request', open: false });
  }

  destroy() {
    this.hide();
    if (this.off) this.off();
  }
}
