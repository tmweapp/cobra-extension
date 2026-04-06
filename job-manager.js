// COBRA v3.4 — Job Manager
// Gestione lavori persistenti con pause/resume/retry
// Ispirato a WCA Network Navigator acquisition pipeline

// ============================================================
// JOB STATES
// ============================================================
// pending → running → completed
//                  → paused → running (resume)
//                  → failed → pending (retry)
//                  → cancelled

class JobManager {
  constructor() {
    this.jobs = new Map();
    this.activeJobId = null;
    this.listeners = new Set();
    this._loaded = false;
  }

  // ============================================================
  // PERSISTENCE — chrome.storage.local
  // ============================================================
  async load() {
    return new Promise(resolve => {
      chrome.storage.local.get('cobra_jobs', data => {
        const saved = data.cobra_jobs || [];
        saved.forEach(j => this.jobs.set(j.id, j));
        this._loaded = true;
        resolve(saved);
      });
    });
  }

  async save() {
    const arr = Array.from(this.jobs.values());
    return new Promise(resolve => {
      chrome.storage.local.set({ cobra_jobs: arr }, resolve);
    });
  }

  // ============================================================
  // CREATE JOB
  // ============================================================
  async createJob({
    title,
    type,           // "scrape" | "crawl" | "agent" | "pipeline" | "batch" | "search"
    instruction,    // Istruzione originale dell'utente
    items = [],     // Array di work items [{id, url, data, status: "pending"}]
    config = {},    // Configurazione specifica per tipo
    parentJobId = null,  // Per sub-job in pipeline
  }) {
    const job = {
      id: crypto.randomUUID(),
      title,
      type,
      instruction,
      status: 'pending',     // pending | running | paused | completed | failed | cancelled
      items: items.map((item, i) => ({
        id: item.id || crypto.randomUUID(),
        index: i,
        url: item.url || null,
        data: item.data || null,
        status: 'pending',   // pending | running | completed | failed | skipped
        result: null,
        error: null,
        attempts: 0,
        maxAttempts: 3,
        startedAt: null,
        completedAt: null,
      })),
      config: {
        delayMs: 2000,
        maxConcurrent: 1,
        retryOnFail: true,
        savePartialResults: true,
        notifyOnComplete: true,
        ...config,
      },
      parentJobId,

      // Progress tracking
      totalCount: items.length,
      processedCount: 0,
      successCount: 0,
      failCount: 0,
      skipCount: 0,
      currentIndex: 0,

      // Timing
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      updatedAt: new Date().toISOString(),
      lastHeartbeat: null,

      // Results
      results: [],
      logs: [],
      errorMessage: null,

      // Learning context
      habitContext: null,  // Sarà popolato dal HabitTracker
    };

    this.jobs.set(job.id, job);
    await this.save();
    this.emit('job:created', job);
    return job;
  }

