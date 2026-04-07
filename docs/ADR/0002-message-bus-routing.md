# ADR-0002: Message Bus Routing with Type & Action Protocols

**Status**: Accepted

**Date**: 2024-03-27

**Author**: Architecture Team

---

## Context

COBRA modules needed to communicate without tight coupling. We needed:
1. Extensibility (add new actions/types without modifying router)
2. Backward compatibility (legacy action protocol still works)
3. Clear contracts (validate messages before dispatch)
4. Error isolation (one handler crash doesn't break others)

Initial design had direct function calls between modules:
```javascript
// Tightly coupled, hard to test
ToolExecutor.click(selector);
JobManager.start(jobId);
```

This became unmaintainable as features multiplied.

---

## Decision

Implement a **Message Bus Router** with **two protocols**:

### Protocol 1: Type-Based (COBRA - Modern)
```javascript
{
  type: 'CHAT_MESSAGE' | 'SCRAPE' | 'JOB_START',
  payload: {/* structured data */}
}
```

### Protocol 2: Action-Based (Legacy - Backward Compatible)
```javascript
{
  action: 'FILE_SAVE' | 'COMM_SEND_EMAIL',
  // Fields at message level (not wrapped)
}
```

**CobraRouter Architecture:**
```javascript
const CobraRouter = {
  _typeHandlers: {},     // CHAT_MESSAGE → handler
  _actionHandlers: {},   // FILE_SAVE → handler

  registerType(type, handler) {
    this._typeHandlers[type] = handler;
  },

  registerAction(action, handler) {
    this._actionHandlers[action] = handler;
  },

  init() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      // 1. Validate
      const v = CobraContracts.validateMessage(msg);
      if (!v.ok) return sendResponse({error: v.error});

      // 2. Check guard
      const guardCheck = CobraGuard.check(sender?.tab?.url, msg.type || msg.action);
      if (!guardCheck.ok) return sendResponse({error: guardCheck.reason});

      // 3. Dispatch
      if (msg.type && this._typeHandlers[msg.type]) {
        const handler = this._typeHandlers[msg.type];
        Promise.resolve()
          .then(() => handler(msg.payload, msg, sender))
          .then(result => sendResponse(result))
          .catch(err => sendResponse({error: err.message}));
        return true;
      }

      if (msg.action && this._actionHandlers[msg.action]) {
        const handler = this._actionHandlers[msg.action];
        Promise.resolve()
          .then(() => handler(msg, sender))
          .then(result => sendResponse(result))
          .catch(err => sendResponse({error: err.message}));
        return true;
      }

      // 4. Unknown
      sendResponse({error: 'Unknown message type or action'});
    });
  }
}
```

**Module Registration (bg-router.js):**
```javascript
// AI Chat
CobraRouter.registerType('CHAT_MESSAGE', handleChatMessage);
CobraRouter.registerType('CHAT_ABORT', handleChatAbort);

// Scraping
CobraRouter.registerType('SCRAPE', handleScrape);
CobraRouter.registerType('BATCH_SCRAPE', handleBatchScrape);

// Files (legacy action protocol)
CobraRouter.registerAction('FILE_SAVE', handleFileSave);
CobraRouter.registerAction('FILE_READ', handleFileRead);

// Jobs
CobraRouter.registerAction('JOB_CREATE', handleJobCreate);
CobraRouter.registerAction('JOB_START', handleJobStart);

CobraRouter.init();
```

---

## Consequences

### Positive

1. **Loose coupling**: Modules don't import each other
   ```javascript
   // No import needed
   // Message-based, works even if module not loaded yet
   ```

2. **Extensibility**: New handlers added without modifying router
   ```javascript
   // Plugin can register at runtime
   MyPlugin.registerHandlers({
     'PLUGIN_ACTION': myHandler
   });
   ```

3. **Error isolation**: Handler exception doesn't crash router
   ```javascript
   try {
     result = await handler();
   } catch (err) {
     sendResponse({error: err.message});
     // Router ready for next message
   }
   ```

4. **Testability**: Mock router, test handlers independently
   ```javascript
   const mockRouter = {
     registerType: jest.fn(),
     _typeHandlers: {}
   };
   // Test handler without Chrome API
   ```

5. **Audit trail**: Every message passes through single point
   ```javascript
   CobraAudit.log({action, result, durationMs});
   ```

### Negative

1. **Indirection**: Harder to trace call paths than direct imports
   - Mitigation: CobraRouter logs message dispatch

2. **Message overhead**: Serialization cost (though minimal)
   - Typical: <1ms per message

3. **Protocol complexity**: Two protocols to maintain
   - Mitigation: Prefer type-based for new features, legacy only for backward compat

4. **Silent failures**: Unknown message types fail silently
   - Mitigation: Console.warn + audit log entry

---

## Protocol Comparison

| Aspect | Type-Based | Action-Based |
|--------|-----------|--------------|
| Structure | Nested payload | Flat fields |
| Typing | Declarative (type) | Implicit (action field) |
| Backward compat | New protocol | Existing code |
| Validation | Structured schema | Unstructured |
| Example | `{type, payload}` | `{action, ...fields}` |
| Preferred | For new features | Legacy only |

**Migration Path:**
```javascript
// Legacy (action-based)
{action: 'FILE_SAVE', filename: 'x.txt', content: 'data'}

// Transition (both)
{action: 'FILE_SAVE', payload: {...}}  // deprecated

// Modern (type-based)
{type: 'FILE_SAVE', payload: {filename: 'x.txt', content: 'data'}}
```

---

## Alternatives Considered

### A. Direct Module Imports
```javascript
// Tightly coupled
import ToolExecutor from './tool-executor.js';
ToolExecutor.click(selector);

// Cons: Hard to test, circular dependencies, no audit trail
```

### B. Event Emitter Pattern
```javascript
// EventEmitter base class
class Module extends EventEmitter {
  emit('action:click', {selector});
}

// Cons: Pub/sub is implicit, hard to trace, no built-in validation
```

### C. Message Bus (Selected)
```javascript
// Explicit routing, validation, audit
CobraRouter.sendMessage({type: 'CHAT_MESSAGE', payload: {message}});

// Pros: Clear contracts, error isolation, testable, auditable
```

---

## Implementation Notes

### Handler Signature

**Type-based:**
```javascript
async function handler(payload, msg, sender) {
  // payload: msg.payload
  // msg: entire message
  // sender: {tab, frameId, origin, ...}
  return {ok: true, data: result};
}
```

**Action-based:**
```javascript
async function handler(msg, sender) {
  // msg: entire message (action at msg.action)
  // sender: {tab, frameId, origin, ...}
  return {ok: true, data: result};
}
```

### Error Response Format

```javascript
// All errors follow this structure
{
  error: string,      // Human message
  code: string,       // Machine code
  severity: string    // 'info'|'warn'|'error'|'fatal'
}
```

---

## Monitoring

CobraRouter dispatch can be monitored via:
```javascript
// Audit log (all messages)
CobraAudit.query({limit: 100});

// Guard stats (rate limits per hostname::action)
CobraGuard.getStats();

// Handler metrics (via audit log)
// - Total dispatches
// - Success/failure rate
// - Average latency per action
```

---

## References

- Message Bus Pattern: https://www.enterpriseintegrationpatterns.com/patterns/messaging/
- Chrome Message Passing: https://developer.chrome.com/docs/extensions/mv3/messaging/
- Event-Driven Architecture: https://martinfowler.com/articles/201701-event-driven.html
