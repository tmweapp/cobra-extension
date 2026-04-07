/**
 * @module CobraAudit
 * @description Audit Log System — records every action with who, what, when, where, result.
 * Persistence via IndexedDB (store 'entries'). 7-day retention, max 10,000 entries.
 *
 * @example
 * await CobraAudit.init();
 * CobraAudit.log({ action: 'SCRAPE', category: 'tool', hostname: 'example.com', result: 'ok' });
 * const stats = await CobraAudit.getStats();
 * const entries = await CobraAudit.query({ category: 'tool', since: Date.now() - 86400000 });
 */

const CobraAudit = {
  _DB_NAME: 'cobra_audit',
  _STORE: 'entries',
  _VERSION: 1,
  _MAX_ENTRIES: 10000,
  _RETENTION_MS: 7 * 24 * 60 * 60 * 1000, // 7 giorni
  _db: null,
  _buffer: [],        // in-memory buffer pre-DB init
  _initialized: false,

  // ══════════════════════════════════════════════════════
  // INIT — apri/crea IndexedDB
  // ══════════════════════════════════════════════════════
  async init() {
    if (this._initialized) return;
    try {
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(this._DB_NAME, this._VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this._STORE)) {
            const store = db.createObjectStore(this._STORE, { keyPath: 'id', autoIncrement: true });
            store.createIndex('ts', 'ts', { unique: false });
            store.createIndex('action', 'action', { unique: false });
            store.createIndex('category', 'category', { unique: false });
            store.createIndex('hostname', 'hostname', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      this._initialized = true;

      // Flush buffer
      for (const entry of this._buffer) {
        await this._write(entry);
      }
      this._buffer = [];

      // Auto-cleanup on init
      this._cleanup().catch(() => {});
      console.log('[CobraAudit] Initialized — IndexedDB ready');
    } catch (e) {
      console.error('[CobraAudit] Init failed:', e);
    }
  },

  // ══════════════════════════════════════════════════════
  // LOG — registra un'azione
  // ══════════════════════════════════════════════════════
  /**
   * @param {Object} opts
   * @param {string} opts.action - Nome azione (es. 'CHAT_MESSAGE', 'click_element', 'send_whatsapp')
   * @param {string} opts.category - Categoria: 'chat' | 'tool' | 'comms' | 'policy' | 'guard' | 'system' | 'job' | 'kb'
   * @param {string} [opts.hostname] - Hostname del tab corrente
   * @param {string} [opts.result] - 'ok' | 'fail' | 'blocked' | 'aborted'
   * @param {Object} [opts.details] - Dettagli aggiuntivi (troncati a 500 chars)
   * @param {number} [opts.durationMs] - Durata esecuzione in ms
   */
  log(opts) {
    const entry = {
      ts: Date.now(),
      action: opts.action || 'unknown',
      category: opts.category || 'system',
      hostname: opts.hostname || '',
      result: opts.result || 'ok',
      details: this._truncate(opts.details),
      durationMs: opts.durationMs || 0,
      date: new Date().toISOString()
    };

    if (!this._initialized) {
      this._buffer.push(entry);
      return;
    }
    this._write(entry).catch(() => {});
  },

  // Shorthand helpers
  logChat(action, result, details) {
    this.log({ action, category: 'chat', result, details });
  },
  logTool(action, hostname, result, durationMs, details) {
    this.log({ action, category: 'tool', hostname, result, durationMs, details });
  },
  logComms(action, result, details) {
    this.log({ action, category: 'comms', result, details });
  },
  logPolicy(action, hostname, result, details) {
    this.log({ action, category: 'policy', hostname, result, details });
  },
  logGuard(action, hostname, result, details) {
    this.log({ action, category: 'guard', hostname, result, details });
  },
  logSystem(action, details) {
    this.log({ action, category: 'system', result: 'ok', details });
  },

  // ══════════════════════════════════════════════════════
  // QUERY — cerca entries
  // ══════════════════════════════════════════════════════
  /**
   * @param {Object} [filter]
   * @param {string} [filter.category]
   * @param {string} [filter.action]
   * @param {string} [filter.hostname]
   * @param {string} [filter.result]
   * @param {number} [filter.since] - timestamp minimo
   * @param {number} [filter.limit=100]
   * @returns {Promise<Array>}
   */
  async query(filter = {}) {
    if (!this._db) return this._buffer.slice(-100);
    const limit = filter.limit || 100;

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(this._STORE, 'readonly');
      const store = tx.objectStore(this._STORE);
      const idx = store.index('ts');
      const results = [];

      const range = filter.since ? IDBKeyRange.lowerBound(filter.since) : null;
      const req = idx.openCursor(range, 'prev'); // newest first

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || results.length >= limit) {
          resolve(results);
          return;
        }
        const entry = cursor.value;
        let match = true;
        if (filter.category && entry.category !== filter.category) match = false;
        if (filter.action && entry.action !== filter.action) match = false;
        if (filter.hostname && entry.hostname !== filter.hostname) match = false;
        if (filter.result && entry.result !== filter.result) match = false;

        if (match) results.push(entry);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  // ══════════════════════════════════════════════════════
  // STATS — statistiche aggregate
  // ══════════════════════════════════════════════════════
  async getStats() {
    const now = Date.now();
    const last24h = now - 86400000;
    const last1h = now - 3600000;

    const all = await this.query({ limit: 10000 });
    const h24 = all.filter(e => e.ts >= last24h);
    const h1 = all.filter(e => e.ts >= last1h);

    const byCategory = {};
    const byResult = { ok: 0, fail: 0, blocked: 0, aborted: 0 };
    const topActions = {};

    for (const e of h24) {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
      if (byResult[e.result] !== undefined) byResult[e.result]++;
      topActions[e.action] = (topActions[e.action] || 0) + 1;
    }

    // Top 10 actions
    const sortedActions = Object.entries(topActions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([action, count]) => ({ action, count }));

    return {
      total: all.length,
      last24h: h24.length,
      last1h: h1.length,
      byCategory,
      byResult,
      topActions: sortedActions,
      oldestEntry: all.length > 0 ? all[all.length - 1].date : null,
      newestEntry: all.length > 0 ? all[0].date : null
    };
  },

  // ══════════════════════════════════════════════════════
  // EXPORT — esporta log come JSON
  // ══════════════════════════════════════════════════════
  async export(filter = {}) {
    const entries = await this.query({ ...filter, limit: 10000 });
    return {
      exportedAt: new Date().toISOString(),
      version: '5.2',
      count: entries.length,
      entries
    };
  },

  // ══════════════════════════════════════════════════════
  // CLEANUP — rimuovi entries vecchie
  // ══════════════════════════════════════════════════════
  async _cleanup() {
    if (!this._db) return;
    const cutoff = Date.now() - this._RETENTION_MS;

    const tx = this._db.transaction(this._STORE, 'readwrite');
    const store = tx.objectStore(this._STORE);
    const idx = store.index('ts');
    const range = IDBKeyRange.upperBound(cutoff);

    let deleted = 0;
    return new Promise((resolve) => {
      const req = idx.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          if (deleted > 0) console.log(`[CobraAudit] Cleanup: rimossi ${deleted} entries > 7 giorni`);
          resolve(deleted);
        }
      };
      req.onerror = () => resolve(0);
    });
  },

  // ══════════════════════════════════════════════════════
  // INTERNAL
  // ══════════════════════════════════════════════════════
  async _write(entry) {
    if (!this._db) return;
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(this._STORE, 'readwrite');
      const store = tx.objectStore(this._STORE);
      store.add(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  _truncate(obj) {
    if (!obj) return null;
    try {
      const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
      return str.length > 500 ? str.substring(0, 500) + '...' : str;
    } catch {
      return String(obj).substring(0, 500);
    }
  }
};

self.CobraAudit = CobraAudit;
console.log('[cobra-audit.js] Loaded: Audit Log (IndexedDB, 7d retention)');
