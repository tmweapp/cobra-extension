# ADR-0009: Error Boundary Pattern with Error Classification

**Status**: Accepted

**Date**: 2024-03-27

---

## Context

COBRA handlers can fail in various ways:
1. **User error**: Invalid selector (recoverable, user-facing)
2. **System error**: API unreachable (might be recoverable via fallback)
3. **Security error**: Policy blocked action (intentional, not an error)

Without classification, all errors treated equally → poor UX.

---

## Decision

Implement **error boundary pattern** with explicit classification:

```javascript
// cobra-error-codes.js
const COBRA_ERRORS = {
  // User-facing (recoverable)
  SELECTOR_NOT_FOUND: {code: 'SELECTOR_NOT_FOUND', severity: 'warn', category: 'dom'},
  ELEMENT_NOT_VISIBLE: {code: 'ELEMENT_NOT_VISIBLE', severity: 'warn', category: 'dom'},

  // System (usually not recoverable)
  NETWORK_ERROR: {code: 'NETWORK_ERROR', severity: 'error', category: 'network'},
  TIMEOUT: {code: 'TIMEOUT', severity: 'error', category: 'browser'},

  // Policy (intentional blocking)
  POLICY_BLOCKED: {code: 'POLICY_BLOCKED', severity: 'warn', category: 'policy'},
  CIRCUIT_OPEN: {code: 'CIRCUIT_OPEN', severity: 'warn', category: 'policy'},

  // Rate limiting (recoverable with backoff)
  RATE_LIMITED: {code: 'RATE_LIMITED', severity: 'warn', category: 'policy'}
};
```

**Handler Error Boundary:**
```javascript
async function handleAction(msg, sender) {
  try {
    // Execute action
    return {ok: true, data: result};
  } catch (err) {
    // Classify error
    const errorDef = classifyError(err);

    // Log appropriately
    CobraAudit.log({
      action: msg.action,
      category: 'tool',
      result: 'fail',
      details: errorDef.message
    });

    // Return structured error
    return {
      error: errorDef.message,
      code: errorDef.code,
      severity: errorDef.severity,
      retryable: errorDef.retryable
    };
  }
}

function classifyError(err) {
  if (err.message.includes('not found')) {
    return COBRA_ERRORS.SELECTOR_NOT_FOUND;
  }
  if (err.name === 'TypeError') {
    return COBRA_ERRORS.NETWORK_ERROR;
  }
  if (err.message.includes('timeout')) {
    return COBRA_ERRORS.TIMEOUT;
  }
  return COBRA_ERRORS.INTERNAL;
}
```

---

## Consequences

### Positive

1. **User-facing errors**: Clear, actionable messages
2. **Debugging**: Severity and category help diagnosis
3. **Retry logic**: Client knows if error is retryable
4. **Monitoring**: Audit log categorizes failures

### Negative

1. **Classification complexity**: Every error type needs category
2. **Maintenance**: New error types require updates

---

## Error Categories

| Category | Examples | Severity | Action |
|----------|----------|----------|--------|
| dom | Selector not found, element not visible | warn | Adjust selector, retry |
| network | API unreachable, timeout | error | Retry with backoff, fallback |
| browser | Tab closed, injection failed | error | Abort, notify user |
| policy | Blocked by domain policy | warn | Inform user of policy |
| validation | Invalid args, message too large | warn | Fix input, retry |
| storage | Quota exceeded, DB error | error | Cleanup, retry |

---

## References

- Error Boundary Pattern: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
- Error Handling Best Practices: https://github.com/goldbergyoni/nodebestpractices#6-error-handling-practices
