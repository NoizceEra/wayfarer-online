import Phaser from 'phaser';

// Tiny HUD overlay for world events (systems/worldEvents.js): an event ticker under the zone
// label and a wide world-boss health bar. Purely reads `world.worldEvents.hud`; no input.
const FONT = '"Silkscreen", monospace';

export class EventHudScene extends Phaser.Scene {
  constructor() { super('eventhud'); }
  create() {
    this.g = this.add.graphics().setDepth(10);
    this.lines = [0, 1].map(() => this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '9px', color: '#ffd84a', stroke: '#1a1024', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(11));
    this.bossName = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#ffd0c0', stroke: '#2a0a08', strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(12).setVisible(false);
    this.bossHp = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '8px', color: '#ffffff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0.5).setDepth(12).setVisible(false);
    this.scale.on('resize', () => { this.last = null; });
  }
  update(time) {
    const w = this.scene.get('world');
    const we = w?.worldEvents;
    const g = this.g;
    g.clear();
    if (!we || !w.sys.isActive()) { this.lines.forEach((t) => t.setVisible(false)); this.bossName.setVisible(false); this.bossHp.setVisible(false); return; }
    const W = this.scale.width, small = W < 560;
    const hud = we.hud;
    let y = small ? 58 : 34;
    this.lines.forEach((t, i) => {
      const L = hud.lines[i];
      if (!L) { t.setVisible(false); return; }
      t.setVisible(true).setText(L.text).setColor(L.color).setPosition(W / 2, y).setFontSize(small ? '8px' : '9px');
      const maxW = W - 24;
      if (t.width > maxW) t.setScale(maxW / t.width); else t.setScale(1);
      y += 13;
    });
    const b = hud.boss;
    if (!b) { this.bossName.setVisible(false); this.bossHp.setVisible(false); return; }
    // wide boss bar
    const bw = Math.min(360, W - 40), bh = 14, bx = W / 2 - bw / 2, by = y + 22;
    const f = Phaser.Math.Clamp(b.hp / b.max, 0, 1);
    g.fillStyle(0x000000, 0.8).fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    g.fillStyle(0x3a0c0c, 1).fillRect(bx, by, bw, bh);
    g.fillStyle(f > 0.5 ? 0xc0392b : f > 0.25 ? 0xe0702a : 0xff4a2a, 1).fillRect(bx, by, bw * f, bh);
    g.fillStyle(0xffffff, 0.18).fillRect(bx, by, bw * f, 3);
    for (const q of [0.25, 0.5, 0.75]) g.fillStyle(0x000000, 0.6).fillRect(bx + bw * q - 1, by, 2, bh);
    g.lineStyle(2, b.engaged ? 0xffd84a : 0x8d5a2b, 1).strokeRect(bx - 3, by - 3, bw + 6, bh + 6);
    this.bossName.setVisible(true).setText(b.name).setPosition(W / 2, by - 6);
    this.bossHp.setVisible(true).setText(`${Math.ceil(b.hp)} / ${b.max}`).setPosition(W / 2, by + bh / 2);
  }
}
