# COBRA E2E Test Suite

End-to-End testing suite for the COBRA Chrome Extension using Playwright.

## Overview

This suite provides comprehensive E2E coverage for:
- Chat flow and message handling
- Voice/walkie-talkie integration
- SSE streaming responses
- Error recovery and fallback mechanisms
- Rate limiting and circuit breaker patterns
- Audit logging and storage
- Settings and configuration
- Onboarding and tooltips
- Communications hub (WhatsApp, Email, LinkedIn)
- Tool execution and safety
- Memories and habits
- Agent management
- Archive and conversation history
- Global error boundary handling

## Setup

### Prerequisites

- Chrome/Chromium browser (latest version)
- Node.js >= 18.0.0
- npm or yarn

### Installation

1. **Install Playwright** (if not already installed):
   ```bash
   npm install --save-dev @playwright/test
   ```

2. **Install Playwright Chromium** (required for running tests):
   ```bash
   npx playwright install chromium
   ```

## Running Tests

### Run all E2E tests:
```bash
npm run test:e2e
```

### Run specific test file:
```bash
npx playwright test tests/e2e/specs/chat-flow.spec.js
```

### Run tests with headed browser (see browser window):
```bash
npx playwright test --headed
```

### Run tests in debug mode:
```bash
npx playwright test --debug
```

### Run single test by name:
```bash
npx playwright test -g "send chat message"
```

### Generate HTML report:
```bash
npx playwright test
npx playwright show-report
```

## Test Files

| File | Scenarios | Focus Area |
|------|-----------|-----------|
| `chat-flow.spec.js` | 7 | Message sending, UI interaction |
| `voice-flow.spec.js` | 6 | Speech recognition mock, voice controls |
| `streaming.spec.js` | 7 | SSE chunks, progressive updates |
| `error-recovery.spec.js` | 8 | Fallback providers, retry logic |
| `rate-limiting.spec.js` | 8 | Request throttling, quota enforcement |
| `circuit-breaker.spec.js` | 8 | Failure thresholds, state transitions |
| `audit-log.spec.js` | 8 | IndexedDB writes, event logging |
| `settings.spec.js` | 9 | API key storage, preferences |
| `tooltips-onboarding.spec.js` | 10 | First-time UX, feature tips |
| `comms-chat.spec.js` | 10 | WhatsApp, Email, LinkedIn channels |
| `tool-execution.spec.js` | 9 | Safe/unsafe tools, policy checks |
| `memories-habits.spec.js` | 10 | CRUD on memories, habit tracking |
| `agents-list.spec.js` | 9 | Agent modal, selection, management |
| `archive.spec.js` | 10 | Conversation history, search, export |
| `error-boundary.spec.js` | 11 | Global error handling, recovery |

**Total: 134 test scenarios**

## Fixtures

### Core Fixtures (`fixtures.js`)

- **`extContext`**: Persistent Chrome context with extension loaded
- **`extensionId`**: Extracted extension ID from service worker
- **`serviceWorker`**: Service worker page object
- **`sidepanelPage`**: Side panel HTML page object
- **`waitForMessage`**: Utility for message handling
- **`injectMock`**: Mock injection into page context

### Usage Example:
```javascript
test('my test', async ({ sidepanelPage, extensionId, serviceWorker }) => {
  // sidepanelPage is ready with extension loaded
  // extensionId is extracted and available
  // serviceWorker is accessible for background message testing
});
```

## Configuration

### playwright.config.js

- **Timeout**: 90 seconds per test
- **Retries**: 0 (manual control preferred)
- **Workers**: 1 (Chrome extensions require single worker)
- **Browser**: Chromium with `--load-extension` flag
- **Headless**: false (extensions require headed browser)

### Global Setup

- Runs before all tests via `global-setup.js`
- Sets `E2E_TEST_MODE` environment variable

## Test Patterns

### Mock Injection:
```javascript
await injectMock(sidepanelPage, () => {
  window.mockProviderResponse = { text: 'Mocked response' };
});
```

### Element Waiting:
```javascript
const element = sidepanelPage.locator('[data-testid="myElement"]');
await expect(element).toBeVisible({ timeout: 5000 });
```

### Message Sending:
```javascript
const input = sidepanelPage.locator('#chatInput');
const sendBtn = sidepanelPage.locator('#chatSend');
await input.fill('Hello');
await sendBtn.click();
```

### Storage Access:
```javascript
const value = await sidepanelPage.evaluate(() => {
  return new Promise((resolve) => {
    chrome.storage.sync.get('key', (result) => {
      resolve(result.key);
    });
  });
});
```

## Debugging

### Enable verbose logging:
```bash
DEBUG=pw:api npx playwright test
```

### Use Inspector:
```bash
npx playwright test --debug
```

### Pause execution:
```javascript
await page.pause(); // Opens inspector at this point
```

### Screenshot on failure:
```bash
npx playwright test --screenshot=only-on-failure
```

## Common Issues

### Extension not loading
- Verify manifest.json is valid
- Check `--load-extension` path is absolute
- Ensure browser is not headless

### Service worker not found
- Wait 15 seconds (default timeout) before asserting
- Check `extensionId` extraction logic
- Verify background.js exists

### Chrome storage not available
- Use `chrome.storage.sync` or `chrome.storage.local`
- Ensure permission is in manifest
- Handle async nature with Promises

### Timeout errors
- Increase test timeout in playwright.config.js
- Add explicit waits with `waitFor()`
- Check for hidden/not-yet-loaded elements

## CI/CD Integration

To run in CI without a display:

```bash
# Install dependencies
npm install --save-dev @playwright/test

# Run tests with dummy display
xvfb-run -a npm run test:e2e

# Or use Docker with Chromium pre-installed
docker run --rm -v $(pwd):/app mcr.microsoft.com/playwright:v1.40.0 npm test:e2e
```

## Contributing

When adding new E2E tests:
1. Use fixtures from `fixtures.js`
2. Add `data-testid` attributes to elements being tested
3. Follow naming convention: `{feature}.spec.js`
4. Include comment header: `// E2E test - requires Chrome with extension loaded. Run: npx playwright test`
5. Aim for 8-11 test scenarios per file
6. Use explicit waits and timeouts
7. Clean up with proper teardown

## Performance Notes

- Single worker mode means tests run sequentially
- Expect ~2-3 minutes for full suite
- Each test context startup takes ~3 seconds
- Service worker registration takes ~1-2 seconds

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Chrome Extension Testing Guide](https://playwright.dev/docs/chrome-extensions)
- [Test Assertions Reference](https://playwright.dev/docs/test-assertions)
