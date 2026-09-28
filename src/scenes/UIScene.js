import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { net } from '../net/NetworkManager.js';
import { PALETTES } from '../core/palette.js';
import { ZONES } from '../data/zones.js';
import { audio } from '../systems/audio.js';
import { CONFIG } from '../config.js';
import { gearById, statLine, SHOP_STOCK, SLOTS } from '../data/gear.js';

// HUD: HP/MP/XP bars, hotbar with cooldown sweep (clickable), minimap,
// quest tracker, chat, party, pause (palette + mute), GB tint + scanlines,
// damage vignette + low-HP pulse, touch controls (stick + ATK/SKL/E/Q).
export class UIScene extends Phaser.Scene {
  constructor() { super('ui'); }
  init(data) { this.hero = data.hero; this.pname = data.name; this.job = data.job; }
  world() { return this.scene.get('world'); }
  create() {
    const { width: W, height: H } = this.scale;
    this.minimapOn = true;
    this.lastHp = null;
    this.small = W < 560; // phones / narrow windows: compact HUD
    this.invOpen = false; this.shopOpen = false;

    // Palette tint + scanlines (Game Boy feel, toggleable in pause)
    const pal = PALETTES[this.hero.palette] || PALETTES.classic;
    this.gbTint = this.add.rectangle(0, 0, W, H, pal.bg, this.hero.palette === 'modern' ? 0 : 0.12).setOrigin(0).setDepth(90).setScrollFactor(0);
    this.scan = this.add.graphics().setDepth(91);
    this.drawScan();
    this.scale.on('resize', () => {
      this.gbTint.setDisplaySize(this.scale.width, this.scale.height);
      this.drawScan();
    });

    // Damage vignette (flashes red when hurt) + low-HP pulse frame
    this.vignette = this.add.rectangle(0, 0, W, H, 0xcc0000, 0).setOrigin(0).setDepth(95);

    // Top-left status panel (compact on phones)
    const pw = this.small ? 184 : 220, pbw = this.small ? 164 : 200;
    this.panel = this.add.rectangle(8, 8, pw, 74, 0x000000, 0.55).setOrigin(0).setDepth(100);
    this.nameT = this.add.text(16, 12, `${this.pname} · ${this.job.name} Lv 1`, { fontSize: this.small ? '11px' : '12px', color: '#fff' }).setDepth(101);
    this.hpBar = this.add.rectangle(16, 32, pbw, 10, 0x2ecc71).setOrigin(0).setDepth(101);
    this.hpBarW = pbw;
    this.hpT = this.add.text(16, 30, '', { fontSize: '9px', color: '#fff' }).setDepth(102);
    this.mpBar = this.add.rectangle(16, 46, pbw, 8, 0x3498db).setOrigin(0).setDepth(101);
    this.xpBar = this.add.rectangle(16, 58, pbw, 5, 0xf1c40f).setOrigin(0).setDepth(101);
    this.goldT = this.add.text(16, 66, '', { fontSize: this.small ? '9px' : '10px', color: '#fdebd0' }).setDepth(101);

    // Zone label (top-center; drops below the status panel on phones)
    this.zoneT = this.add.text(W / 2, this.small ? 88 : 12, 'Thistle Town', { fontSize: this.small ? '12px' : '14px', color: '#fff', backgroundColor: '#00000088', padding: { x: 8, y: 4 } }).setOrigin(0.5, 0).setDepth(101);

    // Quest tracker (right, narrower on phones)
    this.questT = this.add.text(W - 12, 12, '', { fontSize: this.small ? '10px' : '11px', color: '#fdebd0', backgroundColor: '#00000088', padding: { x: 8, y: 6 }, wordWrap: { width: this.small ? 140 : 200 }, align: 'right' }).setOrigin(1, 0).setDepth(101);

    // Hotbar (bottom-center): 1-4 abilities + Q potion, clickable, cooldown sweep
    this.hotbar = [];
    const cell = this.small ? 50 : 62, boxW = this.small ? 46 : 56, boxH = this.small ? 40 : 44;
    const hotY = H - 34;
    const slots = [...this.job.abilities.map((a) => ({ key: a.key, name: a.name, ab: a })), { key: 'Q', name: 'Potion', ab: null }];
    slots.forEach((s, i) => {
      const x = W / 2 - (slots.length * cell) / 2 + i * cell + cell / 2;
      const bg = this.add.rectangle(x, hotY, boxW, boxH, 0x000000, 0.6).setDepth(100).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, hotY - 8, `[${s.key}]`, { fontSize: '10px', color: '#8bac0f' }).setOrigin(0.5).setDepth(101);
      const n = this.add.text(x, hotY + 6, s.name.split(' ')[0], { fontSize: '9px', color: '#fff' }).setOrigin(0.5).setDepth(101);
      const cdBg = this.add.rectangle(x, hotY, boxW, boxH, 0x000000, 0.65).setDepth(102).setVisible(false);
      const cdT = this.add.text(x, hotY, '', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(103).setVisible(false);
      bg.on('pointerdown', () => {
        const w = this.world();
        if (!w?.player) return;
        audio.play('ui', 0.6);
        if (s.ab) w.cast(s.ab.key);
        else w.drinkPotion();
      });
      this.hotbar.push({ bg, s, cdBg, cdT, bw: boxW, bh: boxH });
    });

    // Chat / system log (bottom-left, tap hint to collapse — handy on phones)
    this.log = [];
    this.logT = this.add.text(12, H - 150, '', { fontSize: this.small ? '10px' : '11px', color: '#e6f2c0', backgroundColor: '#00000077', padding: { x: 8, y: 6 }, wordWrap: { width: this.small ? 220 : 300 }, fixedHeight: this.small ? 76 : 100 }).setDepth(101);
    this.chatHint = this.add.text(12, H - 158, 'chat (tap)', { fontSize: '9px', color: '#8bac0f' }).setDepth(101).setInteractive({ useHandCursor: true });
    this.logCollapsed = this.small;
    this.chatHint.on('pointerdown', () => {
      this.logCollapsed = !this.logCollapsed;
      this.logT.setVisible(!this.logCollapsed);
    });
    if (this.logCollapsed) this.logT.setVisible(false);

    // Minimap (bottom-right, smaller on phones)
    this.mapSize = this.small ? 64 : 84;
    this.mapG = this.add.graphics().setDepth(101);
    this.mapBg = this.add.rectangle(W - this.mapSize / 2 - 8, H - this.mapSize / 2 - 8, this.mapSize, this.mapSize, 0x000000, 0.6).setDepth(100);

    // Party line (left, under panel; short text + lower on phones to clear zone label)
    this.partyT = this.add.text(16, this.small ? 104 : 92, net.connected ? `Party ${net.code}` : (this.small ? 'Solo' : 'Solo — Host/Join from Title'), { fontSize: '10px', color: '#aed6f1' }).setDepth(101);

    // Pause menu (Esc)
    this.paused = false;
    this.menu = this.add.container(W / 2, H / 2).setDepth(200).setVisible(false);
    const mbg = this.add.rectangle(0, 0, 300, 260, 0x000000, 0.92);
    const mt = this.add.text(0, -100, 'PAUSED', { fontSize: '20px', color: '#fff' }).setOrigin(0.5);
    const mkBtn = (dy, label, cb) => {
      const b = this.add.text(0, dy, label, { fontSize: '14px', color: '#0f380f', backgroundColor: '#9bbc0f', padding: { x: 14, y: 6 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => { audio.play('ui', 0.7); cb(); });
      return b;
    };
    this.menu.add([mbg, mt]);
    this.menu.add(mkBtn(-52, 'Resume', () => this.togglePause()));
    this.soundT = mkBtn(-16, `Sound: ${audio.enabled ? 'ON' : 'OFF'}`, () => {
      const on = audio.toggle();
      this.soundT.setText(`Sound: ${on ? 'ON' : 'OFF'}`);
    });
    this.menu.add(this.soundT);
    this.menu.add(mkBtn(20, 'Cycle Game Boy palette', () => {
      const keys = Object.keys(PALETTES);
      const i = (keys.indexOf(this.hero.palette) + 1) % keys.length;
      this.hero.palette = keys[i];
      const p = PALETTES[keys[i]];
      this.gbTint.setFillStyle(p.bg, keys[i] === 'modern' ? 0 : 0.12);
      this.say(`${p.name} palette`);
    }));
    this.menu.add(mkBtn(56, net.connected ? 'Leave Party (solo)' : 'Leave to Title', () => {
      const w = this.world();
      if (net.connected && w) { net.leave(); this.say('Left party — continuing solo.'); this.togglePause(); this.partyT.setText('Solo — Host/Join from Title'); }
      else { net.leave(); audio.stopMusic(); this.scene.stop('world'); this.scene.start('title'); }
    }));
    this.input.keyboard.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard.on('keydown-ENTER', () => this.openChat());
    this.input.keyboard.on('keydown-P', () => { const on = audio.toggle(); this.say(`Sound ${on ? 'on' : 'muted'} (P)`); });

    bus.on(Events.SYSTEM, (s) => this.say(s));
    bus.on(Events.CHAT, (m) => this.say(`${m.name}: ${m.text}`));
    bus.on(Events.PLAYER_HP, (p) => this.drawStatus(p));
    bus.on(Events.PLAYER_XP, (p) => this.drawXp(p));
    bus.on(Events.QUEST, (q) => this.questT.setText('◆ ' + q));
    bus.on(Events.ZONE, (z) => this.zoneT.setText(z.name));
    bus.on(Events.SYSTEM, (s) => { if (s === 'toggle-minimap') { this.minimapOn = !this.minimapOn; this.mapBg.setVisible(this.minimapOn); } });
    bus.on(Events.GEAR, (m) => {
      if (m.open === 'inventory') this.toggleInventory();
      else if (m.open === 'shop') this.openShop(m.stock || []);
      else if (m.changed) { if (this.invOpen) this.drawInventory(); }
    });

    this.buildTouch();
    this.buildPanels();
  }

  drawScan() {
    this.scan.clear();
    const { width: W, height: H } = this.scale;
    for (let y = 0; y < H; y += 4) this.scan.fillStyle(0x000000, 0.08).fillRect(0, y, W, 1);
  }

  say(s) {
    if (s === 'toggle-minimap') return;
    this.log.push(s); if (this.log.length > 6) this.log.shift();
    this.logT.setText(this.log.join('\n'));
  }

  drawStatus(p) {
    if (this.lastHp !== null && p.hp < this.lastHp) {
      this.vignette.setAlpha(0.45);
      this.tweens.add({ targets: this.vignette, alpha: 0, duration: 350 });
    }
    this.lastHp = p.hp;
    this.nameT.setText(`${this.pname} · ${this.job.name} Lv ${p.level}`);
    this.hpBar.setDisplaySize(this.hpBarW * (p.hp / p.maxHp), 10);
    this.hpBar.setFillStyle(p.hp / p.maxHp > 0.35 ? 0x2ecc71 : 0xe74c3c);
    this.hpT.setText(`HP ${p.hp}/${p.maxHp}`);
    this.mpBar.setDisplaySize(this.hpBarW * (p.mp / p.maxMp), 8);
    this.goldT.setText(`${p.gold}g · ${p.potions} pot · ATK ${p.atk} · DEF ${p.def}`);
  }
  drawXp(p) { this.xpBar.setDisplaySize(this.hpBarW * (p.xp / p.xpNext), 5); }

  openChat() {
    const v = window.prompt(net.connected ? 'Party chat:' : 'Say (solo log):', '');
    if (!v) return;
    net.sendChat(this.pname, v.slice(0, 120));
    if (!net.connected) this.say(`${this.pname}: ${v.slice(0, 120)}`);
  }

  togglePause() {
    this.paused = !this.paused;
    this.menu.setVisible(this.paused);
    const w = this.world();
    if (w) w.physics.world.isPaused = this.paused;
  }

  buildTouch() {
    const { width: W, height: H } = this.scale;
    this.touchUI = this.add.container(0, 0).setDepth(150);
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    // Joystick (bottom-left, dynamic origin)
    const base = this.add.circle(90, H - 110, 46, 0xffffff, 0.12);
    const knob = this.add.circle(90, H - 110, 20, 0xffffff, 0.3);
    this.touchUI.add([base, knob]);
    let stickId = null, ox = 90, oy = H - 110;
    const setKnob = (x, y) => {
      const dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy), max = 40;
      const c = d > max ? max / d : 1;
      knob.setPosition(ox + dx * c, oy + dy * c);
      const w = this.world();
      if (w) { w.touchInput.x = (dx * c) / max; w.touchInput.y = (dy * c) / max; }
    };
    const clearKnob = () => {
      stickId = null; knob.setPosition(ox, oy);
      const w = this.world();
      if (w) { w.touchInput.x = 0; w.touchInput.y = 0; }
    };
    base.setInteractive(new Phaser.Geom.Circle(90, H - 110, 70), Phaser.Geom.Circle.Contains);
    base.on('pointerdown', (p) => { stickId = p.id; ox = p.x; oy = p.y; base.setPosition(ox, oy); setKnob(p.x, p.y); });
    this.input.on('pointermove', (p) => { if (p.id === stickId && p.isDown) setKnob(p.x, p.y); });
    this.input.on('pointerup', (p) => { if (p.id === stickId) { base.setPosition(90, H - 110); clearKnob(); } });
    // Action buttons (bottom-right, 44px+ targets on phones)
    const R = this.small ? 30 : 26;
    const mkBtn = (x, y, label, cb) => {
      const c = this.add.circle(x, y, R, 0x000000, 0.5).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y, label, { fontSize: this.small ? '13px' : '12px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
      c.on('pointerdown', () => { audio.play('ui', 0.5); cb(); });
      this.touchUI.add([c, t]);
    };
    mkBtn(W - 60, H - 110, 'ATK', () => this.world()?.attack());
    mkBtn(W - 122, H - 80, 'SKL', () => this.world()?.cast('2'));
    mkBtn(W - 60, H - 176, 'E', () => this.world()?.interact());
    mkBtn(W - 122, H - 146, 'Q', () => this.world()?.drinkPotion());
    mkBtn(W - 184, H - 110, 'BAG', () => bus.emit(Events.GEAR, { open: 'inventory' }));
  }

  // — inventory + shop panels (big tap targets, phone-friendly) —
  buildPanels() {
    const { width: W, height: H } = this.scale;
    const pw = Math.min(W - 32, this.small ? 340 : 420), ph = Math.min(H - 120, this.small ? 380 : 440);
    // Inventory
    this.invPanel = this.add.container(W / 2, H / 2).setDepth(180).setVisible(false);
    this.invBg = this.add.rectangle(0, 0, pw, ph, 0x0b0e14, 0.95);
    this.invTitle = this.add.text(0, -ph / 2 + 22, 'GEAR (tap to equip)', { fontSize: '15px', color: '#f4c542', fontStyle: 'bold' }).setOrigin(0.5);
    this.invClose = this.add.text(pw / 2 - 24, -ph / 2 + 20, 'X', { fontSize: '16px', color: '#fff', backgroundColor: '#7b2d26', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.invClose.on('pointerdown', () => this.toggleInventory(false));
    this.invDetail = this.add.text(-pw / 2 + 14, ph / 2 - 52, '', { fontSize: '11px', color: '#e6f2c0', wordWrap: { width: pw - 28 } });
    this.invPanel.add([this.invBg, this.invTitle, this.invClose, this.invDetail]);
    this.invCells = [];
    this.invDims = { pw, ph };
    // Shop
    this.shopPanel = this.add.container(W / 2, H / 2).setDepth(180).setVisible(false);
    this.shopBg = this.add.rectangle(0, 0, pw, ph, 0x0b0e14, 0.95);
    this.shopTitle = this.add.text(0, -ph / 2 + 22, "MAREN'S WARES", { fontSize: '15px', color: '#f4c542', fontStyle: 'bold' }).setOrigin(0.5);
    this.shopGold = this.add.text(-pw / 2 + 14, -ph / 2 + 22, '', { fontSize: '12px', color: '#fdebd0' });
    this.shopClose = this.add.text(pw / 2 - 24, -ph / 2 + 20, 'X', { fontSize: '16px', color: '#fff', backgroundColor: '#7b2d26', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.shopClose.on('pointerdown', () => this.openShop(null));
    this.shopPanel.add([this.shopBg, this.shopTitle, this.shopGold, this.shopClose]);
    this.shopCells = [];
    this.shopDims = { pw, ph };
  }

  clearCells(list) { for (const c of list) c.destroy(); list.length = 0; }

  toggleInventory(force) {
    this.invOpen = force !== undefined ? force : !this.invOpen;
    if (this.invOpen) this.openShop(null);
    this.invPanel.setVisible(this.invOpen);
    if (this.invOpen) this.drawInventory();
    else this.invDetail.setText('');
  }

  drawInventory() {
    const w = this.world();
    if (!w?.player) return;
    const p = w.player;
    this.clearCells(this.invCells);
    const { pw, ph } = this.invDims;
    const cellS = this.small ? 46 : 44, gap = 6;
    // equipped row
    SLOTS.forEach((slot, i) => {
      const id = p.equipped[slot];
      const g = id && gearById(id);
      const x = -pw / 2 + 30 + i * (cellS + gap + 34), y = -ph / 2 + 66;
      const bg = this.add.rectangle(x, y, cellS, cellS, 0x1e6b2f, 0.9);
      const lab = this.add.text(x, y + cellS / 2 + 8, slot.toUpperCase(), { fontSize: '8px', color: '#9bbc0f' }).setOrigin(0.5, 0);
      this.invPanel.add([bg, lab]); this.invCells.push(bg, lab);
      if (g && this.textures.exists(`gear.icon.${g.id}`)) {
        const ic = this.add.image(x, y, `gear.icon.${g.id}`).setScale(3);
        this.invPanel.add(ic); this.invCells.push(ic);
      }
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        if (p.unequip(slot)) {
          audio.play('ui', 0.7);
          bus.emit(Events.PLAYER_HP, w.hpPayload());
          w.saveNow();
          this.drawInventory();
          this.invDetail.setText(`Unequipped ${g.name}.`);
        }
      });
    });
    // inventory grid
    const cols = this.small ? 5 : 6;
    p.inventory.forEach((id, i) => {
      const g = gearById(id);
      if (!g) return;
      const cx = i % cols, cy = Math.floor(i / cols);
      const x = -pw / 2 + 30 + cx * (cellS + gap), y = -ph / 2 + 140 + cy * (cellS + gap);
      const bg = this.add.rectangle(x, y, cellS, cellS, 0x000000, 0.7).setStrokeStyle(1, 0x8bac0f);
      this.invPanel.add(bg); this.invCells.push(bg);
      if (this.textures.exists(`gear.icon.${g.id}`)) {
        const ic = this.add.image(x, y, `gear.icon.${g.id}`).setScale(2.5);
        this.invPanel.add(ic); this.invCells.push(ic);
      }
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        if (p.equip(id)) {
          audio.play('gold', 0.7);
          bus.emit(Events.PLAYER_HP, w.hpPayload());
          w.saveNow();
          this.drawInventory();
          this.invDetail.setText(`${g.name} (${g.slot}) — ${statLine(g.stats)}. ${g.desc || ''}`);
        }
      });
    });
    if (!p.inventory.length) this.invDetail.setText('Empty pockets. Monsters drop gear — Maren sells it too.');
  }

  openShop(stock) {
    this.shopOpen = !!stock;
    if (!this.shopOpen) { this.shopPanel.setVisible(false); return; }
    if (this.invOpen) this.toggleInventory(false);
    const w = this.world();
    if (!w?.player) return;
    const p = w.player;
    this.clearCells(this.shopCells);
    const { pw, ph } = this.shopDims;
    this.shopGold.setText(`${p.gold}g`);
    const rows = [...stock.map((id) => gearById(id)).filter(Boolean)];
    rows.unshift({ id: '__potion', name: 'Potion (+45 HP)', price: 3, stats: {}, desc: 'Drink with Q.' });
    const rh = this.small ? 52 : 48;
    rows.forEach((g, i) => {
      const y = -ph / 2 + 70 + i * (rh + 6);
      if (y > ph / 2 - 30) return;
      const bg = this.add.rectangle(0, y, pw - 28, rh, 0x000000, 0.7).setStrokeStyle(1, 0xf4c542);
      const ic = g.id === '__potion'
        ? this.add.circle(-pw / 2 + 34, y, 10, 0xe74c3c)
        : this.add.image(-pw / 2 + 34, y, `gear.icon.${g.id}`).setScale(2.5);
      const nm = this.add.text(-pw / 2 + 56, y - 14, g.name, { fontSize: '12px', color: '#fff', fontStyle: 'bold' });
      const st = this.add.text(-pw / 2 + 56, y + 2, g.id === '__potion' ? g.desc : `${statLine(g.stats)} · ${g.desc || ''}`, { fontSize: '10px', color: '#aed6f1', wordWrap: { width: pw - 150 } });
      const pr = this.add.text(pw / 2 - 30, y, `${g.price}g`, { fontSize: '13px', color: '#f4c542', fontStyle: 'bold' }).setOrigin(0.5);
      this.shopPanel.add([bg, ic, nm, st, pr]);
      this.shopCells.push(bg, ic, nm, st, pr);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        if (p.gold < g.price) { audio.play('error', 0.7); this.shopGold.setText(`${p.gold}g — not enough!`); return; }
        p.gold -= g.price;
        if (g.id === '__potion') p.potions += 1;
        else p.inventory.push(g.id);
        audio.play('gold');
        bus.emit(Events.PLAYER_HP, w.hpPayload());
        w.saveNow();
        this.shopGold.setText(`${p.gold}g`);
        this.say(`Bought ${g.name} (${g.price}g).`);
      });
    });
    this.shopPanel.setVisible(true);
  }

