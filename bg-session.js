/**
 * COBRA v5.2 — Session & Library Handlers
 * Message handlers for SESSION_* and REMOTE_* actions
 */

CobraRouter.registerActions({
  // ── Session Diary ──
  'SESSION_START': async (msg) => {
    if (!self.cobraSessionDiary) return { error: 'SessionDiary not initialized' };
    try {
      const workspaceId = msg.workspaceId || 'generic';
      const result = await self.cobraSessionDiary.start(workspaceId);
      return { ok: true, ...result };
    } catch (e) {
      return { error: e.message };
    }
  },

  'SESSION_END': async (msg) => {
    if (!self.cobraSessionDiary) return { error: 'SessionDiary not initialized' };
    try {
      const sessionId = msg.sessionId;
      if (!sessionId) return { error: 'sessionId required' };
      const session = await self.cobraSessionDiary.closeSession(sessionId);
      return { ok: true, session };
    } catch (e) {
      return { error: e.message };
    }
  },

  'SESSION_APPEND_EVENT': async (msg) => {
    if (!self.cobraSessionDiary) return { error: 'SessionDiary not initialized' };
    try {
      const sessionId = msg.sessionId;
      const event = msg.event;
      if (!sessionId || !event) return { error: 'sessionId and event required' };
      const eventRecord = await self.cobraSessionDiary.appendEvent(sessionId, event);
      return { ok: true, event: eventRecord };
    } catch (e) {
      return { error: e.message };
    }
  },

  'SESSION_GET_BRIEFING': async (msg) => {
    if (!self.cobraSessionDiary) return { error: 'SessionDiary not initialized' };
    try {
      const sessionId = msg.sessionId;
      if (!sessionId) return { error: 'sessionId required' };
      const session = await self.cobraSessionDiary.getSession(sessionId);
      if (!session) return { error: 'Session not found' };
      return { ok: true, briefing: session.briefing };
    } catch (e) {
      return { error: e.message };
    }
  },

  'SESSION_CONSOLIDATE': async (msg) => {
    if (!self.cobraSessionDiary) return { error: 'SessionDiary not initialized' };
    try {
      const sessionId = msg.sessionId;
      if (!sessionId) return { error: 'sessionId required' };
      const consolidation = await self.cobraSessionDiary.consolidate(sessionId);
      return { ok: true, consolidation };
    } catch (e) {
      return { error: e.message };
    }
  },

  'SESSION_LIST': async (msg) => {
    if (!self.cobraSessionDiary) return { error: 'SessionDiary not initialized' };
    try {
      const workspaceId = msg.workspaceId || 'generic';
      const limit = msg.limit || 20;
      const offset = msg.offset || 0;
      const sessions = await self.cobraSessionDiary.listSessions(workspaceId, { limit, offset });
      return { ok: true, sessions, count: sessions.length };
    } catch (e) {
      return { error: e.message };
    }
  },

  // ── Remote Library ──
  'REMOTE_SEARCH': async (msg) => {
    if (!self._remoteLibraryInstance) return { error: 'RemoteLibrary not initialized' };
    try {
      const query = msg.query;
      const workspaceId = msg.workspaceId;
      const limit = msg.limit || 10;
      if (!query) return { error: 'query required' };
      const results = await self._remoteLibraryInstance.searchByIndex(query, workspaceId, { limit });
      return { ok: true, results, count: results.length };
    } catch (e) {
      return { error: e.message };
    }
  },

  'REMOTE_DEEP_READ': async (msg) => {
    if (!self._remoteLibraryInstance) return { error: 'RemoteLibrary not initialized' };
    try {
      const docIds = msg.docIds;
      if (!Array.isArray(docIds) || docIds.length === 0) return { error: 'docIds array required' };
      const docs = await self._remoteLibraryInstance.deepRead(docIds);
      return { ok: true, docs, count: docs.length };
    } catch (e) {
      return { error: e.message };
    }
  },

  'REMOTE_CONSOLIDATE': async (msg) => {
    if (!self.CobraConsolidationScheduler) return { error: 'ConsolidationScheduler not initialized' };
    try {
      const workspaceId = msg.workspaceId;
      const type = msg.type; // weekly, volume, meta, decay
      if (!workspaceId || !type) return { error: 'workspaceId and type required' };
      const result = await self.CobraConsolidationScheduler.runManual(workspaceId, type);
      return { ok: true, result };
    } catch (e) {
      return { error: e.message };
    }
  },

  'REMOTE_STATS': async (msg) => {
    if (!self._remoteLibraryInstance) return { error: 'RemoteLibrary not initialized' };
    try {
      const stats = await self._remoteLibraryInstance.getStats();
      return { ok: true, stats };
    } catch (e) {
      return { error: e.message };
    }
  },
});

console.log('[COBRA] Session & Library handlers registered');
