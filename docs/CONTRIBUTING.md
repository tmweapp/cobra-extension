# Contributing to COBRA v5.2

Thank you for your interest in contributing to COBRA! This document outlines our development workflow, code standards, and testing requirements.

---

## Development Setup

### Prerequisites

- **Node.js** 16+ (for tooling)
- **Chrome** 114+ (for testing)
- **Git** for version control
- **Visual Studio Code** (recommended)

### Installation

```bash
# Clone repository
git clone https://github.com/your-org/firescrape-extension.git
cd firescrape-extension

# Install dependencies
npm install

# Load extension in Chrome
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the firescrape-extension directory
```

### Directory Structure

```
firescrape-extension/
├── background.js              # Service worker entry point
├── sidepanel.js               # UI state manager
├── sidepanel.html             # UI markup
├── cobra-*.js                 # Core modules (router, guard, audit, contracts, errors, streaming)
├── bg-*.js                    # Business logic (router, jobs, chat handlers)
├── modules/                   # Feature modules (storage, toast, error-boundary, etc.)
├── icons/                     # Extension icons
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── SECURITY.md
│   ├── ADR/                   # Architecture Decision Records
│   └── ...
├── tests/                     # Test suite
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── manifest.json              # Extension manifest
```

---

## Git Workflow

### Branch Naming

```
feature/description           # New feature
fix/description               # Bug fix
docs/description              # Documentation
refactor/description          # Code refactoring
test/description              # Test coverage
chore/description             # Maintenance (deps, config)
```

**Examples:**
```
feature/multi-provider-fallback
fix/rate-limit-reset-bug
docs/api-reference
refactor/router-handler-isolation
test/audit-log-queries
chore/update-chrome-types
```

### Conventional Commits

All commits must follow **Conventional Commits v1.0.0**:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code formatting (no logic change)
- `refactor`: Code restructuring (no behavior change)
- `test`: Test coverage
- `chore`: Dependencies, build config

**Scopes:**
- `router`: CobraRouter module
- `guard`: CobraGuard (rate limiter + circuit breaker)
- `audit`: CobraAudit logging
- `contracts`: Message validation
- `provider`: ProviderRouter or adapter
- `tool-executor`: Tool execution
- `ui`: Sidepanel UI
- `storage`: Persistence layer
- `job`: Job/persistent job system
- `comms`: Communication hub
- `kb`: Knowledge base

**Examples:**
```
feat(provider): add Groq streaming support

- Implement Groq OpenAI-compatible endpoint
- Add error fallback chain
- Test with llama-3.3-70b model

Closes #42
```

```
fix(guard): circuit breaker not resetting after cooldown

Previously, open circuits remained open indefinitely.
Now they reset after 30s cooldown as documented.

Fixes #38
```

```
docs(api): add AUDIT_QUERY examples

Updated API.md with complete examples for audit log querying
including filters and response format.
```

### Commit Best Practices

- Commits should be **atomic** (one logical change per commit)
- Use **imperative mood** in subject line ("add feature" not "added feature")
- Limit subject to **50 characters**
- Wrap body at **72 characters**
- Reference issues: `Closes #123`, `Fixes #456`, `Relates to #789`

---

## Pull Request Process

### Before Opening PR

1. **Create feature branch** from `main`
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Write code** following style guide (see below)

3. **Write tests** (see TESTING.md for requirements)

4. **Run test suite**
   ```bash
   npm test
   ```

5. **Check code quality**
   ```bash
   npm run lint
   npm run format:check
   ```

6. **Update documentation** if API changes

### PR Template

```markdown
## Description
Brief summary of changes (2-3 sentences).

## Type of Change
- [ ] New feature
- [ ] Bug fix
- [ ] Documentation
- [ ] Refactoring
- [ ] Other: ___

## Related Issue
Closes #123

## Testing
Describe how to test these changes:
1. Load extension in Chrome
2. Open sidepanel
3. Navigate to Settings
4. Verify new feature works

## Checklist
- [ ] Code follows style guide
- [ ] Tests pass locally (`npm test`)
- [ ] New tests added (if applicable)
- [ ] Documentation updated
- [ ] No breaking changes (or documented in BREAKING.md)

## Screenshots (if UI change)
<!-- Attach before/after screenshots -->

## Performance Impact
<!-- Describe any performance implications -->

## Security Considerations
<!-- Describe any security-related changes -->
```

