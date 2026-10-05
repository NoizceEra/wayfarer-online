// Specialization trees: pre-class-change progression (levels 2-9).
// Pure data + pure helpers, no Phaser. Engine wiring (UI, prog.trees,
// combat integration) is owned by the engine track — see docs/SKILL_TREES.md.
//
// Design:
// - 3 paths per base job: might (attack), ward (defense), spirit (support).
// - Each path is a LINEAR 4-node track. Node N requires character level
//   [2, 4, 6, 8][N-1] and the previous node in the same path. Cost: 1 skill
//   point per node (same pool as upgradeSkill, SKILL_POINTS_PER_LEVEL = 1).
// - Node effects reference ONLY real things:
//   a) { kind: 'skill', skillId, levels } — +levels effective skill level to a
//      named skill id from jobs.js (JOBS[job].abilities). Caps at SKILL_MAX
//      (stats.js) — see docs/SKILL_TREES.md "Cap behavior".
//   b) { kind: 'stat', key, value } — flat bonus where key is one of:
//      - str/agi/vit/int/dex/luk → added into the `bonus` arg of
//        totalStats() (same slot gear bonuses use; ModularPlayer passes
//        equipBonuses() there today — the engine adds tree flats alongside).
//      - hpMul/mpMul/crit/aspd/move → additive deltas onto the ADVANCED-class
//        modifier slots read by computeDerived() (adv.hpMul, adv.mpMul,
//        adv.crit, adv.aspd, adv.move). Base is 1 for the muls, 0 for the rest.
//      No other keys exist. In particular there is NO atk/atkMul/matk/def key
//      on the adv/derived contract — do not invent one (atkMul exists only as
//      a transient combat buff in ModularPlayer.buff, not as a persistent mod).
//
// Advanced-class gating: each adv class in ADVANCED requires minimum
// path investment (see ADV_TREE_GATES). Checked by the engine inside
// chooseClass() alongside the level-10 / base-job checks.

import { SKILL_MAX } from './stats.js';

export const TREE_PATHS = ['might', 'ward', 'spirit'];
export const TREE_PATH_NAMES = { might: 'Might', ward: 'Ward', spirit: 'Spirit' };
// Node index 1..4 → minimum character level.
export const TREE_LEVEL_GATES = [2, 4, 6, 8];
export const TREE_NODE_COST = 1;

// Keys a { kind: 'stat' } node may use. FLAT keys feed totalStats `bonus`;
// DERIVED keys are additive deltas onto the computeDerived adv slots.
export const TREE_FLAT_STAT_KEYS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];
export const TREE_DERIVED_KEYS = ['hpMul', 'mpMul', 'crit', 'aspd', 'move'];

const sk = (skillId) => ({ kind: 'skill', skillId, levels: 1 });
const st = (key, value) => ({ kind: 'stat', key, value });
const N = (job, path, index, name, desc, effect) => ({
  id: `${job}.${path}.${index}`,
  job, path, index, name, desc,
  reqLevel: TREE_LEVEL_GATES[index - 1],
  cost: TREE_NODE_COST,
  effect,
});

// ── Wayfarer (slash/flare/dash/camp) ─────────────────────────────────────────
// might: blade + radiance offence · ward: endurance + mobility ·
// spirit: campcraft + sustain
const wayfarer = {
  might: [
    N('wayfarer', 'might', 1, 'Trail Edge', '+1 effective level to Trail Slash.', sk('slash')),
    N('wayfarer', 'might', 2, 'Wayfarer Strength', '+2 STR (flat, feeds totalStats bonus).', st('str', 2)),
    N('wayfarer', 'might', 3, 'Kindled Light', '+1 effective level to Waylight.', sk('flare')),
    N('wayfarer', 'might', 4, 'Keen Eye', '+2 crit (additive onto the computeDerived crit slot).', st('crit', 2)),
  ],
  ward: [
    N('wayfarer', 'ward', 1, 'Road Hearth', '+2 VIT (flat, feeds totalStats bonus).', st('vit', 2)),
    N('wayfarer', 'ward', 2, 'Dust Runner', '+1 effective level to Dust Dash.', sk('dash')),
    N('wayfarer', 'ward', 3, 'Iron Tread', '+0.05 max-HP multiplier (additive delta onto hpMul).', st('hpMul', 0.05)),
    N('wayfarer', 'ward', 4, 'Lantern Oath', '+3 VIT (flat, feeds totalStats bonus).', st('vit', 3)),
  ],
  spirit: [
    N('wayfarer', 'spirit', 1, 'Camp Lore', '+1 effective level to Make Camp.', sk('camp')),
    N('wayfarer', 'spirit', 2, 'Wander Insight', '+2 INT (flat, feeds totalStats bonus).', st('int', 2)),
    N('wayfarer', 'spirit', 3, 'Deep Reserves', '+0.10 max-MP multiplier (additive delta onto mpMul).', st('mpMul', 0.1)),
    N('wayfarer', 'spirit', 4, 'Hearthkeeper', '+1 effective level to Make Camp (stacks with Camp Lore; still capped at SKILL_MAX).', sk('camp')),
  ],
};

