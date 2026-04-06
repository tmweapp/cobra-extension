/**
 * COBRA v5.2 — Structured Logger
 * Unified logging with levels, namespaces, and IndexedDB persistence.
 * Replaces scattered console.log/warn/error calls with auditable logging.
 */

const CobraLogger = {
  _level: 'info', // debug | info | warn | error
  _levels: { debug: 0, info: 1, warn: 2, error: 3 },
  _buffer: [],
  _maxBuffer: 200,
  _flushInterval: null,

  init(level = 'info') {
    this._level = level;
    // Auto-flush to IndexedDB every 30 seconds
    this._flushInterval = setInterval(() => this.flush(), 30000);
    console.log(`[CobraLogger] Initialized at level: ${level}`);
  },

  _shouldLog(level) {
    return (this._levels[level] || 0) >= (this._levels[this._level] || 0);
  },

  _log(level, namespace, message, data = null) {
    if (!this._shouldLog(level)) return;

    const entry = {
      level,
      ns: namespace,
      msg: message,
      data: data ? JSON.parse(JSON.stringify(data)) : undefined,
      ts: Date.now(),
    };

    this._buffer.push(entry);
    if (this._buffer.length > this._maxBuffer) this._buffer.shift();

    // Console output with color coding
    const prefix = `[${namespace}]`;
    switch (level) {
      case 'debug': console.debug(prefix, message, data || ''); break;
      case 'info':  console.log(prefix, message, data || ''); break;
      case 'warn':  console.warn(prefix, message, data || ''); break;
      case 'error': console.error(prefix, message, data || ''); break;
    }

    // Immediate flush for errors
    if (level === 'error') this.flush();
  },

  debug(ns, msg, data) { this._log('debug', ns, msg, data); },
  info(ns, msg, data)  { this._log('info', ns, msg, data); },
  warn(ns, msg, data)  { this._log('warn', ns, msg, data); },
  error(ns, msg, data) { this._log('error', ns, msg, data); },

  // Convenience: create a namespaced logger
  create(namespace) {
    return {
      debug: (msg, data) => this.debug(namespace, msg, data),
      info:  (msg, data) => this.info(namespace, msg, data),
      warn:  (msg, data) => this.warn(namespace, msg, data),
      error: (msg, data) => this.error(namespace, msg, data),
    };
  },

  // Flush buffer to IndexedDB
  async flush() {
    if (this._buffer.length === 0) return;
    if (!self.cobraIDB) return;

    const toFlush = [...this._buffer];
    this._buffer = [];

    try {
      for (const entry of toFlush) {
        await self.cobraIDB.appendAuditLog({
          tool: `log_${entry.level}`,
          action: entry.ns,
          error: entry.level === 'error' ? entry.msg : undefined,
          meta: { msg: entry.msg, data: entry.data },
        });
      }
    } catch (e) {
      // Re-add unflushed entries (up to limit)
      this._buffer.unshift(...toFlush.slice(-50));
    }
  },

  // Get recent logs from buffer
  getRecent(count = 50, levelFilter = null) {
    let logs = this._buffer;
    if (levelFilter) {
      logs = logs.filter(l => l.level === levelFilter);
    }
    return logs.slice(-count);
  },

  // Set log level dynamically
  setLevel(level) {
    if (this._levels[level] !== undefined) {
      this._level = level;
      console.log(`[CobraLogger] Level changed to: ${level}`);
    }
  },

  // Cleanup
  destroy() {
    if (this._flushInterval) {
      clearInterval(this._flushInterval);
      this._flushInterval = null;
    }
    this.flush();
  },
};

// Export
self.CobraLogger = CobraLogger;
console.log('[cobra-logger.js] Loaded: CobraLogger');
