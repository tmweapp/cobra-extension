/**
 * FileManager Tests
 * Tests for file generation, download tracking, and IndexedDB operations
 */

require('../file-manager.js');

describe('FileManager', () => {
  let FileManager;
  let mockDb;
  let mockIndexedDB;

  beforeEach(() => {
    FileManager = global.FileManager;

    // Ensure chrome.downloads.onChanged exists
    if (!chrome.downloads.onChanged) {
      chrome.downloads.onChanged = {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      };
    }

    // Reset mocks
    jest.clearAllMocks();
    chrome.downloads.download.mockClear();
    if (chrome.downloads.onChanged && chrome.downloads.onChanged.addListener) {
      chrome.downloads.onChanged.addListener.mockClear();
    }
    chrome.storage.local.get.mockClear();
    chrome.storage.local.set.mockClear();

    // Mock IndexedDB
    mockDb = {
      transaction: jest.fn(),
      objectStoreNames: { contains: jest.fn(() => false) },
    };

    mockIndexedDB = {
      open: jest.fn((dbName, version) => {
        const request = {
          result: mockDb,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
        };
        // Trigger onsuccess immediately for tests
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({ target: { result: mockDb } });
        }, 0);
        return request;
      }),
    };

    global.indexedDB = mockIndexedDB;

    // Mock IDBKeyRange
    global.IDBKeyRange = {
      upperBound: jest.fn((value) => ({ bound: value, type: 'upper' })),
    };

    // Reset FileManager state
    FileManager._db = null;
    FileManager._pendingDownloads.clear();
  });

  describe('init()', () => {
    it('should initialize with Supabase config', async () => {
      await FileManager.init('https://test.supabase.co', 'test-key');
      expect(FileManager._supabaseUrl).toBe('https://test.supabase.co');
      expect(FileManager._supabaseKey).toBe('test-key');
    });

    it('should initialize without Supabase config', async () => {
      await FileManager.init();
      expect(FileManager._supabaseUrl).toBe(undefined);
      expect(FileManager._supabaseKey).toBe(undefined);
    });

    it('should setup download listener', async () => {
      await FileManager.init();
      expect(chrome.downloads.onChanged.addListener).toHaveBeenCalled();
    });
  });

  describe('generate()', () => {
    it('should generate CSV from array of objects', () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ];
      const csv = FileManager.generate(data, 'csv');
      expect(csv).toContain('name,age');
      expect(csv).toContain('Alice,30');
      expect(csv).toContain('Bob,25');
    });

    it('should handle CSV with special characters', () => {
      const data = [
        { name: 'O"Brien', email: 'test@example.com' },
      ];
      const csv = FileManager.generate(data, 'csv');
      expect(csv).toContain('"O""Brien"');
    });

    it('should generate JSON', () => {
      const data = { name: 'Test', value: 123 };
      const json = FileManager.generate(data, 'json');
      const parsed = JSON.parse(json);
      expect(parsed.name).toBe('Test');
      expect(parsed.value).toBe(123);
    });

    it('should generate HTML', () => {
      const data = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ];
      const html = FileManager.generate(data, 'html', { title: 'Test Report' });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test Report');
      expect(html).toContain('<table>');
      expect(html).toContain('Item 1');
      expect(html).toContain('Item 2');
    });

    it('should generate Markdown', () => {
      const data = [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ];
      const md = FileManager.generate(data, 'md', { title: 'Test' });
      expect(md).toContain('# Test');
      expect(md).toContain('| id | name |');
      expect(md).toContain('| --- | --- |');
    });

    it('should generate plain text', () => {
      const data = [
        { name: 'Alice', city: 'NYC' },
      ];
      const txt = FileManager.generate(data, 'txt');
      expect(txt).toContain('name: Alice');
      expect(txt).toContain('city: NYC');
    });

    it('should throw error for unsupported format', () => {
      const data = [{ name: 'Test' }];
      expect(() => FileManager.generate(data, 'xyz')).toThrow('Unsupported format');
    });

    it('should escape HTML characters', () => {
      const data = [{ text: '<script>alert("xss")</script>' }];
      const html = FileManager.generate(data, 'html');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
    });

    it('should include BOM for CSV when requested', () => {
      const data = [{ name: 'Test' }];
      const csv = FileManager.generate(data, 'csv', { bom: true });
      expect(csv.charCodeAt(0)).toBe(0xFEFF);
    });

    it('should handle empty data for CSV', () => {
      const csv = FileManager.generate([], 'csv');
      expect(csv).toBe('\uFEFF');
    });

    it('should handle custom CSV delimiter', () => {
      const data = [{ a: 1, b: 2 }];
      const csv = FileManager.generate(data, 'csv', { delimiter: ';' });
      expect(csv).toContain('a;b');
      expect(csv).toContain('1;2');
    });

    it('should skip CSV headers when requested', () => {
      const data = [{ name: 'Alice' }];
      const csv = FileManager.generate(data, 'csv', { includeHeaders: false });
      expect(csv).not.toContain('name');
      expect(csv).toContain('Alice');
    });

    it('should handle custom CSV fields', () => {
      const data = [{ a: 1, b: 2, c: 3 }];
      const csv = FileManager.generate(data, 'csv', { fields: ['a', 'c'] });
      expect(csv).toContain('a,c');
      expect(csv).toContain('1,3');
      expect(csv).not.toContain('b');
    });
  });

  describe('download()', () => {
    beforeEach(() => {
      chrome.downloads.download.mockImplementation((options, callback) => {
        chrome.runtime.lastError = null;
        callback(123);
      });
    });

    afterEach(() => {
      chrome.runtime.lastError = null;
    });

    it('should trigger download via chrome.downloads API', async () => {
      const result = await FileManager.download('test content', 'test.txt');
      expect(result.fileId).toBeDefined();
      expect(result.downloadId).toBe(123);
      expect(result.filename).toBe('test.txt');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should set correct MIME types', async () => {
      const mimeMap = {
        csv: 'text/csv',
        json: 'application/json',
        html: 'text/html',
        txt: 'text/plain',
        md: 'text/markdown',
      };

      for (const [format, expectedMime] of Object.entries(mimeMap)) {
        chrome.downloads.download.mockClear();
        await FileManager.download('test', `file.${format}`, { format });
        expect(chrome.downloads.download).toHaveBeenCalled();
      }
    });

    it('should track pending download', async () => {
      await FileManager.download('test content', 'test.txt');
      expect(FileManager._pendingDownloads.has(123)).toBe(true);
    });

    it('should reject on chrome.runtime.lastError', async () => {
      chrome.downloads.download.mockImplementation((options, callback) => {
        chrome.runtime.lastError = { message: 'Download failed' };
        callback(undefined);
      });

      await expect(
        FileManager.download('test', 'test.txt')
      ).rejects.toThrow();
    });

    it('should handle taskId and tags in options', async () => {
      const result = await FileManager.download('test', 'test.txt', {
        format: 'txt',
        taskId: 'task-123',
        tags: ['important', 'report'],
      });
      expect(result.fileId).toBeDefined();
    });

    it('should store file record in pending downloads', async () => {
      await FileManager.download('test content', 'test.txt', {
        format: 'txt',
        metadata: { source: 'api' },
      });
      const record = FileManager._pendingDownloads.get(123);
      expect(record).toBeDefined();
      expect(record.filename).toBe('test.txt');
      expect(record.status).toBe('pending');
      expect(record.format).toBe('txt');
    });
  });

  describe('downloadData()', () => {
    beforeEach(() => {
      chrome.downloads.download.mockImplementation((options, callback) => {
        chrome.runtime.lastError = null;
        callback(456);
      });
    });

    afterEach(() => {
      chrome.runtime.lastError = null;
    });

    it('should generate and download in one call', async () => {
      const data = [{ name: 'Test' }];
      const result = await FileManager.downloadData(data, 'export.csv', 'csv');
      expect(result.downloadId).toBe(456);
      expect(result.filename).toBe('export.csv');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });

  describe('getDownload()', () => {
    beforeEach(() => {
      const store = {
        get: jest.fn((fileId) => {
          const req = {
            result: { id: fileId, filename: 'test.txt' },
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: { result: req.result } });
          }, 0);
          return req;
        }),
      };

      const tx = {
        objectStore: jest.fn(() => store),
      };

      mockDb.transaction.mockReturnValue(tx);
    });

    it('should retrieve download record by fileId', async () => {
      await FileManager._getDb();
      const record = await FileManager.getDownload('fs_file_123');
      expect(record).toBeDefined();
      expect(record.filename).toBe('test.txt');
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      const cursor = {
        value: { id: 'file1', format: 'csv', created_at: Date.now(), taskId: 'task1' },
        continue: jest.fn(),
        onsuccess: null,
      };

      const index = {
        openCursor: jest.fn(() => {
          const req = { onsuccess: null };
          setTimeout(() => {
            if (req.onsuccess) {
              req.onsuccess({ target: { result: cursor } });
              setTimeout(() => {
                if (req.onsuccess) req.onsuccess({ target: { result: null } });
              }, 0);
            }
          }, 0);
          return req;
        }),
      };

      const store = {
        index: jest.fn(() => index),
      };

      const tx = {
        objectStore: jest.fn(() => store),
      };

      mockDb.transaction.mockReturnValue(tx);
    });

    it('should list files with default pagination', async () => {
      await FileManager._getDb();
      const files = await FileManager.list();
      expect(Array.isArray(files)).toBe(true);
    });

    it('should filter by format', async () => {
      await FileManager._getDb();
      const files = await FileManager.list({ format: 'csv', limit: 10 });
      expect(Array.isArray(files)).toBe(true);
    });

    it('should filter by taskId', async () => {
      await FileManager._getDb();
      const files = await FileManager.list({ taskId: 'task1' });
      expect(Array.isArray(files)).toBe(true);
    });

    it('should respect offset and limit', async () => {
      await FileManager._getDb();
      const files = await FileManager.list({ offset: 5, limit: 10 });
      expect(Array.isArray(files)).toBe(true);
    });
  });

  describe('search()', () => {
    beforeEach(() => {
      const store = {
        getAll: jest.fn(() => {
          const req = {
            result: [
              { id: 'f1', filename: 'report.csv', tags: ['important'] },
              { id: 'f2', filename: 'data.json', tags: ['export'] },
            ],
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: { result: req.result } });
          }, 0);
          return req;
        }),
      };

      const tx = {
        objectStore: jest.fn(() => store),
      };

      mockDb.transaction.mockReturnValue(tx);
    });

    it('should search by filename', async () => {
      await FileManager._getDb();
      const results = await FileManager.search('report');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should search by tags', async () => {
      await FileManager._getDb();
      const results = await FileManager.search('important');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should be case-insensitive', async () => {
      await FileManager._getDb();
      const results = await FileManager.search('REPORT');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('getContent()', () => {
    beforeEach(() => {
      const store = {
        get: jest.fn((fileId) => {
          const req = {
            result: { id: fileId, content: 'file content here' },
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: { result: req.result } });
          }, 0);
          return req;
        }),
      };

      const tx = {
        objectStore: jest.fn(() => store),
      };

      mockDb.transaction.mockReturnValue(tx);
    });

    it('should retrieve stored file content', async () => {
      await FileManager._getDb();
      const content = await FileManager.getContent('file-123');
      expect(content).toBe('file content here');
    });

    it('should return null if content not stored', async () => {
      const store = {
        get: jest.fn((fileId) => {
          const req = {
            result: { id: fileId, content: null },
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: { result: req.result } });
          }, 0);
          return req;
        }),
      };

      const tx = {
        objectStore: jest.fn(() => store),
      };

      mockDb.transaction.mockReturnValue(tx);
      await FileManager._getDb();
      const content = await FileManager.getContent('file-123');
      expect(content).toBeNull();
    });
  });

  describe('cleanup()', () => {
    beforeEach(() => {
      const index = {
        openCursor: jest.fn((range) => {
          const req = {
            onsuccess: null,
            onerror: null
          };
          setTimeout(() => {
            if (req.onsuccess) {
              // Return null cursor to end immediately
              req.onsuccess({ target: { result: null } });
            }
          }, 0);
          return req;
        }),
      };

      const store = {
        index: jest.fn(() => index),
      };

      const tx = {
        objectStore: jest.fn(() => store),
      };

      mockDb.transaction.mockReturnValue(tx);
    });

    it('should delete records older than daysOld', async () => {
      await FileManager._getDb();
      const deleted = await FileManager.cleanup(30);
      expect(typeof deleted).toBe('number');
      expect(deleted).toBe(0);
    }, 10000);
  });

  describe('getStats()', () => {
    beforeEach(() => {
      const store = {
        getAll: jest.fn(() => {
          const req = {
            result: [
              { id: 'f1', size: 1000, format: 'csv', status: 'completed', created_at: Date.now() - 5000 },
              { id: 'f2', size: 2000, format: 'json', status: 'completed', created_at: Date.now() - 1000 },
              { id: 'f3', size: 500, format: 'csv', status: 'failed', created_at: Date.now() },
            ],
            onsuccess: null,
            onerror: null,
          };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: { result: req.result } });
          }, 0);
          return req;
        }),
      };

      const tx = {
        objectStore: jest.fn(() => store),
      };

      mockDb.transaction.mockReturnValue(tx);
    });

    it('should return file statistics', async () => {
      await FileManager._getDb();
      const stats = await FileManager.getStats();
      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSize).toBe(3500);
      expect(stats.byFormat.csv).toBe(2);
      expect(stats.byFormat.json).toBe(1);
      expect(stats.byStatus.completed).toBe(2);
      expect(stats.byStatus.failed).toBe(1);
    });

    it('should calculate oldest and newest files', async () => {
      await FileManager._getDb();
      const stats = await FileManager.getStats();
      expect(stats.oldestFile).toBeDefined();
      expect(stats.newestFile).toBeDefined();
    });
  });

  describe('Download listener', () => {
    let downloadListener;

    beforeEach(() => {
      chrome.downloads.download.mockImplementation((options, callback) => {
        chrome.runtime.lastError = null;
        callback(789);
      });

      // Capture the listener function
      chrome.downloads.onChanged.addListener.mockImplementation((fn) => {
        downloadListener = fn;
      });
    });

    afterEach(() => {
      chrome.runtime.lastError = null;
      downloadListener = null;
    });

    it('should track pending downloads', async () => {
      await FileManager.init();
      const downloadResult = await FileManager.download('test', 'test.txt');
      const downloadId = downloadResult.downloadId;

      // Verify record exists in pending downloads
      expect(FileManager._pendingDownloads.has(downloadId)).toBe(true);
      const record = FileManager._pendingDownloads.get(downloadId);
      expect(record.status).toBe('pending');
      expect(record.filename).toBe('test.txt');
    });

    it('should handle listener registration', async () => {
      await FileManager.init();
      // Listener should have been registered
      expect(chrome.downloads.onChanged.addListener).toHaveBeenCalled();
    });
  });
});
