// lazyPanel(importer, make, init?) — a drop-in stand-in for a rarely used HUD panel whose module is only fetched/evaluated
// the first time the panel is actually used.
//   importer: () => import('./XPanel.js')      make: (mod) => new mod.XPanel(...)      init: (panel) => void (wire callbacks)
// Until loaded the proxy behaves like a closed panel: `visible` / `isOpen` / `container` read as falsy, close()/hide()/destroy()
// are no-ops (they never trigger a load), property writes (onQueue = fn, queued = false) are replayed onto the real panel, and
// any other method call (open, toggle, show, render, ...) loads the module and then performs the call.
// After load every access is forwarded to the real instance. `proxy.real` is the instance (or null), `proxy.preload()` warms it.
const CLOSED_PROPS = new Set(['visible', 'isOpen', 'container', 'el']);
const NOOP_BEFORE_LOAD = new Set(['close', 'hide', 'destroy']);

export function lazyPanel(importer, make, init, scene = null) {
  let real = null, promise = null, dead = false;
  const pending = {};
  const load = () => (promise ||= importer().then((mod) => {
    if (dead) return null;
    real = make(mod);
    for (const k of Object.keys(pending)) real[k] = pending[k];
    init?.(real);
    return real;
  }).catch((e) => { promise = null; console.warn('panel chunk failed', e); return null; }));
  scene?.events?.once('shutdown', () => { dead = true; });
  return new Proxy({}, {
    get(_, k) {
      if (k === 'real') return real;
      if (k === 'preload') return load;
      if (typeof k === 'symbol' || k === 'then') return undefined;
      if (real) { const v = real[k]; return typeof v === 'function' ? v.bind(real) : v; }
      if (k in pending) return pending[k];
      if (k === 'destroy') return () => { dead = true; };
      if (NOOP_BEFORE_LOAD.has(k)) return () => {};
      if (CLOSED_PROPS.has(k)) return k === 'visible' || k === 'isOpen' ? false : null;
      return (...a) => { load().then((r) => r?.[k]?.(...a)); };
    },
    set(_, k, v) { if (real) real[k] = v; else pending[k] = v; return true; },
  });
}
