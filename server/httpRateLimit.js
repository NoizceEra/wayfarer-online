// Small in-process limiter for the public read-only HTTP API. Colyseus
// gameplay traffic has separate per-session limits in WayfarerRoom.
const RULES = [
  { key: 'room-lookup', path: /^\/rooms\/[A-Za-z0-9_-]+$/, rate: 1, burst: 30 }, // 60/min sustained; code guessing
  { key: 'directory', path: /^\/(?:party-finder|leaderboard)$/, rate: 1, burst: 40 }, // 60/min
  { key: 'status', path: /^\/(?:stats|economy|referrals|world-boss)$/, rate: 5, burst: 100 }, // 300/min
];
const MAX_CLIENTS = 10_000;
const IDLE_MS = 10 * 60_000;
const buckets = new Map();

function clientKey(req) {
  // Express req.ip uses the socket address unless the operator explicitly
  // configures trusted proxy hops. Never read X-Forwarded-For directly here.
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 128);
}

function prune(now) {
  if (buckets.size < MAX_CLIENTS) return;
  for (const [key, value] of buckets) {
    if (now - value.updatedAt > IDLE_MS) buckets.delete(key);
  }
}

export function publicApiRateLimit(req, res, next) {
  if (req.method !== 'GET') return next();
  const rule = RULES.find(({ path }) => path.test(req.path));
  if (!rule) return next();

  res.set('Cache-Control', 'no-store');
  const now = Date.now();
  // Key room lookups by endpoint, not requested code, so rotating guesses
  // cannot reset the enumeration budget.
  const key = `${clientKey(req)}:${rule.key}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    prune(now);
    // Bound memory even if the app is exposed directly to many source IPs.
    const safeKey = buckets.size < MAX_CLIENTS ? key : `overflow:${rule.key}`;
    bucket = buckets.get(safeKey);
    if (!bucket) {
      bucket = { tokens: rule.burst, updatedAt: now };
      buckets.set(safeKey, bucket);
    }
  }

  bucket.tokens = Math.min(rule.burst, bucket.tokens + ((now - bucket.updatedAt) / 1000) * rule.rate);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    res.set('Retry-After', String(Math.max(1, Math.ceil((1 - bucket.tokens) / rule.rate))));
    return res.status(429).json({ error: 'rate_limited' });
  }
  bucket.tokens -= 1;
  next();
}
