// Turn-based pet battle engine — purely client-side for PvE wild battles,
// but structured so the same deterministic class can run on both PvP clients
// with server-authoritative turn validation later.
//
// Design for PvP sync:
//   - A "command" is { sourceSide, sourceSlot, action, targetSide?, targetSlot?, moveId?, itemId?, switchId?, seed }.
//   - Both clients must have identical teams at battle start (server seed).
//   - Commands are queued, then executed deterministically by sorted speed each round.
//   - A pseudo-random sequence advances per needed roll; seeded PRNG means both
//     clients produce the same outcome for the same commands.
//   - Server can validate by running the same PetBattle class and comparing
//     resulting hashes; this class never mutates external hero data directly.
//
import { MOVES, baseFor, statsAt, typeMultiplier } from '../data/pets.js';
import { bus, Events } from '../core/events.js';

const CRIT_CHANCE = 0.0625; // ~6% crit
const CRIT_MUL = 1.5;
const RANDOM_MIN = 0.85;
const RANDOM_MAX = 1.0;
const XP_BASE = 20;
const XP_SCALE = 6;

// Lightweight seeded PRNG (xorshift32). Deterministic for PvP.
function makeRng(seed = 0) {
  let s = seed >>> 0 || 123456789;
  return function random() {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Deep-clone a team so the engine owns its state.
function cloneTeam(team) {
  return team.map((p, i) => ({
    side: p.side ?? 'player',
    slot: p.slot ?? i,
    id: p.id,
    name: p.name ?? p.id,
    level: p.level,
    xp: p.xp ?? 0,
    hp: p.hp ?? statsAt(p.id, p.level).hp,
    stats: { ...statsAt(p.id, p.level), ...(p.stats || {}) },
    moves: (p.moves && p.moves.length ? p.moves : (statsAt(p.id, p.level)?.moves || [])).slice(0, 4),
    status: p.status || {},
    buffs: { ...(p.buffs || {}) }, // { atk:{amt,turns}, def:{}, spd:{} }
    fainted: !!p.fainted,
    isWild: !!p.isWild,
  }));
}

export class PetBattle {
  // options:
  //   seed         number     battle PRNG seed (server-provided for PvP)
  //   onEvent      fn(event)  real-time animation events: move, damage, heal, buff, debuff, faint, win, lose
  //   onReward     fn({xpMap}) called on PvE win with XP per surviving pet slot
  //   isPvp        bool       if true, emit commands via net.send instead of executing locally
  //   net          NetworkManager-like object with send/on
  //   rewardScale  number     XP multiplier (default 1)
  constructor(scene, playerTeam, opponentTeam, options = {}) {
    this.scene = scene;
    this.opts = options;
    this.rng = makeRng(options.seed ?? (Math.random() * 0xffffffff) >>> 0);
    this.playerTeam = cloneTeam(playerTeam).map((p, i) => { p.side = 'player'; p.slot = i; return p; });
    this.opponentTeam = cloneTeam(opponentTeam).map((p, i) => { p.side = 'opponent'; p.slot = i; return p; });
    this.all = [...this.playerTeam, ...this.opponentTeam];
    this.activePlayer = this.playerTeam.find((p) => !p.fainted) || null;
    this.activeOpponent = this.opponentTeam.find((p) => !p.fainted) || null;
    this.round = 1;
    this.turnQueue = [];
    this.pendingCommands = []; // commands committed for this round but not yet executed
    this.phase = 'input';      // input -> resolve -> end -> input/win/lose
    this.winner = null;        // 'player' | 'opponent' | null
    this.commandId = 0;
    this.commandCallbacks = []; // optional awaiters for multi-turn flow

    this._netOff = null;
    if (this.opts.isPvp && this.opts.net) {
      this._netOff = this.opts.net.on('pb-cmd', (m) => this.receiveCommand(m));
    }
  }

  destroy() {
    if (this._netOff) this._netOff();
    this.commandCallbacks = [];
  }

  active(side) { return side === 'player' ? this.activePlayer : this.activeOpponent; }

  setActive(side, slot) {
    const team = side === 'player' ? this.playerTeam : this.opponentTeam;
    const p = team.find((x) => x.slot === slot && !x.fainted);
    if (!p) return false;
    if (side === 'player') this.activePlayer = p; else this.activeOpponent = p;
    return true;
  }

  // ── commands ───────────────────────────────────────────────────────────────

  // Queue a player command. In PvP we immediately send it to the server and
  // wait for the server to broadcast both commands before resolving.
  queueCommand(cmd) {
    if (this.phase !== 'input' || this.winner) return false;
    const full = {
      cid: ++this.commandId,
      sourceSide: 'player',
      sourceSlot: this.activePlayer?.slot ?? 0,
      ...cmd,
      seed: 0,
    };
    if (this.opts.isPvp && this.opts.net) {
      this.opts.net.send('pb-cmd', full);
      return true;
    }
    // Local PvE: queue and auto-resolve if opponent has queued.
    this.pendingCommands.push(full);
    this._queueOpponentTurn();
    this.resolveRound();
    return true;
  }

  receiveCommand(cmd) {
    if (!cmd || this.winner) return;
    this.pendingCommands.push(cmd);
    // In PvP the server sends one command per side each round.
    if (this.pendingCommands.length >= 2) this.resolveRound();
  }

  // Simple AI for wild battles. Picks a damaging move at random.
  _queueOpponentTurn() {
    if (this.opts.isPvp) return;
    const opp = this.activeOpponent;
    const moves = opp?.moves
      .map((id) => MOVES[id])
      .filter((m) => m && m.power > 0)
      || [];
    const move = moves.length ? moves[Math.floor(Math.random() * moves.length)] : MOVES.tackle;
    this.pendingCommands.push({
      cid: ++this.commandId,
      sourceSide: 'opponent',
      sourceSlot: opp.slot,
      action: 'move',
      moveId: move.id,
      targetSide: 'player',
      targetSlot: this.activePlayer.slot,
      seed: 0,
    });
  }

  // ── round resolution ───────────────────────────────────────────────────────

  resolveRound() {
    if (this.phase === 'resolve' || this.winner) return;
    this.phase = 'resolve';

    // Build a deterministic turn order by speed (then side tie-breaker for predictability).
    const order = this.pendingCommands
      .map((c) => {
        const pet = this._findPet(c.sourceSide, c.sourceSlot);
        const speed = pet && !pet.fainted ? this._effectiveSpeed(pet) : -Infinity;
        return { cmd: c, pet, speed };
      })
      .filter((e) => e.pet && !e.pet.fainted)
      .sort((a, b) => {
        if (b.speed !== a.speed) return b.speed - a.speed;
        return a.cmd.sourceSide === 'player' ? -1 : 1;
      });

    const events = [];
    for (const { cmd, pet } of order) {
      if (pet.fainted || this.winner) continue;
      const ev = this._executeCommand(cmd);
      if (ev) events.push(ev);
      this._checkWin();
    }

    this.pendingCommands = [];
    this.round += 1;

    // Decay buffs/debuffs.
    for (const p of this.all) {
      for (const k of Object.keys(p.buffs || {})) {
        const b = p.buffs[k];
        b.turns -= 1;
        if (b.turns <= 0) {
          delete p.buffs[k];
          events.push({ type: 'buffFade', side: p.side, slot: p.slot, stat: k });
        }
      }
    }

    this._checkWin();
    if (this.winner) {
      if (this.winner === 'player') {
        const rewards = this._computeRewards();
        events.push({ type: 'win', winner: 'player', rewards });
        if (this.opts.onReward) this.opts.onReward(rewards);
        bus.emit(Events.TOAST, { title: 'Victory!', text: `Your pets won the battle.`, color: '#7dff9a' });
      } else {
        events.push({ type: 'lose', winner: 'opponent' });
        bus.emit(Events.TOAST, { title: 'Defeat…', text: `Your active pet fainted.`, color: '#ff7a6a' });
      }
    }

    this.phase = this.winner ? 'end' : 'input';
    this._emitEvents(events);
    for (const cb of this.commandCallbacks) cb(events);
    this.commandCallbacks = [];
  }

  // ── command execution ──────────────────────────────────────────────────────

  _executeCommand(cmd) {
    const pet = this._findPet(cmd.sourceSide, cmd.sourceSlot);
    if (!pet || pet.fainted) return null;

    if (cmd.action === 'switch') {
      const ok = this.setActive(cmd.sourceSide, cmd.switchId);
      if (!ok) return null;
      const target = this.active(cmd.sourceSide);
      return { type: 'switch', side: cmd.sourceSide, fromSlot: cmd.sourceSlot, slot: target.slot, name: target.name };
    }

    if (cmd.action === 'flee') {
      const fled = this.rng() < (this.opts.isPvp ? 0.0 : 0.5);
      if (fled) {
        this.winner = 'fled';
        return { type: 'flee', side: 'player', success: true };
      }
      return { type: 'flee', side: 'player', success: false };
    }

    if (cmd.action === 'item') {
      // v1: item heals 25% max HP. Future: map itemId to effect table.
      const target = this._findPet(cmd.targetSide || cmd.sourceSide, cmd.targetSlot ?? cmd.sourceSlot);
      if (!target || target.fainted) return null;
      const before = target.hp;
      const heal = Math.round(target.stats.hp * 0.25);
      target.hp = Math.min(target.stats.hp, target.hp + heal);
      return { type: 'item', side: target.side, slot: target.slot, itemId: cmd.itemId || 'potion', amount: target.hp - before };
    }

    if (cmd.action === 'move') {
      const move = MOVES[cmd.moveId];
      if (!move) return null;
      const target = this._findPet(cmd.targetSide, cmd.targetSlot);
      if (!target || target.fainted) {
        // Redirect to a still-standing foe.
        const otherSide = cmd.targetSide === 'player' ? 'opponent' : 'player';
        const alt = this._firstAlive(otherSide);
        if (!alt) return null;
        cmd.targetSide = alt.side;
        cmd.targetSlot = alt.slot;
      }
      return this._executeMove(pet, move, this._findPet(cmd.targetSide, cmd.targetSlot));
    }

    return null;
  }

  _executeMove(attacker, move, defender) {
    // Accuracy roll.
    if (this.rng() > move.accuracy) {
      return { type: 'miss', side: attacker.side, slot: attacker.slot, targetSide: defender.side, targetSlot: defender.slot, moveId: move.id };
    }

    // Status moves: heal/buff/debuff.
    if (move.category === 'status') {
      return this._applyStatusMove(attacker, move);
    }

    // Damage moves.
    const atkStat = move.category === 'special' ? attacker.stats.atk : attacker.stats.atk;
    const defStat = defender.stats.def;
    const stab = attacker.stats.type === move.type ? 1.25 : 1.0;
    const typeMul = typeMultiplier(move.type, defender.stats.type || defender.type || 'nature');
    const crit = this.rng() < CRIT_CHANCE ? CRIT_MUL : 1.0;
    const random = RANDOM_MIN + this.rng() * (RANDOM_MAX - RANDOM_MIN);
    const power = move.power || 0;
    const levelMul = 0.4 + attacker.level / 50;

    const raw = ((2 * attacker.level / 5 + 2) * power * (atkStat / Math.max(1, defStat)) / 50 + 2) * levelMul;
    const damage = Math.max(1, Math.floor(raw * stab * typeMul * crit * random));

    const before = defender.hp;
    defender.hp = Math.max(0, defender.hp - damage);
    const actual = before - defender.hp;
    if (defender.hp <= 0) defender.fainted = true;

    // Apply secondary effect if present.
    let effectEvent = null;
    if (move.effect) {
      effectEvent = this._applyMoveEffect(attacker, defender, move.effect);
    }

    const event = {
      type: 'move',
      side: attacker.side,
      slot: attacker.slot,
      targetSide: defender.side,
      targetSlot: defender.slot,
      moveId: move.id,
      damage: actual,
      crit: crit > 1,
      effectiveness: typeMul,
      fainted: defender.fainted,
    };
    if (effectEvent) event.effect = effectEvent;
    return event;
  }

  _applyStatusMove(attacker, move) {
    if (!move.effect) return null;
    // Heal/buff on self, debuff on active opponent.
    if (move.effect.self === 'heal') {
      const before = attacker.hp;
      const amt = Math.round(attacker.stats.hp * (move.effect.pct || 0.25));
      attacker.hp = Math.min(attacker.stats.hp, attacker.hp + amt);
      return { type: 'heal', side: attacker.side, slot: attacker.slot, moveId: move.id, amount: attacker.hp - before };
    }
    if (move.effect.self === 'buff') {
      this._applyBuff(attacker, move.effect.stat, move.effect.amt, move.effect.turns || 3);
      return { type: 'buff', side: attacker.side, slot: attacker.slot, moveId: move.id, stat: move.effect.stat, amt: move.effect.amt };
    }
    if (move.effect.foe === 'debuff') {
      const target = this.active(attacker.side === 'player' ? 'opponent' : 'player');
      if (!target || target.fainted) return null;
      this._applyBuff(target, move.effect.stat, move.effect.amt, move.effect.turns || 3);
      return { type: 'debuff', side: target.side, slot: target.slot, moveId: move.id, stat: move.effect.stat, amt: move.effect.amt };
    }
    return null;
  }

  _applyMoveEffect(attacker, defender, effect) {
    if (effect.self === 'buff') {
      this._applyBuff(attacker, effect.stat, effect.amt, effect.turns || 3);
      return { type: 'buff', side: attacker.side, slot: attacker.slot, stat: effect.stat, amt: effect.amt };
    }
    if (effect.foe === 'debuff') {
      this._applyBuff(defender, effect.stat, effect.amt, effect.turns || 3);
      return { type: 'debuff', side: defender.side, slot: defender.slot, stat: effect.stat, amt: effect.amt };
    }
    return null;
  }

  _applyBuff(pet, stat, amt, turns) {
    if (!pet.buffs) pet.buffs = {};
    pet.buffs[stat] = { amt, turns };
  }

  _effectiveSpeed(pet) {
    let s = pet.stats.spd;
    if (pet.buffs?.spd) s *= pet.buffs.spd.amt;
    return Math.max(1, Math.round(s));
  }

  effectiveStat(pet, stat) {
    let v = pet.stats[stat];
    if (pet.buffs?.[stat]) v *= pet.buffs[stat].amt;
    return Math.max(1, Math.round(v));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  _findPet(side, slot) {
    return this.all.find((p) => p.side === side && p.slot === slot) || null;
  }

  _firstAlive(side) {
    return (side === 'player' ? this.playerTeam : this.opponentTeam).find((p) => !p.fainted) || null;
  }

  _checkWin() {
    if (this.winner && this.winner !== 'fled') return;
    const playerAlive = this.playerTeam.some((p) => !p.fainted);
    const oppAlive = this.opponentTeam.some((p) => !p.fainted);
    if (!playerAlive) this.winner = 'opponent';
    else if (!oppAlive) this.winner = 'player';
  }

  _computeRewards() {
    const oppLv = Math.max(1, this.opponentTeam.reduce((a, p) => a + (p.level || 1), 0) / Math.max(1, this.opponentTeam.length));
    const survivors = this.playerTeam.filter((p) => !p.fainted);
    const xpMap = {};
    for (const p of survivors) {
      const lvDiff = oppLv - p.level;
      const xp = Math.round((XP_BASE + XP_SCALE * oppLv) * Math.max(0.4, 1 + 0.1 * lvDiff) * (this.opts.rewardScale || 1));
      xpMap[p.slot] = { slot: p.slot, id: p.id, level: p.level, xp };
    }
    return { xpMap };
  }

  _emitEvents(events) {
    for (const ev of events) {
      try { this.opts.onEvent?.(ev); } catch (e) { console.error(e); }
      if (ev.type === 'win' || ev.type === 'lose' || ev.type === 'flee') break;
    }
  }

  // Public helpers used by UI and external systems.

  alive(side) {
    return (side === 'player' ? this.playerTeam : this.opponentTeam).filter((p) => !p.fainted);
  }

  // Add XP to a player pet after PvE win; returns { leveled, newLevel } if it leveled.
  addXp(slot, amount) {
    const pet = this.playerTeam.find((p) => p.slot === slot);
    if (!pet || pet.fainted) return { leveled: false };
    pet.xp = (pet.xp || 0) + amount;
    const oldLevel = pet.level;
    const nextXp = (lvl) => Math.round(40 + lvl * lvl * 1.2);
    let leveled = false;
    while (pet.xp >= nextXp(pet.level)) {
      pet.xp -= nextXp(pet.level);
      pet.level += 1;
      leveled = true;
    }
    if (leveled) {
      pet.stats = statsAt(pet.id, pet.level);
      pet.hp = pet.stats.hp; // full heal on level up for PvE QoL
    }
    return { leveled, oldLevel, newLevel: pet.level, xp: pet.xp, xpNext: nextXp(pet.level) };
  }

  // Snapshot that can be sent to the server for PvP validation or save games.
  stateSnapshot() {
    return {
      round: this.round,
      phase: this.phase,
      winner: this.winner,
      playerTeam: this.playerTeam.map((p) => this._petSnapshot(p)),
      opponentTeam: this.opponentTeam.map((p) => this._petSnapshot(p)),
    };
  }

  _petSnapshot(p) {
    return {
      side: p.side,
      slot: p.slot,
      id: p.id,
      name: p.name,
      level: p.level,
      xp: p.xp,
      hp: p.hp,
      stats: p.stats,
      moves: p.moves,
      buffs: p.buffs,
      fainted: p.fainted,
    };
  }
}
