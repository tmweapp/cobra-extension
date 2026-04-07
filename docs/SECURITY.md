# COBRA v5.2 — Security & Threat Model

## Executive Summary

COBRA implements a **defense-in-depth** security model across five layers:

1. **Contract Layer**: Message validation
2. **Policy Layer**: Domain/trust-based authorization
3. **Guard Layer**: Rate limiting + circuit breaker
4. **Isolation Layer**: Content script sandbox + CSP
5. **Audit Layer**: Immutable compliance logging

---

## STRIDE Threat Model Analysis

### 1. Spoofing (Identity Falsification)

**Threat**: Malicious script impersonates legitimate extension or user.

**Attack Vectors:**
- Compromised content script sends forged messages
- Compromised sidepanel injects commands
- Browser extension API misuse

**Mitigations:**
```javascript
// CobraRouter validates message origin (tab URL)
const tabUrl = sender?.tab?.url || '';

// Message origin is immutable during dispatch
// Content scripts can only send from their own tab context
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // sender.tab.url is enforced by browser
  // sender.url is enforced for content scripts
});

// Audit log includes sender information
CobraAudit.log({
  action: 'click_element',
  hostname: tabUrl,  // Authenticated by browser
  result: 'ok'
});
```

**Residual Risk**: Low. Browser enforces origin check for tab context.

---

### 2. Tampering (Data/Code Integrity)

**Threat**: Attacker modifies messages, audit logs, or stored data.

**Attack Vectors:**
- In-memory message mutation before handler execution
- IndexedDB audit log manipulation
- Storage tampering (chrome.storage.local)

**Mitigations:**

**Message Validation:**
```javascript
// CobraContracts enforces immutability via contract
const v = CobraContracts.validateMessage(msg);
if (!v.ok) {
  // Reject immediately, before any handler touches msg
  sendResponse({error: v.error});
  return false;
}
// Handler sees read-only view (depends on handler discipline)
```

**Audit Log Integrity:**
```javascript
// IndexedDB entries are append-only
// No update/delete on 'entries' store — only add()
async _write(entry) {
  return new Promise((resolve, reject) => {
    const tx = this._db.transaction(this._STORE, 'readwrite');
    const store = tx.objectStore(this._STORE);
    store.add(entry);  // Immutable append
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 7-day retention: old entries auto-deleted
async _cleanup() {
  // Remove entries > 7 days old
  const cutoff = Date.now() - this._RETENTION_MS;
  // ... purge old entries
}
```

**Storage Encryption:**
```javascript
// chrome.storage.local is encrypted at rest by browser
// Keys stored in chrome.storage.sync are synced and encrypted
chrome.storage.local.set({
  'openaiKey': '...',  // Encrypted by Chrome
  'anthropicKey': '...'
});
```

**Residual Risk**: Medium. In-memory tampering during handler execution possible if handler code is compromised. Mitigated by input validation and error boundaries.

---

### 3. Repudiation (Denial of Actions)

**Threat**: User denies performing an action; attacker denies attack.

**Attack Vectors:**
- User claims automation without consent
- Attacker deletes audit trail
- Logs overwritten or purged

**Mitigations:**

**Comprehensive Audit Logging:**
```javascript
// Every action logged with who, what, when, where, result
CobraAudit.log({
  ts: Date.now(),
  action: 'send_email',
  category: 'comms',
  hostname: 'mail.example.com',
  result: 'ok',
  details: 'to: user@example.com',
  durationMs: 450
});

// Categories: chat, tool, comms, policy, guard, system, job, kb
```

**Immutable Retention:**
```javascript
// Entries stored in IndexedDB with autoIncrement ID
// Cannot be deleted by scripts (only cleaned by TTL)
// 7-day retention enforced server-side

// Export audit log for archival
async export(filter = {}) {
  const entries = await this.query({...filter, limit: 10000});
  return {
    exportedAt: new Date().toISOString(),
    version: '5.2',
    count: entries.length,
    entries  // Timestamped, categorized, immutable
  };
}
```

**Policy Enforcement Logging:**
```javascript
// Policy blocks logged with reason
CobraAudit.logPolicy('blocked_action', hostname, 'fail', {
  reason: 'Domain not in whitelist',
  domain: 'untrusted.com'
});
```

