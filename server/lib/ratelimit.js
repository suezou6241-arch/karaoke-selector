/** クライアント単位の固定窓レートリミッタ(メモリ内)。 */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  timer.unref();

  return {
    check(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
      }
      return { ok: true, retryAfterSec: 0 };
    },
  };
}
