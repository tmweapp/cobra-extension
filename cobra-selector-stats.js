/**
 * COBRA v5.2 — Selector Statistics Engine
 * Tracks success/failure of CSS selectors per domain.
 * Auto-ranks selectors by reliability score.
 *
 * Score formula: basePriority + (successes * 5) - (failures * 8)
 * Negative scores → selector is unreliable, deprioritize.
 *
 * Ported from v10 with fixes:
 *   - Race-condition-safe stat updates (atomic read-modify-write)
 *   - TTL-based cleanup (stale stats removed after 30 days)
 *   - Capped per-domain entries (max 200 selectors per domain)
 */

const CobraSelectorStats = {
  // In-memory cache (flushed to IndexedDB periodically)
  _cache: new Map(), // key: "domain::selector" → { success, failure, lastUsed, score }
  _dirty: false,
  _flushInterval: null,
  _maxPerDomain: 200,
  _ttlDays: 30,

  // ── Init ──
  async init() {
    try {
      if (self.cobraIDB) {
        const all = await self.cobraIDB.getAll('selector_stats');
        for (const entry of all) {
          this._cache.set(entry.id, entry);
        }
        console.log(`[SelectorStats] Loaded ${all.length} selector stats from IDB`);
      }
    } catch (e) {
      console.warn('[SelectorStats] Init from IDB failed:', e.message);
    }

    // Periodic flush every 60s
    this._flushInterval = setInterval(() => this.flush(), 60000);

    // Cleanup stale entries on init
    this._cleanupStale();
  },

  // ── Record Results ──
  /**
   * Record a selector success
   * @param {string} domain - e.g. "booking.com"
   * @param {string} selector - CSS selector
   * @param {number} [basePriority=0] - initial priority boost
   */
  recordSuccess(domain, selector, basePriority = 0) {
    const key = `${domain}::${selector}`;
    const entry = this._cache.get(key) || this._newEntry(key, domain, selector, basePriority);
    entry.success++;
    entry.lastUsed = Date.now();
    entry.score = this._calcScore(entry);
    this._cache.set(key, entry);
    this._dirty = true;
  },

  /**
   * Record a selector failure
   * @param {string} domain
   * @param {string} selector
   * @param {number} [basePriority=0]
   */
  recordFailure(domain, selector, basePriority = 0) {
    const key = `${domain}::${selector}`;
    const entry = this._cache.get(key) || this._newEntry(key, domain, selector, basePriority);
    entry.failure++;
    entry.lastUsed = Date.now();
    entry.score = this._calcScore(entry);
    this._cache.set(key, entry);
    this._dirty = true;
  },

  // ── Ranking ──
  /**
   * Get selectors for a domain, ranked by score (highest first)
   * @param {string} domain
   * @param {string} [purpose] - optional filter by tag/purpose
   * @returns {Array<{ selector: string, score: number, success: number, failure: number }>}
   */
  getRanked(domain, purpose = null) {
    const results = [];
    const prefix = `${domain}::`;
    for (const [key, entry] of this._cache) {
      if (key.startsWith(prefix)) {
        if (purpose && entry.purpose && entry.purpose !== purpose) continue;
        results.push({
          selector: entry.selector,
          score: entry.score,
          success: entry.success,
          failure: entry.failure,
          lastUsed: entry.lastUsed
        });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  },

  /**
   * Get best selector for a domain (highest score)
   * @param {string} domain
   * @param {string[]} candidates - array of selectors to choose from
   * @returns {string|null} Best selector or null
   */
  getBest(domain, candidates) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    let best = null;
    let bestScore = -Infinity;

    for (const sel of candidates) {
      const key = `${domain}::${sel}`;
      const entry = this._cache.get(key);
      const score = entry ? entry.score : 0;
      if (score > bestScore) {
        bestScore = score;
        best = sel;
      }
    }
    return best;
  },

  // ── Persistence ──
  async flush() {
    if (!this._dirty || !self.cobraIDB) return;
    try {
      const entries = Array.from(this._cache.values());
      await self.cobraIDB.bulkPut('selector_stats', entries);
      this._dirty = false;
    } catch (e) {
      console.warn('[SelectorStats] Flush failed:', e.message);
    }
  },

  // ── Internal ──
  _newEntry(key, domain, selector, basePriority) {
    return {
      id: key,
      domain,
      selector,
      basePriority: basePriority || 0,
      success: 0,
      failure: 0,
      score: basePriority || 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      purpose: null
    };
  },

  _calcScore(entry) {
    return (entry.basePriority || 0) + (entry.success * 5) - (entry.failure * 8);
  },

  _cleanupStale() {
    const cutoff = Date.now() - (this._ttlDays * 24 * 60 * 60 * 1000);
    const domainCounts = new Map();
    const toDelete = [];

    for (const [key, entry] of this._cache) {
      // Remove entries older than TTL
      if (entry.lastUsed < cutoff) {
        toDelete.push(key);
        continue;
      }

      // Track per-domain counts
      const count = (domainCounts.get(entry.domain) || 0) + 1;
      domainCounts.set(entry.domain, count);
    }

    // Remove stale
    for (const key of toDelete) {
      this._cache.delete(key);
      this._dirty = true;
    }

    // Cap per-domain entries (remove lowest-scored beyond limit)
    for (const [domain, count] of domainCounts) {
      if (count > this._maxPerDomain) {
        const ranked = this.getRanked(domain);
        const excess = ranked.slice(this._maxPerDomain);
        for (const item of excess) {
          this._cache.delete(`${domain}::${item.selector}`);
          this._dirty = true;
        }
      }
    }

    if (toDelete.length > 0) {
      console.log(`[SelectorStats] Cleaned up ${toDelete.length} stale entries`);
    }
  },

  // ── Stats Summary ──
  getSummary() {
    const domains = new Map();
    for (const entry of this._cache.values()) {
      const d = domains.get(entry.domain) || { selectors: 0, totalSuccess: 0, totalFailure: 0 };
      d.selectors++;
      d.totalSuccess += entry.success;
      d.totalFailure += entry.failure;
      domains.set(entry.domain, d);
    }
    return {
      totalSelectors: this._cache.size,
      domains: Object.fromEntries(domains)
    };
  }
};

self.CobraSelectorStats = CobraSelectorStats;
console.log('[cobra-selector-stats.js] Loaded: Selector Statistics Engine');
