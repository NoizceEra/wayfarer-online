import { baseFor, statsAt, canEvolve, evolve } from '../data/pets.js';
import { audio } from '../systems/audio.js';
import { input } from '../core/input.js';
import { bus, Events } from '../core/events.js';

const FONT = '"Silkscreen", monospace';
const T = (size, color, extra = {}) => ({ fontFamily: FONT, fontSize: `${size}px`, color, ...extra });
const TYPE_COLORS = {
  fire: '#ff7040', water: '#44aadd', nature: '#66bb44', earth: '#c8a06a',
  wind: '#9bd0ff', dark: '#a060c0',
};

// Persistent pet roster. Parent must provide a setter/getter on the hero/progress object.
export class PetPanel {
  // hooks: { getRoster(): Pet[], setRoster(Pet[]): void, setActive(slot): void, save(): void }
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.isOpen = false;
    this.c = null;
    this.sel = null; // selected slot
    this.small = scene.scale.width / scene.scale.height < 1.0 || scene.scale.width < 560;
    this.nameInput = null;
  }

  get roster() { return this.hooks.getRoster() || []; }
  set roster(v) { this.hooks.setRoster(v); }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    input.pushModal('petPanel');
    this.sel = null;
    this.build();
    audio.play('ui', 0.5);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    input.popModal('petPanel');
    this.c?.destroy();
    this.c = null;
    this.nameInput?.remove();
    this.nameInput = null;
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  refresh() { if (this.isOpen) this.build(); }

  build() {
    const s = this.scene;
    this.c?.destroy();
    this.nameInput?.remove();
    this.nameInput = null;
    const { w: W, h: H } = s.view();
    const c = this.c = s.add.container(0, 0).setDepth(190);

    const pw = Math.min(W - 16, this.small ? 340 : 520);
    const ph = Math.min(H - 16, this.small ? 460 : 420);
    const ox = (W - pw) / 2;
    const oy = (H - ph) / 2;

    const panel = s.add.rectangle(ox, oy, pw, ph, 0x2a1d10, 0.98).setOrigin(0);
    const frame = s.add.graphics();
    frame.lineStyle(4, 0x8a5a2b, 1).strokeRect(ox + 2, oy + 2, pw - 4, ph - 4);
    frame.lineStyle(2, 0xd8b070, 1).strokeRect(ox + 6, oy + 6, pw - 12, ph - 12);
    c.add([panel, frame]);

    c.add(s.add.text(ox + pw / 2, oy + 18, 'PET ROSTER', T(16, '#ffe07a', { fontStyle: 'bold' })).setOrigin(0.5));

    const close = s.add.text(ox + pw - 18, oy + 14, 'X', T(12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 6, y: 2 } })).setOrigin(0.5).setDepth(191).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => { audio.play('ui', 0.5); this.close(); });
    c.add(close);

    // Pet list (up to 6)
    const listX = ox + 14;
    const listY = oy + 44;
    const listW = this.small ? pw - 28 : 220;
    const rowH = 52;
    this.roster.slice(0, 6).forEach((p, i) => this._buildRow(s, c, p, i, listX, listY + i * rowH, listW, rowH - 4));
    if (!this.roster.length) {
      c.add(s.add.text(listX + listW / 2, listY + 40, 'No pets yet.\nCatch wild pets in the world!', T(9, '#8a7a6a', { align: 'center' })).setOrigin(0.5));
    }

    // Detail pane
    const detX = this.small ? listX : listX + listW + 12;
    const detY = this.small ? listY + Math.min(6, this.roster.length) * rowH + 8 : listY;
    const detW = this.small ? listW : pw - listW - 40;
    const detH = this.small ? ph - (detY - oy) - 14 : ph - 58;
    this._buildDetail(s, c, this.sel, detX, detY, detW, detH);
  }

  _buildRow(s, c, p, i, x, y, w, h) {
    const def = baseFor(p.id);
    const isActive = i === (this.hooks.getActiveSlot?.() ?? 0);
    const bg = s.add.rectangle(x + w / 2, y + h / 2, w, h, isActive ? 0x35451c : 0x1a1510, 0.95)
      .setStrokeStyle(2, this.sel?.slot === p.slot ? 0xffe07a : (isActive ? 0x7dff9a : 0x4a3a2a))
      .setInteractive({ useHandCursor: true });
    c.add(bg);

    const spriteKey = def?.sprite || null;
    let icon = null;
    if (spriteKey && s.textures.exists(spriteKey)) {
      icon = s.add.image(x + 18, y + h / 2, spriteKey).setScale(1.6);
    } else if (spriteKey && s.textures.exists(`mon.${spriteKey}`)) {
      icon = s.add.image(x + 18, y + h / 2, `mon.${spriteKey}`).setScale(1.6);
    } else {
      icon = s.add.rectangle(x + 18, y + h / 2, 24, 24, def?.tint || 0x888888).setStrokeStyle(1, 0x000000);
    }
    c.add(icon);

    const typeCol = TYPE_COLORS[def?.type] || '#999';
    const nameT = s.add.text(x + 42, y + 8, p.name || p.id, T(10, isActive ? '#7dff9a' : '#e6f2c0', { fontStyle: 'bold' })).setOrigin(0);
    const metaT = s.add.text(x + 42, y + 24, `Lv ${p.level} ${def?.type || ''}  HP ${Math.ceil(p.hp)}/${p.stats.hp}`, T(8, typeCol)).setOrigin(0);
    c.add([nameT, metaT]);

    bg.on('pointerover', () => bg.setFillStyle(0x2a2520));
    bg.on('pointerout', () => bg.setFillStyle(isActive ? 0x35451c : 0x1a1510));
    bg.on('pointerdown', () => {
      audio.play('ui', 0.4);
      this.sel = p;
      this.build();
    });
  }

  _buildDetail(s, c, p, x, y, w, h) {
    const box = s.add.rectangle(x + w / 2, y + h / 2, w, h, 0x10140f, 0.9).setStrokeStyle(2, 0x4a3a2a);
    c.add(box);

    // Add a small token-rename button in the detail pane.
    if (p) {
      const renameBtn = s.add.text(x + w - 10, y + 10, '\u270e', T(12, '#ffe07a')).setOrigin(1, 0).setInteractive({ useHandCursor: true });
      renameBtn.setText('Rename (10 tokens)');
      renameBtn.setFontSize('8px');
      renameBtn.on('pointerdown', () => {
        audio.play('ui', 0.4);
        const input = this.nameInput;
        const name = input?.value.trim();
        if (!name || name.length > 24) { bus.emit(Events.SYSTEM, 'Pet name must be 1-24 characters.'); return; }
        // Fire-and-forget spend; server will confirm. On success we apply locally
        // through the token-spend-ok handler in economyNet.
        import('../net/economyNet.js').then(({ econ }) => {
          econ.spendTokens('pet-rename', 10, { petId: p.id || p.slot, name });
        });
      });
      c.add(renameBtn);
    }

    if (!p) {
      c.add(s.add.text(x + w / 2, y + h / 2, 'Select a pet to manage\n(nickname, release, set active).', T(9, '#6f6a5a', { align: 'center' })).setOrigin(0.5));
      return;
    }

    const def = baseFor(p.id);
    const nextXp = (lvl) => Math.round(40 + lvl * lvl * 1.2);
    const xpFrac = Math.min(1, (p.xp || 0) / Math.max(1, nextXp(p.level)));

    c.add(s.add.text(x + w / 2, y + 14, p.name || p.id, T(13, '#ffe07a', { fontStyle: 'bold' })).setOrigin(0.5));
    c.add(s.add.text(x + w / 2, y + 32, `${def?.type?.toUpperCase() || ''}  Lv ${p.level}  XP ${p.xp || 0}/${nextXp(p.level)}`, T(8, TYPE_COLORS[def?.type] || '#999')).setOrigin(0.5));

    // XP bar
    const barW = w - 24;
    c.add(s.add.rectangle(x + 12, y + 48, barW, 6, 0x2a2008, 1).setOrigin(0));
    c.add(s.add.rectangle(x + 12, y + 48, barW * xpFrac, 6, 0xffd84a, 1).setOrigin(0));

    // Stats
    const stats = p.stats || statsAt(p.id, p.level);
    const lines = [
      `HP  ${stats.hp}`,
      `ATK ${stats.atk}`,
      `DEF ${stats.def}`,
      `SPD ${stats.spd}`,
    ];
    lines.forEach((line, i) => {
      c.add(s.add.text(x + 14 + (i % 2) * (w / 2 - 10), y + 70 + Math.floor(i / 2) * 16, line, T(9, '#e6f2c0')).setOrigin(0));
    });

    // Nickname input (DOM, positioned over the panel)
    this._makeNameInput(s, x + 14, y + 118, w - 28, p);

    // Buttons
    const mkBtn = (bx, by, bw, bh, label, col, cb) => {
      const r = s.add.rectangle(bx + bw / 2, by + bh / 2, bw, bh, 0x1a1510).setStrokeStyle(2, col).setInteractive({ useHandCursor: true });
      const t = s.add.text(bx + bw / 2, by + bh / 2, label, T(9, col, { fontStyle: 'bold' })).setOrigin(0.5);
      r.on('pointerover', () => r.setFillStyle(0x2a2520));
      r.on('pointerout', () => r.setFillStyle(0x1a1510));
      r.on('pointerdown', () => { audio.play('ui', 0.5); cb(); });
      c.add([r, t]);
    };

    const btnY = y + 154;
    const btnW = this.small ? (w - 36) / 2 : 90;
    mkBtn(x + 12, btnY, btnW, 26, 'SET ACTIVE', '#7dff9a', () => this._setActive(p.slot));
    mkBtn(x + 18 + btnW, btnY, btnW, 26, 'RELEASE', '#ff7a6a', () => this._release(p));
    if (canEvolve(p)) {
      mkBtn(x + 12, btnY + 34, btnW * 2 + 6, 26, 'EVOLVE', '#ffe07a', () => this._evolve(p));
    }
  }

  _makeNameInput(s, x, y, w, p) {
    if (typeof document === 'undefined') return;
    const canvas = s.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    const z = s.uiZoom || 1;
    const screenX = rect.left + x * scaleX * z;
    const screenY = rect.top + y * scaleY * z;
    const screenW = w * scaleX * z;
    const input = document.createElement('input');
    input.value = p.name || p.id;
    input.maxLength = 14;
    input.style.position = 'fixed';
    input.style.left = `${screenX}px`;
    input.style.top = `${screenY}px`;
    input.style.width = `${screenW}px`;
    input.style.fontFamily = 'Silkscreen, monospace';
    input.style.fontSize = '11px';
    input.style.color = '#e6f2c0';
    input.style.background = '#1a1510';
    input.style.border = '2px solid #8a5a2b';
    input.style.padding = '4px';
    input.style.zIndex = '100';
    input.style.outline = 'none';
    input.addEventListener('change', () => this._rename(p, input.value.trim()));
    document.body.appendChild(input);
    this.nameInput = input;
  }

  _rename(p, name) {
    if (!name) return;
    // Token rename: if the name came from the premium rename flow it is already
    // paid; otherwise this is the free inline rename from the panel input.
    const free = !this._renamePaid;
    if (free && name === (p.name || p.id)) return;
    p.name = name;
    this._renamePaid = false;
    this._persist();
    this.build();
    bus.emit(Events.SYSTEM, `Pet renamed to ${name}.`);
  }

  renameWithToken(p, name) {
    this._renamePaid = true;
    this._rename(p, name);
  }

  _setActive(slot) {
    if (this.hooks.setActive) this.hooks.setActive(slot);
    else bus.emit(Events.SYSTEM, 'Active pet cannot be changed here.');
    this.build();
  }

  _release(p) {
    const roster = this.roster;
    const idx = roster.findIndex((x) => x.slot === p.slot);
    if (idx < 0) return;
    if (roster.length <= 1) { bus.emit(Events.SYSTEM, 'You cannot release your only pet.'); return; }
    roster.splice(idx, 1);
    // Re-assign slots so they stay dense
    roster.forEach((x, i) => { x.slot = i; });
    this.sel = null;
    this._persist();
    this.build();
    bus.emit(Events.SYSTEM, `${p.name} was released.`);
  }

  _evolve(p) {
    const evo = evolve(p);
    if (!evo) return;
    const idx = this.roster.findIndex((x) => x.slot === p.slot);
    if (idx < 0) return;
    evo.stats = statsAt(evo.id, evo.level);
    evo.hp = evo.stats.hp;
    this.roster[idx] = evo;
    this.sel = evo;
    this._persist();
    this.build();
    audio.play('level', 0.8);
    bus.emit(Events.TOAST, { title: 'Evolution!', text: `${p.name} evolved into ${evo.name || evo.id}!`, color: '#ffe07a' });
  }

  _persist() {
    this.hooks.setRoster(this.roster);
    this.hooks.save?.();
  }

  destroy() { this.close(); }
}
