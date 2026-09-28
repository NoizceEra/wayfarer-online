import Phaser from 'phaser';
import { loadProfile, saveProfile, loadHero } from '../core/save.js';
import { net } from '../net/NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';

// Login (name only, v1) + Solo / Host / Join. Better UX than Lanternfall:
// one screen, big buttons, room-code display, error toasts.
export class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }
  create() {
    audio.attach(this);
    audio.musicFor('title');
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor('#0f380f');
    const prof = loadProfile() || { name: '' };
    const small = W < 560;
    const bw = Math.min(320, W - 32); // button width fits phones

    this.add.text(W / 2, small ? 52 : 70, 'WAYFARER ONLINE', { fontSize: small ? '30px' : '42px', color: '#9bbc0f', fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(W / 2, small ? 78 : 100, 'a cozy open world · solo or together', { fontSize: small ? '12px' : '14px', color: '#e6f2c0' }).setOrigin(0.5);

    this.add.text(W / 2 - bw / 2, 140, 'Wayfarer name:', { fontSize: '14px', color: '#fff' });
    const nameText = this.add.text(W / 2 - bw / 2, 160, prof.name || 'Pip', { fontSize: '22px', color: '#0f380f', backgroundColor: '#9bbc0f', padding: { x: 10, y: 6 }, fixedWidth: bw }).setInteractive({ useHandCursor: true });
    this.registry.set('editName', () => {
      const v = window.prompt('Wayfarer name:', nameText.text) || nameText.text;
      nameText.setText(v.slice(0, 14));
    });
    nameText.on('pointerdown', () => { audio.ui(); this.registry.get('editName')?.(); });

    const btn = (y, label, cb) => {
      const t = this.add.text(W / 2, y, label, { fontSize: small ? '16px' : '20px', color: '#0f380f', backgroundColor: '#8bac0f', padding: { x: 14, y: 10 }, fixedWidth: bw, align: 'center' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => t.setBackgroundColor('#9bbc0f'));
      t.on('pointerout', () => t.setBackgroundColor('#8bac0f'));
      t.on('pointerdown', () => { audio.ui(); cb(); });
      return t;
    };

    this.toast = this.add.text(W / 2, H - 60, '', { fontSize: '14px', color: '#ffdddd', backgroundColor: '#00000088', padding: { x: 8, y: 4 } }).setOrigin(0.5);
    const say = (s) => this.toast.setText(s);

    const goWorld = (mode) => {
      const name = (nameText.text || 'Pip').slice(0, 14);
      saveProfile({ name });
      this.scene.start('creator', { name, mode });
    };

    btn(240, loadHero() ? '▶  Continue Journey' : '▶  New Journey (Solo)', () => goWorld('solo'));
    btn(290, '◇  Host Co-op (room code)', async () => {
      const name = (nameText.text || 'Pip').slice(0, 14);
      saveProfile({ name });
      say('Creating room…');
      try {
        const hero = loadHero() || { name, job: 'wayfarer' };
        const id = await net.host(name, hero);
        say(`Room ${id.slice(-5).toUpperCase()} — tell friends! Starting…`);
        setTimeout(() => this.scene.start('creator', { name, mode: 'host' }), 600);
      } catch (e) { say(`Host failed: ${e.message} (server up? try Solo)`); audio.error(); }
    });
    btn(340, '⬦  Join Co-op (enter code)', async () => {
      const name = (nameText.text || 'Pip').slice(0, 14);
      saveProfile({ name });
      const code = window.prompt('Room code (5 letters):', '') || '';
      if (!code) return;
      say('Joining…');
      try {
        const hero = loadHero() || { name, job: 'wayfarer' };
        await net.join(code.trim(), name, hero);
        this.scene.start('creator', { name, mode: 'guest' });
      } catch (e) { say(`Join failed: ${e.message}`); audio.error(); }
    });
    btn(390, '✎  Character Creator', () => goWorld(net.connected ? (net.isHost ? 'host' : 'guest') : 'solo'));

    this.add.text(W / 2, H - 30, 'WASD move · J attack · E talk · Enter chat · CC0 assets (see CREDITS.md)', { fontSize: '10px', color: '#9bbc0f', align: 'center', wordWrap: { width: W - 24 } }).setOrigin(0.5);
    // Keyboard: Enter = primary action (also enables automated smoke tests)
    this.input.keyboard.on('keydown-ENTER', () => goWorld('solo'));
    this.input.keyboard.on('keydown-C', () => goWorld(net.connected ? (net.isHost ? 'host' : 'guest') : 'solo'));
    bus.emit(Events.SYSTEM, 'title');
  }
}
