/**
 * Tests — CryptoUtils Command Validation
 * Tests the validateCommand function for relay security
 */
require('./setup');

// CryptoUtils uses crypto.subtle which is not fully available in jsdom
// We test the validateCommand logic which doesn't need Web Crypto
require('../crypto-utils');

const CryptoUtils = global.CryptoUtils || globalThis.CryptoUtils;

describe('CryptoUtils — Command Validation', () => {
  describe('Basic validation', () => {
    test('rejects null command', () => {
      expect(CryptoUtils.validateCommand(null).valid).toBe(false);
    });

    test('rejects non-object command', () => {
      expect(CryptoUtils.validateCommand('string').valid).toBe(false);
      expect(CryptoUtils.validateCommand(123).valid).toBe(false);
    });

    test('rejects command without type', () => {
      expect(CryptoUtils.validateCommand({}).valid).toBe(false);
      expect(CryptoUtils.validateCommand({ type: '' }).valid).toBe(false);
    });

    test('rejects unknown command type', () => {
      const r = CryptoUtils.validateCommand({ type: 'hack' });
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('non permesso');
    });
  });

  describe('Allowed command types', () => {
    const allowedTypes = ['nav', 'click', 'type', 'read', 'wait', 'scroll', 'select', 'formFill', 'snapshot', 'sequence', 'scrape', 'screenshot'];

    test('has all expected types', () => {
      for (const t of allowedTypes) {
        expect(CryptoUtils.ALLOWED_COMMAND_TYPES.has(t)).toBe(true);
      }
    });

    test('does not allow arbitrary types', () => {
      expect(CryptoUtils.ALLOWED_COMMAND_TYPES.has('exec')).toBe(false);
      expect(CryptoUtils.ALLOWED_COMMAND_TYPES.has('eval')).toBe(false);
      expect(CryptoUtils.ALLOWED_COMMAND_TYPES.has('shell')).toBe(false);
      expect(CryptoUtils.ALLOWED_COMMAND_TYPES.has('delete')).toBe(false);
    });
  });

  describe('nav command', () => {
    test('valid nav with https URL', () => {
      expect(CryptoUtils.validateCommand({ type: 'nav', url: 'https://example.com' }).valid).toBe(true);
    });

    test('valid nav with http URL', () => {
      expect(CryptoUtils.validateCommand({ type: 'nav', url: 'http://example.com' }).valid).toBe(true);
    });

    test('rejects nav without URL', () => {
      expect(CryptoUtils.validateCommand({ type: 'nav' }).valid).toBe(false);
    });

    test('rejects nav with invalid URL', () => {
      expect(CryptoUtils.validateCommand({ type: 'nav', url: 'not-a-url' }).valid).toBe(false);
    });

    test('rejects nav with javascript: protocol', () => {
      expect(CryptoUtils.validateCommand({ type: 'nav', url: 'javascript:alert(1)' }).valid).toBe(false);
    });

    test('rejects nav with ftp: protocol', () => {
      expect(CryptoUtils.validateCommand({ type: 'nav', url: 'ftp://example.com' }).valid).toBe(false);
    });

    test('rejects nav with data: protocol', () => {
      expect(CryptoUtils.validateCommand({ type: 'nav', url: 'data:text/html,<h1>test</h1>' }).valid).toBe(false);
    });

    test('rejects nav with file: protocol', () => {
      expect(CryptoUtils.validateCommand({ type: 'nav', url: 'file:///etc/passwd' }).valid).toBe(false);
    });
  });

  describe('click/read/wait/select commands', () => {
    for (const cmdType of ['click', 'read', 'wait', 'select']) {
      test(`${cmdType} requires selector`, () => {
        expect(CryptoUtils.validateCommand({ type: cmdType }).valid).toBe(false);
      });

      test(`${cmdType} accepts valid selector`, () => {
        expect(CryptoUtils.validateCommand({ type: cmdType, selector: '#btn' }).valid).toBe(true);
      });

      test(`${cmdType} rejects oversized selector`, () => {
        const r = CryptoUtils.validateCommand({ type: cmdType, selector: 'a'.repeat(1001) });
        expect(r.valid).toBe(false);
        expect(r.reason).toContain('troppo lungo');
      });
    }
  });

  describe('type command', () => {
    test('requires selector and text', () => {
      expect(CryptoUtils.validateCommand({ type: 'type' }).valid).toBe(false);
      expect(CryptoUtils.validateCommand({ type: 'type', selector: '#input' }).valid).toBe(false);
    });

    test('valid type command', () => {
      expect(CryptoUtils.validateCommand({ type: 'type', selector: '#input', text: 'hello' }).valid).toBe(true);
    });

    test('rejects text over 5000 chars', () => {
      const r = CryptoUtils.validateCommand({ type: 'type', selector: '#input', text: 'x'.repeat(5001) });
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('troppo lungo');
    });
  });

  describe('formFill command', () => {
    test('requires fields object', () => {
      expect(CryptoUtils.validateCommand({ type: 'formFill' }).valid).toBe(false);
    });

    test('valid formFill', () => {
      expect(CryptoUtils.validateCommand({ type: 'formFill', fields: { name: 'Test' } }).valid).toBe(true);
    });
  });

  describe('scroll command', () => {
    test('scroll requires no parameters', () => {
      expect(CryptoUtils.validateCommand({ type: 'scroll' }).valid).toBe(true);
    });
  });

  describe('sequence command', () => {
    test('requires steps array', () => {
      expect(CryptoUtils.validateCommand({ type: 'sequence' }).valid).toBe(false);
      expect(CryptoUtils.validateCommand({ type: 'sequence', steps: 'not-array' }).valid).toBe(false);
    });

    test('rejects empty steps', () => {
      expect(CryptoUtils.validateCommand({ type: 'sequence', steps: [] }).valid).toBe(false);
    });

    test('rejects more than 50 steps', () => {
      const steps = Array(51).fill({ type: 'scroll' });
      expect(CryptoUtils.validateCommand({ type: 'sequence', steps }).valid).toBe(false);
    });

    test('valid sequence with mixed steps', () => {
      const cmd = {
        type: 'sequence',
        steps: [
          { type: 'nav', url: 'https://example.com' },
          { type: 'click', selector: '#btn' },
          { type: 'type', selector: '#input', text: 'hello' },
          { type: 'scroll' },
        ],
      };
      expect(CryptoUtils.validateCommand(cmd).valid).toBe(true);
    });

    test('rejects sequence with invalid step', () => {
      const cmd = {
        type: 'sequence',
        steps: [
          { type: 'nav', url: 'https://example.com' },
          { type: 'nav' }, // missing url
        ],
      };
      const r = CryptoUtils.validateCommand(cmd);
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('step 1');
    });

    test('rejects sequence with disallowed command type in step', () => {
      const cmd = {
        type: 'sequence',
        steps: [{ type: 'hack' }],
      };
      expect(CryptoUtils.validateCommand(cmd).valid).toBe(false);
    });
  });
});
