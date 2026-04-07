# ADR-0001: Modular Monolith Architecture

**Status**: Accepted

**Date**: 2024-03-27

**Author**: Architecture Team

---

## Context

COBRA needed an architecture that could:
1. Support rapid feature development (chat, scraping, jobs, KB)
2. Run entirely within a Chrome extension service worker (single process)
3. Enable testing without complex infrastructure
4. Remain maintainable as complexity grows

We evaluated three options:
1. **Monolith** (single bg-script.js): Simple but unscalable, hard to test
2. **Microservices** (separate processes): Complex IPC, quota limits, overkill for extension
3. **Modular Monolith** (single process, multiple modules): Balanced approach

---

## Decision

Adopt a **Modular Monolith** architecture:
- **Single service worker process** (background.js)
- **Message-based module coupling** (CobraRouter)
- **Clear module boundaries** via message contracts (CobraContracts)
- **Dependency injection** for testability
- **Explicit handlers registry** per module

```
┌──────────────────────────────────────────┐
│   Chrome Service Worker (Single Process) │
│                                          │
│  ┌─────────────┬──────────────────────┐ │
│  │ CobraRouter │  Type/Action Handlers│ │
│  │  (Bus)      │  (Registered modules)│ │
│  └──────┬──────┴──────────────────────┘ │
│         │                               │
│  ┌──────┴──────────────────────────────┐│
│  │  Modules (via message dispatch)    ││
│  │  - ProviderRouter (AI)             ││
│  │  - ToolExecutor (actions)          ││
│  │  - JobManager (scheduling)         ││
│  │  - KnowledgeBase (storage)         ││
│  └───────────────────────────────────┘│
│                                        │
│  ┌───────────────────────────────────┐│
│  │  Cross-cutting concerns:          ││
│  │  - CobraContracts (validation)    ││
│  │  - CobraGuard (rate limit)        ││
│  │  - CobraAudit (logging)           ││
│  │  - ErrorBoundary (isolation)      ││
│  └───────────────────────────────────┘│
│                                        │
│  ┌───────────────────────────────────┐│
│  │  Storage:                         ││
│  │  - IndexedDB (audit, cache)       ││
│  │  - chrome.storage (settings)      ││
│  └───────────────────────────────────┘│
└──────────────────────────────────────────┘
```

---

## Consequences

### Positive

1. **Single entry point**: All messages route through CobraRouter
   - Easy to add global features (audit logging, rate limiting)
   - Simple error handling and recovery

2. **No process overhead**: No IPC serialization costs
   - Message dispatch: <1ms
   - Low latency for user interactions

3. **Shared memory**: Modules can cache data efficiently
   - In-memory rate limit buckets
   - Streaming response buffering

4. **Testability**: Mock CobraRouter and test modules in isolation
   - No async inter-process setup needed
   - Synchronous contract validation

5. **Chrome extension friendly**: Service workers support this pattern
   - No complex permissions needed between modules
   - Standard event model (chrome.runtime.onMessage)

### Negative

1. **Memory concerns**: All modules share heap
   - Mitigation: Regular cleanup, size limits on audit log

2. **Service worker suspension**: Chrome may suspend after 5min inactivity
   - Mitigation: Persistent jobs stored in IndexedDB, resumed via alarms

3. **Single point of failure**: Bug in CobraRouter affects all modules
   - Mitigation: Error boundaries per handler, graceful degradation

4. **Hard to scale**: Cannot split into separate processes if traffic explodes
   - Mitigation: Documented migration path to microservices if needed

---

## Alternatives Considered

### A. Single Monolithic Script (background.js)
```javascript
// All code in one 50KB+ file
// Pros: Simple, fast
// Cons: Unmaintainable, untestable, hard to review
```

### B. Microservices via SharedWorker
```javascript
// Multiple service workers communicating via messages
// Pros: Modular, scalable
// Cons: Chrome doesn't well-support SharedWorker in extensions,
//       complex IPC serialization, debugging nightmare
```

### C. Modular Monolith (Selected)
```javascript
// Single service worker, multiple modules, message bus
// Pros: Balanced complexity, testable, efficient
// Cons: Memory constraints, suspension handling
```

---

## Migration Path

If COBRA grows beyond extension limits:

1. **Phase 1** (current): Modular monolith in service worker
2. **Phase 2**: Split into background + content script load balancing
3. **Phase 3**: Offload to native app (Electron, desktop) with service backend
4. **Phase 4**: Distributed microservices (if multi-user)

Each phase maintains message-based API compatibility.

---

## References

- Chrome Extension API: https://developer.chrome.com/docs/extensions/mv3/service_workers/
- Monolithic vs. Microservices: https://www.nginx.com/blog/what-is-a-microservice/
- ADR Template: https://adr.github.io/
