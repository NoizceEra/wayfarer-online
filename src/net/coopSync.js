import { RANKS } from '../data/combatMath.js';
import { net } from './NetworkManager.js';
import {
  unpackTele, unpackMech, telegraphHits, isStrike, strikeId, teleDamage, teleStatus,
  packEnemyExtras, extrasChanged, dungeonAreaId, isDungeonArea, unpackRank,
  eventNetId, sanitizeDst, sanitizeEvp, lagWindowMs,
} from '../systems/coopPve.js';

// Client-side co-op PvE glue. WorldSync calls these; missing systems no-op.

export function netAreaOf(scene) {
  const d = scene?.dungeon;
  if (d?.active && d.run) return dungeonAreaId(d.run.seed, d.run.floor);
  return scene?.areas?.current?.id || 'ow';
}

export function enemyNetArea(e, scene) {
  if (e?.netArea) return e.netArea;
  if (e?.areaId && isDungeonArea(e.areaId)) return e.areaId;
  if ((e?.areaId === 'hollow' || !e?.areaId) && scene?.dungeon?.active && scene.dungeon.run) {
    return dungeonAreaId(scene.dungeon.run.seed, scene.dungeon.run.floor);
  }
  return e?.areaId || 'ow';
}

export function focusTarget(sync, e) {
  const me = sync.player;
  const scene = sync.scene;
  const myA = sync.myArea();
  let best = me, bd = me?.dead ? Infinity : Math.hypot((me?.x || 0) - e.x, (me?.y || 0) - e.y);
  sync.remotes?.forEach((r) => {
    if (r.area !== myA || r.dc || !r.placed || r.hp <= 0) return;
    const d = Math.hypot(r.x - e.x, r.y - e.y);
    if (d < bd) { bd = d; best = r; }
  });
  return best || scene.player;
}

export function applyIdentity(e, d) {
  if (!e || !d) return;
  if (d.ty && !e.typeId) e.typeId = d.ty;
  if (d.lv && e.level !== d.lv) e.level = d.lv;
  if (d.rk) {
    const id = unpackRank(d.rk);
    const rank = RANKS[id] || RANKS.normal;
    if (e.rank !== rank) {
      e.rank = rank;
      e.displayName = (rank.prefix || '') + (e.def?.name || e.displayName || '');
      if (rank.tint) { e.baseTint = rank.tint; e.restoreTint?.(); }
    }
  }
  if (d.mh > 0 && e.maxHp !== d.mh) {
    const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    e.maxHp = d.mh;
    if (d.h == null) e.hp = Math.max(0, Math.round(frac * d.mh));
  }
  if (d.ph) e.phase = d.ph;
  if (d.sh != null) e.invuln = !!d.sh;
  if (d.en && e.showBars) { e.engaged = true; e.showBars(true); }
  if (d.hx != null && d.hy != null && e.home) e.home = { x: d.hx, y: d.hy };
}

export function applyTeleFromSnap(e, d) {
  if (!e || !d) return;
  const bag = e._coop || (e._coop = {});
  if (d.tg) {
    const tele = unpackTele(d.tg);
    bag.tg = tele;
    if (e.isBoss) {
      e.plan = tele;
      e.state = tele.st === 'dash' ? 'dash' : tele.st === 'wind' ? 'wind' : (e.state || 'chase');
      e.drawTele?.();
    }
  } else if (bag.tg) {
    bag.tg = null;
    if (e.isBoss) { e.plan = null; e.tele?.clear?.(); }
  }
  if (d.mt) bag.mt = d.mt.map(unpackMech).filter(Boolean);
  else bag.mt = null;
}

