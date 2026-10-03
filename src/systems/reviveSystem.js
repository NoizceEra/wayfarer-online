// Premium revive wiring. Owns the full lifecycle so the flow works without
// editing combat.js (the death penalty is applied there, at death time).
//
// Flow:
//   1. combat.onPlayerDeath() applies xp/gold loss, then emits PLAYER_DIED.
//   2. This system shows RevivePanel so the player can choose.
//   3. "Revive (25 tokens)" -> econ.spendTokens('revive', 25)   [single spend]
//   4. Server deducts and replies 'token-spend-ok' {type:'revive'}.
//   5. applyPremiumRevive() REFUNDS the already-applied death penalty and
//      respawns immediately at the waystone. That refund is what the tokens buy.
//   6. If the player does nothing, combat's own timer respawns them at 3s and
//      they keep the penalty.
//
// Ownership rule: only this system spends for a revive. RevivePanel and
// TokenSinkPanel must never re-spend on a confirmation event, or the flow
// loops (spend -> confirm -> spend).
import { bus, Events } from '../core/events.js';
import { econ } from '../net/economyNet.js';
import { RevivePanel } from '../ui/RevivePanel.js';

let panel = null;
let offSpend = null;
let offDeath = null;

export function installReviveSystem(scene) {
  destroyReviveSystem();
  offSpend = econ.on('token-spend-ok', (m) => {
    if (m?.type === 'revive') applyPremiumRevive(scene);
  });
  offDeath = bus.on(Events.PLAYER_DIED, () => {
    if (!panel || panel.destroyed) panel = new RevivePanel(scene);
    panel.show();
  });
  scene.events.once('shutdown', destroyReviveSystem);
}

// The death penalty was already taken in combat.onPlayerDeath(); a premium
// revive buys it back and stands the hero up without the 3s wait.
function applyPremiumRevive(scene) {
  const combat = scene.combat;
  const p = scene.player;
  if (!combat || !p) return;
  const d = combat.death;
  if (d) {
    p.xp = (p.xp || 0) + (d.xpLoss || 0);
    p.gold = (p.gold || 0) + (d.goldLoss || 0);
  }
  const dest = d?.destObj || combat.respawnPoint();
  if (p.dead) combat.respawn(dest);
  bus.emit(Events.PLAYER_XP, scene.xpPayload?.());
  bus.emit(Events.PLAYER_HP, scene.hpPayload?.());
  bus.emit(Events.SYSTEM, 'Premium revive: death penalty refunded. Stand up and fight!');
  if (panel) { panel.destroy(); panel = null; }
}

export function destroyReviveSystem() {
  if (offSpend) { offSpend(); offSpend = null; }
  if (offDeath) { offDeath(); offDeath = null; }
  if (panel) { panel.destroy(); panel = null; }
}
