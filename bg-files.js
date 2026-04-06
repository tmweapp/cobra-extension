// ============================================================
// COBRA v5.2 — Files, Connectors, Pipeline, ElevenLabs, Brain Module
// ============================================================
// Extracted handlers for file, connector, pipeline, ElevenLabs, brain,
// library, and cache/rate limiting operations

// Ensure CobraRouter is available
self.CobraRouter = self.CobraRouter || {};

// Register action handlers on CobraRouter
self.CobraRouter.registerActions({
  'file-download': handleFileDownload,
  'file-list': handleFileList,
  'file-search': handleFileSearch,
  'file-redownload': handleFileRedownload,
  'file-stats': handleFileStats,
  'connector-list': handleConnectorList,
  'connector-configure': handleConnectorConfigure,
  'connector-execute': handleConnectorExecute,
  'connector-test': handleConnectorTest,
  'pipeline-save': handlePipelineSave,
  'pipeline-load': handlePipelineLoad,
  'pipeline-list': handlePipelineList,
  'pipeline-execute': handlePipelineExecute,
  'pipeline-delete': handlePipelineDelete,
  'pipeline-templates': handlePipelineTemplates,
  'pipeline-stats': handlePipelineStats,
  'el-config-get': handleElConfigGet,
  'el-config-set': handleElConfigSet,
  'el-voices': handleElVoices,
  'el-voice-search': handleElVoiceSearch,
  'el-voices-by-lang': handleElVoicesByLang,
  'el-voice-preview': handleElVoicePreview,
  'el-models': handleElModels,
  'el-speak': handleElSpeak,
  'el-speak-page': handleElSpeakPage,
  'el-transcribe': handleElTranscribe,
  'el-agents-list': handleElAgentsList,
  'el-agent-create': handleElAgentCreate,
  'el-agent-update': handleElAgentUpdate,
  'el-agent-delete': handleElAgentDelete,
  'el-agent-local-list': handleElAgentLocalList,
  'el-agent-local-save': handleElAgentLocalSave,
  'el-agent-local-remove': handleElAgentLocalRemove,
  'el-stats': handleElStats,
  'el-history': handleElHistory,
  'el-languages': handleElLanguages,
  'brain-analyze': handleBrainAnalyze,
  'brain-think': handleBrainThink,
  'brain-stats': handleBrainStats,
  'brain-config': handleBrainConfig,
  'brain-get-config': handleBrainGetConfig,
  'library-search': handleLibrarySearch,
  'library-export': handleLibraryExport,
  'library-clear': handleLibraryClear,
  'cache-stats': handleCacheStats,
  'rate-stats': handleRateStats,
  'cache-clear': handleCacheClear,
  'cache-cleanup': handleCacheCleanup,
});

// ============================================================
// 13. FILE MANAGER
// ============================================================

async function handleFileDownload(msg) {
  await FileManager.init();
  if (!msg.data) throw new COBRAError('Dati mancanti', 'MISSING_DATA');
  const format = msg.format || 'json';
  const filename = msg.filename || `export-${Date.now()}.${format}`;
  return await FileManager.downloadData(msg.data, filename, format, msg.options || {});
}

async function handleFileList(msg) {
  await FileManager.init();
  return await FileManager.list(msg.filter || {});
}

async function handleFileSearch(msg) {
  await FileManager.init();
  return await FileManager.search(msg.query || '');
}

async function handleFileRedownload(msg) {
  await FileManager.init();
  if (!msg.fileId) throw new COBRAError('fileId mancante', 'MISSING_ID');
  return await FileManager.redownload(msg.fileId);
}

async function handleFileStats() {
  await FileManager.init();
  return await FileManager.getStats();
}

// ============================================================
// 14. CONNECTORS
// ============================================================

async function handleConnectorList() {
  await Connectors.init();
  return Connectors.list();
}

async function handleConnectorConfigure(msg) {
  await Connectors.init();
  if (!msg.connectorId || !msg.config) throw new COBRAError('connectorId e config richiesti', 'INVALID_PARAMS');
  return await Connectors.configure(msg.connectorId, msg.config);
}

async function handleConnectorExecute(msg) {
  await Connectors.init();
  if (!msg.connectorId || !msg.method) throw new COBRAError('connectorId e method richiesti', 'INVALID_PARAMS');
  return await Connectors.execute(msg.connectorId, msg.method, msg.params || {});
}