  update() {
    // Hotbar cooldown sweep
    const w = this.world();
    const now = w?.time.now ?? 0;
    for (const slot of this.hotbar) {
      const ab = slot.s.ab;
      let remain = 0, total = 1;
      if (ab && w?.player) {
        total = ab.cd;
        remain = Math.max(0, ((w.player.cooldowns[ab.id] || 0) - now) / 1000);
      }
      const on = remain > 0;
      slot.cdBg.setVisible(on); slot.cdT.setVisible(on);
      if (on) {
        slot.cdBg.setDisplaySize(slot.bw, slot.bh * (remain / total));
        slot.cdT.setText(remain > 1 ? remain.toFixed(0) : remain.toFixed(1));
      }
    }
    // Low-HP pulse
    if (this.lastHp !== null && w?.player) {
      const frac = w.player.hp / w.player.maxHp;
      if (frac < 0.3 && !w.player.dead) this.vignette.setAlpha(0.15 + 0.1 * Math.sin(this.time.now / 200));
      else if (this.vignette.alpha < 0.2) this.vignette.setAlpha(Math.max(0, this.vignette.alpha - 0.02));
    }
    // Minimap: zone rects + player dot
    this.mapG.clear();
    if (!this.minimapOn) return;
    const { width: W, height: H } = this.scale;
    const ms = this.mapSize, ox = W - ms / 2 - 8, oy = H - ms / 2 - 8, s = ms / 128;
    for (const z of ZONES) {
      const c = z.id === 'town' ? 0xc9b458 : z.id === 'meadow' ? 0x7ec850 : z.id === 'woods' ? 0x3e8e41 : 0x6b7f8e;
      this.mapG.fillStyle(c, 0.9).fillRect(ox - 42 + z.rect.x * s, oy - 42 + z.rect.y * s, z.rect.w * s, z.rect.h * s);
    }
    if (w?.player) {
      const px = ox - 42 + (w.player.x / 16) * s, py = oy - 42 + (w.player.y / 16) * s;
      this.mapG.fillStyle(0xffffff, 1).fillCircle(px, py, 2.5);
      // NPC dots
      this.mapG.fillStyle(0xf1c40f, 1);
      for (const n of w.npcs || []) this.mapG.fillCircle(ox - 42 + (n.x / 16) * s, oy - 42 + (n.y / 16) * s, 1.5);
    }
  }
}
