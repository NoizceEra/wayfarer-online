// Onboarding funnel for first-time Wayfarer Online players.
// Additive module: WorldScene constructs, updates and destroys one instance.
import { bus, Events } from '../core/events.js';
import { loadProgress } from '../core/save.js';
import { OnboardingHint } from '../ui/OnboardingHint.js';

const ONBOARD_KEY = 'wayfarer.onboarding.v1';
// Non-blocking tips: every step advances by doing the thing, SKIP X dismisses the
// whole card for good (localStorage), and it never returns for a saved hero.
const STEPS = [
  { id: 'move', title: 'Move', hint: 'WASD or arrow keys to walk.' },
  { id: 'attack', title: 'Strike', hint: 'Left-click or J to attack. Tab locks the nearest foe.' },
  { id: 'kill', title: 'Slay', hint: 'Defeat a Dew Slime in the meadow, west of the plaza.' },
  { id: 'talk', title: 'Talk', hint: "Find Pip (a gold '!' above his head) and press E. Quests show in the top-right tracker." },
  { id: 'skills', title: 'Skills', hint: 'Press 1-4 to use your skills. K spends skill points as you level.' },
  { id: 'board', title: 'Notice Board', hint: 'Walk to the town notice board for daily bounties.' },
];

export class OnboardingSystem {
  constructor(scene) {
    this.scene = scene;
    this.done = this.alreadyDone();
    this.step = this.done ? STEPS.length : 0;
    this.spawn = { x: scene.spawn.x, y: scene.spawn.y };
    this.hint = null;
    this.unsubs = [];

    if (this.done || !scene.player) return;

    // First-time gate: do not start if this hero name already has saved progress.
    const saved = loadProgress(scene.pname);
    if (saved?.savedAt) { this.finish(true); return; }

    this.hint = new OnboardingHint(scene, {
      steps: STEPS,
      step: this.step,
      onSkip: () => this.skip(),
    });

    this.unsubs.push(
      bus.on(Events.KILL, (p) => this.onKill(p)),
      bus.on(Events.QUEST_CHANGED, () => this.onQuest()),
      bus.on(Events.SKILL_CAST, () => this.onSkill()),
      scene.events.on('shutdown', () => this.destroy())
    );
  }

  alreadyDone() {
    try { return window.localStorage.getItem(ONBOARD_KEY) === 'done'; } catch { return false; }
  }

  markDone() {
    this.done = true;
    try { window.localStorage.setItem(ONBOARD_KEY, 'done'); } catch { /* quota */ }
  }

  onKill() {
    if (this.done) return;
    // The KILL event fires for any local-player kill; it satisfies the ATTACK and
    // KILL steps because a kill proves the player found the attack key.
    if (this.step <= 2) this.advance(3);
  }

  // Talk step: any accepted quest proves the player found an NPC.
  onQuest() {
    if (this.done || this.step !== 3) return;
    if (this.scene.quests?.activeCount?.() > 0) this.advance(4);
  }

  // Skills step: a genuine cast (SKILL_CAST fires after the learn/cooldown guards).
  onSkill() {
    if (this.done) return;
    this.skillSeen = true;
    if (this.step === 4) this.advance(5);
  }

  update() {
    if (this.done || !this.hint || !this.scene.player) return;
    const p = this.scene.player;

    // MOVE: >40 px from spawn
    if (this.step === 0) {
      const d = Phaser.Math.Distance.Between(p.x, p.y, this.spawn.x, this.spawn.y);
      if (d > 40) this.advance(1);
    }

    // ATTACK: the combo chain timer is armed by every swing.
    if (this.step === 1 && (this.scene.combat?.chain?.until || 0) > this.scene.time.now) this.advance(2);

    // A hero who already has quests running skips the talk tip.
    if (this.step === 3 && this.scene.quests?.activeCount?.() > 0) this.advance(4);

    if (this.step === 4 && this.skillSeen) this.advance(5);

    // NOTICE BOARD: within ~60 px of the town board (uses the board placed in
    // WorldScene near spawn.x - 118, spawn.y - 22). If the board is ever moved,
    // update boardPos accordingly. Only offered once the player knows the basics.
    if (this.step >= 4) {
      const boardPos = this.boardPos();
      const d = Phaser.Math.Distance.Between(p.x, p.y, boardPos.x, boardPos.y);
      if (d < 60) this.advance(STEPS.length);
    }
  }

  boardPos() {
    // WorldScene creates the notice board at (spawn.x - 118, spawn.y - 22).
    return { x: this.spawn.x - 118, y: this.spawn.y - 22 };
  }

  advance(next) {
    if (this.done || next <= this.step) return;
    this.step = Math.min(next, STEPS.length);
    this.hint?.setStep(this.step, true);
    if (this.step >= STEPS.length) {
      this.complete();
    }
  }

  complete() {
    if (this.done) return;
    this.markDone();
    this.hint?.showDone();
    bus.emit(Events.TOAST, { title: 'Tutorial Complete', text: 'Welcome to Embervale, Wayfarer!', color: '#14F195' });
    this.scene.time.delayedCall(2500, () => this.destroy());
  }

  skip() {
    this.finish(true);
  }

  restart() {
    try { window.localStorage.removeItem(ONBOARD_KEY); } catch { /* ignore */ }
    this.done = false;
    this.step = 0;
    this.spawn = { x: this.scene.spawn.x, y: this.scene.spawn.y };
    if (!this.hint || !this.hint.active) {
      this.hint = new OnboardingHint(this.scene, { steps: STEPS, step: 0, onSkip: () => this.skip() });
    } else {
      this.hint.setStep(0, false);
    }
  }

  finish(silent = false) {
    this.done = true;
    this.step = STEPS.length;
    this.markDone();
    this.hint?.destroy();
    this.hint = null;
    if (!silent) bus.emit(Events.TOAST, { title: 'Tutorial Skipped', text: 'You can restart with /tutorial', color: '#6B7A99' });
  }

  destroy() {
    this.unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
    this.unsubs = [];
    this.hint?.destroy();
    this.hint = null;
  }
}
