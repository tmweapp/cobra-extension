/**
 * COBRA v5.2 — Error Boundary & Graceful Degradation
 * Catches unhandled errors, tracks error patterns, provides fallback behaviors.
 * Must be loaded early in background.js importScripts chain.
 */

// ============================================================
// Global Error Handler
// ============================================================
const CobraErrorBoundary = {
  _errors: [],
  _maxErrors: 100,
  _errorCounts: {},  // pattern -> count
  _listeners: [],
  _degradedModules: new Set(),

  init() {
    // Catch unhandled promise rejections
    self.addEventListener('unhandledrejection', (event) => {
      this.capture('unhandled_rejection', event.reason, { promise: true });
      event.preventDefault(); // Prevent service worker crash
    });

    // Catch global errors
    self.addEventListener('error', (event) => {
      this.capture('global_error', event.error || event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    console.log('[ErrorBoundary] Initialized — global handlers active');
  },

  // Capture an error
  capture(type, error, meta = {}) {
    const entry = {
      type,
      message: error?.message || String(error),
      stack: error?.stack?.slice(0, 500) || '',
      meta,
      timestamp: Date.now(),
    };

    this._errors.push(entry);
    if (this._errors.length > this._maxErrors) this._errors.shift();

    // Track pattern frequency
    const pattern = `${type}:${entry.message.slice(0, 80)}`;
    this._errorCounts[pattern] = (this._errorCounts[pattern] || 0) + 1;

    // Auto-degrade if same error repeats 5+ times in 60 seconds
    if (this._errorCounts[pattern] >= 5) {
      const recentOfType = this._errors.filter(e =>
        `${e.type}:${e.message.slice(0, 80)}` === pattern &&
        Date.now() - e.timestamp < 60000
      );
      if (recentOfType.length >= 5) {
        this._autoDegradeModule(pattern, entry);
      }
    }

    // Notify listeners
    this._listeners.forEach(fn => {
      try { fn(entry); } catch {}
    });

    // Async log to IndexedDB if available
    if (self.cobraIDB) {
      self.cobraIDB.appendAuditLog({
        tool: 'error_boundary',
        action: type,
        error: entry.message,
        meta,
      }).catch(() => {});
    }

    console.error(`[ErrorBoundary] ${type}: ${entry.message}`);
  },

  // Wrap an async function with error boundary
  wrap(fn, fallback = null, context = 'unknown') {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.capture(`wrapped_${context}`, error);
        if (typeof fallback === 'function') {
          return fallback(error, ...args);
        }
        return fallback;
      }
    };
  },

  // Wrap with timeout
  withTimeout(fn, timeoutMs = 30000, context = 'unknown') {
    return async (...args) => {
      return Promise.race([
        fn(...args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms in ${context}`)), timeoutMs)
        ),
      ]).catch(error => {
        this.capture(`timeout_${context}`, error);
        throw error;
      });
    };
  },

  // Auto-degrade module on repeated failures
  _autoDegradeModule(pattern, lastError) {
    if (this._degradedModules.has(pattern)) return;
    this._degradedModules.add(pattern);
    console.warn(`[ErrorBoundary] AUTO-DEGRADED: ${pattern} — too many failures`);

    // Reset after 5 minutes
    setTimeout(() => {
      this._degradedModules.delete(pattern);
      this._errorCounts[pattern] = 0;
      console.log(`[ErrorBoundary] Restored: ${pattern}`);
    }, 300000);
  },

  // Check if a module/pattern is degraded
  isDegraded(pattern) {
    return this._degradedModules.has(pattern);
  },

  // Add error listener
  onError(fn) {
    this._listeners.push(fn);
  },

  // Get recent errors
  getRecent(count = 20) {
    return this._errors.slice(-count);
  },

  // Get error statistics
  getStats() {
    const now = Date.now();
    const last5min = this._errors.filter(e => now - e.timestamp < 300000);
    const last1hr = this._errors.filter(e => now - e.timestamp < 3600000);

    return {
      total: this._errors.length,
      last5min: last5min.length,
      last1hr: last1hr.length,
      degradedModules: [...this._degradedModules],
      topErrors: Object.entries(this._errorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([pattern, count]) => ({ pattern, count })),
    };
  },

  // Reset counters (for testing or manual recovery)
  reset() {
    this._errors = [];
    this._errorCounts = {};
    this._degradedModules.clear();
  },
};

// ============================================================
// Safe Module Loader — wraps importScripts with fallback
// ============================================================
function safeImport(scriptPath, moduleName) {
  try {
    importScripts(scriptPath);
    console.log(`[SafeImport] ✓ ${moduleName || scriptPath}`);
    return true;
  } catch (e) {
    console.error(`[SafeImport] ✗ ${moduleName || scriptPath}: ${e.message}`);
    CobraErrorBoundary.capture('import_failure', e, { script: scriptPath, module: moduleName });
    return false;
  }
}

// Export
self.CobraErrorBoundary = CobraErrorBoundary;
self.safeImport = safeImport;
console.log('[error-boundary.js] Loaded: CobraErrorBoundary, safeImport');
