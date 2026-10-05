
/**
 * WorldBossAlert.js — HUD alert and teleport prompt for world boss events.
 * Follows existing Solana palette and pixel/button style used in WalletPanel.js.
 */

const SOL = {
  bg: 0x1a1008,
  bgLight: 0x2a1d10,
  green: '#9bbc0f',
  greenHex: 0x9bbc0f,
  purple: '#c8a840',
  purpleHex: 0xc8a840,
  cyan: '#a0c4f0',
  magenta: '#ff7a6a',
  white: '#f4f0dc',
  muted: '#a89a7e',
  darkText: '#1a1008',
};

import { stackY, setStackH } from './hudLayout.js';
import { THEME } from './theme.js';

export class WorldBossAlert extends Phaser.GameObjects.Container {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y);
    this.scene = scene;
    this.onTeleport = options.onTeleport || (() => {});
    this.onDismiss = options.onDismiss || (() => {});

    this.createUI();
    this.scene.add.existing(this);
    this.setDepth(2000);
    this.setVisible(false);
    this.setScrollFactor(0);
  }

  createUI() {
    const w = Math.min(340, (this.scene.scale.width / (this.scene.uiZoom || 1)) - 16);
    const h = 110;

    this.bg = this.scene.add.rectangle(0, 0, w, h, SOL.bg, 0.92)
      .setStrokeStyle(2, SOL.purple, 0.9);
    this.add(this.bg);

    this.icon = this.scene.add.text(-w / 2 + 24, 0, '\u2620', {
      fontSize: '28px',
      color: SOL.magenta,
    }).setOrigin(0.5);
    this.add(this.icon);

    this.titleText = this.scene.add.text(-w / 2 + 52, -28, 'WORLD BOSS APPROACHES', {
      fontFamily: THEME.font.label,
      fontSize: '11px',
      color: SOL.green,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.add(this.titleText);

    this.nameText = this.scene.add.text(-w / 2 + 52, -10, '', {
      fontFamily: THEME.font.label,
      fontSize: '12px',
      color: SOL.white,
    }).setOrigin(0, 0.5);
    this.add(this.nameText);

    this.timerText = this.scene.add.text(-w / 2 + 52, 8, '', {
      fontFamily: THEME.font.label,
      fontSize: '11px',
      color: SOL.cyan,
    }).setOrigin(0, 0.5);
    this.add(this.timerText);

    this.teleportBtn = this.createPixelButton(0, 34, 'TELEPORT NOW', () => this.onTeleport(), 130);
    this.add(this.teleportBtn);

    this.dismissBtn = this.createPixelButton(w / 2 - 22, 34, '\u2715', () => {
      this.hide();
      this.onDismiss();
    }, 34);
    this.add(this.dismissBtn);
  }

  createPixelButton(x, y, label, onClick, width = 160) {
    const btnH = 22;
    const container = this.scene.add.container(x, y);
    const bg = this.scene.add.rectangle(0, 0, width, btnH, SOL.purpleHex, 0.9)
      .setStrokeStyle(1, SOL.greenHex, 0.6);
    bg.setInteractive({ useHandCursor: true });
    const text = this.scene.add.text(0, 0, label, {
      fontFamily: THEME.font.label,
      fontSize: '11px',
      color: SOL.white,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    bg.on('pointerover', () => bg.setFillStyle(0x7a3ad6));
    bg.on('pointerout', () => bg.setFillStyle(SOL.purpleHex));
    bg.on('pointerdown', () => { bg.setFillStyle(0x5e2db3); onClick(); });
    bg.on('pointerup', () => bg.setFillStyle(0x7a3ad6));

    container.add([bg, text]);
    return container;
  }

  show(data) {
    this.bossData = data || {};
    setStackH('banner', 110); // joins the top-centre HUD stack: pushes the event ticker / boss bar down instead of covering them
    this.setPosition(this.scene.scale.width / (this.scene.uiZoom || 1) / 2, stackY('banner', this.scene.scale.width / (this.scene.uiZoom || 1)) + 55);
    this.nameText.setText(`${data.name || 'Unknown'} — ${(data.area || data.zone || 'Unknown Zone').toUpperCase()}`);
    this.nameText.setScale(1);
    const maxNameW = this.bg.width - 66; // long boss / zone names shrink to fit the card
    if (this.nameText.width > maxNameW) this.nameText.setScale(maxNameW / this.nameText.width);
    this.targetTime = data.expiresAt || (Date.now() + 15 * 60 * 1000);
    this.active = data.expiresAt != null;
    this.updateTimer();
    this.setVisible(true);
    this.setAlpha(0);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      y: this.y + 10,
      duration: 300,
      ease: 'Power2',
    });
  }

  close() { this.hide(); }

  hide() {
    if (!this.visible) return;
    setStackH('banner', 0);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y - 10,
      duration: 200,
      ease: 'Power2',
      onComplete: () => this.setVisible(false),
    });
  }

  updateTimer() {
    if (!this.visible || !this.targetTime) return;
    const remaining = Math.max(0, this.targetTime - Date.now());
    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);
    this.timerText.setText(`${this.active ? 'Active for' : 'Spawns in'} ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
  }

  update() {
    this.updateTimer();
  }

  destroy(fromScene) {
    super.destroy(fromScene);
  }
}

export default WorldBossAlert;
