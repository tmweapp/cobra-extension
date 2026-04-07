# ADR-0008: Jest + jsdom for Unit & Integration Testing

**Status**: Accepted

**Date**: 2024-03-27

---

## Context

Testing COBRA required:
1. Fast feedback loop (no Chrome instance startup)
2. Mockable APIs (chrome.runtime, IndexedDB)
3. Deterministic (no flakiness)
4. Can test without extension running

---

## Decision

Use **Jest** with **jsdom** test environment:

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: ['*.js', '!tests/**'],
  coverageThreshold: {
    global: {lines: 70, functions: 70, branches: 70},
    './cobra-router.js': {lines: 90}
  }
};
```

**Mock Setup (tests/setup.js):**
```javascript
// Mock chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {addListener: jest.fn()}
  },
  storage: {local: {get: jest.fn(), set: jest.fn()}},
  tabs: {query: jest.fn(), sendMessage: jest.fn()}
};

// Mock IndexedDB
global.indexedDB = {
  open: jest.fn(() => {
    const mockDB = {
      transaction: jest.fn(),
      createObjectStore: jest.fn()
    };
    // Return promise-like
    return {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      result: mockDB
    };
  })
};
```

---

## Consequences

### Positive

1. **Fast**: No browser startup, runs in ms
2. **Deterministic**: Mocked time, isolated state
3. **Simple**: Single Jest config, no Selenium
4. **Debuggable**: Node.js debugging works

### Negative

1. **Not real Chrome**: Mocks may diverge from actual API
   - Mitigation: E2E tests in real extension
2. **jsdom limitations**: No real DOM layout, styling
   - Mitigation: Focus on logic tests

---

## Test Organization

```
tests/
├── unit/
│   ├── cobra-router.test.js
│   ├── cobra-guard.test.js
│   ├── cobra-contracts.test.js
│   └── cobra-audit.test.js
├── integration/
│   ├── chat-flow.test.js
│   ├── job-execution.test.js
│   └── provider-fallback.test.js
└── setup.js
```

---

## Running Tests

```bash
npm test                    # All tests
npm test -- --coverage     # With coverage report
npm test -- --watch        # Watch mode
npm test -- --updateSnapshot  # Update snapshots
```

---

## References

- Jest Documentation: https://jestjs.io/
- jsdom: https://github.com/jsdom/jsdom
- Mock Chrome API: https://github.com/clarkbw/jest-webextension-mock
