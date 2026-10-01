import Phaser from 'phaser';
import { audio } from '../systems/audio.js';
import { addTitleBackdrop, prefersReducedMotion } from '../systems/titleBackdrop.js';
import { setupMenuCamera } from '../core/display.js';
import { JOBS } from '../data/jobs.js';
import { wallet } from '../core/wallet.js';
import {
  listSlots, setActiveSlot, deleteSlot, renameSlot, nameTaken,
  profileId, exportBackup, importBackup, NAME_MAX,
} from '../core/slots.js';
import { randomName } from '../data/names.js';
import {
  C, FONT, txt, frame, makeButton, makeField, Nav, DomEntry, addLogo, bindTitleNav, ago, copyText,
} from '../ui/titleKit.js';

const BODY = { knight: 'Villager', mangreen: 'ManGreen', sorcererorange: 'SorcererOrange', ninjadark: 'NinjaDark' };

export class ProfileScene extends Phaser.Scene {
  constructor() { super('profile'); }

  create() {
    audio.attach(this);
    audio.musicFor('title');
    this.cameras.main.setBackgroundColor('#0f380f');
    this.persist = this.sys.settings.data && typeof this.sys.settings.data === 'object' ? this.sys.settings.data : {};
    this.sys.settings.data = this.persist;
    this.menuSize = setupMenuCamera(this, { minW: 320, minH: 320, maxW: 720, maxH: 720, data: this.persist });
    this.page = this.persist.page || 'slots';
    this.renameId = this.persist.renameId || 0;
    this.renameDraft = this.persist.renameDraft || '';
    this.deleteId = this.persist.deleteId || 0;
    this.toastMsg = this.persist.toast || this.persist.toastMsg || '';
    this.nav = new Nav();
    this.entry = new DomEntry();
    this.bd = null;
    this.logo = null;
    this.build();
    bindTitleNav(this, this.nav, {
      isOpen: () => true,
      close: () => { if (this.page !== 'slots') this.goPage('slots'); else this.scene.start('title', { page: 'home' }); },
    });
    this.events.once('shutdown', () => { this.entry.stop(true); this.bd?.destroy(); });
  }

  update(time, delta) {
    this.bd?.update(time, delta);
    this.logo?.tick?.(time);
  }

  goPage(page, extra = {}) {
    this.entry.stop(true);
    this.page = this.persist.page = page;
    Object.assign(this.persist, extra);
    Object.assign(this, extra);
    this.build();
  }

  say(s) {
    this.toastMsg = this.persist.toastMsg = s || '';
    if (this.toast?.active) { this.toast.setText(this.toastMsg); this.toast.setVisible(!!this.toastMsg); }
  }

  build() {
    this.entry.stop(true);
    this.bd?.destroy();
    if (this.root) this.root.destroy(true);
    this.root = this.add.container(0, 0);
    this.nav.clear();
    this.toast = null;
    const { W, H } = this.menuSize;
    this.bd = addTitleBackdrop(this, this.root, this.menuSize);
    this.logo = addLogo(this, this.root, W / 2, 28, { size: H < 420 ? 18 : 24, reduce: prefersReducedMotion(), sub: 'heroes on this device' });

    if (this.page === 'rename') this.buildRename(W, H);
    else if (this.page === 'delete') this.buildDelete(W, H);
    else if (this.page === 'backup') this.buildBackup(W, H);
    else this.buildSlots(W, H);

    this.toast = txt(this, this.root, W / 2, H - 34, this.toastMsg, { size: 11, font: FONT.body, color: '#ffd0c4', wrap: W - 24 }).setVisible(!!this.toastMsg);
    this.nav.first();
  }

  buildSlots(W, H) {
    const slots = listSlots();
    const linked = !!(wallet.state.linked || wallet.state.connected);
    const pid = profileId();
    txt(this, this.root, W / 2, 56, `${linked ? 'Wallet linked' : 'Guest'}  ·  ${pid}`, { size: 10, color: C.muted });

    const wide = W >= 560 && H < 620;
    const cardW = wide ? Math.min(180, (W - 48) / 3) : Math.min(320, W - 32);
    const cardH = wide ? Math.min(150, H - 160) : 70;
    slots.forEach((s, i) => {
      const x = wide ? W / 2 + (i - 1) * (cardW + 12) : W / 2;
      const y = wide ? 150 : 88 + i * (cardH + 8);
      this.drawSlot(s, x, y, cardW, cardH);
    });

    const by = H - 56;
    makeButton(this, this.root, this.nav, {
      id: 'backup', x: W / 2 - 70, y: by, w: 128, h: 26, label: 'Backup code', kind: 'ghost', size: 9,
      onClick: () => this.goPage('backup'),
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: W / 2 + 70, y: by, w: 128, h: 26, label: 'Back', kind: 'ghost', size: 10,
      onClick: () => this.scene.start('title', { page: 'home' }),
    });
  }

