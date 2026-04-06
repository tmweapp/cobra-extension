// ============================================================
// COBRA v5.2 — Jobs & Agent Module
// ============================================================
// Extracted job and agent handlers from background.js

// Ensure CobraRouter is available
self.CobraRouter = self.CobraRouter || {};

// Register COBRA type handlers for jobs and agent control
self.CobraRouter.registerTypes({
  'JOBS_LIST': async () => {
    // Use CobraJobs (persistent) if available, fallback to chrome.storage
    if (self.CobraJobs) {
      return { jobs: self.CobraJobs.listJobs() };
    }
    const data = await new Promise(r => chrome.storage.local.get('cobra_jobs', d => r(d)));
    return { jobs: data.cobra_jobs || [] };
  },

  // 4. AGENT_START — Start agent with instruction
  'AGENT_START': async (payload, msg, sender) => {
    try {
      const instruction = payload.instruction || '';
      const mode = payload.mode || 'simple';
      const templateKey = payload.templateKey || null;
      const habits = payload.habits || {};

      // Send initial log message
      const sendLog = (text) => {
        chrome.runtime.sendMessage({ type: 'AGENT_LOG', text }).catch(() => {});
      };
      const sendProgress = (percent) => {
        chrome.runtime.sendMessage({ type: 'AGENT_PROGRESS', percent }).catch(() => {});
      };
      const sendDone = (result) => {
        chrome.runtime.sendMessage({ type: 'AGENT_DONE', result }).catch(() => {});
      };

      sendLog(`🤖 Agent avviato: "${instruction.substring(0, 50)}..."`);

      // If templateKey provided, create a gate session
      if (templateKey) {
        sendLog(`📋 Usando template: ${templateKey}`);
        sendProgress(25);
        const gateSession = await cobraGate.createSession({
          templateKey,
          metadata: { instruction, mode, habits }
        });
        sendProgress(75);
        sendLog(`✓ Sessione gate creata: ${gateSession.id}`);
        sendDone({ ok: true, sessionId: gateSession.id, type: 'gate' });
        return {
          ok: true,
          sessionId: gateSession.id,
          type: 'gate'
        };
      }

      // Otherwise, start direct agent with instruction
      const sessionId = 'agent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        sendLog('❌ Errore: Nessun tab attivo');
        sendDone({ ok: false, error: 'Nessun tab attivo' });
        throw new COBRAError('Nessun tab attivo', 'NO_ACTIVE_TAB');
      }

      sendLog(`📂 Sessione creata: ${sessionId}`);
      sendProgress(30);

      // Store active agent session
      const sessions = await new Promise(r => chrome.storage.local.get('cobra_agent_sessions', d => r(d.cobra_agent_sessions || {})));
      sessions[sessionId] = {
        id: sessionId,
        instruction,
        mode,
        habits,
        created: Date.now(),
        tabId: tab.id,
        status: 'running'
      };
      await new Promise(r => chrome.storage.local.set({ cobra_agent_sessions: sessions }, r));

      sendProgress(60);
      sendLog(`⚙️ Istruzione: ${instruction}`);

      // Execute agent instruction using AI if available
      sendProgress(80);
      let result = {
        ok: true,
        sessionId,
        type: 'agent',
        instruction,
        status: 'completed',
        timestamp: new Date().toISOString()
      };

      // Try to use AI to process the instruction
      try {
        if (typeof self.callDirectAI === 'function') {
          // Prepare AI request
          const aiMessage = [{ role: 'user', content: instruction }];
          const systemPrompt = `Sei COBRA, un agente AI nel browser dell'utente.
Esegui l'istruzione fornita. Se richiede azioni sul browser, descrivi quali azioni eseguire.
Rispondi in italiano, conciso e preciso.`;

          // Try with available keys
          const settings = await new Promise(r => chrome.storage.local.get('cobra_settings', d => r(d.cobra_settings || {})));
          let aiResponse = null;

          if (settings.openaiKey) {
            aiResponse = await self.callDirectAI('openai', settings.openaiKey, 'gpt-4o-mini', systemPrompt, aiMessage);
          } else if (settings.anthropicKey) {
            aiResponse = await self.callDirectAI('anthropic', settings.anthropicKey, 'claude-3-5-sonnet-20241022', systemPrompt, aiMessage);
          } else if (settings.groqKey) {
            aiResponse = await self.callDirectAI('groq', settings.groqKey, 'llama-3.3-70b-versatile', systemPrompt, aiMessage);
          }

          if (aiResponse) {
            result.aiResponse = aiResponse;
            sendLog(`✓ Risposta AI: ${aiResponse.substring(0, 100)}...`);
          }
        }
      } catch (aiErr) {
        console.log('[Agent] AI processing failed:', aiErr.message);
        sendLog(`ℹ️ AI non disponibile: ${aiErr.message}`);
      }

      sendProgress(100);
      sendLog(`✓ Agent completato con successo!`);
      sendDone(result);

      return result;
    } catch (err) {
      // Send error to sidepanel
      chrome.runtime.sendMessage({
        type: 'AGENT_LOG',
        text: `❌ Errore agent: ${err.message}`
      }).catch(() => {});
      throw new COBRAError(`Agent start fallito: ${err.message}`, 'AGENT_START_FAILED');
    }
  },

  // 5. JOB_PAUSE — Pause a job (delegates to CobraJobs if available)
  'JOB_PAUSE': async (payload) => {
    if (self.CobraJobs) {
      const r = await self.CobraJobs.pause(payload.runId || payload.jobId);
      return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message };
    }
    try {
      const jobId = payload.jobId;
      if (!jobId) return { ok: false, error: 'jobId mancante' };
      const data = await new Promise(r => chrome.storage.local.get('cobra_jobs', d => r(d)));
      const jobs = data.cobra_jobs || [];
      const job = jobs.find(j => j.id === jobId);
      if (!job) return { ok: false, error: 'Job non trovato' };
      job.status = 'paused';
      await new Promise(r => chrome.storage.local.set({ cobra_jobs: jobs }, r));
      return { ok: true, job };
    } catch (err) { return { ok: false, error: err.message }; }
  },

  // 6. JOB_RESUME — Resume a job
  'JOB_RESUME': async (payload) => {
    if (self.CobraJobs) {
      const r = await self.CobraJobs.resume(payload.runId || payload.jobId);
      return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message };
    }
    try {
      const jobId = payload.jobId;
      if (!jobId) return { ok: false, error: 'jobId mancante' };
      const data = await new Promise(r => chrome.storage.local.get('cobra_jobs', d => r(d)));
      const jobs = data.cobra_jobs || [];
      const job = jobs.find(j => j.id === jobId);
      if (!job) return { ok: false, error: 'Job non trovato' };
      job.status = 'running';
      await new Promise(r => chrome.storage.local.set({ cobra_jobs: jobs }, r));
      return { ok: true, job };
    } catch (err) { return { ok: false, error: err.message }; }
  },

  // 7. JOB_RETRY — Retry a failed job
  'JOB_RETRY': async (payload) => {
    if (self.CobraJobs) {
      const r = await self.CobraJobs.retry(payload.jobId);
      return r.success ? { ok: true, ...r.data } : { ok: false, error: r.message };
    }
    try {
      const jobId = payload.jobId;
      if (!jobId) return { ok: false, error: 'jobId mancante' };
      const data = await new Promise(r => chrome.storage.local.get('cobra_jobs', d => r(d)));
      const jobs = data.cobra_jobs || [];
      const job = jobs.find(j => j.id === jobId);
      if (!job) return { ok: false, error: 'Job non trovato' };
      job.status = 'running';
      job.retries = (job.retries || 0) + 1;
      await new Promise(r => chrome.storage.local.set({ cobra_jobs: jobs }, r));
      return { ok: true, job };
    } catch (err) { return { ok: false, error: err.message }; }
  },

  // 8. JOB_DETAILS — Get job details
  'JOB_DETAILS': async (payload) => {
    if (self.CobraJobs) {
      const job = self.CobraJobs.getJob(payload.jobId);
      return job ? { ok: true, job } : { ok: false, error: 'Job non trovato' };
    }
    try {
      const jobId = payload.jobId;
      if (!jobId) return { ok: false, error: 'jobId mancante' };
      const data = await new Promise(r => chrome.storage.local.get('cobra_jobs', d => r(d)));
      const jobs = data.cobra_jobs || [];
      const job = jobs.find(j => j.id === jobId);
      if (!job) return { ok: false, error: 'Job non trovato' };
      return { ok: true, job };
    } catch (err) { return { ok: false, error: err.message }; }
  },
});

