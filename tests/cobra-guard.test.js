/**
 * COBRA Guard Module Tests
 * Tests for check(), checkRateLimit(), checkCircuit(), registerFailure(),
 * registerSuccess(), getStats(), reset(), and _WRITE_ACTIONS detection.
 */

// Setup global mocks
global.self = global;

// Load the module
require('../cobra-guard.js');
const CobraGuard = global.CobraGuard;

describe('CobraGuard', () => {
  beforeEach(() => {
    // Reset state before each test
    CobraGuard.reset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════
  // UTILITY TESTS
  // ═══════════════════════════════════════════════════════
  describe('_key()', () => {
    it('should extract hostname from URL and create key', () => {
      const key = CobraGuard._key('https://example.com/path', 'action1');
      expect(key).toBe('example.com::action1');
    });

    it('should handle URLs without protocol', () => {
      const key = CobraGuard._key('example.com/path', 'action1');
      expect(key).toContain('::action1');
    });

    it('should lowercase hostname', () => {
      const key = CobraGuard._key('https://EXAMPLE.COM/path', 'action1');
      expect(key).toBe('example.com::action1');
    });

    it('should use "unknown" for invalid URLs', () => {
      const key = CobraGuard._key('not-a-url', 'action1');
      expect(key).toBe('unknown::action1');
    });

    it('should handle URLs with subdomains', () => {
      const key = CobraGuard._key('https://api.example.com/v1', 'action');
      expect(key).toBe('api.example.com::action');
    });
  });

  // ═══════════════════════════════════════════════════════
  // WRITE ACTIONS TESTS
  // ═══════════════════════════════════════════════════════
  describe('_WRITE_ACTIONS', () => {
    it('should have 16 write actions in the set', () => {
      expect(CobraGuard._WRITE_ACTIONS.size).toBe(16);
    });

    it('should include click_element', () => {
      expect(CobraGuard._WRITE_ACTIONS.has('click_element')).toBe(true);
    });

    it('should include fill_form', () => {
      expect(CobraGuard._WRITE_ACTIONS.has('fill_form')).toBe(true);
    });

    it('should include execute_js', () => {
      expect(CobraGuard._WRITE_ACTIONS.has('execute_js')).toBe(true);
    });

    it('should include all email/messaging actions', () => {
      expect(CobraGuard._WRITE_ACTIONS.has('send_email')).toBe(true);
      expect(CobraGuard._WRITE_ACTIONS.has('send_whatsapp')).toBe(true);
      expect(CobraGuard._WRITE_ACTIONS.has('send_linkedin')).toBe(true);
    });

    it('should include knowledge base actions', () => {
      expect(CobraGuard._WRITE_ACTIONS.has('save_to_kb')).toBe(true);
      expect(CobraGuard._WRITE_ACTIONS.has('kb_update')).toBe(true);
      expect(CobraGuard._WRITE_ACTIONS.has('kb_delete')).toBe(true);
    });

    it('should include file/task actions', () => {
      expect(CobraGuard._WRITE_ACTIONS.has('create_file')).toBe(true);
      expect(CobraGuard._WRITE_ACTIONS.has('save_local_file')).toBe(true);
      expect(CobraGuard._WRITE_ACTIONS.has('create_task')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════
  // RATE LIMIT TESTS (10/10s for write, 40/10s for read)
  // ═══════════════════════════════════════════════════════
  describe('checkRateLimit()', () => {
    it('should allow request under write limit', () => {
      const result = CobraGuard.checkRateLimit('https://example.com', 'click_element');
      expect(result.ok).toBe(true);
    });

    it('should allow request under read limit', () => {
      const result = CobraGuard.checkRateLimit('https://example.com', 'get_data');
      expect(result.ok).toBe(true);
    });

    it('should reject write action after 10 requests in 10s', () => {
      // 10 successful requests
      for (let i = 0; i < 10; i++) {
        CobraGuard.checkRateLimit('https://example.com', 'click_element');
      }
      // 11th request should fail
      const result = CobraGuard.checkRateLimit('https://example.com', 'click_element');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('RATE_LIMITED');
    });

    it('should reject read action after 40 requests in 10s', () => {
      // 40 successful requests for read action
      for (let i = 0; i < 40; i++) {
        CobraGuard.checkRateLimit('https://example.com', 'get_data');
      }
      // 41st request should fail
      const result = CobraGuard.checkRateLimit('https://example.com', 'get_data');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('RATE_LIMITED');
    });

    it('should separate buckets by hostname::action', () => {
      // Exhaust limit for action1
      for (let i = 0; i < 10; i++) {
        CobraGuard.checkRateLimit('https://example.com', 'click_element');
      }

      // action2 on same domain should still work
      const result = CobraGuard.checkRateLimit('https://example.com', 'fill_form');
      expect(result.ok).toBe(true);
    });

    it('should separate buckets by domain', () => {
      // Exhaust limit for domain1
      for (let i = 0; i < 10; i++) {
        CobraGuard.checkRateLimit('https://example1.com', 'click_element');
      }

      // Same action on different domain should still work
      const result = CobraGuard.checkRateLimit('https://example2.com', 'click_element');
      expect(result.ok).toBe(true);
    });

    it('should reset bucket after 10s window expires', () => {
      // Fill up bucket
      for (let i = 0; i < 10; i++) {
        CobraGuard.checkRateLimit('https://example.com', 'click_element');
      }

      // Should be rate limited
      let result = CobraGuard.checkRateLimit('https://example.com', 'click_element');
      expect(result.ok).toBe(false);

      // Advance time by 10s
      jest.advanceTimersByTime(10001);

      // Should be allowed again
      result = CobraGuard.checkRateLimit('https://example.com', 'click_element');
      expect(result.ok).toBe(true);
    });

    it('should include detailed reason in rate limit error', () => {
      for (let i = 0; i < 10; i++) {
        CobraGuard.checkRateLimit('https://example.com', 'click_element');
      }

      const result = CobraGuard.checkRateLimit('https://example.com', 'click_element');
      expect(result.reason).toContain('Rate limit');
      expect(result.reason).toContain('click_element');
      expect(result.reason).toContain('example.com');
    });
  });

  // ═══════════════════════════════════════════════════════
  // CIRCUIT BREAKER TESTS (5 fail → 30s open)
  // ═══════════════════════════════════════════════════════
  describe('checkCircuit()', () => {
    it('should return ok for new circuit', () => {
      const result = CobraGuard.checkCircuit('https://example.com', 'action1');
      expect(result.ok).toBe(true);
    });

    it('should return ok for closed circuit', () => {
      // Register some successes
      CobraGuard.registerSuccess('https://example.com', 'action1');
      const result = CobraGuard.checkCircuit('https://example.com', 'action1');
      expect(result.ok).toBe(true);
    });

    it('should return not ok when circuit is open', () => {
      // Trigger 5 failures to open circuit
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      // Circuit should be open
      const result = CobraGuard.checkCircuit('https://example.com', 'action1');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('CIRCUIT_OPEN');
    });

    it('should include cooldown info in error message', () => {
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      const result = CobraGuard.checkCircuit('https://example.com', 'action1');
      expect(result.reason).toContain('Circuit breaker');
      expect(result.reason).toContain('cooldown');
    });
  });

  // ═══════════════════════════════════════════════════════
  // REGISTER FAILURE TESTS
  // ═══════════════════════════════════════════════════════
  describe('registerFailure()', () => {
    it('should increment failure count', () => {
      CobraGuard.registerFailure('https://example.com', 'action1');
      const stats = CobraGuard.getStats();
      expect(Object.keys(stats.openCircuits).length).toBeGreaterThan(0);
    });

    it('should open circuit after 5 failures', () => {
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      const result = CobraGuard.checkCircuit('https://example.com', 'action1');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('CIRCUIT_OPEN');
    });

    it('should set 30s cooldown on open', () => {
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      const circuit = CobraGuard._circuits['example.com::action1'];
      const now = Date.now();
      expect(circuit.openUntil).toBeGreaterThan(now);
      expect(circuit.openUntil - now).toBeCloseTo(30000, -2); // within ~100ms
    });

    it('should reset failure count when opening', () => {
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      // After opening, failures should reset
      const circuit = CobraGuard._circuits['example.com::action1'];
      expect(circuit.failures).toBe(0);
    });

    it('should separate circuits by hostname::action', () => {
      // Trigger 5 failures on action1
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      // action2 should still work
      const result = CobraGuard.checkCircuit('https://example.com', 'action2');
      expect(result.ok).toBe(true);
    });

    it('should log warning when opening circuit', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CobraGuard] Circuit OPEN')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  // ═══════════════════════════════════════════════════════
  // REGISTER SUCCESS TESTS
  // ═══════════════════════════════════════════════════════
  describe('registerSuccess()', () => {
    it('should reset failures on success', () => {
      // Register some failures
      CobraGuard.registerFailure('https://example.com', 'action1');
      CobraGuard.registerFailure('https://example.com', 'action1');

      // Register success
      CobraGuard.registerSuccess('https://example.com', 'action1');

      // Circuit should be closed
      const result = CobraGuard.checkCircuit('https://example.com', 'action1');
      expect(result.ok).toBe(true);
    });

    it('should reset openUntil on success', () => {
      // Trigger circuit open
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      // Register success to close
      CobraGuard.registerSuccess('https://example.com', 'action1');

      const circuit = CobraGuard._circuits['example.com::action1'];
      expect(circuit.failures).toBe(0);
      expect(circuit.openUntil).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // COMBINED CHECK TESTS
  // ═══════════════════════════════════════════════════════
  describe('check()', () => {
    it('should check circuit first, then rate limit', () => {
      // Circuit check should pass
      let result = CobraGuard.check('https://example.com', 'action1');
      expect(result.ok).toBe(true);
    });

    it('should reject on circuit open before checking rate limit', () => {
      // Open circuit
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      // Should reject due to circuit
      const result = CobraGuard.check('https://example.com', 'action1');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('CIRCUIT_OPEN');
    });

    it('should reject on rate limit if circuit ok', () => {
      // Fill up rate limit
      for (let i = 0; i < 10; i++) {
        CobraGuard.checkRateLimit('https://example.com', 'click_element');
      }

      // Should reject due to rate limit
      const result = CobraGuard.check('https://example.com', 'click_element');
      expect(result.ok).toBe(false);
      expect(result.code).toBe('RATE_LIMITED');
    });

    it('should allow request that passes both checks', () => {
      const result = CobraGuard.check('https://example.com', 'action1');
      expect(result.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════
  // STATS TESTS
  // ═══════════════════════════════════════════════════════
  describe('getStats()', () => {
    it('should return empty stats initially', () => {
      const stats = CobraGuard.getStats();
      expect(stats.activeBuckets).toEqual({});
      expect(stats.openCircuits).toEqual({});
    });

    it('should include active rate limit buckets', () => {
      CobraGuard.checkRateLimit('https://example.com', 'action1');
      const stats = CobraGuard.getStats();
      expect(Object.keys(stats.activeBuckets).length).toBeGreaterThan(0);
    });

    it('should not include expired buckets', () => {
      CobraGuard.checkRateLimit('https://example.com', 'action1');

      // Advance time past 10s window
      jest.advanceTimersByTime(10001);

      const stats = CobraGuard.getStats();
      expect(stats.activeBuckets['example.com::action1']).toBeUndefined();
    });

    it('should track bucket expiration time', () => {
      CobraGuard.checkRateLimit('https://example.com', 'action1');
      const stats = CobraGuard.getStats();
      const bucket = stats.activeBuckets['example.com::action1'];
      expect(bucket.expiresIn).toBeLessThanOrEqual(10000);
    });

    it('should include open circuits', () => {
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }
      const stats = CobraGuard.getStats();
      expect(stats.openCircuits['example.com::action1']).toBeDefined();
      expect(stats.openCircuits['example.com::action1'].isOpen).toBe(true);
    });

    it('should track cooldown remaining', () => {
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }
      const stats = CobraGuard.getStats();
      const circuit = stats.openCircuits['example.com::action1'];
      expect(circuit.cooldownRemaining).toBeGreaterThan(0);
      expect(circuit.cooldownRemaining).toBeLessThanOrEqual(30000);
    });
  });

  // ═══════════════════════════════════════════════════════
  // RESET TESTS
  // ═══════════════════════════════════════════════════════
  describe('reset()', () => {
    it('should clear all buckets', () => {
      CobraGuard.checkRateLimit('https://example.com', 'action1');
      CobraGuard.checkRateLimit('https://example.com', 'action2');

      CobraGuard.reset();

      expect(Object.keys(CobraGuard._buckets)).toHaveLength(0);
    });

    it('should clear all circuits', () => {
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      CobraGuard.reset();

      expect(Object.keys(CobraGuard._circuits)).toHaveLength(0);
    });

    it('should reset stats after reset', () => {
      CobraGuard.checkRateLimit('https://example.com', 'action1');
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action2');
      }

      CobraGuard.reset();

      const stats = CobraGuard.getStats();
      expect(stats.activeBuckets).toEqual({});
      expect(stats.openCircuits).toEqual({});
    });
  });

  // ═══════════════════════════════════════════════════════
  // EDGE CASE TESTS
  // ═══════════════════════════════════════════════════════
  describe('Edge Cases', () => {
    it('should handle half-open circuit state', () => {
      // Open circuit
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      // Wait until cooldown expires but circuit still exists
      jest.advanceTimersByTime(30001);

      // Circuit should be closed now (half-open behavior)
      const result = CobraGuard.checkCircuit('https://example.com', 'action1');
      expect(result.ok).toBe(true);
    });

    it('should allow write and read actions with correct limits', () => {
      // Write action has 10 limit
      for (let i = 0; i < 10; i++) {
        const result = CobraGuard.checkRateLimit('https://example.com', 'click_element');
        expect(result.ok).toBe(true);
      }
      // 11th should fail
      let result = CobraGuard.checkRateLimit('https://example.com', 'click_element');
      expect(result.ok).toBe(false);

      CobraGuard.reset();

      // Read action has 40 limit
      for (let i = 0; i < 40; i++) {
        result = CobraGuard.checkRateLimit('https://example.com', 'get_data');
        expect(result.ok).toBe(true);
      }
      // 41st should fail
      result = CobraGuard.checkRateLimit('https://example.com', 'get_data');
      expect(result.ok).toBe(false);
    });

    it('should handle rapid failure registration', () => {
      // Register 5 failures rapidly
      for (let i = 0; i < 5; i++) {
        CobraGuard.registerFailure('https://example.com', 'action1');
      }

      // Circuit should be open
      const result = CobraGuard.checkCircuit('https://example.com', 'action1');
      expect(result.ok).toBe(false);
    });
  });
});
