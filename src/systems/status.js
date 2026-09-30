import { STATUS } from '../data/combatMath.js';

// Timed status effects (poison / burn / bleed / slow / stun) for the hero and
// for enemies. Pure bookkeeping — the owner decides what a tick does.
export class StatusSet {
  constructor() { this.map = new Map(); }

  // Returns true if the status is new (not just refreshed).
  apply(id, now, { secs, dmg = 0 } = {}) {
    const def = STATUS[id];
    if (!def) return false;
    const dur = (secs ?? def.secs) * 1000;
    const cur = this.map.get(id);
    if (cur && now < cur.until) {
      cur.until = Math.max(cur.until, now + dur);
      cur.dur = Math.max(cur.dur, cur.until - now);
      cur.dmg = Math.max(cur.dmg, dmg);
      return false;
    }
    this.map.set(id, { id, until: now + dur, dur, next: now + (def.tick || 0), dmg });
    return true;
  }

  has(id, now) { const s = this.map.get(id); return !!s && now < s.until; }
  get size() { return this.map.size; }

  // Expires finished effects and calls onDot(id, dmg) for every DoT tick due.
  tick(now, onDot) {
    for (const [id, s] of this.map) {
      if (now >= s.until) { this.map.delete(id); continue; }
      const def = STATUS[id];
      if (def.tick && now >= s.next) { s.next += def.tick; if (s.dmg > 0) onDot(id, s.dmg); }
    }
  }

  // [{id, left (ms), frac (0..1 remaining)}]
  list(now) {
    const out = [];
    for (const s of this.map.values()) if (now < s.until) out.push({ id: s.id, left: s.until - now, frac: (s.until - now) / s.dur });
    return out;
  }

  clear() { this.map.clear(); }
}
