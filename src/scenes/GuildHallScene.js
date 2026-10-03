/**
 * GuildHallScene.js — Instanced guild hall scene scaffold for Wayfarer Online.
 * Renders a private guild hall instance; progression data comes from GuildSystem.
 */

import Phaser from 'phaser';

const SOL = {
  bg: 0x0A0E1A,
  panel: 0x161b22,
  green: '#14F195',
  greenHex: 0x14F195,
  purple: '#9945FF',
  purpleHex: 0x9945FF,
  cyan: '#03E1FF',
  magenta: '#DC1FFF',
  white: '#E1E8F0',
  muted: '#6B7A99',
  gold: '#FFD84A',
};

export default class GuildHallScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GuildHallScene' });
  }

  init(data) {
    this.guildSystem = data?.guildSystem || null;
    this.guild = this.guildSystem?.getGuild?.() || null;
  }

  create() {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    // Instance backdrop
    this.add.rectangle(cx, cy, 960, 640, SOL.bg);
    this.add.grid(cx, cy, 960, 640, 32, 32, 0x000000, 0, SOL.purpleHex, 0.08);

    // Guild crest placeholder
    this.crest = this.add.rectangle(cx, cy - 140, 96, 96, SOL.purpleHex, 0.25)
      .setStrokeStyle(2, SOL.greenHex, 0.8);
    this.tagText = this.add.text(cx, cy - 140, this.guild?.tag || '??', {
      fontFamily: '"Courier New", monospace',
      fontSize: '32px',
      color: SOL.green,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Nameplate
    this.nameText = this.add.text(cx, cy - 60, this.guild?.name || 'Guild Hall', {
      fontFamily: '"Jacquard12", "Courier New", monospace',
      fontSize: '28px',
      color: SOL.white,
    }).setOrigin(0.5);

    this.levelText = this.add.text(cx, cy - 28, `Hall Level ${this.guild?.hallLevel || 1}`, {
      fontFamily: '"Courier New", monospace',
      fontSize: '12px',
      color: SOL.cyan,
    }).setOrigin(0.5);

    // Perk pedestals
    this.buildPerkPedestals(cx, cy + 40);

    // Daily reward button
    this.claimBtn = this.createPixelButton(cx, cy + 160, 'CLAIM DAILY GUILD BONUS', () => this.claimDaily());

    // Return button
    this.returnBtn = this.createPixelButton(cx, cy + 200, 'RETURN TO WORLD', () => this.leaveHall());

    // Info toast area
    this.toast = this.add.text(cx, cy + 260, '', {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: SOL.muted,
    }).setOrigin(0.5);

    this.input.keyboard.on('keydown-ESC', () => this.leaveHall());
  }

  buildPerkPedestals(cx, cy) {
    const perks = [
      { id: 'token_points', label: 'Token Insight', icon: '⚡' },
      { id: 'market_fee', label: 'Merchant License', icon: '⚖' },
      { id: 'daily_gold', label: 'Coffers', icon: '💰' },
    ];
    const gap = 160;
    const startX = cx - gap;
    perks.forEach((perk, idx) => {
      const x = startX + idx * gap;
      const level = this.guild?.perks?.[perk.id] || 0;
      const pedestal = this.add.rectangle(x, cy, 120, 110, SOL.panel, 0.8)
        .setStrokeStyle(1, SOL.purpleHex, 0.6);
      const icon = this.add.text(x, cy - 36, perk.icon, { fontSize: '28px' }).setOrigin(0.5);
      const label = this.add.text(x, cy - 4, perk.label, {
        fontFamily: '"Courier New", monospace',
        fontSize: '10px',
        color: SOL.white,
      }).setOrigin(0.5);
      const levelText = this.add.text(x, cy + 18, `Lv.${level}`, {
        fontFamily: '"Courier New", monospace',
        fontSize: '14px',
        color: level > 0 ? SOL.green : SOL.muted,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      this[`pedestal_${perk.id}`] = { pedestal, icon, label, levelText };
    });
  }

  createPixelButton(x, y, label, onClick, width = 240) {
    const container = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, width, 28, SOL.purpleHex, 0.9)
      .setStrokeStyle(1, SOL.greenHex, 0.6);
    bg.setInteractive({ useHandCursor: true });
    const text = this.add.text(0, 0, label, {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(0x7a3ad6));
    bg.on('pointerout', () => bg.setFillStyle(SOL.purpleHex));
    bg.on('pointerdown', () => { bg.setFillStyle(0x5e2db3); onClick(); });
    bg.on('pointerup', () => bg.setFillStyle(0x7a3ad6));
    container.add([bg, text]);
    return container;
  }

  claimDaily() {
    const base = 100;
    const gold = this.guildSystem?.applyDailyGold?.(base) || base;
    this.showToast(`+${gold} guild daily gold`);
    // TODO: wire to economy server when available
  }

  showToast(message) {
    this.toast.setText(message);
    this.tweens.add({
      targets: this.toast,
      alpha: 0,
      duration: 2000,
      yoyo: true,
      hold: 500,
      onComplete: () => this.toast.setAlpha(1),
    });
  }

  leaveHall() {
    this.scene.stop('GuildHallScene');
  }
}
