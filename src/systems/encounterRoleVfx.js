import { settings } from '../core/settings.js';

// Persistent, shape-coded ground sigils for directed encounter roles.
//
// This deliberately uses Phaser Graphics rather than new art assets: the marks
// stay crisp at every zoom, remain legible in colourblind mode by silhouette,
// and add no texture upload or asset provenance burden. Graphics objects are
// allocated once and reused; update() does not create display objects.
//
// Minimal integration (the instance self-updates and cleans up on shutdown):
//   this.encounterRoleVfx = installEncounterRoleVfx(this);

// Optional combat hooks can briefly emphasize a role without knowing how it is
// drawn:
//   this.encounterRoleVfx.flashRole(enemy, 500);

const ROLE = Object.freeze({
  captain:  { color: 0xffc857, glow: 0xff9f2f },
  vanguard: { color: 0x62d5ff, glow: 0x278ec7 },
  flanker:  { color: 0xd98cff, glow: 0x8f4fd6 },
  support:  { color: 0x72f1b8, glow: 0x22a978 },
});

const DEFAULT_CAP = 16;
const PAD = 48;
const TAU = Math.PI * 2;

function roleOf(enemy) {
  if (enemy.isSquadCaptain) return 'captain';
  return ROLE[enemy.squadRole] ? enemy.squadRole : null;
}

function onScreen(enemy, view) {
  return !view || (enemy.x >= view.x - PAD && enemy.x <= view.right + PAD
    && enemy.y >= view.y - PAD && enemy.y <= view.bottom + PAD);
}

function outline(g, width, alpha = 0.72) {
  g.lineStyle(width + 2, 0x071018, alpha);
}

function ink(g, color, width, alpha) {
  g.lineStyle(width, color, alpha);
}

function ring(g, radius, squash, color, alpha) {
  outline(g, 2, alpha * 0.72);
  g.strokeEllipse(0, 2, radius * 2, radius * 2 * squash);
  ink(g, color, 2, alpha);
  g.strokeEllipse(0, 2, radius * 2, radius * 2 * squash);
}

function drawCaptain(g, radius, alpha, phase) {
  const { color, glow } = ROLE.captain;
  g.fillStyle(glow, alpha * 0.11).fillEllipse(0, 2, radius * 2.25, radius * 0.78);
  ring(g, radius, 0.36, color, alpha);
  // Four compass/crown points distinguish command from a generic elite aura.
  for (let i = 0; i < 4; i += 1) {
    const a = phase * 0.18 + i * Math.PI / 2;
    const cs = Math.cos(a), sn = Math.sin(a);
    const x1 = cs * (radius + 1), y1 = 2 + sn * (radius * 0.36 + 1);
    const x2 = cs * (radius + 5), y2 = 2 + sn * (radius * 0.36 + 3);
    outline(g, 2, alpha * 0.7); g.lineBetween(x1, y1, x2, y2);
    ink(g, color, 2, alpha); g.lineBetween(x1, y1, x2, y2);
  }
  g.fillStyle(0x071018, alpha * 0.85).fillTriangle(-5, -radius * 0.65, 0, -radius * 0.95, 5, -radius * 0.65);
  g.fillStyle(color, alpha).fillTriangle(-3.2, -radius * 0.68, 0, -radius * 0.86, 3.2, -radius * 0.68);
}

function drawVanguard(g, radius, alpha) {
  const { color, glow } = ROLE.vanguard;
  g.fillStyle(glow, alpha * 0.1).fillEllipse(0, 3, radius * 2, radius * 0.65);
  // A broad shield faces the player-facing side of the marker.
  outline(g, 3, alpha * 0.7);
  g.beginPath().moveTo(-radius * 0.72, 1).lineTo(-radius * 0.54, -4)
    .lineTo(0, -7).lineTo(radius * 0.54, -4).lineTo(radius * 0.72, 1)
    .lineTo(0, 7).closePath().strokePath();
  ink(g, color, 2, alpha);
  g.beginPath().moveTo(-radius * 0.72, 1).lineTo(-radius * 0.54, -4)
    .lineTo(0, -7).lineTo(radius * 0.54, -4).lineTo(radius * 0.72, 1)
    .lineTo(0, 7).closePath().strokePath();
  ink(g, color, 1, alpha * 0.65); g.lineBetween(0, -5, 0, 4);
}

function drawFlanker(g, radius, alpha, side) {
  const { color, glow } = ROLE.flanker;
  const dir = side < 0 ? -1 : 1;
  g.fillStyle(glow, alpha * 0.08).fillEllipse(0, 3, radius * 2.1, radius * 0.58);
  // Paired lateral chevrons read as a pincer even with all colour removed.
  for (let i = 0; i < 2; i += 1) {
    const x = dir * (3 + i * 5);
    outline(g, 3, alpha * 0.7);
    g.beginPath().moveTo(x - dir * 4, -4).lineTo(x + dir * 1, 1).lineTo(x - dir * 4, 6).strokePath();
    ink(g, color, 2, alpha);
    g.beginPath().moveTo(x - dir * 4, -4).lineTo(x + dir * 1, 1).lineTo(x - dir * 4, 6).strokePath();
  }
  ink(g, color, 1, alpha * 0.62);
  g.beginPath().arc(0, 2, radius, dir < 0 ? Math.PI * 0.62 : -Math.PI * 0.38,
    dir < 0 ? Math.PI * 1.38 : Math.PI * 0.38, dir > 0).strokePath();
}

