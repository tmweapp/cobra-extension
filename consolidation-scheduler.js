/**
 * COBRA v5.2 — Consolidation Scheduler
 * Pianifica consolidamenti periodici: weekly, volume_check, session_decay
 * Usa chrome.alarms API per trigger automatici
 *
 * @example
 * await CobraConsolidationScheduler.init();
 * // Automaticamente esegue task periodici
 */

const CobraConsolidationScheduler = {
  _initialized: false,

  // ══════════════════════════════════════════════════════
  // INIT — setup alarms periodici
  // ══════════════════════════════════════════════════════
  async init() {
    if (this._initialized) return;

    try {
      // Carica moduli se non già caricati
      if (!self.RemoteLibrary) {
        console.warn('[ConsolidationScheduler] RemoteLibrary not available, skipping init');
        return;
      }

      // Inizializza RemoteLibrary
      if (!self._remoteLibraryInstance) {
        self._remoteLibraryInstance = new RemoteLibrary();
        await self._remoteLibraryInstance.init();
      }

      // Crea/reimposta alarms
      await this._setupAlarms();

      // Setup listener per alarms
      if (chrome.alarms && chrome.alarms.onAlarm) {
        chrome.alarms.onAlarm.removeListener(this._onAlarm);
        chrome.alarms.onAlarm.addListener(this._onAlarm.bind(this));
      }

      this._initialized = true;
      console.log('[ConsolidationScheduler] Initialized — periodic tasks scheduled');
    } catch (e) {
      console.error('[ConsolidationScheduler] Init failed:', e);
    }
  },

  // ══════════════════════════════════════════════════════
  // SETUP_ALARMS — crea alarms per i vari consolidamenti
  // ══════════════════════════════════════════════════════
  async _setupAlarms() {
    // Pulisci alarms precedenti
    if (chrome.alarms && chrome.alarms.clear) {
      try {
        await chrome.alarms.clear('cobra_consolidate_weekly');
        await chrome.alarms.clear('cobra_consolidate_volume');
        await chrome.alarms.clear('cobra_session_decay');
      } catch (e) {
        console.warn('[ConsolidationScheduler] Error clearing alarms:', e);
      }
    }

    if (!chrome.alarms || !chrome.alarms.create) {
      console.warn('[ConsolidationScheduler] chrome.alarms not available');
      return;
    }

    try {
      // Weekly consolidation — ogni 7 giorni (10080 minuti)
      chrome.alarms.create('cobra_consolidate_weekly', {
        periodInMinutes: 7 * 24 * 60
      });

      // Volume check — ogni 6 ore (360 minuti)
      chrome.alarms.create('cobra_consolidate_volume', {
        periodInMinutes: 6 * 60
      });

      // Session decay — ogni 24 ore (1440 minuti)
      chrome.alarms.create('cobra_session_decay', {
        periodInMinutes: 24 * 60
      });

      console.log('[ConsolidationScheduler] Alarms created');
    } catch (e) {
      console.error('[ConsolidationScheduler] Failed to create alarms:', e);
    }
  },

  // ══════════════════════════════════════════════════════
  // ON_ALARM — listener per chrome.alarms.onAlarm
  // ══════════════════════════════════════════════════════
  async _onAlarm(alarm) {
    console.log(`[ConsolidationScheduler] Alarm triggered: ${alarm.name}`);

    try {
      switch (alarm.name) {
        case 'cobra_consolidate_weekly':
          await this._dispatchWeeklyConsolidation();
          break;

        case 'cobra_consolidate_volume':
          await this._dispatchVolumeConsolidation();
          break;

        case 'cobra_session_decay':
          await this._dispatchSessionDecay();
          break;

        default:
          console.warn(`[ConsolidationScheduler] Unknown alarm: ${alarm.name}`);
      }
    } catch (e) {
      console.error(`[ConsolidationScheduler] Alarm handler error (${alarm.name}):`, e);
    }
  },

  // ══════════════════════════════════════════════════════
  // DISPATCH HANDLERS
  // ══════════════════════════════════════════════════════
  async _dispatchWeeklyConsolidation() {
    const kb = self.cobraKB || self.KB;
    if (!kb) {
      console.warn('[ConsolidationScheduler] KB not available for weekly consolidation');
      return;
    }

    const remoteLib = self._remoteLibraryInstance;
    if (!remoteLib) {
      console.warn('[ConsolidationScheduler] RemoteLibrary not available');
      return;
    }

    // Raccogli workspaces da consolidare
    const workspaces = new Set();
    for (const rule of kb.rules || []) {
      if (rule.workspace_id) {
        workspaces.add(rule.workspace_id);
      }
    }

    // Consolida per ogni workspace
    for (const workspaceId of workspaces) {
      try {
        const doc = await remoteLib.consolidateWeekly(workspaceId);
        if (doc) {
          console.log(`[ConsolidationScheduler] Weekly consolidation done for ${workspaceId}: ${doc.id}`);
        }
      } catch (e) {
        console.error(`[ConsolidationScheduler] Weekly consolidation failed for ${workspaceId}:`, e);
      }
    }
  },

  async _dispatchVolumeConsolidation() {
    const kb = self.cobraKB || self.KB;
    if (!kb) return;

    const remoteLib = self._remoteLibraryInstance;
    if (!remoteLib) return;

    // Raccogli workspaces
    const workspaces = new Set();
    for (const rule of kb.rules || []) {
      if (rule.workspace_id) {
        workspaces.add(rule.workspace_id);
      }
    }

    // Check volume per ogni workspace
    for (const workspaceId of workspaces) {
      try {
        const doc = await remoteLib.consolidateByVolume(workspaceId);
        if (doc) {
          console.log(`[ConsolidationScheduler] Volume consolidation done for ${workspaceId}: ${doc.id}`);
        }
      } catch (e) {
        console.error(`[ConsolidationScheduler] Volume consolidation failed for ${workspaceId}:`, e);
      }
    }
  },

  async _dispatchSessionDecay() {
    const kb = self.cobraKB || self.KB;
    if (!kb || !kb.decayColdRules) {
      console.warn('[ConsolidationScheduler] KB.decayColdRules not available');
      return;
    }

    try {
      await kb.decayColdRules();
      console.log('[ConsolidationScheduler] Session decay done');
    } catch (e) {
      console.error('[ConsolidationScheduler] Session decay failed:', e);
    }
  },

  // ══════════════════════════════════════════════════════
  // RUN_MANUAL — esecuzione manuale per comando utente
  // ══════════════════════════════════════════════════════
  async runManual(workspaceId, type) {
    if (!this._initialized) {
      await this.init();
    }

    console.log(`[ConsolidationScheduler] Manual run: ${type} for ${workspaceId}`);

    const remoteLib = self._remoteLibraryInstance;
    if (!remoteLib) throw new Error('RemoteLibrary not available');

    try {
      switch (type) {
        case 'weekly':
          return await remoteLib.consolidateWeekly(workspaceId);

        case 'volume':
          return await remoteLib.consolidateByVolume(workspaceId);

        case 'meta':
          // Meta-consolida dal livello 0
          return await remoteLib.metaConsolidate(workspaceId, 0);

        case 'decay':
          const kb = self.cobraKB || self.KB;
          if (kb && kb.decayColdRules) {
            await kb.decayColdRules();
            return { status: 'done' };
          }
          throw new Error('KB.decayColdRules not available');

        default:
          throw new Error(`Unknown consolidation type: ${type}`);
      }
    } catch (e) {
      console.error(`[ConsolidationScheduler] Manual run failed:`, e);
      throw e;
    }
  },

  // ══════════════════════════════════════════════════════
  // UTILITY
  // ══════════════════════════════════════════════════════
  getStatus() {
    return {
      initialized: this._initialized,
      hasRemoteLibrary: !!self._remoteLibraryInstance,
      hasKB: !!(self.cobraKB || self.KB)
    };
  }
};

// Export per moduli
self.CobraConsolidationScheduler = CobraConsolidationScheduler;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CobraConsolidationScheduler;
}
