/**
 * GuildPanelBase.js — Shared base for the guild panel.
 */

export const COLORS = Object.freeze({
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
  red: '#ff4444',
});

export const FONTS = Object.freeze({
  title: '"Jacquard12", "Courier New", monospace',
  button: '"Silkscreen", "Courier New", monospace',
  body: '"PixelifySans", "Courier New", monospace',
});

export default class GuildPanelBase extends Phaser.GameObjects.Container {
  constructor(scene, x, y, guildSystem) {
    super(scene, x, y);
    this.scene = scene;
    this.guildSystem = guildSystem;
    this.page = 'home';
    this.statusText = '';

    this.createUI();
    this.setVisible(false);
    this.setDepth(1000);
    this.scene.add.existing(this);
  }

  createUI() {
    const w = 460;
    const h = 400;

    this.modal = this.scene.add.rectangle(0, 0, 960, 640, 0x000000, 0.55)
      .setInteractive({ useHandCursor: true });
    this.modal.on('pointerdown', () => this.close());
    this.add(this.modal);

    this.panel = this.scene.add.rectangle(0, 0, w, h, COLORS.panel, 0.9)
      .setStrokeStyle(2, COLORS.purpleHex, 0.9);
    this.add(this.panel);

    this.title = this.scene.add.text(0, -h / 2 + 24, 'GUILD HALL', {
      fontFamily: FONTS.title,
      fontSize: '22px',
      color: COLORS.green,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add(this.title);

    this.closeBtn = this.scene.add.text(w / 2 - 14, -h / 2 + 14, '\u2715', {
      fontFamily: FONTS.button,
      fontSize: '14px',
      color: COLORS.magenta,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.closeBtn.on('pointerdown', () => this.close());
    this.add(this.closeBtn);

    this.content = this.scene.add.container(0, 0);
    this.add(this.content);

    this.status = this.scene.add.text(0, h / 2 - 18, '', {
      fontFamily: FONTS.body,
      fontSize: '10px',
      color: COLORS.muted,
    }).setOrigin(0.5);
    this.add(this.status);
  }

  setTitle(text) {
    this.title.setText(text);
  }

  addText(x, y, text, opts = {}) {
    const t = this.scene.add.text(x, y, text, {
      fontFamily: FONTS.body,
      fontSize: opts.fontSize || '11px',
      color: opts.color || COLORS.white,
    }).setOrigin(...(opts.origin || [0.5, 0.5]));
    this.content.add(t);
    return t;
  }

  addButton(x, y, label, onClick, width = 180) {
    const container = this.scene.add.container(x, y);
    const bg = this.scene.add.rectangle(0, 0, width, 28, COLORS.purpleHex, 0.9)
      .setStrokeStyle(1, COLORS.greenHex, 0.6);
    bg.setInteractive({ useHandCursor: true });
    const text = this.scene.add.text(0, 0, label, {
      fontFamily: FONTS.button,
      fontSize: '10px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(0x7a3ad6));
    bg.on('pointerout', () => bg.setFillStyle(COLORS.purpleHex));
    bg.on('pointerdown', () => { bg.setFillStyle(0x5e2db3); onClick(); });
    bg.on('pointerup', () => bg.setFillStyle(0x7a3ad6));
    container.add([bg, text]);
    this.content.add(container);
    return container;
  }

  addTextButton(x, y, label, onClick, opts = {}) {
    const t = this.scene.add.text(x, y, label, {
      fontFamily: FONTS.button,
      fontSize: opts.fontSize || '10px',
      color: opts.color || COLORS.white,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor(COLORS.cyan));
    t.on('pointerout', () => t.setColor(opts.color || COLORS.white));
    t.on('pointerdown', () => onClick());
    this.content.add(t);
    return t;
  }

  addInput(x, y, width, value) {
    const bg = this.scene.add.rectangle(x, y, width, 24, COLORS.bg, 0.8)
      .setStrokeStyle(1, COLORS.purpleHex, 0.5);
    this.content.add(bg);
    const display = this.scene.add.text(x, y, value || '________', {
      fontFamily: FONTS.body,
      fontSize: '11px',
      color: value ? COLORS.green : COLORS.muted,
    }).setOrigin(0.5);
    this.content.add(display);
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.style.position = 'absolute';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => { input.value = display.value || ''; input.focus(); });
    input.addEventListener('input', () => {
      display.setText(input.value || '________');
      display.setColor(input.value ? COLORS.green : COLORS.muted);
      display.value = input.value;
    });
    return display;
  }

  drawProgressBar(x, y, width, height, pct) {
    const bg = this.scene.add.rectangle(x, y, width, height, 0x000000, 0.6)
      .setStrokeStyle(1, COLORS.purpleHex, 0.4).setOrigin(0, 0.5);
    const fill = this.scene.add.rectangle(x + 1, y, Math.max(0, (width - 2) * pct), height - 2, COLORS.greenHex, 0.9)
      .setOrigin(0, 0.5);
    this.content.add([bg, fill]);
  }

  renderInvites() {
    const invites = this.guildSystem?.net?.getInvites?.() || [];
    if (invites.length === 0) return;
    let y = 40;
    this.addText(0, y, 'INVITES', { fontSize: '11px', color: COLORS.muted });
    for (const invite of invites) {
      y += 24;
      this.addText(-100, y, `${invite.guildName || invite.guildId}`, { fontSize: '10px', color: COLORS.white, origin: [0, 0.5] });
      this.addTextButton(80, y, 'ACCEPT', () => this.guildSystem.acceptInvite(invite.guildId), { fontSize: '9px', color: COLORS.green });
      this.addTextButton(140, y, 'DECLINE', () => this.guildSystem.declineInvite(invite.guildId), { fontSize: '9px', color: COLORS.red });
    }
  }

  setStatus(msg) {
    this.statusText = msg;
    this.status.setText(msg);
  }

  enterHall() {
    if (this.scene.scene.get('GuildHallScene')) {
      this.scene.scene.launch('GuildHallScene', { guildSystem: this.guildSystem });
    }
  }

  open() {
    this.setVisible(true);
    this.refresh?.();
  }

  close() {
    this.setVisible(false);
  }
}
