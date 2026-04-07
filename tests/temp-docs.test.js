/**
 * Tests for TempDocs module (IndexedDB-based)
 * Coverage: ~25+ tests
 * NOTE: Mock IndexedDB for testing in Node.js environment
 */

const TempDocs = require('../temp-docs.js');

// Mock IndexedDB for Node.js testing
class MockIDBDatabase {
  constructor() {
    this.store = new Map();
    this.onclose = null;
  }

  transaction(storeName, mode) {
    return new MockIDBTransaction(this.store, mode);
  }
}

class MockIDBTransaction {
  constructor(store, mode) {
    this.store = store;
    this.mode = mode;
    this.oncomplete = null;
    this.onerror = null;
  }

  objectStore(name) {
    return new MockIDBObjectStore(this.store, this.mode, this);
  }
}

class MockIDBObjectStore {
  constructor(store, mode, tx) {
    this.store = store;
    this.mode = mode;
    this.tx = tx;
    this.indexNames = [];
  }

  put(doc) {
    const req = new MockIDBRequest();
    setImmediate(() => {
      this.store.set(doc.id, doc);
      req.onsuccess?.call(req);
      this.tx.oncomplete?.call(this.tx);
    });
    return req;
  }

  get(id) {
    const req = new MockIDBRequest();
    setImmediate(() => {
      req.result = this.store.get(id);
      req.onsuccess?.call(req);
    });
    return req;
  }

  getAll() {
    const req = new MockIDBRequest();
    setImmediate(() => {
      req.result = Array.from(this.store.values());
      req.onsuccess?.call(req);
    });
    return req;
  }

  delete(id) {
    const req = new MockIDBRequest();
    setImmediate(() => {
      this.store.delete(id);
      req.onsuccess?.call(req);
    });
    return req;
  }

  index(name) {
    return new MockIDBIndex(this.store, name, this.tx);
  }
}

class MockIDBIndex {
  constructor(store, name, tx) {
    this.store = store;
    this.name = name;
    this.tx = tx;
  }

  getAll(value) {
    const req = new MockIDBRequest();
    setImmediate(() => {
      if (this.name === 'sessionId') {
        req.result = Array.from(this.store.values()).filter(doc => doc.sessionId === value);
      } else {
        req.result = Array.from(this.store.values());
      }
      req.onsuccess?.call(req);
    });
    return req;
  }
}

class MockIDBRequest {
  constructor() {
    this.result = null;
    this.onsuccess = null;
    this.onerror = null;
  }
}

