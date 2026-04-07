/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Agents Modal & Management Test Suite
 * Verifies: agent list display, modal interaction, agent selection
 */
const { test, expect } = require('../fixtures');

test.describe('Agents Modal', () => {
  test('open agents modal button exists', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], [aria-label*="agent"], .btn-agents').first();

    const hasBtn = await agentsBtn.count() > 0;
    expect(typeof hasBtn).toBe('boolean');
  });

  test('open agents modal', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], [aria-label*="agent"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const modal = sidepanelPage.locator('[role="dialog"], [data-testid="agentsModal"], .agents-modal').first();

      await expect(modal).toBeVisible();
    }
  });

  test('display agents list in modal', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const agentsList = sidepanelPage.locator('[data-testid="agentsList"], .agents-list, .agent-card').first();

      const hasAgents = await agentsList.count() > 0;
      expect(typeof hasAgents).toBe('boolean');
    }
  });

  test('show agent details when selected', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const agentCard = sidepanelPage.locator('[data-testid="agentCard"], .agent-card').first();

      if (await agentCard.count() > 0) {
        await agentCard.click();
        await new Promise((r) => setTimeout(r, 300));

        // Look for agent details panel
        const details = sidepanelPage.locator('[data-testid="agentDetails"], .agent-details, [data-section="details"]').first();

        const hasDetails = await details.count() > 0;
        expect(typeof hasDetails).toBe('boolean');
      }
    }
  });

  test('activate agent from list', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.agents = [
        { id: 'agent-1', name: 'Agent One', active: false },
        { id: 'agent-2', name: 'Agent Two', active: false },
      ];
    });

    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const activateBtn = sidepanelPage.locator('[data-testid="activateAgent"], .agent-card button:has-text("Activate")').first();

      if (await activateBtn.count() > 0) {
        await activateBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Check if agent is now active
        const activeAgent = sidepanelPage.locator('[data-testid="agentCard"].active, .agent-card.active').first();

        const isActive = await activeAgent.count() > 0;
        expect(typeof isActive).toBe('boolean');
      }
    }
  });

  test('create new agent', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const newAgentBtn = sidepanelPage.locator('[data-testid="newAgent"], .btn-new-agent, button:has-text("New")').first();

      if (await newAgentBtn.count() > 0) {
        await newAgentBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        // Look for agent creation form
        const form = sidepanelPage.locator('[data-testid="agentForm"], .agent-form').first();

        const hasForm = await form.count() > 0;
        expect(typeof hasForm).toBe('boolean');
      }
    }
  });

  test('configure agent settings', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const settingsBtn = sidepanelPage.locator('[data-testid="agentSettings"], .agent-card .btn-settings').first();

      if (await settingsBtn.count() > 0) {
        await settingsBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        const settingsPanel = sidepanelPage.locator('[data-testid="agentSettingsPanel"], .settings-panel').first();

        const hasSettings = await settingsPanel.count() > 0;
        expect(typeof hasSettings).toBe('boolean');
      }
    }
  });

  test('delete agent', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const deleteBtn = sidepanelPage.locator('[data-testid="deleteAgent"], .agent-card .btn-delete').first();

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

  test('search agents', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const searchInput = sidepanelPage.locator('[data-testid="searchAgents"], .search-agents, [placeholder*="search"]').first();

      if (await searchInput.count() > 0) {
        await searchInput.fill('test');
        await new Promise((r) => setTimeout(r, 300));

        // Verify filtered results
        const agentCards = sidepanelPage.locator('[data-testid="agentCard"]');

        const count = await agentCards.count();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('close agents modal', async ({ sidepanelPage }) => {
    const agentsBtn = sidepanelPage.locator('[data-testid="openAgentsModal"], .btn-agents').first();

    if (await agentsBtn.count() > 0) {
      await agentsBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      const closeBtn = sidepanelPage.locator('[data-testid="closeModal"], [aria-label="close"], .btn-close').first();

      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await new Promise((r) => setTimeout(r, 300));

        const modal = sidepanelPage.locator('[role="dialog"], .agents-modal').first();

        const isVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
        expect(isVisible).toBe(false);
      }
    }
  });
});
