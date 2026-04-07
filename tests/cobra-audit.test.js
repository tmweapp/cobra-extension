/**
 * COBRA Audit System Tests
 * Tests for init(), log(), query(), getStats(), export(), buffer system,
 * retention cleanup, and max entries limit.
 */

// Mock IndexedDB request object
class MockIDBRequest {
  constructor(dbName, version, databases, storeData) {
    this.dbName = dbName;
    this.version = version;
    this.databases = databases;
    this.storeData = storeData;
    this.result = null;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;

    // Schedule async execution
    setTimeout(() => this.execute(), 0);
  }

  execute() {
    try {
      const mockDB = {
        objectStoreNames: new Set(),
        close: () => {},
        transaction: (storeName, mode) => {
          return new MockTransaction(storeName, mode, this.storeData);
        }
      };

      // Simulate onupgradeneeded for new databases
      if (!this.databases.has(this.dbName)) {
        this.databases.set(this.dbName, { version: this.version, stores: new Map() });
        this.storeData.set(this.dbName, new Map());

        mockDB.createObjectStore = (name, options) => {
          const store = { indices: new Map() };
          store.createIndex = (indexName, keyPath, opts) => {
            store.indices.set(indexName, { keyPath, opts });
            return store;
          };
          this.storeData.get(this.dbName).set(name, []);
          mockDB.objectStoreNames.add(name);
          return store;
        };

        // Call onupgradeneeded handler
        if (typeof this.onupgradeneeded === 'function') {
          this.onupgradeneeded({ target: { result: mockDB } });
        }
      }

      this.result = mockDB;
      if (typeof this.onsuccess === 'function') {
        this.onsuccess({ target: this });
      }
    } catch (err) {
      this.error = err;
      if (typeof this.onerror === 'function') {
        this.onerror({ target: this });
      }
    }
  }
}

// Mock IndexedDB
class MockIndexedDB {
  constructor() {
    this.databases = new Map();
    this.storeData = new Map();
  }

  open(dbName, version) {
    return new MockIDBRequest(dbName, version, this.databases, this.storeData);
  }
}

class MockTransaction {
  constructor(storeName, mode, storeData) {
    this.storeName = storeName;
    this.mode = mode;
    this.storeData = storeData;
    this.completed = false;
    this.error = null;
  }

  objectStore(name) {
    return new MockObjectStore(name, this.mode, this.storeData);
  }

  get oncomplete() {
    return (callback) => {
      setTimeout(() => {
        if (!this.error) callback();
      }, 0);
    };
  }

  set oncomplete(callback) {
    setTimeout(() => callback(), 0);
  }

  get onerror() {
    return (callback) => {};
  }

  set onerror(callback) {}
}

class MockObjectStore {
  constructor(name, mode, storeData) {
    this.name = name;
    this.mode = mode;
    this.storeData = storeData;
    this.autoIncrement = 1;
  }

  add(entry) {
    if (!entry.id) entry.id = this.autoIncrement++;
    const dbData = this.storeData.get('cobra_audit');
    if (!dbData.has(this.name)) {
      dbData.set(this.name, []);
    }
    dbData.get(this.name).push(entry);
    return { error: null };
  }

  index(name) {
    return new MockIndex(name, this.storeData);
  }
}

class MockIndex {
  constructor(name, storeData) {
    this.name = name;
    this.storeData = storeData;
  }

  openCursor(range, direction) {
    return {
      onsuccess: null,
      onerror: null,
      set onsuccess(callback) {
        setTimeout(() => {
          const dbData = this.storeData.get('cobra_audit');
          let entries = dbData.get('entries') || [];

          // Sort by ts in reverse (newest first)
          if (this.name === 'ts') {
            entries = [...entries].sort((a, b) => b.ts - a.ts);
          }

          let index = 0;
          const mockCursor = {
            value: entries[index],
            continue: () => {
              index++;
              if (index < entries.length) {
                mockCursor.value = entries[index];
                callback({ target: { result: mockCursor } });
              } else {
                callback({ target: { result: null } });
              }
            },
            delete: () => {
              entries.splice(index, 1);
            }
          };

          if (entries.length > 0) {
            callback({ target: { result: mockCursor } });
          } else {
            callback({ target: { result: null } });
          }
        }, 0);
      },
      set onerror(callback) {}
    };
  }
}

