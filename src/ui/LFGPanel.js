/**
 * LFGPanel.js — Looking-for-group / Dungeon queue panel for Wayfarer Online.
 * Follows the Solana pixel-art palette and panel opacity patterns.
 */

import { DUNGEONS, getDungeonById } from '../data/dungeons.js';

const COLORS = Object.freeze({
  bg: 0x0b0d14,
  panel: 0x161b22,
  green: 0x14f195,
  purple: 0x9945ff,
  cyan: 0x03e1ff,
  magenta: 0xdc1fff,
  white: 0xe1e8f0,
  muted: 0x6b7a99,
  darkText: 0x0b0d14,
});

const FONTS = Object.freeze({
  title: '"Jacquard12", "Courier New", monospace',
  button: '"Silkscreen", "Courier New", monospace',
  body: '"PixelifySans", "Courier New", monospace',
});

export default class LFGPanel extends Phaser.GameObjects.Container {
  constructor(scene, x, y) {
    super(scene, x, y);
    this.scene = scene;

    this.selectedDungeonId = DUNGEONS[0]?.id || null;
    this.queueState = 'idle'; // 'idle' | 'queued' | 'ready' | 'entering'
    this.role = 'any'; // 'dps' | 'tank' | 'healer' | 'any'
    this.groupMode = 'solo'; // 'solo' | 'party'
    this.onQueue = null; // callback(queueRequest)
    this.onAccept = null; // callback(dungeonId)
    this.onCancel = null; // callback()

    this.createUI();
    this.setVisible(false);
    this.setDepth(1000);
    this.scene.add.existing(this);
  }

