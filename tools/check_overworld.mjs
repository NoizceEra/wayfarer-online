#!/usr/bin/env node
// Walk-logic for overworld roads + water (no Phaser). Bounded BFS — cannot loop forever.
import { PORTALS } from '../src/data/areas.js';
import { ROADS, RIVERS, BRIDGES } from '../src/data/worldLayout.js';
import { network, roadAt, waterAt, onBridge, waterRects, waterSD } from '../src/world/waterways.js';

const T = 16;
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const ok = (m) => console.log('OK  ', m);

const N = network();
ok(`network: ${N.roads.length} roads, ${N.rivers.length} rivers, ${N.bridges.length} bridges`);
if (N.roads.length !== ROADS.length) fail('road count mismatch');
if (N.rivers.length !== RIVERS.length) fail('river count mismatch');
if (N.bridges.length !== BRIDGES.length) fail('bridge count mismatch');

const gates = PORTALS.map((p) => ({
  id: p.id, area: p.area, label: p.label,
  x: p.tile.x * T + 8, y: p.tile.y * T + 8, tx: p.tile.x, ty: p.tile.y,
}));
for (const g of gates) {
  const r = roadAt(g.x, g.y);
  if (r.e > 14) fail(`${g.label} (${g.tx},${g.ty}) is ${r.e.toFixed(1)}px off the nearest road`);
  else ok(`gate ${g.label} on/near road id=${r.id} e=${r.e.toFixed(1)}`);
}

// 8px BFS along road tiles from Thistle Town (64,64). Cap visits so this cannot spin.
const STEP = 8, CAP = 200000;
const key = (x, y) => ((x / STEP) | 0) + ',' + ((y / STEP) | 0);
const start = { x: 64 * T, y: 64 * T };
const seen = new Set([key(start.x, start.y)]);
const q = [start];
let qi = 0, onRoad = 0;
while (qi < q.length && qi < CAP) {
  const c = q[qi++];
  if (roadAt(c.x, c.y).e < 10) onRoad++;
  for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP], [STEP, STEP], [STEP, -STEP], [-STEP, STEP], [-STEP, -STEP]]) {
    const nx = c.x + dx, ny = c.y + dy;
    if (nx < 8 || ny < 8 || nx > 2040 || ny > 2040) continue;
    const k = key(nx, ny);
    if (seen.has(k)) continue;
    if (roadAt(nx, ny).e > 10) continue;
    seen.add(k);
    q.push({ x: nx, y: ny });
  }
}
if (qi >= CAP) fail('BFS hit visit cap — generator or graph is unbounded');
ok(`road BFS visited ${seen.size} cells (queue ${q.length})`);

for (const g of gates) {
  let best = 1e9;
  for (const c of q) best = Math.min(best, Math.hypot(c.x - g.x, c.y - g.y));
  if (best > 28) fail(`${g.label} not connected to town by road (nearest road-cell ${best.toFixed(1)}px)`);
  else ok(`town → ${g.label} connected (d=${best.toFixed(1)}px)`);
}

const rects = waterRects(16);
ok(`water collision rects (16px): ${rects.length}`);
if (rects.length < 8) fail('too few water rects — rivers/bay missing?');
if (rects.length > 4000) fail(`too many water rects (${rects.length})`);

let wet = 0, dryBridge = 0, wetOnBridge = 0, samples = 0;
for (let y = 24; y < 2024; y += 16) {
  for (let x = 24; x < 2024; x += 16) {
    samples++;
    const w = waterAt(x, y);
    if (w) wet++;
    if (onBridge(x, y)) {
      dryBridge++;
      if (w) wetOnBridge++;
    }
    // collidable water: signed distance open-water and not a bridge
    if (waterSD(x, y) < -1.5 && !onBridge(x, y) && !waterAt(x, y)) fail(`waterSD wet but waterAt false at ${x},${y}`);
  }
}
if (wetOnBridge) fail(`${wetOnBridge} bridge samples marked as water`);
if (wet < 200) fail(`too little water (${wet}/${samples})`);
ok(`water samples ${wet}/${samples} wet, ${dryBridge} on bridges (0 wet)`);

// Bridges sit on rivers
for (const b of BRIDGES) {
  const sd = waterSD(b.x * T, b.y * T);
  if (sd > 8) fail(`bridge ${b.id} is not over water (sd=${sd.toFixed(1)})`);
  if (!onBridge(b.x * T, b.y * T)) fail(`bridge ${b.id} onBridge false at its centre`);
  else ok(`bridge ${b.id} over water sd=${sd.toFixed(1)}, walkable`);
}

if (process.exitCode) {
  console.error('check_overworld: FAILED');
  process.exit(1);
}
console.log('check_overworld: all walk-logic checks passed');