  // ============================================================
  // RUN JOB — Core execution loop
  // ============================================================
  async runJob(jobId, executeFn) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status === 'running') throw new Error('Job already running');

    job.status = 'running';
    job.startedAt = job.startedAt || new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    this.activeJobId = jobId;
    this.emit('job:started', job);

    // Heartbeat per keep-alive (ogni 30s)
    const heartbeat = setInterval(() => {
      job.lastHeartbeat = new Date().toISOString();
      job.updatedAt = new Date().toISOString();
      this.save();
    }, 30000);

    try {
      // Riprendi dall'ultimo item non completato
      const startFrom = job.items.findIndex(
        item => item.status === 'pending' || item.status === 'failed'
      );

      if (startFrom === -1) {
        // Tutti gli item sono già completati
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        this.emit('job:completed', job);
        return job;
      }

      for (let i = startFrom; i < job.items.length; i++) {
        const item = job.items[i];

        // Check pausa/cancellazione
        if (job.status === 'paused') {
          this.log(job, `⏸ Job in pausa all'item ${i + 1}/${job.totalCount}`);
          break;
        }
        if (job.status === 'cancelled') {
          this.log(job, `❌ Job cancellato all'item ${i + 1}/${job.totalCount}`);
          break;
        }

        // Skip item già completati
        if (item.status === 'completed' || item.status === 'skipped') {
          continue;
        }

        // Skip se max tentativi raggiunto e retry disabilitato
        if (item.attempts >= item.maxAttempts && !job.config.retryOnFail) {
          item.status = 'skipped';
          job.skipCount++;
          continue;
        }

        // Esegui item
        item.status = 'running';
        item.startedAt = new Date().toISOString();
        item.attempts++;
        job.currentIndex = i;
        this.emit('job:progress', job, item);

        try {
          const result = await executeFn(item, job, i);
          item.status = 'completed';
          item.result = result;
          item.completedAt = new Date().toISOString();
          job.successCount++;
          job.results.push({ itemId: item.id, index: i, result });
          this.log(job, `✅ Item ${i + 1}/${job.totalCount}: OK`);
        } catch (err) {
          item.status = 'failed';
          item.error = err.message || String(err);
          job.failCount++;
          this.log(job, `❌ Item ${i + 1}/${job.totalCount}: ${item.error}`);

          // Retry logic: use a separate retry counter, don't modify loop index
          if (item.attempts < item.maxAttempts && job.config.retryOnFail) {
            item.status = 'pending'; // Sarà riprovato
            job.failCount = Math.max(0, job.failCount - 1); // Non contare come fallimento definitivo, ensure never negative
            // Schedule retry for this item on the next loop iteration
            // Delay extra per retry
            await this._delay(job.config.delayMs * 2);
            // Continue to next item; this one will be retried later when loop finds it pending
            continue;
          }
        }

        job.processedCount = job.items.filter(
          it => ['completed', 'failed', 'skipped'].includes(it.status)
        ).length;

        // Salva progresso parziale
        if (job.config.savePartialResults) {
          job.updatedAt = new Date().toISOString();
          await this.save();
        }

        // Rate limiting delay
        if (i < job.items.length - 1) {
          await this._delay(job.config.delayMs);
        }
      }

      // Determina stato finale
      const pendingItems = job.items.filter(it => it.status === 'pending');
      if (pendingItems.length === 0 && job.status === 'running') {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        this.log(job, `🎉 Job completato! ${job.successCount} OK, ${job.failCount} errori, ${job.skipCount} saltati`);
        this.emit('job:completed', job);
      }

    } catch (err) {
      job.status = 'failed';
      job.errorMessage = err.message || String(err);
      this.log(job, `💥 Job fallito: ${job.errorMessage}`);
      this.emit('job:failed', job);
    } finally {
      clearInterval(heartbeat);
      this.activeJobId = null;
      job.updatedAt = new Date().toISOString();
      await this.save();
    }

    return job;
  }

  // ============================================================
  // PAUSE / RESUME / CANCEL / RETRY
  // ============================================================
  async pauseJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') return;
    job.status = 'paused';
    job.updatedAt = new Date().toISOString();
    await this.save();
    this.emit('job:paused', job);
  }

  async resumeJob(jobId, executeFn) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') return;

    // Reset failed items to pending
    job.items.forEach(item => {
      if (item.status === 'failed' && item.attempts < item.maxAttempts) {
        item.status = 'pending';
      }
    });

    await this.save();
    return this.runJob(jobId, executeFn);
  }

  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'cancelled';
    job.items.forEach(item => {
      if (item.status === 'pending' || item.status === 'running') {
        item.status = 'skipped';
      }
    });
    job.updatedAt = new Date().toISOString();
    await this.save();
    this.emit('job:cancelled', job);
  }

  async retryJob(jobId, executeFn) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Reset failed/skipped items
    job.items.forEach(item => {
      if (['failed', 'skipped'].includes(item.status)) {
        item.status = 'pending';
        item.error = null;
        item.attempts = 0;
      }
    });
    job.status = 'pending';
    job.failCount = 0;
    job.skipCount = 0;
    job.errorMessage = null;

    await this.save();
    return this.runJob(jobId, executeFn);
  }

  // ============================================================
  // STALE JOB DETECTION — Auto-kill job bloccati
  // ============================================================
  async cleanupStaleJobs(maxAgeMs = 120000) {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running') continue;
      const lastUpdate = new Date(job.updatedAt || job.createdAt).getTime();
      if (now - lastUpdate > maxAgeMs) {
        job.status = 'failed';
        job.errorMessage = 'Job bloccato (nessun heartbeat per 2+ minuti)';
        this.log(job, '⚠️ Job auto-terminato: nessun heartbeat');
        this.emit('job:stale', job);
      }
    }
    await this.save();
  }

  // ============================================================
  // QUERY JOBS
  // ============================================================
  getJob(id) { return this.jobs.get(id); }

  getAllJobs() {
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getActiveJobs() {
    return this.getAllJobs().filter(j => ['running', 'paused', 'pending'].includes(j.status));
  }

  getCompletedJobs() {
    return this.getAllJobs().filter(j => ['completed', 'failed', 'cancelled'].includes(j.status));
  }

  getJobProgress(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      percent: job.totalCount ? Math.round((job.processedCount / job.totalCount) * 100) : 0,
      processed: job.processedCount,
      total: job.totalCount,
      success: job.successCount,
      failed: job.failCount,
      skipped: job.skipCount,
      status: job.status,
      eta: this._estimateETA(job),
    };
  }

  // ============================================================
  // DELETE / CLEANUP
  // ============================================================
  async deleteJob(jobId) {
    this.jobs.delete(jobId);
    await this.save();
    this.emit('job:deleted', { id: jobId });
  }

  async deleteCompletedJobs() {
    for (const [id, job] of this.jobs) {
      if (['completed', 'cancelled'].includes(job.status)) {
        this.jobs.delete(id);
      }
    }
    await this.save();
  }

  // ============================================================
  // LOGGING
  // ============================================================
  log(job, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      message,
    };
    job.logs.push(entry);
    // Limita a 500 log entries
    if (job.logs.length > 500) job.logs = job.logs.slice(-500);
    this.emit('job:log', job, entry);
  }

  // ============================================================
  // EVENT SYSTEM
  // ============================================================
  on(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(event, ...args) {
    for (const cb of this.listeners) {
      try { cb(event, ...args); } catch {}
    }
  }

  // ============================================================
  // INTERNAL
  // ============================================================
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _estimateETA(job) {
    if (!job.processedCount || job.status !== 'running') return null;
    const elapsed = Date.now() - new Date(job.startedAt).getTime();
    const avgPerItem = elapsed / job.processedCount;
    const remaining = job.totalCount - job.processedCount;
    const etaMs = remaining * avgPerItem;
    const etaMin = Math.ceil(etaMs / 60000);
    return etaMin;
  }
}

