# ADR-0003: Circuit Breaker + Per-Action Rate Limiting

**Status**: Accepted

**Date**: 2024-03-27

**Author**: Architecture Team

---

## Context

COBRA needed resilience against:
1. **Thundering herd**: User submits 100 chat messages/sec
2. **Cascading failures**: API down, browser tries infinitely
3. **Resource exhaustion**: Rate limit DoS attacks
4. **Service degradation**: Graceful handling when provider is slow

We considered two approaches:
1. **Static rate limits** (quota per domain per hour): Simple but inflexible
2. **Adaptive rate limiting + circuit breaker**: Complex but resilient

---

## Decision

Implement a **two-tier defense system**:

### Tier 1: CobraGuard (Per-Action, Per-Hostname)

**Rate Limiting** (10-second sliding window):
```javascript
// Write actions: 10 req/10s
// Read actions: 40 req/10s
// Per hostname::action pair (e.g., "example.com::click_element")

const result = CobraGuard.checkRateLimit(url, action);
if (!result.ok) {
  throw {code: 'RATE_LIMITED', reason: result.reason};
}
```

**Circuit Breaker** (5 failures → 30s cooldown):
```javascript
// Track failures per hostname::action
// After 5 consecutive failures: OPEN circuit for 30s
// During OPEN: all requests rejected immediately

CobraGuard.registerFailure(url, action);  // increments counter
CobraGuard.registerSuccess(url, action);  // resets counter

const result = CobraGuard.checkCircuit(url, action);
if (!result.ok) {
  throw {code: 'CIRCUIT_OPEN', reason: result.reason};
}
```

### Tier 2: RateLimiter (Global, Per-Domain, Time-based)

**Domain-specific quotas** (hourly, daily):
```javascript
RateLimiter.limits = {
  'linkedin.com': {perHour: 20, perDay: 80, minInterval: 8s},
  'google.com': {perHour: 30, perDay: 150, minInterval: 3s},
  'default': {perHour: 60, perDay: 300, minInterval: 1500ms}
};
```

**Combined check flow:**
```
Message arrives
    ↓
[1] CobraContracts.validateMessage() — structure valid?
    ↓
[2] CobraGuard.check(url, action)
    ├─ checkCircuit() — is circuit open?
    └─ checkRateLimit() — bucket under limit?
    ↓
[3] RateLimiter.canRequest(url) — domain quota OK?
    ↓
[4] Handler execution
    ↓
CobraGuard.registerSuccess() or registerFailure()
```

---

## Consequences

### Positive

1. **DoS Prevention**: Distributed rate limiting per hostname::action
   ```javascript
   // Attacker sends 1000 requests to example.com::fill_form
   // After 10 requests/10s, blocked
   // Circuit opens after 5 failures, 30s protection
   ```

2. **Graceful Degradation**: Circuit breaker prevents cascading failures
   ```javascript
   // API is down
   // First 5 requests fail
   // Circuit opens
   // Subsequent requests fail immediately (no timeout wait)
   // User notified quickly
   ```

3. **Per-Provider Resilience**: Different limits for different domains
   ```javascript
   // LinkedIn has strict limits (20/hour)
   // Google more generous (30/hour)
   // Unknown domains default (60/hour)
   ```

4. **Minimal Overhead**: Rate limit check is <1ms
   ```javascript
   // Simple bucket lookup: O(1)
   // Circuit check: O(1)
   // No database queries
   ```

### Negative

1. **Shared state complexity**: Must track state per hostname::action
   - Mitigation: Simple Map, memory bounded

2. **Hard-coded limits**: May not fit all use cases
   - Mitigation: Settable per user in settings (future)

3. **False positives**: Legitimate bursts blocked
   - Mitigation: 10s window is short, allows averaging

4. **Coordination**: Multiple tabs/windows share state
   - Mitigation: Extension is single service worker, shared state is feature

---

## Implementation Details

### CobraGuard Rate Limiter

```javascript
const CobraGuard = {
  _buckets: {
    // "hostname::action" → {count, resetAt}
    "example.com::click_element": {count: 8, resetAt: 1680000010000}
  },

  checkRateLimit(url, action) {
    const key = this._key(url, action);
    const now = Date.now();
    const bucket = this._buckets[key] || {count: 0, resetAt: now + 10000};

    if (now > bucket.resetAt) {
      // Window expired
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
        reason: `Rate limit: ${bucket.count}/${limit} in 10s`
      };
    }

    return {ok: true};
  }
}
```

### Circuit Breaker State

