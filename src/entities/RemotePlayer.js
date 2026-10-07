import Phaser from 'phaser';
import { ModularPlayer } from './ModularPlayer.js';
import { defaultHero } from '../data/customization.js';
import { SnapBuffer } from '../net/interp.js';
import { social } from '../systems/social/index.js';
import { agentsNet, AGENT_PLATE_COLOR, AGENT_PLATE_BG, agentPlateText } from '../net/agentsNet.js';

// Relation backgrounds for REAL players (unchanged). An agent plate overrides
// both colour and background with the agentsNet palette so it cannot be
// confused with party/friend/guild/other. Hoisted (not rebuilt per refresh).
const REL_BG = { party: '#0b2a10cc', friend: '#2a1020cc', guild: '#2a2210cc', other: '#00000088' };

// Puppet for other players in the room.
// The avatar is a physics-free ModularPlayer, so a remote hero wears exactly
// what its owner wears: skin/hair/face, worn gear for all four facings, dyes,
// weapon. The hero payload (`{...hero, equipped, dyes}`) arrives via the
// 'peer-join' / 'hero' messages.
//
// Motion is snapshot-interpolated: WorldSync pushes server-timestamped
// samples (pushSample) and calls update(renderTime, myArea) every frame.
// The avatar lives directly in the scene (not inside this container) so its
// weapon swing FX spawn at the right world position; the container only
// carries the nameplate (UIScene/WorldScene nameplate code uses r.label).
export class RemotePlayer extends Phaser.GameObjects.Container {
  constructor(scene, name, hero) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.rname = name;
    this.facing = 'down';
    this.ag = false; // autonomous-agent peer (set by world.js from agentsNet.isAgent)
    this.avatar = new ModularPlayer(scene, 0, 0, { ...defaultHero(), ...(hero || {}) }, { remote: true });
    this.avatar.noDust = true;
    this.avatar.shadow.setScale(1.4, 1);
    this.label = scene.add.text(0, -28, name, { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#fff', backgroundColor: '#00000088' }).setOrigin(0.5);
    // Agent-only sprite marker: a small cyan gem above the head, invisible for
    // real players so a player's puppet is byte-for-byte what it was before.
    this.agentMark = scene.add.rectangle(0, -20, 5, 5, 0x00e5ff).setStrokeStyle(1, 0x06283d).setAngle(45).setVisible(false);
    this.add([this.label, this.agentMark]);
    this.setDepth(9);
    this.buf = new SnapBuffer();
    this.moving = false; this.movingFlag = 0;
    this.area = 'ow'; this.otherArea = false;
    this.lastOw = null;   // last overworld position (minimap while the peer is inside)
    this.dc = false;
    this.hp = 100;
    this.placed = false;
  }

  // server-time sample; x/y may be undefined for facing-only updates
  pushSample(t, x, y, facing, moving) {
    if (facing && facing !== this.facing) { this.facing = facing; this.avatar.setFacing(facing); }
    if (moving !== undefined) this.movingFlag = moving ? 1 : 0;
    if (x === undefined || y === undefined) return;
    this.buf.push(t, x, y);
    if (this.area === 'ow') this.lastOw = { x, y };
    if (!this.placed) { this.placed = true; this.setPos(x, y); }
  }
  setArea(a) {
    if (a === this.area) return;
    this.area = a; this.buf.clear(); this.placed = false;
  }
  setDisconnected(dc) { this.dc = !!dc; this.refreshPlate(); }
  // Called by the world social layer with agentsNet.isAgent(id) for this remote.
  // No-op when unchanged (the 1.5s refreshPlates sweep calls it for every
  // remote), so it costs one boolean compare in the steady state.
  setAgent(v) {
    v = !!v;
    if (v === this.ag) return;
    this.ag = v;
    this.agentMark?.setVisible(v);
    this.refreshPlate();
  }
  refreshPlate() {
    let text, color = '#ffffff', bg = REL_BG.other;
    if (!social?.plateFor) {
      text = this.dc ? `${this.rname} (lag)` : this.rname;
    } else {
      const p = social.plateFor(this.rname, this.rname, { lag: this.dc });
      text = p.text; color = p.color; bg = REL_BG[p.rel] || REL_BG.other;
    }
    // An agent is badged + recoloured; real players keep their exact plate.
    if (this.ag) { text = agentPlateText(text); color = AGENT_PLATE_COLOR; bg = AGENT_PLATE_BG; }
    this.label.setText(text);
    this.label.setColor(color);
    this.label.setBackgroundColor(bg);
  }

  // legacy direct set (old 'input' messages)
  remoteSet(x, y, facing, hp) {
    this.pushSample(performance.now() + 100, x, y, facing, 1);
    if (typeof hp === 'number') this.hp = hp;
  }

  setHero(hero) {
    if (!hero) return;
    this.avatar.applyHero({ ...defaultHero(), ...hero });
    this.avatar.setFacing(this.facing);
  }

  attackPose(facing) {
    if (facing && facing !== this.facing) { this.facing = facing; this.avatar.setFacing(facing); }
    if (this.visible) this.avatar.attackPose();
  }

  setPos(x, y) {
    this.x = x; this.y = y;
    this.avatar.x = x; this.avatar.y = y;
    if (this.area === 'ow') this.lastOw = { x, y };
  }

  setVisible(v) {
    super.setVisible(v);
    this.avatar?.setVisible(v);
    return this;
  }

  update(renderT, myArea = 'ow') {
    this.otherArea = this.area !== myArea;
    this.setVisible(!this.otherArea && this.placed);
    if (this.otherArea) return;
    const s = this.buf.sample(renderT, !!this.movingFlag);
    if (!s) return;
    this.setPos(s.x, s.y);
    const moving = !!(s.moving && this.movingFlag);
    if (moving !== this.moving) { this.moving = moving; this.avatar.setMoving(moving); }
    const d = Math.round(this.y);
    this.setDepth(d + 0.1); this.avatar.setDepth(d); // y-sort with world
  }

  // minimap: {x, y, grey}
  // (overworld coordinates only: a peer inside an interior/dungeon is shown
  // greyed at the spot where it left the overworld)
  mapPos() {
    if (this.area === 'ow') return this.lastOw ? { x: this.lastOw.x, y: this.lastOw.y, grey: this.otherArea } : null;
    return this.lastOw ? { x: this.lastOw.x, y: this.lastOw.y, grey: true } : null;
  }

  destroy(fromScene) {
    this.avatar?.destroy(fromScene);
    super.destroy(fromScene);
  }
}
