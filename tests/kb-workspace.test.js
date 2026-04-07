/**
 * COBRA KB Workspace Partition & Auto-Tagging Tests
 * 40+ test cases covering workspace detection, context retrieval, auto-tagging, and tier promotion
 */

// Mock setup
global.crypto = {
  randomUUID: () => Math.random().toString(36).substr(2, 9),
};

global.self = {
  cobraPersistence: null,
};

// Suppress chrome.storage mock warnings
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({}),
      set: (data, cb) => cb && cb(),
    },
  },
};

// Load KB class
const fs = require('fs');
const kbCode = fs.readFileSync('./knowledge-base.js', 'utf8');
eval(kbCode);

describe('KnowledgeBase - Workspace Partitioning & Auto-Tagging', () => {

  let kb;

  beforeEach(() => {
    kb = new KnowledgeBase();
    kb._loaded = true; // Skip async load
  });

  // ============================================================
  // WORKSPACE DETECTION TESTS (10 tests)
  // ============================================================

  describe('detectWorkspace - keyword-based detection', () => {

    test('detects fatturazione workspace', () => {
      const result = kb.detectWorkspace('La fattura è scaduta, come gestire il pagamento?');
      expect(result.workspaceId).toBe('fatturazione');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('detects fatturazione with IVA keyword', () => {
      const result = kb.detectWorkspace('Problematica IVA nella fattura');
      expect(result.workspaceId).toBe('fatturazione');
    });

    test('detects credito workspace', () => {
      const result = kb.detectWorkspace('Abbiamo un cliente insoluto, serve sollecito');
      expect(result.workspaceId).toBe('credito');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('detects credito with moroso keyword', () => {
      const result = kb.detectWorkspace('Recovery per cliente moroso');
      expect(result.workspaceId).toBe('credito');
    });

    test('detects pricing workspace', () => {
      const result = kb.detectWorkspace('Come gestire il listino prezzi e gli sconti?');
      expect(result.workspaceId).toBe('pricing');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('detects pricing with margine keyword', () => {
      const result = kb.detectWorkspace('Verifica margine su tariff');
      expect(result.workspaceId).toBe('pricing');
    });

    test('detects commerciale workspace', () => {
      const result = kb.detectWorkspace('Nuovo lead con cliente nuovo, offerta in preparazione');
      expect(result.workspaceId).toBe('commerciale');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('detects commerciale with trattativa keyword', () => {
      const result = kb.detectWorkspace('commercial trattativa prospetto');
      expect(result.workspaceId).toBe('commerciale');
    });

    test('defaults to generic workspace', () => {
      const result = kb.detectWorkspace('Random testo senza keywords');
      expect(result.workspaceId).toBe('generic');
      expect(result.confidence).toBe(0);
    });

    test('empty message defaults to generic', () => {
      const result = kb.detectWorkspace('');
      expect(result.workspaceId).toBe('generic');
    });
  });

  // ============================================================
  // WORKSPACE CONTEXT RETRIEVAL (8 tests)
  // ============================================================

  describe('getWorkspaceContext - context builder', () => {

    test('returns context for specific workspace', () => {
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Fatturazione Rule',
        content: 'Test content',
        workspace_id: 'fatturazione',
      });

      const ctx = kb.getWorkspaceContext('fatturazione');
      expect(ctx.workspace).toBe('fatturazione');
      expect(ctx.guide).toBeDefined();
      expect(ctx.operativePrompts).toBeDefined();
      expect(ctx.totalRules).toBeGreaterThan(0);
    });

    test('returns generic context when not specified', () => {
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Generic Rule',
        content: 'Test',
      });

      const ctx = kb.getWorkspaceContext('generic');
      expect(ctx.workspace).toBe('generic');
      expect(ctx.totalRules).toBeGreaterThanOrEqual(1);
    });

    test('separates hot and milestone rules', () => {
      const r1 = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Hot Rule',
        content: 'Hot',
        workspace_id: 'pricing',
        tier: 'hot',
      });

      const r2 = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Milestone Rule',
        content: 'Milestone',
        workspace_id: 'pricing',
        tier: 'milestone',
      });

      const ctx = kb.getWorkspaceContext('pricing');
      expect(ctx.guide.milestones.length).toBeGreaterThan(0);
      expect(ctx.guide.hotRules.length).toBeGreaterThan(0);
    });

    test('returns empty context for unknown workspace', () => {
      const ctx = kb.getWorkspaceContext('unknown');
      expect(ctx.workspace).toBe('unknown');
      expect(ctx.totalRules).toBe(0);
    });

    test('includes up to 5 hot rules', () => {
      for (let i = 0; i < 10; i++) {
        kb.addRule({
          domain: null,
          operationType: 'test',
          title: `Hot Rule ${i}`,
          content: `Content ${i}`,
          workspace_id: 'credito',
          tier: 'hot',
        });
      }

      const ctx = kb.getWorkspaceContext('credito');
      expect(ctx.guide.hotRules.length).toBeLessThanOrEqual(5);
    });

    test('includes operative prompts for workspace', () => {
      kb.saveOperativePrompt({
        title: 'Credito Procedure',
        domain: null,
        objective: 'Handle credit workflow',
        tags: ['credito'],
      });

      const ctx = kb.getWorkspaceContext('credito');
      expect(ctx.operativePrompts.length).toBeGreaterThan(0);
    });

    test('returns contextual milestones for workspace', () => {
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Important',
        content: 'This is important',
        workspace_id: 'commerciale',
        tier: 'milestone',
      });

      const ctx = kb.getWorkspaceContext('commerciale');
      expect(Array.isArray(ctx.guide.milestones)).toBe(true);
    });

    test('context totalRules reflects workspace rules only', () => {
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Fatturazione',
        content: 'A',
        workspace_id: 'fatturazione',
      });
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Credito',
        content: 'B',
        workspace_id: 'credito',
      });

      const ctxA = kb.getWorkspaceContext('fatturazione');
      const ctxB = kb.getWorkspaceContext('credito');
      expect(ctxA.totalRules).toBe(1);
      expect(ctxB.totalRules).toBe(1);
    });
  });

  // ============================================================
  // AUTO-TAGGING TESTS (12 tests)
  // ============================================================

  describe('heuristicTag - fallback category & entity extraction', () => {

    test('categorizes cliente rule', () => {
      const tags = kb._heuristicTag('Gestire il cliente XYZ durante negoziazione');
      expect(tags.category).toBe('cliente');
    });

    test('categorizes processo rule', () => {
      const tags = kb._heuristicTag('Il processo di spedizione avviene così');
      expect(tags.category).toBe('processo');
    });

    test('categorizes eccezione rule', () => {
      const tags = kb._heuristicTag('Quando ricevi eccezione di timeout');
      expect(tags.category).toBe('eccezione');
    });

    test('categorizes template rule', () => {
      const tags = kb._heuristicTag('Utilizza il template per compilare il form');
      expect(tags.category).toBe('template');
    });

    test('defaults to regola category', () => {
      const tags = kb._heuristicTag('Some generic content');
      expect(tags.category).toBe('regola');
    });

    test('extracts entities from content', () => {
      const tags = kb._heuristicTag('cliente: acme cliente: globex client');
      expect(tags.entities.length).toBeGreaterThan(0);
    });

    test('extracts keywords from content', () => {
      const tags = kb._heuristicTag('questo contiene alcune parole chiave lunghe');
      expect(tags.keywords_extra.length).toBeGreaterThan(0);
      expect(tags.keywords_extra[0].length).toBeGreaterThan(3);
    });

    test('limits keywords to 5', () => {
      const content = 'parola1 parola2 parola3 parola4 parola5 parola6 parola7';
      const tags = kb._heuristicTag(content);
      expect(tags.keywords_extra.length).toBeLessThanOrEqual(5);
    });

    test('returns empty entities array by default', () => {
      const tags = kb._heuristicTag('no entities here');
      expect(Array.isArray(tags.entities)).toBe(true);
    });

    test('returns empty keywords on short content', () => {
      const tags = kb._heuristicTag('ab cd');
      expect(tags.keywords_extra.length).toBeLessThanOrEqual(0);
    });

    test('case-insensitive categorization', () => {
      const tags = kb._heuristicTag('CLIENTE IMPORTANTE');
      expect(tags.category).toBe('cliente');
    });

    test('customer keyword english alias', () => {
      const tags = kb._heuristicTag('Handle the customer properly');
      expect(tags.category).toBe('cliente');
    });
  });

  describe('addRuleWithAutoTag - async tagging', () => {

    test('adds rule with default tags when no brain instance', async () => {
      const rule = {
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Gestire il cliente',
      };

      const added = await kb.addRuleWithAutoTag(rule, null);
      expect(added.category).toBeDefined();
      expect(added.entities).toBeDefined();
      expect(added.keywords_extra).toBeDefined();
    });

    test('merges AI tags with rule properties', async () => {
      const mockBrain = {
        extractTags: async (content) => ({
          category: 'processo',
          entities: ['test_entity'],
          keywords_extra: ['test_keyword'],
        }),
      };

      const rule = {
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Test content',
      };

      const added = await kb.addRuleWithAutoTag(rule, mockBrain);
      expect(added.category).toBe('processo');
      expect(added.entities).toContain('test_entity');
      expect(added.keywords_extra).toContain('test_keyword');
    });

    test('preserves rule-provided tags over AI tags', async () => {
      const mockBrain = {
        extractTags: async () => ({ category: 'processo', entities: [], keywords_extra: [] }),
      };

      const rule = {
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        category: 'cliente',
      };

      const added = await kb.addRuleWithAutoTag(rule, mockBrain);
      expect(added.category).toBe('cliente');
    });

    test('sets default workspace_id if missing', async () => {
      const rule = {
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
      };

      const added = await kb.addRuleWithAutoTag(rule, null);
      expect(added.workspace_id).toBe('generic');
    });

    test('sets default tier to hot', async () => {
      const rule = {
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
      };

      const added = await kb.addRuleWithAutoTag(rule, null);
      expect(added.tier).toBe('hot');
    });
  });

  // ============================================================
  // CONFIRM & PROMOTION TESTS (6 tests)
  // ============================================================

  describe('confirmRule - milestone promotion', () => {

    test('increments confirmCount', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
      });

      kb.confirmRule(rule.id);
      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.confirmCount).toBe(1);
    });

    test('promotes tier to milestone at confirmCount >= 2', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        tier: 'hot',
      });

      kb.confirmRule(rule.id);
      kb.confirmRule(rule.id);

      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.tier).toBe('milestone');
    });

    test('does not promote if tier is already milestone', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        tier: 'milestone',
      });

      kb.confirmRule(rule.id);
      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.tier).toBe('milestone');
    });

    test('updates lastUsedAt timestamp', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
      });

      const before = rule.lastUsedAt;
      kb.confirmRule(rule.id);
      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.lastUsedAt).not.toBe(before);
    });

    test('handles non-existent rule gracefully', () => {
      expect(() => kb.confirmRule('non-existent-id')).not.toThrow();
    });

    test('milestone index updated after promotion', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        workspace_id: 'fatturazione',
        tier: 'hot',
      });

      kb.confirmRule(rule.id);
      kb.confirmRule(rule.id);

      const milestones = kb._milestoneIndex['fatturazione'] || [];
      expect(milestones).toContain(rule.id);
    });
  });

  // ============================================================
  // DECAY & USAGE TESTS (6 tests)
  // ============================================================

  describe('markRuleUsed & decayColdRules', () => {

    test('markRuleUsed increments useCount', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
      });

      kb.markRuleUsed(rule.id);
      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.useCount).toBe(1);
    });

    test('markRuleUsed updates lastUsedAt', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
      });

      const before = new Date().getTime();
      kb.markRuleUsed(rule.id);
      const updated = kb.rules.find(r => r.id === rule.id);
      const after = new Date().getTime();

      const timestamp = new Date(updated.lastUsedAt).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    test('decayColdRules demotes unused hot rules', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        tier: 'hot',
      });

      // Manually set lastUsedAt to 91 days ago
      rule.lastUsedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();

      const decayed = kb.decayColdRules();
      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.tier).toBe('cold');
      expect(decayed).toBe(1);
    });

    test('decayColdRules does not demote recently used rules', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        tier: 'hot',
      });

      rule.lastUsedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      kb.decayColdRules();
      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.tier).toBe('hot');
    });

    test('decayColdRules preserves already-cold rules', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        tier: 'cold',
      });

      rule.lastUsedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();

      kb.decayColdRules();
      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.tier).toBe('cold');
    });

    test('decayColdRules rebuilds indices', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        workspace_id: 'pricing',
        tier: 'hot',
      });

      rule.lastUsedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      kb.decayColdRules();

      // After decay, milestone index should be clean
      const milestones = kb._milestoneIndex['pricing'] || [];
      expect(milestones).not.toContain(rule.id);
    });
  });

  // ============================================================
  // INDEX & SEARCH TESTS (8 tests)
  // ============================================================

  describe('workspace & category indexing', () => {

    test('workspace index populated on build', () => {
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test 1',
        content: 'Content',
        workspace_id: 'fatturazione',
      });

      expect(kb._workspaceIndex['fatturazione']).toBeDefined();
      expect(kb._workspaceIndex['fatturazione'].length).toBeGreaterThan(0);
    });

    test('category index populated on build', () => {
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test 1',
        content: 'Content',
        category: 'cliente',
      });

      expect(kb._categoryIndex['cliente']).toBeDefined();
      expect(kb._categoryIndex['cliente'].length).toBeGreaterThan(0);
    });

    test('milestone index separates milestone rules', () => {
      const r1 = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Hot',
        content: 'Hot',
        workspace_id: 'credito',
        tier: 'hot',
      });

      const r2 = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Milestone',
        content: 'Milestone',
        workspace_id: 'credito',
        tier: 'milestone',
      });

      expect(kb._milestoneIndex['credito']).toContain(r2.id);
      expect(kb._milestoneIndex['credito']).not.toContain(r1.id);
    });

    test('searchByTags filters by workspace and tags', () => {
      const r1 = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test 1',
        content: 'Content',
        tags: ['important', 'urgent'],
        workspace_id: 'fatturazione',
      });

      const r2 = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test 2',
        content: 'Content',
        tags: ['important'],
        workspace_id: 'credito',
      });

      const results = kb.searchByTags(['important'], 'fatturazione');
      expect(results.some(r => r.id === r1.id)).toBe(true);
      expect(results.some(r => r.id === r2.id)).toBe(false);
    });

    test('searchByTags returns empty for non-existent workspace', () => {
      const results = kb.searchByTags(['tag'], 'non-existent');
      expect(results.length).toBe(0);
    });

    test('searchByTags returns empty for empty tags', () => {
      const results = kb.searchByTags([], 'fatturazione');
      expect(results.length).toBe(0);
    });

    test('deactivated rules removed from indices', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        workspace_id: 'pricing',
      });

      kb.deactivateRule(rule.id);
      expect(kb._workspaceIndex['pricing']).not.toContain(rule.id);
    });

    test('migration sets default workspace_id on load', () => {
      // Simulate legacy rule without workspace_id
      kb.rules = [{
        id: 'test-id',
        title: 'Legacy Rule',
        content: 'Old content',
        isActive: true,
      }];

      kb._buildIndices();

      // Manually trigger migration (simulating load)
      kb.rules = kb.rules.map(r => {
        if (!r.workspace_id) r.workspace_id = 'generic';
        return r;
      });

      kb._buildIndices();
      expect(kb._workspaceIndex['generic']).toContain('test-id');
    });
  });

  // ============================================================
  // INTEGRATION TESTS (8 tests)
  // ============================================================

  describe('integration - full workflow', () => {

    test('complete fatturazione workflow', () => {
      // Detect workspace
      const detected = kb.detectWorkspace('Fattura scaduta per pagamento');
      expect(detected.workspaceId).toBe('fatturazione');

      // Add rule with auto-tag
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Fattura Procedure',
        content: 'Come gestire fatture scadute',
        workspace_id: detected.workspaceId,
      });

      // Get workspace context
      const ctx = kb.getWorkspaceContext(detected.workspaceId);
      expect(ctx.totalRules).toBeGreaterThan(0);

      // Mark as used
      kb.markRuleUsed(rule.id);

      // Confirm promotion
      kb.confirmRule(rule.id);
      kb.confirmRule(rule.id);

      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.tier).toBe('milestone');
    });

    test('multiple workspaces coexist independently', () => {
      const r1 = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Fatturazione',
        content: 'Content',
        workspace_id: 'fatturazione',
      });

      const r2 = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Credito',
        content: 'Content',
        workspace_id: 'credito',
      });

      const ctxA = kb.getWorkspaceContext('fatturazione');
      const ctxB = kb.getWorkspaceContext('credito');

      expect(ctxA.totalRules).toBe(1);
      expect(ctxB.totalRules).toBe(1);
    });

    test('tier decay workflow', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        workspace_id: 'commerciale',
        tier: 'hot',
      });

      rule.lastUsedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();

      kb.decayColdRules();

      const updated = kb.rules.find(r => r.id === rule.id);
      expect(updated.tier).toBe('cold');

      const ctx = kb.getWorkspaceContext('commerciale');
      // Cold rules should not appear in hotRules
      expect(ctx.guide.hotRules.some(r => r.id === rule.id)).toBe(false);
    });

    test('search by tags across workspace', () => {
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Rule 1',
        content: 'Content',
        tags: ['critical'],
        workspace_id: 'fatturazione',
      });

      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Rule 2',
        content: 'Content',
        tags: ['critical'],
        workspace_id: 'fatturazione',
      });

      const results = kb.searchByTags(['critical'], 'fatturazione');
      expect(results.length).toBe(2);
    });

    test('fallback to heuristic when AI fails', async () => {
      const mockBrainFail = {
        extractTags: async () => {
          throw new Error('AI service unavailable');
        },
      };

      const rule = {
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Gestire il cliente',
      };

      // Should fallback to heuristic tagging
      const added = await kb.addRuleWithAutoTag(rule, mockBrainFail);
      expect(added.category).toBeDefined();
    });

    test('cold rules excluded from default context', () => {
      const rule = kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Stale Rule',
        content: 'Old stuff',
        workspace_id: 'pricing',
        tier: 'hot',
      });

      rule.lastUsedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      kb.decayColdRules();

      const ctx = kb.getWorkspaceContext('pricing');
      // Rule should be in workspace but not in hotRules
      expect(ctx.guide.hotRules.some(r => r.id === rule.id)).toBe(false);
    });

    test('save and restore with workspace partitions', async () => {
      kb.addRule({
        domain: null,
        operationType: 'test',
        title: 'Test',
        content: 'Content',
        workspace_id: 'fatturazione',
      });

      // Simulate export
      const exported = kb.exportAll();
      expect(exported.rules[0].workspace_id).toBe('fatturazione');

      // Create new KB and import
      const kb2 = new KnowledgeBase();
      kb2._loaded = true;
      await kb2.importAll(exported);

      expect(kb2.rules[0].workspace_id).toBe('fatturazione');
    });
  });
});