```javascript
const CobraGuard = {
  _circuits: {
    // "hostname::action" → {failures, openUntil}
    "api.example.com::execute_js": {failures: 5, openUntil: 1680000030000}
  },

  registerFailure(url, action) {
    const key = this._key(url, action);
    const c = this._circuits[key] || {failures: 0, openUntil: 0};
    c.failures += 1;

    if (c.failures >= 5) {
      // Circuit opens
      c.openUntil = Date.now() + 30000;  // 30s cooldown
      c.failures = 0;
      console.warn(`[CobraGuard] Circuit OPEN for ${key}`);
    }

    this._circuits[key] = c;
  },

  checkCircuit(url, action) {
    const key = this._key(url, action);
    const c = this._circuits[key];
    if (!c || Date.now() >= c.openUntil) {
      return {ok: true};  // Not open (or reopened)
    }

    // Still in cooldown
    return {
      ok: false,
      code: 'CIRCUIT_OPEN',
      reason: `Circuit breaker active until ${new Date(c.openUntil).toLocaleTimeString()}`
    };
  }
}
```

### RateLimiter (Domain-based)

```javascript
const RateLimiter = {
  _tracking: {
    'example.com': {
      timestamps: [],           // Last hour
      dailyCount: 0,
      dailyReset: (tomorrow at midnight),
      consecutive: 0,
      lastRequest: 1680000000000
    }
  },

  canRequest(url) {
    const domain = this._getDomain(url);
    const tracking = this._getTracking(domain);
    const limits = this._getLimits(domain);

    // Check hourly
    if (tracking.timestamps.length >= limits.perHour) {
      const waitUntil = tracking.timestamps[0] + 3600000;
      return {
        ok: false,
        reason: 'Hourly limit reached',
        retryAfter: waitUntil - Date.now()
      };
    }

    // Check daily
    if (tracking.dailyCount >= limits.perDay) {
      return {
        ok: false,
        reason: 'Daily limit reached',
        retryAfter: tracking.dailyReset - Date.now()
      };
    }

    // Check minimum interval
    const timeSinceLastRequest = Date.now() - tracking.lastRequest;
    if (timeSinceLastRequest < limits.minInterval) {
      return {
        ok: false,
        reason: `Minimum interval: ${limits.minInterval}ms`,
        retryAfter: limits.minInterval - timeSinceLastRequest
      };
    }

    return {ok: true};
  }
}
```

---

## Configuration

### Current Limits

| Aspect | Value | Rationale |
|--------|-------|-----------|
| CobraGuard window | 10s | Short enough for burst detection |
| Write action limit | 10/10s | Prevent form spam |
| Read action limit | 40/10s | Allow scraped searches |
| Circuit threshold | 5 failures | Reasonable before giving up |
| Circuit cooldown | 30s | Long enough for API recovery |
| LinkedIn/hour | 20 | Known strict limits |
| Google/hour | 30 | Known moderate limits |
| Default/hour | 60 | Conservative estimate |

### Future Tuning

```javascript
// Example: User can adjust in settings
{
  rateLimit: 'strict' | 'balanced' | 'aggressive',

  // strict: Guard 5/10s, Domain limits halved
  // balanced: Guard 10/10s (default)
  // aggressive: Guard 20/10s, Domain limits doubled
}
```

---

## Alternatives Considered

### A. No Rate Limiting
```javascript
// Let requests through, API handles throttling
// Cons: User sees errors, no protection against abuse
```

### B. Static Hourly Quota Only
```javascript
// Simple but doesn't protect against burst
// User can do 20 requests in 1 second, then blocked for 59min
```

### C. Circuit Breaker Only (No sliding window)
```javascript
// Protects against cascades but allows DoS via slow requests
// 5 requests @ 1req/min = no circuit protection
```

### D. Circuit Breaker + Sliding Window (Selected)
```javascript
// Two-layer defense
// Sliding window catches bursts
// Circuit breaker catches cascades
```

---

## Monitoring

```javascript
// Get current guard state
const stats = CobraGuard.getStats();
// {
//   activeBuckets: {
//     'example.com::click_element': {count: 8, expiresIn: 3000}
//   },
//   openCircuits: {
//     'api.example.com::fetch': {failures: 5, isOpen: true, cooldownRemaining: 12000}
//   }
// }

// Reset all limits (admin action)
CobraGuard.reset();

// Audit log shows when rate limit or circuit triggered
CobraAudit.query({
  category: 'guard',
  result: 'blocked'
});
```

---

## References

- Circuit Breaker Pattern: https://martinfowler.com/bliki/CircuitBreaker.html
- Token Bucket Algorithm: https://en.wikipedia.org/wiki/Token_bucket
- Sliding Window Rate Limiting: https://stripe.com/blog/rate-limiters
- Chrome Extension Limits: https://developer.chrome.com/docs/extensions/mv3/limits/
