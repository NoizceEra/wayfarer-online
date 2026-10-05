import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy.js';
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { skillDmgMul } from '../data/stats.js';
import { hasVfx, impactAt, SKILL_DELAY, ELEMENT_OF, dashGhostTrail } from './skillVfx.js';

// Data-driven skill effects for abilities that carry an `fx` block (jobs.js).
// Returns true if the ability was handled (WorldScene.cast then returns).
// Effect level scaling: damage/heal/duration scale with skillDmgMul(lv);
// cooldown scaling is applied by the caller via player.skillCd().
const MELEE_AOE = new Set(['bash', 'fangdance']);
export function castFx(scene, ab, lv, setCd) {
  const fx = ab.fx;
  if (!fx) return false;
  const p = scene.player;
  const dm = skillDmgMul(lv);
  if (fx.mp && p.mp < fx.mp) { audio.play('error', 0.7); bus.emit(Events.SYSTEM, 'Not enough MP!'); return true; }
  if (fx.mp) p.mp -= fx.mp;
  setCd();
  const near = (r, cb) => scene.enemies.children.each((e) => {
    if (e instanceof Enemy && e.alive && (e.areaId || null) === (scene.areas?.current?.id || null) && Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y) < r) cb(e);
    return true;
  });
  const slow = (e, secs) => scene.combat.applyEnemyStatus(e, 'slow', secs);
  // AoE and dash skills can declare knockback and a status in jobs.js.  Keep
  // the shape identical to normal combat hits so proc chance, duration and
  // status refresh rules stay in one place.
  const hitOpts = () => ({
    knock: fx.knock,
    status: fx.status && {
      ...fx.status,
      secs: fx.status.secs == null ? undefined : fx.status.secs * (0.85 + 0.15 * dm),
    },
  });

  if (fx.type === 'aoe') {
    audio.play('explosion', 0.8);
    if (!hasVfx(ab.id)) { scene.spawnFx(p.x, p.y - 8, fx.vfx || 'fx.explosion', 1.6); if (fx.shake) scene.cameras.main.shake(120, fx.shake); }
    if (!hasVfx(ab.id) || MELEE_AOE.has(ab.id)) p.attackPose();
    let n = 0;
    const hit = () => near(fx.radius, (e) => {
      scene.damageEnemy(e, p.rollCrit(p.effAtk() * fx.mul * dm), false, hitOpts());
      if (fx.slow) slow(e, fx.slow * (0.85 + 0.15 * dm));
      impactAt(scene, e, ELEMENT_OF[ab.id]);
      n += 1;
    });
    const delay = SKILL_DELAY[ab.id] || 0; // meteor / arrow rain: damage lands with the visual impact
    if (delay) scene.time.delayedCall(delay, () => { if (!p.dead) { hit(); bus.emit(Events.SYSTEM, `${ab.name}: ${n} hit`); } });
    else { hit(); bus.emit(Events.SYSTEM, `${ab.name}: ${n} hit`); }
  } else if (fx.type === 'shot') {
    audio.play(fx.kind === 'arrow' ? 'arrow' : 'fireball');
    p.attackPose();
    const base = scene.facingAngle();
    const half = (fx.n - 1) / 2;
    for (let i = 0; i < fx.n; i++) {
      scene.fireShot(p.x, p.y - 8, base + (i - half) * fx.spread, p.rollCrit(p.effAtk() * fx.mul * dm), fx.kind);
    }
  } else if (fx.type === 'heal') {
    audio.play('heal');
    if (!hasVfx(ab.id)) scene.spawnFx(p.x, p.y - 6, 'fx.aura', 1.6);
    const n = Math.round(p.effMaxHp() * fx.pct * dm);
    p.heal(n);
    scene.damageNumber(p.x, p.y, `+${n}`, '#2ecc71');
    if (fx.spdMul) p.buff = { until: scene.time.now + (fx.secs || 4) * 1000, spdMul: fx.spdMul };
    bus.emit(Events.PLAYER_HP, scene.hpPayload());
    bus.emit(Events.SYSTEM, `${ab.name}: +${n} HP`);
  } else if (fx.type === 'buff') {
    audio.play('cast');
    if (!hasVfx(ab.id)) scene.spawnFx(p.x, p.y - 8, 'fx.boost', 1.4);
    p.buff = { until: scene.time.now + fx.secs * 1000 * (0.85 + 0.15 * dm), atkMul: fx.atkMul, spdMul: fx.spdMul };
    if (fx.ward) p.invulnUntil = scene.time.now + fx.ward * 1000 * dm;
    bus.emit(Events.SYSTEM, `${ab.name}: empowered!`);
  } else if (fx.type === 'strike') {
    audio.play('dash');
    const a = scene.facingAngle();
    if (!hasVfx(ab.id)) scene.spawnFx(p.x, p.y - 8, 'fx.dust', 1.4);
    dashGhostTrail(scene, p);
    p.attackPose();
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      scene.time.delayedCall(i * 40, () => {
        if (!p.active) return;
        near(fx.radius, (e) => {
          if (!e.getData('struck' + ab.id)) {
            e.setData('struck' + ab.id, true);
            scene.time.delayedCall(400, () => e.active && e.setData('struck' + ab.id, false));
            scene.damageEnemy(e, p.rollCrit(p.effAtk() * fx.mul * dm), false, hitOpts());
            impactAt(scene, e, 'shadow');
            scene.spawnFx(e.x, e.y - 8, 'fx.cutX', 1.1);
          }
        });
      });
    }
    scene.tweens.add({
      targets: p, duration: steps * 40, ease: 'sine.out',
      x: Phaser.Math.Clamp(p.x + Math.cos(a) * fx.dist, 40, 2048 - 40),
      y: Phaser.Math.Clamp(p.y + Math.sin(a) * fx.dist, 40, 2048 - 40),
    });
    p.invulnUntil = scene.time.now + 350;
  } else {
    return false;
  }
  bus.emit(Events.PLAYER_HP, scene.hpPayload());
  return true;
}
