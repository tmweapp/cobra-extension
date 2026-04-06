// COBRA v3 — Rate Limiter Module
// Fix: retryAfter non più cappato a 60s, domain matching case-insensitive

const RateLimiter = {

  // ============================================================
  // 1. LIMITI PER DOMINIO
  // ============================================================
  limits: {
    'linkedin.com': {
      perHour: 20, perDay: 80, minInterval: 8000,
      cooldownAfterBurst: 300000, burstThreshold: 10,
    },
    'google.com': {
      perHour: 30, perDay: 150, minInterval: 3000,
      cooldownAfterBurst: 120000, burstThreshold: 15,
    },
    'default': {
      perHour: 60, perDay: 300, minInterval: 1500,
      cooldownAfterBurst: 60000, burstThreshold: 20,
    }
  },

  // ============================================================
  // 2. TRACKING
  // ============================================================
  _tracking: {},

  _getTracking(domain) {
    if (!this._tracking[domain]) {
      this._tracking[domain] = {
        timestamps: [], dailyCount: 0,
        dailyReset: this._endOfDay(),
        consecutive: 0, lastRequest: 0,
      };
    }
    const t = this._tracking[domain];
    if (Date.now() > t.dailyReset) {
      t.dailyCount = 0;
      t.dailyReset = this._endOfDay();
    }
    const oneHourAgo = Date.now() - 3600000;
    t.timestamps = t.timestamps.filter(ts => ts > oneHourAgo);
    return t;
  },

  _endOfDay() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  },

  _getDomain(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  },

  _getLimits(domain) {
    const d = domain.toLowerCase();
    for (const [key, limits] of Object.entries(this.limits)) {
      if (key === 'default') continue;
      if (d === key || d.endsWith('.' + key)) return limits;
    }
    return this.limits.default;
  },

  // ============================================================
  // 3. CHECK
  // ============================================================
  canRequest(url) {
    const domain = this._getDomain(url);
    const tracking = this._getTracking(domain);
    const limits = this._getLimits(domain);

    if (tracking.timestamps.length >= limits.perHour) {
      const waitUntil = tracking.timestamps[0] + 3600000;
      return {
        allowed: false,
        reason: `Limite orario raggiunto per ${domain} (${limits.perHour}/h)`,
        retryAfter: Math.max(0, waitUntil - Date.now()),
      };
    }

    if (tracking.dailyCount >= limits.perDay) {
      return {
        allowed: false,
        reason: `Limite giornaliero raggiunto per ${domain} (${limits.perDay}/giorno)`,
        retryAfter: Math.max(0, tracking.dailyReset - Date.now()),
      };
    }

    const timeSinceLast = Date.now() - tracking.lastRequest;
    if (timeSinceLast < limits.minInterval) {
      return {
        allowed: false,
        reason: 'Troppo veloce',
        retryAfter: Math.max(0, limits.minInterval - timeSinceLast),
      };
    }

    // Time-based burst reset: if cooldownAfterBurst time passed, reset consecutive
    if (tracking.consecutive > 0 && Date.now() - tracking.lastRequest > limits.cooldownAfterBurst) {
      tracking.consecutive = 0;
    }

    if (tracking.consecutive >= limits.burstThreshold) {
      return {
        allowed: false,
        reason: `Cooldown dopo ${limits.burstThreshold} richieste consecutive`,
        retryAfter: Math.max(0, limits.cooldownAfterBurst),
        isCooldown: true,
      };
    }

    return { allowed: true };
  },

  // ============================================================
  // 4. REGISTRA
  // ============================================================
  recordRequest(url) {
    const domain = this._getDomain(url);
    const tracking = this._getTracking(domain);
    tracking.timestamps.push(Date.now());
    tracking.dailyCount++;
    tracking.lastRequest = Date.now();
    tracking.consecutive++;
  },

  resetBurst(url) {
    const domain = this._getDomain(url);
    const tracking = this._getTracking(domain);
    tracking.consecutive = 0;
  },

  // ============================================================
  // 5. STATE PERSISTENCE
  // ============================================================
  async saveState() {
    try {
      await chrome.storage.local.set({ rate_limiter_tracking: this._tracking });
    } catch (err) {
      console.error('Failed to save rate limiter state:', err);
    }
  },

  async restoreState() {
    try {
      const stored = await chrome.storage.local.get('rate_limiter_tracking');
      if (stored.rate_limiter_tracking) {
        this._tracking = stored.rate_limiter_tracking;
      }
    } catch (err) {
      console.error('Failed to restore rate limiter state:', err);
    }
  },

  // ============================================================
  // 6. CODA CON PRIORITÀ
  // ============================================================
  _queue: [],
  _processing: false,

  async enqueue(url, priority = 2, options = {}) {
    return new Promise((resolve, reject) => {
      this._queue.push({ url, priority, resolve, reject, options, addedAt: Date.now() });
      this._queue.sort((a, b) => a.priority - b.priority);
      this._processQueue();
    });
  },

  async _processQueue() {
    if (this._processing || this._queue.length === 0) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const item = this._queue[0];
      const now = Date.now();
      const maxWaitTime = 5 * 60 * 1000; // 5 minutes

      // Queue starvation check: reject if item waited too long
      if (now - item.addedAt > maxWaitTime) {
        this._queue.shift();
        item.reject(new Error('Queue timeout: item waited over 5 minutes'));
        continue;
      }

      const check = this.canRequest(item.url);

      if (!check.allowed) {
        if (check.isCooldown) {
          this.resetBurst(item.url);
        }
        // Rispetta il retryAfter reale, max 2 min per non bloccare troppo
        await new Promise(r => setTimeout(r, Math.min(check.retryAfter, 120000)));
        continue;
      }

      this._queue.shift();
      this.recordRequest(item.url);
      await this.saveState();

      try {
        if (item.options.action) {
          const result = await item.options.action();
          item.resolve(result);
        } else {
          item.resolve({ url: item.url, status: 'queued' });
        }
      } catch (err) {
        item.reject(err);
      }

      const domain = this._getDomain(item.url);
      const limits = this._getLimits(domain);
      const delay = limits.minInterval + Math.random() * limits.minInterval;
      await new Promise(r => setTimeout(r, delay));
    }

    this._processing = false;
  },

  // ============================================================
  // 7. STATS
  // ============================================================
  getStats() {
    const stats = {};
    for (const [domain, tracking] of Object.entries(this._tracking)) {
      const limits = this._getLimits(domain);
      stats[domain] = {
        hourly: `${tracking.timestamps.length}/${limits.perHour}`,
        daily: `${tracking.dailyCount}/${limits.perDay}`,
        consecutive: tracking.consecutive,
        queueLength: this._queue.filter(i => this._getDomain(i.url) === domain).length,
      };
    }
    stats._queue = { total: this._queue.length, processing: this._processing };
    return stats;
  },

  getBudget(url) {
    const domain = this._getDomain(url);
    const tracking = this._getTracking(domain);
    const limits = this._getLimits(domain);
    return {
      hourlyRemaining: limits.perHour - tracking.timestamps.length,
      dailyRemaining: limits.perDay - tracking.dailyCount,
    };
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.RateLimiter = RateLimiter;
}
