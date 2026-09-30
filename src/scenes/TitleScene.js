import Phaser from 'phaser';
import { loadProfile, saveProfile, loadHero } from '../core/save.js';
import { net } from '../net/NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { setupMenuCamera } from '../core/display.js';

// Title screen — pixel-art Game Boy aesthetic.
// Fonts: Jacquard12 (display title), Silkscreen (buttons/labels), PixelifySans (body/hints).
// Layout: proportional to H so it holds across window sizes.
export class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }

  create() {
    audio.attach(this);
    audio.musicFor('title');

    this.cameras.main.setBackgroundColor('#0f380f');
    // Integer-zoomed, centered logical layout (640x560 max) — see core/display.js
    const { W, H } = setupMenuCamera(this, { minW: 360, minH: 420, maxW: 640, maxH: 560, data: this.sys.settings.data });

    const prof   = loadProfile() || { name: '' };
    const small  = W < 560;
    const bw     = Math.min(300, W - 40); // button / field width
    const bh     = small ? 30 : 38;       // button height

    // ─── Proportional Y positions ──────────────────────────────────────
    const titleY    = Math.round(H * 0.13);
    const subY      = Math.round(H * 0.22);
    const labelY    = Math.round(H * 0.30);
    const fieldY    = Math.round(H * 0.38);
    const divY      = Math.round(H * 0.46);
    const b1Y       = Math.round(H * 0.54);
    const bSpacing  = Math.max(40, Math.round(H * 0.115));

    // ─── Helper: bordered button with drop-shadow ──────────────────────
    // Returns the background rectangle (for hover-state testing if needed).
    const btn = (y, label, cb) => {
      const x = W / 2;

      // Drop-shadow
      this.add.rectangle(x + 3, y + 3, bw, bh, 0x0a1e0a).setOrigin(0.5);

      // Button body
      const bg = this.add.rectangle(x, y, bw, bh, 0x8bac0f).setOrigin(0.5);

      // 2-px top highlight to give depth
      this.add.rectangle(x, y - Math.round(bh / 2) + 2, bw - 6, 2, 0xb4cc22, 0.55)
        .setOrigin(0.5, 0.5);

      // Darker border (1-px stroke via Graphics)
      const g = this.add.graphics();
      g.lineStyle(2, 0x306230, 1);
      g.strokeRect(x - bw / 2, y - bh / 2, bw, bh);

      // Label text — no fixedWidth so nothing clips
      this.add.text(x, y, label, {
        fontSize: small ? '12px' : '16px',
        color: '#0f380f',
        fontFamily: '"Silkscreen"',
        align: 'center',
      }).setOrigin(0.5);

      // Invisible zone covering full button area handles all pointer events
      const zone = this.add.zone(x, y, bw, bh).setOrigin(0.5).setInteractive({ useHandCursor: true });
      zone.on('pointerover',  () => bg.setFillStyle(0x9bbc0f));
      zone.on('pointerout',   () => bg.setFillStyle(0x8bac0f));
      zone.on('pointerdown',  () => { audio.ui(); bg.setFillStyle(0x6a8c0f); cb(); });

      return bg;
    };

    // ─── Title ────────────────────────────────────────────────────────
    this.add.text(W / 2, titleY, 'WAYFARER ONLINE', {
      fontSize: small ? '34px' : '56px',
      color: '#9bbc0f',
      fontFamily: '"Jacquard12"',
    }).setOrigin(0.5);

    this.add.text(W / 2, subY, 'a cozy open world  ~  solo or together', {
      fontSize: small ? '10px' : '13px',
      color: '#8bac0f',
      fontFamily: '"PixelifySans"',
    }).setOrigin(0.5);

    // ─── Name field ───────────────────────────────────────────────────
    this.add.text(W / 2 - bw / 2, labelY, 'WAYFARER NAME', {
      fontSize: small ? '9px' : '11px',
      color: '#6b8c0f',
      fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5);

    const fieldH = small ? 28 : 34;
    // Shadow
    this.add.rectangle(W / 2 + 3, fieldY + 3, bw, fieldH, 0x0a1e0a).setOrigin(0.5);
    // Border
    const gField = this.add.graphics();
    gField.lineStyle(2, 0x306230, 1);
    gField.strokeRect(W / 2 - bw / 2, fieldY - fieldH / 2, bw, fieldH);
    // Fill
    this.add.rectangle(W / 2, fieldY, bw - 4, fieldH - 4, 0x9bbc0f).setOrigin(0.5);

    const nameText = this.add.text(W / 2 - bw / 2 + 10, fieldY, prof.name || 'Pip', {
      fontSize: small ? '14px' : '18px',
      color: '#0f380f',
      fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5);

    // Blinking cursor
    const cursor = this.add.text(0, fieldY, '_', {
      fontSize: small ? '14px' : '18px',
      color: '#0f380f',
      fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5);
    this.time.addEvent({ delay: 530, loop: true, callback: () => { cursor.setVisible(!cursor.visible); } });

    const syncCursor = () => {
      cursor.setX(W / 2 - bw / 2 + 10 + nameText.displayWidth + 2);
    };
    syncCursor();

    // Full-width click zone for name field
    const nameZone = this.add.zone(W / 2, fieldY, bw, fieldH).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const editName = () => {
      const v = window.prompt('Wayfarer name (max 14 chars):', nameText.text) || nameText.text;
      nameText.setText(v.slice(0, 14));
      syncCursor();
    };
    nameZone.on('pointerdown', () => { audio.ui(); editName(); });

    // ─── Divider ──────────────────────────────────────────────────────
    const gDiv = this.add.graphics();
    gDiv.lineStyle(1, 0x306230, 0.6);
    gDiv.lineBetween(W / 2 - bw / 2, divY, W / 2 + bw / 2, divY);

    // ─── Action buttons ───────────────────────────────────────────────
    this.toast = this.add.text(W / 2, H - 44, '', {
      fontSize: small ? '10px' : '12px',
      color: '#ffdddd',
      backgroundColor: '#00000099',
      padding: { x: 8, y: 4 },
      fontFamily: '"PixelifySans"',
    }).setOrigin(0.5).setVisible(false);
    const say = (s) => { this.toast.setText(s); this.toast.setVisible(!!s); };

    const goWorld = (mode) => {
      const name = (nameText.text || 'Pip').slice(0, 14);
      saveProfile({ name });
      this.scene.start('creator', { name, mode });
    };

    btn(b1Y,                    loadHero() ? '> Continue Journey'  : '> New Journey', () => goWorld('solo'));
    btn(b1Y + bSpacing,         '+ Host Co-op',                    async () => {
      const name = (nameText.text || 'Pip').slice(0, 14);
      saveProfile({ name });
      say('Creating room...');
      try {
        const hero = loadHero() || { name, job: 'wayfarer' };
        const id   = await net.host(name, hero);
        say(`Room ${id.slice(-5).toUpperCase()} -- tell friends! Starting...`);
        setTimeout(() => this.scene.start('creator', { name, mode: 'host' }), 600);
      } catch (e) { say(`Host failed: ${e.message} (server up? try Solo)`); audio.error(); }
    });
    btn(b1Y + bSpacing * 2,    '~ Join Co-op (enter code)',        async () => {
      const name = (nameText.text || 'Pip').slice(0, 14);
      saveProfile({ name });
      const code = window.prompt('Room code (5 letters):', '') || '';
      if (!code) return;
      say('Joining...');
      try {
        const hero = loadHero() || { name, job: 'wayfarer' };
        await net.join(code.trim(), name, hero);
        this.scene.start('creator', { name, mode: 'guest' });
      } catch (e) { say(`Join failed: ${e.message}`); audio.error(); }
    });
    btn(b1Y + bSpacing * 3,    '* Character Creator',              () => goWorld(net.connected ? (net.isHost ? 'host' : 'guest') : 'solo'));

    // ─── Help text ────────────────────────────────────────────────────
    this.add.text(W / 2, H - 20, 'WASD move  J atk  E talk  Enter play  CC0 assets', {
      fontSize: '9px',
      color: '#306230',
      fontFamily: '"Silkscreen"',
      align: 'center',
      wordWrap: { width: W - 24 },
    }).setOrigin(0.5);

    // ─── Keyboard shortcuts ───────────────────────────────────────────
    this.input.keyboard.on('keydown-ENTER', () => goWorld('solo'));
    this.input.keyboard.on('keydown-C',     () => goWorld(net.connected ? (net.isHost ? 'host' : 'guest') : 'solo'));

    bus.emit(Events.SYSTEM, 'title');
  }
}
