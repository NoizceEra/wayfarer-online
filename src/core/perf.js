// Runtime profiler + adaptive quality governor.
//   ?perf=1            show the on-screen overlay (FPS, frame ms avg/p95/max, draw calls, objects, texture MB, listeners)
//   window.__perf      snapshot() / show(bool) / governor('auto'|'off') / reset()
// The governor never overrides a quality the player chose explicitly (settings.explicit). It only recovers
// quality the engine auto-lowered (Fx.autoQuality or this governor), with hysteresis so it cannot flap.
import { bus } from './events.js';
import { settings as fxs } from '../systems/fxSettings.js';
import { installCull, cullStats } from './cull.js';

const RING = 240;
const ORDER = ['low', 'med', 'high'];

export function installPerf(game) {
  const ring = new Float32Array(RING);
  let n = 0, last = performance.now(), frames = 0, fpsT = last, fps = 0;
  let culledLast = 0, draws = 0, drawsLast = 0, gl = null, overlay = null, overlayOn = false;
  const gov = { mode: 'auto', ceiling: fxs.quality, lastChange: 0, goodT: 0, badT: 0, lowered: 0, frozenUntil: 0, log: [] };

  // draw-call counter (WebGL only): wraps drawElements/drawArrays once
  const hookGl = () => {
    gl = game.renderer?.gl;
    if (!gl || gl.__perfHooked) return;
    gl.__perfHooked = true;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = gl[fn]; if (!o) continue;
      gl[fn] = function (...a) { draws++; return o.apply(this, a); };
    }
  };

  const textureBytes = () => {
    let b = 0;
    try {
      for (const t of Object.values(game.textures.list)) {
        for (const s of t.source) b += (s.width || 0) * (s.height || 0) * 4;
      }
    } catch { /* ignore */ }
    return b;
  };
  const countObjects = () => {
    let total = 0; const scenes = {};
    for (const sc of game.scene.getScenes(true)) { const c = sc.children?.length || 0; scenes[sc.sys.settings.key] = c; total += c; }
    return { total, scenes };
  };
  const listenerCounts = () => {
    let busN = 0; bus.map.forEach((s) => { busN += s.size; });
    let sceneN = 0;
    for (const sc of game.scene.getScenes(false)) {
      const ev = sc.events?._events; if (ev) for (const k in ev) sceneN += Array.isArray(ev[k]) ? ev[k].length : 1;
    }
    let inputN = 0; try { const ev = game.events._events; for (const k in ev) inputN += Array.isArray(ev[k]) ? ev[k].length : 1; } catch { /* ignore */ }
    return { bus: busN, sceneEvents: sceneN, gameEvents: inputN, fxSettings: fxs.listeners.size };
  };
  const stats = () => {
    const m = Math.min(n, RING);
    if (!m) return { avg: 0, p95: 0, max: 0 };
    const a = Array.from(ring.subarray(0, m)).sort((x, y) => x - y);
    return { avg: a.reduce((s, v) => s + v, 0) / m, p95: a[Math.floor(m * 0.95)], max: a[m - 1] };
  };
  const snapshot = () => {
    const s = stats(), o = countObjects();
    return {
      renderer: game.renderer?.type === 1 ? 'canvas' : 'webgl', fps: Math.round(fps), frameMs: +s.avg.toFixed(2), p95Ms: +s.p95.toFixed(2), maxMs: +s.max.toFixed(2),
      drawCalls: drawsLast, culledPerFrame: culledLast, cpuUpdateMs: +tm.update.toFixed(2), cpuRenderMs: +tm.render.toFixed(2), objects: o.total, objectsByScene: o.scenes, textureMB: +(textureBytes() / 1048576).toFixed(1),
      textures: Object.keys(game.textures.list).length, tweens: sumTweens(), listeners: listenerCounts(),
      quality: fxs.quality, explicitQuality: fxs.explicit, governor: { mode: gov.mode, lowered: gov.lowered, log: gov.log.slice(-5) },
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  };
  const sumTweens = () => { let t = 0; for (const sc of game.scene.getScenes(true)) t += sc.tweens?.getTweens?.().length || 0; return t; };

  const fmt = (s) => `${s.renderer} ${s.fps}fps  ${s.frameMs}ms avg / ${s.p95Ms} p95 / ${s.maxMs} max\n`
    + `cpu upd ${s.cpuUpdateMs}ms rnd ${s.cpuRenderMs}ms cull ${s.culledPerFrame}\n`
    + `draws ${s.drawCalls}  objs ${s.objects}  tex ${s.textureMB}MB (${s.textures})  tweens ${s.tweens}\n`
    + `q=${s.quality}${s.explicitQuality ? '*' : ''} gov=${s.governor.mode}  lst bus ${s.listeners.bus} scn ${s.listeners.sceneEvents}`
    + (s.heapMB != null ? `  heap ${s.heapMB}MB` : '');
  const show = (on) => {
    overlayOn = !!on;
    if (overlayOn && !overlay) {
      overlay = document.createElement('pre');
      overlay.style.cssText = 'position:fixed;left:calc(env(safe-area-inset-left,0px) + 4px);top:calc(env(safe-area-inset-top,0px) + 4px);z-index:9999;margin:0;padding:3px 5px;'
        + 'font:10px/1.25 monospace;color:#9bf06b;background:rgba(0,0,0,.6);pointer-events:none;white-space:pre';
      document.body.append(overlay);
    }
    if (overlay) overlay.style.display = overlayOn ? 'block' : 'none';
    if (overlayOn) hookGl();
  };

  const governorTick = (now) => {
    if (gov.mode !== 'auto' || fxs.explicit && !fxs._autoLowered) return;
    const idx = ORDER.indexOf(fxs.quality);
    if (document.hidden || !game.scene.isActive('world')) { gov.goodT = 0; gov.badT = 0; return; }
    if (fps && fps < 34) { gov.badT++; gov.goodT = 0; } else if (fps >= 56) { gov.goodT++; gov.badT = Math.max(0, gov.badT - 1); } else { gov.goodT = 0; }
    if (gov.badT >= 5 && idx > 0 && !fxs.explicit && now - gov.lastChange > 8000) {
      gov.badT = 0; gov.lastChange = now; gov.lowered++; gov.frozenUntil = now + 90000; fxs._autoLowered = true;
      fxs.setQuality(ORDER[idx - 1], false);
      gov.log.push(`${Math.round(now / 1000)}s -> ${ORDER[idx - 1]} (fps ${Math.round(fps)})`);
    } else if (gov.goodT >= 30 && fxs._autoLowered && idx < ORDER.indexOf(gov.ceiling) && now > gov.frozenUntil && !fxs.explicit) {
      gov.goodT = 0; gov.lastChange = now;
      fxs.setQuality(ORDER[idx + 1], false);
      gov.log.push(`${Math.round(now / 1000)}s -> ${ORDER[idx + 1]} (recover)`);
      if (fxs.quality === gov.ceiling) fxs._autoLowered = false;
    }
  };

  // CPU-side split: scene update (game logic) vs render submission. GPU time is NOT included, which is what
  // matters for spotting JS hot spots independent of the device's GPU.
  const tm = { update: 0, render: 0, u: 0, r: 0, k: 0 };
  {
    const sm = game.scene, ou = sm.update.bind(sm), or = sm.render.bind(sm);
    sm.update = (t, d) => { const a = performance.now(); ou(t, d); tm.u += performance.now() - a; };
    sm.render = (r) => { const a = performance.now(); or(r); tm.r += performance.now() - a; tm.k++; };
  }
  game.events.on('postrender', () => {
    const now = performance.now();
    const dt = now - last; last = now;
    if (dt < 1000) { ring[n % RING] = dt; n++; }
    frames++;
    culledLast = cullStats.culled; cullStats.culled = 0; cullStats.tested = 0;
    if (overlayOn) { drawsLast = draws; }
    draws = 0;
    if (now - fpsT >= 1000) {
      if (tm.k) { tm.update = tm.u / tm.k; tm.render = tm.r / tm.k; } tm.u = tm.r = tm.k = 0;
      fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now;
      governorTick(now);
    }
  });
  let ovT = 0;
  setInterval(() => { if (overlayOn && overlay && performance.now() - ovT > 400) { ovT = performance.now(); overlay.textContent = fmt(snapshot()); } }, 500);

  installCull();
  if (new URLSearchParams(location.search).get('cull') === '0') cullStats.enabled = false;
  window.__perf = {
    cull(on) { if (on !== undefined) cullStats.enabled = !!on; return cullStats.enabled; }, cullStats,
    snapshot, show, reset() { n = 0; ring.fill(0); gov.log.length = 0; },
    governor(mode) { if (mode === 'auto' || mode === 'off') gov.mode = mode; return gov.mode; },
    hookGl,
  };
  if (new URLSearchParams(location.search).get('perf') === '1') { hookGl(); show(true); game.events.once('ready', hookGl); }
}
