/**
 * FileManager - COBRA File Generation & Download Management (MV3)
 * Handles in-memory file generation, downloads via chrome.downloads API,
 * and tracking via IndexedDB with optional Supabase sync.
 */

const FileManager = {
  _dbName: 'COBRAFiles',
  _dbVersion: 1,
  _storeName: 'files',
  _db: null,
  _pendingDownloads: new Map(), // downloadId → fileRecord
  _supabaseUrl: null,
  _supabaseKey: null,

  /**
   * Initialize FileManager: setup IndexedDB, register download listener
   */
  async init(supabaseUrl, supabaseKey) {
    this._supabaseUrl = supabaseUrl;
    this._supabaseKey = supabaseKey;
    await this._getDb();
    this._setupDownloadListener();
    console.log('[FileManager] Initialized');
  },

  /**
   * Get or create IndexedDB instance
   */
  async _getDb() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, this._dbVersion);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          const store = db.createObjectStore(this._storeName, { keyPath: 'id' });
          store.createIndex('created_at', 'created_at', { unique: false });
          store.createIndex('taskId', 'taskId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };

      req.onsuccess = () => {
        this._db = req.result;
        resolve(this._db);
      };

      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Setup chrome.downloads listener to track download state changes
   */
  _setupDownloadListener() {
    if (!chrome.downloads?.onChanged) return;

    chrome.downloads.onChanged.addListener(async (delta) => {
      const { id, state } = delta;
      const fileRecord = this._pendingDownloads.get(id);

      if (!fileRecord) return;

      if (state?.current === 'complete') {
        fileRecord.status = 'completed';
        fileRecord.completed_at = Date.now();
        await this._trackDownload(id, fileRecord);
        this._pendingDownloads.delete(id);
      } else if (state?.current === 'interrupted') {
        fileRecord.status = 'failed';
        await this._trackDownload(id, fileRecord);
        this._pendingDownloads.delete(id);
      } else if (state?.current === 'in_progress') {
        fileRecord.status = 'downloading';
        await this._trackDownload(id, fileRecord);
      }
    });
  },

  /**
   * Generate file content from data
   * @param {Array|Object} data - Data to export
   * @param {string} format - 'csv' | 'json' | 'txt' | 'html' | 'md'
   * @param {Object} options - Format-specific options
   * @returns {string} File content
   */
  generate(data, format, options = {}) {
    switch (format) {
      case 'csv':
        return this._generateCSV(data, options);
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'html':
        return this._generateHTML(data, options);
      case 'md':
        return this._generateMarkdown(data, options);
      case 'txt':
        return this._generateText(data, options);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  },

  /**
   * Generate CSV from array of objects
   */
  _generateCSV(data, options = {}) {
    const {
      delimiter = ',',
      includeHeaders = true,
      bom = true,
      fields = null,
    } = options;

    if (!Array.isArray(data) || data.length === 0) {
      return bom ? '\uFEFF' : '';
    }

    let csv = bom ? '\uFEFF' : '';
    const keys = fields || Object.keys(data[0]);

    // Add headers
    if (includeHeaders) {
      csv += keys.map((k) => this._escapeCSVField(k)).join(delimiter) + '\n';
    }

    // Add rows
    for (const row of data) {
      const values = keys.map((k) => this._escapeCSVField(row[k] ?? ''));
      csv += values.join(delimiter) + '\n';
    }

    return csv;
  },

  /**
   * Escape CSV field: handle quotes, commas, newlines
   */
  _escapeCSVField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  },

  /**
   * Generate HTML report with styled table
   */
  _generateHTML(data, options = {}) {
    const { title = 'Export Report', template = 'default' } = options;
    const rows = Array.isArray(data) ? data : [data];

    if (rows.length === 0) {
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this._escapeHTML(title)}</title>
  <style>body { font-family: sans-serif; margin: 20px; }</style>
</head>
<body>
  <h1>${this._escapeHTML(title)}</h1>
  <p>No data to display.</p>
</body>
</html>`;
    }

    const headers = Object.keys(rows[0]);
    const tableRows = rows
      .map((row) => {
        const cells = headers
          .map((h) => `<td>${this._escapeHTML(row[h])}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('\n');

    const headerCells = headers
      .map((h) => `<th>${this._escapeHTML(h)}</th>`)
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this._escapeHTML(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 20px; color: #333; }
    h1 { color: #222; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th { background-color: #007bff; color: white; padding: 12px; text-align: left; }
    td { border-bottom: 1px solid #ddd; padding: 10px; }
    tr:hover { background-color: #f5f5f5; }
    .meta { color: #666; font-size: 0.9em; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>${this._escapeHTML(title)}</h1>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="meta">Generated: ${new Date().toLocaleString()} | Rows: ${rows.length}</div>
</body>
</html>`;
  },

  /**
   * Generate Markdown table
   */
  _generateMarkdown(data, options = {}) {
    const { title = 'Export' } = options;
    const rows = Array.isArray(data) ? data : [data];

    if (rows.length === 0) return `# ${title}\n\nNo data.`;

    const headers = Object.keys(rows[0]);
    let md = `# ${title}\n\n`;
    md += '| ' + headers.join(' | ') + ' |\n';
    md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

    for (const row of rows) {
      const cells = headers.map((h) => String(row[h] ?? ''));
      md += '| ' + cells.join(' | ') + ' |\n';
    }

    return md;
  },

  /**
   * Generate plain text
   */
  _generateText(data, options = {}) {
    const rows = Array.isArray(data) ? data : [data];
    return rows
      .map((row) => {
        return Object.entries(row)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
      })
      .join('\n\n');
  },

  /**
   * Escape HTML special characters
   */
  _escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * Download a file (blob → chrome.downloads)
   * @returns {Promise<{fileId, downloadId, filename}>}
   */
  async download(content, filename, options = {}) {
    const { format = 'txt', taskId = null, tags = [], metadata = {} } = options;

    const mimeTypes = {
      csv: 'text/csv',
      json: 'application/json',
      html: 'text/html',
      txt: 'text/plain',
      md: 'text/markdown',
    };

    const mimeType = mimeTypes[format] || 'application/octet-stream';
    const blob = new Blob([content], { type: mimeType });

    const fileId = `fs_file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const fileRecord = {
      id: fileId,
      filename,
      format,
      mimeType,
      size: blob.size,
      downloadId: null,
      downloadPath: null,
      status: 'pending',
      taskId,
      tags,
      content: blob.size < 10 * 1024 * 1024 ? content : null, // Store if <10MB
      metadata,
      created_at: Date.now(),
      completed_at: null,
    };

    // Trigger download using data URL (MV3 compatible - no blob URLs in service workers)
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        chrome.downloads.download(
          {
            url: dataUrl,
            filename,
            saveAs: false,
          },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            fileRecord.downloadId = downloadId;
            this._pendingDownloads.set(downloadId, fileRecord);

            resolve({
              fileId,
              downloadId,
              filename,
            });
          }
        );
      };
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });
  },

  /**
   * Download data: generate + download in one call
   */
  async downloadData(data, filename, format, options = {}) {
    const content = this.generate(data, format, options);
    return this.download(content, filename, { format, ...options });
  },

  /**
   * Track a download in IndexedDB
   */
  async _trackDownload(downloadId, fileRecord) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readwrite');
      const store = tx.objectStore(this._storeName);
      const req = store.put(fileRecord);

      req.onsuccess = () => {
        this._syncToSupabase(fileRecord).catch((err) =>
          console.error('[FileManager] Supabase sync failed:', err)
        );
        resolve();
      };

      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Get download status/record
   */
  async getDownload(fileId) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readonly');
      const store = tx.objectStore(this._storeName);
      const req = store.get(fileId);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * List all files with optional filter
   */
  async list(filter = {}) {
    const { format = null, taskId = null, limit = 50, offset = 0 } = filter;
    const db = await this._getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readonly');
      const store = tx.objectStore(this._storeName);
      const req = store.index('created_at').openCursor(null, 'prev');

      const files = [];
      let count = 0;

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) {
          resolve(files);
          return;
        }

        const record = cursor.value;
        if (
          (!format || record.format === format) &&
          (!taskId || record.taskId === taskId)
        ) {
          if (count >= offset && files.length < limit) {
            files.push(record);
          }
          count++;
        }

        cursor.continue();
      };

      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Search files by name/tag
   */
  async search(query) {
    const db = await this._getDb();
    const lowerQuery = query.toLowerCase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readonly');
      const store = tx.objectStore(this._storeName);
      const req = store.getAll();

      req.onsuccess = () => {
        const results = req.result.filter(
          (file) =>
            file.filename.toLowerCase().includes(lowerQuery) ||
            file.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
        );
        resolve(results);
      };

      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Get file content from IndexedDB (if stored)
   */
  async getContent(fileId) {
    const record = await this.getDownload(fileId);
    return record?.content || null;
  },

  /**
   * Re-download a previously generated file
   */
  async redownload(fileId) {
    const record = await this.getDownload(fileId);
    if (!record || !record.content) {
      throw new Error('File not found or content unavailable');
    }

    return this.download(record.content, record.filename, {
      format: record.format,
      tags: record.tags,
      metadata: record.metadata,
    });
  },

  /**
   * Sync file record to Supabase
   */
  async _syncToSupabase(fileRecord) {
    if (!this._supabaseUrl || !this._supabaseKey) return;

    try {
      const payload = {
        id: fileRecord.id,
        filename: fileRecord.filename,
        format: fileRecord.format,
        size: fileRecord.size,
        status: fileRecord.status,
        taskId: fileRecord.taskId,
        tags: fileRecord.tags,
        created_at: new Date(fileRecord.created_at).toISOString(),
      };

      await fetch(`${this._supabaseUrl}/rest/v1/file_exports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this._supabaseKey,
          Authorization: `Bearer ${this._supabaseKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('[FileManager] Supabase sync error:', err.message);
    }
  },

  /**
   * Cleanup old records (>daysOld)
   */
  async cleanup(daysOld = 30) {
    const db = await this._getDb();
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readwrite');
      const store = tx.objectStore(this._storeName);
      const index = store.index('created_at');
      const range = IDBKeyRange.upperBound(cutoff);
      const req = index.openCursor(range);

      let deleted = 0;

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          resolve(deleted);
        }
      };

      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Get statistics
   */
  async getStats() {
    const db = await this._getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readonly');
      const store = tx.objectStore(this._storeName);
      const req = store.getAll();

      req.onsuccess = () => {
        const files = req.result;
        const stats = {
          totalFiles: files.length,
          totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0),
          byFormat: {},
          byStatus: {},
          oldestFile: files.length ? Math.min(...files.map((f) => f.created_at)) : null,
          newestFile: files.length ? Math.max(...files.map((f) => f.created_at)) : null,
        };

        for (const file of files) {
          stats.byFormat[file.format] = (stats.byFormat[file.format] || 0) + 1;
          stats.byStatus[file.status] = (stats.byStatus[file.status] || 0) + 1;
        }

        resolve(stats);
      };

      req.onerror = () => reject(req.error);
    });
  },
};

globalThis.FileManager = FileManager;
