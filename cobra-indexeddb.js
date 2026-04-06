/**
 * COBRA v5.2 — IndexedDB Storage Adapter
 * Replaces chrome.storage.local for heavy data: KB rules, conversations, audit log.
 * Falls back to chrome.storage.local on failure.
 */

const COBRA_DB_NAME = 'cobra_db';
const COBRA_DB_VERSION = 2; // v2: adds jobs, job_runs, selector_stats

class CobraIndexedDB {
  constructor() {
    this._db = null;
    this._initPromise = null;
  }

  // Lazy init — opens/creates DB on first use
  async init() {
    if (this._db) return this._db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(COBRA_DB_NAME, COBRA_DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // KB rules store — indexed by domain and category
          if (!db.objectStoreNames.contains('kb_rules')) {
            const kbStore = db.createObjectStore('kb_rules', { keyPath: 'id' });
            kbStore.createIndex('domain', 'domain', { unique: false });
            kbStore.createIndex('category', ['metadata.category'], { unique: false });
            kbStore.createIndex('isActive', 'isActive', { unique: false });
          }

          // Conversations store
          if (!db.objectStoreNames.contains('conversations')) {
            const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
            convStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          }

          // Tool scores store
          if (!db.objectStoreNames.contains('tool_scores')) {
            db.createObjectStore('tool_scores', { keyPath: 'key' });
          }

          // Audit log store — auto-increment ID, indexed by timestamp
          if (!db.objectStoreNames.contains('audit_log')) {
            const auditStore = db.createObjectStore('audit_log', { keyPath: 'id', autoIncrement: true });
            auditStore.createIndex('timestamp', 'timestamp', { unique: false });
            auditStore.createIndex('tool', 'tool', { unique: false });
          }

          // ── v2 stores ──

          // Jobs store — persistent job definitions
          if (!db.objectStoreNames.contains('jobs')) {
            const jobStore = db.createObjectStore('jobs', { keyPath: 'id' });
            jobStore.createIndex('name', 'name', { unique: false });
            jobStore.createIndex('createdAt', 'createdAt', { unique: false });
          }

          // Job runs store — execution history
          if (!db.objectStoreNames.contains('job_runs')) {
            const runStore = db.createObjectStore('job_runs', { keyPath: 'id' });
            runStore.createIndex('jobId', 'jobId', { unique: false });
            runStore.createIndex('state', 'state', { unique: false });
            runStore.createIndex('startedAt', 'startedAt', { unique: false });
          }

          // Selector stats store — per-domain selector performance
          if (!db.objectStoreNames.contains('selector_stats')) {
            const selStore = db.createObjectStore('selector_stats', { keyPath: 'id' });
            selStore.createIndex('domain', 'domain', { unique: false });
            selStore.createIndex('score', 'score', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this._db = event.target.result;
          console.log('[CobraIndexedDB] Database opened successfully');
          resolve(this._db);
        };

        request.onerror = (event) => {
          console.error('[CobraIndexedDB] Failed to open database:', event.target.error);
          this._initPromise = null;
          reject(event.target.error);
        };
      } catch (e) {
        console.error('[CobraIndexedDB] IndexedDB not available:', e);
        this._initPromise = null;
        reject(e);
      }
    });

    return this._initPromise;
  }

  // Generic put (upsert) into a store
  async put(storeName, data) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Generic get by key
  async get(storeName, key) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  // Get all records from a store
  async getAll(storeName) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // Get all by index value
  async getAllByIndex(storeName, indexName, value) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // Delete by key
  async delete(storeName, key) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // Bulk put — write many records in a single transaction
  async bulkPut(storeName, records) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let count = 0;
      for (const record of records) {
        const req = store.put(record);
        req.onsuccess = () => { count++; };
      }
      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Clear a store
  async clear(storeName) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // Count records in a store
  async count(storeName) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Append to audit log (auto-prune to last 500 entries)
  async appendAuditLog(entry) {
    entry.timestamp = entry.timestamp || new Date().toISOString();
    await this.put('audit_log', entry);

    // Prune old entries if > 500
    const total = await this.count('audit_log');
    if (total > 500) {
      const db = await this.init();
      const tx = db.transaction('audit_log', 'readwrite');
      const store = tx.objectStore('audit_log');
      const index = store.index('timestamp');
      const deleteCount = total - 500;
      let deleted = 0;

      const cursorReq = index.openCursor();
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && deleted < deleteCount) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };
    }
  }
}

// Export
self.CobraIndexedDB = CobraIndexedDB;
console.log('[cobra-indexeddb.js] Loaded: CobraIndexedDB class');