// ── Ranger (shot/volley/dash/snare) ──────────────────────────────────────────
// might: archery offence · ward: skirmisher survival · spirit: trapper's cunning
const ranger = {
  might: [
    N('ranger', 'might', 1, 'True Aim', '+1 effective level to Thorn Shot.', sk('shot')),
    N('ranger', 'might', 2, 'Bow Arm', '+2 DEX (flat, feeds totalStats bonus).', st('dex', 2)),
    N('ranger', 'might', 3, 'Canopy Volley', '+1 effective level to Leaf Volley.', sk('volley')),
    N('ranger', 'might', 4, 'Hunter Eye', '+2 crit (additive onto the computeDerived crit slot).', st('crit', 2)),
  ],
  ward: [
    N('ranger', 'ward', 1, 'Trail Toughness', '+2 VIT (flat, feeds totalStats bonus).', st('vit', 2)),
    N('ranger', 'ward', 2, 'Dust Runner', '+1 effective level to Dust Dash.', sk('dash')),
    N('ranger', 'ward', 3, 'Swiftstep', '+0.03 move (additive onto the computeDerived move slot).', st('move', 0.03)),
    N('ranger', 'ward', 4, 'Wind Guide', '+3 AGI (flat, feeds totalStats bonus).', st('agi', 3)),
  ],
  spirit: [
    N('ranger', 'spirit', 1, 'Snare Craft', '+1 effective level to Snare Trap.', sk('snare')),
    N('ranger', 'spirit', 2, 'Fortune of the Glade', '+2 LUK (flat, feeds totalStats bonus).', st('luk', 2)),
    N('ranger', 'spirit', 3, 'Deep Breath', '+0.10 max-MP multiplier (additive delta onto mpMul).', st('mpMul', 0.1)),
    N('ranger', 'spirit', 4, 'Master Trapper', '+1 effective level to Snare Trap (stacks with Snare Craft; still capped at SKILL_MAX).', sk('snare')),
  ],
};

// ── Arcanist (bolt/burst/blink/ward) ────────────────────────────────────────
// might: destructive casting · ward: wards + repositioning ·
// spirit: mana depth (shares blink/burst across ward/spirit — bonuses stack,
// still capped at SKILL_MAX; see docs/SKILL_TREES.md)
const arcanist = {
  might: [
    N('arcanist', 'might', 1, 'Ember Focus', '+1 effective level to Ember Bolt.', sk('bolt')),
    N('arcanist', 'might', 2, 'Arcane Mind', '+2 INT (flat, feeds totalStats bonus).', st('int', 2)),
    N('arcanist', 'might', 3, 'Bloom Caller', '+1 effective level to Moss Burst.', sk('burst')),
    N('arcanist', 'might', 4, 'Critical Mass', '+2 crit (additive onto the computeDerived crit slot).', st('crit', 2)),
  ],
  ward: [
    N('arcanist', 'ward', 1, 'Tide Discipline', '+1 effective level to Tide Ward.', sk('ward')),
    N('arcanist', 'ward', 2, 'Sturdy Frame', '+2 VIT (flat, feeds totalStats bonus).', st('vit', 2)),
    N('arcanist', 'ward', 3, 'Wisp Step', '+1 effective level to Wisp Blink.', sk('blink')),
    N('arcanist', 'ward', 4, 'Mana Bulwark', '+0.05 max-HP multiplier (additive delta onto hpMul).', st('hpMul', 0.05)),
  ],
  spirit: [
    N('arcanist', 'spirit', 1, 'Flicker Soul', '+1 effective level to Wisp Blink (stacks with Wisp Step if both paths taken; still capped at SKILL_MAX).', sk('blink')),
    N('arcanist', 'spirit', 2, 'Deep Well', '+0.10 max-MP multiplier (additive delta onto mpMul).', st('mpMul', 0.1)),
    N('arcanist', 'spirit', 3, 'Wild Bloom', '+1 effective level to Moss Burst (stacks with Bloom Caller if both paths taken; still capped at SKILL_MAX).', sk('burst')),
    N('arcanist', 'spirit', 4, 'Sage Intellect', '+3 INT (flat, feeds totalStats bonus).', st('int', 3)),
  ],
};

