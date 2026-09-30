import { bus, Events } from '../core/events.js';
import { social } from '../systems/social/index.js';

// Party frames on the left HUD (Phaser, below the status panel): one frame per
// other party member with name, level, class icon, HP/MP bars and a crown on
// the leader. Click a frame for the social context menu. Data comes from
// SOCIAL_PARTY (roster + throttled party-status updates).
const F = (size, color, extra = {}) => ({ fontFamily: '"Silkscreen", monospace', fontSize: `${size}px`, color, ...extra });
const JOB_ICON = { wayfarer: 'hud.slash', ranger: 'hud.shot', arcanist: 'hud.bolt', bandit: 'hud.stab' };

export class PartyFrames {
  constructor(scene, x = 8, y = 134) {
    this.scene = scene; this.x = x; this.y = y;
    this.c = scene.add.container(x, y).setDepth(101);
    this.off = bus.on(Events.SOCIAL_PARTY, () => this.render());
    this.offRoster = bus.on(Events.SOCIAL_ROSTER, () => this.render());
    this.render();
  }
  drawCrown(g, x, y) {
    g.fillStyle(0x1a1024, 1).fillRect(x - 1, y - 1, 9, 7);
    g.fillStyle(0xffd84a, 1).fillRect(x, y + 2, 7, 3).fillRect(x, y, 1, 2).fillRect(x + 3, y, 1, 2).fillRect(x + 6, y, 1, 2);
    g.fillStyle(0xe8564a, 1).fillRect(x + 3, y + 3, 1, 1);
  }
  render() {
    this.c.removeAll(true);
    const party = social.party;
    if (!party || party.members.length < 2) { this.frames = []; return; }
    const W = 150, H = 34, GAP = 4;
    const g = this.scene.add.graphics();
    this.c.add(g);
    const head = this.scene.add.text(2, 0, `PARTY ${party.members.length}/5`, F(8, '#a0c4f0', { stroke: '#1a1024', strokeThickness: 3 }));
    this.c.add(head);
    if (party.leader === social.id) this.drawCrown(g, head.width + 6, 2);
    let y = 12; let i = 0;
    for (const m of party.members) {
      if (m.id === social.id) continue;
      const fy = y + i * (H + GAP);
      g.fillStyle(0x1a1024, 0.95).fillRect(0, fy, W, H);
      g.fillStyle(0x2a1d10, 0.95).fillRect(1, fy + 1, W - 2, H - 2);
      g.lineStyle(1, 0x8a5a2b, 1).strokeRect(0.5, fy + 0.5, W - 1, H - 1);
      const icon = JOB_ICON[m.job] || 'hud.slash';
      if (this.scene.textures.exists(icon)) this.c.add(this.scene.add.image(11, fy + 12, icon).setOrigin(0.5));
      const isLeader = m.id === party.leader;
      const lv = m.level ? ` Lv${m.level}` : '';
      const name = this.scene.add.text(22, fy + 4, `${m.name}${lv}`, F(8, isLeader ? '#ffd84a' : '#fff8e0'));
      this.c.add(name);
      if (isLeader) this.drawCrown(g, 22 + name.width + 4, fy + 5);
      // HP / MP bars (unknown status -> dim full bars until the first party-status lands)
      const bw = W - 30, bx = 22;
      const hpF = m.maxHp ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 1;
      const mpF = m.maxMp ? Math.max(0, Math.min(1, m.mp / m.maxMp)) : 1;
      const known = !!m.maxHp;
      g.fillStyle(0x3a1014, 1).fillRect(bx, fy + 16, bw, 6);
      g.fillStyle(hpF > 0.35 ? 0x4cc060 : 0xe74c3c, known ? 1 : 0.35).fillRect(bx, fy + 16, Math.round(bw * hpF), 6);
      g.fillStyle(0x0c1a3a, 1).fillRect(bx, fy + 24, bw, 4);
      g.fillStyle(0x3a9cf0, known ? 1 : 0.35).fillRect(bx, fy + 24, Math.round(bw * mpF), 4);
      if (known) this.c.add(this.scene.add.text(bx + bw - 2, fy + 16, `${m.hp}/${m.maxHp}`, F(7, '#ffffff', { stroke: '#1a1024', strokeThickness: 2 })).setOrigin(1, 0));
      // far-away marker: member not near us (no puppet or > 2 screens)
      const r = social.world?.sync?.remotes?.get(m.id);
      const me = social.world?.player;
      if (me && (!r || Math.hypot(r.x - me.x, r.y - me.y) > 700)) this.c.add(this.scene.add.text(W - 4, fy + 4, 'far', F(7, '#8a7a60')).setOrigin(1, 0));
      const hit = this.scene.add.zone(0, fy, W, H).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', (p) => social.act('contextMenu', { id: m.id, name: m.name, x: p.event?.clientX ?? p.x, y: p.event?.clientY ?? p.y }));
      this.c.add(hit);
      i++;
    }
  }
  destroy() { this.off(); this.offRoster(); this.c.destroy(); }
}
