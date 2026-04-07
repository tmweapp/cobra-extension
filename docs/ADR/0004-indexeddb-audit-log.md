# ADR-0004: IndexedDB for Audit Logging with 7-Day TTL

**Status**: Accepted

**Date**: 2024-03-27

---

## Context

COBRA needed audit logging for:
1. Compliance (immutable record of actions)
2. Debugging (trace issues post-facto)
3. Performance analysis (latencies per action type)
4. Security (detect malicious patterns)

Options evaluated:
- chrome.storage.local (too small, unstructured)
- Cloud sync (privacy concern, requires network)
- IndexedDB (local, queryable, good size)

---

## Decision

Use **IndexedDB** for audit log with:
- **Append-only writes** (immutability via never updating/deleting)
- **7-day TTL** (auto-cleanup of old entries)
- **Max 10,000 entries** (prevents unbounded growth)
- **Indexes** on timestamp, action, category, hostname for querying

```javascript
const CobraAudit = {
  _DB_NAME: 'cobra_audit',
  _STORE: 'entries',
  _MAX_ENTRIES: 10000,
  _RETENTION_MS: 7 * 24 * 60 * 60 * 1000,

  async init() {
    // Open/create IndexedDB
    this._db = await openIndexedDB('cobra_audit', 1);

    // Store schema: entries (keyPath: 'id', autoIncrement)
    // Indexes: ts, action, category, hostname
  },

  log({action, category, hostname, result, details, durationMs}) {
    const entry = {
      ts: Date.now(),
      action,
      category,        // 'chat'|'tool'|'comms'|'job'|'kb'|'guard'|'policy'
      hostname,
      result,          // 'ok'|'fail'|'blocked'|'aborted'
      details,
      durationMs,
      date: new Date().toISOString()
    };

    this._write(entry);  // Async, fire-and-forget
  },

  async query(filter = {}) {
    // Query by category, action, hostname, result, time range
    // Returns up to limit entries, newest first
  },

  async getStats() {
    // Aggregate stats: total, last 24h, by category, top actions
  },

  async export(filter = {}) {
    // Export as JSON for archival
  }
}
```

---

## Consequences

### Positive

1. **Compliance ready**: Immutable append-only log
   - Can export for external archival
   - 7-day minimum retention guaranteed

2. **Queryable**: Indexes on common dimensions
   ```javascript
   // Query by time range, category, action, hostname
   const fails = await CobraAudit.query({
     category: 'tool',
     result: 'fail',
     since: Date.now() - 86400000
   });
   ```

3. **On-device privacy**: No network calls, no cloud storage
   - User data never leaves device
   - Disabled users have no visibility into logs

