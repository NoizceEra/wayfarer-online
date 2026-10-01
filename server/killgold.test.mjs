// server/killgold.test.mjs - run: node server/killgold.test.mjs
//
// Proves the owner's rule directly against the real clamp: gold is earned PER KILL, in
// per-enemy-type amounts, and idling earns exactly nothing. Hermetic - it calls
// validateSave itself, so it needs no relay and no browser.
//
// The interesting cases are not "does it clamp" but "does it clamp the right things":
// a rule that credits nobody, or that clamps an honest boss kill down to trash value, is
// just as broken as one that pays a forger. Cases 2 and 3 are the two halves of that.
import assert from 'node:assert/strict';
import { validateSave, sanitizeProgress, CAPS } from './validate.js';

const NOW = 1_700_000_000_000;
const T0 = NOW - 60_000; // a previous save one minute ago

// prev = the stored character; raw = what the client is now trying to upload.
function attempt(raw, prevProgress, dtMs = 60_000) {
  const prev = prevProgress ? { progress: prevProgress, savedAt: NOW - dtMs } : undefined;
  const p = sanitizeProgress(raw);
  const { rec, clamped } = validateSave(prev, p, NOW); // (prevRecord, progress, now)
  return { gold: rec.gold, kills: rec.kills, clamped };
}
const prog = (o) => Object.assign({ job: 'wayfarer', level: 2, xp: 0, xpNext: 100, gold: 1000, kills: {} }, o);

let n = 0;
const t = (name, fn) => { try { fn(); n++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + ' :: ' + e.message); process.exitCode = 1; } };

t('IDLE: no new kills means no new gold, however long you wait', () => {
  // Same kill map, an absurd gold figure, one minute of wall time.
  const r = attempt(prog({ gold: 999_999, kills: { dewslime: 10 } }), prog({ kills: { dewslime: 10 } }));
  assert.equal(r.gold, 1000, 'idle client minted ' + (r.gold - 1000) + ' gold');
  assert.ok(r.clamped.some((c) => c.includes('no kills credited')), 'no explanation logged: ' + JSON.stringify(r.clamped));
});

t('IDLE: time alone is worth nothing (the old goldPerSec is gone)', () => {
  // The farm this replaced: sit connected, save on a loop, watch gold climb.
  let prev = prog({ gold: 0, kills: { dewslime: 5 } });
  let last = 0;
  for (let i = 0; i < 8; i++) { last = attempt(prog({ gold: last + 5000, kills: { dewslime: 5 } }), prev).gold; prev = prog({ gold: last, kills: { dewslime: 5 } }); }
  assert.equal(last, 0, 'gold accrued while idle: ' + last);
});

t('HONEST: a real mix earns real gold, and a boss kill is worth boss gold', () => {
  // 5 dewslime (max 4 each) + 1 worldtitan (max 650) = 670, both within plausibility.
  const r = attempt(prog({ gold: 1670, kills: { dewslime: 15, worldtitan: 1 } }), prog({ kills: { dewslime: 10 } }));
  assert.equal(r.gold, 1670, 'honest play was clamped: ' + JSON.stringify(r.clamped));
});

t('HONEST: an ordinary kill still earns (a rule that pays nobody is a failure too)', () => {
  const r = attempt(prog({ gold: 1020, kills: { dewslime: 15 } }), prog({ kills: { dewslime: 10 } }));
  assert.equal(r.gold, 1020, '5 ordinary kills credited nothing: ' + JSON.stringify(r.clamped));
});

t('BOSS HYPERCLAIM: 20 boss kills credit one, not twenty', () => {
  // Bosses are timer-gated (BOSS_SLOT_MS = 10 min), so 20 between saves is not plausible.
  const r = attempt(prog({ gold: 1000 + 20 * 650, kills: { worldtitan: 20 } }), prog({ kills: {} }));
  assert.equal(r.gold, 1650, 'credited ' + (r.gold - 1000) + ' for 20 boss claims (one is worth 650)');
  assert.ok(r.clamped.some((c) => c.includes('worldtitan')), 'the over-cap type is not named: ' + JSON.stringify(r.clamped));
});

t('TRASH HYPERCLAIM cannot mint boss money', () => {
  const r = attempt(prog({ gold: 1000 + 500 * 18, kills: { dewslime: 500 } }), prog({ kills: {} }));
  assert.ok(r.gold <= 1000 + 68 * 4, 'trash claim paid ' + (r.gold - 1000) + ' (cap is 8 + 60s)');
});

t('REWIND: reporting fewer kills banks nothing', () => {
  const r = attempt(prog({ gold: 1000 + 650, kills: { dewslime: 10 } }), prog({ kills: { dewslime: 50 } }));
  assert.equal(r.gold, 1000, 'a rewound counter still earned: ' + (r.gold - 1000));
});

t('FORGED: an unknown enemy id credits nothing', () => {
  const r = attempt(prog({ gold: 1000 + 999_999, kills: { not_a_real_enemy: 999 } }), prog({ kills: {} }));
  assert.equal(r.gold, 1000, 'an unknown id minted ' + (r.gold - 1000));
  assert.deepEqual(Object.keys(r.kills), [], 'unknown id survived sanitising');
});

t('FIRST SAVE: a brand-new character starts with nothing to claim', () => {
  const r = attempt(prog({ gold: 9_999_999, kills: {} }), undefined);
  assert.equal(r.gold, 0, 'first save minted ' + r.gold);
});

t('NO ACCRUAL FIELD: nothing in CAPS grows gold with time', () => {
  const keys = Object.keys(CAPS).map((k) => k.toLowerCase());
  assert.ok(!keys.some((k) => /goldpersec|goldperhour|goldrate|goldbase/.test(k)), 'a time-based gold cap is back: ' + keys.join(','));
});

console.log(n + ' passed');
