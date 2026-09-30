import { input, PAD_LABELS } from '../core/input.js';
import { audio } from '../systems/audio.js';

// Hotkey help overlay (H / F1 / the "?" HUD button). Lists every registered
// input action with its current bindings (live: rebinds and actions added by
// other modules show up), plus gamepad and touch controls.
const FONT = '"Silkscreen", monospace';
const T = (size, color, extra = {}) => ({ fontFamily: FONT, fontSize: `${size}px`, color, ...extra });

export class HelpOverlay {
  constructor(scene) {
    this.scene = scene; this.isOpen = false; this.c = null; this.prevNav = null;
    this.offChange = input.onChange(() => { if (this.isOpen) this.build(); });
    scene.events.once('shutdown', () => { this.close(); this.offChange(); });
  }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    input.pushModal('help');
    this.prevNav = input.nav; input.nav = null;
    audio.play('ui', 0.5);
    this.build();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    input.popModal('help');
    if (input.nav === null && this.prevNav) input.nav = this.prevNav;
    this.prevNav = null;
    this.c?.destroy(); this.c = null;
  }

  build() {
    const s = this.scene;
    this.c?.destroy();
    const { w: VW, h: VH } = s.view();
    const pw = Math.min(VW - 12, 640), ph = Math.min(VH - 12, 440);
    const c = this.c = s.add.container(Math.round(VW / 2), Math.round(VH / 2)).setDepth(230);
    const dim = s.add.rectangle(0, 0, VW * 2, VH * 2, 0x000000, 0.55).setInteractive();
    dim.on('pointerdown', () => this.close());
    const [f, n] = s._nsPair(0, 0, pw, ph, 'ui.panelBg');
    f.setInteractive(); // clicks on the panel itself don't close it
    c.add([dim, f, n]);
    c.add(s.add.text(0, -ph / 2 + 16, 'HOTKEYS & CONTROLS', T(14, '#ffe07a', { fontStyle: 'bold' })).setOrigin(0.5));
    const x = s.add.text(pw / 2 - 16, -ph / 2 + 14, 'X', T(12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 6, y: 2 } })).setOrigin(0.5).setInteractive({ useHandCursor: true });
    x.on('pointerdown', () => this.close());
    c.add(x);

    // columns of groups
    const groups = new Map();
    for (const a of input.list()) { if (!groups.has(a.group)) groups.set(a.group, []); groups.get(a.group).push(a); }
    const extra = [
      ['Gamepad', [
        ['Move', 'L-STICK / D-PAD'], ['Attack', PAD_LABELS.attack], ['Talk / use', PAD_LABELS.interact], ['Potion', PAD_LABELS.potion],
        ['Skills 1-4', 'LB RB LT RT'], ['Skills 5-6', 'L3 R3'], ['Bag', PAD_LABELS.bag], ['Menu', PAD_LABELS.menu], ['Back / close', PAD_LABELS.back],
      ]],
      ['Touch', [['Move', 'left stick'], ['Skills / potion', 'tap hotbar'], ['Panels', 'CHAR / SKILL / MAP'], ['Menu / help', 'II  and  ?']]],
    ];
    const blocks = [...[...groups.entries()].map(([g, list]) => [g, list.map((a) => [a.label, a.keys.slice(0, 2).map((k) => input.tokenLabel(k)).join(' / ') || '--'])]), ...extra];
    const cols = pw >= 560 ? 3 : pw >= 380 ? 2 : 1;
    const colW = (pw - 24) / cols;
    const lineH = 12;
    const top = -ph / 2 + 36, bottom = ph / 2 - 26;
    const colY = new Array(cols).fill(top);
    for (const [g, rows] of blocks) {
      const need = (rows.length + 1) * lineH + 6;
      let ci = colY.indexOf(Math.min(...colY));
      if (colY[ci] + need > bottom) { const fit = colY.findIndex((y) => y + need <= bottom); if (fit >= 0) ci = fit; }
      const x0 = -pw / 2 + 12 + ci * colW;
      let y = colY[ci];
      c.add(s.add.text(x0, y, g.toUpperCase(), T(8, '#9bbc0f')));
      y += lineH;
      for (const [label, keys] of rows) {
        c.add(s.add.text(x0 + 4, y, label, T(8, '#e6f2c0')));
        c.add(s.add.text(x0 + colW - 8, y, keys, T(8, '#ffe07a')).setOrigin(1, 0));
        y += lineH;
      }
      colY[ci] = y + 6;
    }
    c.add(s.add.text(0, ph / 2 - 13, `${input.labelFor('help', 2)} / ESC close  ·  rebind keys in Pause (${input.labelFor('menu')}) > Controls`, T(8, '#a0c4f0', { align: 'center', wordWrap: { width: pw - 20 } })).setOrigin(0.5));
  }
}