function drawMechReplica(e) {
  const g = e.mg;
  const list = e._coop?.mt;
  if (!g || !list?.length) { g?.clear?.(); return; }
  g.clear();
  const now = e.scene?.time?.now || 0;
  for (const tele of list) {
    const f = Math.max(0, Math.min(1, (tele.t || 0) / (tele.wind || 1)));
    const late = f > 0.75;
    const pulse = 0.16 + 0.1 * Math.sin(now / 60);
    const rim = late && Math.floor(now / 80) % 2 ? 0xffffff : 0xff3030;
    if (tele.k === 'zones') {
      for (const s of tele.spots || []) {
        g.fillStyle(0xff3030, pulse).fillCircle(s.x, s.y, tele.r || 28);
        g.fillStyle(0xff3030, 0.38).fillCircle(s.x, s.y, (tele.r || 28) * f);
        g.lineStyle(late ? 3 : 2, rim, 0.95).strokeCircle(s.x, s.y, tele.r || 28);
      }
    } else if (tele.k === 'ring') {
      g.fillStyle(0xff3030, pulse).fillCircle(tele.x, tele.y, tele.r);
      g.fillStyle(0xff3030, 0.38).fillCircle(tele.x, tele.y, tele.r * f);
      g.lineStyle(late ? 3 : 2, rim, 0.95).strokeCircle(tele.x, tele.y, tele.r);
    } else if (tele.k === 'beams' && tele.lanes) {
      const len = tele.len || 220, wide = tele.wide || 22;
      for (const a of tele.lanes) {
        const ex = tele.sx + Math.cos(a) * len, ey = tele.sy + Math.sin(a) * len;
        const nx = -Math.sin(a) * wide / 2, ny = Math.cos(a) * wide / 2;
        const poly = [
          { x: tele.sx + nx, y: tele.sy + ny }, { x: ex + nx, y: ey + ny },
          { x: ex - nx, y: ey - ny }, { x: tele.sx - nx, y: tele.sy - ny },
        ];
        g.fillStyle(0xff3030, pulse).fillPoints(poly, true);
        g.lineStyle(late ? 3 : 2, rim, 0.95).strokePoints(poly, true);
      }
    }
  }
  if (e.invuln) e.drawShield?.(g, now);
}

function trySelfHit(sync, e, tele) {
  if (!tele || !isStrike(tele)) return;
  const id = strikeId(tele);
  if (!id || e._coopHit === id) return;
  const p = sync.player;
  if (!p || p.dead) return;
  const pad = 0; // late packet: current pos — already-dodged players are safe
  if (!telegraphHits(p.x, p.y, tele, pad + 0)) return;
  e._coopHit = id;
  if (typeof e.damageToPlayer === 'function') {
    e.damageToPlayer(sync.scene, teleDamage(e.atk, tele), teleStatus(tele));
  } else {
    sync.scene.combat?.hitPlayerFrom?.(e, teleDamage(e.atk, tele), teleStatus(tele));
  }
}

export function tickReplica(sync, e) {
  const bag = e._coop;
  if (!bag) return;
  if (e.isBoss) {
    e.drawTele?.();
    drawMechReplica(e);
  }
  const now = Date.now();
  const linger = lagWindowMs(net.ping);
  if (bag.tg && isStrike(bag.tg)) bag.linger = { tele: bag.tg, until: now + linger };
  for (const m of bag.mt || []) if (isStrike(m)) bag.lingerM = { tele: m, until: now + linger };
  trySelfHit(sync, e, bag.tg);
  for (const m of bag.mt || []) trySelfHit(sync, e, m);
  if (bag.linger && now <= bag.linger.until) trySelfHit(sync, e, bag.linger.tele);
  if (bag.lingerM && now <= bag.lingerM.until) trySelfHit(sync, e, bag.lingerM.tele);
}

export function appendEnemyDelta(d, e, lastExtras) {
  const cur = packEnemyExtras(e);
  if (!extrasChanged(lastExtras, cur)) return lastExtras;
  if (cur.ty) d.ty = cur.ty;
  if (!lastExtras || lastExtras.lv !== cur.lv) d.lv = cur.lv;
  if (!lastExtras || lastExtras.rk !== cur.rk) d.rk = cur.rk;
  if (!lastExtras || lastExtras.mh !== cur.mh) d.mh = cur.mh;
  if (!lastExtras || lastExtras.ph !== cur.ph) d.ph = cur.ph;
  if (!lastExtras || lastExtras.sh !== cur.sh) d.sh = cur.sh;
  if (!lastExtras || lastExtras.en !== cur.en) d.en = cur.en;
  if (JSON.stringify(lastExtras?.tg || null) !== JSON.stringify(cur.tg || null)) d.tg = cur.tg || null;
  if (JSON.stringify(lastExtras?.mt || null) !== JSON.stringify(cur.mt || null)) d.mt = cur.mt || null;
  if (!lastExtras) { d.hx = cur.hx; d.hy = cur.hy; }
  return cur;
}

