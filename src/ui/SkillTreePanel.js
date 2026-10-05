// Skill-tree panel: Might / Ward / Spirit paths, 4 nodes each.
// Solana palette (#0A0E1A / #14F195 / #9945FF / #03E1FF) + Silkscreen,
// following the ArenaPanel precedent (show/hide/destroy, guarded build,
// never throws when the scene or engine is missing).
//
// Engine contract (sibling track, all optional — every access is guarded):
//   player.getSpecTree?.() -> [{ id, name, color, nodes: [{ id, name, desc, req, cost, requires }] }]
//   player.getSpecNodes?.() -> owned id array | player.prog.specNodes | player.prog.paths (flattened)
//   player.buySpecNode?.(id) -> true/false
// Until the engine lands the panel renders its built-in static tree and
// degrades to read-only: nodes are inspectable, buys report READ-ONLY.
import { bus, Events } from '../core/events.js';

const C = {
  bg: 0x0a0e1a,
  panel: 0x10182e,
  green: 0x14f195,
  purple: 0x9945ff,
  cyan: 0x03e1ff,
  text: '#e8f4ff',
  dim: '#7d8db0',
  locked: 0x2a3350,
};
const FONT = '"Silkscreen", monospace';

// Built-in static tree (used unless player.getSpecTree() provides one).
const STATIC_TREE = [
  {
    id: 'might', name: 'MIGHT', color: C.green, css: '#14f195',
    nodes: [
      { id: 'mighty_blow', name: 'Mighty Blow', desc: '+15% melee damage.', req: 2, cost: 1, requires: null },
      { id: 'cleave', name: 'Cleave', desc: 'Attacks splash 30% to adjacent foes.', req: 5, cost: 1, requires: 'mighty_blow' },
      { id: 'execute', name: 'Execute', desc: '+50% damage to foes under 30% HP.', req: 8, cost: 2, requires: 'cleave' },
      { id: 'titans_grip', name: "Titan's Grip", desc: '+10% atk, +5% max HP.', req: 12, cost: 3, requires: 'execute' },
    ],
  },
  {
    id: 'ward', name: 'WARD', color: C.cyan, css: '#03e1ff',
    nodes: [
      { id: 'iron_skin', name: 'Iron Skin', desc: '+12 armor.', req: 2, cost: 1, requires: null },
      { id: 'bulwark', name: 'Bulwark', desc: 'Blocking reflects 20% damage.', req: 5, cost: 1, requires: 'iron_skin' },
      { id: 'thornmail', name: 'Thornmail', desc: 'Attackers take 10% of your armor as damage.', req: 8, cost: 2, requires: 'bulwark' },
      { id: 'aegis_wall', name: 'Aegis Wall', desc: 'Once per fight, survive lethal damage at 1 HP.', req: 12, cost: 3, requires: 'thornmail' },
    ],
  },
  {
    id: 'spirit', name: 'SPIRIT', color: C.purple, css: '#9945ff',
    nodes: [
      { id: 'focus', name: 'Focus', desc: '+20% max MP.', req: 2, cost: 1, requires: null },
      { id: 'surge', name: 'Surge', desc: 'Skills cost 15% less MP.', req: 5, cost: 1, requires: 'focus' },
      { id: 'moonwell', name: 'Moonwell', desc: 'Regenerate 1% MP per second.', req: 8, cost: 2, requires: 'surge' },
      { id: 'ascendance', name: 'Ascendance', desc: 'Ultimate charges 25% faster.', req: 12, cost: 3, requires: 'moonwell' },
    ],
  },
];

