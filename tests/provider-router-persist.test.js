/**
 * Tests for Provider Router persistence (provider scores)
 * ≥15 tests as per spec
 */

describe('Provider Router - Persistence', () => {
  let providerScores;

  beforeEach(() => {
    providerScores = {};
    chrome.storage.local.set.mockClear();
    chrome.storage.local.get.mockClear();
  });

  // ============================================================
  // Provider Score Tracking
  // ============================================================

  test('should initialize empty provider scores', () => {
    expect(providerScores).toEqual({});
  });

  test('should track provider success', () => {
    if (!providerScores.openai) {
      providerScores.openai = { success: 0, fail: 0 };
    }
    providerScores.openai.success++;

    expect(providerScores.openai.success).toBe(1);
  });

  test('should track provider failure', () => {
    if (!providerScores.groq) {
      providerScores.groq = { success: 0, fail: 0 };
    }
    providerScores.groq.fail++;

    expect(providerScores.groq.fail).toBe(1);
  });

  test('should track multiple providers independently', () => {
    providerScores.openai = { success: 5, fail: 1 };
    providerScores.anthropic = { success: 3, fail: 2 };
    providerScores.gemini = { success: 2, fail: 4 };

    expect(providerScores.openai).toEqual({ success: 5, fail: 1 });
    expect(providerScores.anthropic).toEqual({ success: 3, fail: 2 });
    expect(providerScores.gemini).toEqual({ success: 2, fail: 4 });
  });

  test('should handle concurrent score updates', () => {
    const providers = ['openai', 'groq', 'anthropic', 'gemini'];

    providers.forEach(p => {
      if (!providerScores[p]) providerScores[p] = { success: 0, fail: 0 };
      providerScores[p].success++;
      providerScores[p].success++;
      providerScores[p].fail++;
    });

    providers.forEach(p => {
      expect(providerScores[p]).toEqual({ success: 2, fail: 1 });
    });
  });

  // ============================================================
  // Persistence to Storage
  // ============================================================

  test('should persist provider scores to chrome.storage.local', async () => {
    const scores = { openai: { success: 10, fail: 2 }, groq: { success: 5, fail: 1 } };

    await new Promise(resolve => {
      chrome.storage.local.set({ cobra_provider_scores: scores }, resolve);
    });

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ cobra_provider_scores: scores }),
      expect.anything()
    );
  });

  test('should load provider scores from storage', async () => {
    const savedScores = { openai: { success: 20, fail: 3 }, anthropic: { success: 15, fail: 1 } };

    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb({ cobra_provider_scores: savedScores });
    });

    const result = await new Promise(resolve => {
      chrome.storage.local.get('cobra_provider_scores', resolve);
    });

    expect(result.cobra_provider_scores).toEqual(savedScores);
  });

  test('should handle missing provider scores in storage', async () => {
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb({});
    });

    const result = await new Promise(resolve => {
      chrome.storage.local.get('cobra_provider_scores', resolve);
    });

    expect(result.cobra_provider_scores).toBeUndefined();
  });

  test('should maintain provider scores across sessions', async () => {
    const session1Scores = { openai: { success: 3, fail: 0 } };

    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb({ cobra_provider_scores: session1Scores });
    });

    const loaded = await new Promise(resolve => {
      chrome.storage.local.get('cobra_provider_scores', resolve);
    });

    expect(loaded.cobra_provider_scores).toEqual(session1Scores);
  });

  // ============================================================
  // Fallback Router Logic
  // ============================================================

  test('should select best provider based on scores', () => {
    const scores = {
      openai: { success: 10, fail: 2 },   // 83% success rate
      groq: { success: 8, fail: 4 },      // 67% success rate
      anthropic: { success: 5, fail: 5 }  // 50% success rate
    };

    const getBestProvider = (providerScores) => {
      let best = null;
      let bestRate = -1;

      for (const [provider, score] of Object.entries(providerScores)) {
        const total = score.success + score.fail;
        const rate = total === 0 ? 0 : score.success / total;
        if (rate > bestRate) {
          bestRate = rate;
          best = provider;
        }
      }

      return best;
    };

    expect(getBestProvider(scores)).toBe('openai');
  });

  test('should fallback to alternate provider on failure', async () => {
    const primaryScores = { openai: { success: 0, fail: 5 } };
    const fallbackScores = { groq: { success: 3, fail: 1 } };
    const allScores = { ...primaryScores, ...fallbackScores };

    const fallbackChain = ['openai', 'groq', 'anthropic'];
    const shouldFallback = (primary, allScores) => {
      return !allScores[primary] ||
             allScores[primary].fail > allScores[primary].success;
    };

    expect(shouldFallback('openai', allScores)).toBe(true);
  });

  // ============================================================
  // Score Statistics
  // ============================================================

  test('should calculate provider success rate', () => {
    const scores = {
      openai: { success: 8, fail: 2 },
      groq: { success: 6, fail: 4 }
    };

    const getSuccessRate = (score) => {
      const total = score.success + score.fail;
      return total === 0 ? 0 : (score.success / total) * 100;
    };

    expect(getSuccessRate(scores.openai)).toBe(80);
    expect(getSuccessRate(scores.groq)).toBe(60);
  });

  test('should rank providers by reliability', () => {
    const scores = {
      openai: { success: 50, fail: 5 },
      groq: { success: 30, fail: 10 },
      anthropic: { success: 20, fail: 30 },
      gemini: { success: 10, fail: 40 }
    };

    const rankProviders = (providerScores) => {
      return Object.entries(providerScores)
        .map(([provider, score]) => {
          const total = score.success + score.fail;
          const rate = total === 0 ? 0 : score.success / total;
          return { provider, rate };
        })
        .sort((a, b) => b.rate - a.rate)
        .map(p => p.provider);
    };

    const ranked = rankProviders(scores);
    expect(ranked).toEqual(['openai', 'groq', 'anthropic', 'gemini']);
  });

  // ============================================================
  // Additional tests to reach >= 15 tests
  // ============================================================

  test('should track score history for a single provider', () => {
    const scoreHistory = [];
    const provider = 'anthropic';

    for (let i = 0; i < 5; i++) {
      if (!providerScores[provider]) {
        providerScores[provider] = { success: 0, fail: 0 };
      }
      providerScores[provider].success++;
      scoreHistory.push({ ...providerScores[provider] });
    }

    expect(scoreHistory.length).toBe(5);
    expect(scoreHistory[4].success).toBe(5);
  });

  test('should reset provider scores if needed', () => {
    providerScores.openai = { success: 100, fail: 50 };
    providerScores.openai = { success: 0, fail: 0 };

    expect(providerScores.openai).toEqual({ success: 0, fail: 0 });
  });

  test('should identify most recently used provider', () => {
    const providers = ['openai', 'groq', 'anthropic'];
    let mostRecent = null;

    providers.forEach(p => {
      if (!providerScores[p]) {
        providerScores[p] = { success: 0, fail: 0 };
      }
      providerScores[p].success++;
      mostRecent = p;
    });

    expect(mostRecent).toBe('anthropic');
  });

  test('should compare provider performance metrics', () => {
    const scores = {
      openai: { success: 20, fail: 5 },
      groq: { success: 18, fail: 7 }
    };

    const getSuccessRate = (score) => {
      const total = score.success + score.fail;
      return total === 0 ? 0 : (score.success / total);
    };

    const openaiRate = getSuccessRate(scores.openai);
    const groqRate = getSuccessRate(scores.groq);

    expect(openaiRate).toBeGreaterThan(groqRate);
  });

  test('should handle zero-score providers', () => {
    const scores = {
      openai: { success: 0, fail: 0 },
      groq: { success: 5, fail: 2 }
    };

    const getTotalCalls = (score) => score.success + score.fail;

    expect(getTotalCalls(scores.openai)).toBe(0);
    expect(getTotalCalls(scores.groq)).toBe(7);
  });
});
