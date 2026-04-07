/**
 * Security Tests — Policy Engine Deep Security
 * Tests dangerous pattern detection, Chrome API protection, protocol blocking
 */
require('./setup');
require('../cobra-result');
require('../cobra-error-codes');
require('../cobra-policy');

const CobraPolicy = global.CobraPolicy;

beforeEach(() => {
  CobraPolicy._trustLevel = 4; // ADMIN — so trust checks don't interfere
  CobraPolicy._confirmationTokens.clear();
});

describe('Security — Dangerous Pattern Detection', () => {
  describe('URL protocol attacks', () => {
    test('blocks javascript: protocol', () => {
      const r = CobraPolicy.check('navigate', { url: 'javascript:alert(document.cookie)' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks JAVASCRIPT: (uppercase)', () => {
      const r = CobraPolicy.check('navigate', { url: 'JAVASCRIPT:alert(1)' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks JaVaScRiPt: (mixed case)', () => {
      const r = CobraPolicy.check('navigate', { url: 'JaVaScRiPt:alert(1)' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks data: protocol', () => {
      const r = CobraPolicy.check('navigate', { url: 'data:text/html,<script>alert(1)</script>' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks data: with base64', () => {
      const r = CobraPolicy.check('navigate', { url: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('allows https: URLs', () => {
      const r = CobraPolicy.check('navigate', { url: 'https://example.com' });
      expect(r.success).toBe(true);
    });

    test('allows http: URLs', () => {
      const r = CobraPolicy.check('navigate', { url: 'http://example.com' });
      expect(r.success).toBe(true);
    });
  });

  describe('Chrome API access prevention in execute_js', () => {
    test('blocks chrome.storage access', () => {
      const r = CobraPolicy.check('execute_js', { code: 'chrome.storage.local.get("keys")' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks chrome.runtime access', () => {
      const r = CobraPolicy.check('execute_js', { code: 'chrome.runtime.sendMessage({})' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks chrome.tabs access', () => {
      const r = CobraPolicy.check('execute_js', { code: 'chrome.tabs.query({})' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks chrome.extension access', () => {
      const r = CobraPolicy.check('execute_js', { code: 'chrome.extension.getURL("x")' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks chrome.cookies access', () => {
      const r = CobraPolicy.check('execute_js', { code: 'chrome.cookies.getAll({})' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks chrome API with spaces', () => {
      const r = CobraPolicy.check('execute_js', { code: 'chrome . storage . local.get()' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('allows normal document access', () => {
      const r = CobraPolicy.check('execute_js', { code: 'document.querySelector(".item").textContent' });
      expect(r.success).toBe(true);
    });

    test('allows console.log', () => {
      const r = CobraPolicy.check('execute_js', { code: 'console.log("debug")' });
      expect(r.success).toBe(true);
    });

    test('allows window.location', () => {
      const r = CobraPolicy.check('execute_js', { code: 'window.location.href' });
      expect(r.success).toBe(true);
    });
  });

  describe('Trust escalation prevention', () => {
    test('cannot set trust level above 4', async () => {
      const result = await CobraPolicy.setTrustLevel(5);
      expect(result).toBe(false);
      expect(CobraPolicy.getTrustLevel()).toBe(4);
    });

    test('cannot set trust level below 0', async () => {
      const result = await CobraPolicy.setTrustLevel(-1);
      expect(result).toBe(false);
    });

    test('untrusted user cannot execute risky tools', () => {
      CobraPolicy._trustLevel = 0;
      const riskyTools = ['click_element', 'fill_form', 'save_to_kb', 'create_file', 'send_email'];
      for (const tool of riskyTools) {
        const r = CobraPolicy.check(tool, {});
        expect(r.success).toBe(false);
      }
    });

    test('standard user cannot execute execute_js', () => {
      CobraPolicy._trustLevel = 2;
      const r = CobraPolicy.check('execute_js', { code: 'document.title' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('TRUST_INSUFFICIENT');
    });
  });

  describe('Domain-sensitive tool restrictions', () => {
    test('blocks WhatsApp tool on banking sites', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('send_whatsapp', {}, { url: 'https://www.paypal.com' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DOMAIN_LOCKED');
    });

    test('blocks LinkedIn tool on random sites', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('send_linkedin', {}, { url: 'https://www.google.com' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DOMAIN_LOCKED');
    });
  });

  describe('Banking domain detection', () => {
    const bankingUrls = [
      'https://www.paypal.com',
      'https://www.stripe.com',
      'https://www.revolut.com',
      'https://www.n26.com',
      'https://www.intesasanpaolo.com',
      'https://www.fineco.it',
      'https://www.unicredit.it',
      'https://onlinebanking.example.com',
      'https://internetbanking.test.com',
    ];

    test.each(bankingUrls)('detects %s as banking', (url) => {
      const result = CobraPolicy.classifyDomain(url);
      expect(result.isSensitive).toBe(true);
      expect(result.categories).toContain('banking');
    });

    test('does not flag mybank-reviews.com as banking', () => {
      // Regex should be anchored — "bank" must be at start of domain component
      const result = CobraPolicy.classifyDomain('https://mybank-reviews.blogspot.com');
      // This tests the anchored regex fix from v10
      expect(result.categories).not.toContain('banking');
    });
  });
});
