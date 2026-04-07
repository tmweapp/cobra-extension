/**
 * Integration Tests — Tool Execution Pipeline
 * Tests the complete flow: Policy.check → validateToolArgs → ToolSafety → execute
 */
require('./setup');
require('../cobra-result');
require('../cobra-error-codes');
require('../cobra-policy');
require('../tool-safety');

const CobraPolicy = global.CobraPolicy;
const ToolSafety = global.ToolSafety;
const Result = global.Result;

// Load validateToolArgs
const fs = require('fs');
const code = fs.readFileSync(require('path').join(__dirname, '..', 'tool-executor.js'), 'utf8');
const fnMatch = code.match(/function validateToolArgs[\s\S]*?^}/m);
if (fnMatch) eval(fnMatch[0]);

// Mock TOOL_RISK_MAP
global.TOOL_RISK_MAP = {
  navigate: 'safe',
  click_element: 'risky',
  fill_form: 'risky',
  execute_js: 'destructive',
  google_search: 'safe',
  scrape_url: 'safe',
  send_email: 'risky',
  send_whatsapp: 'risky',
};

beforeEach(() => {
  CobraPolicy._trustLevel = 2;
  CobraPolicy._confirmationTokens.clear();
  ToolSafety._undoStack = [];
  ToolSafety._pendingPreview = null;
});

describe('Tool Pipeline — End-to-End', () => {
  describe('Safe tool: navigate', () => {
    test('full pipeline succeeds for valid navigation', () => {
      const args = { url: 'https://example.com' };

      // 1. Policy check
      const policyResult = CobraPolicy.check('navigate', args);
      expect(policyResult.success).toBe(true);

      // 2. Validate args
      expect(validateToolArgs('navigate', args)).toBe(true);

      // 3. Safety preview
      const preview = ToolSafety.generatePreview('navigate', args);
      expect(preview.requiresConfirmation).toBe(false);
      expect(preview.risk).toBe('safe');
    });

    test('pipeline blocks dangerous URL at policy level', () => {
      const args = { url: 'javascript:alert(1)' };
      const policyResult = CobraPolicy.check('navigate', args);
      expect(policyResult.success).toBe(false);
      // Pipeline stops here — never reaches validation or execution
    });

    test('pipeline blocks invalid URL at validation level', () => {
      const args = { url: 'ftp://invalid' };
      // Policy allows (not dangerous protocol)
      const policyResult = CobraPolicy.check('navigate', args);
      // Validation catches it
      expect(validateToolArgs('navigate', args)).toBeFalsy();
    });
  });

  describe('Risky tool: click_element', () => {
    test('blocked at trust level 0', () => {
      CobraPolicy._trustLevel = 0;
      const r = CobraPolicy.check('click_element', { selector: '#btn' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('TRUST_INSUFFICIENT');
    });

    test('allowed at trust level 2', () => {
      CobraPolicy._trustLevel = 2;
      const r = CobraPolicy.check('click_element', { selector: '#btn' });
      expect(r.success).toBe(true);
    });

    test('validation rejects oversized selector', () => {
      const longSelector = '.a'.repeat(300);
      CobraPolicy._trustLevel = 2;
      const policy = CobraPolicy.check('click_element', { selector: longSelector });
      // Policy passes (doesn't check selector length)
      // But validation fails
      expect(validateToolArgs('click_element', { selector: longSelector })).toBe(false);
    });
  });

  describe('Destructive tool: execute_js', () => {
    test('requires TRUSTED (3) — blocked at STANDARD (2)', () => {
      CobraPolicy._trustLevel = 2;
      const r = CobraPolicy.check('execute_js', { code: 'document.title' });
      expect(r.success).toBe(false);
    });

    test('full pipeline with TRUSTED level requires confirmation (destructive)', () => {
      CobraPolicy._trustLevel = 3;
      const args = { code: 'document.title' };

      // execute_js is "destructive" in TOOL_RISK_MAP, so requires confirmation
      const r1 = CobraPolicy.check('execute_js', args);
      expect(r1.success).toBe(false);
      expect(r1.code).toBe('POLICY_CONFIRM_NEEDED');
      const token = r1.details.confirmationToken;

      // After confirmation, it passes
      const r2 = CobraPolicy.check('execute_js', args, { confirmationToken: token });
      expect(r2.success).toBe(true);

      expect(validateToolArgs('execute_js', args)).toBe(true);

      const preview = ToolSafety.generatePreview('execute_js', args);
      expect(preview.risk).toBe('destructive');
      expect(preview.requiresConfirmation).toBe(true);
    });

    test('chrome API access blocked at dangerous pattern check', () => {
      CobraPolicy._trustLevel = 4;
      const args = { code: 'chrome.storage.local.get("keys")' };
      // Destructive tool asks for confirmation first, but dangerous pattern
      // is checked AFTER confirmation in the check flow.
      // First call: gets confirmation token (destructive)
      const r1 = CobraPolicy.check('execute_js', args);
      expect(r1.success).toBe(false);
      const token = r1.details.confirmationToken;

      // With confirmation: dangerous pattern check should block
      const r2 = CobraPolicy.check('execute_js', args, { confirmationToken: token });
      expect(r2.success).toBe(false);
      expect(r2.code).toBe('DANGEROUS_PATTERN');
    });
  });

  describe('Communication tool: send_email', () => {
    test('requires confirmation even at ADMIN trust', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('send_email', {});
      expect(r.success).toBe(false);
      expect(r.code).toBe('POLICY_CONFIRM_NEEDED');
      expect(r.details.confirmationToken).toBeDefined();
    });

    test('full pipeline with confirmation token', () => {
      CobraPolicy._trustLevel = 4;

      // Step 1: First attempt returns token
      const r1 = CobraPolicy.check('send_email', {});
      const token = r1.details.confirmationToken;

      // Step 2: Confirm with token
      const r2 = CobraPolicy.check('send_email', {}, { confirmationToken: token });
      expect(r2.success).toBe(true);
    });
  });

  describe('Domain-locked tool: send_whatsapp', () => {
    test('full pipeline: wrong domain → domain locked', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('send_whatsapp', {}, { url: 'https://google.com' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DOMAIN_LOCKED');
    });

    test('full pipeline: correct domain → needs confirmation', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('send_whatsapp', {}, { url: 'https://web.whatsapp.com' });
      // Not domain locked, but needs confirmation
      expect(r.code).toBe('POLICY_CONFIRM_NEEDED');
    });

    test('full pipeline: correct domain + token → success', () => {
      CobraPolicy._trustLevel = 4;
      const ctx = { url: 'https://web.whatsapp.com' };

      const r1 = CobraPolicy.check('send_whatsapp', {}, ctx);
      const token = r1.details.confirmationToken;

      const r2 = CobraPolicy.check('send_whatsapp', {}, { ...ctx, confirmationToken: token });
      expect(r2.success).toBe(true);
    });
  });

  describe('Undo stack integration', () => {
    test('capturePreState + undo flow for navigate', async () => {
      chrome.tabs.query.mockResolvedValueOnce([
        { id: 1, url: 'https://old.com', title: 'Old' },
      ]);
      chrome.tabs.update.mockResolvedValueOnce({});

      await ToolSafety.capturePreState('navigate', { url: 'https://new.com' });
      expect(ToolSafety.canUndo()).toBe(true);

      const undoResult = await ToolSafety.undo();
      expect(undoResult.ok).toBe(true);
      expect(undoResult.url).toBe('https://old.com');
      expect(ToolSafety.canUndo()).toBe(false);
    });
  });
});
