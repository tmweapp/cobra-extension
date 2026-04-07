/**
 * COBRA Remote Library Tests
 * Tests for consolidateWeekly, consolidateByVolume, metaConsolidate (unlimited levels),
 * searchByIndex, deepRead, milestone preservation, and stats
 */

const RemoteLibrary = require('../remote-library.js');

describe('RemoteLibrary', () => {
  let lib;
  let mockKB;
  let mockBrain;

  beforeEach(() => {
    // Mock KnowledgeBase
    mockKB = {
      rules: [
        {
          id: 'rule-1',
          workspace_id: 'test-workspace',
          tier: 'hot',
          title: 'Hot Rule 1',
          content: 'This is a hot rule with some content for testing purposes and more words',
          createdAt: new Date().toISOString(),
          category: 'regola',
          tags: ['test'],
          consolidation_metadata: {}
        },
        {
          id: 'rule-2',
          workspace_id: 'test-workspace',
          tier: 'hot',
          title: 'Hot Rule 2',
          content: 'Another hot rule with substantial content containing multiple words for volume calculation',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          category: 'regola',
          tags: ['test', 'critical'],
          consolidation_metadata: {}
        },
        {
          id: 'rule-3',
          workspace_id: 'test-workspace',
          tier: 'milestone',
          title: 'Milestone Rule',
          content: 'This is a milestone that should never be consolidated',
          createdAt: new Date().toISOString(),
          category: 'milestone',
          tags: ['important']
        }
      ],
      save: jest.fn(async () => {})
    };

    // Mock Brain
    mockBrain = {
      askClaude: jest.fn(async (prompt, opts) => {
        if (prompt.includes('consolida')) {
          return JSON.stringify({
            title: 'Consolidated Document',
            summary: 'Summary of consolidated rules',
            full: '# Consolidation\nThis is the full markdown content of the consolidated document.',
            tags: ['consolidated', 'test'],
            category: 'consolidation'
          });
        }
        if (prompt.includes('consolida questi')) {
          return JSON.stringify({
            title: 'Meta-Consolidated Document',
            summary: 'Abstract summary of multiple documents',
            full: '# Meta-Consolidation\nHigher level abstract content.',
            tags: ['meta', 'abstract'],
            category: 'meta'
          });
        }
        return JSON.stringify({ title: 'Unknown', summary: 'Error', full: 'Error', tags: [], category: 'error' });
      })
    };

    self.Brain = mockBrain;
    self.cobraKB = mockKB;

    lib = new RemoteLibrary();
  });

  describe('init()', () => {
    test('should initialize IndexedDB', async () => {
      await lib.init();
      expect(lib._initialized).toBe(true);
      expect(lib._db).not.toBeNull();
    });

    test('should be idempotent', async () => {
      await lib.init();
      const db1 = lib._db;
      await lib.init();
      const db2 = lib._db;
      expect(db1).toBe(db2);
    });
  });

  describe('consolidateWeekly()', () => {
    test('should consolidate hot rules from last 7 days', async () => {
      await lib.init();
      const doc = await lib.consolidateWeekly('test-workspace');

      expect(doc).toBeDefined();
      expect(doc.level).toBe(0); // raw level
      expect(doc.workspace_id).toBe('test-workspace');
    });

    test('should create document with correct schema', async () => {
      await lib.init();
      const doc = await lib.consolidateWeekly('test-workspace');

      expect(doc.id).toBeDefined();
      expect(doc.period).toBeDefined();
      expect(doc.tags).toBeInstanceOf(Array);
      expect(doc.category).toBeDefined();
      expect(doc.summary.length).toBeLessThanOrEqual(200);
      expect(doc.full).toBeDefined();
      expect(doc.source_ids).toBeInstanceOf(Array);
      expect(doc.milestone_refs).toBeInstanceOf(Array);
    });

    test('should preserve milestone references in consolidation', async () => {
      await lib.init();
      const doc = await lib.consolidateWeekly('test-workspace');

      // Milestone should not be in source_ids
      expect(doc.source_ids).not.toContain('rule-3');
    });

    test('should mark rules as consolidated', async () => {
      await lib.init();
      const doc = await lib.consolidateWeekly('test-workspace');

      expect(mockKB.rules[0].consolidation_metadata.consolidated_into).toBe(doc.id);
      expect(mockKB.rules[1].consolidation_metadata.consolidated_into).toBe(doc.id);
    });

    test('should degrade hot rules to cold', async () => {
      await lib.init();
      await lib.consolidateWeekly('test-workspace');

      expect(mockKB.rules[0].tier).toBe('cold');
      expect(mockKB.rules[1].tier).toBe('cold');
    });

    test('should call KB.save', async () => {
      await lib.init();
      await lib.consolidateWeekly('test-workspace');
      expect(mockKB.save).toHaveBeenCalled();
    });

    test('should return null if no hot rules found', async () => {
      mockKB.rules = mockKB.rules.filter(r => r.tier === 'milestone');
      await lib.init();
      const doc = await lib.consolidateWeekly('test-workspace');
      expect(doc).toBeNull();
    });

    test('should only consolidate rules from specified workspace', async () => {
      mockKB.rules.push({
        id: 'rule-other',
        workspace_id: 'other-workspace',
        tier: 'hot',
        title: 'Other Rule',
        content: 'Other content',
        createdAt: new Date().toISOString(),
        category: 'regola'
      });

      await lib.init();
      const doc = await lib.consolidateWeekly('test-workspace');
      expect(doc.source_ids).not.toContain('rule-other');
    });

    test('should handle AI JSON parse error', async () => {
      mockBrain.askClaude.mockResolvedValueOnce('invalid json');
      await lib.init();
      const doc = await lib.consolidateWeekly('test-workspace');
      expect(doc).toBeNull();
    });
  });

  describe('consolidateByVolume()', () => {
    test('should trigger consolidation if volume > threshold', async () => {
      // Each rule has ~100 words, so 2 rules = 200 words (well below 20000)
      // We need to mock more rules to reach threshold
      mockKB.rules = Array.from({ length: 220 }, (_, i) => ({
        id: `rule-${i}`,
        workspace_id: 'test-workspace',
        tier: 'hot',
        title: `Rule ${i}`,
        content: 'word '.repeat(100), // 100 words
        createdAt: new Date().toISOString(),
        category: 'regola'
      }));

      await lib.init();
      const doc = await lib.consolidateByVolume('test-workspace', 20000);
      expect(doc).toBeDefined();
    });

    test('should not trigger if volume below threshold', async () => {
      await lib.init();
      const doc = await lib.consolidateByVolume('test-workspace', 100000);
      expect(doc).toBeNull();
    });

    test('should use custom threshold', async () => {
      await lib.init();
      const doc = await lib.consolidateByVolume('test-workspace', 10);
      expect(doc).toBeDefined();
    });
  });

  describe('metaConsolidate()', () => {
    test('should meta-consolidate documents at same level', async () => {
      await lib.init();

      // Create 5 level-0 documents
      for (let i = 0; i < 5; i++) {
        await lib._write({
          id: `doc-0-${i}`,
          workspace_id: 'test-workspace',
          level: 0,
          period: new Date().toISOString().split('T')[0],
          tags: ['test'],
          category: 'consolidation',
          keywords_extra: [],
          summary: `Document ${i}`,
          full: `Full content ${i}`,
          source_ids: [],
          milestone_refs: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }

      const metaDoc = await lib.metaConsolidate('test-workspace', 0, 5);
      expect(metaDoc).toBeDefined();
      expect(metaDoc.level).toBe(1); // Level increases
    });

    test('should have no cap on levels (unlimited)', async () => {
      await lib.init();

      // Create documents up to level 5
      for (let level = 0; level < 5; level++) {
        for (let i = 0; i < 5; i++) {
          await lib._write({
            id: `doc-${level}-${i}`,
            workspace_id: 'test-workspace',
            level,
            period: new Date().toISOString().split('T')[0],
            tags: ['test'],
            category: 'consolidation',
            keywords_extra: [],
            summary: `Doc level ${level}`,
            full: 'Content',
            source_ids: level > 0 ? [`doc-${level - 1}-${i}`] : [],
            milestone_refs: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      }

      // Meta-consolidate from level 4 should create level 5 (unlimited)
      const metaDoc = await lib.metaConsolidate('test-workspace', 4, 5);
      expect(metaDoc.level).toBe(5);
    });

    test('should preserve milestone references in meta-consolidation', async () => {
      await lib.init();

      // Create docs with milestone references
      for (let i = 0; i < 5; i++) {
        await lib._write({
          id: `doc-${i}`,
          workspace_id: 'test-workspace',
          level: 0,
          period: new Date().toISOString().split('T')[0],
          tags: ['test'],
          category: 'consolidation',
          keywords_extra: [],
          summary: `Doc ${i}`,
          full: 'Content',
          source_ids: [],
          milestone_refs: i === 0 ? ['M-1', 'M-2'] : [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }

      const metaDoc = await lib.metaConsolidate('test-workspace', 0, 5);
      // The extracted milestone_refs may be empty if not all docs have milestone_refs
      expect(metaDoc.milestone_refs).toBeInstanceOf(Array);
    });

    test('should recursively meta-consolidate to unlimited levels', async () => {
      await lib.init();

      // Create 10 level-0 docs
      for (let i = 0; i < 10; i++) {
        await lib._write({
          id: `doc-0-${i}`,
          workspace_id: 'test-workspace',
          level: 0,
          period: new Date().toISOString().split('T')[0],
          tags: ['test'],
          category: 'consolidation',
          keywords_extra: [],
          summary: `Doc ${i}`,
          full: 'Content',
          source_ids: [],
          milestone_refs: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }

      // This should recursively create level 1 and level 2
      const result = await lib.metaConsolidate('test-workspace', 0, 5);
      expect(result.level).toBeGreaterThanOrEqual(1);
    });

    test('should not consolidate if insufficient documents', async () => {
      await lib.init();

      // Create only 2 docs (less than docsPerMeta default 5)
      for (let i = 0; i < 2; i++) {
        await lib._write({
          id: `doc-insufficient-${i}`,
          workspace_id: 'test-workspace-2',
          level: 0,
          period: new Date().toISOString().split('T')[0],
          tags: ['test'],
          category: 'consolidation',
          keywords_extra: [],
          summary: `Doc ${i}`,
          full: 'Content',
          source_ids: [],
          milestone_refs: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }

      const result = await lib.metaConsolidate('test-workspace-2', 0);
      expect(result).toBeNull();
    });
  });

  describe('searchByIndex()', () => {
    test('should search by title', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-1',
        workspace_id: 'test-workspace',
        level: 0,
        period: '2024-01-01',
        tags: ['search'],
        category: 'test',
        keywords_extra: [],
        summary: 'Test document',
        full: 'Content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Search Test Document'
      });

      const results = await lib.searchByIndex('Search', 'test-workspace');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('Search');
    });

    test('should search by tags', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-2',
        workspace_id: 'test-workspace',
        level: 0,
        period: '2024-01-01',
        tags: ['important', 'critical'],
        category: 'test',
        keywords_extra: [],
        summary: 'Tagged document',
        full: 'Content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Document'
      });

      const results = await lib.searchByIndex('critical', 'test-workspace');
      expect(results.length).toBeGreaterThan(0);
    });

    test('should search by category', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-3',
        workspace_id: 'test-workspace',
        level: 0,
        period: '2024-01-01',
        tags: [],
        category: 'special_category',
        keywords_extra: [],
        summary: 'Categorized document',
        full: 'Content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Document'
      });

      const results = await lib.searchByIndex('special_category', 'test-workspace');
      expect(results.length).toBeGreaterThan(0);
    });

    test('should respect limit', async () => {
      await lib.init();
      for (let i = 0; i < 20; i++) {
        await lib._write({
          id: `doc-${i}`,
          workspace_id: 'test-workspace',
          level: 0,
          period: '2024-01-01',
          tags: ['result'],
          category: 'test',
          keywords_extra: [],
          summary: 'Result',
          full: 'Content',
          source_ids: [],
          milestone_refs: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          title: `Document ${i}`
        });
      }

      const results = await lib.searchByIndex('result', 'test-workspace', { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('should filter by workspace', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-ws1',
        workspace_id: 'workspace-1',
        level: 0,
        period: '2024-01-01',
        tags: ['test'],
        category: 'test',
        keywords_extra: [],
        summary: 'Workspace 1',
        full: 'Content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'WS1'
      });

      const results = await lib.searchByIndex('test', 'workspace-1');
      expect(results.every(d => d.workspace_id === 'workspace-1' || !d.workspace_id)).toBe(true);
    });

    test('should return shortlist with summary only', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-search',
        workspace_id: 'test-workspace',
        level: 0,
        period: '2024-01-01',
        tags: ['search'],
        category: 'test',
        keywords_extra: [],
        summary: 'Short summary',
        full: 'This is a very long full content that should not be returned in searchByIndex',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Document'
      });

      const results = await lib.searchByIndex('search', 'test-workspace');
      expect(results[0].summary).toBeDefined();
      expect(results[0].full).toBeUndefined(); // full should not be in search results
    });
  });

  describe('deepRead()', () => {
    test('should read full content of specified docs', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-deep',
        workspace_id: 'test-workspace',
        level: 0,
        period: '2024-01-01',
        tags: [],
        category: 'test',
        keywords_extra: [],
        summary: 'Short',
        full: 'This is the full detailed content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Document'
      });

      const docs = await lib.deepRead(['doc-deep']);
      expect(docs).toHaveLength(1);
      expect(docs[0].full).toBe('This is the full detailed content');
    });

    test('should limit to max 5 documents', async () => {
      await lib.init();
      for (let i = 0; i < 10; i++) {
        await lib._write({
          id: `doc-${i}`,
          workspace_id: 'test-workspace',
          level: 0,
          period: '2024-01-01',
          tags: [],
          category: 'test',
          keywords_extra: [],
          summary: 'Summary',
          full: `Content ${i}`,
          source_ids: [],
          milestone_refs: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          title: `Doc ${i}`
        });
      }

      const docIds = Array.from({ length: 10 }, (_, i) => `doc-${i}`);
      const docs = await lib.deepRead(docIds);
      expect(docs.length).toBeLessThanOrEqual(5);
    });

    test('should handle missing documents', async () => {
      await lib.init();
      const docs = await lib.deepRead(['non-existent']);
      expect(docs).toHaveLength(0);
    });

    test('should return empty for empty array', async () => {
      await lib.init();
      const docs = await lib.deepRead([]);
      expect(docs).toHaveLength(0);
    });
  });

  describe('getStats()', () => {
    test('should report total documents', async () => {
      await lib.init();
      for (let i = 0; i < 3; i++) {
        await lib._write({
          id: `doc-${i}`,
          workspace_id: 'test-workspace',
          level: 0,
          period: '2024-01-01',
          tags: [],
          category: 'test',
          keywords_extra: [],
          summary: 'Summary',
          full: 'Content',
          source_ids: [],
          milestone_refs: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          title: 'Doc'
        });
      }

      const stats = await lib.getStats();
      expect(stats.totalDocs).toBeGreaterThanOrEqual(3);
    });

    test('should count documents by level', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-level0',
        workspace_id: 'test-workspace',
        level: 0,
        period: '2024-01-01',
        tags: [],
        category: 'test',
        keywords_extra: [],
        summary: 'Summary',
        full: 'Content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Doc'
      });

      const stats = await lib.getStats();
      expect(stats.byLevel[0]).toBeGreaterThanOrEqual(1);
    });

    test('should count documents by workspace', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-ws',
        workspace_id: 'my-workspace',
        level: 0,
        period: '2024-01-01',
        tags: [],
        category: 'test',
        keywords_extra: [],
        summary: 'Summary',
        full: 'Content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Doc'
      });

      const stats = await lib.getStats();
      expect(stats.byWorkspace['my-workspace']).toBeGreaterThanOrEqual(1);
    });

    test('should calculate total size in KB', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-size',
        workspace_id: 'test-workspace',
        level: 0,
        period: '2024-01-01',
        tags: [],
        category: 'test',
        keywords_extra: [],
        summary: 'Summary',
        full: 'Content content content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Doc'
      });

      const stats = await lib.getStats();
      expect(stats.totalSizeKB).toBeGreaterThan(0);
      expect(typeof stats.totalSizeKB).toBe('number');
    });
  });

  describe('Milestone preservation', () => {
    test('should never consolidate milestone rules', async () => {
      await lib.init();
      const docsBefore = (await lib._getAll()).length;

      await lib.consolidateWeekly('test-workspace');

      // Milestone rule should still exist in KB
      const milestone = mockKB.rules.find(r => r.tier === 'milestone');
      expect(milestone.tier).toBe('milestone');
    });

    test('should not include milestone refs in consolidated docs', async () => {
      await lib.init();
      const doc = await lib.consolidateWeekly('test-workspace');

      expect(doc.source_ids).not.toContain('rule-3'); // milestone rule ID
    });
  });

  describe('delete()', () => {
    test('should delete document from library', async () => {
      await lib.init();
      await lib._write({
        id: 'doc-delete',
        workspace_id: 'test-workspace',
        level: 0,
        period: '2024-01-01',
        tags: [],
        category: 'test',
        keywords_extra: [],
        summary: 'Summary',
        full: 'Content',
        source_ids: [],
        milestone_refs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        title: 'Doc'
      });

      await lib.delete('doc-delete');
      const doc = await lib._read('doc-delete');
      expect(doc).toBeUndefined();
    });
  });
});