function drawSupport(g, radius, alpha, channeling) {
  const { color, glow } = ROLE.support;
  const r = radius * 0.68;
  g.fillStyle(glow, alpha * (channeling ? 0.19 : 0.09)).fillEllipse(0, 2, radius * 2, radius * 0.68);
  outline(g, 3, alpha * 0.72);
  g.beginPath().moveTo(0, -r).lineTo(r, 1).lineTo(0, r).lineTo(-r, 1).closePath().strokePath();
  ink(g, color, 2, alpha);
  g.beginPath().moveTo(0, -r).lineTo(r, 1).lineTo(0, r).lineTo(-r, 1).closePath().strokePath();
  outline(g, 2, alpha * 0.65); g.lineBetween(-4, 1, 4, 1); g.lineBetween(0, -3, 0, 5);
  ink(g, color, 2, alpha); g.lineBetween(-4, 1, 4, 1); g.lineBetween(0, -3, 0, 5);
}

export class EncounterRoleVfx {
  constructor(scene, { maxSlots = DEFAULT_CAP } = {}) {
    this.scene = scene;
    this.maxSlots = Math.max(1, maxSlots | 0);
    this.slots = [];
    this.emphasis = new WeakMap();
    this.lastEncounterId = null;
    this.introUntil = 0;
    this.destroyed = false;

    this.onUpdate = (time) => this.update(time);
    this.onShutdown = () => this.destroy();
    scene.events.on('update', this.onUpdate);
    scene.events.once('shutdown', this.onShutdown);
  }

  makeSlot() {
    if (this.slots.length >= this.maxSlots) return null;
    const graphics = this.scene.add.graphics().setBlendMode(0);
    const slot = { graphics, enemy: null, used: false };
    this.slots.push(slot);
    return slot;
  }

  slotFor(enemy) {
    let free = null;
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i];
      if (slot.enemy === enemy) return slot;
      if (!free && !slot.used) free = slot;
    }
    return free || this.makeSlot();
  }

  // Public cue for intercepts, support casts, pincer commits, or captain orders.
  flashRole(enemy, duration = 500) {
    if (!enemy || this.destroyed) return;
    const now = this.scene?.time?.now || 0;
    this.emphasis.set(enemy, now + Math.max(0, duration));
  }

  draw(slot, enemy, role, time, calm, intro) {
    const g = slot.graphics;
    const base = 10 * Math.max(0.8, Math.min(1.6, enemy.vscale || 1));
    const active = time < (this.emphasis.get(enemy) || 0);
    const pulse = calm ? 0 : (Math.sin(time / 170 + enemy.x * 0.03) + 1) * 0.5;
    const alpha = Math.min(1, 0.5 + pulse * 0.16 + (intro ? 0.14 : 0) + (active ? 0.2 : 0));
    const radius = base * (1 + (calm ? 0 : pulse * 0.045) + (active ? 0.08 : 0));

    g.clear().setPosition(enemy.x, enemy.y + 3).setDepth((enemy.depth || enemy.y || 8) - 0.2).setVisible(true);
    if (role === 'captain') drawCaptain(g, radius * 1.14, alpha, calm ? 0 : time / 1000);
    else if (role === 'vanguard') drawVanguard(g, radius, alpha);
    else if (role === 'flanker') drawFlanker(g, radius, alpha, enemy.squadSide || 1);
    else if (role === 'support') drawSupport(g, radius, alpha, !!enemy.channelingSupport);
  }

  update(time = this.scene?.time?.now || 0) {
    if (this.destroyed) return;
    const scene = this.scene;
    const children = scene.enemies?.getChildren?.();
    if (!children) return;

    for (let i = 0; i < this.slots.length; i += 1) this.slots[i].used = false;

    const encounterId = scene.encounters?.active?.id || null;
    if (encounterId && encounterId !== this.lastEncounterId) {
      this.lastEncounterId = encounterId;
      this.introUntil = time + 1400;
    } else if (!encounterId) this.lastEncounterId = null;

    const view = scene.cameras?.main?.worldView;
    const calm = !!settings.get('reduceMotion');
    const intro = !calm && time < this.introUntil;
    for (let i = 0; i < children.length; i += 1) {
      const enemy = children[i];
      const role = enemy && roleOf(enemy);
      if (!role || !enemy.alive || !enemy.encounterId || !onScreen(enemy, view)) continue;
      const slot = this.slotFor(enemy);
      if (!slot) break;
      slot.enemy = enemy;
      slot.used = true;
      this.draw(slot, enemy, role, time, calm, intro && enemy.encounterId === encounterId);
    }

    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i];
      if (slot.used) continue;
      slot.enemy = null;
      slot.graphics.clear().setVisible(false);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene?.events?.off('update', this.onUpdate);
    this.scene?.events?.off('shutdown', this.onShutdown);
    for (let i = 0; i < this.slots.length; i += 1) this.slots[i].graphics.destroy();
    this.slots.length = 0;
    this.scene = null;
  }
}

export function installEncounterRoleVfx(scene, options) {
  return new EncounterRoleVfx(scene, options);
}