// ── Bandit (stab/fan/dash/smoke) ────────────────────────────────────────────
// might: fang offence · ward: elusive survival · spirit: lucky tricks
const bandit = {
  might: [
    N('bandit', 'might', 1, 'First Fang', '+1 effective level to Fang Stab.', sk('stab')),
    N('bandit', 'might', 2, 'Cutthroat Strength', '+2 STR (flat, feeds totalStats bonus).', st('str', 2)),
    N('bandit', 'might', 3, 'Crow Murder', '+1 effective level to Crow Fan.', sk('fan')),
    N('bandit', 'might', 4, 'Killer Instinct', '+2 crit (additive onto the computeDerived crit slot).', st('crit', 2)),
  ],
  ward: [
    N('bandit', 'ward', 1, 'Slip Away', '+1 effective level to Dust Dash.', sk('dash')),
    N('bandit', 'ward', 2, 'Cat Grace', '+2 AGI (flat, feeds totalStats bonus).', st('agi', 2)),
    N('bandit', 'ward', 3, 'Second Skin', '+0.05 max-HP multiplier (additive delta onto hpMul).', st('hpMul', 0.05)),
    N('bandit', 'ward', 4, 'Alley Vitality', '+3 VIT (flat, feeds totalStats bonus).', st('vit', 3)),
  ],
  spirit: [
    N('bandit', 'spirit', 1, 'Smokescreen', '+1 effective level to Smoke Pouch.', sk('smoke')),
    N('bandit', 'spirit', 2, 'Gutter Luck', '+2 LUK (flat, feeds totalStats bonus).', st('luk', 2)),
    N('bandit', 'spirit', 3, 'Quick Hands', '+0.05 attack speed (additive onto the computeDerived aspd slot).', st('aspd', 0.05)),
    N('bandit', 'spirit', 4, 'Vanisher', '+1 effective level to Smoke Pouch (stacks with Smokescreen; still capped at SKILL_MAX).', sk('smoke')),
  ],
};

export const SKILL_TREES = { wayfarer, ranger, arcanist, bandit };

// ── Advanced-class path gates ────────────────────────────────────────────────
// Minimum owned-node counts per path (engine checks these in chooseClass()).
// Bruisers want Might 3+; keepers/casters want Spirit 3+; hybrids split Ward.
export const ADV_TREE_GATES = {
  knight:         { might: 3 },                 // sword-and-board bruiser
  lanternwarden:  { spirit: 3 },                // keeper of the healing light
  hunter:         { might: 3 },                 // deadly marksman
  wildwarden:     { ward: 2, spirit: 2 },       // nature skirmisher: hardy + attuned
  elementalist:   { might: 3 },                 // raw destructive magic
  tidecaller:     { spirit: 3 },                // water magic: control + restoration
  shadowblade:    { might: 3 },                 // assassin
  trickster:      { ward: 2, spirit: 2 },       // lucky rogue: slippery + cunning
};

// ── Prog shape ───────────────────────────────────────────────────────────────
// prog.trees = { paths: { might: n, ward: n, spirit: n }, nodes: [nodeId, ...] }
// `paths` is a cached count per path (derived from `nodes`, kept in sync by
// the engine on purchase / sanitize). `nodes` holds purchased node ids.
export function emptyTrees() {
  return { paths: { might: 0, ward: 0, spirit: 0 }, nodes: [] };
}

