# COBRA v5.2 — Message API Reference

## Overview

COBRA uses a message-based architecture with two protocols:
1. **Type-based (COBRA)**: Modern, recommended protocol with structured payloads
2. **Action-based (Legacy)**: For backward compatibility

All messages are validated by **CobraContracts** before dispatch and logged to **CobraAudit**.

---

## Message Contract Validation

**CobraContracts** enforces:
- Message must be a JSON object
- Must contain `type` OR `action` field
- Type/action must be in ALLOWED list
- Payload size must not exceed 50KB
- String fields must not exceed size limits

```javascript
// ✅ Valid COBRA message
{
  type: 'CHAT_MESSAGE',
  payload: {
    message: 'What is on this page?',
    context: { url: 'https://example.com', title: 'Example' }
  }
}

// ✅ Valid Action message
{
  action: 'FILE_SAVE',
  filename: 'report.txt',
  content: 'Sales data Q1 2024'
}

// ❌ Invalid (missing action)
{ type: 'unknown' }

// ❌ Invalid (payload too large)
{ type: 'CHAT_MESSAGE', payload: { message: '[50KB string]' } }
```

---

## Size Limits

| Limit | Value | Purpose |
|-------|-------|---------|
| MAX_MESSAGE_LENGTH | 50KB | Entire message serialized |
| MAX_STRING | 5KB | Generic text fields |
| MAX_GOAL | 2KB | Chat message content |
| MAX_SELECTOR | 500B | CSS/XPath selector |
| MAX_URL | 2048B | URL field |

---

## ALLOWED_TYPES — Type-Based Protocol

### CHAT_MESSAGE
User chat input with optional context.

```javascript
{
  type: 'CHAT_MESSAGE',
  payload: {
    message: string,              // (required) User input, max 2KB
    context?: object,             // Optional: {url, title, content}
    toolCall?: boolean,           // Optional: allow tool execution
    agentId?: string              // Optional: route to specific agent
  }
}
```

**Response:**
```javascript
{
  response: string,               // AI-generated text
  timestamp: number,              // Unix milliseconds
  usage?: { promptTokens, completionTokens }
}
```

**Example:**
```javascript
// Request
chrome.runtime.sendMessage({
  type: 'CHAT_MESSAGE',
  payload: {
    message: 'Extract all product names from this page',
    context: {
      url: 'https://shop.example.com/products',
      title: 'Product Listing'
    },
    toolCall: true
  }
}, response => {
  console.log('Response:', response.response);
});
```

---

### CHAT_ABORT
Abort ongoing streaming response.

```javascript
{
  type: 'CHAT_ABORT'
}
```

**Response:**
```javascript
{
  ok: true,
  aborted: boolean
}
```

---

### SCRAPE
Extract structured data from a single URL.

```javascript
{
  type: 'SCRAPE',
  payload: {
    url: string,                  // (required) Target URL
    selector?: string,            // CSS selector to scrape
    extractType?: 'text'|'html'|'table'|'all'
  }
}
```

**Response:**
```javascript
{
  url: string,
  content: string | object,       // Extracted data
  type: string,                   // extraction type
  timestamp: number
}
```

---

### BATCH_SCRAPE
Scrape multiple URLs in parallel.

```javascript
{
  type: 'BATCH_SCRAPE',
  payload: {
    urls: string[],
    selector?: string,
    extractType?: string,
    concurrency?: number          // Default: 3
  }
}
```

**Response:**
```javascript
{
  results: [{url, content, success, error}],
  completed: number,
  failed: number,
  timestamp: number
}
```

---

### CRAWL
Recursive crawl starting from a seed URL.

```javascript
{
  type: 'CRAWL',
  payload: {
    seedUrl: string,
    maxDepth?: number,             // Default: 2
    maxPages?: number,             // Default: 50
    selectorPattern?: string,
    followPattern?: RegExp|string
  }
}
```

**Response:**
```javascript
{
  seedUrl: string,
  pagesVisited: number,
  pagesScraped: number,
  results: [{url, content}],
  timestamp: number
}
```

---

### GET_BRAIN / SET_BRAIN
Get or set the system knowledge base.

```javascript
{
  type: 'GET_BRAIN'
}
```

**Response:**
```javascript
{
  entries: number,
  size: string,                   // Human-readable size
  lastUpdate: number,
  data: [{id, title, content, tags}]
}
```

```javascript
{
  type: 'SET_BRAIN',
  payload: {
    entries: [{title, content, tags}],
    merge?: boolean               // Default: true (merge vs replace)
  }
}
```