// Register action handlers for agent and task operations
self.CobraRouter.registerActions({
  'agent-action': handleAgentAction,
  'agent-sequence': handleAgentSequence,
  'agent-snapshot': handleAgentSnapshot,
  'task-create': handleTaskCreate,
  'task-start': handleTaskStart,
  'task-pause': handleTaskPause,
  'task-cancel': handleTaskCancel,
  'task-retry': handleTaskRetry,
  'task-status': handleTaskStatus,
  'task-list': handleTaskList,
  'task-stats': handleTaskStats,
});

// ============================================================
// Agent Action Handlers
// ============================================================

async function handleAgentAction(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');
  const result = await Agent.executeAction(tab.id, msg.step);
  relayLog({ type: 'agent-action', step: msg.step, result });
  return result;
}

async function handleAgentSequence(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');
  if (!Array.isArray(msg.steps) || msg.steps.length > 50) {
    throw new COBRAError('Steps non valido (max 50)', 'INVALID_STEPS');
  }
  const result = await Agent.executeSequence(tab.id, msg.steps);
  relayLog({ type: 'agent-sequence', stepsCount: msg.steps.length, result: { ok: result.ok, totalSteps: result.totalSteps } });
  return result;
}

async function handleAgentSnapshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new COBRAError('Nessun tab attivo', 'NO_TAB');
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: Agent.snapshotScript() });
  return results?.[0]?.result || { ok: false, error: 'Nessun risultato' };
}

// ============================================================
// Task Runner Handlers
// ============================================================

async function handleTaskCreate(msg) {
  if (!msg.task || typeof msg.task !== 'object') throw new COBRAError('Task definition mancante', 'INVALID_TASK');
  return await TaskRunner.create(msg.task);
}

async function handleTaskStart(msg) {
  if (!msg.taskId) throw new COBRAError('taskId mancante', 'MISSING_ID');
  return await TaskRunner.start(msg.taskId);
}

async function handleTaskPause(msg) {
  if (!msg.taskId) throw new COBRAError('taskId mancante', 'MISSING_ID');
  return await TaskRunner.pause(msg.taskId);
}

async function handleTaskCancel(msg) {
  if (!msg.taskId) throw new COBRAError('taskId mancante', 'MISSING_ID');
  return await TaskRunner.cancel(msg.taskId);
}

async function handleTaskRetry(msg) {
  if (!msg.taskId) throw new COBRAError('taskId mancante', 'MISSING_ID');
  return await TaskRunner.retry(msg.taskId);
}

async function handleTaskStatus(msg) {
  if (!msg.taskId) throw new COBRAError('taskId mancante', 'MISSING_ID');
  return await TaskRunner.getStatus(msg.taskId);
}

async function handleTaskList(msg) {
  return await TaskRunner.list(msg.filter || {});
}

async function handleTaskStats() {
  return await TaskRunner.getStats();
}