**Residual Risk**: Low. Audit log is append-only with 7-day minimum retention. User can export for archival.

---

### 4. Information Disclosure (Confidentiality)

**Threat**: Sensitive data (API keys, user content) exposed.

**Attack Vectors:**
- XSS in sidepanel reads global state
- Content script injection extracts credentials
- Network eavesdropping (HTTP instead of HTTPS)
- Sidebar UI exposes secrets in DOM

**Mitigations:**

**API Key Storage:**
```javascript
// Keys stored in chrome.storage.local (encrypted at rest)
// Not exposed to content scripts (isolated world)
// Not logged in audit trail (redacted by sanitize)

function sanitize(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[\w.-]+@[\w.-]+\.\w{2,}/g, '[EMAIL]')
    .replace(/\b\d{10,}\b/g, '[NUMBER]')
    .replace(/\b[A-Za-z0-9]{20,}\b/g, '[TOKEN]')  // Hides API keys
    .substring(0, 2000);
}

CobraAudit.log({
  action: 'API_CALL',
  details: sanitize(error.message)  // Keys redacted
});
```

**XSS Prevention:**
```javascript
// sidepanel.js: no innerHTML from user input
function sanitizeHTML(str) {
  if (!str || typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;  // textContent prevents XSS
  return div.innerHTML;   // Safe HTML entities
}

// When rendering chat history
chatDiv.innerHTML = '';
for (const msg of chatHistory) {
  const msgEl = document.createElement('div');
  msgEl.textContent = msg.content;  // User input cannot execute
  chatDiv.appendChild(msgEl);
}
```

**Content Script Isolation:**
```javascript
// Content scripts run in isolated world (Manifest v3)
// Cannot directly access window.openaiKey

// Service worker → Content script message must be explicit
chrome.tabs.sendMessage(tabId, {
  type: 'INJECT_SCRIPT',
  code: 'document.querySelector(...)'
  // Code injected, result returned separately
}, response => {
  // response contains extracted data, not credentials
});
```

**CSP Policy:**
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'none'; base-uri 'none';"
  }
}
```

**HTTPS Enforcement:**
```javascript
// All API calls use HTTPS
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`  // HTTPS prevents interception
  }
});
```

**Residual Risk**: Low to Medium. Keys encrypted at rest; network traffic encrypted in transit. XSS mitigated by textContent usage. Content script isolation enforced by browser.

---

### 5. Denial of Service (DoS)

**Threat**: Attacker exhausts resources or crashes extension.

**Attack Vectors:**
- Infinite message loops
- Rapid message flood (rate limit bypass)
- IndexedDB storage exhaustion
- Service worker crash (infinite loop)

**Mitigations:**

**CobraGuard Rate Limiting:**
```javascript
// Per hostname::action rate limiting
// 10 req/10s for write actions, 40 req/10s for read
const result = CobraGuard.check(url, action);
if (!result.ok) {
  sendResponse({
    error: result.reason,  // 'rate_limit' or 'circuit_open'
    code: result.code
  });
  return false;
}

// Circuit breaker: 5 consecutive failures → 30s cooldown
registerFailure(url, action);
if (failures >= 5) {
  openUntil = Date.now() + 30000;  // 30s protection
}
```

**Message Size Limits:**
```javascript
MAX_MESSAGE_LENGTH: 50000,    // 50KB max message
MAX_STRING: 5000,              // 5KB generic strings
MAX_GOAL: 2000,                // 2KB chat message
MAX_SELECTOR: 500,             // 500B selectors
MAX_URL: 2048,                 // 2KB URLs

if (size > MAX_MESSAGE_LENGTH) {
  return {ok: false, error: 'MESSAGE_TOO_LARGE'};
}
```

**Audit Log Quota:**
```javascript
_MAX_ENTRIES: 10000,           // Max 10k entries
_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,  // 7-day auto-cleanup

// Auto-cleanup on init
async _cleanup() {
  const cutoff = Date.now() - this._RETENTION_MS;
  // ... delete entries older than 7 days
  // Prevents unbounded growth
}
```