// ── Pure helpers (engine track may import these) ────────────────────────────

export function treeNodeById(id) {
  if (typeof id !== 'string') return null;
  const [job, path, idx] = id.split('.');
  const track = SKILL_TREES[job]?.[path];
  const node = track?.[Number(idx) - 1] || null;
  return node && node.id === id ? node : null;
}

export function nodesForJob(jobId) {
  const t = SKILL_TREES[jobId];
  return t ? [...t.might, ...t.ward, ...t.spirit] : [];
}

// Owned-node path counts for a job (ignores nodes from other jobs).
export function pathCounts(jobId, ownedNodeIds) {
  const out = { might: 0, ward: 0, spirit: 0 };
  for (const id of ownedNodeIds || []) {
    const n = treeNodeById(id);
    if (n && n.job === jobId) out[n.path] += 1;
  }
  return out;
}

// Total +effective-levels to `skillId` from owned tree nodes.
export function treeSkillBonus(jobId, ownedNodeIds, skillId) {
  let total = 0;
  for (const id of ownedNodeIds || []) {
    const n = treeNodeById(id);
    if (n && n.job === jobId && n.effect.kind === 'skill' && n.effect.skillId === skillId) {
      total += n.effect.levels;
    }
  }
  return total;
}

// Effective skill level incl. tree bonus, clamped to SKILL_MAX.
// `baseLv` is whatever skillLv()/upgradeSkill() resolved (base 1 for base
// abilities, 0 for unlearned advanced, else purchased 0..SKILL_MAX).
export function effSkillLvWithTrees(baseLv, treeBonus) {
  return Math.min(SKILL_MAX, Math.max(0, baseLv || 0) + Math.max(0, treeBonus || 0));
}

// Aggregate owned stat nodes: { flat: {str..}, hpMul, mpMul, crit, aspd, move }.
// flat feeds totalStats `bonus`; the rest are additive deltas onto the
// computeDerived adv slots (muls stack on base 1, others on base 0).
export function treeStatBonus(jobId, ownedNodeIds) {
  const out = { flat: {}, hpMul: 0, mpMul: 0, crit: 0, aspd: 0, move: 0 };
  for (const id of ownedNodeIds || []) {
    const n = treeNodeById(id);
    if (!n || n.job !== jobId || n.effect.kind !== 'stat') continue;
    const { key, value } = n.effect;
    if (TREE_FLAT_STAT_KEYS.includes(key)) out.flat[key] = (out.flat[key] || 0) + value;
    else if (TREE_DERIVED_KEYS.includes(key)) out[key] += value;
  }
  return out;
}

// Purchase validation. Returns { ok: true } or { ok: false, reason }.
// reasons: 'unknown-node' | 'wrong-job' | 'already-owned' | 'prereq-order' |
//          'level-gated' | 'no-skill-point'
export function canBuyTreeNode({ jobId, level, skillPoints, ownedNodeIds }, nodeId) {
  const node = treeNodeById(nodeId);
  if (!node) return { ok: false, reason: 'unknown-node' };
  if (node.job !== jobId) return { ok: false, reason: 'wrong-job' };
  const owned = new Set(ownedNodeIds || []);
  if (owned.has(nodeId)) return { ok: false, reason: 'already-owned' };
  if (node.index > 1 && !owned.has(`${node.job}.${node.path}.${node.index - 1}`)) {
    return { ok: false, reason: 'prereq-order' };
  }
  if ((level || 1) < node.reqLevel) return { ok: false, reason: 'level-gated' };
  if ((skillPoints || 0) < node.cost) return { ok: false, reason: 'no-skill-point' };
  return { ok: true };
}

// Do owned-node counts satisfy the adv-class gate? Returns { ok, missing }.
export function advGateMet(advId, counts) {
  const gate = ADV_TREE_GATES[advId];
  if (!gate) return { ok: false, missing: { unknownAdv: advId } };
  const missing = {};
  for (const [path, need] of Object.entries(gate)) {
    if ((counts?.[path] || 0) < need) missing[path] = need - (counts?.[path] || 0);
  }
  return Object.keys(missing).length === 0 ? { ok: true, missing: {} } : { ok: false, missing };
}