async function handleConnectorTest(msg) {
  await Connectors.init();
  if (!msg.connectorId) throw new COBRAError('connectorId richiesto', 'INVALID_PARAMS');
  return await Connectors.test(msg.connectorId);
}

// ============================================================
// 15. PIPELINE
// ============================================================

async function handlePipelineSave(msg) {
  if (!msg.pipeline) throw new COBRAError('Pipeline definition mancante', 'INVALID_PIPELINE');
  return await Pipeline.save(msg.pipeline);
}

async function handlePipelineLoad(msg) {
  if (!msg.pipelineId) throw new COBRAError('pipelineId mancante', 'MISSING_ID');
  return await Pipeline.load(msg.pipelineId);
}

async function handlePipelineList() {
  return await Pipeline.list();
}

async function handlePipelineExecute(msg) {
  if (!msg.pipelineId) throw new COBRAError('pipelineId mancante', 'MISSING_ID');
  return await Pipeline.execute(msg.pipelineId, msg.variables || {});
}

async function handlePipelineDelete(msg) {
  if (!msg.pipelineId) throw new COBRAError('pipelineId mancante', 'MISSING_ID');
  return await Pipeline.remove(msg.pipelineId);
}

async function handlePipelineTemplates() {
  return Pipeline.templates;
}

async function handlePipelineStats() {
  return await Pipeline.getStats();
}

// ============================================================
// 16. ELEVENLABS
// ============================================================

async function handleElConfigGet() {
  await ElevenLabs.init();
  return ElevenLabs.getConfig();
}

async function handleElConfigSet(msg) {
  await ElevenLabs.init();
  return await ElevenLabs.setConfig(msg.config || {});
}

async function handleElVoices(msg) {
  await ElevenLabs.init();
  return { voices: await ElevenLabs.listVoices(!!msg.refresh) };
}

async function handleElVoiceSearch(msg) {
  await ElevenLabs.init();
  return { voices: await ElevenLabs.searchVoices(msg.query || '') };
}

async function handleElVoicesByLang(msg) {
  await ElevenLabs.init();
  return { voices: await ElevenLabs.getVoicesByLanguage(msg.language || 'it') };
}

async function handleElVoicePreview(msg) {
  await ElevenLabs.init();
  if (!msg.voiceId) throw new COBRAError('voiceId mancante', 'MISSING_ID');
  return await ElevenLabs.previewVoice(msg.voiceId);
}

async function handleElModels() {
  await ElevenLabs.init();
  return await ElevenLabs.listModels();
}

async function handleElSpeak(msg) {
  await ElevenLabs.init();
  if (!msg.text) throw new COBRAError('Testo mancante', 'MISSING_TEXT');
  const result = await ElevenLabs.speak(msg.text, msg.options || {});
  // Converti blob in base64 per transport via messaging
  const reader = new FileReader();
  const base64 = await new Promise((resolve) => {
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(result.blob);
  });
  return { ...result, audioBase64: base64, blob: undefined };
}

async function handleElSpeakPage(msg) {
  await ElevenLabs.init();
  const result = await ElevenLabs.speakPageSummary(msg.options || {});
  const reader = new FileReader();
  const base64 = await new Promise((resolve) => {
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(result.blob);
  });
  return { ...result, audioBase64: base64, blob: undefined };
}

async function handleElTranscribe(msg) {
  await ElevenLabs.init();
  if (!msg.audioBase64) throw new COBRAError('Audio data mancante', 'MISSING_AUDIO');
  const resp = await fetch(msg.audioBase64);
  const blob = await resp.blob();
  return await ElevenLabs.transcribe(blob, msg.options || {});
}

async function handleElAgentsList() {
  await ElevenLabs.init();
  return await ElevenLabs.listAgentsAPI();
}

async function handleElAgentCreate(msg) {
  await ElevenLabs.init();
  if (!msg.agent) throw new COBRAError('Agent config mancante', 'INVALID_PARAMS');
  return await ElevenLabs.createAgent(msg.agent);
}

async function handleElAgentUpdate(msg) {
  await ElevenLabs.init();
  if (!msg.agentId) throw new COBRAError('agentId mancante', 'MISSING_ID');
  return await ElevenLabs.updateAgent(msg.agentId, msg.updates || {});
}

