import { baseFor, statsAt, canEvolve, evolve, PETS } from '../data/pets.js';
import { audio } from '../systems/audio.js';
import { input } from '../core/input.js';
import { bus, Events } from '../core/events.js';

const FONT = '"Silkscreen", monospace';
const T = (size, color, extra = {}) => ({ fontFamily: FONT, fontSize: `${size}px`, color, ...extra });
const TYPE_COLORS = {
  fire: '#ff7040', water: '#44aadd', nature: '#66bb44', earth: '#c8a06a',
  wind: '#9bd0ff', dark: '#a060c0',
};
// core/save.js normalizeExtras caps the saved roster at 6; surface the rest
// instead of silently dropping them.
const MAX_ROWS = 6;

// Evolution line for a pet id, walked from its root. Data-driven from
// PETS[*].evolutions — reports the stage the pet is on and where it evolves next.
export function stageInfo(petId) {
  const byTo = new Map();
  for (const d of Object.values(PETS)) for (const e of (d.evolutions || [])) byTo.set(e.to, d.id);
  let root = petId;
  for (let i = 0; i < 8 && byTo.has(root); i++) root = byTo.get(root);
  const chain = [root];
  for (let i = 0; i < 8; i++) {
    const nx = (PETS[chain[chain.length - 1]]?.evolutions || [])[0];
    if (!nx || chain.includes(nx.to)) break;
    chain.push(nx.to);
  }
  const idx = chain.indexOf(petId);
  const next = (PETS[petId]?.evolutions || [])[0] || null;
  return {
    stage: idx >= 0 ? idx + 1 : 1,
    total: chain.length,
    nextId: next?.to || null,
    nextName: next ? (PETS[next.to]?.name || next.to) : null,
    nextAt: next?.at ?? null,
  };
}