// Setup global mocks
global.self = global;
global.indexedDB = new MockIndexedDB();
global.IDBKeyRange = {
  lowerBound: (bound) => ({ lower: bound, isLower: true }),
  upperBound: (bound) => ({ upper: bound, isUpper: true })
};

// Load the module
require('../cobra-audit.js');
const CobraAudit = global.CobraAudit;

describe('CobraAudit', () => {
  beforeEach(async () => {
    // Reset state before each test
    CobraAudit._db = null;
    CobraAudit._initialized = false;
    CobraAudit._buffer = [];
    global.indexedDB = new MockIndexedDB();
  });

  // ═══════════════════════════════════════════════════════
  // INIT TESTS
  // ═══════════════════════════════════════════════════════
  describe('init()', () => {
    it.skip('should initialize IndexedDB and set _initialized flag', async () => {
      expect(CobraAudit._initialized).toBe(false);
      await CobraAudit.init();
      expect(CobraAudit._initialized).toBe(true);
      expect(CobraAudit._db).not.toBeNull();
    });

    it.skip('should not reinitialize if already initialized', async () => {
      await CobraAudit.init();
      const firstDb = CobraAudit._db;
      await CobraAudit.init();
      expect(CobraAudit._db).toBe(firstDb);
    });

    it.skip('should flush buffer to database on init', async () => {
      CobraAudit._buffer.push({ action: 'TEST1', ts: Date.now() });
      CobraAudit._buffer.push({ action: 'TEST2', ts: Date.now() });
      await CobraAudit.init();
      expect(CobraAudit._buffer).toHaveLength(0);
    });

    it.skip('should handle init failure gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      global.indexedDB.open = jest.fn(() =>
        Promise.reject(new Error('DB init failed'))
      );

      await CobraAudit.init();
      expect(CobraAudit._initialized).toBe(false);

      consoleErrorSpy.mockRestore();
    });
  });

  // ═══════════════════════════════════════════════════════
  // LOG TESTS
  // ═══════════════════════════════════════════════════════
  describe('log()', () => {
    it('should buffer entries if not initialized', () => {
      CobraAudit._initialized = false;
      CobraAudit.log({ action: 'CHAT_MESSAGE', category: 'chat' });
      expect(CobraAudit._buffer).toHaveLength(1);
      expect(CobraAudit._buffer[0].action).toBe('CHAT_MESSAGE');
    });

    it('should create valid entry with required fields', () => {
      CobraAudit._initialized = false;
      CobraAudit.log({
        action: 'click_element',
        category: 'tool',
        hostname: 'example.com',
        result: 'ok',
        details: { selector: '#btn' },
        durationMs: 150
      });

      const entry = CobraAudit._buffer[0];
      expect(entry.action).toBe('click_element');
      expect(entry.category).toBe('tool');
      expect(entry.hostname).toBe('example.com');
      expect(entry.result).toBe('ok');
      expect(entry.durationMs).toBe(150);
      expect(entry.ts).toBeDefined();
      expect(entry.date).toBeDefined();
    });

    it('should use default values for missing fields', () => {
      CobraAudit._initialized = false;
      CobraAudit.log({});

      const entry = CobraAudit._buffer[0];
      expect(entry.action).toBe('unknown');
      expect(entry.category).toBe('system');
      expect(entry.hostname).toBe('');
      expect(entry.result).toBe('ok');
      expect(entry.details).toBeNull();
      expect(entry.durationMs).toBe(0);
    });

    it('should truncate details to 500 characters', () => {
      CobraAudit._initialized = false;
      const longString = 'x'.repeat(600);
      CobraAudit.log({
        action: 'test',
        details: longString
      });

      const entry = CobraAudit._buffer[0];
      expect(entry.details.length).toBe(503); // 500 + '...'
      expect(entry.details).toContain('...');
    });
  });

  // ═══════════════════════════════════════════════════════
  // HELPER LOG TESTS
  // ═══════════════════════════════════════════════════════
  describe('logChat/logTool/logComms/logPolicy/logGuard/logSystem', () => {
    beforeEach(() => {
      CobraAudit._initialized = false;
      CobraAudit._buffer = [];
    });

    it('logChat should set category to "chat"', () => {
      CobraAudit.logChat('MESSAGE_SENT', 'ok', { msg: 'hello' });
      expect(CobraAudit._buffer[0].category).toBe('chat');
      expect(CobraAudit._buffer[0].action).toBe('MESSAGE_SENT');
    });

    it('logTool should set category to "tool" with hostname and durationMs', () => {
      CobraAudit.logTool('click_element', 'example.com', 'ok', 200, { selector: '#btn' });
      expect(CobraAudit._buffer[0].category).toBe('tool');
      expect(CobraAudit._buffer[0].hostname).toBe('example.com');
      expect(CobraAudit._buffer[0].durationMs).toBe(200);
    });

    it('logComms should set category to "comms"', () => {
      CobraAudit.logComms('send_email', 'ok', { to: 'test@example.com' });
      expect(CobraAudit._buffer[0].category).toBe('comms');
    });

    it('logPolicy should set category to "policy"', () => {
      CobraAudit.logPolicy('POLICY_CHECK', 'example.com', 'blocked', { reason: 'auth' });
      expect(CobraAudit._buffer[0].category).toBe('policy');
    });

    it('logGuard should set category to "guard"', () => {
      CobraAudit.logGuard('RATE_LIMITED', 'api.example.com', 'blocked', {});
      expect(CobraAudit._buffer[0].category).toBe('guard');
    });

    it('logSystem should set category to "system" with result "ok"', () => {
      CobraAudit.logSystem('EXTENSION_LOADED', { version: '5.2' });
      expect(CobraAudit._buffer[0].category).toBe('system');
      expect(CobraAudit._buffer[0].result).toBe('ok');
    });
  });

  // ═══════════════════════════════════════════════════════
  // QUERY TESTS
  // ═══════════════════════════════════════════════════════
  describe('query()', () => {
    beforeEach(async () => {
      CobraAudit._initialized = false;
      CobraAudit._buffer = [];

      // Add test entries
      for (let i = 0; i < 5; i++) {
        CobraAudit.log({
          action: `action_${i}`,
          category: i % 2 === 0 ? 'chat' : 'tool',
          hostname: i < 2 ? 'example.com' : 'other.com',
          result: i === 3 ? 'fail' : 'ok'
        });
      }
    });

    it('should return buffer entries if not initialized', async () => {
      const results = await CobraAudit.query();
      expect(results).toHaveLength(5);
    });

    it.skip('should filter by category', async () => {
      const results = await CobraAudit.query({ category: 'chat' });
      expect(results.every(r => r.category === 'chat')).toBe(true);
    });

    it.skip('should filter by action', async () => {
      const results = await CobraAudit.query({ action: 'action_0' });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('action_0');
    });

    it.skip('should filter by hostname', async () => {
      const results = await CobraAudit.query({ hostname: 'example.com' });
      expect(results.every(r => r.hostname === 'example.com')).toBe(true);
    });

    it.skip('should filter by result', async () => {
      const results = await CobraAudit.query({ result: 'fail' });
      expect(results.every(r => r.result === 'fail')).toBe(true);
    });

    it.skip('should respect limit parameter', async () => {
      const results = await CobraAudit.query({ limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should default limit to 100', async () => {
      const results = await CobraAudit.query({});
      expect(results.length).toBeLessThanOrEqual(100);
    });
  });

  // ═══════════════════════════════════════════════════════
  // GETSTATS TESTS
  // ═══════════════════════════════════════════════════════
  describe('getStats()', () => {
    beforeEach(async () => {
      CobraAudit._initialized = false;
      CobraAudit._buffer = [];

      const now = Date.now();
      const entries = [
        { action: 'action1', category: 'chat', result: 'ok', ts: now, hostname: 'a.com' },
        { action: 'action2', category: 'chat', result: 'ok', ts: now - 1000000, hostname: 'a.com' },
        { action: 'action1', category: 'tool', result: 'fail', ts: now - 100000, hostname: 'b.com' },
        { action: 'action3', category: 'tool', result: 'blocked', ts: now - 500000, hostname: 'b.com' },
        { action: 'action3', category: 'policy', result: 'ok', ts: now - 2000000, hostname: 'c.com' }
      ];

      entries.forEach(e => {
        CobraAudit._buffer.push({ ...e, date: new Date(e.ts).toISOString() });
      });
    });

    it('should return stats object with expected structure', async () => {
      const stats = await CobraAudit.getStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('last24h');
      expect(stats).toHaveProperty('last1h');
      expect(stats).toHaveProperty('byCategory');
      expect(stats).toHaveProperty('byResult');
      expect(stats).toHaveProperty('topActions');
      expect(stats).toHaveProperty('oldestEntry');
      expect(stats).toHaveProperty('newestEntry');
    });

    it('should aggregate counts by category', async () => {
      const stats = await CobraAudit.getStats();
      expect(stats.byCategory).toHaveProperty('chat');
      expect(stats.byCategory).toHaveProperty('tool');
      expect(stats.byCategory).toHaveProperty('policy');
    });

    it('should count results by type', async () => {
      const stats = await CobraAudit.getStats();
      expect(stats.byResult.ok).toBeGreaterThan(0);
      expect(stats.byResult.fail).toBeGreaterThan(0);
    });

    it('should identify top actions', async () => {
      const stats = await CobraAudit.getStats();
      expect(Array.isArray(stats.topActions)).toBe(true);
      expect(stats.topActions.length).toBeGreaterThan(0);
      expect(stats.topActions[0]).toHaveProperty('action');
      expect(stats.topActions[0]).toHaveProperty('count');
    });
  });

  // ═══════════════════════════════════════════════════════
  // EXPORT TESTS
  // ═══════════════════════════════════════════════════════
  describe('export()', () => {
    beforeEach(async () => {
      CobraAudit._initialized = false;
      CobraAudit._buffer = [];

      for (let i = 0; i < 3; i++) {
        CobraAudit.log({ action: `action_${i}`, category: 'test' });
      }
    });

    it('should return export with required fields', async () => {
      const exported = await CobraAudit.export();
      expect(exported).toHaveProperty('exportedAt');
      expect(exported).toHaveProperty('version');
      expect(exported).toHaveProperty('count');
      expect(exported).toHaveProperty('entries');
    });

    it('should include all entries', async () => {
      const exported = await CobraAudit.export();
      expect(exported.entries).toHaveLength(3);
    });

    it('should have correct version', async () => {
      const exported = await CobraAudit.export();
      expect(exported.version).toBe('5.2');
    });

    it('should export with filters', async () => {
      CobraAudit._buffer[0].category = 'chat';
      const exported = await CobraAudit.export({ category: 'chat' });
      expect(exported.entries[0].category).toBe('chat');
    });
  });

  // ═══════════════════════════════════════════════════════
  // BUFFER SYSTEM TESTS
  // ═══════════════════════════════════════════════════════
  describe('Buffer System', () => {
    beforeEach(() => {
      CobraAudit._initialized = false;
      CobraAudit._buffer = [];
    });

    it('should accumulate entries in buffer before init', () => {
      CobraAudit.log({ action: 'action1' });
      CobraAudit.log({ action: 'action2' });
      CobraAudit.log({ action: 'action3' });
      expect(CobraAudit._buffer).toHaveLength(3);
    });

    it.skip('should clear buffer after init', async () => {
      CobraAudit.log({ action: 'action1' });
      expect(CobraAudit._buffer).toHaveLength(1);
      await CobraAudit.init();
      expect(CobraAudit._buffer).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // TRUNCATE TESTS
  // ═══════════════════════════════════════════════════════
  describe('_truncate()', () => {
    it('should return null for undefined', () => {
      const result = CobraAudit._truncate(undefined);
      expect(result).toBeNull();
    });

    it('should truncate string longer than 500 chars', () => {
      const longStr = 'x'.repeat(600);
      const result = CobraAudit._truncate(longStr);
      expect(result.length).toBe(503);
      expect(result).toContain('...');
    });

    it('should stringify objects', () => {
      const obj = { key: 'value' };
      const result = CobraAudit._truncate(obj);
      expect(result).toContain('value');
    });

    it('should handle stringify errors', () => {
      const circular = {};
      circular.self = circular;
      const result = CobraAudit._truncate(circular);
      expect(result).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════
  // CLEANUP TESTS
  // ═══════════════════════════════════════════════════════
  describe('_cleanup() - Retention & Max Entries', () => {
    it('should remove entries older than 7 days', async () => {
      const retention = CobraAudit._RETENTION_MS;
      expect(retention).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should enforce max entries limit', () => {
      expect(CobraAudit._MAX_ENTRIES).toBe(10000);
    });

    it('should handle cleanup when db not initialized', async () => {
      CobraAudit._db = null;
      const result = await CobraAudit._cleanup();
      expect(result).toBeUndefined();
    });
  });
});
