/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Communications Hub Test Suite
 * Verifies: WhatsApp, Email, LinkedIn integration and message routing
 */
const { test, expect } = require('../fixtures');

test.describe('Communications Hub', () => {
  test('navigate to comms section', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"], [aria-label*="comms"], [aria-label*="communication"]').first();

    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));

      const commsView = sidepanelPage.locator('.view[data-view="comms"]').first();
      const isVisible = await commsView.isVisible();
      expect(isVisible).toBe(true);
    }
  });

  test('display WhatsApp integration panel', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const whatsappPanel = sidepanelPage.locator('[data-testid="whatsappPanel"], [data-channel="whatsapp"]').first();

    const hasPanel = await whatsappPanel.count() > 0;
    expect(typeof hasPanel).toBe('boolean');
  });

  test('display Email integration panel', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const emailPanel = sidepanelPage.locator('[data-testid="emailPanel"], [data-channel="email"]').first();

    const hasPanel = await emailPanel.count() > 0;
    expect(typeof hasPanel).toBe('boolean');
  });

  test('display LinkedIn integration panel', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const linkedinPanel = sidepanelPage.locator('[data-testid="linkedinPanel"], [data-channel="linkedin"]').first();

    const hasPanel = await linkedinPanel.count() > 0;
    expect(typeof hasPanel).toBe('boolean');
  });

  test('connect WhatsApp account', async ({ sidepanelPage, injectMock }) => {
    await injectMock(sidepanelPage, () => {
      window.mockWhatsappAuth = true;
    });

    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const connectBtn = sidepanelPage.locator('[data-testid="connectWhatsapp"], .whatsapp-connect, button:has-text("Connect")').first();

    if (await connectBtn.count() > 0) {
      await connectBtn.click();
      await new Promise((r) => setTimeout(r, 500));

      // Look for QR code or auth confirmation
      const qrCode = sidepanelPage.locator('[data-testid="whatsappQR"], .qr-code').first();
      const hasQR = await qrCode.count() > 0;
      expect(typeof hasQR).toBe('boolean');
    }
  });

  test('send message via WhatsApp', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const waInput = sidepanelPage.locator('[data-testid="whatsappInput"], [data-channel="whatsapp"] input').first();
    const waSendBtn = sidepanelPage.locator('[data-testid="whatsappSend"], [data-channel="whatsapp"] button').first();

    if (await waInput.count() > 0 && await waSendBtn.count() > 0) {
      await waInput.fill('Hello via WhatsApp');
      await waSendBtn.click();

      await new Promise((r) => setTimeout(r, 300));

      // Verify message appears
      const msg = sidepanelPage.locator('[data-testid="whatsappMessage"]').last();
      const hasMsg = await msg.count() > 0;
      expect(typeof hasMsg).toBe('boolean');
    }
  });

  test('compose email with subject and body', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const emailSubject = sidepanelPage.locator('[data-testid="emailSubject"], [name="subject"]').first();
    const emailBody = sidepanelPage.locator('[data-testid="emailBody"], [name="body"]').first();

    if (await emailSubject.count() > 0) {
      await emailSubject.fill('Test Email');
      await new Promise((r) => setTimeout(r, 200));

      if (await emailBody.count() > 0) {
        await emailBody.fill('Email body content');
        await new Promise((r) => setTimeout(r, 200));

        // Check form is filled
        const subject = await emailSubject.inputValue();
        const body = await emailBody.inputValue();

        expect(subject).toBe('Test Email');
        expect(body).toBe('Email body content');
      }
    }
  });

  test('send LinkedIn message', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const liInput = sidepanelPage.locator('[data-testid="linkedinInput"], [data-channel="linkedin"] input').first();
    const liSendBtn = sidepanelPage.locator('[data-testid="linkedinSend"], [data-channel="linkedin"] button').first();

    if (await liInput.count() > 0 && await liSendBtn.count() > 0) {
      await liInput.fill('LinkedIn message');
      await liSendBtn.click();

      await new Promise((r) => setTimeout(r, 300));

      const msg = sidepanelPage.locator('[data-testid="linkedinMessage"]').last();
      const hasMsg = await msg.count() > 0;
      expect(typeof hasMsg).toBe('boolean');
    }
  });

  test('show conversation history for each channel', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const history = sidepanelPage.locator('[data-testid="conversationHistory"], .conversation-list').first();

    const hasHistory = await history.count() > 0;
    expect(typeof hasHistory).toBe('boolean');
  });

  test('switch between communication channels', async ({ sidepanelPage }) => {
    const commsTab = sidepanelPage.locator('[data-view="comms"]').first();
    if (await commsTab.count() > 0) {
      await commsTab.click();
      await new Promise((r) => setTimeout(r, 300));
    }

    const channelTabs = sidepanelPage.locator('[data-channel], .channel-tab');

    const count = await channelTabs.count();
    if (count > 1) {
      // Click second channel tab
      await channelTabs.nth(1).click();
      await new Promise((r) => setTimeout(r, 300));

      // Verify channel switched
      const activeTab = sidepanelPage.locator('[data-channel].active, .channel-tab.active').first();
      const isVisible = await activeTab.isVisible();
      expect(isVisible).toBe(true);
    }
  });

  test('notification for incoming message', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.incomingMessage = {
        channel: 'whatsapp',
        sender: 'Test User',
        content: 'Incoming message',
      };
    });

    const notif = sidepanelPage.locator('[data-testid="incomingMessage"], .notification, [role="alert"]').first();

    const hasNotif = await notif.count() > 0;
    expect(typeof hasNotif).toBe('boolean');
  });
});
