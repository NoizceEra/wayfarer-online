// First-time-user safeguards (additive; WorldScene installs one instance):
//  * autosave feedback   - a quiet "Progress saved" pip (at most every 9s) so players trust the autosave,
//  * low-HP teaching     - the first time HP drops under 30%, a toast says "press Q" (once, remembered),
//  * point reminders     - once each: unspent stat points (C > RECOMMENDED) and first skill point (K),
//  * stuck? teleport     - /stuck (also in the pause menu): free walk-home after a short, cancellable channel,
//                          refused in combat / during dungeon runs, 90s cooldown. Never costs XP or gold.
//  * /tutorial           - restarts the onboarding hint card (promised by its "Tutorial skipped" toast).
// Tips persist in localStorage so a returning player never sees a taught tip twice.
import { bus, Events } from '../core/events.js';
import { social } from './social/index.js';

const TIPS_KEY = 'wayfarer.tips.v1';
const STUCK_CHANNEL_MS = 4000;
const STUCK_COOLDOWN_MS = 90000;
const PIP_EVERY_MS = 9000;

const readTips = () => { try { return JSON.parse(window.localStorage.getItem(TIPS_KEY) || '{}') || {}; } catch { return {}; } };
const markTip = (k) => { try { const t = readTips(); t[k] = 1; window.localStorage.setItem(TIPS_KEY, JSON.stringify(t)); } catch { /* private mode */ } };
const seenTip = (k) => !!readTips()[k];

export function installFirstTimeSafeguards(scene) {
  const offs = [];
  let pip = null, pipTween = null, lastPip = 0, stuckCd = 0, stuckJob = null;
  const say = (t) => bus.emit(Events.SYSTEM, t);

  // ── autosave feedback ──────────────────────────────────────────────────────
  const showPip = () => {
    const ui = scene.scene.get('ui');
    if (!ui?.sys?.isActive?.() || !ui.add) return;
    const v = ui.view ? ui.view() : { w: ui.scale.width, h: ui.scale.height };
    if (!pip || !pip.active) pip = ui.add.text(12, 144, 'Progress saved', { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#9be88a', stroke: '#1a1024', strokeThickness: 3 }).setDepth(900).setAlpha(0);
    pip.setPosition(12, Math.min(144, v.h - 20));
    pipTween?.stop();
    pip.setAlpha(0.9);
    pipTween = ui.tweens.add({ targets: pip, alpha: 0, delay: 900, duration: 700 });
  };
  const origSave = scene.saveNow.bind(scene);
  scene.saveNow = (...a) => {
    const r = origSave(...a);
    const now = Date.now();
    if (now - lastPip > PIP_EVERY_MS) { lastPip = now; try { showPip(); } catch { /* UI not ready */ } }
    return r;
  };

  // ── teaching tips (once each) ──────────────────────────────────────────────
  offs.push(bus.on(Events.PLAYER_HP, (m) => {
    if (!m || !(m.maxHp > 0) || m.hp <= 0 || seenTip('lowhp')) return;
    if (m.hp / m.maxHp < 0.3) {
      markTip('lowhp');
      bus.emit(Events.TOAST, { title: 'Low HP!', text: `Press Q to drink a potion (${m.potions ?? 0} left). Step back out of a fight and HP regenerates.`, color: '#ff8a7a' });
    }
  }));
  const pointsTip = () => {
    const p = scene.player;
    if (!p?.prog) return;
    if (p.prog.statPoints > 0 && !seenTip('points')) {
      markTip('points');
      bus.emit(Events.TOAST, { title: `${p.prog.statPoints} stat points to spend`, text: 'Press C, then RECOMMENDED for a sensible build (APPLY to confirm).', color: '#9bf06b' });
    } else if (p.prog.skillPoints > 0 && !seenTip('skillpt')) {
      markTip('skillpt');
      bus.emit(Events.TOAST, { title: 'Skill point earned', text: 'Press K to upgrade a skill (+15% power, -6% cooldown per level).', color: '#9bf06b' });
    }
  };
  offs.push(bus.on(Events.LEVEL_UP, () => scene.time.delayedCall(3200, pointsTip)));
  if (!seenTip('points')) scene.time.delayedCall(45000, pointsTip);

  // ── stuck? teleport home ───────────────────────────────────────────────────
  const cancelStuck = (why) => { if (!stuckJob) return; stuckJob.remove(false); stuckJob = null; say(`Return to town cancelled${why ? `: ${why}` : ''}.`); };
  scene.stuck = () => {
    const p = scene.player, now = scene.time.now;
    if (!p || p.dead) return false;
    if (stuckJob) { say('Already returning to town...'); return false; }
    if (scene.combat?.inCombat) { say('You cannot use Stuck? during combat. Get clear of enemies first (5s).'); return false; }
    if (scene.dungeon?.active) { say('Hollow Depths run active: use the exit stairs instead of Stuck?.'); return false; }
    if (now < stuckCd) { say(`Stuck? is recharging (${Math.ceil((stuckCd - now) / 1000)}s).`); return false; }
    const from = { x: p.x, y: p.y };
    say(`Returning to Thistle Town in ${STUCK_CHANNEL_MS / 1000}s. Move or fight to cancel. (No XP or gold lost.)`);
    bus.emit(Events.TOAST, { title: 'Stuck? Heading home', text: 'Stand still for 4 seconds...', color: '#7fdcff' });
    stuckJob = scene.time.addEvent({
      delay: 250, loop: true,
      callback: () => {
        const q = scene.player;
        if (!q || q.dead) return cancelStuck('you fell');
        if (Math.hypot(q.x - from.x, q.y - from.y) > 28) return cancelStuck('you moved');
        if (scene.combat?.inCombat) return cancelStuck('you are in combat');
        if (scene.time.now - (stuckJob.t0 || (stuckJob.t0 = scene.time.now)) < STUCK_CHANNEL_MS) return;
        stuckJob.remove(false); stuckJob = null;
        stuckCd = scene.time.now + STUCK_COOLDOWN_MS;
        const dest = scene.areas?.waystoneDest?.('town') || { area: null, x: scene.spawn.x, y: scene.spawn.y };
        if (scene.areas) scene.areas.warp(dest.area, dest.x, dest.y, { label: 'Returning to Thistle Town...', quick: true });
        else q.setPosition(dest.x, dest.y);
        bus.emit(Events.SYSTEM, 'You are back in Thistle Town.');
      },
    });
    stuckJob.t0 = now;
    return true;
  };

  // ── slash commands: /stuck, /town, /tutorial ───────────────────────────────
  if (social && !social._firstTimeCommands) {
    social._firstTimeCommands = true;
    const orig = social.command.bind(social);
    social.command = (raw) => {
      const cmd = String(raw).slice(1).split(' ')[0].toLowerCase();
      const w = social._firstTimeScene;
      if ((cmd === 'stuck' || cmd === 'unstuck' || cmd === 'town') && w?.stuck) { w.stuck(); return undefined; }
      if (cmd === 'tutorial' && w?.onboarding) { w.onboarding.restart(); say('Tutorial hints restarted.'); return undefined; }
      if (cmd === 'guide' && w?.quests) { w.quests.guideOn = w.quests.guideOn === false; say(`Quest guide arrow ${w.quests.guideOn === false ? 'hidden' : 'shown'}.`); return undefined; }
      return orig(raw);
    };
  }
  social._firstTimeScene = scene;

  return () => {
    offs.forEach((o) => o());
    stuckJob?.remove(false); stuckJob = null;
    pipTween?.stop(); pip?.destroy(); pip = null;
    if (social._firstTimeScene === scene) social._firstTimeScene = null;
  };
}
