// Material pack helpers: everything that touches `scene.meta.mats` goes through
// here so codex discovery, recipe discovery, scroll auto-learn, quest progress
// and achievement counters all stay in one place. No Phaser dependency except
// for the scene handed in.
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { matById, PACK_CAP } from '../data/materials.js';

export const matCount = (scene, id) => scene.meta?.mats?.[id] || 0;

// Add n of a material. Returns how many were actually stored (stack cap).
export function addMat(scene, id, n = 1, opts = {}) {
  const m = matById(id);
  const meta = scene.meta;
  if (!m || !meta || n <= 0) return 0;
  const have = meta.mats[id] || 0;
  const add = Math.max(0, Math.min(n, PACK_CAP - have));
  if (!add) { if (!opts.quiet) bus.emit(Events.SYSTEM, `Pack full of ${m.name} (${PACK_CAP}).`); return 0; }
  meta.mats[id] = have + add;
  const first = !meta.codex.mats[id];
  meta.codex.mats[id] = 1;
  if (first && !opts.quiet) bus.emit(Events.SYSTEM, `Codex: discovered ${m.name}.`);
  // scrolls teach their recipe at once (and are not kept)
  if (m.learn) {
    meta.mats[id] -= add;
    if (meta.mats[id] <= 0) delete meta.mats[id];
    scene.craft?.learn(m.learn, { from: m.name });
  }
  scene.craft?.onMatDiscovered(id);
  if (!opts.noQuest) scene.quests?.onPack();
  if (opts.float !== false && scene.player && !opts.quiet) {
    scene.damageNumber?.(scene.player.x, scene.player.y - 6, `+${add} ${m.name}`, '#9be88a');
  }
  bus.emit(Events.GEAR, { changed: true }); // panels that show the pack refresh
  return add;
}

export function takeMat(scene, id, n = 1) {
  const meta = scene.meta;
  if (!meta || (meta.mats[id] || 0) < n) return false;
  meta.mats[id] -= n;
  if (meta.mats[id] <= 0) delete meta.mats[id];
  scene.quests?.onPack();
  return true;
}

// Consume a consumable from the pack and apply its effect. Returns true if used.
export function useMat(scene, id) {
  const m = matById(id), p = scene.player;
  if (!m || !m.use || !p || p.dead || (scene.meta.mats[id] || 0) < 1) return false;
  const u = m.use;
  const needsHeal = u.heal && p.hp < p.effMaxHp();
  const needsMp = u.mp && p.mp < p.effMaxMp();
  if (!u.buff && !needsHeal && !needsMp) { bus.emit(Events.SYSTEM, 'Nothing to restore right now.'); audio.play('error', 0.6); return false; }
  takeMat(scene, id, 1);
  if (u.heal) { p.heal(u.heal); scene.damageNumber?.(p.x, p.y, `+${u.heal}`, '#2ecc71'); }
  if (u.mp) { p.mp = Math.min(p.effMaxMp(), p.mp + u.mp); scene.damageNumber?.(p.x, p.y, `+${u.mp} MP`, '#5dade2'); }
  if (u.buff) scene.craft?.addBuff(u.buff);
  audio.play('potion');
  scene.spawnFx?.(p.x, p.y - 10, 'fx.spark', 1.2);
  bus.emit(Events.SYSTEM, `Used ${m.name}.`);
  bus.emit(Events.PLAYER_HP, scene.hpPayload());
  scene.quests?.onUse(id);
  bus.emit(Events.ACH_EVENT, { k: 'use', id });
  return true;
}

export function packList(scene) {
  return Object.entries(scene.meta?.mats || {}).filter(([, n]) => n > 0).map(([id, n]) => ({ id, n, m: matById(id) })).filter((e) => e.m);
}
