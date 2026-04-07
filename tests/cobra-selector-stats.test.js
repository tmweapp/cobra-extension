require('./setup');
require('../cobra-selector-stats');

const Stats = global.CobraSelectorStats;

beforeEach(() => {
  Stats._cache.clear();
  Stats._dirty = false;
  // Don't start interval in tests
  if (Stats._flushInterval) {
    clearInterval(Stats._flushInterval);
    Stats._flushInterval = null;
  }
});

describe('CobraSelectorStats', () => {
  describe('recordSuccess()', () => {
    test('creates new entry on first record', () => {
      Stats.recordSuccess('example.com', '.btn');
      const key = 'example.com::.btn';
      expect(Stats._cache.has(key)).toBe(true);
      expect(Stats._cache.get(key).success).toBe(1);
      expect(Stats._cache.get(key).failure).toBe(0);
    });

    test('increments success count', () => {
      Stats.recordSuccess('example.com', '.btn');
      Stats.recordSuccess('example.com', '.btn');
      Stats.recordSuccess('example.com', '.btn');
      expect(Stats._cache.get('example.com::.btn').success).toBe(3);
    });

    test('updates score after success', () => {
      Stats.recordSuccess('example.com', '.btn');
      // score = basePriority(0) + success(1)*5 - failure(0)*8 = 5
      expect(Stats._cache.get('example.com::.btn').score).toBe(5);
    });

    test('marks cache as dirty', () => {
      Stats.recordSuccess('example.com', '.btn');
      expect(Stats._dirty).toBe(true);
    });

    test('respects basePriority', () => {
      Stats.recordSuccess('example.com', '.btn', 10);
      // score = 10 + 1*5 - 0*8 = 15
      expect(Stats._cache.get('example.com::.btn').score).toBe(15);
    });
  });

  describe('recordFailure()', () => {
    test('creates new entry on first failure', () => {
      Stats.recordFailure('example.com', '.btn');
      expect(Stats._cache.get('example.com::.btn').failure).toBe(1);
    });

    test('decreases score on failure', () => {
      Stats.recordFailure('example.com', '.btn');
      // score = 0 + 0*5 - 1*8 = -8
      expect(Stats._cache.get('example.com::.btn').score).toBe(-8);
    });

    test('combined success and failure scoring', () => {
      Stats.recordSuccess('example.com', '.btn');
      Stats.recordSuccess('example.com', '.btn');
      Stats.recordFailure('example.com', '.btn');
      // score = 0 + 2*5 - 1*8 = 2
      expect(Stats._cache.get('example.com::.btn').score).toBe(2);
    });
  });

  describe('getRanked()', () => {
    test('returns selectors sorted by score descending', () => {
      Stats.recordSuccess('example.com', '.good');
      Stats.recordSuccess('example.com', '.good');
      Stats.recordSuccess('example.com', '.ok');
      Stats.recordFailure('example.com', '.bad');

      const ranked = Stats.getRanked('example.com');
      expect(ranked.length).toBe(3);
      expect(ranked[0].selector).toBe('.good');
      expect(ranked[1].selector).toBe('.ok');
      expect(ranked[2].selector).toBe('.bad');
    });

    test('returns empty array for unknown domain', () => {
      expect(Stats.getRanked('unknown.com')).toEqual([]);
    });

    test('does not mix domains', () => {
      Stats.recordSuccess('a.com', '.btn');
      Stats.recordSuccess('b.com', '.link');
      expect(Stats.getRanked('a.com').length).toBe(1);
      expect(Stats.getRanked('b.com').length).toBe(1);
    });
  });

  describe('getBest()', () => {
    test('returns highest scored candidate', () => {
      Stats.recordSuccess('example.com', '.good');
      Stats.recordSuccess('example.com', '.good');
      Stats.recordFailure('example.com', '.bad');

      const best = Stats.getBest('example.com', ['.good', '.bad', '.unknown']);
      expect(best).toBe('.good');
    });

    test('returns single candidate directly', () => {
      expect(Stats.getBest('example.com', ['.only'])).toBe('.only');
    });

    test('returns null for empty candidates', () => {
      expect(Stats.getBest('example.com', [])).toBeNull();
      expect(Stats.getBest('example.com', null)).toBeNull();
    });

    test('returns first candidate when no stats exist', () => {
      const best = Stats.getBest('new.com', ['.a', '.b']);
      // All have score 0, so first to reach > -Infinity wins
      expect(['.a', '.b']).toContain(best);
    });
  });

  describe('getSummary()', () => {
    test('returns summary across domains', () => {
      Stats.recordSuccess('a.com', '.x');
      Stats.recordSuccess('a.com', '.y');
      Stats.recordFailure('b.com', '.z');

      const summary = Stats.getSummary();
      expect(summary.totalSelectors).toBe(3);
      expect(summary.domains['a.com'].selectors).toBe(2);
      expect(summary.domains['a.com'].totalSuccess).toBe(2);
      expect(summary.domains['b.com'].totalFailure).toBe(1);
    });
  });

  describe('_cleanupStale()', () => {
    test('removes entries older than TTL', () => {
      Stats.recordSuccess('old.com', '.stale');
      // Manually set lastUsed to past TTL
      const entry = Stats._cache.get('old.com::.stale');
      entry.lastUsed = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago

      Stats._cleanupStale();
      expect(Stats._cache.has('old.com::.stale')).toBe(false);
    });

    test('caps entries per domain at maxPerDomain', () => {
      for (let i = 0; i < 210; i++) {
        Stats.recordSuccess('big.com', `.sel-${i}`);
      }
      Stats._cleanupStale();
      const ranked = Stats.getRanked('big.com');
      expect(ranked.length).toBeLessThanOrEqual(Stats._maxPerDomain);
    });
  });

  describe('_calcScore()', () => {
    test('follows formula: basePriority + success*5 - failure*8', () => {
      const entry = { basePriority: 3, success: 10, failure: 2 };
      expect(Stats._calcScore(entry)).toBe(3 + 50 - 16); // 37
    });

    test('handles zero values', () => {
      expect(Stats._calcScore({ basePriority: 0, success: 0, failure: 0 })).toBe(0);
    });
  });
});
