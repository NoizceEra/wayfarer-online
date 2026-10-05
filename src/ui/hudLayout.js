// hudLayout.js — single source of truth for WHERE canvas HUD widgets live, so
// widgets added by different scenes (UIScene, CharacterScene, EventHudScene,
// CombatHudScene, onboarding, party frames, buffs) stop colliding.
//
// Zones (logical px, i.e. after the HUD camera zoom):
//   top-left      status panel -> shortcut row -> buff row -> party label -> party frames
//   top-right     menu buttons (II ? fs) -> quest tracker -> dock of icon pills
//                 (desktop: a horizontal row under the quest panel; phones: a vertical rail)
//   top-center    zone label, then ONE shared vertical stack: hint -> event ticker -> boss bar -> target frame
//   bottom-left   chat + joystick     bottom-center  adv class bar + hotbar     bottom-right  minimap + action buttons
//
// New widget? Pick a zone, read its rect from hudLayout(), and if it joins the
// top-center stack call stackY(id) / setStackH(id, h) — never hardcode a y.
import { THEME } from './theme.js';

export const isSmall = (W) => W < 560;
export const SHORTCUT_Y = 128; // centre of the CHAR / SKILL / LOG / CRAFT button row (same on every screen size)

export function hudLayout(W, H) {
  const small = isSmall(W);
  const pw = small ? 196 : 232;
  const L = { small, W, H };
  L.status = { x: 8, y: 8, w: pw, h: 106 };
  // top-left column
  L.shortcutY = 128;                 // centre of the CHAR/SKILL/LOG/CRAFT row (rect 118..138)
  L.buffY = 142;                     // top of the CombatHud buff row (24px tall)
  L.stripY = 170;                    // status-readability strip (hudPolish) sits under it
  L.partyLabelY = 198;
  L.framesY = 210;
  // top-right
  const colX = L.status.x + pw + 6;  // right column starts here on phones
  L.menu = small
    ? { size: 28, gap: 4, y: 8, right: W - 8 }
    : { size: 22, gap: 4, y: 8, right: W - 8 - 214 - 8 };
  L.quest = small
    ? { x: W - 8 - Math.min(200, W - 8 - colX), y: 40, w: Math.min(200, W - 8 - colX) }  // below the menu buttons
    : { x: W - 8 - 214, y: 8, w: 214 };
  L.colX = colX;
  return L;
}

// ── top-center shared stack ─────────────────────────────────────────────────
const stack = { order: ['hint', 'banner', 'events', 'boss', 'target'], h: { hint: 0, banner: 0, events: 0, boss: 0, target: 0 }, gap: 4 };
export const STACK_BASE = (W) => (isSmall(W) ? 176 : 44);
export function setStackH(id, h) { stack.h[id] = Math.max(0, Math.round(h || 0)); }
/** y (top) where widget `id` should draw, below every earlier widget in the stack that is visible. */
export function stackY(id, W) {
  let y = STACK_BASE(W);
  for (const k of stack.order) {
    if (k === id) return y;
    if (stack.h[k] > 0) y += stack.h[k] + stack.gap;
  }
  return y;
}
export function stackBottom(W) {
  let y = STACK_BASE(W);
  for (const k of stack.order) if (stack.h[k] > 0) y += stack.h[k] + stack.gap;
  return y;
}

// ── dock of icon pills ──────────────────────────────────────────────────────
// items: [{ btn: Phaser.GameObjects.Text, icon: Phaser.GameObjects.Image, label: string, key?: string }]
const PILL = 28;
export function layoutDock(scene, items, W, topY) {
  const small = isSmall(W);
  const step = small ? 31 : 29;
  const out = { bottom: topY, left: W - 8 };
  items.forEach((it, i) => {
    let cx, cy;
    if (small) { cx = W - 8 - PILL / 2; cy = topY + PILL / 2 + i * step; }
    else { cx = W - 8 - PILL / 2 - i * step; cy = topY + PILL / 2; }
    it.btn.setPosition(cx, cy);
    it.icon?.setPosition(cx, cy);
    it.badge?.setPosition(cx + PILL / 2 - 3, cy - PILL / 2 + 3);
    it.cx = cx; it.cy = cy;
    out.bottom = Math.max(out.bottom, cy + PILL / 2);
    out.left = Math.min(out.left, cx - PILL / 2);
  });
  return out;
}

/** Turn an emoji Text button into a square icon pill (keeps its input handlers). */
export function makePill(scene, btn, iconKey, label, depth = 110) {
  btn.setText(' ').setOrigin(0.5).setFixedSize(PILL, PILL).setAlign('center').setPadding(0)
    .setBackgroundColor('#2a1d10').setDepth(depth);
  btn.removeInteractive(); btn.setInteractive({ useHandCursor: true }); // hit area = the new 28px square
  const icon = iconKey && scene.textures.exists(iconKey)
    ? scene.add.image(0, 0, iconKey).setScale(PILL >= 28 ? 1.5 : 1).setDepth(depth + 1)
    : null;
  // 2px wood frame so every pill matches the HUD panels
  const frame = scene.add.rectangle(0, 0, PILL, PILL, 0x000000, 0).setStrokeStyle(2, THEME.hex.wood).setDepth(depth + 1);
  const origPos = btn.setPosition.bind(btn);
  btn.setPosition = (x, y) => { origPos(x, y); frame.setPosition(x, y); return btn; };
  btn.on('pointerover', () => frame.setStrokeStyle(2, THEME.hex.gold));
  btn.on('pointerout', () => frame.setStrokeStyle(2, THEME.hex.wood));
  const it = { btn, icon, frame, label };
  // destroying the pill removes its parts
  btn.once('destroy', () => { icon?.destroy(); frame.destroy(); });
  return it;
}

/** Small tooltip label for dock pills (works on hover/focus; touch shows it on tap). */
export function dockTip(scene, depth = 140) {
  const t = scene.add.text(0, 0, '', {
    fontFamily: THEME.font.label, fontSize: '10px', color: THEME.color.cream,
    backgroundColor: '#1a1008ee', padding: { x: 5, y: 3 },
  }).setDepth(depth).setVisible(false);
  return {
    t,
    show(it, W) {
      t.setText(it.label).setVisible(true);
      if (isSmall(W)) t.setOrigin(1, 0.5).setPosition(it.cx - PILL / 2 - 4, it.cy);
      else t.setOrigin(Math.min(1, Math.max(0, (it.cx + t.width / 2 > W - 4) ? 1 : 0.5)), 0).setPosition(Math.min(it.cx, W - 4 - (it.cx + t.width / 2 > W - 4 ? 0 : 0)), it.cy + PILL / 2 + 3);
    },
    hide() { t.setVisible(false); },
  };
}