4. **Efficient**: No startup cost (doesn't load all entries)
   - Indexes enable fast queries
   - TTL cleanup prevents bloat

### Negative

1. **Chrome quota limits**: Typical 50MB storage limit
   - Mitigation: 10k entries = ~5MB, well under limit

2. **No persistence across uninstall**: IndexedDB cleared
   - Mitigation: User can export before uninstalling

3. **No distribution**: Can't sync across devices
   - Mitigation: User can export and import on new device

4. **Privacy implications**: All action logged, including user patterns
   - Mitigation: User can query/export to see what's recorded

---

## Implementation

### Schema

```javascript
// IndexedDB database: cobra_audit
// Object store: entries

// Entry structure:
{
  id: 1,                                    // autoIncrement
  ts: 1680000000000,                        // Timestamp (milliseconds)
  action: 'click_element',                  // Action name
  category: 'tool',                         // Category
  hostname: 'example.com',                  // Source domain
  result: 'ok',                             // Result: ok|fail|blocked|aborted
  details: 'Selector: #button',             // Optional details
  durationMs: 145,                          // Execution time
  date: '2024-03-27T14:26:40Z'              // ISO string for readability
}

// Indexes:
// - ts: For time-range queries
// - action: For filtering by action
// - category: For filtering by category
// - hostname: For per-domain analysis
```

### Logging Patterns

```javascript
// Chat action
CobraAudit.logChat('CHAT_MESSAGE', 'ok', {
  tokenCount: 87
});

// Tool action
CobraAudit.logTool('click_element', 'example.com', 'ok', 145, {
  selector: '#submit'
});

// Communications
CobraAudit.logComms('send_email', 'ok', {
  recipient: '[EMAIL]'  // Sanitized
});

// Policy enforcement
CobraAudit.logPolicy('blocked_action', 'untrusted.com', 'fail', {
  reason: 'Domain blacklisted'
});

// Guard enforcement
CobraAudit.logGuard('rate_limited', 'example.com', 'blocked', {
  limit: '10/10s'
});
```

### Query Examples

```javascript
// Last 100 actions
const recent = await CobraAudit.query({limit: 100});

// Failed tool actions on example.com in last 24h
const fails = await CobraAudit.query({
  category: 'tool',
  hostname: 'example.com',
  result: 'fail',
  since: Date.now() - 86400000,
  limit: 50
});

// Top 10 actions by frequency
const stats = await CobraAudit.getStats();
// {
//   total: 1245,
//   last24h: 342,
//   byCategory: {chat: 100, tool: 200, comms: 42},
//   topActions: [
//     {action: 'click_element', count: 78},
//     {action: 'CHAT_MESSAGE', count: 52}
//   ]
// }
```

### Export Format

```javascript
const exported = await CobraAudit.export({
  since: Date.now() - 604800000  // Last 7 days
});

// {
//   exportedAt: '2024-03-27T14:30:00Z',
//   version: '5.2',
//   count: 342,
//   entries: [
//     {ts, action, category, hostname, result, details, durationMs, date},
//     ...
//   ]
// }

// User can save as JSON, import into analytics, etc.
```

---

## Retention Policy

```javascript
// Auto-cleanup on init
async _cleanup() {
  const cutoff = Date.now() - this._RETENTION_MS;  // 7 days ago

  // Delete all entries older than cutoff
  const deleted = await this._deleteOlderThan(cutoff);
  console.log(`[CobraAudit] Cleanup: deleted ${deleted} entries`);
}

// Cleanup runs:
// - On extension init
// - Periodically (optional, future enhancement)
// - After max entries reached (FIFO)
```

---

## Alternatives Considered

### A. chrome.storage.local (Key-value store)
```javascript
// Pros: Simple, built-in
// Cons: Small quota (10KB), unstructured, slow queries
// Result: Rejected — too small for comprehensive audit log
```

### B. Cloud Sync (Supabase, Firebase)
```javascript
// Pros: Distributed, permanent
// Cons: Privacy concern, requires network, API costs
// Result: Rejected — user preference is local-first
```

### C. Server-side logging
```javascript
// Pros: Permanent, searchable, compliant
// Cons: Complex infrastructure, privacy issues, overkill for extension
// Result: Rejected — local-first + export is sufficient
```

### D. IndexedDB (Selected)
```javascript
// Pros: Local, queryable, good performance, sufficient quota
// Cons: Lost on uninstall (mitigated by export)
// Result: Accepted — best balance for extension use case
```

---

## Security Implications

**Audit Log Protection:**
- Append-only (no update/delete of existing entries)
- Encrypted at rest by Chrome (automatic)
- No exposure to content scripts (IndexedDB not accessible from page context)
- Sanitized details (email → [EMAIL], tokens masked)

**Privacy:**
- User can query/export to see what's logged
- User can delete entire log (uninstall extension)
- No transmission to external servers
- TTL prevents indefinite data accumulation

---

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Log write | <50ms | Async, doesn't block |
| Query 100 entries | <100ms | Index scan |
| Full export | <200ms | Serialize 10k entries |
| Cleanup | <500ms | Delete old entries |

---

## References

- IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- Audit Logging Best Practices: https://owasp.org/www-project-secure-logging/
- Chrome Storage Quota: https://developer.chrome.com/docs/extensions/reference/storage/