// Persistent pet roster. Parent must provide a setter/getter on the hero/progress object.
export class PetPanel {
  // hooks: { getRoster(): Pet[], setRoster(Pet[]): void, getActiveSlot(): number, setActive(idx): void, save(): void }
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.isOpen = false;
    this.c = null;
    this.sel = null;    // selected pet instance (kept for external callers)
    this.selIdx = null; // selected roster INDEX — never depends on p.slot
    this.small = scene.scale.width / scene.scale.height < 1.0 || scene.scale.width < 560;
    this.nameInput = null;
    this._renamePaid = false;
  }

  get roster() { return this.hooks.getRoster() || []; }
  set roster(v) { this.hooks.setRoster(v); }

  // Public roster accessors. net/NetworkManager.js calls petPanel.getRoster?.()
  // when it pushes the hero + pet snapshot to the server (used to build pet-duel
  // teams); without these the snapshot was always empty.
  getRoster() { return this.hooks.getRoster?.() || []; }
  setRoster(r) { this.hooks.setRoster?.(r); }
  activeSlot() { const v = this.hooks.getActiveSlot?.(); return Number.isFinite(v) ? v : 0; }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    input.pushModal('petPanel');
    this.sel = null;
    this.selIdx = null;
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

    const compact = this.compact = (W / H < 1.0 || W < 560);
    this.small = compact;
    const pw = Math.min(W - 12, compact ? 360 : 560);
    const ph = Math.min(H - 12, compact ? 640 : 470);
    const ox = (W - pw) / 2;
    const oy = (H - ph) / 2;
    this.rect = { x: ox, y: oy, w: pw, h: ph };

    const panel = s.add.rectangle(ox, oy, pw, ph, 0x2a1d10, 0.98).setOrigin(0);
    const frame = s.add.graphics();
    frame.lineStyle(4, 0x8a5a2b, 1).strokeRect(ox + 2, oy + 2, pw - 4, ph - 4);
    frame.lineStyle(2, 0xd8b070, 1).strokeRect(ox + 6, oy + 6, pw - 12, ph - 12);
    c.add([panel, frame]);

    const roster = this.roster;
    const title = roster.length > MAX_ROWS ? `PET ROSTER (${MAX_ROWS}/${roster.length})` : 'PET ROSTER';
    c.add(s.add.text(ox + pw / 2, oy + 16, title, T(16, '#ffe07a', { fontStyle: 'bold' })).setOrigin(0.5));

    const close = s.add.text(ox + pw - 16, oy + 14, 'X', T(12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 6, y: 2 } })).setOrigin(0.5).setDepth(191).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => { audio.play('ui', 0.5); this.close(); });
    c.add(close);

    // ── geometry: the detail pane is anchored to the panel bottom, so nothing
    // can render below the panel whatever the viewport height (it used to spill
    // off the bottom of a phone, taking the action buttons with it).
    const contentTop = oy + 38;
    const contentBottom = oy + ph - 10;
    const detH = compact ? Math.min(232, contentBottom - contentTop) : (contentBottom - contentTop);
    const listX = ox + 12;
    const listW = compact ? pw - 24 : Math.min(220, Math.round(pw * 0.4));
    const listY = contentTop;
    const detX = compact ? listX : listX + listW + 10;
    const detW = compact ? listW : pw - listW - 34;
    const detY = compact ? contentBottom - detH : contentTop;

    const shown = roster.slice(0, MAX_ROWS);
    const listAvail = Math.max(0, (compact ? detY - 8 : contentBottom) - listY);
    const minRow = 42;
    const visible = Math.min(shown.length, Math.floor(listAvail / minRow));
    const rowH = visible > 0 ? Math.min(58, Math.floor(listAvail / visible)) : minRow;

    shown.slice(0, visible).forEach((p, i) => this._buildRow(s, c, p, i, listX, listY + i * rowH, listW, rowH - 4));
    if (!roster.length) {
      c.add(s.add.text(listX + listW / 2, listY + 40, 'No pets yet.\nCatch wild pets in the world!', T(9, '#8a7a6a', { align: 'center' })).setOrigin(0.5));
    } else if (visible < shown.length) {
      c.add(s.add.text(listX + listW / 2, listY + visible * rowH + 10, `+${shown.length - visible} more (roster holds ${MAX_ROWS})`, T(8, '#c8a06a')).setOrigin(0.5));
    }

    this._buildDetail(s, c, this._selected(), detX, detY, detW, detH);
  }

  _selected() {
    const roster = this.roster;
    if (this.selIdx != null && roster[this.selIdx]) return roster[this.selIdx];
    return null;
  }

  // Accept either a roster INDEX (preferred) or a pet instance.
  _resolveIdx(ref) {
    if (typeof ref === 'number') return Number.isInteger(ref) ? ref : -1;
    if (!ref || typeof ref !== 'object') return -1;
    return this.roster.indexOf(ref);
  }

  _buildRow(s, c, p, i, x, y, w, h) {
    const def = baseFor(p.id);
    const isActive = i === this.activeSlot();
    const isSel = i === this.selIdx;
    const bg = s.add.rectangle(x + w / 2, y + h / 2, w, h, isActive ? 0x35451c : 0x1a1510, 0.95)
      .setStrokeStyle(2, isSel ? 0xffe07a : (isActive ? 0x7dff9a : 0x4a3a2a))
      .setInteractive({ useHandCursor: true });
    c.add(bg);

    // PETS[id].sprite is ALREADY a full texture key ('mon.Mouse'): resolve it raw
    // first and only then fall back to the 'mon.' prefix, then to a colour block.
    const spriteKey = def?.sprite || null;
    const scale = Math.max(1.25, Math.min(2, (h - 10) / 16));
    const iconX = x + 6 + 8 * scale;
    let icon;
    if (spriteKey && s.textures.exists(spriteKey)) {
      icon = s.add.image(iconX, y + h / 2, spriteKey).setScale(scale);
    } else if (spriteKey && s.textures.exists(`mon.${spriteKey}`)) {
      icon = s.add.image(iconX, y + h / 2, `mon.${spriteKey}`).setScale(scale);
    } else {
      icon = s.add.rectangle(iconX, y + h / 2, 8 * scale, 8 * scale, def?.tint || 0x888888).setStrokeStyle(1, 0x000000);
    }
    c.add(icon);

    const stats = p.stats || statsAt(p.id, p.level) || { hp: 1, atk: 1, def: 1, spd: 1 };
    const hp = Math.max(0, Math.ceil(Number(p.hp) ?? stats.hp));
    const typeCol = TYPE_COLORS[def?.type] || '#999';
    const tx = iconX + 8 * scale + 4;
    c.add(s.add.text(tx, y + 6, p.name || p.id, T(10, isActive ? '#7dff9a' : '#e6f2c0', { fontStyle: 'bold' })).setOrigin(0));
    c.add(s.add.text(tx, y + 20, `Lv ${p.level} ${def?.type || ''}`, T(8, typeCol)).setOrigin(0));
    c.add(s.add.text(tx, y + 31, `HP ${hp}/${stats.hp}`, T(8, hp / Math.max(1, stats.hp) > 0.35 ? '#cfe0b0' : '#ff9a8a')).setOrigin(0));

    if (isActive) c.add(s.add.text(x + w - 6, y + 5, 'ACTIVE', T(7, '#7dff9a', { fontStyle: 'bold' })).setOrigin(1, 0));
    if (canEvolve(p)) c.add(s.add.text(x + w - 6, y + 16, 'EVOLVE', T(7, '#ffe07a', { fontStyle: 'bold' })).setOrigin(1, 0));

    bg.on('pointerover', () => bg.setFillStyle(0x2a2520));
    bg.on('pointerout', () => bg.setFillStyle(isActive ? 0x35451c : 0x1a1510));
    bg.on('pointerdown', () => {
      audio.play('ui', 0.4);
      this.selIdx = i;
      this.sel = this.roster[i] || null;
      this.build();
    });
  }

  _buildDetail(s, c, p, x, y, w, h) {
    const box = s.add.rectangle(x + w / 2, y + h / 2, w, h, 0x10140f, 0.9).setStrokeStyle(2, 0x4a3a2a);
    c.add(box);

    if (!p) {
      c.add(s.add.text(x + w / 2, y + h / 2, 'Select a pet to manage\n(set active, rename, release, evolve).', T(9, '#6f6a5a', { align: 'center' })).setOrigin(0.5));
      return;
    }

    let o = this.compact
      ? { name: 14, meta: 34, bar: 50, hint: 62, s0: 84, s1: 104, cap: 126, input: 136, inH: 22, b1: 166, b2: 200, bH: 28 }
      : { name: 18, meta: 40, bar: 58, hint: 74, s0: 100, s1: 122, cap: 150, input: 162, inH: 24, b1: 200, b2: 238, bH: 30 };
    // Absurdly short viewports: scale the whole stack so it can never spill out.
    const needed = o.b2 + o.bH + 6;
    if (h < needed) {
      const k = Math.max(0.4, h / needed);
      o = Object.fromEntries(Object.entries(o).map(([key, v]) => [key, v * k]));
    }

    const def = baseFor(p.id);
    const stats = p.stats || statsAt(p.id, p.level) || { hp: 1, atk: 1, def: 1, spd: 1 };
    const hp = Math.max(0, Math.ceil(Number(p.hp) ?? stats.hp));
    const info = stageInfo(p.id);
    const nextXp = (lvl) => Math.round(40 + lvl * lvl * 1.2);
    const xpFrac = Math.min(1, (p.xp || 0) / Math.max(1, nextXp(p.level)));
    const ready = canEvolve(p);

    c.add(s.add.text(x + w / 2, y + o.name, p.name || p.id, T(this.compact ? 12 : 14, '#ffe07a', { fontStyle: 'bold' })).setOrigin(0.5));
    const stageTxt = info.total > 1 ? `Stage ${info.stage}/${info.total}` : 'Solo line';
    c.add(s.add.text(x + w / 2, y + o.meta, `${(def?.type || '?').toUpperCase()} · Lv ${p.level} · ${stageTxt}`, T(this.compact ? 8 : 9, TYPE_COLORS[def?.type] || '#999')).setOrigin(0.5));

    // XP bar
    const barW = w - 24;
    c.add(s.add.rectangle(x + 12, y + o.bar, barW, 6, 0x2a2008, 1).setOrigin(0));
    c.add(s.add.rectangle(x + 12, y + o.bar, barW * xpFrac, 6, 0xffd84a, 1).setOrigin(0));

    const hint = ready
      ? `XP ${p.xp || 0}/${nextXp(p.level)} · READY TO EVOLVE`
      : (info.nextName ? `XP ${p.xp || 0}/${nextXp(p.level)} · \u2192 ${info.nextName} @ Lv${info.nextAt}` : `XP ${p.xp || 0}/${nextXp(p.level)} · final form`);
    c.add(s.add.text(x + w / 2, y + o.hint, hint, T(8, ready ? '#ffe07a' : '#b9a98a')).setOrigin(0.5));

    // stats: current/max HP plus the rest
    const col2 = x + Math.round(w / 2) + 6;
    [['HP ' + hp + '/' + stats.hp, x + 14, y + o.s0],
      ['ATK ' + stats.atk, col2, y + o.s0],
      ['DEF ' + stats.def, x + 14, y + o.s1],
      ['SPD ' + stats.spd, col2, y + o.s1]]
      .forEach(([t, lx, ly]) => c.add(s.add.text(lx, ly, t, T(this.compact ? 9 : 10, '#e6f2c0')).setOrigin(0)));

    // nickname input (DOM, positioned over the panel)
    c.add(s.add.text(x + 14, y + o.cap, 'NICKNAME (free)', T(7, '#8a7a6a')).setOrigin(0));
    this._makeNameInput(s, x + 14, y + o.input, w - 28, p);

    // Buttons. Disabled states are REAL (no hit area + dimmed), so a tap can
    // never fire a pointless action (the old RELEASE always looked live).
    const bw = Math.floor((w - 40) / 2);
    const isActive = this.selIdx === this.activeSlot();
    this._mkBtn(s, c, x + 12, y + o.b1, bw, o.bH, 'SET ACTIVE', '#7dff9a', () => this._setActive(this.selIdx), isActive);
    this._mkBtn(s, c, x + 18 + bw, y + o.b1, bw, o.bH, 'RELEASE', '#ff7a6a', () => this._release(this.selIdx), this.roster.length <= 1);

    let r2 = x + 12;
    let r2w = bw;
    if (ready) {
      this._mkBtn(s, c, r2, y + o.b2, r2w, o.bH, 'EVOLVE', '#ffe07a', () => this._evolve(this.selIdx), false);
      r2 += bw + 6;
    } else {
      r2w = bw * 2 + 6;
    }
    this._mkBtn(s, c, r2, y + o.b2, r2w, o.bH, 'PREMIUM RENAME \u00b7 10', '#c8b0ff', () => this._premiumRename(p), false);
  }

  _mkBtn(s, c, x, y, w, h, label, color, cb, disabled = false) {
    const r = s.add.rectangle(x + w / 2, y + h / 2, w, h, disabled ? 0x141009 : 0x1a1510, disabled ? 0.75 : 0.95)
      .setStrokeStyle(2, disabled ? 0x453a2c : color);
    const t = s.add.text(x + w / 2, y + h / 2, label, T(9, disabled ? '#5c5348' : color, { fontStyle: 'bold' })).setOrigin(0.5);
    if (disabled) t.setAlpha(0.6);
    if (!disabled) {
      r.setInteractive({ useHandCursor: true });
      r.on('pointerover', () => r.setFillStyle(0x2a2520));
      r.on('pointerout', () => r.setFillStyle(0x1a1510));
      r.on('pointerdown', () => { audio.play('ui', 0.5); cb(); });
    }
    c.add([r, t]);
    return { r, t, disabled };
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
    input.maxLength = 24;
    input.setAttribute('aria-label', 'Pet nickname');
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

  // Premium rename: spends Wayfarer tokens server-side; economyNet's pet-rename
  // handler calls renameWithToken back once the spend is confirmed.
  _premiumRename(p) {
    const name = this.nameInput?.value.trim();
    if (!name || name.length > 24) { bus.emit(Events.SYSTEM, 'Pet name must be 1-24 characters.'); return; }
    import('../net/economyNet.js').then(({ econ }) => {
      if (!econ?.usable) { bus.emit(Events.SYSTEM, 'Play Online to spend tokens on a rename.'); return; }
      econ.spendTokens('pet-rename', 10, { petId: p.id || this.selIdx, name });
    }).catch(() => bus.emit(Events.SYSTEM, 'Rename is unavailable right now.'));
  }

  _setActive(ref) {
    const idx = this._resolveIdx(ref);
    if (idx < 0 || !this.roster[idx]) return;
    if (this.hooks.setActive) this.hooks.setActive(idx);
    else bus.emit(Events.SYSTEM, 'Active pet cannot be changed here.');
    this.build();
  }

  _release(ref) {
    const roster = this.roster;
    const idx = this._resolveIdx(ref);
    if (idx < 0 || idx >= roster.length) return;
    const p = roster[idx];
    if (roster.length <= 1) { bus.emit(Events.SYSTEM, 'You cannot release your only pet.'); return; }
    roster.splice(idx, 1);
    // Keep slots dense: other systems (pet battle teams, server snapshots) read p.slot.
    roster.forEach((x, i) => { x.slot = i; });
    this.sel = null;
    this.selIdx = null;
    this._persist();
    this.build();
    bus.emit(Events.SYSTEM, `${p.name || p.id} was released.`);
  }

  _evolve(ref) {
    const roster = this.roster;
    const idx = this._resolveIdx(ref);
    if (idx < 0 || idx >= roster.length) return;
    const p = roster[idx];
    const evo = evolve(p);
    if (!evo) return;
    evo.stats = statsAt(evo.id, evo.level);
    evo.hp = evo.stats.hp;
    roster[idx] = evo;
    this.sel = evo;
    this.selIdx = idx;
    this._persist();
    this.build();
    audio.play('level', 0.8);
    bus.emit(Events.TOAST, { title: 'Evolution!', text: `${p.name || p.id} evolved into ${evo.name || evo.id}!`, color: '#ffe07a' });
  }

  _persist() {
    this.hooks.setRoster(this.roster);
    this.hooks.save?.();
  }

  destroy() { this.close(); }
}
