# COBRA v5.2 — Testing Strategy

## Overview

COBRA uses a **three-tier testing pyramid**:
1. **Unit Tests** (70%): Individual modules, pure functions
2. **Integration Tests** (20%): Component interactions, message flow
3. **E2E Tests** (10%): Full user workflows in real extension

---

## Test Pyramid

```
        E2E Tests (10%)
       /              \
     /                  \
   Integration (20%)
  /                    \
/________________________\
    Unit Tests (70%)
```

**Rationale:**
- Unit tests are fast, cheap, and easy to fix
- Integration tests verify contracts between modules
- E2E tests ensure real-world workflows function

---

## Unit Tests

### Coverage Goals

- **CobraRouter**: >90% (critical message dispatch)
- **CobraGuard**: >90% (rate limiting and circuit logic)
- **CobraContracts**: >95% (validation is core)
- **CobraAudit**: >85% (persistence, queries)
- **ProviderRouter**: >80% (provider fallback logic)
- **ToolExecutor**: >75% (tool dispatch)

### Running Unit Tests

```bash
# All unit tests
npm test -- tests/unit/

# Specific file
npm test -- tests/unit/cobra-router.test.js

# With coverage
npm test -- tests/unit/ --coverage

# Watch mode
npm test -- tests/unit/ --watch
```

### Example: CobraRouter Tests

```javascript
// tests/unit/cobra-router.test.js

describe('CobraRouter', () => {
  let router;
  let sendResponseMock;
  let senderMock;

  beforeEach(() => {
    router = Object.create(CobraRouter);
    sendResponseMock = jest.fn();
    senderMock = {tab: {url: 'https://example.com'}};

    // Clear handlers
    router._typeHandlers = {};
    router._actionHandlers = {};
  });

  describe('initialization', () => {
    it('should initialize only once', () => {
      router.init();
      router.init();
      expect(router._initialized).toBe(true);
      // Should only set up listener once
    });

    it('should log initialization', () => {
      const consoleSpy = jest.spyOn(console, 'log');
      router.init();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CobraRouter] Initialized')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('type handler registration', () => {
    it('should register single type handler', () => {
      const handler = jest.fn();
      router.registerType('TEST_TYPE', handler);
      expect(router._typeHandlers['TEST_TYPE']).toBe(handler);
    });

    it('should register multiple type handlers', () => {
      const handlers = {
        'TYPE_A': jest.fn(),
        'TYPE_B': jest.fn()
      };
      router.registerTypes(handlers);
      expect(router._typeHandlers['TYPE_A']).toBe(handlers['TYPE_A']);
      expect(router._typeHandlers['TYPE_B']).toBe(handlers['TYPE_B']);
    });
  });

  describe('message dispatch', () => {
    it('should dispatch message to registered type handler', async () => {
      const handler = jest.fn().mockResolvedValue({ok: true});
      router.registerType('TEST', handler);

      const msg = {type: 'TEST', payload: {data: 'test'}};
      await simulateDispatch(msg, senderMock);

      expect(handler).toHaveBeenCalledWith({data: 'test'}, msg, senderMock);
    });

    it('should dispatch message to action handler if no type', async () => {
      const handler = jest.fn().mockResolvedValue({ok: true});
      router.registerAction('FILE_SAVE', handler);

      const msg = {action: 'FILE_SAVE', filename: 'test.txt'};
      await simulateDispatch(msg, senderMock);

      expect(handler).toHaveBeenCalledWith(msg, senderMock);
    });
  });

  describe('error handling', () => {
    it('should catch handler errors and send error response', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Test error'));
      router.registerType('ERROR_TEST', handler);

      const msg = {type: 'ERROR_TEST', payload: {}};
      const response = await simulateDispatch(msg, senderMock);

      expect(response.error).toContain('Test error');
      expect(response.code).toBe('HANDLER_ERROR');
    });

    it('should not affect other handlers when one fails', async () => {
      const failHandler = jest.fn().mockRejectedValue(new Error('Fail'));
      const successHandler = jest.fn().mockResolvedValue({ok: true});

      router.registerType('FAIL', failHandler);
      router.registerType('SUCCESS', successHandler);

      // First request fails
      await simulateDispatch({type: 'FAIL', payload: {}}, senderMock);

      // Second request succeeds
      const response = await simulateDispatch({type: 'SUCCESS', payload: {}}, senderMock);
      expect(response.ok).toBe(true);
    });
  });
});
```

### Example: CobraGuard Tests

