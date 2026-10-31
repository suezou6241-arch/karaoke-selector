/**
 * メモリ上の TTL キャッシュ。同じキーの同時リクエストは 1 回の取得にまとめる。
 * 失敗した結果はキャッシュしない。永続化はしない(提供元の保存条件に配慮し、短期のメモリ保持のみ)。
 */
export class TtlCache {
  constructor({ maxEntries = 500 } = {}) {
    this.maxEntries = maxEntries;
    this.map = new Map();
    this.inflight = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // LRU: 参照されたものを末尾へ
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value, ttlMs) {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  async wrap(key, ttlMs, fn) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try {
        const value = await fn();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}
