import Phaser from 'phaser';
import { ModularPlayer } from './ModularPlayer.js';
import { defaultHero } from '../data/customization.js';
import { SnapBuffer } from '../net/interp.js';

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
    this.avatar = new ModularPlayer(scene, 0, 0, { ...defaultHero(), ...(hero || {}) }, { remote: true });
    this.avatar.noDust = true;
    this.avatar.shadow.setScale(1.4, 1);
    this.label = scene.add.text(0, -28, name, { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#fff', backgroundColor: '#00000088' }).setOrigin(0.5);
    this.marksLook = null;
    this.add([this.label]);
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
  setDisconnected(dc) { this.dc = !!dc; this.redrawLabel(); }

  applyLook(look) { this.marksLook = look && typeof look === 'object' ? look : null; this.redrawLabel(); }
  redrawLabel(socialText, socialColor) {
    const look = this.marksLook || {};
    const base = socialText || (this.dc ? `${this.rname} (lag)` : this.rname);
    const text = look.title ? `${base} · ${look.title}` : base;
    this.label.setText(text);
    this.label.setColor(look.color || socialColor || '#fff');
    this.label.setBackgroundColor(look.bg || '#00000088');
    if (look.frame) this.label.setStroke(look.frame, 3);
    else this.label.setStroke('#000', 0);
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
