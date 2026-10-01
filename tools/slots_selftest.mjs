#!/usr/bin/env node
// Slot migration + backup round-trip (no Phaser). Old single-save keys become slot 1.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
};
globalThis.window = globalThis;

const fail = (m) => { console.error(`FAIL ${m}`); process.exitCode = 1; };
const ok = (m) => console.log(`ok  ${m}`);

store.set('wayfarer.profile.v1', JSON.stringify({ name: 'Mossy Pip' }));
store.set('wayfarer.hero.v1', JSON.stringify({ name: 'Mossy Pip', job: 'ranger', body: 'mangreen' }));
store.set('wayfarer.progress.v1.mossy pip', JSON.stringify({
  level: 7, job: 'ranger', gold: 42, x: 800, y: 800, savedAt: 1_700_000_000_000,
}));

const slots = await import('../src/core/slots.js');
const listed = slots.listSlots();
if (listed.length !== 3) fail(`expected 3 slot rows, got ${listed.length}`);
const s1 = listed.find((s) => s.id === 1);
if (!s1 || s1.empty) fail('legacy save did not migrate into slot 1');
if (s1.name !== 'Mossy Pip') fail(`slot 1 name ${s1.name}`);
if (s1.level !== 7) fail(`slot 1 level ${s1.level}`);
if (s1.job !== 'ranger') fail(`slot 1 job ${s1.job}`);
if (!s1.active) fail('slot 1 should be active after migrate');
if (listed.filter((s) => !s.empty).length !== 1) fail('only slot 1 should be filled');
ok('legacy single save migrated into slot 1');

const code = slots.exportBackup();
if (!code.startsWith('WAYFARER1.')) fail('backup prefix');
slots.deleteSlot(1);
if (!slots.listSlots().every((s) => s.empty)) fail('deleteSlot left a hero');
const restored = slots.importBackup(code);
if (!restored.ok || restored.count !== 1) fail(`importBackup ${JSON.stringify(restored)}`);
const again = slots.listSlots().find((s) => s.id === 1);
if (!again || again.empty || again.name !== 'Mossy Pip' || again.level !== 7) fail('backup did not restore progress');
ok('backup export/import round-trip');

const renamed = slots.renameSlot(1, 'Brave Wren');
if (!renamed.ok) fail(renamed.error);
const after = slots.listSlots().find((s) => s.id === 1);
if (after.name !== 'Brave Wren') fail(`rename -> ${after.name}`);
if (!globalThis.localStorage.getItem('wayfarer.progress.v1.brave wren')) fail('progress key did not follow rename');
ok('rename moves progress key');

if (!/^WF-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(slots.profileId())) fail(`profileId ${slots.profileId()}`);
ok(`profile id ${slots.profileId()}`);

if (process.exitCode) {
  console.error('slots_selftest: FAILED');
  process.exit(1);
}
console.log('slots_selftest: all passed');
