/**
 * COBRA v5.2 — Persistent Job Engine
 * Full lifecycle: create → run → pause → resume → cancel → retry
 * Jobs survive service worker restarts via IndexedDB persistence.
 *
 * Ported from v10 with fixes:
 *   - No pause race condition (state checked before each step)
 *   - Timeout treated as failure (not success)
 *   - Retry with exponential backoff per-step
 *   - Run history persisted in IDB
 */

const CobraJobs = {
  // In-memory job registry
  _jobs: new Map(),      // jobId → job definition
  _runs: new Map(),      // runId → run state
  _activeRun: null,      // currently executing runId

  // ── Job States ──
  STATE: Object.freeze({
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  }),

  // ── Config ──
  _maxRetries: 3,
  _stepTimeout: 30000,
  _maxRunHistory: 50,

  // ── Init ──
  async init() {
    try {
      if (self.cobraIDB) {
        const jobs = await self.cobraIDB.getAll('jobs');
        for (const job of jobs) {
          this._jobs.set(job.id, job);
        }
        const runs = await self.cobraIDB.getAll('job_runs');
        for (const run of runs) {
          this._runs.set(run.id, run);
        }
        console.log(`[CobraJobs] Loaded ${jobs.length} jobs, ${runs.length} runs from IDB`);

        // Resume any interrupted runs
        for (const run of runs) {
          if (run.state === this.STATE.RUNNING) {
            console.log(`[CobraJobs] Found interrupted run ${run.id}, marking as failed`);
            run.state = this.STATE.FAILED;
            run.error = 'Interrupted by service worker restart';
            run.endedAt = Date.now();
            await this._persistRun(run);
          }
        }
      }
    } catch (e) {
      console.warn('[CobraJobs] Init failed:', e.message);
    }
  },

  // ── Create Job ──
  /**
   * @param {Object} def - { name, steps: [{action, params, description}], schedule? }
   * @returns {Object} Result
   */
  async create(def) {
    const R = self.Result;
    if (!def.name || !def.steps || !Array.isArray(def.steps) || def.steps.length === 0) {
      return R.fail('INVALID_ARGS', 'Job deve avere name e steps[]');
    }

    const job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: def.name,
      steps: def.steps,
      schedule: def.schedule || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
      lastRunId: null,
      lastRunState: null
    };

    this._jobs.set(job.id, job);
    await this._persistJob(job);

    return R.ok({ jobId: job.id, name: job.name, stepsCount: job.steps.length });
  },

  // ── Run Job ──
  async run(jobId) {
    const R = self.Result;
    const job = this._jobs.get(jobId);
    if (!job) return R.fail('JOB_NOT_FOUND', `Job ${jobId} non trovato`);
    if (this._activeRun) return R.fail('JOB_ALREADY_RUNNING', `Run attiva: ${this._activeRun}`);

    const run = {
      id: `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      jobId,
      jobName: job.name,
      state: this.STATE.RUNNING,
      currentStep: 0,
      totalSteps: job.steps.length,
      stepResults: [],
      startedAt: Date.now(),
      endedAt: null,
      error: null,
      retries: 0
    };

    this._runs.set(run.id, run);
    this._activeRun = run.id;
    job.runCount++;
    job.lastRunId = run.id;
    job.lastRunState = this.STATE.RUNNING;
    job.updatedAt = Date.now();

    await this._persistRun(run);
    await this._persistJob(job);

    // Execute steps asynchronously
    this._executeSteps(job, run).catch(e => {
      console.error('[CobraJobs] Execution error:', e.message);
    });

    return R.ok({ runId: run.id, jobId, state: run.state });
  },

  // ── Step Execution Loop ──
  async _executeSteps(job, run) {
    for (let i = run.currentStep; i < job.steps.length; i++) {
      // Check state before each step (pause/cancel detection — v10 fix)
      const freshRun = this._runs.get(run.id);
      if (!freshRun || freshRun.state === this.STATE.CANCELLED) {
        run.state = this.STATE.CANCELLED;
        run.endedAt = Date.now();
        await this._finalizeRun(job, run);
        return;
      }
      if (freshRun.state === this.STATE.PAUSED) {
        run.currentStep = i;
        await this._persistRun(run);
        return; // Will resume later
      }

      run.currentStep = i;
      const step = job.steps[i];
      let stepResult = null;
      let retryCount = 0;
      let success = false;

      // Retry loop with exponential backoff
      while (retryCount <= this._maxRetries && !success) {
        try {
          stepResult = await this._executeStep(step);
          // v10 fix: timeout is failure, not success
          if (stepResult && stepResult.success === false) {
            throw new Error(stepResult.message || 'Step failed');
          }
          success = true;
        } catch (e) {
          retryCount++;
          if (retryCount <= this._maxRetries) {
            const delay = Math.pow(2, retryCount) * 500;
            await new Promise(r => setTimeout(r, delay));
          } else {
            stepResult = self.Result
              ? self.Result.fail('JOB_STEP_FAILED', `Step ${i} fallito dopo ${this._maxRetries} tentativi: ${e.message}`)
              : { success: false, error: e.message };
          }
        }
      }

      run.stepResults.push({
        stepIndex: i,
        description: step.description || step.action,
        result: stepResult,
        retries: retryCount,
        ts: Date.now()
      });

      // If step failed permanently, stop the job
      if (!success) {
        run.state = this.STATE.FAILED;
        run.error = `Step ${i} (${step.description || step.action}) fallito`;
        run.endedAt = Date.now();
        await this._finalizeRun(job, run);
        return;
      }

      await this._persistRun(run);
    }

    // All steps completed
    run.state = this.STATE.COMPLETED;
    run.endedAt = Date.now();
    await this._finalizeRun(job, run);
  },

  async _executeStep(step) {
    // Delegate to tool executor if available
    if (self.executeToolCall) {
      const result = await Promise.race([
        self.executeToolCall(step.action, step.params || {}),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Step timeout')), this._stepTimeout)
        )
      ]);
      // Parse if string
      if (typeof result === 'string') {
        try { return JSON.parse(result); } catch { return { ok: true, raw: result }; }
      }
      return result;
    }
    return { success: false, error: 'executeToolCall not available' };
  },

  async _finalizeRun(job, run) {
    this._activeRun = null;
    job.lastRunState = run.state;
    job.updatedAt = Date.now();
    await this._persistRun(run);
    await this._persistJob(job);

    // Prune old runs
    await this._pruneRuns();
  },

  // ── Pause / Resume / Cancel ──
  async pause(runId) {
    const R = self.Result;
    const run = this._runs.get(runId || this._activeRun);
    if (!run) return R.fail('JOB_NOT_FOUND', 'Run non trovata');
    if (run.state !== this.STATE.RUNNING) return R.fail('INVALID_ARGS', `Run non in esecuzione (state: ${run.state})`);

    run.state = this.STATE.PAUSED;
    await this._persistRun(run);
    return R.ok({ runId: run.id, state: run.state, pausedAtStep: run.currentStep });
  },

  async resume(runId) {
    const R = self.Result;
    const run = this._runs.get(runId);
    if (!run) return R.fail('JOB_NOT_FOUND', 'Run non trovata');
    if (run.state !== this.STATE.PAUSED) return R.fail('INVALID_ARGS', `Run non in pausa (state: ${run.state})`);
    if (this._activeRun) return R.fail('JOB_ALREADY_RUNNING', `Run attiva: ${this._activeRun}`);

    const job = this._jobs.get(run.jobId);
    if (!job) return R.fail('JOB_NOT_FOUND', 'Job definition non trovata');

    run.state = this.STATE.RUNNING;
    this._activeRun = run.id;
    await this._persistRun(run);

    this._executeSteps(job, run).catch(e => {
      console.error('[CobraJobs] Resume execution error:', e.message);
    });

    return R.ok({ runId: run.id, state: run.state, resumedFromStep: run.currentStep });
  },

  async cancel(runId) {
    const R = self.Result;
    const run = this._runs.get(runId || this._activeRun);
    if (!run) return R.fail('JOB_NOT_FOUND', 'Run non trovata');
    if (run.state === this.STATE.COMPLETED || run.state === this.STATE.CANCELLED) {
      return R.fail('INVALID_ARGS', `Run già terminata (state: ${run.state})`);
    }

    run.state = this.STATE.CANCELLED;
    run.endedAt = Date.now();
    if (this._activeRun === run.id) this._activeRun = null;

    const job = this._jobs.get(run.jobId);
    if (job) {
      job.lastRunState = this.STATE.CANCELLED;
      job.updatedAt = Date.now();
      await this._persistJob(job);
    }
    await this._persistRun(run);

    return R.ok({ runId: run.id, state: run.state });
  },

  async retry(jobId) {
    // Simply re-run the job from scratch
    return this.run(jobId);
  },

  // ── Queries ──
  listJobs() {
    return Array.from(this._jobs.values()).map(j => ({
      id: j.id,
      name: j.name,
      stepsCount: j.steps.length,
      runCount: j.runCount,
      lastRunState: j.lastRunState,
      schedule: j.schedule,
      createdAt: j.createdAt
    }));
  },

  getJob(jobId) {
    return this._jobs.get(jobId) || null;
  },

  getRun(runId) {
    return this._runs.get(runId) || null;
  },

  getRunsForJob(jobId) {
    const runs = [];
    for (const run of this._runs.values()) {
      if (run.jobId === jobId) runs.push(run);
    }
    return runs.sort((a, b) => b.startedAt - a.startedAt);
  },

  getActiveRun() {
    return this._activeRun ? this._runs.get(this._activeRun) : null;
  },

  async deleteJob(jobId) {
    const R = self.Result;
    const job = this._jobs.get(jobId);
    if (!job) return R.fail('JOB_NOT_FOUND', 'Job non trovato');

    // Cancel active run if any
    if (this._activeRun) {
      const run = this._runs.get(this._activeRun);
      if (run && run.jobId === jobId) {
        await this.cancel(this._activeRun);
      }
    }

    this._jobs.delete(jobId);
    if (self.cobraIDB) {
      try { await self.cobraIDB.delete('jobs', jobId); } catch {}
    }

    return R.ok({ deleted: jobId });
  },

  // ── Persistence ──
  async _persistJob(job) {
    if (self.cobraIDB) {
      try { await self.cobraIDB.put('jobs', job); } catch (e) {
        console.warn('[CobraJobs] Persist job failed:', e.message);
      }
    }
  },

  async _persistRun(run) {
    if (self.cobraIDB) {
      try { await self.cobraIDB.put('job_runs', run); } catch (e) {
        console.warn('[CobraJobs] Persist run failed:', e.message);
      }
    }
  },

  async _pruneRuns() {
    if (this._runs.size <= this._maxRunHistory) return;
    const sorted = Array.from(this._runs.entries())
      .sort(([, a], [, b]) => b.startedAt - a.startedAt);
    const excess = sorted.slice(this._maxRunHistory);
    for (const [id] of excess) {
      this._runs.delete(id);
      if (self.cobraIDB) {
        try { await self.cobraIDB.delete('job_runs', id); } catch {}
      }
    }
  }
};

self.CobraJobs = CobraJobs;
console.log('[cobra-jobs.js] Loaded: Persistent Job Engine (create/run/pause/resume/cancel)');
