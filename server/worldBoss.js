import { CFG } from './config.js';
import { log } from './log.js';
import { loadChar, saveChar } from './store.js';
import { WayfarerRoom, LIVE_ROOMS } from './WayfarerRoom.js';

// World Boss: server-authoritative recurring spawn in the overworld 'ruins' zone.
// Schedule: UTC 00:00, 04:00, 08:00, 12:00, 16:00, 20:00. Active for 30 minutes or until slain.
// Global announcements + contribution scoring + gold / token-point rewards.
//
// Server -> client messages:
//   worldboss-announce { area, x, y, name, expiresAt, hp, maxHp }
//   worldboss-state    { active, area?, x?, y?, name?, expiresAt?, hp?, maxHp?, nextSpawn? }
//   worldboss-slain    { name, killerName, contributors:[{name, damage}] }
//
// Hook shape expected by WayfarerRoom / index.js: init(), install(room), onJoin(room, client, player), routes(app).

const SPAWN_HOURS = [0, 4, 8, 12, 16, 20];
const LIFETIME_MS = 30 * 60 * 1000;
const ZONE_ID = 'ruins';
const BOSS_NAME = 'World-Eater Gravemaw';
const BOSS_TYPE = 'tideeye'; // existing enemy sprite to borrow; server never sees visuals
const BOSS_MAX_HP = 8000;
const BOSS_ATK = 18;
const BOSS_LEVEL = 12;

const REWARDS = {
  gold: [100, 60, 40],
  tokenPoints: [10, 6, 4],
};

let state = {
  active: false,
  id: null,
  area: null,
  x: 0,
  y: 0,
  name: BOSS_NAME,
  hp: BOSS_MAX_HP,
  maxHp: BOSS_MAX_HP,
  expiresAt: 0,
  contributions: new Map(), // sessionId -> { name, damage, token }
  killerName: null,
  lastBroadcast: 0,
};

let timer = null;
let broadcastAll = null;

// pure UTC schedule helpers
function startOfDayUTC(t) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function nextSpawnTime(after = Date.now()) {
  const day0 = startOfDayUTC(after);
  for (const h of SPAWN_HOURS) {
    const cand = day0 + h * 3600_000;
    if (cand > after) return cand;
  }
  return day0 + 24 * 3600_000 + SPAWN_HOURS[0] * 3600_000;
}

function currentSpawnWindow(now = Date.now()) {
  const day0 = startOfDayUTC(now);
  for (let i = SPAWN_HOURS.length - 1; i >= 0; i--) {
    const start = day0 + SPAWN_HOURS[i] * 3600_000;
    const end = start + LIFETIME_MS;
    if (now >= start && now < end) return { start, end };
  }
  return null;
}

function buildAnnouncePayload() {
  return {
    area: state.area,
    x: state.x,
    y: state.y,
    name: state.name,
    expiresAt: state.expiresAt,
    hp: state.hp,
    maxHp: state.maxHp,
  };
}

function buildStatePayload() {
  if (!state.active) return { active: false, nextSpawn: nextSpawnTime() };
  return { active: true, ...buildAnnouncePayload() };
}

function broadcastGlobal(type, payload) {
  if (typeof broadcastAll === 'function') {
    try { broadcastAll(type, payload); } catch (e) { log.error('worldboss broadcast failed', { err: e.message }); }
    return;
  }
  // fallback: every live room broadcasts to its own clients
  for (const room of LIVE_ROOMS) {
    try { room.broadcast(type, payload); } catch { /* room closing */ }
  }
}

function setGlobalBroadcaster(fn) {
  broadcastAll = fn;
}

function pickSpawnPoint() {
  // Tidehollow Ruins rect in tile coords (see src/data/zones.js):
  // { x: 16, y: 80, w: 48, h: 40 }, tile size = 16 px in client; server just needs world px.
  // Use a deterministic point near the centre of the ruins.
  const T = 16;
  const tx = 16 + Math.floor(48 / 2);
  const ty = 80 + Math.floor(40 / 2);
  return { area: ZONE_ID, x: tx * T + 8, y: ty * T + 8 };
}

function spawnBoss() {
  if (state.active) return;
  const pt = pickSpawnPoint();
  const win = currentSpawnWindow();
  state.active = true;
  state.id = `wb-${Date.now()}`;
  state.area = pt.area;
  state.x = pt.x;
  state.y = pt.y;
  state.hp = BOSS_MAX_HP;
  state.maxHp = BOSS_MAX_HP;
  state.expiresAt = win ? win.end : Date.now() + LIFETIME_MS;
  state.contributions.clear();
  state.killerName = null;
  state.lastBroadcast = 0;
  log.info('worldboss spawn', { name: BOSS_NAME, area: pt.area, x: pt.x, y: pt.y, expiresAt: state.expiresAt });
  broadcastGlobal('worldboss-announce', buildAnnouncePayload());
}

