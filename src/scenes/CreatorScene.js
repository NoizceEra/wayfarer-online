import Phaser from 'phaser';
import { JOBS } from '../data/jobs.js';
import { SKINS, HAIR_STYLES, HAIR_COLORS, TOPS, ACCESSORIES, WEAPONS, defaultHero } from '../data/customization.js';
import { CONFIG } from '../config.js';
import { saveHero, loadHero } from '../core/save.js';
import { audio } from '../systems/audio.js';
import { ModularPlayer } from '../entities/ModularPlayer.js';

// Character Creator: job cards + modular layers + live preview + palette.
// Larger customization surface than Lanternfall's 4 fixed classes.
export class CreatorScene extends Phaser.Scene {
  constructor() { super('creator'); }
  init(data) { this.mode = data.mode || 'solo'; this.pname = data.name || 'Pip'; }
  create() {
    const { width: W } = this.scale;
    this.cameras.main.setBackgroundColor('#1a1c2c');
    this.hero = { ...defaultHero(), ...(loadHero() || {}), name: this.pname };

    this.add.text(W / 2, 26, 'CREATE YOUR WAYFARER', { fontSize: '24px', color: '#f4f4f4', fontStyle: 'bold' }).setOrigin(0.5);

    // Preview: live sprite + dialogue portrait
    this.preview = new ModularPlayer(this, W / 2, 150, this.hero);
    this.preview.body.setEnable(false);
    this.tweens.add({ targets: this.preview, y: 154, duration: 800, yoyo: true, repeat: -1, ease: 'sine.inout' });
    this.portrait = this.add.image(W / 2 - 90, 140, 'face.Knight').setScale(2);
    this.nameLabel = this.add.text(W / 2, 190, '', { fontSize: '14px', color: '#9bbc0f' }).setOrigin(0.5);
    this.drawPortrait = () => {
      const map = { knight: 'face.Knight', mangreen: 'face.ManGreen', sorcererorange: 'face.SorcererOrange', ninjadark: 'face.NinjaDark' };
      const key = map[this.hero.body] || 'face.Knight';
      if (this.textures.exists(key)) this.portrait.setTexture(key);
    };
    this.drawPortrait();

    let y = 220;
    const row = (label, values, get, set) => {
      this.add.text(40, y, label, { fontSize: '13px', color: '#8bac0f' });
      const cur = () => values.findIndex((v) => v.id === get());
      const t = this.add.text(W / 2, y + 18, '', { fontSize: '16px', color: '#fff', backgroundColor: '#00000066', padding: { x: 10, y: 6 }, fixedWidth: 360, align: 'center' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const draw = () => {
        const i = cur();
        t.setText(`◀ ${values[i].name} ▶  (${i + 1}/${values.length})`);
        this.nameLabel.setText(`${this.hero.name} · ${JOBS[this.hero.job].name}`);
      };
      t.on('pointerdown', (p) => {
        audio.play('ui', 0.7);
        const i = cur();
        const d = p.x < t.x ? -1 : 1;
        const n = values[(i + d + values.length) % values.length];
        set(n.id); draw(); this.preview.applyHero(this.hero); this.drawPortrait();
      });
      draw(); y += 52;
      return draw;
    };

    const jobVals = Object.values(JOBS).map((j) => ({ id: j.id, name: j.name }));
    row('JOB', jobVals, () => this.hero.job, (v) => { this.hero.job = v; const j = JOBS[v]; this.hero.body = j.body; this.hero.weapon = j.weapon; });
    row('SKIN', SKINS, () => this.hero.skin, (v) => (this.hero.skin = v));
    row('HAIR', HAIR_STYLES, () => this.hero.hair, (v) => (this.hero.hair = v));
    row('HAIR COLOR', HAIR_COLORS, () => this.hero.hairColor, (v) => (this.hero.hairColor = v));
    row('OUTFIT', TOPS, () => this.hero.top, (v) => (this.hero.top = v));
    row('CHARM', ACCESSORIES, () => this.hero.accessory, (v) => (this.hero.accessory = v));
    row('WEAPON', WEAPONS, () => this.hero.weapon, (v) => (this.hero.weapon = v));
    const palVals = CONFIG.palettes.map((p) => ({ id: p, name: p }));
    row('GAME BOY', palVals, () => this.hero.palette, (v) => (this.hero.palette = v));

    this.add.text(W / 2, y + 6, JOBS[this.hero.job].desc, { fontSize: '12px', color: '#aaa', align: 'center', wordWrap: { width: 420 } }).setOrigin(0.5);
    const start = this.add.text(W / 2, y + 44, this.mode === 'solo' ? '▶  ENTER EMBERVALE' : this.mode === 'host' ? '▶  OPEN ROOM & ENTER' : '▶  JOIN WORLD', { fontSize: '20px', color: '#0f380f', backgroundColor: '#9bbc0f', padding: { x: 24, y: 10 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    start.on('pointerdown', () => {
      audio.play('level');
      saveHero(this.hero);
      audio.stopMusic();
      this.scene.start('world', { hero: this.hero, mode: this.mode, name: this.pname });
    });
  }
}