// ============================================================
// PIPELINE ORCHESTRATOR — Multi-step workflow
// ============================================================
class PipelineOrchestrator {
  constructor(jobManager) {
    this.jm = jobManager;
    this.pipelines = new Map();
  }

  async load() {
    return new Promise(resolve => {
      chrome.storage.local.get('cobra_pipelines', data => {
        const saved = data.cobra_pipelines || [];
        saved.forEach(p => this.pipelines.set(p.id, p));
        resolve(saved);
      });
    });
  }

  async save() {
    const arr = Array.from(this.pipelines.values());
    return new Promise(resolve => {
      chrome.storage.local.set({ cobra_pipelines: arr }, resolve);
    });
  }

  // Crea pipeline multi-step
  async createPipeline({
    title,
    steps,  // [{type, config, dependsOn: [stepIndex]}]
  }) {
    const pipeline = {
      id: crypto.randomUUID(),
      title,
      status: 'pending',
      steps: steps.map((step, i) => ({
        index: i,
        type: step.type,     // "scrape" | "filter" | "ai_analyze" | "save" | "notify" | "export"
        config: step.config,
        dependsOn: step.dependsOn || (i > 0 ? [i - 1] : []),
        jobId: null,
        status: 'pending',
        result: null,
      })),
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.pipelines.set(pipeline.id, pipeline);
    await this.save();
    return pipeline;
  }

  // Esegui pipeline step-by-step
  async runPipeline(pipelineId, stepExecutors) {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error('Pipeline not found');

    pipeline.status = 'running';
    await this.save();

    for (const step of pipeline.steps) {
      // Verifica dipendenze
      const depsOk = step.dependsOn.every(
        depIdx => pipeline.steps[depIdx].status === 'completed'
      );
      if (!depsOk) {
        step.status = 'skipped';
        continue;
      }

      // Raccogli risultati delle dipendenze come input
      const inputData = step.dependsOn.map(
        depIdx => pipeline.steps[depIdx].result
      );

      step.status = 'running';
      await this.save();

      try {
        const executor = stepExecutors[step.type];
        if (!executor) throw new Error(`No executor for step type: ${step.type}`);

        step.result = await executor(step.config, inputData, pipeline);
        step.status = 'completed';
      } catch (err) {
        step.status = 'failed';
        step.error = err.message;
        pipeline.status = 'failed';
        await this.save();
        return pipeline;
      }

      await this.save();
    }

    pipeline.status = 'completed';
    pipeline.completedAt = new Date().toISOString();
    await this.save();
    return pipeline;
  }
}

// ============================================================
// AI CONVERSATION ENGINE — Structured response parsing
// ============================================================
class AIConversationEngine {
  constructor(jobManager) {
    this.jm = jobManager;
    this.conversations = new Map();
    this.saveTimer = null;
  }

  async load() {
    return new Promise(resolve => {
      chrome.storage.local.get('cobra_conversations', data => {
        const saved = data.cobra_conversations || [];
        saved.forEach(c => this.conversations.set(c.id, c));
        resolve(saved);
      });
    });
  }

