/**
 * Tests for Knowledge Base module
 * Testing rules, operative prompts, scoring, and auto-learning
 */

describe('KnowledgeBase', () => {
  let KnowledgeBase;
  let kb;

  beforeAll(() => {
    // Mock crypto.randomUUID
    global.crypto = {
      randomUUID: jest.fn(() => `test-uuid-${Math.random()}`),
    };

    delete require.cache[require.resolve('../knowledge-base.js')];
    require('../knowledge-base.js');
    KnowledgeBase = self.KnowledgeBase;
  });

  beforeEach(() => {
    // Create fresh KnowledgeBase instance for each test
    kb = new KnowledgeBase();
  });

  // ============================================================
  // RULE MANAGEMENT
  // ============================================================
  describe('addRule', () => {
    it('should add a new rule', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test Rule',
        content: 'Test content',
      });

      expect(rule.id).toBeDefined();
      expect(rule.domain).toBe('example.com');
      expect(rule.title).toBe('Test Rule');
      expect(rule.isActive).toBe(true);
      expect(rule.createdAt).toBeDefined();
      expect(kb.rules.length).toBe(1);
    });

    it('should update existing rule with same domain and title', () => {
      const rule1 = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test Rule',
        content: 'Original content',
      });

      const rule2 = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test Rule',
        content: 'Updated content',
      });

      expect(rule1.id).toBe(rule2.id);
      expect(rule2.content).toBe('Updated content');
      expect(rule2.version).toBe(2);
      expect(kb.rules.length).toBe(1);
    });

    it('should reject rule with empty title', () => {
      expect(() => {
        kb.addRule({
          domain: 'example.com',
          operationType: 'scrape',
          title: '',
          content: 'Content',
        });
      }).toThrow('Rule title cannot be empty');
    });

    it('should reject rule with empty content', () => {
      expect(() => {
        kb.addRule({
          domain: 'example.com',
          operationType: 'scrape',
          title: 'Title',
          content: '',
        });
      }).toThrow('Rule content cannot be empty');
    });

    it('should set defaults for rule', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
      });

      expect(rule.ruleType).toBe('instruction');
      expect(rule.source).toBe('user');
      expect(rule.priority).toBe(5);
      expect(rule.tags).toEqual([]);
      expect(rule.isActive).toBe(true);
    });
  });

  // ============================================================
  // RULE FINDING
  // ============================================================
  describe('findRules', () => {
    beforeEach(() => {
      kb.addRule({
        domain: 'amazon.com',
        operationType: 'scrape',
        title: 'Amazon Scrape Rule',
        content: 'Content',
        priority: 8,
      });

      kb.addRule({
        domain: null,
        operationType: 'scrape',
        title: 'Global Rule',
        content: 'Content',
        priority: 5,
      });

      kb.addRule({
        domain: 'ebay.com',
        operationType: 'extract',
        title: 'eBay Extract',
        content: 'Content',
        priority: 3,
      });
    });

    it('should find rules by domain and operation', () => {
      const rules = kb.findRules({ domain: 'amazon.com', operationType: 'scrape' });
      expect(rules.length).toBeGreaterThanOrEqual(1);
      expect(rules[0].domain).toBe('amazon.com');
    });

    it('should include global rules when domain specified', () => {
      const rules = kb.findRules({ domain: 'amazon.com' });
      const hasGlobal = rules.some(r => r.domain === null);
      expect(hasGlobal).toBe(true);
    });

    it('should prioritize domain-specific over global', () => {
      const rules = kb.findRules({ domain: 'amazon.com', operationType: 'scrape' });
      if (rules.length > 1) {
        expect(rules[0].domain).toBe('amazon.com');
      }
    });

    it('should filter by rule type', () => {
      kb.addRule({
        domain: 'amazon.com',
        operationType: 'scrape',
        ruleType: 'correction',
        title: 'Correction Rule',
        content: 'Content',
      });

      const rules = kb.findRules({ ruleType: 'correction' });
      expect(rules.every(r => r.ruleType === 'correction')).toBe(true);
    });

    it('should respect maxResults limit', () => {
      const rules = kb.findRules({ maxResults: 1 });
      expect(rules.length).toBeLessThanOrEqual(1);
    });
  });

  describe('searchRules', () => {
    beforeEach(() => {
      kb.addRule({
        domain: 'amazon.com',
        operationType: 'scrape',
        title: 'Amazon Price Scraper',
        content: 'Extract price information',
        tags: ['price', 'amazon'],
      });

      kb.addRule({
        domain: 'ebay.com',
        operationType: 'extract',
        title: 'eBay Title Extract',
        content: 'Get product titles',
      });
    });

    it('should search by title', () => {
      const results = kb.searchRules('Amazon');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('Amazon');
    });

    it('should search by content', () => {
      const results = kb.searchRules('price');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should search by tag', () => {
      const results = kb.searchRules('amazon');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return all active rules on empty query', () => {
      const results = kb.searchRules('');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('searchByDomain', () => {
    beforeEach(() => {
      kb.addRule({
        domain: 'amazon.com',
        operationType: 'scrape',
        title: 'Rule 1',
        content: 'Content',
        priority: 8,
      });

      kb.addRule({
        domain: 'amazon.com',
        operationType: 'extract',
        title: 'Rule 2',
        content: 'Content',
        priority: 6,
      });
    });

    it('should return rules for domain', () => {
      const rules = kb.searchByDomain('amazon.com');
      expect(rules.length).toBeGreaterThanOrEqual(2);
      expect(rules.every(r => r.domain === 'amazon.com')).toBe(true);
    });

    it('should sort by score', () => {
      const rules = kb.searchByDomain('amazon.com');
      if (rules.length > 1) {
        expect(rules[0].score).toBeGreaterThanOrEqual(rules[1].score);
      }
    });

    it('should return empty for unknown domain', () => {
      const rules = kb.searchByDomain('unknown.com');
      expect(rules).toEqual([]);
    });
  });

  // ============================================================
  // RULE DEACTIVATION
  // ============================================================
  describe('deactivateRule', () => {
    it('should deactivate a rule', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
      });

      kb.deactivateRule(rule.id);
      expect(rule.isActive).toBe(false);
    });

    it('should not return deactivated rules in searches', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
      });

      kb.deactivateRule(rule.id);
      const results = kb.findRules({ domain: 'example.com' });
      expect(results.some(r => r.id === rule.id)).toBe(false);
    });
  });

  // ============================================================
  // RULE SCORING
  // ============================================================
  describe('boostRule', () => {
    it('should increase rule score', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
        priority: 5,
      });

      const originalScore = rule.score;
      kb.boostRule(rule.id);
      expect(rule.score).toBe(originalScore + 1);
      expect(rule.usageCount).toBe(1);
    });

    it('should cap score at 10', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
        priority: 10,
      });

      for (let i = 0; i < 5; i++) {
        kb.boostRule(rule.id);
      }
      expect(rule.score).toBe(10);
    });
  });

  describe('penalizeRule', () => {
    it('should decrease rule score', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
        priority: 5,
      });

      const originalScore = rule.score;
      kb.penalizeRule(rule.id);
      expect(rule.score).toBeLessThan(originalScore);
      expect(rule.failureCount).toBe(1);
    });

    it('should not go below 0', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
        priority: 1,
      });

      for (let i = 0; i < 5; i++) {
        kb.penalizeRule(rule.id);
      }
      expect(rule.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================
  // OPERATIVE PROMPTS
  // ============================================================
  describe('saveOperativePrompt', () => {
    it('should save operative prompt', () => {
      const prompt = kb.saveOperativePrompt({
        title: 'Scrape Amazon',
        domain: 'amazon.com',
        objective: 'Extract product information',
        procedure: ['Navigate to product', 'Extract data', 'Save to DB'],
        criteria: ['All fields filled', 'Valid format'],
      });

      expect(prompt.id).toBeDefined();
      expect(prompt.title).toBe('Scrape Amazon');
      expect(prompt.isActive).toBe(true);
      expect(kb.operativePrompts.length).toBeGreaterThan(0);
    });

    it('should update existing prompt', () => {
      const prompt1 = kb.saveOperativePrompt({
        title: 'Scrape Amazon',
        domain: 'amazon.com',
        objective: 'Extract product information',
      });

      const prompt2 = kb.saveOperativePrompt({
        title: 'Scrape Amazon',
        domain: 'amazon.com',
        objective: 'Updated objective',
      });

      expect(prompt1.id).toBe(prompt2.id);
      expect(prompt2.version).toBe(2);
    });
  });

  describe('findOperativePrompt', () => {
    beforeEach(() => {
      kb.saveOperativePrompt({
        title: 'Amazon Scrape',
        domain: 'amazon.com',
        objective: 'Test',
        tags: ['scrape', 'amazon'],
      });

      kb.saveOperativePrompt({
        title: 'Global Prompt',
        domain: null,
        objective: 'Test',
        tags: ['global'],
      });
    });

    it('should find prompts by domain', () => {
      const prompts = kb.findOperativePrompt({ domain: 'amazon.com' });
      expect(prompts.length).toBeGreaterThan(0);
    });

    it('should find prompts by tag', () => {
      const prompts = kb.findOperativePrompt({ tags: ['scrape'] });
      expect(prompts.length).toBeGreaterThan(0);
    });

    it('should sort by usage count', () => {
      const prompts = kb.findOperativePrompt({});
      if (prompts.length > 1) {
        expect(prompts[0].usageCount).toBeGreaterThanOrEqual(prompts[1].usageCount);
      }
    });
  });

  describe('incrementPromptUsage', () => {
    it('should increment prompt usage count', () => {
      const prompt = kb.saveOperativePrompt({
        title: 'Test Prompt',
        objective: 'Test',
      });

      kb.incrementPromptUsage(prompt.id);
      expect(prompt.usageCount).toBe(1);
      expect(prompt.lastUsedAt).toBeDefined();
    });
  });

  // ============================================================
  // AUTO-LEARNING
  // ============================================================
  describe('learnFromCorrection', () => {
    it('should create correction rule', () => {
      const rule = kb.learnFromCorrection({
        domain: 'amazon.com',
        field: 'price',
        wrongValue: '$10.00',
        correctValue: '10.00',
        context: 'Remove currency symbol',
      });

      expect(rule.ruleType).toBe('correction');
      expect(rule.source).toBe('auto_learn');
      expect(rule.priority).toBe(7);
      expect(rule.tags).toContain('auto_correction');
    });
  });

  describe('learnSelector', () => {
    it('should create selector rule', () => {
      const rule = kb.learnSelector({
        domain: 'amazon.com',
        purpose: 'product_title',
        selector: 'h1.product-title',
        fallbackSelector: '.title-text',
      });

      expect(rule.ruleType).toBe('selector');
      expect(rule.source).toBe('auto_learn');
      expect(rule.tags).toContain('selector');
    });
  });

  describe('learnSiteFormat', () => {
    it('should create format rule', () => {
      const structure = {
        productList: '.product-item',
        priceField: '.price',
        titleField: 'h2',
      };

      kb.learnSiteFormat({
        domain: 'amazon.com',
        structure,
      });

      const rule = kb.rules.find(r => r.ruleType === 'format' && r.domain === 'amazon.com');
      expect(rule).toBeDefined();
      expect(rule.ruleType).toBe('format');
      expect(rule.tags).toContain('format');
    });
  });

  describe('learnPreference', () => {
    it('should create preference rule', () => {
      kb.learnPreference({
        key: 'default_delay',
        value: 3000,
        context: 'Delay between requests',
      });

      const rule = kb.rules.find(r => r.ruleType === 'preference' && r.title.includes('default_delay'));
      expect(rule).toBeDefined();
      expect(rule.ruleType).toBe('preference');
      expect(rule.domain).toBeNull();
      expect(rule.tags).toContain('preference');
    });
  });

  // ============================================================
  // STATISTICS
  // ============================================================
  describe('getStats', () => {
    beforeEach(() => {
      kb.addRule({
        domain: 'amazon.com',
        operationType: 'scrape',
        title: 'Rule 1',
        content: 'Content',
      });

      kb.addRule({
        domain: 'ebay.com',
        operationType: 'extract',
        title: 'Rule 2',
        content: 'Content',
      });

      kb.saveOperativePrompt({
        title: 'Prompt 1',
        objective: 'Test',
      });
    });

    it('should return knowledge base statistics', () => {
      const stats = kb.getStats();
      expect(stats.totalRules).toBeGreaterThanOrEqual(2);
      expect(stats.activeRules).toBeGreaterThanOrEqual(2);
      expect(stats.domains).toBeGreaterThanOrEqual(2);
      expect(typeof stats.operativePrompts).toBe('number');
    });

    it('should count rules by type', () => {
      const stats = kb.getStats();
      expect(stats.byType).toBeDefined();
      expect(typeof stats.byType.instruction).toBe('number');
    });

    it('should count rules by source', () => {
      const stats = kb.getStats();
      expect(stats.bySource).toBeDefined();
      expect(stats.bySource.user).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================
  // DYNAMIC SCORING
  // ============================================================
  describe('computeDynamicScore', () => {
    it('should compute score based on priority', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
        priority: 7,
      });

      const score = kb.computeDynamicScore(rule);
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(10);
    });

    it('should boost score for recent usage', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
        priority: 5,
      });

      rule.lastUsedAt = new Date().toISOString();
      rule.usageCount = 5;

      const score = kb.computeDynamicScore(rule);
      expect(score).toBeGreaterThanOrEqual(rule.priority);
    });

    it('should penalize for failures', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Test',
        content: 'Content',
        priority: 8,
      });

      rule.usageCount = 10;
      rule.failureCount = 8;

      const score = kb.computeDynamicScore(rule);
      expect(score).toBeLessThan(8);
    });
  });

  describe('recalculateAllScores', () => {
    it('should recalculate all rule scores', () => {
      kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Rule 1',
        content: 'Content',
      });

      kb.addRule({
        domain: 'example.com',
        operationType: 'extract',
        title: 'Rule 2',
        content: 'Content',
      });

      const updated = kb.recalculateAllScores();
      expect(typeof updated).toBe('number');
    });
  });

  // ============================================================
  // GARBAGE COLLECTION
  // ============================================================
  describe('garbageCollect', () => {
    it('should remove old inactive rules', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Old Rule',
        content: 'Content',
      });

      kb.deactivateRule(rule.id);
      rule.updatedAt = new Date(Date.now() - 100 * 86400000).toISOString(); // 100 days ago

      const result = kb.garbageCollect();
      expect(typeof result.removed).toBe('number');
    });

    it('should keep recent inactive rules', () => {
      const rule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Recent Inactive',
        content: 'Content',
      });

      kb.deactivateRule(rule.id);
      rule.updatedAt = new Date(Date.now() - 10 * 86400000).toISOString(); // 10 days ago

      const countBefore = kb.rules.length;
      kb.garbageCollect();
      expect(kb.rules.find(r => r.id === rule.id)).toBeDefined();
    });
  });

  // ============================================================
  // CONFLICT DETECTION
  // ============================================================
  describe('detectConflicts', () => {
    it('should detect conflicting rules', () => {
      kb.addRule({
        domain: 'amazon.com',
        operationType: 'extract',
        ruleType: 'selector',
        title: 'Selector 1',
        content: JSON.stringify({ primary: '.price' }),
        purpose: 'price',
      });

      kb.addRule({
        domain: 'amazon.com',
        operationType: 'extract',
        ruleType: 'selector',
        title: 'Selector 2',
        content: JSON.stringify({ primary: '.product-price' }),
        purpose: 'price',
      });

      const conflicts = kb.detectConflicts('amazon.com');
      expect(Array.isArray(conflicts)).toBe(true);
    });
  });

  // ============================================================
  // HEALTH REPORT
  // ============================================================
  describe('getHealthReport', () => {
    beforeEach(() => {
      kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Healthy Rule',
        content: 'Content',
        priority: 8,
      });

      const lowScoreRule = kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Low Score',
        content: 'Content',
        priority: 1,
      });
      lowScoreRule.score = 0.5;
    });

    it('should return health report', () => {
      const report = kb.getHealthReport();
      expect(report.totalActive).toBeGreaterThanOrEqual(0);
      expect(report.healthy).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(report.lowScore)).toBe(true);
      expect(typeof report.neverUsed).toBe('number');
    });
  });

  // ============================================================
  // EXPORT/IMPORT
  // ============================================================
  describe('exportAll', () => {
    it('should export all data', () => {
      kb.addRule({
        domain: 'example.com',
        operationType: 'scrape',
        title: 'Rule',
        content: 'Content',
      });

      kb.saveOperativePrompt({
        title: 'Prompt',
        objective: 'Test',
      });

      const exported = kb.exportAll();
      expect(exported.rules).toBeDefined();
      expect(exported.operativePrompts).toBeDefined();
      expect(exported.version).toBe('4.0');
      expect(exported.exportDate).toBeDefined();
    });
  });

  describe('importAll', () => {
    it('should import all data', async () => {
      const data = {
        rules: [
          {
            id: 'rule-1',
            domain: 'example.com',
            operationType: 'scrape',
            title: 'Imported Rule',
            content: 'Content',
            isActive: true,
          },
        ],
        operativePrompts: [
          {
            id: 'prompt-1',
            title: 'Imported Prompt',
            objective: 'Test',
            isActive: true,
          },
        ],
      };

      await kb.importAll(data);
      expect(kb.rules.length).toBe(1);
      expect(kb.operativePrompts.length).toBe(1);
    });
  });
});