export class SkillTreePanel {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.unsubs = [];
    this.selected = null;   // selected node id
    this.armed = null;      // confirm-armed node id (two-step buy)
    this.armedAt = 0;
    this.status = '';
  }

  // ── engine access (all defensive) ──────────────────────────────────────
  _player() {
    try { return this.scene?.world?.()?.player ?? this.scene?.hero ?? null; }
    catch { return null; }
  }
  _tree() {
    try {
      const t = this._player()?.getSpecTree?.();
      if (Array.isArray(t) && t.length) return t;
    } catch { /* fall through to static */ }
    return STATIC_TREE;
  }
  _owned() {
    try {
      const p = this._player();
      let ids = p?.getSpecNodes?.() ?? p?.prog?.specNodes ?? null;
      if (!ids && p?.prog?.paths && typeof p.prog.paths === 'object') {
        ids = Object.values(p.prog.paths).flat();
      }
      if (Array.isArray(ids)) return new Set(ids.map(String));
      if (ids instanceof Set) return new Set([...ids].map(String));
    } catch { /* read-only */ }
    return new Set();
  }
  _points() {
    try {
      const v = this._player()?.prog?.skillPoints;
      return Number.isFinite(+v) ? Math.max(0, Math.floor(+v)) : 0;
    } catch { return 0; }
  }
  _level() {
    try {
      const v = this._player()?.level;
      return Number.isFinite(+v) ? Math.max(1, Math.floor(+v)) : 1;
    } catch { return 1; }
  }
  get buyable() {
    try { return typeof this._player()?.buySpecNode === 'function'; }
    catch { return false; }
  }

  _state(node, owned, points, level) {
    if (owned.has(String(node.id))) return 'owned';
    if (level < (node.req || 0)) return 'locked';
    if (node.requires && !owned.has(String(node.requires))) return 'locked';
    if (points < (node.cost || 0)) return 'locked';
    return 'available';
  }
  _lockReason(node, owned, points, level) {
    if (level < (node.req || 0)) return `Req Lv ${node.req}`;
    if (node.requires && !owned.has(String(node.requires))) {
      const prev = this._find(node.requires)?.name || 'prior node';
      return `Needs ${prev}`;
    }
    if (points < (node.cost || 0)) return 'No points';
    return '';
  }
  _find(id) {
    for (const path of this._tree()) {
      const n = path.nodes?.find((x) => String(x.id) === String(id));
      if (n) return n;
    }
    return null;
  }

  // ── panel lifecycle (ArenaPanel precedent) ─────────────────────────────
  show() {
    if (this.container) return true;
    try {
      const s = this.scene;
      if (!s?.add?.container) return false;
      const { w: W, h: H } = s.view ? s.view() : { w: s.scale.width, h: s.scale.height };
      const pw = Math.min(W - 24, 600);
      const ph = Math.min(H - 24, 430);
      const c = s.add.container(W / 2, H / 2).setDepth(150).setScrollFactor(0);

      const bg = s.add.rectangle(0, 0, pw, ph, C.bg, 0.97).setStrokeStyle(2, C.green);
      bg.setInteractive(); // swallow clicks so they never reach the world
      const bar = s.add.rectangle(0, -ph / 2 + 16, pw - 4, 30, C.panel, 1);
      const title = s.add.text(-pw / 2 + 12, -ph / 2 + 16, 'SPEC TREE', {
        fontFamily: FONT, fontSize: '13px', color: '#14f195', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      this.headText = s.add.text(pw / 2 - 40, -ph / 2 + 16, '', {
        fontFamily: FONT, fontSize: '10px', color: C.text,
      }).setOrigin(1, 0.5);
      const x = s.add.text(pw / 2 - 12, -ph / 2 + 16, 'X', {
        fontFamily: FONT, fontSize: '12px', color: '#ff7a7a', fontStyle: 'bold',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      x.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); this.hide(); });

      c.add([bg, bar, title, this.headText, x]);
      this.container = c;
      this._pw = pw; this._ph = ph;
      this.selected = null; this.armed = null; this.status = '';
      this.buildNodes();
      this.render();
      try {
        this.unsubs = [
          bus.on(Events.LEVEL_UP, () => this.render()),
          bus.on(Events.PROGRESS, () => this.render()),
        ];
      } catch { this.unsubs = []; }
      return true;
    } catch (e) {
      console.warn('[SkillTreePanel] show no-op:', e?.message);
      return false;
    }
  }

  buildNodes() {
    const s = this.scene;
    const c = this.container;
    if (!s || !c) return;
    this.nodeObjs = [];
    this.detailText = null; this.buyBtn = null; this.statusText = null;
    const pw = this._pw, ph = this._ph;
    const tree = this._tree();
    const top = -ph / 2 + 52;
    const colW = (pw - 32) / 3;
    const nodeH = 62, gapY = 10;

    tree.forEach((path, pi) => {
      const cx = -pw / 2 + 16 + colW * (pi + 0.5);
      const label = s.add.text(cx, top, path.name, {
        fontFamily: FONT, fontSize: '12px', color: path.css || C.text, fontStyle: 'bold',
      }).setOrigin(0.5);
      c.add(label);
      (path.nodes || []).slice(0, 4).forEach((node, ni) => {
        const ny = top + 22 + ni * (nodeH + gapY) + nodeH / 2;
        const w = colW - 16;
        const box = s.add.rectangle(cx, ny, w, nodeH, C.panel, 1)
          .setStrokeStyle(1, C.locked).setInteractive({ useHandCursor: true });
        const nm = s.add.text(cx, ny - 14, String(node.name).slice(0, 20), {
          fontFamily: FONT, fontSize: '10px', color: C.text, fontStyle: 'bold',
        }).setOrigin(0.5);
        const sub = s.add.text(cx, ny + 6, '', {
          fontFamily: FONT, fontSize: '9px', color: C.dim, align: 'center',
        }).setOrigin(0.5);
        const st = s.add.text(cx, ny + 20, '', {
          fontFamily: FONT, fontSize: '9px', color: C.dim,
        }).setOrigin(0.5);
        box.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); this.select(node.id); });
        c.add([box, nm, sub, st]);
        this.nodeObjs.push({ node, path, box, sub, st });
      });
    });

    // Detail bar: selected node desc + buy/confirm button + status line.
    const dy = ph / 2 - 52;
    this.detailText = s.add.text(0, dy - 8, 'Select a node.', {
      fontFamily: FONT, fontSize: '10px', color: C.text, align: 'center',
    }).setOrigin(0.5);
    const bb = this.makeBtn(0, dy + 22, 220, 28, 'BUY', C.green, () => this.buy());
    this.buyBtn = bb;
    this.statusText = s.add.text(0, ph / 2 - 8, '', {
      fontFamily: FONT, fontSize: '9px', color: C.dim, align: 'center',
    }).setOrigin(0.5);
    c.add([this.detailText, bb.bg, bb.text, this.statusText]);
  }

  makeBtn(x, y, w, h, label, color, cb) {
    const s = this.scene;
    const bg = s.add.rectangle(x, y, w, h, color, 1).setInteractive({ useHandCursor: true });
    const text = s.add.text(x, y, label, {
      fontFamily: FONT, fontSize: '11px', color: '#0a0e1a', fontStyle: 'bold',
    }).setOrigin(0.5);
    bg.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); cb(); });
    return { bg, text, label, color };
  }

  select(id) {
    this.selected = String(id);
    if (this.armed !== this.selected) this.armed = null; // switching nodes disarms
    this.render();
  }

  buy() {
    const node = this._find(this.selected);
    if (!node) { this.setStatus('Select a node first.'); return; }
    if (Date.now() - this.armedAt > 5000) this.armed = null; // arm expires
    if (this.armed !== String(node.id)) {
      // First click arms the confirm affordance — no spend yet.
      this.armed = String(node.id);
      this.armedAt = Date.now();
      this.setStatus(`Confirm: buy ${node.name} for ${node.cost} pt? Click BUY again.`);
      this.render();
      return;
    }
    this.armed = null;
    const p = this._player();
    try {
      if (typeof p?.buySpecNode === 'function') {
        const ok = p.buySpecNode(node.id);
        this.setStatus(ok ? `${node.name} learned!` : `Cannot learn ${node.name}.`);
      } else {
        this.setStatus('READ-ONLY — spec engine not linked yet.');
      }
    } catch (e) {
      this.setStatus('READ-ONLY — spec engine not linked yet.');
    }
    this.render();
  }

  setStatus(t) {
    this.status = String(t || '');
    try { this.statusText?.setText(this.status.slice(0, 80)); } catch { /* gone */ }
  }

  render() {
    try {
      if (!this.container) return;
      const owned = this._owned();
      const points = this._points();
      const level = this._level();
      this.headText?.setText(`Lv ${level} · ${points} pt${points === 1 ? '' : 's'}`);
      for (const o of this.nodeObjs || []) {
        const st = this._state(o.node, owned, points, level);
        if (st === 'owned') {
          o.box.setFillStyle(o.path.color, 0.9).setStrokeStyle(2, 0xffffff);
          o.sub.setText(`OWNED`).setColor('#0a0e1a');
          o.st.setText('★').setColor('#0a0e1a');
        } else if (st === 'available') {
          o.box.setFillStyle(C.panel, 1).setStrokeStyle(2, o.path.color);
          o.sub.setText(`${o.node.cost} pt · Lv ${o.node.req}`).setColor(o.path.css);
          o.st.setText(this.selected === String(o.node.id) ? '▶ SELECTED' : 'click to view').setColor(C.dim);
        } else {
          o.box.setFillStyle(C.panel, 1).setStrokeStyle(1, C.locked);
          o.sub.setText(`${o.node.cost} pt · Lv ${o.node.req}`).setColor(C.dim);
          o.st.setText(this._lockReason(o.node, owned, points, level)).setColor('#ff9a9a');
        }
      }
      const node = this._find(this.selected);
      if (node) {
        const st = this._state(node, owned, points, level);
        const armed = this.armed === String(node.id) && Date.now() - this.armedAt <= 5000;
        this.detailText?.setText(`${node.name} — ${node.desc}`.slice(0, 90));
        const label = st === 'owned' ? 'OWNED' : armed ? 'CONFIRM?' : `BUY (${node.cost} pt)`;
        this.buyBtn?.text.setText(label);
        this.buyBtn?.bg.setFillStyle(st === 'owned' ? C.locked : armed ? C.purple : C.green);
      } else {
        this.detailText?.setText(this.buyable ? 'Select a node.' : 'Select a node. (READ-ONLY — engine not linked)');
        this.buyBtn?.text.setText('BUY');
        this.buyBtn?.bg.setFillStyle(C.green);
      }
      if (this.status) this.statusText?.setText(this.status.slice(0, 80));
      else if (!this.buyable) this.statusText?.setText('READ-ONLY — spec engine not linked yet.');
      else this.statusText?.setText('');
    } catch { /* gone */ }
  }

  toggle() {
    if (this.container) this.hide();
    else this.show();
  }

  hide() {
    for (const u of this.unsubs) { try { u(); } catch { /* done */ } }
    this.unsubs = [];
    if (!this.container) return;
    try { this.container.destroy(); } catch { /* gone */ }
    this.container = null;
    this.headText = this.detailText = this.statusText = null;
    this.buyBtn = null; this.nodeObjs = [];
    this.selected = null; this.armed = null; this.status = '';
  }

  destroy() { this.hide(); }
}