### Review Expectations

- **At least 2 approvals** required before merge
- **All CI checks must pass**
- **No merge conflicts** (rebase if needed)
- **Meaningful commit history** (squash if needed)

**Reviewers will check:**
- Code correctness and style
- Test coverage
- Security implications
- Documentation completeness
- Performance impact
- API compatibility

---

## Code Style Guide

### JavaScript

**Naming Conventions:**
```javascript
// Constants: UPPER_SNAKE_CASE
const MAX_RETRIES = 3;
const ALLOWED_ACTIONS = new Set([...]);

// Classes/Constructors: PascalCase
class CobraRouter { }
const router = new CobraRouter();

// Functions/Methods: camelCase
function validateMessage() { }
async function sendEmail() { }

// Variables: camelCase
let chatHistory = [];
const userPreferences = {};

// Private members: _camelCase (by convention)
_buckets = {};
_validate(msg) { }
```

**Formatting:**
```javascript
// Use 2-space indentation
const obj = {
  key: 'value',
  nested: {
    inner: true
  }
};

// Line length: max 100 characters (for readability)
const longString =
  'This is a very long string that exceeds 100 ' +
  'characters and is split across lines';

// Function declarations
async function handleChatMessage(payload, msg, sender) {
  // Implementation
}

// Arrow functions for callbacks
const result = await Promise.resolve()
  .then(() => fetchData())
  .catch(err => console.error(err));
```

**JSDoc Comments:**
```javascript
/**
 * Validates incoming message against contract.
 * @param {Object} msg - Message object
 * @param {string} msg.type - Message type
 * @param {*} msg.payload - Optional payload
 * @returns {Object} {ok: boolean, error?: string, code?: string}
 * @throws {Error} On serialization failure
 * @example
 * const result = CobraContracts.validateMessage({type: 'PING'});
 * console.log(result.ok); // true
 */
validateMessage(msg) {
  // Implementation
}
```

**Error Handling:**
```javascript
// Use try-catch for async operations
try {
  const result = await fetchAI();
} catch (err) {
  console.error('[CobraRouter] Error:', err);
  CobraAudit.log({action, category, result: 'fail', details: err.message});
  throw new Error(COBRA_ERRORS.API_ERROR.message);
}

// Use explicit error codes
throw new Error('ACTION_BLOCKED');  // Bad
throw new Error(COBRA_ERRORS.POLICY_BLOCKED.message);  // Good
```

### HTML/CSS

**HTML Structure:**
```html
<!-- Use semantic HTML5 -->
<section class="chat-container">
  <div class="message" data-id="msg-123">
    <p class="message-content"></p>
    <time class="message-time"></time>
  </div>
</section>

<!-- Always sanitize user content -->
<div id="user-input"></div>
<script>
  // WRONG:
  div.innerHTML = userInput;  // XSS vector

  // RIGHT:
  div.textContent = userInput;  // Safe
  // or
  const p = document.createElement('p');
  p.textContent = userInput;
  div.appendChild(p);
</script>
```

**CSS Organization:**
```css
/* Structure: Variables → Base → Components → Utilities */

:root {
  --primary: #2563eb;
  --danger: #dc2626;
  --spacing: 8px;
}

/* Base styles */
body {
  font-family: system-ui, sans-serif;
  background: var(--bg-primary);
}

/* Components */
.chat-container {
  display: flex;
  flex-direction: column;
}

.message {
  padding: var(--spacing);
  border-radius: 4px;
}

/* Utilities */
.hidden {
  display: none;
}
```

---

## Testing Requirements

### Test Coverage Goals

- **Unit Tests**: >80% coverage for core modules (router, guard, audit, contracts)
- **Integration Tests**: Key user flows (chat, scrape, job execution)
- **E2E Tests**: Critical paths (manual testing in real extension)