function despawnBoss(reason) {
  if (!state.active) return;
  log.info('worldboss despawn', { reason, name: BOSS_NAME });
  state.active = false;
  state.hp = 0;
  state.contributions.clear();
}

function applyDamageToBoss(sid, name, amount) {
  if (!state.active || state.hp <= 0) return false;
  const rec = state.contributions.get(sid) || { name, damage: 0, token: null };
  rec.damage += Math.max(0, amount | 0);
  state.contributions.set(sid, rec);
  state.hp = Math.max(0, state.hp - amount);
  const now = Date.now();
  if (now - state.lastBroadcast > 2000) {
    state.lastBroadcast = now;
    broadcastGlobal('worldboss-state', buildStatePayload());
  }
  return state.hp <= 0;
}

function awardContributors() {
  const list = [...state.contributions.entries()]
    .map(([sid, r]) => ({ sid, name: r.name, damage: r.damage, token: r.token }))
    .sort((a, b) => b.damage - a.damage)
    .slice(0, 3);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c.token) continue;
    const rec = loadChar(c.token, c.name);
    if (!rec?.progress) continue;
    rec.progress.gold = Math.min(9_999_999, (rec.progress.gold | 0) + REWARDS.gold[i]);
    rec.progress.tokenPoints = (rec.progress.tokenPoints | 0) + REWARDS.tokenPoints[i];
    rec.savedAt = Date.now();
    saveChar(c.token, c.name, rec);
  }
  return list.map((c, i) => ({
    rank: i + 1,
    name: c.name,
    damage: c.damage,
    gold: REWARDS.gold[i] || 0,
    tokenPoints: REWARDS.tokenPoints[i] || 0,
  }));
}

function onBossSlain(killerName) {
  if (!state.active) return;
  state.killerName = killerName || 'unknown';
  const awarded = awardContributors();
  const payload = {
    name: state.name,
    killerName: state.killerName,
    contributors: awarded.map((a) => ({ name: a.name, damage: a.damage })),
  };
  log.info('worldboss slain', { name: BOSS_NAME, killer: state.killerName, contributors: awarded.length });
  broadcastGlobal('worldboss-slain', payload);
  despawnBoss('slain');
}

export function init() {
  // If the server starts inside a spawn window, spawn immediately.
  const now = Date.now();
  if (currentSpawnWindow(now)) spawnBoss();
}

export function install(room) {
  // Authority path: when this room's area authority reports an enemy hit, treat
  // the world-boss id specially and apply server-side contribution tracking.
  room.onMessage('ehit', (client, m) => {
    if (!state.active) return;
    const p = room.players.get(client.sessionId);
    if (!p || room.area(state.area).auth !== client.sessionId) return;
    if (m?.i !== state.id) return;
    const by = typeof m.by === 'string' ? m.by : client.sessionId;
    const who = room.players.get(by);
    if (!who) return;
    // Store token so rewards can be persisted even if the player leaves before slain.
    const rec = state.contributions.get(by) || { name: who.name, damage: 0, token: who.token };
    rec.token = who.token;
    state.contributions.set(by, rec);
    const died = applyDamageToBoss(by, who.name, m.d | 0);
    if (died) onBossSlain(who.name);
  });

  // Non-authority damage routing also contributes: 'hit' arrives from a striker,
  // authority replies with ehit (handled above), but we also record the striker
  // here as a fallback for split-authority edge cases.
  room.onMessage('hit', (client, m) => {
    if (!state.active || !m || m.i !== state.id) return;
    const p = room.players.get(client.sessionId);
    if (!p) return;
    const rec = state.contributions.get(client.sessionId) || { name: p.name, damage: 0, token: p.token };
    rec.token = p.token;
    state.contributions.set(client.sessionId, rec);
  });

  // Start the global timer that drives spawn/despawn on the room that loaded first.
  if (!timer) {
    timer = setInterval(() => {
      const now = Date.now();
      const win = currentSpawnWindow(now);
      if (win && !state.active) spawnBoss();
      else if (!win && state.active && !state.killerName) despawnBoss('window-ended');
      // periodic health/state broadcast while active
      if (state.active && now - state.lastBroadcast > 5000) {
        state.lastBroadcast = now;
        broadcastGlobal('worldboss-state', buildStatePayload());
      }
    }, 5000);
    timer.unref?.();
  }
}

export function onJoin(room, client, p) {
  try {
    client.send('worldboss-state', buildStatePayload());
  } catch { /* closing */ }
}

export function routes(app) {
  app.get('/world-boss', (req, res) => {
    res.json({
      ok: true,
      active: state.active,
      nextSpawn: state.active ? null : nextSpawnTime(),
      ...(state.active ? buildAnnouncePayload() : {}),
    });
  });
}

export { setGlobalBroadcaster, BOSS_NAME, nextSpawnTime, currentSpawnWindow };
