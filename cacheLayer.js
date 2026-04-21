// ─── Cache Layer ────────────────────────────────────────────────────────
// In-memory cache with TTL, LRU eviction, and namespace support.
// Used for frequently accessed DB queries and API responses.

class CacheLayer {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 500;
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000; // 5 min
    this.cache = new Map(); // key -> { data, expiry, hits, lastAccess }
    this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };

    // Cleanup expired entries every 60s
    this.cleanupTimer = setInterval(() => this._cleanup(), 60000);
  }

  // ─── Get cached value ─────────────────────────────────────────────────
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) { this.stats.misses++; return null; }
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    entry.hits++;
    entry.lastAccess = Date.now();
    this.stats.hits++;
    return entry.data;
  }

  // ─── Set cached value ─────────────────────────────────────────────────
  set(key, data, ttl) {
    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this._evictLRU();
    }
    this.cache.set(key, {
      data,
      expiry: Date.now() + (ttl || this.defaultTTL),
      hits: 0,
      lastAccess: Date.now(),
    });
    this.stats.sets++;
    return data;
  }

  // ─── Delete specific key ─────────────────────────────────────────────
  del(key) {
    return this.cache.delete(key);
  }

  // ─── Invalidate by prefix ────────────────────────────────────────────
  invalidatePrefix(prefix) {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) { this.cache.delete(key); count++; }
    }
    return count;
  }

  // ─── Clear all ────────────────────────────────────────────────────────
  clear() {
    this.cache.clear();
  }

  // ─── Wrap an async function with caching ──────────────────────────────
  wrap(key, fn, ttl) {
    return async (...args) => {
      const cached = this.get(key);
      if (cached !== null) return cached;
      const result = await fn(...args);
      this.set(key, result, ttl);
      return result;
    };
  }

  // ─── Stats ────────────────────────────────────────────────────────────
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 100) : 0,
      evictions: this.stats.evictions,
      sets: this.stats.sets,
    };
  }

  // ─── Internal: Remove expired entries ─────────────────────────────────
  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) this.cache.delete(key);
    }
  }

  // ─── Internal: Evict least recently used entry ────────────────────────
  _evictLRU() {
    let oldest = null;
    let oldestKey = null;
    for (const [key, entry] of this.cache) {
      if (!oldest || entry.lastAccess < oldest.lastAccess) {
        oldest = entry;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  // ─── Stop cleanup timer ──────────────────────────────────────────────
  stop() {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
  }
}

module.exports = { CacheLayer };
