import Phaser from 'phaser';

// Puppet for other players in the room (host-relay: positions only).
// Uses the same char.* sprite + name label; hero body syncs when provided.
const BODY_TEX = { knight: 'Knight', mangreen: 'ManGreen', sorcererorange: 'SorcererOrange', ninjadark: 'NinjaDark' };

export class RemotePlayer extends Phaser.GameObjects.Container {
  constructor(scene, name, hero) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.rname = name;
    this.facing = 'down';
    const body = BODY_TEX[hero?.body] || 'Knight';
    this.texKey = scene.textures.exists(`char.${body}`) ? `char.${body}` : 'char.Knight';
    this.shadow = scene.add.image(0, 3, 'char.shadow').setScale(1.4, 1);
    this.sprite = scene.add.sprite(0, -8, this.texKey, 0);
    this.label = scene.add.text(0, -26, name, { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#fff', backgroundColor: '#00000088' }).setOrigin(0.5);
    this.add([this.shadow, this.sprite, this.label]);
    this.setDepth(9);
    this.target = { x: 0, y: 0 };
  }
  remoteSet(x, y, facing, hp) {
    this.target.x = x; this.target.y = y;
    if (typeof hp === 'number') this.hp = hp;
    if (facing && facing !== this.facing) {
      this.facing = facing;
      const key = `${this.texKey}.idle.${facing}`;
      if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    }
  }
  setHero(hero) {
    const body = BODY_TEX[hero?.body] || 'Knight';
    const key = this.scene.textures.exists(`char.${body}`) ? `char.${body}` : 'char.Knight';
    if (key !== this.texKey) {
      this.texKey = key;
      this.sprite.setTexture(key, 0);
      const idle = `${key}.idle.${this.facing}`;
      if (this.scene.anims.exists(idle)) this.sprite.play(idle, true);
    }
  }
  update() {
    const dx = this.target.x - this.x, dy = this.target.y - this.y;
    const d = Math.hypot(dx, dy);
    const moving = d > 3;
    const key = `${this.texKey}.${moving ? 'walk' : 'idle'}.${this.facing}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    this.x += dx * 0.18;
    this.y += dy * 0.18;
    this.setDepth(this.y); // y-sort with world
  }
}