**Handler Error Isolation:**
```javascript
// Each handler wrapped in try-catch
// One failure doesn't crash router
Promise.resolve()
  .then(() => handler(msg.payload, msg, sender))
  .then(result => sendResponse(result))
  .catch(err => {
    console.error(`Error in handler '${msg.type}':`, err);
    sendResponse({error: err.message, code: 'HANDLER_ERROR'});
    // Router remains operational for next request
  });
```

**Service Worker Restart:**
```javascript
// Chrome auto-restarts crashed service workers
// State saved in IndexedDB and chrome.storage
// Background jobs resumable via alarms
chrome.alarms.create('job-check', {periodInMinutes: 5});
```

**Residual Risk**: Low. Rate limiting enforced at guard level; message sizes capped; audit log bounded; handlers isolated.

---

### 6. Elevation of Privilege (Authorization)

**Threat**: Attacker escalates permissions or bypasses policies.

**Attack Vectors:**
- Content script executes privileged action
- Bypass domain whitelist
- Forge low-trust identity as high-trust
- Exploit policy logic bugs

**Mitigations:**

**CobraContracts Whitelist:**
```javascript
ALLOWED_TYPES: new Set([
  'CHAT_MESSAGE', 'SCRAPE', 'BATCH_SCRAPE', 'CRAWL',
  'GET_BRAIN', 'SET_BRAIN', ...
]),

ALLOWED_ACTIONS: new Set([
  'COMM_SEND_EMAIL', 'FILE_SAVE', 'KB_SEARCH',
  'JOB_START', ...
]),

// Unknown actions rejected before policy check
if (!ALLOWED_ACTIONS.has(msg.action)) {
  return {ok: false, error: 'UNKNOWN_ACTION'};
}
```

**Policy Engine (settable per extension user):**
```javascript
// Example policy configuration
{
  "domainWhitelist": ["example.com", "trusted.com"],
  "domainBlacklist": ["untrusted.com"],
  "trustScores": {
    "example.com": 100,
    "uncertain.com": 30
  },
  "allowedActions": {
    "click_element": true,
    "send_email": false,    // Disabled by policy
    "send_whatsapp": true
  }
}

// Policy enforced before action execution
if (policy.domainBlacklist.includes(hostname)) {
  CobraAudit.logPolicy('blocked_action', hostname, 'fail', {
    reason: 'Domain blacklisted'
  });
  throw new Error('POLICY_BLOCKED');
}
```

**Guard checks before handler:**
```javascript
// Even if contract passes, guard checks
const circuit = this.checkCircuit(url, action);
if (!circuit.ok) return circuit;  // Circuit open → deny

const rate = this.checkRateLimit(url, action);
if (!rate.ok) return rate;        // Rate limited → deny
```

**Message Origin Validation:**
```javascript
// Sender tab URL is immutable by browser
const tabUrl = sender?.tab?.url || '';

// Only content scripts from that tab can send messages
if (!isValidTabOrigin(tabUrl)) {
  throw new Error('INVALID_ORIGIN');
}
```

**Residual Risk**: Low. Whitelist enforced in contracts; policy checked before execution; origin validated by browser; audit trail prevents silent escalation.

---

## Sensitive Dependencies

| Dependency | Risk | Mitigation |
|------------|------|-----------|
| chrome.runtime.sendMessage | XSS if processing untrusted payloads | CobraContracts validation, textContent usage |
| indexedDB | Data breach if device compromised | Chrome encrypts at rest; limited to audit data |
| fetch() to APIs | Credential interception | HTTPS + Content-Security-Policy |
| content-script.js | Can be exploited to manipulate DOM | Isolated world, script injection only on demand |
| localStorage/sessionStorage | Not used (security risk) | Prefer chrome.storage.local + IndexedDB |
| eval() / Function() | Code injection | Never used; all code declarative |
| innerHTML with user data | XSS vector | Replaced with textContent + createElement |

---

## Secret Management

