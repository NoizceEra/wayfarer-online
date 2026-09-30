// Light anti-cheat for uploaded character saves. Not a full authority: the
// client simulates combat, so we bound what a save can claim instead.
//  - shape/size limits on every field (junk never reaches disk)
//  - progression rate caps vs the previous server copy (level, gold)
// Returns { rec, clamped: string[] }.
const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const jsonSize = (o) => { try { return JSON.stringify(o).length; } catch { return Infinity; } };
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

export const CAPS = {
  LEVEL_MAX: 99,
  GOLD_MAX: 9_999_999,
  // a level every 20s of wall time + 1 is far above any legit pace
  levelPerSec: 1 / 20,
  // generous: quest rewards / boss / selling a bag of epics
  goldBase: 1500, goldPerSec: 60,
};

export function sanitizeProgress(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {
    job: str(p.job, 24) || 'wayfarer',
    level: int(p.level, 1, CAPS.LEVEL_MAX, 1),
    xp: int(p.xp, 0, 1e9, 0),
    xpNext: int(p.xpNext, 1, 1e9, 100),
    gold: int(p.gold, 0, CAPS.GOLD_MAX, 0),
    potions: int(p.potions, 0, 99, 0),
    maxHp: int(p.maxHp, 1, 1e6, 100), maxMp: int(p.maxMp, 0, 1e6, 30), atk: int(p.atk, 0, 1e6, 10),
    x: int(p.x, -20000, 40000, 0), y: int(p.y, -20000, 40000, 0),
    inventory: (Array.isArray(p.inventory) ? p.inventory : []).filter((s) => typeof s === 'string' && s.length <= 48).slice(0, 40),
    equipped: {}, dyes: {},
    quest: p.quest && typeof p.quest === 'object' && jsonSize(p.quest) < 24_000 ? p.quest : { idx: 0, kills: {} },
    prog: p.prog && typeof p.prog === 'object' && jsonSize(p.prog) < 12_000 ? p.prog : null,
    savedAt: int(p.savedAt, 0, 9e15, Date.now()),
  };
  if (p.equipped && typeof p.equipped === 'object') {
    for (const [k, v] of Object.entries(p.equipped).slice(0, 16)) if (typeof k === 'string' && k.length < 16 && (v === null || (typeof v === 'string' && v.length <= 48))) out.equipped[k] = v;
  }
  if (p.dyes && typeof p.dyes === 'object') {
    for (const [k, v] of Object.entries(p.dyes).slice(0, 48)) if (k.length <= 48 && typeof v === 'string' && v.length <= 24) out.dyes[k] = v;
  }
  return out;
}

export function sanitizeHero(h) {
  if (!h || typeof h !== 'object' || jsonSize(h) > 6000) return null;
  return h;
}

// prev: last accepted server record ({progress, savedAt}) or null
export function validateSave(prev, progress, now = Date.now()) {
  const clamped = [];
  const p = sanitizeProgress(progress);
  if (!p) return { rec: null, clamped: ['invalid'] };
  const pp = prev?.progress;
  if (pp) {
    const dt = Math.max(0, (now - (prev.savedAt || now)) / 1000);
    const maxLevel = pp.level + 1 + Math.floor(dt * CAPS.levelPerSec);
    if (p.level > maxLevel) { clamped.push(`level ${p.level}>${maxLevel}`); p.level = maxLevel; }
    const maxGold = pp.gold + CAPS.goldBase + Math.floor(dt * CAPS.goldPerSec);
    if (p.gold > maxGold) { clamped.push(`gold ${p.gold}>${maxGold}`); p.gold = maxGold; }
  }
  return { rec: p, clamped };
}
