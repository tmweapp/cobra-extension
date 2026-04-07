// Chrome API mocks for testing
global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, cb) => {
        if (typeof cb === 'function') cb({});
        return Promise.resolve({});
      }),
      set: jest.fn((data, cb) => {
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      }),
      remove: jest.fn((keys, cb) => {
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
    lastError: null,
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([])),
    sendMessage: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  scripting: {
    executeScript: jest.fn(() => Promise.resolve([{ result: null }])),
  },
  sidePanel: {
    setPanelBehavior: jest.fn(() => Promise.resolve()),
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    onAlarm: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  notifications: {
    create: jest.fn(),
  },
  downloads: {
    download: jest.fn(),
  },
};

// self mock for service worker modules
global.self = global;

// Suppress console in tests unless needed
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

// Add setImmediate and clearImmediate if not available (for Node.js compatibility)
if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = (callback, ...args) => {
    return setTimeout(callback, 0, ...args);
  };
}

if (typeof global.clearImmediate === 'undefined') {
  global.clearImmediate = (id) => {
    clearTimeout(id);
  };
}

// Add TextDecoder and TextEncoder if not available
if (typeof global.TextDecoder === 'undefined') {
  // Polyfill for TextDecoder
  global.TextDecoder = class TextDecoder {
    decode(buffer) {
      if (buffer instanceof Uint8Array) {
        return String.fromCharCode.apply(null, buffer);
      }
      return String(buffer);
    }
  };
}

if (typeof global.TextEncoder === 'undefined') {
  // Polyfill for TextEncoder
  global.TextEncoder = class TextEncoder {
    encode(str) {
      const arr = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        arr[i] = str.charCodeAt(i);
      }
      return arr;
    }
  };
}

// Add ReadableStream polyfill
if (typeof global.ReadableStream === 'undefined') {
  global.ReadableStream = class ReadableStream {
    constructor(underlyingSource) {
      this.underlyingSource = underlyingSource;
    }
  };
}

// Add PromiseRejectionEvent polyfill for unhandledrejection tests
if (typeof global.PromiseRejectionEvent === 'undefined') {
  global.PromiseRejectionEvent = class PromiseRejectionEvent extends Event {
    constructor(type, init) {
      super(type);
      this.reason = init?.reason;
      this.promise = init?.promise;
    }
  };
}

// Mock IndexedDB for Library tests
if (typeof global.indexedDB === 'undefined') {
  const databases = new Map();

  // Mock ObjectStore with full CRUD operations
  class MockObjectStore {
    constructor(name, storeName, mode) {
      this.name = storeName;
      this.mode = mode;
      this.storeRef = name[storeName];
      if (!this.storeRef) {
        this.storeRef = { data: [] };
        name[storeName] = this.storeRef;
      }
    }

    put(record) {
      const req = {
        onsuccess: null,
        onerror: null,
      };
      setTimeout(() => {
        const idx = this.storeRef.data.findIndex(r => r.id === record.id);
        if (idx >= 0) {
          this.storeRef.data[idx] = record;
        } else {
          this.storeRef.data.push(record);
        }
        if (req.onsuccess) req.onsuccess({ target: { result: record.id } });
      }, 0);
      return req;
    }

    get(id) {
      const req = {
        onsuccess: null,
        onerror: null,
        result: null,
      };
      setTimeout(() => {
        req.result = this.storeRef.data.find(r => r.id === id);
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    }

    delete(id) {
      const req = {
        onsuccess: null,
        onerror: null,
      };
      setTimeout(() => {
        this.storeRef.data = this.storeRef.data.filter(r => r.id !== id);
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }

    getAll() {
      const req = {
        onsuccess: null,
        onerror: null,
        result: [],
      };
      setTimeout(() => {
        req.result = [...this.storeRef.data];
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    }

    clear() {
      const req = {
        onsuccess: null,
        onerror: null,
      };
      setTimeout(() => {
        this.storeRef.data = [];
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }

    index(indexName) {
      // Basic index mock for openCursor
      return {
        openCursor: () => ({
          onsuccess: null,
          onerror: null,
        }),
      };
    }
  }

  class MockTransaction {
    constructor(storeNames, mode, dbData) {
      this.storeNames = storeNames;
      this.mode = mode;
      this.dbData = dbData;
      this.oncomplete = null;
      this.onerror = null;
    }

    objectStore(name) {
      return new MockObjectStore(this.dbData, name, this.mode);
    }
  }

  global.indexedDB = {
    open: jest.fn((dbName, version) => {
      if (!databases.has(dbName)) {
        databases.set(dbName, {});
      }
      const dbData = databases.get(dbName);

      const mockDB = {
        objectStoreNames: {
          contains: jest.fn((name) => dbData[name] !== undefined),
        },
        createObjectStore: jest.fn((name) => {
          dbData[name] = { data: [] };
          return {
            createIndex: jest.fn(() => ({ data: [] })),
          };
        }),
        transaction: jest.fn((storeNames, mode) => {
          return new MockTransaction(storeNames, mode, dbData);
        }),
        close: jest.fn(),
      };

      const request = {
        result: mockDB,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        error: null,
      };

      // Simulate async open
      setTimeout(() => {
        if (request.onupgradeneeded) {
          const event = { target: { result: mockDB } };
          request.onupgradeneeded(event);
        }
        if (request.onsuccess) {
          request.onsuccess({ target: request });
        }
      }, 0);

      return request;
    }),
  };
}

// Mock crypto.randomUUID if needed
if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}
if (typeof global.crypto.randomUUID === 'undefined') {
  global.crypto.randomUUID = jest.fn(() => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  });
}

// Mock CryptoUtils for encrypted config storage
if (typeof global.CryptoUtils === 'undefined') {
  global.CryptoUtils = {
    encrypt: jest.fn(async (str) => `encrypted:${str}`),
    decrypt: jest.fn(async (str) => str.replace('encrypted:', ''))
  };
}