  drawSlot(s, x, y, w, h) {
    const hit = this.add.rectangle(x, y, w, h, s.active ? 0x163a16 : 0x0a1c10, 0.9).setStrokeStyle(2, s.active ? C.gold : C.oliveDk);
    this.root.add(hit);
    if (s.empty) {
      txt(this, this.root, x, y - 8, `Slot ${s.id}`, { size: 11, color: C.muted });
      txt(this, this.root, x, y + 10, 'Empty', { size: 10, font: FONT.body, color: C.dim });
      const it = {
        id: `slot${s.id}`, ax: x, ay: y, w, h, enabled: true, visible: true, bg: hit, hover: false,
        onClick: () => this.newInSlot(s.id),
        render: () => hit.setStrokeStyle(this.nav.focus === it ? 3 : 2, this.nav.focus === it || it.hover ? C.gold : C.oliveDk),
      };
      hit.setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => { it.hover = true; this.nav.setFocus(it, true); it.render(); });
      hit.on('pointerout', () => { it.hover = false; it.render(); });
      hit.on('pointerdown', () => this.nav.activate(it));
      this.nav.register(it); it.render();
      return;
    }
    const body = BODY[s.hero?.body] || BODY[JOBS[s.job]?.body] || 'Villager';
    const key = `char.${body}`;
    const px = x - w / 2 + 22;
    this.root.add(this.add.rectangle(px, y, 28, 36, 0x07140a).setStrokeStyle(1, C.goldDk));
    if (this.textures.exists(key)) this.root.add(this.add.sprite(px, y + 4, key, 0).setScale(1.4));
    txt(this, this.root, x - w / 2 + 42, y - 18, s.name, { size: 12, origin: [0, 0.5], color: C.gold_s });
    txt(this, this.root, x - w / 2 + 42, y - 2, `${JOBS[s.job]?.name || 'Wayfarer'} · Lv ${s.level}`, { size: 9, origin: [0, 0.5], color: C.text });
    txt(this, this.root, x - w / 2 + 42, y + 14, s.savedAt ? ago(s.savedAt) : '', { size: 8, font: FONT.body, origin: [0, 0.5], color: C.dim });
    if (s.active) txt(this, this.root, x + w / 2 - 8, y - h / 2 + 12, 'ACTIVE', { size: 8, origin: [1, 0.5], color: C.ok });

