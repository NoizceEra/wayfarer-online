import { hudIconKey } from '../systems/hudIcons.js';
import { input } from '../core/input.js';
import { audio } from '../systems/audio.js';

// Advanced-class skill bar (keys 5/6): two small cells floating above the hotbar. Hidden until a
// class is chosen; icon / cooldown sweep follow the hero's advanced abilities. Built by UIScene
// (createAdvBar once, updateAdvBar every frame) — kept here so UIScene only carries two hook lines.
export function createAdvBar(ui, cx, y, size = 40) {
  const cells = [5, 6].map((key, i) => {
    const x = cx + (i ? 1 : -1) * (size / 2 + 3);
    const bg = ui.add.rectangle(x, y, size, size, 0x1a1024, 0.78).setStrokeStyle(2, 0xf4c542, 0.9).setDepth(100).setInteractive({ useHandCursor: true });
    const icon = ui.add.image(x, y, 'hud.slash').setScale(size >= 40 ? 2 : 1.5).setDepth(101);
    const badge = ui.add.text(x - size / 2 + 3, y - size / 2 + 2, input.labelFor(`skill${key}`), { fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#ffd84a', stroke: '#1a1024', strokeThickness: 3 }).setDepth(103);
    const cd = ui.add.rectangle(x, y, size - 2, size - 2, 0x000000, 0.7).setDepth(105).setVisible(false);
    const cdT = ui.add.text(x, y, '', { fontFamily: '"Silkscreen", monospace', fontSize: '12px', color: '#fff', stroke: '#1a1024', strokeThickness: 3 }).setOrigin(0.5).setDepth(106).setVisible(false);
    bg.on('pointerdown', () => { const w = ui.world?.(); if (!w?.player) return; audio.play('ui', 0.6); w.cast(String(key)); });
    const all = [bg, icon, badge, cd, cdT];
    all.forEach((o) => o.setVisible(false));
    return { key, bg, icon, badge, cd, cdT, size, all, ab: null };
  });
  ui.advBar = cells;
}

export function updateAdvBar(ui, w, now) {
  const cells = ui.advBar;
  if (!cells) return;
  const p = w?.player, adv = p?.advClass?.();
  for (const c of cells) {
    const ab = adv ? adv.abilities.find((a) => a.key === String(c.key)) : null;
    if (!ab || !p) { if (c.ab || c.bg.visible) { c.all.forEach((o) => o.setVisible(false)); c.ab = null; } continue; }
    if (c.ab !== ab) {
      c.ab = ab;
      const k = hudIconKey(ab.id);
      if (k && ui.textures.exists(k)) c.icon.setTexture(k);
      c.badge.setText(input.labelFor(`skill${c.key}`));
      [c.bg, c.icon, c.badge].forEach((o) => o.setVisible(true));
    }
    const learned = p.skillLv(ab.id) > 0;
    c.icon.setAlpha(learned ? 1 : 0.35);
    c.bg.setStrokeStyle(2, learned ? 0xf4c542 : 0x5a4a3a, 0.9);
    const total = p.skillCd(ab), remain = Math.max(0, ((p.cooldowns[ab.id] || 0) - now) / 1000), on = learned && remain > 0;
    c.cd.setVisible(on); c.cdT.setVisible(on);
    if (on) { c.cd.setDisplaySize(c.size - 2, (c.size - 2) * (remain / total)); c.cdT.setText(remain > 1 ? remain.toFixed(0) : remain.toFixed(1)); }
  }
}