async function handleElAgentDelete(msg) {
  await ElevenLabs.init();
  if (!msg.agentId) throw new COBRAError('agentId mancante', 'MISSING_ID');
  return await ElevenLabs.deleteAgent(msg.agentId);
}

async function handleElAgentLocalList() {
  await ElevenLabs.init();
  return { agents: ElevenLabs.getLocalAgents() };
}

async function handleElAgentLocalSave(msg) {
  await ElevenLabs.init();
  if (!msg.agent) throw new COBRAError('Agent data mancante', 'INVALID_PARAMS');
  return await ElevenLabs.saveLocalAgent(msg.agent);
}

async function handleElAgentLocalRemove(msg) {
  await ElevenLabs.init();
  if (!msg.agentId) throw new COBRAError('agentId mancante', 'MISSING_ID');
  return await ElevenLabs.removeLocalAgent(msg.agentId);
}

async function handleElStats() {
  await ElevenLabs.init();
  return await ElevenLabs.getStats();
}

async function handleElHistory(msg) {
  await ElevenLabs.init();
  return await ElevenLabs.getHistory(msg.pageSize || 100);
}

async function handleElLanguages() {
  await ElevenLabs.init();
  return { languages: ElevenLabs.getSupportedLanguages() };
}

// ============================================================
// 9. BRAIN — Page Analysis & Thinking
// ============================================================

async function handleBrainAnalyze() {
  await Brain.init();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');

  let scrapeData = null, snapshotData = null;
  try { scrapeData = await scrapeTab(tab.id); } catch {}
  try {
    const snapResult = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: Agent.snapshotScript() });
    snapshotData = snapResult?.[0]?.result;
  } catch {}

  const result = await Brain.analyzePage(scrapeData, snapshotData);

  if (scrapeData && !result._fromLibrary) {
    let domain = 'unknown';
    try { domain = new URL(tab.url).hostname; } catch {}
    await Library.add({
      domain,
      url: tab.url,
      category: result.category || 'analysis',
      tags: [...(result.tags || []), 'auto-scrape'],
      data: { analysis: result, scrape_summary: scrapeData?.metadata },
      confidence: result.confidence || 50,
    });
  }

  return result;
}

async function handleBrainThink(msg) {
  await Brain.init();
  if (!msg.prompt || typeof msg.prompt !== 'string') {
    throw new COBRAError('Prompt mancante', 'INVALID_PROMPT');
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const context = { url: tab?.url };
  try { context.domain = new URL(tab.url).hostname; } catch {}
  return await Brain.think(msg.prompt, context);
}

async function handleBrainStats() {
  await Brain.init();
  return await Brain.getStats();
}

async function handleBrainConfig(msg) {
  await Brain.init();
  if (!msg.config || typeof msg.config !== 'object') {
    throw new COBRAError('Config non valida', 'INVALID_CONFIG');
  }
  await Brain.updateConfig(msg.config);
  return { ok: true };
}

async function handleBrainGetConfig() {
  await Brain.init();
  // NON restituire le chiavi in chiaro, solo mascherato
  const safe = { ...Brain.config };
  if (safe.claudeApiKey) safe.claudeApiKey = safe.claudeApiKey.slice(0, 10) + '...' + safe.claudeApiKey.slice(-4);
  if (safe.supabaseKey) safe.supabaseKey = safe.supabaseKey.slice(0, 10) + '...' + safe.supabaseKey.slice(-4);
  return safe;
}

// ============================================================
// 10. LIBRARY
// ============================================================

async function handleLibrarySearch(msg) {
  const q = (msg.query || '').trim();
  if (!q) return await Library.search({ limit: 20 });
  if (q.includes('.')) {
    return await Library.search({ domain: q, limit: 20 });
  }
  const byTag = await Library.search({ tag: q, limit: 20 });
  if (byTag.length > 0) return byTag;
  return await Library.search({ text: q, limit: 20 });
}

async function handleLibraryExport() {
  return await Library.exportAll();
}

async function handleLibraryClear() {
  return await Library.clear();
}

// ============================================================
// 11. STATS & MANAGEMENT (Cache & Rate Limiter)
// ============================================================

async function handleCacheStats() {
  return await Cache.getStats();
}

async function handleRateStats() {
  return RateLimiter.getStats();
}

async function handleCacheClear() {
  return await Cache.clear();
}

async function handleCacheCleanup() {
  return await Cache.cleanup();
}
