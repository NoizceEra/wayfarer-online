#!/usr/bin/env node
// Optional live-relay check: 3 headless Colyseus clients, area authority,
// shared HP, hit credit, late join. Skips cleanly if the relay is down.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join as pathJoin } from 'node:path';
import { Client } from 'colyseus.js';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.COOP_TEST_PORT || 2577);
const HTTP = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = pathJoin(dirname(fileURLToPath(import.meta.url)), '..', 'server');

async function waitHealth(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${HTTP}/health`);
      if (r.ok) return true;
    } catch { /* not up */ }
    await sleep(200);
  }
  return false;
}

function startRelay() {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: process.env.TEMP || '/tmp', LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

function listen(room) {
  const inbox = [];
  const push = (type) => (m) => inbox.push({ type, m });
  for (const t of ['snap', 'adead', 'hit', 'ehit', 'edeath', 'auth', 'welcome', 'peer-join']) room.onMessage(t, push(t));
  room.onMessage('*', (type, m) => inbox.push({ type, m }));
  return inbox;
}

async function join(name) {
  const client = new Client(HTTP);
  const room = await client.create('party', { name, x: 80, y: 80, a: 'ow' });
  return { client, room, inbox: listen(room), sid: room.sessionId };
}

function take(inbox, type) { return inbox.filter((x) => x.type === type); }

async function main() {
  let child = null;
  let own = false;
  if (!(await waitHealth(400))) {
    child = startRelay();
    own = true;
    if (!(await waitHealth())) {
      console.log('coop_pve_net: relay did not start (skipped)');
      child?.kill();
      process.exit(0);
    }
  }
  try {
    const A = await join('Alice');
    const code = A.room.roomId;
    const B = await joinWait(code, 'Bob');
    A.room.send('esnap', {
      a: 'ow', t: Date.now(),
      e: [{ i: 'boss1', x: 80, y: 80, h: 100, mh: 100, ty: 'worldtitan', lv: 12, rk: 'n', tg: [0, 0, 1150, 1150, 80, 80, 40, 0, 0, 0, 80, 80] }],
    });
    await sleep(250);
    B.room.send('hit', { i: 'boss1', d: 25 });
    A.room.send('ehit', { i: 'boss1', d: 25, h: 75, by: B.sid });
    await sleep(200);
    const C = await joinWait(code, 'Cara'); // late joiner
    await sleep(300);
    const snaps = take(C.inbox, 'snap');
    const hasHp = snaps.some((s) => (s.m.e || []).some((e) => e.i === 'boss1' && e.h === 75));
    A.room.send('edeath', { i: 'boss1', by: [A.sid, B.sid], r: 0 });
    await sleep(200);
    const deaths = take(B.inbox, 'edeath');
    const credited = deaths.some((d) => (d.m.by || []).includes(B.sid));
    // migrate: A leaves
    await A.room.leave();
    await sleep(400);
    const auths = take(B.inbox, 'auth');
    const migrated = auths.some((a) => a.m.a === 'ow' && a.m.sid === B.sid);
    if (!hasHp) throw new Error('late joiner did not see HP 75');
    if (!credited) throw new Error('guest not in edeath.by');
    if (!migrated) throw new Error('authority did not migrate to B');
    console.log('coop_pve_net: late-join HP, credit, migrate ok');
    await B.room.leave(); await C.room.leave();
  } finally {
    if (own && child) child.kill();
  }
}

async function joinWait(roomId, name) {
  const client = new Client(HTTP);
  const room = await client.joinById(roomId, { name, x: 90, y: 80, a: 'ow' });
  return { client, room, inbox: listen(room), sid: room.sessionId };
}

main().catch((e) => {
  console.error('coop_pve_net:', e.message || e);
  process.exit(1);
});
