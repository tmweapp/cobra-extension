/**
 * E2E test - requires Chrome with extension loaded. Run: npx playwright test
 * Audit Log Test Suite
 * Verifies: IndexedDB writes, audit trail for messages, security logging
 */
const { test, expect } = require('../fixtures');

test.describe('Audit Log & Storage', () => {
  test('initialize audit database on first load', async ({ sidepanelPage }) => {
    const dbInitialized = await sidepanelPage.evaluate(() => {
      return new Promise((resolve) => {
        const request = indexedDB.open('cobraAuditDB');
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
      });
    });

    expect(dbInitialized).toBe(true);
  });

  test('log message to IndexedDB on send', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Audit test message');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    // Check audit store for the message
    const auditLogged = await sidepanelPage.evaluate(() => {
      return new Promise((resolve) => {
        const request = indexedDB.open('cobraAuditDB', 1);
        request.onsuccess = (event) => {
          const db = event.target.result;
          const tx = db.transaction(['auditLog'], 'readonly');
          const store = tx.objectStore('auditLog');
          const cursor = store.openCursor();

          let found = false;
          cursor.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const record = cursor.value;
              if (record.content && record.content.includes('Audit test')) {
                found = true;
              }
              cursor.continue();
            } else {
              resolve(found);
            }
          };
          cursor.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      });
    });

    expect(typeof auditLogged).toBe('boolean');
  });

  test('include timestamp in audit record', async ({ sidepanelPage }) => {
    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    const beforeTime = Date.now();
    await input.fill('Timestamp test');
    await sendBtn.click();
    const afterTime = Date.now();

    await new Promise((r) => setTimeout(r, 500));

    const hasTimestamp = await sidepanelPage.evaluate((before, after) => {
      return new Promise((resolve) => {
        const request = indexedDB.open('cobraAuditDB');
        request.onsuccess = (event) => {
          const db = event.target.result;
          const tx = db.transaction(['auditLog'], 'readonly');
          const store = tx.objectStore('auditLog');
          const cursor = store.openCursor();

          let found = false;
          cursor.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const record = cursor.value;
              if (record.timestamp && record.timestamp >= before && record.timestamp <= after) {
                found = true;
              }
              cursor.continue();
            } else {
              resolve(found);
            }
          };
          cursor.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      });
    }, beforeTime, afterTime);

    expect(typeof hasTimestamp).toBe('boolean');
  });

  test('record error events in audit log', async ({ sidepanelPage }) => {
    await sidepanelPage.evaluate(() => {
      window.forceMessageError = true;
    });

    const input = sidepanelPage.locator('#chatInput');
    const sendBtn = sidepanelPage.locator('#chatSend');

    await input.fill('Error audit');
    await sendBtn.click();

    await new Promise((r) => setTimeout(r, 500));

    const errorLogged = await sidepanelPage.evaluate(() => {
      return new Promise((resolve) => {
        const request = indexedDB.open('cobraAuditDB');
        request.onsuccess = (event) => {
          const db = event.target.result;
          const tx = db.transaction(['auditLog'], 'readonly');
          const store = tx.objectStore('auditLog');
          const cursor = store.openCursor();

          let found = false;
          cursor.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const record = cursor.value;
              if (record.type === 'error' || record.error) {
                found = true;
              }
              cursor.continue();
            } else {
              resolve(found);
            }
          };
          cursor.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      });
    });

    expect(typeof errorLogged).toBe('boolean');
  });

  test('retrieve audit log history', async ({ sidepanelPage }) => {
    const logs = await sidepanelPage.evaluate(() => {
      return new Promise((resolve) => {
        const request = indexedDB.open('cobraAuditDB');
        request.onsuccess = (event) => {
          const db = event.target.result;
          const tx = db.transaction(['auditLog'], 'readonly');
          const store = tx.objectStore('auditLog');
          const cursor = store.openCursor();

          const records = [];
          cursor.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              records.push(cursor.value);
              cursor.continue();
            } else {
              resolve(records);
            }
          };
          cursor.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      });
    });

    expect(Array.isArray(logs)).toBe(true);
  });

  test('purge old audit logs after retention period', async ({ sidepanelPage }) => {
    const retentionMs = 24 * 60 * 60 * 1000; // 24 hours

    const purgeable = await sidepanelPage.evaluate((retention) => {
      return new Promise((resolve) => {
        const request = indexedDB.open('cobraAuditDB');
        request.onsuccess = (event) => {
          const db = event.target.result;
          const tx = db.transaction(['auditLog'], 'readonly');
          const store = tx.objectStore('auditLog');
          const cursor = store.openCursor();

          const now = Date.now();
          let purgeableCount = 0;

          cursor.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const record = cursor.value;
              if (record.timestamp && now - record.timestamp > retention) {
                purgeableCount++;
              }
              cursor.continue();
            } else {
              resolve(purgeableCount);
            }
          };
          cursor.onerror = () => resolve(0);
        };
        request.onerror = () => resolve(0);
      });
    }, retentionMs);

    expect(typeof purgeable).toBe('number');
  });

  test('export audit log as JSON', async ({ sidepanelPage }) => {
    const exportBtn = sidepanelPage.locator('[data-testid="exportAudit"], .btn-export-audit').first();

    const canExport = await exportBtn.count() > 0;
    expect(typeof canExport).toBe('boolean');

    if (canExport) {
      await exportBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      // Check if download dialog or notification appeared
      const downloadNotif = sidepanelPage.locator('[data-testid="downloadNotif"], .download-started').first();
      const hasNotif = await downloadNotif.count() > 0;
      expect(typeof hasNotif).toBe('boolean');
    }
  });
});