---

### GET_SETTINGS / SET_SETTINGS
Retrieve or update extension configuration.

```javascript
{
  type: 'GET_SETTINGS'
}
```

**Response:**
```javascript
{
  stealth: boolean,
  localMemory: boolean,
  cloudSync: boolean,
  learning: boolean,
  kb: boolean,
  notifications: boolean,
  rateLimit: 'strict'|'balanced'|'aggressive',
  language: string,
  // ... more fields
}
```

```javascript
{
  type: 'SET_SETTINGS',
  payload: {
    key: string,                  // e.g., 'stealth', 'rateLimit'
    value: any
  }
}
```

---

### TAB_INFO / PAGE_CONTEXT
Get current tab or page information.

```javascript
{
  type: 'TAB_INFO'
}
```

**Response:**
```javascript
{
  tabId: number,
  url: string,
  title: string,
  favicon: string,
  active: boolean,
  incognito: boolean
}
```

```javascript
{
  type: 'PAGE_CONTEXT'
}
```

**Response:**
```javascript
{
  url: string,
  title: string,
  description: string,
  keywords: string[],
  lang: string,
  content: string                 // First 5000 chars
}
```

---

### SUPERVISOR_HEALTH
Health check for background worker.

```javascript
{
  type: 'SUPERVISOR_HEALTH'
}
```

**Response:**
```javascript
{
  ok: true,
  uptime: number,                 // Milliseconds
  memory: object,                 // {used, limit}
  routerReady: boolean,
  auditReady: boolean,
  guard: object                   // {activeBuckets, openCircuits}
}
```

---

### PING / HEALTH_CHECK
Simple keepalive messages.

```javascript
{
  type: 'PING'
}
```

**Response:**
```javascript
{
  pong: true,
  timestamp: number
}
```

---

## ALLOWED_ACTIONS — Action-Based Protocol (Legacy)

### Communication (COMM_*)

#### COMM_SEND_EMAIL
```javascript
{
  action: 'COMM_SEND_EMAIL',
  to: string,                     // Recipient email
  subject: string,
  body: string,
  html?: boolean,
  attachments?: [{name, content}]
}
```

**Response:** `{ok: true, messageId: string}`

---

#### COMM_TEST
Test email configuration.

```javascript
{
  action: 'COMM_TEST',
  provider: 'imap'|'smtp'         // Which to test
}
```

---

#### COMM_SEND_WA
Send WhatsApp message.

```javascript
{
  action: 'COMM_SEND_WA',
  number: string,
  message: string
}
```

---

#### COMM_WA_CHAT_LIST
List open WhatsApp chats.

```javascript
{
  action: 'COMM_WA_CHAT_LIST',
  limit?: number                  // Default: 20
}
```

---

### File Operations (FILE_*)

#### FILE_LIST
List files in connected folder.

```javascript
{
  action: 'FILE_LIST',
  folderHandle?: object,          // File System Access API handle
  pattern?: string                // Glob pattern (*.txt)
}
```

**Response:**
```javascript
{
  files: [{name, size, type, modified}],
  count: number
}
```

---

#### FILE_READ
Read file contents.

```javascript
{
  action: 'FILE_READ',
  filename: string,
  encoding?: 'utf-8'|'base64'     // Default: utf-8
}
```

**Response:**
```javascript
{
  filename: string,
  content: string,
  size: number
}
```

---

#### FILE_SAVE
Save or create file.

```javascript
{
  action: 'FILE_SAVE',
  filename: string,
  content: string,
  overwrite?: boolean             // Default: true
}
```

---

### Knowledge Base (KB_*)

#### KB_SEARCH
Full-text search knowledge base.

```javascript
{
  action: 'KB_SEARCH',
  query: string,
  limit?: number,                 // Default: 10
  threshold?: number              // Relevance threshold 0-1
}
```

**Response:**
```javascript
{
  results: [{id, title, content, relevance}],
  count: number
}
```

---

#### KB_SAVE
Add new entry to knowledge base.

```javascript
{
  action: 'KB_SAVE',
  title: string,
  content: string,
  tags?: string[]
}
```

**Response:** `{ok: true, id: string}`

---

#### KB_UPDATE
Update existing KB entry.

```javascript
{
  action: 'KB_UPDATE',
  id: string,
  title?: string,
  content?: string,
  tags?: string[]
}
```

---

#### KB_STATS
Get knowledge base statistics.

```javascript
{
  action: 'KB_STATS'
}
```