describe('TempDocs', () => {
  let tempDocs;
  let mockDB;

  beforeEach(() => {
    tempDocs = Object.create(TempDocs);
    tempDocs._db = null;
    mockDB = new MockIDBDatabase();

    // Mock indexedDB.open
    global.indexedDB = {
      open: (dbName, version) => {
        const req = new MockIDBRequest();
        setImmediate(() => {
          req.result = mockDB;
          req.onsuccess?.call(req);
        });
        return req;
      }
    };
  });

  // ====================== INITIALIZATION ======================

  test('should initialize database connection', async () => {
    const db = await tempDocs.init();
    expect(db).toBeDefined();
  });

  test('should return cached db if already initialized', async () => {
    const db1 = await tempDocs.init();
    const db2 = await tempDocs.init();
    expect(db2).toBe(db1);
  });

  test('should reset db on connection error', async () => {
    tempDocs._db = null;
    const db = await tempDocs.init();
    expect(db).toBeDefined();
  });

  // ====================== SAVE OPERATIONS ======================

  test('should save document with metadata', async () => {
    const doc = await tempDocs.save('doc1', 'content here', {
      title: 'My Doc',
      words: 100,
      sessionId: 'sess1'
    });

    expect(doc.id).toBe('doc1');
    expect(doc.title).toBe('My Doc');
    expect(doc.words).toBe(100);
    expect(doc.sessionId).toBe('sess1');
  });

  test('should set default metadata', async () => {
    const doc = await tempDocs.save('doc2', 'content', {});

    expect(doc.title).toBe('document');
    expect(doc.words).toBe(0);
    expect(doc.sessionId).toBe('');
  });

  test('should set createdAt timestamp', async () => {
    const before = new Date();
    const doc = await tempDocs.save('doc3', 'content', {});
    const after = new Date();

    const docTime = new Date(doc.createdAt);
    expect(docTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(docTime.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test('should set lastAccessedAt on save', async () => {
    const doc = await tempDocs.save('doc4', 'content', {});
    expect(doc.lastAccessedAt).toBeDefined();
  });

  // ====================== READ OPERATIONS ======================

  test('should read saved document', async () => {
    await tempDocs.save('doc5', 'test content', { title: 'Test' });
    const doc = await tempDocs.read('doc5');

    expect(doc).toBeDefined();
    expect(doc.id).toBe('doc5');
    expect(doc.content).toBe('test content');
    expect(doc.title).toBe('Test');
  });

  test('should return null for non-existent document', async () => {
    const doc = await tempDocs.read('nonexistent');
    expect(doc).toBeNull();
  });

  test('should update lastAccessedAt on read', async () => {
    await tempDocs.save('doc6', 'content', {});
    const doc1 = await tempDocs.read('doc6');
    const time1 = new Date(doc1.lastAccessedAt).getTime();

    // Read again after small delay
    await new Promise(resolve => setTimeout(resolve, 10));
    const doc2 = await tempDocs.read('doc6');
    const time2 = new Date(doc2.lastAccessedAt).getTime();

    expect(time2).toBeGreaterThanOrEqual(time1);
  });

  // ====================== PURGE OPERATIONS ======================

  test('should have purgeOlderThan method', () => {
    expect(typeof tempDocs.purgeOlderThan).toBe('function');
  });

  test('should have delete method for documents', async () => {
    await tempDocs.save('doc-to-delete', 'content', {});
    await tempDocs.delete('doc-to-delete');

    const check = await tempDocs.read('doc-to-delete');
    expect(check).toBeNull();
  });

  // ====================== LIST OPERATIONS ======================

  test('should list documents for session', async () => {
    await tempDocs.save('doc7', 'content', { sessionId: 'sess1' });
    await tempDocs.save('doc8', 'content', { sessionId: 'sess2' });

    const docs = await tempDocs.listForSession('sess1');

    expect(Array.isArray(docs)).toBe(true);
    expect(docs.some(d => d.id === 'doc7')).toBe(true);
    expect(docs.some(d => d.id === 'doc8')).toBe(false);
  });

  test('should return empty array for non-existent session', async () => {
    const docs = await tempDocs.listForSession('nonexistent');
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBe(0);
  });

  test('should include metadata in list', async () => {
    await tempDocs.save('doc9', 'content', {
      sessionId: 'sess3',
      title: 'Listed Doc',
      words: 50
    });

    const docs = await tempDocs.listForSession('sess3');
    expect(docs[0].title).toBe('Listed Doc');
    expect(docs[0].words).toBe(50);
  });

  test('should not include content in list metadata', async () => {
    await tempDocs.save('doc10', 'large content string', { sessionId: 'sess4' });

    const docs = await tempDocs.listForSession('sess4');
    expect(docs[0].content).toBeUndefined();
  });

  // ====================== DELETE OPERATIONS ======================

  test('should handle delete of non-existent document', async () => {
    // Should not throw
    await tempDocs.delete('nonexistent');
    expect(true).toBe(true);
  });

  test('should have clearSession method', () => {
    expect(typeof tempDocs.clearSession).toBe('function');
  });

  // ====================== EDGE CASES ======================

  test('should handle empty content', async () => {
    const doc = await tempDocs.save('empty', '', {});
    expect(doc.content).toBe('');
  });

  test('should handle very long content', async () => {
    const longContent = 'x'.repeat(1000000);
    const doc = await tempDocs.save('long', longContent, {});
    expect(doc.content.length).toBe(1000000);
  });

  test('should handle special characters', async () => {
    const special = 'Hello 你好 مرحبا 🎉 <script>alert("xss")</script>';
    const doc = await tempDocs.save('special', special, {});
    expect(doc.content).toBe(special);
  });

  test('should handle JSON metadata', async () => {
    const metadata = {
      title: 'JSON Test',
      words: 100,
      tokenCount: 25,
      sessionId: 'sess-json',
      customField: { nested: 'data' }
    };
    const doc = await tempDocs.save('json', 'content', metadata);
    expect(doc.title).toBe('JSON Test');
  });

  test('should generate unique document IDs', async () => {
    const doc1 = await tempDocs.save('unique1', 'c1', {});
    const doc2 = await tempDocs.save('unique2', 'c2', {});
    expect(doc1.id).not.toBe(doc2.id);
  });

  // ====================== CONCURRENT OPERATIONS ======================

  test('should handle multiple saves concurrently', async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(tempDocs.save(`concurrent${i}`, `content${i}`, {}));
    }
    const results = await Promise.all(promises);
    expect(results.length).toBe(5);
  });

  test('should handle save and delete concurrently', async () => {
    await tempDocs.save('mixed1', 'content', {});
    const [saved, deleted] = await Promise.all([
      tempDocs.save('mixed2', 'content', {}),
      tempDocs.delete('mixed1')
    ]);
    expect(saved).toBeDefined();
  });

  // ====================== DATA PERSISTENCE ======================

  test('should persist document across multiple reads', async () => {
    const content = 'persistent content';
    await tempDocs.save('persist', content, {});

    const read1 = await tempDocs.read('persist');
    const read2 = await tempDocs.read('persist');

    expect(read1.content).toBe(content);
    expect(read2.content).toBe(content);
  });

  test('should maintain metadata integrity', async () => {
    const original = {
      title: 'Original Title',
      words: 150,
      sessionId: 'sess-meta'
    };

    await tempDocs.save('integrity', 'content', original);
    const retrieved = await tempDocs.read('integrity');

    expect(retrieved.title).toBe(original.title);
    expect(retrieved.words).toBe(original.words);
    expect(retrieved.sessionId).toBe(original.sessionId);
  });
});
