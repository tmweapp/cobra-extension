// Load module under test
require('./setup');
require('../cobra-result');

const Result = global.Result;

describe('Result', () => {
  describe('ok()', () => {
    test('returns success result with data', () => {
      const r = Result.ok({ foo: 'bar' });
      expect(r.success).toBe(true);
      expect(r.data).toEqual({ foo: 'bar' });
      expect(r.meta.ts).toBeDefined();
    });

    test('returns success result with null data by default', () => {
      const r = Result.ok();
      expect(r.success).toBe(true);
      expect(r.data).toBeNull();
    });

    test('includes custom meta', () => {
      const r = Result.ok('value', { source: 'test' });
      expect(r.meta.source).toBe('test');
      expect(r.meta.ts).toBeDefined();
    });
  });

  describe('fail()', () => {
    test('returns failure result with code and message', () => {
      const r = Result.fail('NOT_FOUND', 'Item not found');
      expect(r.success).toBe(false);
      expect(r.code).toBe('NOT_FOUND');
      expect(r.message).toBe('Item not found');
      expect(r.ts).toBeDefined();
    });

    test('defaults to UNKNOWN code and generic message', () => {
      const r = Result.fail();
      expect(r.code).toBe('UNKNOWN');
      expect(r.message).toBe('Errore sconosciuto');
    });

    test('includes details object', () => {
      const r = Result.fail('ERR', 'msg', { field: 'email' });
      expect(r.details).toEqual({ field: 'email' });
    });
  });

  describe('serialize()', () => {
    test('serializes success result with object data', () => {
      const r = Result.ok({ count: 5 });
      const json = JSON.parse(Result.serialize(r));
      expect(json.ok).toBe(true);
      expect(json.count).toBe(5);
    });

    test('serializes success result with primitive data', () => {
      const r = Result.ok('hello');
      const json = JSON.parse(Result.serialize(r));
      expect(json.ok).toBe(true);
      expect(json.data).toBe('hello');
    });

    test('serializes failure result', () => {
      const r = Result.fail('ERR', 'something broke');
      const json = JSON.parse(Result.serialize(r));
      expect(json.error).toBe('something broke');
      expect(json.code).toBe('ERR');
    });

    test('returns empty object for null', () => {
      expect(Result.serialize(null)).toBe('{}');
    });
  });

  describe('wrap()', () => {
    test('wraps successful async function', async () => {
      const fn = async () => 42;
      const wrapped = Result.wrap(fn);
      const r = await wrapped();
      expect(r.success).toBe(true);
      expect(r.data).toBe(42);
    });

    test('wraps throwing async function into fail', async () => {
      const fn = async () => { throw new Error('boom'); };
      const wrapped = Result.wrap(fn, 'TEST_ERR');
      const r = await wrapped();
      expect(r.success).toBe(false);
      expect(r.code).toBe('TEST_ERR');
      expect(r.message).toBe('boom');
    });

    test('passes through existing Result objects', async () => {
      const fn = async () => Result.ok('already wrapped');
      const wrapped = Result.wrap(fn);
      const r = await wrapped();
      expect(r.success).toBe(true);
      expect(r.data).toBe('already wrapped');
    });
  });

  describe('isResult()', () => {
    test('returns true for ok result', () => {
      expect(Result.isResult(Result.ok())).toBe(true);
    });

    test('returns true for fail result', () => {
      expect(Result.isResult(Result.fail('E', 'm'))).toBe(true);
    });

    test('returns false for plain objects', () => {
      expect(Result.isResult({ foo: 'bar' })).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(Result.isResult(null)).toBe(false);
      expect(Result.isResult(undefined)).toBe(false);
    });
  });

  describe('fromLegacy()', () => {
    test('converts {ok: true, ...} to success Result', () => {
      const r = Result.fromLegacy({ ok: true, items: [1, 2] });
      expect(r.success).toBe(true);
      expect(r.data.items).toEqual([1, 2]);
    });

    test('converts {error: "msg"} to fail Result', () => {
      const r = Result.fromLegacy({ error: 'not found' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('LEGACY');
      expect(r.message).toBe('not found');
    });

    test('wraps unknown objects as ok', () => {
      const r = Result.fromLegacy({ count: 10 });
      expect(r.success).toBe(true);
      expect(r.data).toEqual({ count: 10 });
    });

    test('handles null input', () => {
      const r = Result.fromLegacy(null);
      expect(r.success).toBe(true);
      expect(r.data).toBeNull();
    });
  });
});
