/**
 * COBRA v5.2 — Persistence Manager
 * Centralized storage layer. All modules should save through this instead of
 * calling chrome.storage.local directly.
 *
 * Namespaces: cobra_kb, cobra_gate_sessions, cobra_conversations, cobra_settings,
 *             cobra_tasks, cobra_memories, cobra_files, cobra_tool_scores
 */

class PersistenceManager {
  constructor() {
    this._pendingTimers = {};  // namespace -> timer
    this._locks = {};          // namespace -> boolean
    this._cache = {};          // namespace -> last known value (write-through cache)
  }

  // Load data for a namespace
  async load(namespace) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(namespace, (result) => {
        if (chrome.runtime?.lastError) {
          console.error(`[PersistenceManager] load(${namespace}) error:`, chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        const data = result[namespace];
        this._cache[namespace] = data;
        resolve(data);
      });
    });
  }

  // Save data for a namespace (with lock)
  async save(namespace, data) {
    return this._withLock(namespace, async () => {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [namespace]: data }, () => {
          if (chrome.runtime?.lastError) {
            console.error(`[PersistenceManager] save(${namespace}) error:`, chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }
          this._cache[namespace] = data;
          resolve(true);
        });
      });
    });
  }

  // Debounced save — coalesces rapid writes
  debouncedSave(namespace, data, delay = 500) {
    if (this._pendingTimers[namespace]) {
      clearTimeout(this._pendingTimers[namespace]);
    }
    this._cache[namespace] = data; // update cache immediately
    this._pendingTimers[namespace] = setTimeout(async () => {
      try {
        await this.save(namespace, data);
      } catch (e) {
        console.error(`[PersistenceManager] debouncedSave(${namespace}) failed:`, e);
        // One retry
        try { await this.save(namespace, data); } catch {}
      }
      delete this._pendingTimers[namespace];
    }, delay);
  }

  // Read-modify-write pattern
  async update(namespace, updaterFn) {
    const current = await this.load(namespace);
    const next = await updaterFn(current);
    await this.save(namespace, next);
    return next;
  }

  // Remove a namespace
  async remove(namespace) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(namespace, () => {
        if (chrome.runtime?.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        delete this._cache[namespace];
        resolve(true);
      });
    });
  }

  // Save multiple namespaces at once
  async batchSave(entries) {
    // entries = [{ namespace, data }, ...]
    const obj = {};
    for (const { namespace, data } of entries) {
      obj[namespace] = data;
      this._cache[namespace] = data;
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime?.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(true);
      });
    });
  }

  // Get cached value (no async, returns last known value)
  getCached(namespace) {
    return this._cache[namespace];
  }

  // Simple lock: wait until namespace is free, then execute
  async _withLock(namespace, fn) {
    let waitCount = 0;
    while (this._locks[namespace]) {
      await new Promise(r => setTimeout(r, 25));
      waitCount++;
      if (waitCount > 200) { // 5 second timeout
        console.warn(`[PersistenceManager] Lock timeout on ${namespace}, forcing through`);
        break;
      }
    }
    this._locks[namespace] = true;
    try {
      return await fn();
    } finally {
      delete this._locks[namespace];
    }
  }

  // Flush all pending debounced saves immediately
  async flushAll() {
    const promises = [];
    for (const [namespace, timer] of Object.entries(this._pendingTimers)) {
      clearTimeout(timer);
      if (this._cache[namespace] !== undefined) {
        promises.push(this.save(namespace, this._cache[namespace]));
      }
      delete this._pendingTimers[namespace];
    }
    await Promise.allSettled(promises);
  }
}

// Export
self.PersistenceManager = PersistenceManager;
console.log('[persistence-manager.js] Loaded: PersistenceManager class');