### Running Tests

```bash
# All tests
npm test

# Specific suite
npm test -- tests/unit/cobra-router.test.js

# With coverage
npm test -- --coverage

# Watch mode (development)
npm test -- --watch
```

### Writing Tests (Jest)

```javascript
// tests/unit/cobra-router.test.js

describe('CobraRouter', () => {
  beforeEach(() => {
    // Setup
    CobraRouter.init();
  });

  afterEach(() => {
    // Cleanup
    jest.clearAllMocks();
  });

  describe('validateMessage', () => {
    it('should accept valid type-based message', () => {
      const msg = {type: 'CHAT_MESSAGE', payload: {message: 'hi'}};
      const result = CobraContracts.validateMessage(msg);
      expect(result.ok).toBe(true);
    });

    it('should reject unknown type', () => {
      const msg = {type: 'UNKNOWN_TYPE'};
      const result = CobraContracts.validateMessage(msg);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('UNKNOWN_TYPE');
    });

    it('should reject message larger than 50KB', () => {
      const largePayload = 'x'.repeat(51000);
      const msg = {type: 'CHAT_MESSAGE', payload: {message: largePayload}};
      const result = CobraContracts.validateMessage(msg);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MESSAGE_TOO_LARGE');
    });
  });

  describe('registerType', () => {
    it('should register and call type handler', async () => {
      const handler = jest.fn().mockResolvedValue({ok: true});
      CobraRouter.registerType('TEST', handler);

      // Simulate message dispatch
      const msg = {type: 'TEST', payload: {data: 'test'}};
      const sender = {tab: {url: 'https://example.com'}};

      await CobraRouter._dispatch(msg, sender);
      expect(handler).toHaveBeenCalled();
    });
  });
});
```

### Mock Patterns

```javascript
// Mock chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn((msg, callback) => {
      callback({ok: true});
    })
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  }
};

// Mock IndexedDB
global.indexedDB = {
  open: jest.fn(() => ({
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null
  }))
};
```

---

## Documentation Updates

### When to Update Docs

- **New feature**: Add to API.md
- **API change**: Update contracts table and examples
- **Architecture change**: Add ADR (see ADR/ folder)
- **Bug fix**: Update relevant section if behavior changes

### Documentation Style

```markdown
# Section Title

Brief introduction (1-2 sentences).

## Subsection

More detail. Use code blocks for examples.

\`\`\`javascript
const example = {code: true};
\`\`\`

**Key points:**
- Bullet point
- Another point

| Column 1 | Column 2 |
|----------|----------|
| Value    | Value    |

See [Reference](link) for more.
```

---

## Release Process

### Version Numbering

COBRA uses **Semantic Versioning** (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking API changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Steps

1. **Update version** in `manifest.json` and `package.json`
2. **Update CHANGELOG.md** with all changes
3. **Create release commit**
   ```bash
   git commit -m "chore(release): v5.2.1"
   ```
4. **Create git tag**
   ```bash
   git tag -a v5.2.1 -m "Release v5.2.1"
   git push origin main --tags
   ```
5. **Build for distribution**
   ```bash
   npm run build
   ```
6. **Upload to Chrome Web Store** (automated via CI)

---

## Performance Guidelines

- **Message dispatch**: Aim for <1ms
- **Audit log insert**: <50ms (async)
- **Rate limit check**: <1ms
- **DOM operations**: Batch when possible
- **Avoid**: Infinite loops, unbounded recursion, memory leaks

---

## Security Guidelines

- **Never log API keys** (use sanitize())
- **Validate all user input** (CobraContracts)
- **Use textContent** for user-generated HTML
- **Enforce HTTPS** for all external requests
- **Avoid eval()** and Function()
- **Report vulnerabilities** privately to maintainers

---

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: File an Issue with reproduction steps
- **Security**: Email security@example.com
- **Chat**: Join our Discord community

---

## Code of Conduct

By contributing, you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

By contributing, you agree that your contributions will be licensed under COBRA's license (see LICENSE file).

Thank you for contributing to COBRA!
