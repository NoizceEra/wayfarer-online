import Phaser from 'phaser';
import { bus, Events } from '../../core/events.js';
import { net } from '../../net/NetworkManager.js';
import { social } from './index.js';
import { ensureEmoteTextures, playEmoteAnim } from './emotes.js';

// World-space social layer for WorldScene: speech bubbles for Say, emote
// bubbles + rig animations (local and remote), nameplate decoration
// (guild tag, level, party/friend colour) and right-click on a remote hero to
// open the social context menu. Install with installSocialWorld(scene) once
// scene.sync exists; it tears itself down on scene shutdown.
const FONT = '"Silkscreen", monospace';

class Bubble {
  constructor(scene, target, { text, icon, ttl }) {
    this.scene = scene; this.target = target;
    this.c = scene.add.container(target.x, target.y).setDepth(3000);
    let w, h, content;
    if (icon) {
      content = scene.add.image(0, 0, icon).setScale(2).setOrigin(0.5);
      w = 32; h = 32;
    } else {
      content = scene.add.text(0, 0, text, { fontFamily: FONT, fontSize: '8px', color: '#1a1024', wordWrap: { width: 110, useAdvancedWrap: true }, align: 'center', lineSpacing: 1 }).setOrigin(0.5);
      w = Math.ceil(content.width) + 10; h = Math.ceil(content.height) + 8;
    }
    const g = scene.add.graphics();
    // pixel speech bubble: dark outline, cream fill, tiny tail
    g.fillStyle(0x1a1024, 1).fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
    g.fillStyle(0xfff6e0, 1).fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle(0x1a1024, 1).fillRect(-3, h / 2, 6, 1).fillRect(-2, h / 2 + 1, 4, 1).fillRect(-1, h / 2 + 2, 2, 1);
    g.fillStyle(0xfff6e0, 1).fillRect(-2, h / 2, 4, 1).fillRect(-1, h / 2 + 1, 2, 1);
    this.c.add([g, content]);
    this.h = h;
    this.c.setScale(0.6).setAlpha(0);
    scene.tweens.add({ targets: this.c, scale: 1, alpha: 1, duration: 120, ease: 'back.out' });
    this.dieAt = scene.time.now + ttl;
    this.dead = false;
  }
  update(lift) {
    if (this.dead) return;
    if (!this.target.active) return this.destroy();
    this.c.setPosition(Math.round(this.target.x), Math.round(this.target.y - 38 - this.h / 2 - lift));
    if (this.scene.time.now > this.dieAt) {
      this.dead = true;
      this.scene.tweens.add({ targets: this.c, alpha: 0, y: this.c.y - 6, duration: 200, onComplete: () => this.c.destroy() });
    }
  }
  destroy() { this.dead = true; this.c.destroy(); }
}

export function installSocialWorld(scene) {
  ensureEmoteTextures(scene);
  social.world = scene;
  if (scene.player) { social.me.level = scene.player.level; social.me.job = scene.player.job.id; }
  if (net.connected) social.onConnected();
  const bubbles = new Map(); // target -> {speech, emote}
  const targetFor = (from) => {
    if (!from || from === 'me' || from === net.sessionId) return scene.player;
    return scene.sync?.remotes?.get(from) || null;
  };
  const rigFor = (t) => (t === scene.player ? scene.player.rig : t?.avatar?.rig);
  const put = (t, kind, b) => {
    const slot = bubbles.get(t) || {};
    slot[kind]?.destroy();
    slot[kind] = b; bubbles.set(t, slot);
  };

  const off = [
    bus.on(Events.SOCIAL_CHAT, (l) => {
      if (l.ch !== 'say' || !l.text || l.plain) return;
      const t = targetFor(l.self ? 'me' : l.from); if (!t) return;
      put(t, 'speech', new Bubble(scene, t, { text: l.text.slice(0, 90), ttl: 2600 + 55 * l.text.length }));
    }),
    bus.on(Events.SOCIAL_EMOTE, (m) => {
      const t = targetFor(m.from); if (!t) return;
      put(t, 'emote', new Bubble(scene, t, { icon: `emote.${m.id}`, ttl: 2200 }));
      playEmoteAnim(scene, rigFor(t), m.id);
    }),
  ];

  // nameplates: refresh remote labels when the roster/party/friends change (and
  // shortly after a peer spawns, since RemotePlayer creation is async to us)
  let plateDirty = true, plateT = 0;
  const markDirty = () => { plateDirty = true; };
  off.push(bus.on(Events.SOCIAL_ROSTER, markDirty), bus.on(Events.SOCIAL_PARTY, markDirty), bus.on(Events.NET_PLAYER_JOINED, markDirty));
  const refreshPlates = () => {
    scene.sync?.remotes?.forEach((r, id) => {
      if (!r.label?.active) return;
      const p = social.plateFor(id, r.rname);
      if (r.label.text !== p.text) r.label.setText(p.text);
      if (r.label.style.color !== p.color) r.label.setColor(p.color);
    });
  };

  const onUpdate = () => {
    const now = scene.time.now;
    if (plateDirty || now - plateT > 1500) { plateDirty = false; plateT = now; refreshPlates(); }
    bubbles.forEach((slot, t) => {
      let lift = 0;
      if (slot.emote) { slot.emote.update(0); if (slot.emote.dead) { slot.emote = null; } else lift = 34; }
      if (slot.speech) { slot.speech.update(lift); if (slot.speech.dead) slot.speech = null; }
      if (!slot.emote && !slot.speech) bubbles.delete(t);
    });
  };
  scene.events.on('update', onUpdate);

  // right-click a remote hero -> context menu (invite / whisper / friend / ignore)
  const onPointer = (p) => {
    if (p.button !== 2 || !scene.sync?.remotes?.size) return;
    let best = null, bd = 26;
    scene.sync.remotes.forEach((r, id) => {
      const d = Phaser.Math.Distance.Between(p.worldX, p.worldY + 8, r.x, r.y);
      if (d < bd) { bd = d; best = { id, name: r.rname }; }
    });
    if (best) social.act('contextMenu', { id: best.id, name: best.name, x: p.event?.clientX ?? p.x, y: p.event?.clientY ?? p.y });
  };
  scene.input.on('pointerdown', onPointer);

  const destroy = () => {
    off.forEach((f) => f());
    scene.events.off('update', onUpdate);
    scene.input.off('pointerdown', onPointer);
    bubbles.forEach((s) => { s.emote?.destroy(); s.speech?.destroy(); });
    bubbles.clear();
    if (social.world === scene) social.world = null;
  };
  scene.events.once('shutdown', destroy);
  return { destroy };
}
