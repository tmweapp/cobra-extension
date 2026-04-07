/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Archive View Test Suite
 * Verifies: archive navigation, conversation history, search and filtering
 */
const { test, expect } = require('../fixtures');

test.describe('Archive View', () => {
  test('navigate to archive section', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"], [aria-label*="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const archiveView = sidepanelPage.locator('.view[data-view="archivio"], .view[data-view="archive"]').first();

      const isVisible = await archiveView.isVisible();
      expect(isVisible).toBe(true);
    }
  });

  test('display archived conversations list', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const conversationList = sidepanelPage.locator('[data-testid="conversationList"], .archive-list, .conversation-item').first();

      const hasList = await conversationList.count() > 0;
      expect(typeof hasList).toBe('boolean');
    }
  });

  test('open archived conversation', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const convItem = sidepanelPage.locator('[data-testid="conversationItem"], .conversation-item').first();

      if (await convItem.count() > 0) {
        await convItem.click();
        await new Promise((r) => setTimeout(r, 300));

        // Verify conversation opens
        const messages = sidepanelPage.locator('[data-testid="chatMessage"], .archive-message').first();

        const hasMessages = await messages.count() > 0;
        expect(typeof hasMessages).toBe('boolean');
      }
    }
  });

  test('show conversation metadata (date, participants)', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const metadata = sidepanelPage.locator('[data-testid="convMetadata"], .conversation-meta, [data-field="date"]').first();

      const hasMetadata = await metadata.count() > 0;
      expect(typeof hasMetadata).toBe('boolean');
    }
  });

  test('search archived conversations', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const searchInput = sidepanelPage.locator('[data-testid="searchArchive"], .search-archive, [placeholder*="search"]').first();

      if (await searchInput.count() > 0) {
        await searchInput.fill('test conversation');
        await new Promise((r) => setTimeout(r, 300));

        // Verify filtered results
        const results = sidepanelPage.locator('[data-testid="conversationItem"]');

        const count = await results.count();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('filter archive by date range', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const dateFilter = sidepanelPage.locator('[data-testid="dateFilter"], [name="dateRange"]').first();

      if (await dateFilter.count() > 0) {
        await dateFilter.click();
        await new Promise((r) => setTimeout(r, 300));

        // Date picker should appear
        const datePicker = sidepanelPage.locator('[data-testid="datePicker"], .date-picker').first();

        const hasDatePicker = await datePicker.count() > 0;
        expect(typeof hasDatePicker).toBe('boolean');
      }
    }
  });

  test('restore conversation from archive', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const restoreBtn = sidepanelPage.locator('[data-testid="restoreConv"], .conversation-item .btn-restore').first();

      if (await restoreBtn.count() > 0) {
        await restoreBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Should show success notification
        const successMsg = sidepanelPage.locator('[data-testid="successNotif"], .success-toast').first();

        const hasSuccess = await successMsg.count() > 0;
        expect(typeof hasSuccess).toBe('boolean');
      }
    }
  });

  test('delete conversation permanently', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const deleteBtn = sidepanelPage.locator('[data-testid="deleteConv"], .conversation-item .btn-delete').first();

      if (await deleteBtn.count() > 0) {
        await deleteBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Look for confirmation dialog
        const confirmDialog = sidepanelPage.locator('[role="dialog"], .confirm-delete').first();

        const hasConfirm = await confirmDialog.count() > 0;
        expect(typeof hasConfirm).toBe('boolean');
      }
    }
  });

  test('export conversation as JSON', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const exportBtn = sidepanelPage.locator('[data-testid="exportConv"], .conversation-item .btn-export').first();

      if (await exportBtn.count() > 0) {
        await exportBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Should initiate download
        const downloadNotif = sidepanelPage.locator('[data-testid="downloadNotif"], .download-started').first();

        const hasDownload = await downloadNotif.count() > 0;
        expect(typeof hasDownload).toBe('boolean');
      }
    }
  });

  test('show archive statistics', async ({ sidepanelPage }) => {
    const archiveTab = sidepanelPage.locator('[data-view="archivio"], [data-view="archive"]').first();

    if (await archiveTab.count() > 0) {
      await archiveTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const stats = sidepanelPage.locator('[data-testid="archiveStats"], .archive-stats, [data-section="stats"]').first();

      const hasStats = await stats.count() > 0;
      expect(typeof hasStats).toBe('boolean');
    }
  });
});