export function applySnapFields(sync, e, d) {
  applyIdentity(e, d);
  applyTeleFromSnap(e, d);
  if (d.h !== undefined) sync.setEnemyHp?.(e, d.h);
}

export function spawnFromSnap(sync, d) {
  const s = sync.scene;
  if (!d?.i || !d.ty || !s?.makeEnemy) return null;
  if (sync.enemyById.get(d.i)?.active) return sync.enemyById.get(d.i);
  const x = d.x ?? d.hx ?? 0, y = d.y ?? d.hy ?? 0;
  const visualArea = s.areas?.current?.id || null;
  const rankId = unpackRank(d.rk);
  const e = s.makeEnemy(x, y, d.ty, visualArea, {
    netId: d.i,
    eo: { level: d.lv || undefined, rank: RANKS[rankId] || RANKS.normal },
  });
  if (d.mh > 0) { e.maxHp = d.mh; e.hp = d.h != null ? d.h : d.mh; }
  applySnapFields(sync, e, d);
  return e;
}

export function hitConfirm(sync, e, m) {
  if (!e || m.by !== net.sessionId) return;
  const s = sync.scene;
  s.combat?.floatText?.(e.x, e.y - 28, 'Hit', '#9dffb0', 'small');
  e.sprite?.setTintFill?.(0xb6ffc8);
  s.time?.delayedCall?.(70, () => { if (e.active) e.restoreTint?.(); });
}

export function takeoverArea(sync, area) {
  sync.enemyById?.forEach((e) => {
    if (!e.active) return;
    if (enemyNetArea(e, sync.scene) !== area) return;
    e._netReplica = false;
    if (e.isBoss && e.hp < e.maxHp) {
      e.engaged = true;
      e.state = e.state === 'idle' ? 'chase' : e.state;
      e.showBars?.(true);
    }
    if (e.mechs && e.invuln) {
      e.lanterns = (e.adds || []).filter((a) => a.active && (a.typeId === 'hlantern' || a.def?.lantern));
    }
  });
}

export function sendDungeonState(sync) {
  const d = sync.scene?.dungeon;
  if (!d?.active || !d.run || !net.connected) return;
  if (!net.isAuthority(netAreaOf(sync.scene))) return;
  const msg = {
    a: netAreaOf(sync.scene), seed: d.run.seed, floor: d.run.floor,
    sealed: d.run.sealed ? 1 : 0, done: d.run.done ? 1 : 0, kills: d.run.kills | 0,
  };
  const prev = sync._dstSent;
  if (prev && prev.a === msg.a && prev.sealed === msg.sealed && prev.done === msg.done && prev.floor === msg.floor) return;
  sync._dstSent = msg;
  net.send('dst', msg);
}

export function onDungeonState(sync, m) {
  const st = sanitizeDst(m);
  if (!st) return;
  const d = sync.scene?.dungeon;
  if (!d?.run) return;
  if (st.seed && d.run.seed !== st.seed) return;
  if (st.sealed === 0 && d.run.sealed) d.unseal?.();
  if (st.done && !d.run.done) d.run.done = true;
}

export function sendEventProgress(sync) {
  const we = sync.scene?.worldEvents;
  if (!we || !net.connected || !net.isAuthority('ow')) return;
  let msg = null;
  const c = we.cur;
  if (c && !c.over && c.def?.kind === 'raid') {
    const mobs = (c.objs || []).filter((o) => o.eventKey === c.key);
    const alive = mobs.filter((o) => o.active && o.alive).length;
    msg = { k: c.key, n: Math.max(0, mobs.length - alive), of: mobs.length, hp: 0, max: 0, tier: 0 };
  }
  const b = we.boss;
  if (b && !b.over && b.e?.active) {
    msg = {
      k: b.key, n: 0, of: 1, hp: Math.max(0, Math.round(b.e.hp)), max: b.e.maxHp | 0,
      tier: (b.dealt >= 0.15 ? 1 : 0),
    };
  }
  if (!msg) return;
  const prev = sync._evpSent;
  if (prev && prev.k === msg.k && prev.n === msg.n && prev.hp === msg.hp) return;
  sync._evpSent = msg;
  net.send('evp', msg);
}

export function onEventProgress(sync, m) {
  const st = sanitizeEvp(m);
  if (!st) return;
  const we = sync.scene?.worldEvents;
  if (!we) return;
  we.netProgress = st;
}

export { eventNetId };
