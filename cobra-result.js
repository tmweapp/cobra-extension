/**
 * COBRA v5.2 — Standardized Result Wrapper
 * Every tool/operation returns Result.ok() or Result.fail().
 * Eliminates inconsistent {error: ...} vs {ok: true} patterns.
 *
 * IMPORTANT: Result objects are pure data (no methods) so they can be
 * safely passed through chrome.runtime.sendMessage (structured clone).
 * Use Result.serialize(r) to get a JSON string.
 */

const Result = {
  /**
   * Success result — returns a PLAIN object (no methods, cloneable)
   */
  ok(data = null, meta = {}) {
    return { success: true, data, meta: { ...meta, ts: Date.now() } };
  },

  /**
   * Failure result — returns a PLAIN object (no methods, cloneable)
   */
  fail(code, message, details = {}) {
    return { success: false, code: code || 'UNKNOWN', message: message || 'Errore sconosciuto', details, ts: Date.now() };
  },

  /**
   * Serialize a Result to JSON string (for tool-executor returns)
   */
  serialize(r) {
    if (!r) return '{}';
    if (r.success) {
      const payload = r.data && typeof r.data === 'object' ? { ok: true, ...r.data } : { ok: true, data: r.data };
      return JSON.stringify(payload);
    }
    return JSON.stringify({ error: r.message, code: r.code });
  },

  /**
   * Wrap an async function to always return a Result
   */
  wrap(fn, errorCode = 'INTERNAL') {
    return async function (...args) {
      try {
        const value = await fn.apply(this, args);
        if (value && typeof value === 'object' && 'success' in value) return value;
        return Result.ok(value);
      } catch (err) {
        return Result.fail(err.code || errorCode, err.message || String(err), { stack: err.stack });
      }
    };
  },

  /**
   * Check if a value is a Result object
   */
  isResult(val) {
    return val != null && typeof val === 'object' && 'success' in val;
  },

  /**
   * Convert legacy {ok: true, ...} or {error: ...} to Result
   */
  fromLegacy(obj) {
    if (!obj || typeof obj !== 'object') return Result.ok(obj);
    if (obj.error) return Result.fail('LEGACY', obj.error, obj);
    if (obj.ok === true || obj.success === true) {
      const data = { ...obj };
      delete data.ok;
      delete data.success;
      return Result.ok(data);
    }
    return Result.ok(obj);
  }
};

self.Result = Result;
console.log('[cobra-result.js] Loaded: Result wrapper (ok/fail)');
