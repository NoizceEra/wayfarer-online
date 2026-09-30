import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { net } from '../net/NetworkManager.js';

// "Game feel" helpers for WorldScene, kept in their own module so the scene
// itself only needs a few one-line hooks:
//   - interaction prompt bubble above NPCs ("E  Talk" / "E  Open")
//   - room-code overlay when in a co-op room (prominent for the host)

const PROMPT_MARGIN = 22; // px beyond interactRadius where the prompt starts fading in

export function initPrompt(scene) {
  const txt = scene.add.text(0, 0, 'E  Talk', {
    fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#0f380f',
  }).setOrigin(0.5);
  const w = txt.width + 10, h = txt.height + 6;
  const bg = scene.add.graphics();
  bg.fillStyle(0x0a1e0a, 0.9); bg.fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
  bg.fillStyle(0x9bbc0f, 1); bg.fillRect(-w / 2, -h / 2, w, h);
  bg.fillStyle(0x9bbc0f, 1); bg.fillTriangle(-3, h / 2, 3, h / 2, 0, h / 2 + 4);
  const c = scene.add.container(0, 0, [bg, txt]).setDepth(2850).setAlpha(0);
  scene.promptBubble = { c, txt, target: null, alpha: 0 };
}

export function updatePrompt(scene, dt) {
  const pb = scene.promptBubble;
  if (!pb) return;
  const p = scene.player;
  let best = null, bd = CONFIG.interactRadius + PROMPT_MARGIN;
  if (p && !p.dead) {
    for (const n of scene.npcs) {
      const d = Phaser.Math.Distance.Between(p.x, p.y, n.x, n.y);
      if (d < bd) { bd = d; best = n; }
    }
  }
  if (best) {
    pb.target = best;
    const def = best.getData('def');
    const label = def.shop ? 'E  Shop' : 'E  Talk';
    if (pb.txt.text !== label) pb.txt.setText(label);
  }
  // Full strength in interaction range, softer while approaching.
  const goal = best ? (bd <= CONFIG.interactRadius ? 1 : 0.6) : 0;
  pb.alpha += (goal - pb.alpha) * Math.min(1, dt * 10);
  if (pb.alpha < 0.01) pb.alpha = 0;
  pb.c.setAlpha(pb.alpha).setVisible(pb.alpha > 0);
  if (pb.target && pb.alpha > 0) {
    const bob = Math.sin(scene.time.now / 220) * 1.5;
    pb.c.setPosition(Math.round(pb.target.x), Math.round(pb.target.y - 38 + bob));
  }
}

// ─── Room code overlay ────────────────────────────────────────────────
class RoomCodeScene extends Phaser.Scene {
  constructor() { super('roomcode'); }
  create() {
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    this.born = this.time.now;
    this.bg = this.add.graphics();
    this.title = this.add.text(0, 0, '', { fontFamily: '"Silkscreen", monospace', fontSize: '10px', color: '#9bbc0f' }).setOrigin(0.5);
    this.code = this.add.text(0, 0, '', { fontFamily: '"Silkscreen", monospace', fontSize: '28px', color: '#e8f5a0', stroke: '#0a1e0a', strokeThickness: 4 }).setOrigin(0.5);
    this.hint = this.add.text(0, 0, '', { fontFamily: '"PixelifySans", monospace', fontSize: '11px', color: '#b4cc22' }).setOrigin(0.5);
    this.hit = this.add.zone(0, 0, 10, 10).setInteractive({ useHandCursor: true });
    this.hit.on('pointerdown', () => {
      try { navigator.clipboard?.writeText(net.code || ''); } catch { /* ignore */ }
      this.hint.setText('Copied!'); this.copiedAt = this.time.now;
    });
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
    this.layout();
  }
  layout() {
    const { width: W } = this.scale;
    const host = net.isHost;
    const big = host && (this.time.now - this.born) < 9000; // shout for 9s, then a compact chip
    const code = net.code || '-----';
    this.title.setText(host ? 'YOUR ROOM CODE' : 'ROOM').setFontSize(big ? '10px' : '8px');
    this.code.setText(code).setFontSize(big ? '28px' : '14px');
    const hintText = host ? (big ? 'Share this code - friends pick Join Co-op  (click to copy)' : 'click to copy') : 'co-op room';
    if (!this.copiedAt || this.time.now - this.copiedAt > 1500) this.hint.setText(hintText);
    const pw = big ? Math.min(W - 24, 330) : 120, ph = big ? 76 : 34, top = 8;
    const x = W / 2;
    this.bg.clear();
    this.bg.fillStyle(0x0a1e0a, 0.92).fillRect(x - pw / 2 - 2, top - 2, pw + 4, ph + 4);
    this.bg.fillStyle(0x306230, 1).fillRect(x - pw / 2, top, pw, ph);
    this.bg.fillStyle(0x0f380f, 1).fillRect(x - pw / 2 + 2, top + 2, pw - 4, ph - 4);
    if (big) {
      this.title.setPosition(x, top + 12); this.code.setPosition(x, top + 38); this.hint.setPosition(x, top + 62);
      this.hint.setVisible(true);
    } else {
      this.title.setPosition(x, top + 9); this.code.setPosition(x, top + 24); this.hint.setVisible(false);
    }
    this.hit.setPosition(x, top + ph / 2).setSize(pw, ph);
    this.hit.input.hitArea.setTo(0, 0, pw, ph);
    this.bigNow = big;
  }
  update() {
    const big = net.isHost && (this.time.now - this.born) < 9000;
    if (big !== this.bigNow || (this.copiedAt && this.time.now - this.copiedAt > 1500 && this.copiedAt > 0)) {
      this.copiedAt = 0; this.layout();
    }
  }
}

export function showRoomCode(world) {
  if (!net.connected || !net.code) return;
  const mgr = world.scene;
  if (!mgr.get('roomcode')) mgr.add('roomcode', RoomCodeScene, false);
  mgr.launch('roomcode');
  world.events.once('shutdown', () => { try { mgr.stop('roomcode'); } catch { /* ignore */ } });
}