```javascript
// tests/unit/cobra-guard.test.js

describe('CobraGuard', () => {
  let guard;

  beforeEach(() => {
    guard = Object.create(CobraGuard);
    guard.reset();
  });

  describe('rate limiting', () => {
    it('should allow requests under limit', () => {
      const url = 'https://example.com';
      const action = 'click_element';

      for (let i = 0; i < 10; i++) {
        const result = guard.checkRateLimit(url, action);
        expect(result.ok).toBe(true);
      }
    });

    it('should block request when limit exceeded', () => {
      const url = 'https://example.com';
      const action = 'click_element';  // Write action, limit 10/10s

      // Fill bucket
      for (let i = 0; i < 10; i++) {
        guard.checkRateLimit(url, action);
      }

      // 11th request blocked
      const result = guard.checkRateLimit(url, action);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('RATE_LIMITED');
    });

    it('should allow higher rate for read actions', () => {
      const url = 'https://example.com';
      const action = 'read_page';  // Read action, limit 40/10s

      for (let i = 0; i < 40; i++) {
        const result = guard.checkRateLimit(url, action);
        expect(result.ok).toBe(true);
      }

      const blocked = guard.checkRateLimit(url, action);
      expect(blocked.ok).toBe(false);
    });

    it('should reset bucket after window', () => {
      const url = 'https://example.com';
      const action = 'click_element';

      // Fill bucket
      for (let i = 0; i < 10; i++) {
        guard.checkRateLimit(url, action);
      }

      // Mock time advance by 11 seconds
      jest.useFakeTimers();
      jest.advanceTimersByTime(11000);

      // New request should succeed
      const result = guard.checkRateLimit(url, action);
      expect(result.ok).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('circuit breaker', () => {
    it('should allow requests with no failures', () => {
      const url = 'https://example.com';
      const action = 'click_element';

      const result = guard.checkCircuit(url, action);
      expect(result.ok).toBe(true);
    });

    it('should open circuit after 5 consecutive failures', () => {
      const url = 'https://example.com';
      const action = 'click_element';

      // Register 5 failures
      for (let i = 0; i < 5; i++) {
        guard.registerFailure(url, action);
      }

      // Circuit should be open
      const result = guard.checkCircuit(url, action);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('CIRCUIT_OPEN');
    });

    it('should close circuit after success', () => {
      const url = 'https://example.com';
      const action = 'click_element';

      // Open circuit
      for (let i = 0; i < 5; i++) {
        guard.registerFailure(url, action);
      }

      // Success closes circuit
      guard.registerSuccess(url, action);

      const result = guard.checkCircuit(url, action);
      expect(result.ok).toBe(true);
    });

    it('should reset circuit after cooldown', () => {
      const url = 'https://example.com';
      const action = 'click_element';

      // Open circuit
      for (let i = 0; i < 5; i++) {
        guard.registerFailure(url, action);
      }

      // Mock time advance by 31 seconds
      jest.useFakeTimers();
      jest.advanceTimersByTime(31000);

      // Circuit should be closed now
      const result = guard.checkCircuit(url, action);
      expect(result.ok).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('combined check', () => {
    it('should check circuit first, then rate limit', () => {
      const url = 'https://example.com';
      const action = 'click_element';

      // Open circuit
      for (let i = 0; i < 5; i++) {
        guard.registerFailure(url, action);
      }

      // Should fail on circuit check before rate limit check
      const result = guard.check(url, action);
      expect(result.code).toBe('CIRCUIT_OPEN');
    });
  });
});
```

---

## Integration Tests

### Coverage Focus

- Message flow: Contract → Router → Handler → Audit
- Provider fallback: Primary fails → Secondary succeeds
- Job execution: Create → Start → Run → Complete
- Storage integration: Save → Query → Update → Delete

### Example: Chat Message Flow

```javascript
// tests/integration/chat-flow.test.js

describe('Chat Message Flow (Integration)', () => {
  beforeAll(async () => {
    // Initialize all modules
    await CobraAudit.init();
    CobraRouter.init();
  });

  it('should process chat message end-to-end', async () => {
    // Prepare mock AI provider
    const mockProvider = jest.fn().mockResolvedValue({
      response: 'This is the result.',
      usage: {promptTokens: 100, completionTokens: 50}
    });

    // Register handler
    CobraRouter.registerType('CHAT_MESSAGE', async (payload) => {
      return mockProvider(payload);
    });

    // Send message
    const msg = {
      type: 'CHAT_MESSAGE',
      payload: {
        message: 'What is 2+2?'
      }
    };

    const response = await dispatchMessage(msg, {tab: {url: 'https://example.com'}});

    // Verify response
    expect(response.response).toBe('This is the result.');
    expect(response.usage.promptTokens).toBe(100);

    // Verify audit log
    const entries = await CobraAudit.query({action: 'CHAT_MESSAGE'});
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].result).toBe('ok');
  });

  it('should handle provider fallback on failure', async () => {
    const primaryProvider = jest.fn().mockRejectedValue(new Error('API Error'));
    const fallbackProvider = jest.fn().mockResolvedValue({
      response: 'Fallback response'
    });

    // Setup provider chain
    const providerChain = [primaryProvider, fallbackProvider];

    CobraRouter.registerType('CHAT_MESSAGE', async (payload) => {
      for (const provider of providerChain) {
        try {
          return await provider(payload);
        } catch (err) {
          continue;  // Try next provider
        }
      }
      throw new Error('All providers failed');
    });

    const msg = {type: 'CHAT_MESSAGE', payload: {message: 'Hello'}};
    const response = await dispatchMessage(msg, {tab: {url: 'https://example.com'}});

    expect(response.response).toBe('Fallback response');
  });
});
```

