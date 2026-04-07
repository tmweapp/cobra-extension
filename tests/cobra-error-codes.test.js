require('./setup');
require('../cobra-error-codes');

const COBRA_ERRORS = global.COBRA_ERRORS;
const getErrorDef = global.getErrorDef;

describe('COBRA_ERRORS', () => {
  test('is frozen (immutable)', () => {
    expect(Object.isFrozen(COBRA_ERRORS)).toBe(true);
  });

  test('contains expected error categories', () => {
    const categories = new Set(Object.values(COBRA_ERRORS).map(e => e.category));
    expect(categories).toContain('general');
    expect(categories).toContain('browser');
    expect(categories).toContain('network');
    expect(categories).toContain('policy');
    expect(categories).toContain('storage');
    expect(categories).toContain('jobs');
    expect(categories).toContain('dom');
  });

  test('every error has required fields', () => {
    for (const [key, def] of Object.entries(COBRA_ERRORS)) {
      expect(def.code).toBe(key);
      expect(def.severity).toBeDefined();
      expect(def.category).toBeDefined();
      expect(def.message).toBeDefined();
      expect(typeof def.message).toBe('string');
    }
  });

  test('severity values are valid', () => {
    const validSeverities = ['info', 'warn', 'error'];
    for (const def of Object.values(COBRA_ERRORS)) {
      expect(validSeverities).toContain(def.severity);
    }
  });

  test('has at least 30 error codes', () => {
    expect(Object.keys(COBRA_ERRORS).length).toBeGreaterThanOrEqual(30);
  });
});

describe('getErrorDef()', () => {
  test('returns correct definition for known code', () => {
    const def = getErrorDef('NO_ACTIVE_TAB');
    expect(def.code).toBe('NO_ACTIVE_TAB');
    expect(def.category).toBe('browser');
  });

  test('returns UNKNOWN for unrecognized code', () => {
    const def = getErrorDef('DOES_NOT_EXIST');
    expect(def.code).toBe('UNKNOWN');
  });

  test('returns UNKNOWN for undefined input', () => {
    const def = getErrorDef(undefined);
    expect(def.code).toBe('UNKNOWN');
  });
});
