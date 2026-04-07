/**
 * COBRA v5.2 — Message Contracts & Validation Tests
 * Comprehensive test suite for cobra-contracts.js
 */

describe('CobraContracts', () => {
  // Setup mock global environment
  global.self = {};

  // Import the module under test
  require('../cobra-contracts.js');
  const CobraContracts = global.self.CobraContracts;

  beforeEach(() => {
    // Reset state before each test if needed
  });

  describe('ALLOWED_TYPES', () => {
    it('should contain all required message types', () => {
      expect(CobraContracts.ALLOWED_TYPES.has('CHAT_MESSAGE')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('CHAT_ABORT')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('SCRAPE')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('BATCH_SCRAPE')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('CRAWL')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('GET_BRAIN')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('SET_BRAIN')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('GET_SETTINGS')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('SET_SETTINGS')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('TAB_INFO')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('PAGE_CONTEXT')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('SUPERVISOR_HEALTH')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('PING')).toBe(true);
      expect(CobraContracts.ALLOWED_TYPES.has('HEALTH_CHECK')).toBe(true);
    });

    it('should be exactly 18 types', () => {
      expect(CobraContracts.ALLOWED_TYPES.size).toBe(18);
    });
  });

  describe('ALLOWED_ACTIONS', () => {
    it('should contain AUDIT_* actions', () => {
      expect(CobraContracts.ALLOWED_ACTIONS.has('AUDIT_QUERY')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('AUDIT_STATS')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('AUDIT_EXPORT')).toBe(true);
    });

    it('should contain GUARD_* actions', () => {
      expect(CobraContracts.ALLOWED_ACTIONS.has('GUARD_STATS')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('GUARD_RESET')).toBe(true);
    });

    it('should contain communication actions', () => {
      expect(CobraContracts.ALLOWED_ACTIONS.has('COMM_SEND_EMAIL')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('COMM_SEND_WA')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('COMM_SEND_LINKEDIN')).toBe(true);
    });

    it('should contain file operations', () => {
      expect(CobraContracts.ALLOWED_ACTIONS.has('FILE_LIST')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('FILE_READ')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('FILE_SEARCH')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('FILE_SAVE')).toBe(true);
    });

    it('should contain knowledge base operations', () => {
      expect(CobraContracts.ALLOWED_ACTIONS.has('KB_SEARCH')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('KB_SAVE')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('KB_UPDATE')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('KB_DELETE')).toBe(true);
    });

    it('should contain job operations', () => {
      expect(CobraContracts.ALLOWED_ACTIONS.has('JOB_CREATE')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('JOB_START')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('PJOB_CREATE')).toBe(true);
      expect(CobraContracts.ALLOWED_ACTIONS.has('PJOB_RUN')).toBe(true);
    });

    it('should be a Set with many actions', () => {
      expect(CobraContracts.ALLOWED_ACTIONS.size).toBeGreaterThan(30);
    });
  });

  describe('validateMessage()', () => {
    it('should accept valid message with type', () => {
      const result = CobraContracts.validateMessage({ type: 'CHAT_MESSAGE', content: 'hello' });
      expect(result.ok).toBe(true);
    });

    it('should accept valid message with action', () => {
      const result = CobraContracts.validateMessage({ action: 'FILE_READ', path: '/test' });
      expect(result.ok).toBe(true);
    });

    it('should reject non-object message', () => {
      const result = CobraContracts.validateMessage('invalid');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_MESSAGE');
      expect(result.error).toContain('oggetto');
    });

    it('should reject null message', () => {
      const result = CobraContracts.validateMessage(null);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_MESSAGE');
    });

    it('should reject undefined message', () => {
      const result = CobraContracts.validateMessage(undefined);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_MESSAGE');
    });

    it('should reject message missing both type and action', () => {
      const result = CobraContracts.validateMessage({ content: 'hello' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MISSING_ACTION');
      expect(result.error).toContain('senza type');
    });

    it('should reject message with unknown type', () => {
      const result = CobraContracts.validateMessage({ type: 'UNKNOWN_TYPE' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('UNKNOWN_TYPE');
      expect(result.error).toContain('UNKNOWN_TYPE');
    });

    it('should reject message with unknown action', () => {
      const result = CobraContracts.validateMessage({ action: 'UNKNOWN_ACTION' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('UNKNOWN_ACTION');
      expect(result.error).toContain('UNKNOWN_ACTION');
    });

    it('should reject message larger than MAX_MESSAGE_LENGTH', () => {
      const largeMsg = { action: 'FILE_READ', data: 'x'.repeat(60000) };
      const result = CobraContracts.validateMessage(largeMsg);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MESSAGE_TOO_LARGE');
      expect(result.error).toContain('troppo grande');
    });

    it('should reject non-serializable message', () => {
      const circular = { action: 'FILE_READ' };
      circular.self = circular;
      const result = CobraContracts.validateMessage(circular);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_MESSAGE');
      expect(result.error).toContain('serializzabile');
    });

    it('should accept message exactly at MAX_MESSAGE_LENGTH boundary', () => {
      const msg = { action: 'FILE_READ', data: 'x'.repeat(49950) };
      const size = JSON.stringify(msg).length;
      if (size <= CobraContracts.MAX_MESSAGE_LENGTH) {
        const result = CobraContracts.validateMessage(msg);
        expect(result.ok).toBe(true);
      }
    });
  });

  describe('validateChatPayload()', () => {
    it('should accept valid chat payload with message', () => {
      const result = CobraContracts.validateChatPayload({ message: 'Hello, world!' });
      expect(result.ok).toBe(true);
    });

    it('should reject non-object payload', () => {
      const result = CobraContracts.validateChatPayload('invalid');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD');
    });

    it('should reject null payload', () => {
      const result = CobraContracts.validateChatPayload(null);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD');
    });

    it('should reject undefined payload', () => {
      const result = CobraContracts.validateChatPayload(undefined);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD');
    });

    it('should reject payload without message', () => {
      const result = CobraContracts.validateChatPayload({});
      expect(result.ok).toBe(false);
      expect(result.code).toBe('EMPTY_MESSAGE');
    });

    it('should reject payload with empty message', () => {
      const result = CobraContracts.validateChatPayload({ message: '' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('EMPTY_MESSAGE');
    });

    it('should reject payload with whitespace-only message', () => {
      const result = CobraContracts.validateChatPayload({ message: '   ' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('EMPTY_MESSAGE');
    });

    it('should reject payload with non-string message', () => {
      const result = CobraContracts.validateChatPayload({ message: 123 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('EMPTY_MESSAGE');
    });

    it('should reject message longer than MAX_GOAL (2000)', () => {
      const result = CobraContracts.validateChatPayload({ message: 'x'.repeat(2001) });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MESSAGE_TOO_LONG');
      expect(result.error).toContain('2001');
    });

    it('should accept message at MAX_GOAL boundary', () => {
      const result = CobraContracts.validateChatPayload({ message: 'x'.repeat(2000) });
      expect(result.ok).toBe(true);
    });
  });

  describe('validateToolPayload()', () => {
    it('should accept valid tool payload', () => {
      const result = CobraContracts.validateToolPayload({
        selector: '.button',
        url: 'https://example.com'
      });
      expect(result.ok).toBe(true);
    });

    it('should reject non-object payload', () => {
      const result = CobraContracts.validateToolPayload('invalid');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD');
    });

    it('should reject null payload', () => {
      const result = CobraContracts.validateToolPayload(null);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_PAYLOAD');
    });

    it('should accept empty payload', () => {
      const result = CobraContracts.validateToolPayload({});
      expect(result.ok).toBe(true);
    });

    it('should reject selector that is non-string', () => {
      const result = CobraContracts.validateToolPayload({ selector: 123 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_SELECTOR');
    });

    it('should reject selector longer than MAX_SELECTOR (500)', () => {
      const result = CobraContracts.validateToolPayload({ selector: 'x'.repeat(501) });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_SELECTOR');
    });

    it('should accept selector at MAX_SELECTOR boundary', () => {
      const result = CobraContracts.validateToolPayload({ selector: 'x'.repeat(500) });
      expect(result.ok).toBe(true);
    });

    it('should reject URL that is non-string', () => {
      const result = CobraContracts.validateToolPayload({ url: 123 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_URL');
    });

    it('should reject URL longer than MAX_URL (2048)', () => {
      const result = CobraContracts.validateToolPayload({ url: 'https://' + 'x'.repeat(2050) });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('INVALID_URL');
    });

    it('should accept URL at MAX_URL boundary', () => {
      const result = CobraContracts.validateToolPayload({ url: 'x'.repeat(2048) });
      expect(result.ok).toBe(true);
    });

    it('should reject text that is non-string', () => {
      const result = CobraContracts.validateToolPayload({ text: 123 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('TEXT_TOO_LONG');
    });

    it('should reject text longer than MAX_STRING (5000)', () => {
      const result = CobraContracts.validateToolPayload({ text: 'x'.repeat(5001) });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('TEXT_TOO_LONG');
    });

    it('should accept text at MAX_STRING boundary', () => {
      const result = CobraContracts.validateToolPayload({ text: 'x'.repeat(5000) });
      expect(result.ok).toBe(true);
    });

    it('should accept payload with all valid fields', () => {
      const result = CobraContracts.validateToolPayload({
        selector: '.button',
        url: 'https://example.com',
        text: 'Some text content'
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('sanitize()', () => {
    it('should sanitize email addresses', () => {
      const result = CobraContracts.sanitize('Contact me at john.doe@example.com');
      expect(result).toContain('[EMAIL]');
      expect(result).not.toContain('@');
    });

    it('should sanitize multiple emails', () => {
      const result = CobraContracts.sanitize('john@example.com and jane@test.org');
      const emailCount = (result.match(/\[EMAIL\]/g) || []).length;
      expect(emailCount).toBe(2);
    });

    it('should sanitize long numbers (10+ digits)', () => {
      const result = CobraContracts.sanitize('My credit card is 4532123456789012');
      expect(result).toContain('[NUMBER]');
      expect(result).not.toContain('4532123456789012');
    });

    it('should not sanitize short numbers', () => {
      const result = CobraContracts.sanitize('I have 123 apples');
      expect(result).not.toContain('[NUMBER]');
    });

    it('should sanitize tokens (20+ alphanumeric chars)', () => {
      const result = CobraContracts.sanitize('Token: AbCdEfGhIjKlMnOpQrSt');
      expect(result).toContain('[TOKEN]');
    });

    it('should not sanitize short alphanumeric strings', () => {
      const result = CobraContracts.sanitize('abc123def');
      expect(result).not.toContain('[TOKEN]');
    });

    it('should return non-string input unchanged', () => {
      expect(CobraContracts.sanitize(123)).toBe(123);
      expect(CobraContracts.sanitize(null)).toBe(null);
      expect(CobraContracts.sanitize(undefined)).toBe(undefined);
    });

    it('should truncate to 2000 characters', () => {
      const longText = 'hello world '.repeat(250); // 12*250 = 3000 chars, doesn't match token pattern
      const result = CobraContracts.sanitize(longText);
      expect(result.length).toBe(2000);
      expect(result.startsWith('hello world')).toBe(true);
    });

    it('should handle complex mixed content', () => {
      const text = 'Email: test@example.com, Token: AbCdEfGhIjKlMnOpQrSt123456, Number: 9876543210';
      const result = CobraContracts.sanitize(text);
      expect(result).toContain('[EMAIL]');
      expect(result).toContain('[TOKEN]');
      expect(result).toContain('[NUMBER]');
    });
  });

  describe('isValidString()', () => {
    it('should accept valid string within default max length', () => {
      expect(CobraContracts.isValidString('hello')).toBe(true);
    });

    it('should reject empty string', () => {
      expect(CobraContracts.isValidString('')).toBe(false);
    });

    it('should reject non-string', () => {
      expect(CobraContracts.isValidString(123)).toBe(false);
      expect(CobraContracts.isValidString(null)).toBe(false);
    });

    it('should reject string exceeding default max length (2000)', () => {
      expect(CobraContracts.isValidString('x'.repeat(2001))).toBe(false);
    });

    it('should accept string at default max length boundary', () => {
      expect(CobraContracts.isValidString('x'.repeat(2000))).toBe(true);
    });

    it('should accept valid string within custom max length', () => {
      expect(CobraContracts.isValidString('hello', 100)).toBe(true);
    });

    it('should reject string exceeding custom max length', () => {
      expect(CobraContracts.isValidString('x'.repeat(101), 100)).toBe(false);
    });

    it('should accept string at custom max length boundary', () => {
      expect(CobraContracts.isValidString('x'.repeat(100), 100)).toBe(true);
    });
  });

  describe('Constants', () => {
    it('should have correct MAX_MESSAGE_LENGTH', () => {
      expect(CobraContracts.MAX_MESSAGE_LENGTH).toBe(50000);
    });

    it('should have correct MAX_STRING', () => {
      expect(CobraContracts.MAX_STRING).toBe(5000);
    });

    it('should have correct MAX_GOAL', () => {
      expect(CobraContracts.MAX_GOAL).toBe(2000);
    });

    it('should have correct MAX_SELECTOR', () => {
      expect(CobraContracts.MAX_SELECTOR).toBe(500);
    });

    it('should have correct MAX_URL', () => {
      expect(CobraContracts.MAX_URL).toBe(2048);
    });
  });

  describe('Module Registration', () => {
    it('should register itself on self object', () => {
      expect(global.self.CobraContracts).toBeDefined();
      expect(global.self.CobraContracts).toBe(CobraContracts);
    });
  });
});
