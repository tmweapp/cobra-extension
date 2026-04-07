/**
 * Security Tests — XSS Prevention
 * Tests sanitizeHTML and dangerous pattern detection
 */
require('./setup');

// Replicate sanitizeHTML from sidepanel.js
function sanitizeHTML(str) {
  if (!str || typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

describe('XSS Prevention — sanitizeHTML', () => {
  // NOTE: sanitizeHTML uses textContent assignment which converts ALL input to
  // plain text. The output contains HTML entities for < > & but preserves the
  // original text content (including words like "onerror", "href"). This is SAFE
  // because the entire string is treated as text, not as HTML markup.

  describe('HTML tag escaping', () => {
    test('escapes < and > so tags are not rendered', () => {
      const result = sanitizeHTML('<b>bold</b>');
      expect(result).not.toContain('<b>');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });

    test('escapes ampersand', () => {
      const result = sanitizeHTML('a & b');
      expect(result).toContain('&amp;');
    });
  });

  describe('script injection — tags are escaped', () => {
    test('script tags become text entities', () => {
      const result = sanitizeHTML('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });

    test('nested script tags are fully escaped', () => {
      const result = sanitizeHTML('<scr<script>ipt>alert(1)</script>');
      expect(result).not.toContain('<script');
    });

    test('uppercase SCRIPT tags are escaped', () => {
      const result = sanitizeHTML('<SCRIPT>alert(1)</SCRIPT>');
      expect(result).not.toContain('<SCRIPT');
    });
  });

  describe('event handler injection — tags are escaped', () => {
    test('img onerror becomes plain text (no DOM element created)', () => {
      const result = sanitizeHTML('<img src=x onerror=alert(1)>');
      // The key safety guarantee: the < and > are escaped
      expect(result).toContain('&lt;img');
      expect(result).toContain('&gt;');
      // The text "onerror" exists but as plain text, not an attribute
    });

    test('svg onload becomes plain text', () => {
      const result = sanitizeHTML('<svg onload=alert(1)>');
      expect(result).toContain('&lt;svg');
    });

    test('div onmouseover becomes plain text', () => {
      const result = sanitizeHTML('<div onmouseover="alert(1)">hover me</div>');
      expect(result).toContain('&lt;div');
      expect(result).not.toContain('<div');
    });
  });

  describe('protocol injection — tags are escaped', () => {
    test('a href becomes plain text', () => {
      const result = sanitizeHTML('<a href="javascript:alert(1)">click</a>');
      expect(result).toContain('&lt;a');
      expect(result).not.toContain('<a ');
    });

    test('data: URI in tag is fully escaped', () => {
      const result = sanitizeHTML('<a href="data:text/html,<script>alert(1)</script>">x</a>');
      expect(result).not.toContain('<a ');
      expect(result).toContain('&lt;a');
    });
  });

  describe('HTML5 vector attacks — all tags escaped', () => {
    test('svg with script becomes plain text', () => {
      const result = sanitizeHTML('<svg><script>alert(1)</script></svg>');
      expect(result).not.toContain('<svg>');
      expect(result).not.toContain('<script>');
    });

    test('iframe becomes plain text', () => {
      const result = sanitizeHTML('<iframe src="javascript:alert(1)"></iframe>');
      expect(result).not.toContain('<iframe');
    });

    test('object/embed becomes plain text', () => {
      const result = sanitizeHTML('<object data="data:text/html,<script>alert(1)</script>">');
      expect(result).not.toContain('<object');
    });
  });

  describe('safe output verification', () => {
    test('output inserted via innerHTML creates no DOM elements', () => {
      const dangerous = '<img src=x onerror=alert(1)><script>alert(2)</script>';
      const safe = sanitizeHTML(dangerous);
      const container = document.createElement('div');
      container.innerHTML = safe;
      // No img or script elements should be created
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
      // Only text node
      expect(container.childNodes.length).toBeGreaterThan(0);
    });

    test('complex XSS payload produces safe HTML', () => {
      const payload = '"><img src=x onerror=alert(1)><script>document.cookie</script><iframe src="javascript:alert(2)">';
      const safe = sanitizeHTML(payload);
      const container = document.createElement('div');
      container.innerHTML = safe;
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('iframe')).toBeNull();
    });
  });

  describe('edge cases', () => {
    test('returns empty string for null', () => {
      expect(sanitizeHTML(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
      expect(sanitizeHTML(undefined)).toBe('');
    });

    test('returns empty string for number', () => {
      expect(sanitizeHTML(123)).toBe('');
    });

    test('returns empty string for empty string', () => {
      expect(sanitizeHTML('')).toBe('');
    });

    test('preserves normal text', () => {
      expect(sanitizeHTML('Hello world')).toBe('Hello world');
    });

    test('preserves unicode text', () => {
      const text = 'Ciao mondo! Buongiorno 🌍';
      expect(sanitizeHTML(text)).toBe(text);
    });

    test('handles very long strings', () => {
      const long = '<script>' + 'x'.repeat(10000) + '</script>';
      const result = sanitizeHTML(long);
      expect(result).not.toContain('<script>');
    });
  });
});
