/**
 * @module CobraGuard
 * @description Guard Module — Circuit Breaker + Per-Action Rate Limiting.
 * Complementa rate-limiter.js (dominio/ora/giorno).
 * Questo modulo lavora per hostname::action con finestra 10s.
 *
 * Rate limit: 10 req/10s per write actions, 40 req/10s per read.
 * Circuit breaker: 5 consecutive failures → 30s cooldown.
 *
 * @example
 * const result = CobraGuard.check('https://example.com', 'fill_form');
 * if (!result.ok) console.log(result.reason); // 'rate_limit' | 'circuit_open'
 */

const CobraGuard = {
  /** @type {Object<string, {count: number, windowStart: number}>} Rate limit buckets */
  _buckets: {},
  /** @type {Object<string, {failures: number, openUntil: number}>} Circuit breaker states */
  _circuits: {},

  _key(url, action) {
    let host = 'unknown';
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* ignore */ }
    return host + '::' + (action || 'unknown');
  },

  _WRITE_ACTIONS: new Set([
    'click_element', 'fill_form', 'execute_js',
    'send_email', 'send_whatsapp', 'send_linkedin',
    'save_to_kb', 'kb_update', 'kb_delete',
    'create_file', 'save_local_file', 'create_task',
    'CLICK_SELECTOR', 'TYPE_SELECTOR', 'CLICK_SMART', 'TYPE_SMART'
  ]),

  // ── Rate Limit (10s window) ──
  checkRateLimit(url, action) {
    const key = this._key(url, action);
    const now = Date.now();
    const bucket = this._buckets[key] || { count: 0, resetAt: now + 10000 };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + 10000;
    }

    bucket.count += 1;
    this._buckets[key] = bucket;

    const limit = this._WRITE_ACTIONS.has(action) ? 10 : 40;

    if (bucket.count > limit) {
      return {
        ok: false,
        code: 'RATE_LIMITED',
        reason: `Rate limit: ${action} su ${key.split('::')[0]} — ${bucket.count}/${limit} in 10s`
      };
    }
    return { ok: true };
  },

  // ── Circuit Breaker (5 fail → 30s cooldown) ──
  checkCircuit(url, action) {
    const key = this._key(url, action);
    const c = this._circuits[key];
    if (!c) return { ok: true };

    if (Date.now() < c.openUntil) {
      return {
        ok: false,
        code: 'CIRCUIT_OPEN',
        reason: `Circuit breaker aperto per ${action} — cooldown fino ${new Date(c.openUntil).toLocaleTimeString()}`
      };
    }
    return { ok: true };
  },

  registerFailure(url, action) {
    const key = this._key(url, action);
    const c = this._circuits[key] || { failures: 0, openUntil: 0 };
    c.failures += 1;
    if (c.failures >= 5) {
      c.openUntil = Date.now() + 30000;
      c.failures = 0;
      console.warn(`[CobraGuard] Circuit OPEN per ${key} — 30s cooldown`);
    }
    this._circuits[key] = c;
  },

  registerSuccess(url, action) {
    const key = this._key(url, action);
    this._circuits[key] = { failures: 0, openUntil: 0 };
  },

  // ── Combined check ──
  check(url, action) {
    const circuit = this.checkCircuit(url, action);
    if (!circuit.ok) return circuit;
    const rate = this.checkRateLimit(url, action);
    if (!rate.ok) return rate;
    return { ok: true };
  },

  getStats() {
    const now = Date.now();
    const activeBuckets = {};
    for (const [key, bucket] of Object.entries(this._buckets)) {
      if (now < bucket.resetAt) {
        activeBuckets[key] = { count: bucket.count, expiresIn: bucket.resetAt - now };
      }
    }
    const openCircuits = {};
    for (const [key, c] of Object.entries(this._circuits)) {
      if (c.failures > 0 || now < c.openUntil) {
        openCircuits[key] = { failures: c.failures, isOpen: now < c.openUntil, cooldownRemaining: Math.max(0, c.openUntil - now) };
      }
    }
    return { activeBuckets, openCircuits };
  },

  reset() {
    this._buckets = {};
    this._circuits = {};
  }
};

self.CobraGuard = CobraGuard;
console.log('[cobra-guard.js] Loaded: Guard (rate limit 10s + circuit breaker)');