---

## E2E Tests

### Manual Testing Checklist

Before release, manually test these critical paths:

**Chat & Interaction:**
- [ ] Type message in sidepanel → AI responds
- [ ] Streaming token display works
- [ ] Chat history persists after reload
- [ ] Abort button stops streaming
- [ ] Settings saved and applied

**Scraping & Tools:**
- [ ] Scrape single URL → content extracted
- [ ] Scrape with CSS selector → correct elements extracted
- [ ] Batch scrape 5 URLs → all succeed
- [ ] Crawl site → respects max depth and pages
- [ ] Tool execution timeout works (timeout after 20s)

**Knowledge Base:**
- [ ] Save entry → appears in KB
- [ ] Search KB → correct results
- [ ] Update entry → changes reflected
- [ ] Delete entry → removed from KB
- [ ] Export KB → valid JSON with all entries

**Jobs:**
- [ ] Create job with 3 steps → saved
- [ ] Start job → steps execute in order
- [ ] Pause job → paused and resumed correctly
- [ ] Cancel job → terminates immediately
- [ ] Job history shows all runs

**Audit & Settings:**
- [ ] Audit log shows all actions (chat, tools, comms)
- [ ] Query audit by category → correct filtering
- [ ] Export audit → JSON with all entries
- [ ] Settings persist across reload
- [ ] API key changes take effect

**Security:**
- [ ] Rate limiting blocks after 10 requests/10s
- [ ] Circuit breaker opens after 5 failures
- [ ] API key not visible in audit log
- [ ] XSS attempt in chat input → escaped
- [ ] Large message (>50KB) → rejected

---

## Automated Testing Setup

### Jest Configuration

```javascript
// jest.config.js

module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    '*.js',
    '!tests/**',
    '!node_modules/**',
    '!dist/**'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    },
    './cobra-contracts.js': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    },
    './cobra-router.js': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 5000
};
```

### Test Setup File

```javascript
// tests/setup.js

// Mock Chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {addListener: jest.fn()}
  },
  storage: {
    local: {
      get: jest.fn((keys, cb) => cb({})),
      set: jest.fn(),
      remove: jest.fn()
    },
    sync: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn()
  },
  alarms: {
    create: jest.fn(),
    get: jest.fn()
  }
};

// Mock IndexedDB
global.indexedDB = {
  open: jest.fn(() => {
    const mockDB = {
      createObjectStore: jest.fn(),
      transaction: jest.fn(() => ({
        objectStore: jest.fn(() => ({
          add: jest.fn(),
          get: jest.fn(),
          delete: jest.fn(),
          clear: jest.fn(),
          index: jest.fn(() => ({
            openCursor: jest.fn()
          }))
        })),
        oncomplete: null,
        onerror: null
      }))
    };
    setTimeout(() => {
      const event = {target: {result: mockDB}};
      if (arguments[0].onupgradeneeded) arguments[0].onupgradeneeded(event);
      if (arguments[0].onsuccess) arguments[0].onsuccess(event);
    }, 0);
    return arguments[0];
  })
};

// Mock fetch
global.fetch = jest.fn();

// Suppress console in tests unless explicitly checked
const originalWarn = console.warn;
const originalError = console.error;
beforeEach(() => {
  console.warn = jest.fn();
  console.error = jest.fn();
});
afterEach(() => {
  console.warn = originalWarn;
  console.error = originalError;
});
```

---

## Running Tests in CI/CD

```yaml
# .github/workflows/test.yml

name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
      - run: npm run lint
```

---

## Coverage Reports

```bash
# Generate coverage report
npm test -- --coverage

# HTML coverage report
npm test -- --coverage && open coverage/lcov-report/index.html

# Codecov (CI integration)
npm test -- --coverage && npx codecov
```

---

## Test Maintenance

- Review failing tests weekly
- Update tests when API changes
- Keep mock data realistic
- Document complex test scenarios
- Archive old test results monthly

---

## References

- Jest Documentation: https://jestjs.io/docs/getting-started
- Testing Library: https://testing-library.com/
- Chrome Extension Testing: https://developer.chrome.com/docs/extensions/mv3/testing/
