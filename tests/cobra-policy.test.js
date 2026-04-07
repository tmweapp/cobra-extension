require('./setup');
require('../cobra-result');
require('../cobra-error-codes');
require('../cobra-policy');

const CobraPolicy = global.CobraPolicy;
const Result = global.Result;

// Reset state before each test
beforeEach(() => {
  CobraPolicy._trustLevel = 2; // STANDARD
  CobraPolicy._confirmationTokens.clear();
});

describe('CobraPolicy', () => {
  describe('Trust Levels', () => {
    test('TRUST constants are frozen', () => {
      expect(Object.isFrozen(CobraPolicy.TRUST)).toBe(true);
    });

    test('has correct trust level values', () => {
      expect(CobraPolicy.TRUST.UNTRUSTED).toBe(0);
      expect(CobraPolicy.TRUST.BASIC).toBe(1);
      expect(CobraPolicy.TRUST.STANDARD).toBe(2);
      expect(CobraPolicy.TRUST.TRUSTED).toBe(3);
      expect(CobraPolicy.TRUST.ADMIN).toBe(4);
    });

    test('getTrustLevel returns current level', () => {
      expect(CobraPolicy.getTrustLevel()).toBe(2);
    });

    test('setTrustLevel updates level and persists', async () => {
      await CobraPolicy.setTrustLevel(3);
      expect(CobraPolicy.getTrustLevel()).toBe(3);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { cobra_policy: { trustLevel: 3 } }
      );
    });

    test('setTrustLevel rejects invalid levels', async () => {
      expect(await CobraPolicy.setTrustLevel(-1)).toBe(false);
      expect(await CobraPolicy.setTrustLevel(5)).toBe(false);
      expect(CobraPolicy.getTrustLevel()).toBe(2);
    });
  });

  describe('classifyDomain()', () => {
    test('classifies banking domains', () => {
      const r = CobraPolicy.classifyDomain('https://www.paypal.com/login');
      expect(r.isSensitive).toBe(true);
      expect(r.categories).toContain('banking');
    });

    test('classifies social media domains', () => {
      const r = CobraPolicy.classifyDomain('https://www.facebook.com');
      expect(r.isSensitive).toBe(true);
      expect(r.categories).toContain('social');
    });

    test('classifies auth domains', () => {
      const r = CobraPolicy.classifyDomain('https://accounts.google.com');
      expect(r.isSensitive).toBe(true);
      expect(r.categories).toContain('auth');
    });

    test('classifies email domains', () => {
      const r = CobraPolicy.classifyDomain('https://www.gmail.com');
      expect(r.isSensitive).toBe(true);
      expect(r.categories).toContain('email');
    });

    test('does not classify normal domains as sensitive', () => {
      const r = CobraPolicy.classifyDomain('https://www.example.com');
      expect(r.isSensitive).toBe(false);
      expect(r.categories).toEqual([]);
    });

    test('handles invalid URLs gracefully', () => {
      const r = CobraPolicy.classifyDomain('not-a-url');
      expect(r.hostname).toBe('not-a-url');
      expect(r.isSensitive).toBe(false);
    });

    test('handles empty input', () => {
      const r = CobraPolicy.classifyDomain('');
      expect(r.hostname).toBe('');
    });
  });

  describe('check() - Trust Level Enforcement', () => {
    test('allows safe tools at any trust level', () => {
      CobraPolicy._trustLevel = 0;
      const r = CobraPolicy.check('navigate', { url: 'https://example.com' });
      expect(r.success).toBe(true);
    });

    test('blocks risky tools below required trust', () => {
      CobraPolicy._trustLevel = 1; // BASIC
      const r = CobraPolicy.check('click_element', { selector: '#btn' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('TRUST_INSUFFICIENT');
    });

    test('allows risky tools at required trust', () => {
      CobraPolicy._trustLevel = 2; // STANDARD
      const r = CobraPolicy.check('click_element', { selector: '#btn' });
      expect(r.success).toBe(true);
    });

    test('blocks execute_js below TRUSTED', () => {
      CobraPolicy._trustLevel = 2;
      const r = CobraPolicy.check('execute_js', { code: 'console.log(1)' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('TRUST_INSUFFICIENT');
    });
  });

  describe('check() - Domain Locks', () => {
    test('blocks send_whatsapp outside WhatsApp Web', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('send_whatsapp', {}, { url: 'https://www.google.com' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DOMAIN_LOCKED');
    });

    test('allows send_whatsapp on WhatsApp Web', () => {
      CobraPolicy._trustLevel = 4;
      // needs confirmation token for send_whatsapp
      const r1 = CobraPolicy.check('send_whatsapp', {}, { url: 'https://web.whatsapp.com' });
      // Will ask for confirmation (not domain-locked)
      expect(r1.code).not.toBe('DOMAIN_LOCKED');
    });

    test('blocks send_linkedin outside LinkedIn', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('send_linkedin', {}, { url: 'https://www.example.com' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DOMAIN_LOCKED');
    });
  });

  describe('check() - Dangerous Pattern Detection', () => {
    test('blocks javascript: URLs', () => {
      const r = CobraPolicy.check('navigate', { url: 'javascript:alert(1)' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks data: URLs', () => {
      const r = CobraPolicy.check('navigate', { url: 'data:text/html,<h1>test</h1>' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('blocks chrome API access in execute_js', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('execute_js', { code: 'chrome.storage.local.get()' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('DANGEROUS_PATTERN');
    });

    test('allows normal code in execute_js', () => {
      CobraPolicy._trustLevel = 4;
      const r = CobraPolicy.check('execute_js', { code: 'document.title' });
      expect(r.success).toBe(true);
    });
  });

  describe('Confirmation Tokens', () => {
    test('send_email requires confirmation', () => {
      const r = CobraPolicy.check('send_email', {});
      expect(r.success).toBe(false);
      expect(r.code).toBe('POLICY_CONFIRM_NEEDED');
      expect(r.details.confirmationToken).toBeDefined();
    });

    test('valid token allows execution', () => {
      // First call generates token
      const r1 = CobraPolicy.check('send_email', {});
      const token = r1.details.confirmationToken;

      // Second call with token succeeds
      const r2 = CobraPolicy.check('send_email', {}, { confirmationToken: token });
      expect(r2.success).toBe(true);
    });

    test('token is single-use', () => {
      const r1 = CobraPolicy.check('send_email', {});
      const token = r1.details.confirmationToken;

      // First use succeeds
      CobraPolicy.check('send_email', {}, { confirmationToken: token });

      // Second use fails
      const r3 = CobraPolicy.check('send_email', {}, { confirmationToken: token });
      expect(r3.success).toBe(false);
      expect(r3.code).toBe('POLICY_CONFIRM_NEEDED');
    });

    test('expired token is rejected', () => {
      const r1 = CobraPolicy.check('send_email', {});
      const token = r1.details.confirmationToken;

      // Manually expire the token
      const stored = CobraPolicy._confirmationTokens.get(token);
      stored.ts = Date.now() - 200000; // past TTL

      const r2 = CobraPolicy.check('send_email', {}, { confirmationToken: token });
      expect(r2.success).toBe(false);
    });

    test('getPendingConfirmations returns valid tokens', () => {
      CobraPolicy.check('send_email', {});
      CobraPolicy.check('send_whatsapp', {}, { url: 'https://web.whatsapp.com' });
      const pending = CobraPolicy.getPendingConfirmations();
      expect(pending.length).toBe(2);
      expect(pending[0].expiresIn).toBeGreaterThan(0);
    });
  });
});
