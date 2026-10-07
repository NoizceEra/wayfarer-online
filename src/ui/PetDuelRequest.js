import { bus, Events } from '../core/events.js';
import { social } from '../systems/social/index.js';
import { input } from '../core/input.js';

const FONT = '"Silkscreen", monospace';

// Phaser modal shown when another player challenges us to a pet duel.
// Expected payload: { fromName, from }.
// Emits SOCIAL_UI {panel:'pet-duel-request', open:true|false} on show/hide.
export class PetDuelRequest {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.backdrop = null;
    this.pending = null;
    this.offCloser = null;
    this.off = bus.on(Events.SOCIAL_UI, (m) => {
      if (m.panel === 'pet-duel-request') {
        if (m.open && m.duel) this.show(m.duel);
        else this.hide();
      }
    });
  }

  show({ fromName, from }) {
    this.hide();
    this.pending = { fromName, from };

    const { w: W, h: H } = this.scene.view ? this.scene.view() : { w: this.scene.scale.width, h: this.scene.scale.height };
    const pw = Math.min(W - 32, 360);
    const ph = 120;

    // Dim + click-swallowing backdrop so taps can't reach the world behind the
    // prompt, and block gameplay keys while the challenge is on screen.
    this.backdrop = this.scene.add.rectangle(0, 0, W, H, 0x0a0812, 0.6).setOrigin(0).setDepth(199).setInteractive();
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
    input.pushModal('petDuelReq');
    // Esc ownership. UIScene also registers an id-'pet-duel-request' closer
    // (priority 960) that only calls hide(), i.e. it dismissed the prompt WITHOUT
    // telling the server we declined (the challenger then waits out its 45s
    // timeout). addCloser() de-dupes by id, so registering here REPLACES that one;
    // the priority must also outrank the generic 'social' aggregator (950) or
    // Escape would close that no-op closer first and leave the prompt on screen.
    this.offCloser = input.addCloser({
      id: 'pet-duel-request', priority: 970,
      isOpen: () => !!this.container,
      close: () => this._decline(),
      scene: this.scene,
    });
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
    social.acceptPetDuel();
    this.hide();
  }

  _decline() {
    social.declinePetDuel();
    this.hide();
  }

  hide() {
    if (!this.container) return;
    if (this.offCloser) { this.offCloser(); this.offCloser = null; }
    input.popModal('petDuelReq');
    this.backdrop?.destroy();
    this.backdrop = null;
    this.container.destroy();
    this.container = null;
    this.pending = null;
    bus.emit(Events.SOCIAL_UI, { panel: 'pet-duel-request', open: false });
  }

  destroy() {
    this.hide();
    if (this.off) this.off();
  }
}
