// Snapshot interpolation buffer (server-clock timestamps, ms).
// Rendered at serverNow - INTERP_DELAY so there are normally two samples
// around the render time; beyond the newest sample we extrapolate briefly
// from the last velocity, then ease back to the last known position.
export const INTERP_DELAY = 100;
const MAX_EXTRAP = 150;   // ms of dead reckoning past the newest sample
const SETTLE = 200;       // ms to ease back once extrapolation expires
const SNAP_DIST = 220;    // px jump between samples = teleport, don't glide

export class SnapBuffer {
  constructor(max = 24) { this.s = []; this.max = max; }
  get last() { return this.s[this.s.length - 1] || null; }
  clear() { this.s.length = 0; }

  push(t, x, y, extra) {
    const last = this.last;
    if (last && t <= last.t) t = last.t + 1; // keep strictly increasing
    // Stationary gap (no updates while idle): pin the old position just
    // before the new sample so we don't glide slowly across the whole gap.
    if (last && t - last.t > 250) this.s.push({ t: t - 67, x: last.x, y: last.y, still: true, ...(last.extra ? { extra: last.extra } : {}) });
    this.s.push({ t, x, y, extra });
    while (this.s.length > this.max) this.s.shift();
  }

  // -> {x, y, extra, moving, snapped} or null when empty
  sample(rt, allowExtrap = true) {
    const s = this.s;
    if (!s.length) return null;
    if (rt <= s[0].t) return { x: s[0].x, y: s[0].y, extra: s[0].extra, moving: false };
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1], b = s[i];
      if (rt >= a.t && rt <= b.t) {
        if (Math.hypot(b.x - a.x, b.y - a.y) > SNAP_DIST) return { x: b.x, y: b.y, extra: b.extra, moving: false, snapped: true };
        const k = (rt - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, extra: b.extra, moving: a.x !== b.x || a.y !== b.y };
      }
    }
    // past the newest sample: dead-reckon, then settle
    const b = s[s.length - 1], a = s[s.length - 2];
    if (!allowExtrap || !a || b.still || Math.hypot(b.x - a.x, b.y - a.y) > SNAP_DIST) return { x: b.x, y: b.y, extra: b.extra, moving: false };
    const over = rt - b.t;
    const vx = (b.x - a.x) / (b.t - a.t || 1), vy = (b.y - a.y) / (b.t - a.t || 1);
    let e;
    if (over <= MAX_EXTRAP) e = over;
    else e = Math.max(0, MAX_EXTRAP * (1 - (over - MAX_EXTRAP) / SETTLE));
    return { x: b.x + vx * e, y: b.y + vy * e, extra: b.extra, moving: over <= MAX_EXTRAP && (vx !== 0 || vy !== 0), extrap: true };
  }
}
