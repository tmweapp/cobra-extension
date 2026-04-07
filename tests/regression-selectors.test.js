/**
 * Regression Tests — Selector Stats & Ranking
 * Tests selector reliability tracking, degradation, and recovery
 */
require('./setup');
require('../cobra-selector-stats');

const Stats = global.CobraSelectorStats;

beforeEach(() => {
  Stats._cache.clear();
  Stats._dirty = false;
  if (Stats._flushInterval) {
    clearInterval(Stats._flushInterval);
    Stats._flushInterval = null;
  }
});

describe('Selector Regression — Reliability Degradation', () => {
  test('selector degrades after repeated failures', () => {
    Stats.recordSuccess('booking.com', '.price-box');
    Stats.recordSuccess('booking.com', '.price-box');
    // score = 10

    Stats.recordFailure('booking.com', '.price-box');
    Stats.recordFailure('booking.com', '.price-box');
    Stats.recordFailure('booking.com', '.price-box');
    // score = 10 - 24 = -14

    const ranked = Stats.getRanked('booking.com');
    expect(ranked[0].score).toBe(-14);
  });

  test('degraded selector is ranked below alternatives', () => {
    // Old selector: many failures
    Stats.recordSuccess('booking.com', '.old-price');
    Stats.recordFailure('booking.com', '.old-price');
    Stats.recordFailure('booking.com', '.old-price');
    Stats.recordFailure('booking.com', '.old-price');
    // score = 5 - 24 = -19

    // New selector: fresh success
    Stats.recordSuccess('booking.com', '.new-price');
    // score = 5

    const best = Stats.getBest('booking.com', ['.old-price', '.new-price']);
    expect(best).toBe('.new-price');
  });

  test('selector recovers after consistent successes', () => {
    // Start with failures
    Stats.recordFailure('example.com', '.item');
    Stats.recordFailure('example.com', '.item');
    // score = -16

    // Recover with successes
    Stats.recordSuccess('example.com', '.item');
    Stats.recordSuccess('example.com', '.item');
    Stats.recordSuccess('example.com', '.item');
    Stats.recordSuccess('example.com', '.item');
    // score = 4*5 - 2*8 = 20 - 16 = 4

    const ranked = Stats.getRanked('example.com');
    expect(ranked[0].score).toBe(4);
    expect(ranked[0].score).toBeGreaterThan(0);
  });
});

describe('Selector Regression — Domain Isolation', () => {
  test('selectors from different domains do not interfere', () => {
    Stats.recordSuccess('site-a.com', '.btn');
    Stats.recordFailure('site-b.com', '.btn');

    const rankA = Stats.getRanked('site-a.com');
    const rankB = Stats.getRanked('site-b.com');

    expect(rankA[0].score).toBe(5);  // success
    expect(rankB[0].score).toBe(-8); // failure
  });

  test('getBest only considers stats for target domain', () => {
    Stats.recordSuccess('good.com', '.price');
    Stats.recordSuccess('good.com', '.price');
    Stats.recordFailure('bad.com', '.price');

    // Querying for bad.com should not use good.com's stats
    const best = Stats.getBest('bad.com', ['.price', '.alt']);
    // .price has -8 on bad.com, .alt has 0
    expect(best).toBe('.alt');
  });
});

describe('Selector Regression — Base Priority', () => {
  test('basePriority gives initial advantage', () => {
    Stats.recordSuccess('example.com', '.manual', 20);
    Stats.recordSuccess('example.com', '.auto', 0);

    const ranked = Stats.getRanked('example.com');
    // manual: 20 + 5 = 25, auto: 0 + 5 = 5
    expect(ranked[0].selector).toBe('.manual');
    expect(ranked[0].score).toBe(25);
  });

  test('failures can overcome basePriority', () => {
    Stats.recordSuccess('example.com', '.boosted', 10);
    Stats.recordFailure('example.com', '.boosted');
    Stats.recordFailure('example.com', '.boosted');
    Stats.recordFailure('example.com', '.boosted');
    // score = 10 + 5 - 24 = -9

    Stats.recordSuccess('example.com', '.unboosted');
    // score = 5

    const best = Stats.getBest('example.com', ['.boosted', '.unboosted']);
    expect(best).toBe('.unboosted');
  });
});

describe('Selector Regression — Stale Cleanup', () => {
  test('selectors older than TTL are removed', () => {
    Stats.recordSuccess('old.com', '.stale-1');
    Stats.recordSuccess('old.com', '.stale-2');
    Stats.recordSuccess('recent.com', '.fresh');

    // Age the old.com selectors
    for (const [key, entry] of Stats._cache) {
      if (entry.domain === 'old.com') {
        entry.lastUsed = Date.now() - (31 * 24 * 60 * 60 * 1000);
      }
    }

    Stats._cleanupStale();

    expect(Stats.getRanked('old.com').length).toBe(0);
    expect(Stats.getRanked('recent.com').length).toBe(1);
  });

  test('per-domain cap removes lowest scored selectors', () => {
    // Fill beyond max
    for (let i = 0; i < 210; i++) {
      Stats.recordSuccess('big.com', `.sel-${i}`);
    }

    // Give some selectors extra score
    Stats.recordSuccess('big.com', '.sel-0');
    Stats.recordSuccess('big.com', '.sel-0');
    Stats.recordSuccess('big.com', '.sel-1');

    Stats._cleanupStale();

    const ranked = Stats.getRanked('big.com');
    expect(ranked.length).toBeLessThanOrEqual(200);

    // Top selectors should be preserved
    const topSelectors = ranked.slice(0, 3).map(r => r.selector);
    expect(topSelectors).toContain('.sel-0'); // highest score
  });
});

describe('Selector Regression — Score Formula Consistency', () => {
  test('score is always basePriority + success*5 - failure*8', () => {
    const scenarios = [
      { base: 0, success: 0, failure: 0, expected: 0 },
      { base: 0, success: 1, failure: 0, expected: 5 },
      { base: 0, success: 0, failure: 1, expected: -8 },
      { base: 10, success: 3, failure: 1, expected: 10 + 15 - 8 },
      { base: 0, success: 10, failure: 10, expected: 50 - 80 },
      { base: 100, success: 0, failure: 0, expected: 100 },
    ];

    for (const s of scenarios) {
      const score = Stats._calcScore({
        basePriority: s.base,
        success: s.success,
        failure: s.failure,
      });
      expect(score).toBe(s.expected);
    }
  });
});

describe('Selector Regression — Summary Accuracy', () => {
  test('summary reflects actual state', () => {
    Stats.recordSuccess('a.com', '.x');
    Stats.recordSuccess('a.com', '.y');
    Stats.recordFailure('a.com', '.y');
    Stats.recordSuccess('b.com', '.z');

    const summary = Stats.getSummary();
    expect(summary.totalSelectors).toBe(3);
    expect(summary.domains['a.com'].selectors).toBe(2);
    expect(summary.domains['a.com'].totalSuccess).toBe(2);
    expect(summary.domains['a.com'].totalFailure).toBe(1);
    expect(summary.domains['b.com'].selectors).toBe(1);
    expect(summary.domains['b.com'].totalSuccess).toBe(1);
    expect(summary.domains['b.com'].totalFailure).toBe(0);
  });
});