    const it = {
      id: `slot${s.id}`, ax: x, ay: y, w, h: h - 28, enabled: true, visible: true, bg: hit, hover: false,
      onClick: () => { setActiveSlot(s.id); this.scene.start('title', { page: 'home' }); },
      render: () => hit.setStrokeStyle(this.nav.focus === it ? 3 : 2, this.nav.focus === it || it.hover ? C.gold : (s.active ? C.gold : C.oliveDk)),
    };
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => { it.hover = true; this.nav.setFocus(it, true); it.render(); });
    hit.on('pointerout', () => { it.hover = false; it.render(); });
    hit.on('pointerdown', () => this.nav.activate(it));
    this.nav.register(it); it.render();

    makeButton(this, this.root, this.nav, {
      id: `ren${s.id}`, x: x - 36, y: y + h / 2 - 14, w: 64, h: 18, label: 'Rename', kind: 'ghost', size: 8,
      onClick: () => this.goPage('rename', { renameId: s.id, renameDraft: s.name }),
    });
    makeButton(this, this.root, this.nav, {
      id: `del${s.id}`, x: x + 36, y: y + h / 2 - 14, w: 64, h: 18, label: 'Delete', kind: 'danger', size: 8,
      onClick: () => this.goPage('delete', { deleteId: s.id }),
    });
  }

  newInSlot(id) {
    const name = randomName((n) => nameTaken(n));
    setActiveSlot(id, name);
    this.scene.start('title', { page: 'journey', nameDraft: name });
  }

  buildRename(W, H) {
    const { pw, cx, top, bot } = this.modal(W, H, 'RENAME HERO');
    const field = makeField(this, this.root, this.nav, this.entry, {
      id: 'name', x: cx, y: top + 80, w: Math.min(240, pw - 40), h: 30, value: this.renameDraft, max: NAME_MAX,
      pattern: /[\w \-']/, label: 'Hero name',
      onChange: (v) => { this.renameDraft = this.persist.renameDraft = v; },
    });
    makeButton(this, this.root, this.nav, {
      id: 'dice', x: cx + Math.min(240, pw - 40) / 2 + 20, y: top + 80, w: 28, h: 28, label: '?', kind: 'ghost', size: 14,
      onClick: () => { const n = randomName((nm) => nameTaken(nm, this.renameId)); this.renameDraft = n; field.setValue(n); },
    });
    makeButton(this, this.root, this.nav, {
      id: 'ok', x: cx, y: bot - 58, w: 200, h: 32, label: 'Save name', kind: 'primary',
      onClick: () => {
        const r = renameSlot(this.renameId, this.renameDraft);
        if (!r.ok) { this.say(r.error); audio.error(); return; }
        this.goPage('slots'); this.say('Renamed.');
      },
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: 200, h: 24, label: 'Cancel', kind: 'ghost', size: 10,
      onClick: () => this.goPage('slots'),
    });
  }

  buildDelete(W, H) {
    const slot = listSlots().find((s) => s.id === this.deleteId);
    const { pw, cx, top, bot } = this.modal(W, H, 'DELETE HERO');
    txt(this, this.root, cx, top + 70, slot ? `Delete ${slot.name}? Their local progress is gone.` : 'That slot is empty.', {
      size: 12, font: FONT.body, color: C.text, wrap: pw - 32,
    });
    makeButton(this, this.root, this.nav, {
      id: 'yes', x: cx, y: bot - 58, w: 200, h: 32, label: 'Delete forever', kind: 'danger',
      enabled: !!slot && !slot.empty, onClick: () => { deleteSlot(this.deleteId); this.goPage('slots'); this.say('Hero deleted.'); },
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: 200, h: 24, label: 'Keep them', kind: 'ghost', size: 10,
      onClick: () => this.goPage('slots'),
    });
  }

  buildBackup(W, H) {
    const { pw, cx, top, bot } = this.modal(W, H, 'BACKUP CODE');
    const pid = profileId();
    txt(this, this.root, cx, top + 44, `Device ${pid}. Copy the code to move heroes. Restore replaces local saves.`, {
      size: 10, font: FONT.body, color: C.muted, wrap: pw - 32,
    });
    const code = exportBackup();
    const shown = `${code.slice(0, 28)}…`;
    frame(this, this.root, cx, top + 88, Math.min(pw - 24, 420), 36, { gold: true, stud: false, alpha: 0.9 });
    txt(this, this.root, cx, top + 88, shown, { size: 9, color: C.textHi, wrap: Math.min(pw - 36, 400) });
    makeButton(this, this.root, this.nav, {
      id: 'copy', x: cx, y: top + 128, w: 200, h: 28, label: 'Copy backup code', kind: 'primary', size: 10,
      onClick: async () => { const ok = await copyText(code); this.say(ok ? 'Copied. Keep it private.' : 'Could not copy — select it yourself.'); },
    });
    makeButton(this, this.root, this.nav, {
      id: 'copyid', x: cx, y: top + 162, w: 200, h: 24, label: 'Copy profile id', kind: 'ghost', size: 9,
      onClick: async () => { const ok = await copyText(pid); this.say(ok ? 'Profile id copied.' : 'Could not copy.'); },
    });
    makeField(this, this.root, this.nav, this.entry, {
      id: 'paste', x: cx, y: top + 204, w: Math.min(pw - 40, 380), h: 28, value: '', max: 8000,
      placeholder: 'Paste a backup code to restore', label: 'Backup code',
      onCommit: (v) => this.restore(v),
    });
    makeButton(this, this.root, this.nav, {
      id: 'restore', x: cx, y: bot - 58, w: 220, h: 30, label: 'Restore backup', kind: 'normal', size: 10,
      onClick: () => {
        const v = this.nav.items.find((i) => i.id === 'paste')?.value || '';
        this.restore(v);
      },
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: 200, h: 24, label: 'Back', kind: 'ghost', size: 10,
      onClick: () => this.goPage('slots'),
    });
  }

  restore(code) {
    const r = importBackup(code);
    if (!r.ok) { this.say(r.error); audio.error(); return; }
    this.goPage('slots');
    this.say(`Restored ${r.count} hero${r.count === 1 ? '' : 'es'}.`);
  }

  modal(W, H, title) {
    const pw = Math.min(W - 20, 520), ph = Math.min(H - 48, 440);
    frame(this, this.root, W / 2, H / 2 + 8, pw, ph, { alpha: 0.92 });
    txt(this, this.root, W / 2, H / 2 + 8 - ph / 2 + 18, title, { size: 16, font: FONT.title, color: C.gold_s });
    return { pw, ph, cx: W / 2, top: H / 2 + 8 - ph / 2, bot: H / 2 + 8 + ph / 2 };
  }
}
