// COBRA v3 — Cache Module
// TTL differenziato + quota management + cleanup automatico

const Cache = {

  // ============================================================
  // 1. TTL PER TIPO (in giorni)
  // ============================================================
  TTL: {
    domain:     30,
    company:    60,
    person:     90,
    news:       7,
    logo:       90,
    screenshot: 14,
    search:     3,
    freight:    14,
  },

  // Quota management
  MAX_ENTRIES: 1000,
  MAX_BYTES: 5242880, // 5MB

  _prefix: 'fs_cache_',
  _entryCount: null, // Cache entry count
  _statsCachedAt: 0,
  _statsCacheDuration: 30000, // 30 seconds
  _statsCache: null,
  _hitUpdates: {}, // Batch hit updates
  _hitFlushInterval: null,

  // ============================================================
  // 2. GESTIONE CACHE
  // ============================================================
  _key(type, identifier) {
    const clean = identifier.toLowerCase().replace(/^www\./, '').replace(/\/+$/, '').trim();
    return this._prefix + type + ':' + clean;
  },

  async _initEntryCount() {
    if (this._entryCount !== null) return;
    try {
      const all = await chrome.storage.local.get(null);
      this._entryCount = Object.keys(all).filter(k => k.startsWith(this._prefix)).length;
    } catch {
      this._entryCount = 0;
    }
  },

  async set(type, identifier, data) {
    const key = this._key(type, identifier);
    const ttlDays = this.TTL[type] || 7;
    const entry = {
      data,
      type,
      identifier,
      cachedAt: Date.now(),
      expiresAt: Date.now() + (ttlDays * 24 * 60 * 60 * 1000),
      hits: 0,
    };

    await this._initEntryCount();

    // Check quota prima di scrivere
    if (this._entryCount >= this.MAX_ENTRIES) {
      await this._enforceQuota();
    }

    await chrome.storage.local.set({ [key]: entry });
    this._entryCount++;
    this._statsCache = null; // Invalidate stats cache

    return entry;
  },

  async get(type, identifier) {
    const key = this._key(type, identifier);
    const result = await chrome.storage.local.get(key);
    const entry = result[key];

    if (!entry) return null;

    // Validate entry has required fields
    if (!entry.data || !entry.type || entry.expiresAt === undefined) {
      await chrome.storage.local.remove(key);
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      await chrome.storage.local.remove(key);
      return null;
    }

    // Batch hit updates instead of updating synchronously
    if (!this._hitFlushInterval) {
      this._hitFlushInterval = setInterval(() => this._flushHitUpdates(), 60000);
    }
    this._hitUpdates[key] = (this._hitUpdates[key] || 0) + 1;

    return entry.data;
  },

  async _flushHitUpdates() {
    if (Object.keys(this._hitUpdates).length === 0) return;

    try {
      for (const [key, hitCount] of Object.entries(this._hitUpdates)) {
        const result = await chrome.storage.local.get(key);
        const entry = result[key];
        if (entry) {
          entry.hits = (entry.hits || 0) + hitCount;
          await chrome.storage.local.set({ [key]: entry });
        }
      }
      this._hitUpdates = {};
    } catch (err) {
      console.error('Failed to flush hit updates:', err);
    }
  },

  async has(type, identifier) {
    return (await this.get(type, identifier)) !== null;
  },

  async invalidate(type, identifier) {
    const key = this._key(type, identifier);
    await chrome.storage.local.remove(key);
    this._entryCount--;
    this._statsCache = null; // Invalidate stats cache
  },

  // ============================================================
  // 3. SMART CACHE
  // ============================================================
  async getOrFetch(type, identifier, fetchFn) {
    const cached = await this.get(type, identifier);
    if (cached !== null) {
      return { data: cached, fromCache: true };
    }
    const freshData = await fetchFn();
    await this.set(type, identifier, freshData);
    return { data: freshData, fromCache: false };
  },

  // ============================================================
  // 4. MANUTENZIONE + QUOTA
  // ============================================================
  async cleanup() {
    const all = await chrome.storage.local.get(null);
    const toRemove = [];
    let remaining = 0;

    for (const [key, entry] of Object.entries(all)) {
      if (!key.startsWith(this._prefix)) continue;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        toRemove.push(key);
      } else {
        remaining++;
      }
    }

    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
    }

    this._entryCount = remaining;
    this._statsCache = null;

    return { removed: toRemove.length, remaining };
  },

  // Enforza quota: LRU eviction when cache is full
  // Remove entries with lowest hit count (LRU) or oldest timestamp
  async _enforceQuota() {
    const all = await chrome.storage.local.get(null);
    const entries = [];
    let totalBytes = 0;

    for (const [key, entry] of Object.entries(all)) {
      if (!key.startsWith(this._prefix)) continue;
      const entrySize = JSON.stringify(entry).length;
      totalBytes += entrySize;
      entries.push({
        key,
        cachedAt: entry.cachedAt || 0,
        hits: entry.hits || 0,
        size: entrySize
      });
    }

    // Check if we exceed entry count or byte limit
    if (entries.length < this.MAX_ENTRIES && totalBytes < this.MAX_BYTES) {
      this._entryCount = entries.length;
      return;
    }

    // LRU: Sort by hits (ascending) then by cachedAt (ascending)
    // This removes least-recently-used entries first
    entries.sort((a, b) => {
      if (a.hits !== b.hits) return a.hits - b.hits;
      return a.cachedAt - b.cachedAt;
    });

    // Determine how much to remove
    let toRemove = [];
    let removedBytes = 0;

    // If entry count exceeded, remove 20% of entries
    if (entries.length >= this.MAX_ENTRIES) {
      const removalCount = Math.ceil(entries.length * 0.2);
      toRemove = entries.slice(0, removalCount).map(e => e.key);
      for (const entry of entries.slice(0, removalCount)) {
        removedBytes += entry.size;
      }
    }

    // If bytes exceeded, remove until under limit
    if (totalBytes >= this.MAX_BYTES) {
      const targetBytes = this.MAX_BYTES * 0.8; // Target 80% of max
      let currentBytes = totalBytes;
      for (const entry of entries) {
        if (currentBytes <= targetBytes) break;
        if (!toRemove.includes(entry.key)) {
          toRemove.push(entry.key);
          currentBytes -= entry.size;
        }
      }
    }

    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
    }

    this._entryCount = entries.length - toRemove.length;
    this._statsCache = null;
  },

  async getStats() {
    const now = Date.now();

    // Return cached stats if fresh
    if (this._statsCache && (now - this._statsCachedAt) < this._statsCacheDuration) {
      return this._statsCache;
    }

    const all = await chrome.storage.local.get(null);
    const stats = { total: 0, byType: {}, totalHits: 0, expired: 0 };

    for (const [key, entry] of Object.entries(all)) {
      if (!key.startsWith(this._prefix)) continue;
      stats.total++;

      const type = entry.type || 'unknown';
      if (!stats.byType[type]) stats.byType[type] = { count: 0, hits: 0 };
      stats.byType[type].count++;
      stats.byType[type].hits += entry.hits || 0;
      stats.totalHits += entry.hits || 0;

      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        stats.expired++;
      }
    }

    stats.requestsSaved = stats.totalHits;

    // Cache the stats
    this._statsCache = stats;
    this._statsCachedAt = now;
    this._entryCount = stats.total;

    return stats;
  },

  async clear() {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter(k => k.startsWith(this._prefix));
    if (cacheKeys.length > 0) {
      await chrome.storage.local.remove(cacheKeys);
    }
    this._entryCount = 0;
    this._statsCache = null;
    return { cleared: cacheKeys.length };
  },

  // ============================================================
  // 5. EXPORT / IMPORT
  // ============================================================
  async exportAll() {
    const all = await chrome.storage.local.get(null);
    const cacheEntries = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(this._prefix)) {
        cacheEntries[key] = value;
      }
    }
    return cacheEntries;
  },

  async importAll(entries) {
    await chrome.storage.local.set(entries);
    this._entryCount = Object.keys(entries).length;
    this._statsCache = null;
    return { imported: Object.keys(entries).length };
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.Cache = Cache;
}