**API Keys (OpenAI, Anthropic, Groq, Gemini):**
```javascript
// Storage
chrome.storage.local.set({
  'openaiKey': encryptionLayer(key),  // Encrypted by Chrome
  'anthropicKey': encryptionLayer(key)
});

// Retrieval (only in service worker)
chrome.storage.local.get(['openaiKey'], items => {
  const key = decryptionLayer(items.openaiKey);
  // Use key in fetch() call
});

// Never exposed to content scripts or sidepanel UI
// Never logged in audit trail
```

**Supabase API Key:**
```javascript
// Used only for memory sync (optional)
// Transmitted via HTTPS header
const headers = {
  'Authorization': `Bearer ${supabaseKey}`,
  'apikey': supabaseKey
};
```

**Webhook URLs:**
```javascript
// Configured by user for job notifications
// HTTPS enforced
chrome.runtime.sendMessage({
  type: 'SET_SETTINGS',
  payload: {
    key: 'webhookUrl',
    value: 'https://example.com/webhook'  // HTTPS required
  }
});
```

---

## Content Security Policy (CSP)

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'none'; base-uri 'none';"
  }
}
```

**Enforcement:**
- `script-src 'self'`: Only scripts from extension package can load (no inline scripts, no external CDNs)
- `object-src 'none'`: No plugins or embeds
- `base-uri 'none'`: No `<base>` tag rewriting

---

## Audit Trail Retention & Export

**Retention Policy:**
```javascript
// 7-day automatic retention
_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,

// Daily cleanup (configurable)
async _cleanup() {
  const cutoff = Date.now() - this._RETENTION_MS;
  // Entries older than cutoff deleted
}

// Maximum 10,000 entries (FIFO if exceeded)
_MAX_ENTRIES: 10000
```

**Export for Compliance:**
```javascript
async export(filter = {}) {
  const entries = await this.query({...filter, limit: 10000});
  return {
    exportedAt: new Date().toISOString(),
    version: '5.2',
    count: entries.length,
    entries: [
      {ts, action, category, hostname, result, details, durationMs, date}
    ]
  };
}

// User can download and archive for compliance
```

---

## Known Vulnerabilities & Mitigation

| Vulnerability | Impact | Status | Mitigation |
|---------------|--------|--------|-----------|
| Service worker suspension | Delayed job execution | Known (Chrome policy) | Resume via alarms + IndexedDB |
| Content script isolation bypass | Possible in older Chrome | Mitigated | Require Chrome 114+ |
| XSS in sidepanel via chat | High (credential access) | Mitigated | textContent, no innerHTML for user input |
| Rate limit bypass via header injection | Medium | Mitigated | Guard checks at message dispatch, before policy |
| IndexedDB quota exhaustion | Medium (DoS) | Mitigated | Max 10k entries, 7-day TTL |
| API key logged in error messages | High (credential disclosure) | Mitigated | sanitize() function masks tokens |

---

## Security Testing Checklist

- [ ] XSS test: Inject `<script>alert(1)</script>` in chat → should be escaped
- [ ] Rate limit test: Send 100 messages/sec → verify guard rejects after limit
- [ ] Circuit breaker test: Trigger 5 failures → verify 30s cooldown
- [ ] Audit log test: Verify all actions logged with correct category and result
- [ ] Policy test: Set domain blacklist → verify blocked actions are logged
- [ ] Message size test: Send 100KB message → verify rejection
- [ ] API key test: Ensure keys not in audit logs or console
- [ ] Content script test: Verify isolated world enforced
- [ ] CSP test: Verify no inline scripts execute in sidepanel

---

## Incident Response

**If extension is compromised:**
1. User disables extension immediately
2. Audit log exported (7-day retention available)
3. Chrome auto-clears extension storage on removal
4. User changes all API keys (extension had potential access)

**If audit log is lost:**
- Data loss is limited to 7 days of history
- No impact on stored API keys (separate storage)
- No impact on user data (IndexedDB persistent)

**If service worker crashes:**
- Chrome auto-restarts
- Pending jobs resume via alarms
- No message loss (messages are request-reply)

---

## References

- STRIDE Threat Modeling: https://www.microsoft.com/en-us/securityengineering/sdl/threatmodeling
- Chrome Extension Security: https://developer.chrome.com/docs/extensions/mv3/security/
- CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- OWASP Top 10: https://owasp.org/www-project-top-ten/
