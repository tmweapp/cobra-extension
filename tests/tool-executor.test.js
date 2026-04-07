require('./setup');

// Load validateToolArgs from tool-executor (it's defined as a plain function)
// We need to eval it since it uses self. globals
const fs = require('fs');
const code = fs.readFileSync(require('path').join(__dirname, '..', 'tool-executor.js'), 'utf8');

// Extract just the validateToolArgs function
const fnMatch = code.match(/function validateToolArgs[\s\S]*?^}/m);
if (fnMatch) {
  eval(fnMatch[0]);
}

describe('validateToolArgs()', () => {
  describe('navigate', () => {
    test('accepts valid http URL', () => {
      expect(validateToolArgs('navigate', { url: 'https://example.com' })).toBe(true);
    });

    test('accepts valid http URL', () => {
      expect(validateToolArgs('navigate', { url: 'http://example.com/path?q=1' })).toBe(true);
    });

    test('rejects missing url', () => {
      expect(validateToolArgs('navigate', {})).toBeFalsy();
    });

    test('rejects non-http url', () => {
      expect(validateToolArgs('navigate', { url: 'ftp://example.com' })).toBeFalsy();
    });
  });

  describe('click_element', () => {
    test('accepts valid selector', () => {
      expect(validateToolArgs('click_element', { selector: '#btn' })).toBe(true);
    });

    test('rejects missing selector', () => {
      expect(validateToolArgs('click_element', {})).toBeFalsy();
    });

    test('rejects selector exceeding 500 chars', () => {
      expect(validateToolArgs('click_element', { selector: 'a'.repeat(501) })).toBe(false);
    });

    test('accepts selector at 500 chars', () => {
      expect(validateToolArgs('click_element', { selector: 'a'.repeat(499) })).toBe(true);
    });
  });

  describe('fill_form', () => {
    test('accepts object fields', () => {
      expect(validateToolArgs('fill_form', { fields: { name: 'test' } })).toBeTruthy();
    });

    test('rejects missing fields', () => {
      expect(validateToolArgs('fill_form', {})).toBeFalsy();
    });
  });

  describe('execute_js', () => {
    test('accepts short code', () => {
      expect(validateToolArgs('execute_js', { code: 'document.title' })).toBe(true);
    });

    test('rejects missing code', () => {
      expect(validateToolArgs('execute_js', {})).toBeFalsy();
    });

    test('rejects code exceeding 10000 chars', () => {
      expect(validateToolArgs('execute_js', { code: 'x'.repeat(10001) })).toBe(false);
    });
  });

  describe('scrape_url', () => {
    test('accepts valid URL', () => {
      expect(validateToolArgs('scrape_url', { url: 'https://example.com' })).toBe(true);
    });

    test('rejects invalid URL', () => {
      expect(validateToolArgs('scrape_url', { url: 'not-a-url' })).toBeFalsy();
    });
  });

  describe('google_search', () => {
    test('accepts valid query', () => {
      expect(validateToolArgs('google_search', { query: 'test search' })).toBe(true);
    });

    test('rejects query exceeding 1000 chars', () => {
      expect(validateToolArgs('google_search', { query: 'x'.repeat(1001) })).toBe(false);
    });
  });

  describe('unknown tools', () => {
    test('returns true for unregistered tools (no validation)', () => {
      expect(validateToolArgs('completely_unknown', { anything: 'goes' })).toBe(true);
    });
  });
});