  createUI() {
    const w = 420;
    const h = 360;

    // Modal backdrop
    this.modal = this.scene.add.rectangle(0, 0, 960, 640, 0x000000, 0.55)
      .setInteractive({ useHandCursor: true });
    this.modal.on('pointerdown', () => this.close());
    this.add(this.modal);

    // Main panel
    this.panel = this.scene.add.rectangle(0, 0, w, h, COLORS.panel, 0.55)
      .setStrokeStyle(2, COLORS.purple, 0.9);
    this.add(this.panel);

    // Header
    this.title = this.scene.add.text(0, -h / 2 + 24, 'DUNGEON FINDER', {
      fontFamily: FONTS.title,
      fontSize: '22px',
      color: '#14f195',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add(this.title);

    // Close button
    this.closeBtn = this.scene.add.text(w / 2 - 14, -h / 2 + 14, '✕', {
      fontFamily: FONTS.button,
      fontSize: '14px',
      color: '#dc1fff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.closeBtn.on('pointerdown', () => this.close());
    this.add(this.closeBtn);

    // Dungeon list (left column)
    this.dungeonListY = -h / 2 + 70;
    this.dungeonItems = [];
    this.buildDungeonList();

    // Details panel (right column)
    this.details = this.scene.add.text(110, -h / 2 + 70, '', {
      fontFamily: FONTS.body,
      fontSize: '11px',
      color: '#e1e8f0',
      lineSpacing: 6,
      wordWrap: { width: 180 },
    }).setOrigin(0);
    this.add(this.details);

    // Role selector
    this.roleSelector = this.buildOptionRow(
      -w / 2 + 20,
      h / 2 - 110,
      ['dps', 'tank', 'healer', 'any'],
      'Role',
      this.role,
      (v) => { this.role = v; }
    );
    this.add(this.roleSelector);

    // Group mode selector
    this.groupSelector = this.buildOptionRow(
      -w / 2 + 20,
      h / 2 - 80,
      ['solo', 'party'],
      'Queue',
      this.groupMode,
      (v) => { this.groupMode = v; }
    );
    this.add(this.groupSelector);

    // Action button
    this.actionBtn = this.createPixelButton(0, h / 2 - 38, 'JOIN QUEUE', () => this.toggleQueue());
    this.add(this.actionBtn);

    // Status text
    this.statusText = this.scene.add.text(0, h / 2 - 14, '', {
      fontFamily: FONTS.body,
      fontSize: '10px',
      color: '#6b7a99',
    }).setOrigin(0.5);
    this.add(this.statusText);

    this.refreshDetails();
  }

  buildDungeonList() {
    // Clean up old list if rebuilding
    for (const item of this.dungeonItems) item.destroy();
    this.dungeonItems = [];

    let y = this.dungeonListY;
    for (const dungeon of DUNGEONS) {
      const item = this.createDungeonRow(-110, y, dungeon);
      this.dungeonItems.push(item);
      this.add(item);
      y += 52;
    }
  }

  createDungeonRow(x, y, dungeon) {
    const container = this.scene.add.container(x, y);
    const selected = this.selectedDungeonId === dungeon.id;

    const bg = this.scene.add.rectangle(0, 0, 200, 44, COLORS.bg, selected ? 0.7 : 0.35)
      .setStrokeStyle(1, selected ? COLORS.green : COLORS.purple, selected ? 0.9 : 0.4);
    bg.setInteractive({ useHandCursor: true });

    const nameText = this.scene.add.text(-92, -10, dungeon.name.toUpperCase(), {
      fontFamily: FONTS.button,
      fontSize: '11px',
      color: selected ? '#14f195' : '#e1e8f0',
    }).setOrigin(0, 0.5);

    const metaText = this.scene.add.text(-92, 8, `Lv.${dungeon.level} • ${dungeon.durationMin}m • ${dungeon.minPlayers}-${dungeon.maxPlayers}p`, {
      fontFamily: FONTS.body,
      fontSize: '9px',
      color: '#6b7a99',
    }).setOrigin(0, 0.5);

    bg.on('pointerover', () => bg.setFillStyle(COLORS.panel, 0.6));
    bg.on('pointerout', () => bg.setFillStyle(COLORS.bg, selected ? 0.7 : 0.35));
    bg.on('pointerdown', () => {
      this.selectedDungeonId = dungeon.id;
      this.refreshList();
      this.refreshDetails();
    });

    container.add([bg, nameText, metaText]);
    return container;
  }

  buildOptionRow(x, y, options, label, current, onSelect) {
    const container = this.scene.add.container(x, y);
    const labelText = this.scene.add.text(0, 0, `${label}:`, {
      fontFamily: FONTS.body,
      fontSize: '10px',
      color: '#6b7a99',
    }).setOrigin(0, 0.5);
    container.add(labelText);

    let offsetX = 46;
    for (const opt of options) {
      const btn = this.scene.add.text(offsetX, 0, opt.toUpperCase(), {
        fontFamily: FONTS.button,
        fontSize: '10px',
        color: current === opt ? '#14f195' : '#e1e8f0',
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor('#03e1ff'));
      btn.on('pointerout', () => btn.setColor(current === opt ? '#14f195' : '#e1e8f0'));
      btn.on('pointerdown', () => {
        onSelect(opt);
        this.refreshSelectors();
      });
      container.add(btn);
      offsetX += 52;
    }
    return container;
  }

  refreshSelectors() {
    this.roleSelector.destroy();
    this.groupSelector.destroy();
    this.roleSelector = this.buildOptionRow(
      -210 + 20,
      180 / 2 - 110,
      ['dps', 'tank', 'healer', 'any'],
      'Role',
      this.role,
      (v) => { this.role = v; }
    );
    this.groupSelector = this.buildOptionRow(
      -210 + 20,
      180 / 2 - 80,
      ['solo', 'party'],
      'Queue',
      this.groupMode,
      (v) => { this.groupMode = v; }
    );
    this.add(this.roleSelector);
    this.add(this.groupSelector);
  }

  refreshList() {
    // rebuild entire list to reflect selection state
    this.buildDungeonList();
  }

  refreshDetails() {
    const d = getDungeonById(this.selectedDungeonId);
    if (!d) {
      this.details.setText('Select a dungeon.');
      return;
    }

    const packNames = d.trashPacks.map((p) => `• ${p.name} x${p.count}`).join('\n');
    const lootPreview = d.lootTable
      .filter((l) => l.type !== 'gold' && l.type !== 'token')
      .map((l) => `• ${l.name} (${l.rarity})`)
      .join('\n');

    this.details.setText(
      `${d.description}\n\n` +
      `TRASH PACKS\n${packNames}\n\n` +
      `MINI-BOSS\n• ${d.miniBoss.name}\n\n` +
      `FINAL BOSS\n• ${d.finalBoss.name}\n\n` +
      `LOOT\n${lootPreview || '• Gold & tokens only'}`
    );
  }

  createPixelButton(x, y, label, onClick, width = 180) {
    const container = this.scene.add.container(x, y);
    const bg = this.scene.add.rectangle(0, 0, width, 28, COLORS.purple, 0.9)
      .setStrokeStyle(1, COLORS.green, 0.6);
    bg.setInteractive({ useHandCursor: true });

    const text = this.scene.add.text(0, 0, label, {
      fontFamily: FONTS.button,
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    bg.on('pointerover', () => bg.setFillStyle(0x7a3ad6));
    bg.on('pointerout', () => bg.setFillStyle(COLORS.purple));
    bg.on('pointerdown', () => { bg.setFillStyle(0x5e2db3); onClick(); });
    bg.on('pointerup', () => bg.setFillStyle(0x7a3ad6));

    container.add([bg, text]);
    container.bg = bg;
    container.text = text;
    return container;
  }

  toggleQueue() {
    if (this.queueState === 'idle') {
      this.queueState = 'queued';
      this.actionBtn.text.setText('LEAVE QUEUE');
      this.statusText.setText('Searching for party...');
      this.statusText.setColor('#03e1ff');
      if (this.onQueue) this.onQueue(this.buildQueueRequest());
    } else if (this.queueState === 'queued') {
      this.resetQueueUI();
      if (this.onCancel) this.onCancel();
    } else if (this.queueState === 'ready') {
      this.queueState = 'entering';
      this.statusText.setText('Entering dungeon...');
      if (this.onAccept) this.onAccept(this.selectedDungeonId);
    }
  }

  buildQueueRequest() {
    return {
      dungeonId: this.selectedDungeonId,
      role: this.role,
      groupMode: this.groupMode,
      timestamp: Date.now(),
    };
  }

  markReady(etaMs = 0) {
    if (this.queueState !== 'queued') return;
    this.queueState = 'ready';
    this.actionBtn.text.setText('ENTER DUNGEON');
    this.statusText.setText(`Match ready! ${Math.max(1, Math.ceil(etaMs / 1000))}s`);
    this.statusText.setColor('#14f195');
  }

  resetQueueUI() {
    this.queueState = 'idle';
    this.actionBtn.text.setText('JOIN QUEUE');
    this.statusText.setText('');
  }

  close() {
    this.setVisible(false);
    if (this.queueState === 'queued' && this.onCancel) this.onCancel();
  }

  open() {
    this.setVisible(true);
    this.resetQueueUI();
  }
}