**Response:**
```javascript
{
  totalEntries: number,
  totalSize: string,
  tagCloud: {tag: count},
  lastUpdate: number
}
```

---

### Jobs (JOB_* / PJOB_*)

#### JOB_CREATE
Create a new job (one-time execution).

```javascript
{
  action: 'JOB_CREATE',
  name: string,
  steps: [{action, payload}],
  retryCount?: number,            // Default: 3
  timeoutMs?: number              // Default: 60000
}
```

**Response:** `{ok: true, jobId: string}`

---

#### JOB_START
Execute a job immediately.

```javascript
{
  action: 'JOB_START',
  jobId: string
}
```

**Response:**
```javascript
{
  jobId: string,
  status: 'running'|'queued',
  runId: string,
  startedAt: number
}
```

---

#### JOB_PAUSE / JOB_RESUME / JOB_CANCEL
Manage job execution.

```javascript
{
  action: 'JOB_PAUSE',
  jobId: string,
  runId?: string
}
```

---

#### PJOB_* (Persistent Jobs)

Persistent jobs are scheduled (cron-like) with recurring execution.

```javascript
{
  action: 'PJOB_CREATE',
  name: string,
  schedule: string,               // Cron: '0 9 * * *' (daily 9am)
  steps: [{action, payload}]
}
```

**Response:** `{ok: true, pjobId: string}`

---

### Persistence (PERSIST_*)

#### PERSIST_SAVE
Save data to extension storage.

```javascript
{
  action: 'PERSIST_SAVE',
  key: string,
  value: any,
  ttl?: number                    // TTL in ms
}
```

---

#### PERSIST_GET
Retrieve persisted data.

```javascript
{
  action: 'PERSIST_GET',
  key: string
}
```

---

### IndexedDB (IDB_*)

#### IDB_SAVE
Store document in IndexedDB.

```javascript
{
  action: 'IDB_SAVE',
  store: string,
  document: object
}
```

---

#### IDB_SEARCH
Query IndexedDB store.

```javascript
{
  action: 'IDB_SEARCH',
  store: string,
  query: object,                  // {field: value}
  limit?: number
}
```

---

### Audit & Monitoring (AUDIT_*, GUARD_*, SELECTOR_*)

#### AUDIT_QUERY
Query audit log.

```javascript
{
  action: 'AUDIT_QUERY',
  filter?: {
    category?: string,            // 'chat'|'tool'|'comms'|'policy'|'guard'|'system'|'job'|'kb'
    action?: string,
    hostname?: string,
    result?: 'ok'|'fail'|'blocked'|'aborted',
    since?: number                // Unix timestamp
  },
  limit?: number                  // Default: 100
}
```

**Response:**
```javascript
{
  entries: [{ts, action, category, hostname, result, details, durationMs}],
  count: number
}
```

---

#### AUDIT_STATS
Get audit log statistics.

```javascript
{
  action: 'AUDIT_STATS'
}
```

**Response:**
```javascript
{
  total: number,
  last24h: number,
  last1h: number,
  byCategory: {chat: 100, tool: 250, ...},
  byResult: {ok: 300, fail: 10, blocked: 5, aborted: 2},
  topActions: [{action: 'click_element', count: 45}, ...],
  oldestEntry: string,            // ISO date
  newestEntry: string             // ISO date
}
```

---

#### GUARD_STATS
Get rate limiter & circuit breaker stats.

```javascript
{
  action: 'GUARD_STATS'
}
```

**Response:**
```javascript
{
  activeBuckets: {
    'example.com::fill_form': {count: 8, expiresIn: 2340}
  },
  openCircuits: {
    'api.example.com::click_element': {failures: 5, isOpen: true, cooldownRemaining: 15000}
  }
}
```

---

#### GUARD_RESET
Reset all rate limiting & circuit state.

```javascript
{
  action: 'GUARD_RESET'
}
```

---

## Error Response Format

All errors follow a standard structure:

```javascript
{
  error: string,                  // Human-readable message
  code: string,                   // Machine-readable code from COBRA_ERRORS
  severity: 'info'|'warn'|'error'|'fatal',
  timestamp: number
}
```

---

## Error Codes (COBRA_ERRORS)

See `cobra-error-codes.js` for complete list. Common codes:

| Code | Category | Severity | Meaning |
|------|----------|----------|---------|
| INVALID_MESSAGE | general | warn | Malformed message structure |
| UNKNOWN_ACTION | validation | warn | Action not in ALLOWED_ACTIONS |
| MESSAGE_TOO_LARGE | validation | warn | Payload exceeds 50KB |
| NO_ACTIVE_TAB | browser | warn | No tab to work with |
| SELECTOR_NOT_FOUND | dom | warn | CSS selector didn't match |
| ELEMENT_NOT_VISIBLE | dom | warn | Element not visible in viewport |
| RATE_LIMITED | policy | warn | CobraGuard rate limit exceeded |
| CIRCUIT_OPEN | policy | warn | Circuit breaker protecting service |
| POLICY_BLOCKED | policy | warn | Domain or trust policy blocks action |
| STORAGE_FULL | storage | error | IndexedDB or storage quota exceeded |
| API_RATE_LIMIT | network | warn | Provider API rate limited |
| API_AUTH_FAILED | network | error | API key invalid or expired |

---

## Complete Request/Response Examples

### Example 1: Chat with Context

**Request:**
```javascript
chrome.runtime.sendMessage({
  type: 'CHAT_MESSAGE',
  payload: {
    message: 'Summarize this product listing',
    context: {
      url: 'https://shop.example.com/product/xyz',
      title: 'Blue Widget - Product Page'
    }
  }
}, response => {
  if (response.error) {
    console.error('Error:', response.error);
  } else {
    console.log('Response:', response.response);
    console.log('Tokens used:', response.usage);
  }
});
```

**Response:**
```javascript
{
  response: 'This is a blue widget priced at $29.99. It features...',
  timestamp: 1680000000000,
  usage: {
    promptTokens: 120,
    completionTokens: 87
  }
}
```

---

### Example 2: Scrape with Selector

**Request:**
```javascript
chrome.runtime.sendMessage({
  type: 'SCRAPE',
  payload: {
    url: 'https://example.com/articles',
    selector: 'article.post',
    extractType: 'text'
  }
}, response => {
  console.log('Extracted:', response.content);
});
```

**Response:**
```javascript
{
  url: 'https://example.com/articles',
  content: ['Article 1 title and content...', 'Article 2...'],
  type: 'text',
  timestamp: 1680000000000
}
```

---

### Example 3: Audit Query

**Request:**
```javascript
chrome.runtime.sendMessage({
  action: 'AUDIT_QUERY',
  filter: {
    category: 'tool',
    hostname: 'example.com',
    result: 'fail',
    since: Date.now() - 86400000  // Last 24h
  },
  limit: 50
}, response => {
  console.log('Failed tool actions:', response.entries);
});
```

**Response:**
```javascript
{
  entries: [
    {
      ts: 1679999999000,
      action: 'click_element',
      category: 'tool',
      hostname: 'example.com',
      result: 'fail',
      details: 'Selector not found: #old-button',
      durationMs: 145
    }
  ],
  count: 1
}
```

---

### Example 4: Job Creation & Execution

**Request:**
```javascript
chrome.runtime.sendMessage({
  action: 'JOB_CREATE',
  name: 'Scrape and Email Report',
  steps: [
    {
      action: 'SCRAPE',
      payload: {url: 'https://example.com/sales', selector: '.total'}
    },
    {
      action: 'COMM_SEND_EMAIL',
      payload: {
        to: 'boss@example.com',
        subject: 'Daily Sales Report',
        body: 'Attached: Latest sales figures'
      }
    }
  ]
}, response => {
  console.log('Job created:', response.jobId);

  // Start it
  chrome.runtime.sendMessage({
    action: 'JOB_START',
    jobId: response.jobId
  });
});
```

---

## Testing & Debugging

**Chrome Extension Console:**
```javascript
// Test a message directly
chrome.runtime.sendMessage({type: 'PING'}, r => console.log(r));

// Check guard stats
chrome.runtime.sendMessage({action: 'GUARD_STATS'}, r => console.log(r));

// Query recent failures
chrome.runtime.sendMessage({
  action: 'AUDIT_QUERY',
  filter: {result: 'fail'},
  limit: 20
}, r => console.log(r));
```

**Audit Log Viewer:**
```javascript
// Export audit log as JSON
chrome.runtime.sendMessage({
  action: 'AUDIT_EXPORT',
  filter: {since: Date.now() - 604800000} // Last 7 days
}, r => {
  const blob = new Blob([JSON.stringify(r, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cobra-audit-${new Date().toISOString()}.json`;
  a.click();
});
```

---

## References

- **Message Protocol Versioning**: Maintained in manifest.json `version` field
- **Contract Validation**: `/cobra-contracts.js`
- **Error Codes**: `/cobra-error-codes.js`
- **Router Implementation**: `/bg-router.js`, `/cobra-router.js`