  async save() {
    const arr = Array.from(this.conversations.values());
    return new Promise(resolve => {
      chrome.storage.local.set({ cobra_conversations: arr }, resolve);
    });
  }

  // Debounced save (800ms come WCA)
  debouncedSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 800);
  }

  // Crea o riprendi conversazione
  getOrCreate(contextId) {
    let conv = Array.from(this.conversations.values())
      .find(c => c.contextId === contextId && c.status === 'active');

    if (!conv) {
      conv = {
        id: crypto.randomUUID(),
        contextId,
        title: 'Nuova conversazione',
        messages: [],
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.conversations.set(conv.id, conv);
    }

    return conv;
  }

  addMessage(convId, role, content) {
    const conv = this.conversations.get(convId);
    if (!conv) return;

    const msg = {
      id: crypto.randomUUID(),
      role,     // "user" | "assistant" | "system"
      content,
      timestamp: new Date().toISOString(),
    };

    conv.messages.push(msg);

    // Auto-titolo dal primo messaggio utente
    if (role === 'user' && conv.messages.filter(m => m.role === 'user').length === 1) {
      conv.title = content.slice(0, 60);
    }

    conv.updatedAt = new Date().toISOString();
    this.debouncedSave();
    return msg;
  }

  // Parse risposta AI strutturata (pattern WCA)
  parseAIResponse(content) {
    const DELIMITERS = {
      STRUCTURED: '---STRUCTURED_DATA---',
      JOB_CREATED: '---JOB_CREATED---',
      UI_ACTIONS: '---UI_ACTIONS---',
      OPERATIONS: '---OPERATIONS---',
    };

    let text = content;
    let structuredData = null;
    let jobCreated = null;
    let uiActions = [];
    let operations = [];

    for (const [key, delimiter] of Object.entries(DELIMITERS)) {
      const idx = text.indexOf(delimiter);
      if (idx === -1) continue;

      const afterDelimiter = text.slice(idx + delimiter.length).trim();
      const nextDelimiterIdx = Object.values(DELIMITERS)
        .filter(d => d !== delimiter)
        .map(d => afterDelimiter.indexOf(d))
        .filter(i => i !== -1)
        .sort((a, b) => a - b)[0];

      const payload = nextDelimiterIdx
        ? afterDelimiter.slice(0, nextDelimiterIdx).trim()
        : afterDelimiter.trim();

      try {
        const parsed = JSON.parse(payload);
        switch (key) {
          case 'STRUCTURED': structuredData = parsed; break;
          case 'JOB_CREATED': jobCreated = parsed; break;
          case 'UI_ACTIONS': uiActions = parsed; break;
          case 'OPERATIONS': operations = parsed; break;
        }
      } catch {}

      // Rimuovi delimiter e payload dal testo visibile
      text = text.slice(0, idx).trim();
    }

    return { text, structuredData, jobCreated, uiActions, operations };
  }

  // Esegui azioni UI dalla risposta AI
  dispatchActions(actions) {
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'navigate':
            chrome.tabs.update({ url: action.url });
            break;
          case 'scrape':
            // Trigger scrape
            chrome.runtime.sendMessage({ type: 'SCRAPE_PAGE' });
            break;
          case 'create_job':
            this.jm.createJob(action.jobConfig);
            break;
          case 'open_view':
            // Comunica al sidepanel di cambiare vista
            chrome.runtime.sendMessage({ type: 'SWITCH_VIEW', view: action.view });
            break;
          case 'save_memory':
            chrome.storage.local.get('cobra_memories', data => {
              const memories = data.cobra_memories || [];
              memories.unshift({
                id: crypto.randomUUID(),
                title: action.title,
                data: action.data,
                type: action.memoryType || 'ai',
                tags: action.tags || [],
                timestamp: new Date().toISOString(),
                synced: false,
              });
              chrome.storage.local.set({ cobra_memories: memories.slice(0, 200) });
            });
            break;
        }
      } catch (err) {
        console.error('Action dispatch error:', err);
      }
    }
  }

  // Lista conversazioni
  list() {
    return Array.from(this.conversations.values())
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  delete(convId) {
    this.conversations.delete(convId);
    this.save();
  }
}

// ============================================================
// EXPORT SINGLETON
// ============================================================
const jobManager = new JobManager();
const pipelineOrchestrator = new PipelineOrchestrator(jobManager);
const aiEngine = new AIConversationEngine(jobManager);

// Auto-load
(async () => {
  await jobManager.load();
  await pipelineOrchestrator.load();
  await aiEngine.load();
  // Cleanup stale jobs on startup
  await jobManager.cleanupStaleJobs();
})();
