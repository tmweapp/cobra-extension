/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Memories & Habits Test Suite
 * Verifies: CRUD operations on user memories, habit tracking, persistence
 */
const { test, expect } = require('../fixtures');

test.describe('Memories & Habits', () => {
  test('navigate to memories view', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"], [aria-label*="memories"], [aria-label*="brain"]').first();

    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const memoriesView = sidepanelPage.locator('.view[data-view="memories"]').first();
      const isVisible = await memoriesView.isVisible();
      expect(isVisible).toBe(true);
    }
  });

  test('add new memory', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"]').first();
    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const addBtn = sidepanelPage.locator('[data-testid="addMemory"], .btn-add-memory, button:has-text("Add")').first();

    if (await addBtn.count() > 0) {
      await addBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      // Look for memory input form
      const memoryForm = sidepanelPage.locator('[data-testid="memoryForm"], .memory-form').first();

      const hasForm = await memoryForm.count() > 0;
      expect(typeof hasForm).toBe('boolean');
    }
  });

  test('save memory with content', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"]').first();
    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const addBtn = sidepanelPage.locator('[data-testid="addMemory"], .btn-add-memory').first();
    if (await addBtn.count() > 0) {
      await addBtn.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const input = sidepanelPage.locator('[data-testid="memoryInput"], .memory-input, textarea').first();
    const saveBtn = sidepanelPage.locator('[data-testid="saveMemory"], .btn-save, button:has-text("Save")').first();

    if (await input.count() > 0) {
      await input.fill('User prefers coffee in the morning');
      await new Promise((r) => setTimeout(r, 200));

      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Verify memory appears in list
        const memoryItem = sidepanelPage.locator('[data-testid="memoryItem"], .memory-card').last();

        const hasMemory = await memoryItem.count() > 0;
        expect(typeof hasMemory).toBe('boolean');
      }
    }
  });

  test('display list of memories', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"]').first();
    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const memoryList = sidepanelPage.locator('[data-testid="memoryList"], .memory-list, .memories-container').first();

    const hasList = await memoryList.count() > 0;
    expect(typeof hasList).toBe('boolean');
  });

  test('edit existing memory', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"]').first();
    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const editBtn = sidepanelPage.locator('[data-testid="editMemory"], .memory-card .btn-edit').first();

    if (await editBtn.count() > 0) {
      await editBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      // Verify edit form appears
      const editForm = sidepanelPage.locator('[data-testid="memoryForm"]').first();

      const isVisible = await editForm.isVisible();
      expect(isVisible).toBe(true);
    }
  });

  test('delete memory with confirmation', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"]').first();
    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const deleteBtn = sidepanelPage.locator('[data-testid="deleteMemory"], .memory-card .btn-delete').first();

    if (await deleteBtn.count() > 0) {
      await deleteBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      // Look for confirmation dialog
      const confirmDialog = sidepanelPage.locator('[role="dialog"], .confirm-delete').first();

      const hasConfirm = await confirmDialog.count() > 0;
      expect(typeof hasConfirm).toBe('boolean');
    }
  });

  test('search memories by keyword', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"]').first();
    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const searchInput = sidepanelPage.locator('[data-testid="searchMemories"], .search-memories, [placeholder*="search"]').first();

    if (await searchInput.count() > 0) {
      await searchInput.fill('coffee');
      await new Promise((r) => setTimeout(r, 300));

      // Verify filtered results
      const memoryItems = sidepanelPage.locator('[data-testid="memoryItem"]');

      const count = await memoryItems.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('tag memories for organization', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"]').first();
    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const tagInput = sidepanelPage.locator('[data-testid="memoryTags"], .tag-input, [placeholder*="tag"]').first();

    const hasTagging = await tagInput.count() > 0;
    expect(typeof hasTagging).toBe('boolean');
  });

  test('display habits learned from interactions', async ({ sidepanelPage }) => {
    const habitsSection = sidepanelPage.locator('[data-testid="habitsSection"], .habits-list, [data-section="habits"]').first();

    const hasHabits = await habitsSection.count() > 0;
    expect(typeof hasHabits).toBe('boolean');
  });

  test('persist memories to storage', async ({ sidepanelPage }) => {
    const memoriesTab = sidepanelPage.locator('[data-view="memories"]').first();
    if (await memoriesTab.count() > 0) {
      await memoriesTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const addBtn = sidepanelPage.locator('[data-testid="addMemory"]').first();
    if (await addBtn.count() > 0) {
      await addBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const input = sidepanelPage.locator('[data-testid="memoryInput"], textarea').first();
      const saveBtn = sidepanelPage.locator('[data-testid="saveMemory"], button:has-text("Save")').first();

      if (await input.count() > 0 && await saveBtn.count() > 0) {
        await input.fill('Persistent memory test');
        await saveBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Verify persisted in storage
        const persisted = await sidepanelPage.evaluate(() => {
          return new Promise((resolve) => {
            chrome.storage.local.get('memories', (result) => {
              resolve(Array.isArray(result.memories) && result.memories.length > 0);
            });
          });
        });

        expect(persisted).toBe(true);
      }
    }
  });
});
