# COBRA v5.2 — Architecture Plan

## Overview

COBRA v5.2 integrates 5 key patterns from v10 into the existing modular architecture, adding production-grade reliability without breaking the current `importScripts()` + `self.*` module system.

## New Modules

### 1. `cobra-result.js` — Standardized Result Wrapper
Every operation returns `Result.ok(data)` or `Result.fail(code, message, details)`.
Eliminates inconsistent `{ok: true}` vs `{error: ...}` patterns across the codebase.

- `Result.ok(data, meta)` → frozen `{ success: true, data, meta }`
- `Result.fail(code, message, details)` → frozen `{ success: false, code, message, details }`
- `Result.wrap(fn)` → wraps any async fn to always return Result
- `Result.fromLegacy(obj)` → converts old `{ok/error}` format
- `.toJSON()` → serializes for chrome.runtime.sendMessage transport

### 2. `cobra-error-codes.js` — Structured Error Constants
Centralized error registry with severity + category taxonomy:

| Category | Codes | Example |
|----------|-------|---------|
| general | UNKNOWN, INTERNAL, INVALID_ARGS | Generic errors |
| browser | NO_ACTIVE_TAB, TAB_LOAD_TIMEOUT, INJECT_FAILED | Chrome tab ops |
| dom | SELECTOR_NOT_FOUND, ELEMENT_NOT_VISIBLE | DOM interaction |
| network | API_ERROR, API_RATE_LIMIT, FETCH_TIMEOUT | HTTP/API calls |
| policy | POLICY_BLOCKED, DOMAIN_LOCKED, TRUST_INSUFFICIENT | Security layer |
| storage | STORAGE_FULL, IDB_ERROR | Persistence |
| jobs | JOB_NOT_FOUND, JOB_STEP_FAILED, JOB_MAX_RETRIES | Job lifecycle |
| comms | COMM_NOT_CONFIGURED, COMM_SEND_FAILED | Email/WA/LI |

### 3. `cobra-policy.js` — Policy Engine
Controls tool execution based on trust, domains, and confirmation tokens.

**Trust Levels:** 0 (untrusted) → 4 (admin). Default: 2 (standard).
Safe tools need 0, risky tools need 2, destructive need 3.

**Domain Classification:** Anchored regexes detect banking, social, auth, email domains.
v10 bug fix: `banking` regex no longer matches "riverbanking.com".

**Confirmation Tokens:** Single-use, 2-minute TTL. Required for:
- Destructive tools everywhere
- Risky tools on sensitive domains
- All send_* communication tools

**Flow:**
```
executeToolCall(name, args)
  → CobraPolicy.check(name, args, {url, confirmationToken})
    → trust level check
    → domain lock check
    → sensitive domain detection
    → confirmation requirement
    → dangerous pattern detection
  → if blocked: return Result.fail(POLICY_*)
  → if needs confirm: return token for UI
  → proceed with execution
```

### 4. `cobra-selector-stats.js` — Selector Statistics
Tracks CSS selector reliability per domain. Auto-ranks for future use.

**Score formula:** `basePriority + (successes × 5) − (failures × 8)`

**v10 bug fixes applied:**
- Atomic cache updates (no race condition)
- 30-day TTL cleanup (no unbounded growth)
- Max 200 selectors per domain (capped)

**Integration:** tool-executor.js records success/failure after every `click_element`, `fill_form`, etc. `CobraSelectorStats.getBest(domain, candidates)` picks the most reliable selector.

### 5. `cobra-jobs.js` — Persistent Job Engine
Full lifecycle: create → run → pause → resume → cancel → retry.

**States:** idle → running → paused/completed/failed/cancelled

**v10 bug fixes applied:**
- State checked BEFORE each step (no pause race condition)
- Timeout treated as failure (not success)
- Exponential backoff per-step retry (500ms → 1s → 2s)
- Interrupted runs marked as failed on SW restart

**Persistence:** Jobs and runs stored in IndexedDB (`jobs`, `job_runs` stores). Max 50 run history with auto-pruning.

## Modified Modules

### `cobra-indexeddb.js` → v2
Added 3 new object stores:
- `jobs` (keyPath: id, indexes: name, createdAt)
- `job_runs` (keyPath: id, indexes: jobId, state, startedAt)
- `selector_stats` (keyPath: id, indexes: domain, score)

DB version bumped from 1 → 2 (triggers `onupgradeneeded`).

### `tool-executor.js`
`executeToolCallHardened()` now:
1. Runs `CobraPolicy.check()` before execution
2. Records selector success/failure via `CobraSelectorStats`
3. Writes to IDB audit log with sanitized args
4. Uses `Result.fail().toJSON()` for error returns
5. Exports `self.executeToolCall` alias for CobraJobs

### `background.js`
- Stage 1b: imports `cobra-result.js`, `cobra-error-codes.js`, `cobra-policy.js`, `cobra-selector-stats.js`, `cobra-jobs.js`
- Init sequence: `CobraPolicy.init()`, `CobraSelectorStats.init()`, `CobraJobs.init()`
- Router actions: 16 new actions for Policy, Jobs, SelectorStats management

## Load Order

```
0. error-boundary.js, cobra-logger.js
1. crypto-utils.js, stealth.js, rate-limiter.js, cache.js
1b. cobra-result.js, cobra-error-codes.js, cobra-policy.js, cobra-selector-stats.js, cobra-jobs.js  ← NEW
2. persistence-manager.js, cobra-indexeddb.js, team-auth.js
3. agent.js, hydra-client.js, brain.js, ... (functional modules)
3b. tool-registry.js, tool-safety.js, tool-executor.js, provider-router.js
4. bg-router.js
4b. comm-config.js, comm-autodiscover.js, bg-comms.js
5. bg-chat.js, bg-scraper.js, bg-orchestrator.js, bg-kb.js, bg-jobs.js, bg-files.js
```

## Data Flow

```
User action / AI tool call
  │
  ▼
executeToolCallHardened(name, args)
  │
  ├── CobraPolicy.check() ──→ BLOCKED? → Result.fail() → UI
  │
  ├── ToolSafety.capturePreState() (risky tools)
  │
  ├── executeToolCall(name, args) → switch/case per tool
  │     │
  │     ├── success → CobraSelectorStats.recordSuccess()
  │     └── failure → CobraSelectorStats.recordFailure()
  │
  ├── cobraIDB.appendAuditLog()
  │
  └── return JSON result → AI / UI
```
