
/**
 * WorldBossAlert.js — HUD alert and teleport prompt for world boss events.
 * Follows existing Solana palette and pixel/button style used in WalletPanel.js.
 */

const SOL = {
  bg: 0x0A0E1A,
  bgLight: 0x1A103C,
  green: '#14F195',
  greenHex: 0x14F195,
  purple: '#9945FF',
  purpleHex: 0x9945FF,
  cyan: '#03E1FF',
  magenta: '#DC1FFF',
  white: '#E1E8F0',
  muted: '#6B7A99',
  darkText: '#0A0E1A',
};

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
    const w = 340;
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
      fontFamily: '"Courier New", monospace',
      fontSize: '13px',
      color: SOL.green,
      fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.add(this.titleText);

    this.nameText = this.scene.add.text(-w / 2 + 52, -10, '', {
      fontFamily: '"Courier New", monospace',
      fontSize: '12px',
      color: SOL.white,
    }).setOrigin(0, 0.5);
    this.add(this.nameText);

    this.timerText = this.scene.add.text(-w / 2 + 52, 8, '', {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: SOL.cyan,
    }).setOrigin(0, 0.5);
    this.add(this.timerText);

    this.teleportBtn = this.createPixelButton(0, 34, 'TELEPORT NOW', () => this.onTeleport(), 130);
    this.add(this.teleportBtn);

    this.dismissBtn = this.createPixelButton(148, 34, '\u2715', () => {
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
      fontFamily: '"Courier New", monospace',
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
    this.nameText.setText(`${data.name || 'Unknown'} — ${(data.area || data.zone || 'Unknown Zone').toUpperCase()}`);
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
