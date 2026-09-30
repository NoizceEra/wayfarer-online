import Phaser from 'phaser';
import { ModularPlayer } from './ModularPlayer.js';
import { defaultHero } from '../data/customization.js';

// Puppet for other players in the room (host-relay: positions + look).
// Wraps a physics-free ModularPlayer, so a remote hero wears exactly what its
// owner wears: skin/hair/face, worn gear for all four facings, dyes, weapon.
// The hero payload (`{...hero, equipped, dyes}`) arrives via the existing
// 'peer-join' / 'hero' messages — no new network message types.
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
    this.add([this.avatar, this.label]);
    this.setDepth(9);
    this.target = { x: 0, y: 0 };
    this.moving = false;
  }
  remoteSet(x, y, facing, hp) {
    this.target.x = x; this.target.y = y;
    if (typeof hp === 'number') this.hp = hp;
    if (facing && facing !== this.facing) {
      this.facing = facing;
      this.avatar.setFacing(facing);
    }
  }
  // New hero payload (creator look + equipped + dyes) from the owner.
  setHero(hero) {
    if (!hero) return;
    this.avatar.applyHero({ ...defaultHero(), ...hero });
    this.avatar.setFacing(this.facing);
  }
  update() {
    const dx = this.target.x - this.x, dy = this.target.y - this.y;
    const d = Math.hypot(dx, dy);
    // peers that changed space (interior/map warp) jump instead of gliding across the world
    if (d > 400) { this.x = this.target.x; this.y = this.target.y; return; }
    const moving = d > 3;
    if (moving !== this.moving) { this.moving = moving; this.avatar.setMoving(moving); }
    this.x += dx * 0.18;
    this.y += dy * 0.18;
    this.setDepth(this.y); // y-sort with world
  }
}
