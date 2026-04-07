/**
 * TaskRunner - Orchestrates complex multi-step autonomous tasks
 * Persists state to Supabase (if configured) and local IndexedDB
 * Supports task lifecycle: create, pause, resume, cancel, retry
 */

const TaskRunner = {
  // Configuration
  _tasks: new Map(),
  _dbName: 'COBRATasks',
  _dbVersion: 1,
  _storeName: 'tasks',
  _db: null,
  _maxConcurrent: 3,
  _concurrentCount: 0,
  _alarmName: 'task-runner-tick',
  _tickInterval: 0.1, // minutes = 6 seconds

  /**
   * Initialize IndexedDB for local persistence
   */
  async _getDb() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, this._dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          const store = db.createObjectStore(this._storeName, { keyPath: 'taskId' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  },

  /**
   * Create a new task from a definition
   * taskDef: { name, description, steps: [...], config: {...} }
   */
  async create(taskDef) {
    if (!taskDef.name || !taskDef.steps || !Array.isArray(taskDef.steps)) {
      throw new Error('Invalid task definition: requires name and steps array');
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const task = {
      taskId,
      name: taskDef.name,
      description: taskDef.description || '',
      status: 'created',
      steps: taskDef.steps.map((step, idx) => ({
        index: idx,
        action: step.action,
        params: step.params || {},
        optional: step.optional || false,
        retries: step.retries || 3,
        timeout: step.timeout || 60000, // ms
        status: 'pending',
        result: null,
        error: null,
        retryCount: 0,
        startedAt: null,
        completedAt: null,
      })),
      config: {
        timeout: taskDef.config?.timeout || 30 * 60 * 1000, // 30 min
        onError: taskDef.config?.onError || 'stop', // stop|skip|retry
      },
      createdAt: now,
      startedAt: null,
      completedAt: null,
      currentStepIndex: 0,
      result: null,
      error: null,
    };

    // Save to IndexedDB
    await this._saveToIndexedDb(task);
    // Save to Supabase if configured
    await this._syncToSupabase(task);

    this._tasks.set(taskId, task);
    return taskId;
  },

  /**
   * Start or resume a task
   */
  async start(taskId) {
    let task = this._tasks.get(taskId);

    if (!task) {
      task = await this._loadFromIndexedDb(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      this._tasks.set(taskId, task);
    }

    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new Error(`Cannot start ${task.status} task`);
    }

    task.status = 'running';
    task.startedAt = task.startedAt || new Date().toISOString();
    await this._checkpoint(task);

    // Execute task in background
    this._executeTask(taskId).catch((err) => {
      console.error(`Task ${taskId} error:`, err);
    });
  },

  /**
   * Pause a running task
   */
  async pause(taskId) {
    let task = this._tasks.get(taskId);
    if (!task) task = await this._loadFromIndexedDb(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.status !== 'running') {
      throw new Error(`Cannot pause ${task.status} task`);
    }

    task.status = 'paused';
    await this._checkpoint(task);
  },

  /**
   * Cancel a task
   */
  async cancel(taskId) {
    let task = this._tasks.get(taskId);
    if (!task) task = await this._loadFromIndexedDb(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    await this._checkpoint(task);
    this._tasks.delete(taskId);
  },

  /**
   * Retry a task from its failed step
   */
  async retry(taskId) {
    let task = this._tasks.get(taskId);
    if (!task) task = await this._loadFromIndexedDb(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.status !== 'failed') {
      throw new Error(`Cannot retry non-failed task (status: ${task.status})`);
    }

    // Reset failed step and subsequent steps
    for (let i = task.currentStepIndex; i < task.steps.length; i++) {
      if (task.steps[i].status === 'failed' || task.steps[i].status === 'pending') {
        task.steps[i].status = 'pending';
        task.steps[i].result = null;
        task.steps[i].error = null;
        task.steps[i].retryCount = 0;
      }
    }

    task.status = 'running';
    task.error = null;
    await this._checkpoint(task);
    await this.start(taskId);
  },

  /**
   * Get task status
   */
  async getStatus(taskId) {
    let task = this._tasks.get(taskId);
    if (!task) task = await this._loadFromIndexedDb(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    return {
      taskId: task.taskId,
      name: task.name,
      status: task.status,
      progress: `${task.steps.filter(s => s.status === 'completed').length}/${task.steps.length}`,
      currentStep: task.currentStepIndex,
      steps: task.steps.map(s => ({
        index: s.index,
        action: s.action,
        status: s.status,
        error: s.error,
        retryCount: s.retryCount,
      })),
      error: task.error,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  },

  /**
   * List tasks with optional filter
   */
  async list(filter = {}) {
    const db = await this._getDb();
    const allTasks = await new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readonly');
      const store = tx.objectStore(this._storeName);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    let results = allTasks;
    if (filter.status) {
      results = results.filter(t => t.status === filter.status);
    }
    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results.map(t => ({
      taskId: t.taskId,
      name: t.name,
      status: t.status,
      progress: `${t.steps.filter(s => s.status === 'completed').length}/${t.steps.length}`,
      createdAt: t.createdAt,
    }));
  },

  /**
   * Core task execution loop
   */
  async _executeTask(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return;

    const taskStartTime = Date.now();

    try {
      while (
        task.currentStepIndex < task.steps.length &&
        task.status === 'running'
      ) {
        // Check task-level timeout
        if (Date.now() - taskStartTime > task.config.timeout) {
          throw new Error('Task timeout exceeded');
        }

        // Check concurrency limit
        while (this._concurrentCount >= this._maxConcurrent) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const step = task.steps[task.currentStepIndex];
        if (step.status === 'completed' || step.status === 'skipped') {
          task.currentStepIndex++;
          continue;
        }

        try {
          this._concurrentCount++;
          await this._executeStep(task, task.currentStepIndex);
          step.status = 'completed';
          step.completedAt = new Date().toISOString();
          await this._checkpoint(task);
          task.currentStepIndex++;
        } catch (stepError) {
          step.error = stepError.message;

          if (step.retryCount < step.retries) {
            step.retryCount++;
            // Exponential backoff: 1s, 2s, 4s
            const backoff = Math.pow(2, step.retryCount - 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, backoff));
            step.status = 'pending';
            await this._checkpoint(task);
          } else {
            step.status = 'failed';

            if (step.optional || task.config.onError === 'skip') {
              step.status = 'skipped';
              task.currentStepIndex++;
            } else if (task.config.onError === 'retry') {
              step.retryCount = 0;
              step.status = 'pending';
            } else {
              // onError === 'stop'
              throw stepError;
            }

            await this._checkpoint(task);
          }
        } finally {
          this._concurrentCount--;
        }
      }

      // Task completed
      if (task.status === 'running') {
        task.status = 'completed';
        task.result = task.steps.map(s => ({ action: s.action, result: s.result }));
        task.completedAt = new Date().toISOString();
        await this._checkpoint(task);
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.completedAt = new Date().toISOString();
      await this._checkpoint(task);
    }
  },

  /**
   * Execute a single step
   */
  async _executeStep(task, stepIndex) {
    const step = task.steps[stepIndex];
    step.startedAt = new Date().toISOString();
    step.status = 'running';

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Step timeout')), step.timeout)
    );

    try {
      let result;

      if (/^scrape|crawl-start|map|batch|extract|screenshot$/.test(step.action)) {
        // Dispatch to popup handlers via chrome.runtime.sendMessage
        result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'task-step', action: step.action, params: step.params },
            (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response?.error) {
                reject(new Error(response.error));
              } else {
                resolve(response?.data);
              }
            }
          );
        });
      } else if (/^agent-/.test(step.action)) {
        // Delegate to Agent module
        const actionName = step.action.replace(/^agent-/, '');
        if (!globalThis.Agent) throw new Error('Agent module not loaded');
        result = await globalThis.Agent.executeAction(actionName, step.params);
      } else if (/^brain-/.test(step.action)) {
        // Delegate to Brain module
        const actionName = step.action.replace(/^brain-/, '');
        if (!globalThis.Brain) throw new Error('Brain module not loaded');
        if (typeof globalThis.Brain[actionName] !== 'function') {
          throw new Error(`Brain.${actionName} not found`);
        }
        result = await globalThis.Brain[actionName](step.params);
      } else if (step.action === 'delay') {
        result = await new Promise(resolve =>
          setTimeout(() => resolve({ delayed: step.params.ms }), step.params.ms || 1000)
        );
      } else if (step.action === 'condition') {
        // Evaluate condition on previous step result
        const prevResult = stepIndex > 0 ? task.steps[stepIndex - 1].result : null;
        const condFn = new Function('result', `return ${step.params.expression}`);
        result = { conditionMet: condFn(prevResult) };
      } else if (step.action === 'download') {
        if (!globalThis.FileManager) throw new Error('FileManager module not loaded');
        result = await globalThis.FileManager.download(step.params);
      } else if (step.action === 'connector') {
        if (!globalThis.Connectors) throw new Error('Connectors module not loaded');
        result = await globalThis.Connectors.execute(step.params.name, step.params.method, step.params.args);
      } else if (step.action === 'pipeline') {
        // Nested pipeline execution
        result = await this._executePipeline(step.params.steps);
      } else {
        throw new Error(`Unknown action type: ${step.action}`);
      }

      step.result = result;
      return result;
    } catch (error) {
      throw new Error(`Step ${stepIndex} (${step.action}) failed: ${error.message}`);
    }
  },

  /**
   * Execute a nested pipeline (array of steps)
   */
  async _executePipeline(pipelineSteps) {
    const results = [];
    for (const step of pipelineSteps) {
      const tempTask = { steps: [step], currentStepIndex: 0 };
      const stepResult = await this._executeStep(tempTask, 0);
      results.push(stepResult);
    }
    return results;
  },

  /**
   * Save task state checkpoint to IndexedDB + Supabase
   */
  async _checkpoint(task) {
    await this._saveToIndexedDb(task);
    await this._syncToSupabase(task);
  },

  /**
   * Save to IndexedDB
   */
  async _saveToIndexedDb(task) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readwrite');
      const store = tx.objectStore(this._storeName);
      const request = store.put(task);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  },

  /**
   * Load from IndexedDB
   */
  async _loadFromIndexedDb(taskId) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readonly');
      const store = tx.objectStore(this._storeName);
      const request = store.get(taskId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  },

  /**
   * Sync task state to Supabase (if configured)
   */
  async _syncToSupabase(task) {
    if (!globalThis.SupabaseClient) return; // Not configured

    try {
      const payload = {
        task_id: task.taskId,
        name: task.name,
        status: task.status,
        steps_json: JSON.stringify(task.steps),
        config_json: JSON.stringify(task.config),
        current_step: task.currentStepIndex,
        result_json: task.result ? JSON.stringify(task.result) : null,
        error: task.error,
        created_at: task.createdAt,
        started_at: task.startedAt,
        completed_at: task.completedAt,
        updated_at: new Date().toISOString(),
      };

      await globalThis.SupabaseClient
        .from('tasks')
        .upsert(payload, { onConflict: 'task_id' });
    } catch (err) {
      console.warn('Supabase sync failed (non-fatal):', err.message);
    }
  },

  /**
   * Restore tasks from storage on service worker wake
   */
  async restore() {
    const db = await this._getDb();
    const allTasks = await new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readonly');
      const store = tx.objectStore(this._storeName);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    // Resume paused/running tasks
    for (const task of allTasks) {
      this._tasks.set(task.taskId, task);
      if (task.status === 'running' || task.status === 'paused') {
        // Resumable task found
        if (task.status === 'paused') {
          task.status = 'running';
        }
        await this._checkpoint(task);
        this._executeTask(task.taskId).catch(err => {
          console.error(`Restored task ${task.taskId} failed:`, err);
        });
      }
    }
  },

  /**
   * Cleanup completed/cancelled tasks older than 7 days
   */
  async cleanup() {
    const db = await this._getDb();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    return new Promise((resolve, reject) => {
      const tx = db.transaction([this._storeName], 'readwrite');
      const store = tx.objectStore(this._storeName);
      const index = store.index('createdAt');
      const range = IDBKeyRange.upperBound(new Date(cutoff).toISOString());
      const request = index.openCursor(range);

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const task = cursor.value;
          if (task.status === 'completed' || task.status === 'cancelled') {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  },

  /**
   * Get summary statistics
   */
  async getStats() {
    const tasks = await this.list({ limit: 1000 });
    const byStatus = {};

    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    }

    return {
      total: tasks.length,
      byStatus,
      concurrent: this._concurrentCount,
      maxConcurrent: this._maxConcurrent,
    };
  },

  /**
   * Initialize alarm for task auto-resume
   */
  async _initAlarm() {
    chrome.alarms.create(this._alarmName, { periodInMinutes: this._tickInterval });
  },
};

// Register alarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TaskRunner._alarmName) {
    try {
      await TaskRunner.restore();
    } catch (err) {
      console.error('Task auto-restore failed:', err);
    }
  }
});

// Export to global scope
globalThis.TaskRunner = TaskRunner;
