/**
 * Tests for JobManager module
 * Testing job lifecycle, persistence, progress tracking, and event system
 */

describe('JobManager', () => {
  let JobManager;
  let jobManager;

  beforeAll(() => {
    // Mock crypto.randomUUID
    global.crypto = {
      randomUUID: jest.fn(() => `test-uuid-${Math.random()}`),
    };

    delete require.cache[require.resolve('../job-manager.js')];
    require('../job-manager.js');
  });

  beforeEach(() => {
    // Create fresh JobManager instance for each test
    jobManager = new self.JobManager();
  });

  // ============================================================
  // JOB CREATION
  // ============================================================
  describe('createJob', () => {
    it('should create a job with defaults', async () => {
      const job = await jobManager.createJob({
        title: 'Test Job',
        type: 'scrape',
        instruction: 'Scrape example.com',
      });

      expect(job.id).toBeDefined();
      expect(job.title).toBe('Test Job');
      expect(job.type).toBe('scrape');
      expect(job.status).toBe('pending');
      expect(job.items).toEqual([]);
      expect(job.config.delayMs).toBe(2000);
      expect(job.config.maxConcurrent).toBe(1);
      expect(job.config.retryOnFail).toBe(true);
    });

    it('should create a job with items', async () => {
      const items = [
        { url: 'https://example.com/1' },
        { url: 'https://example.com/2' },
      ];
      const job = await jobManager.createJob({
        title: 'Multi-item Job',
        type: 'scrape',
        instruction: 'Scrape pages',
        items,
      });

      expect(job.items.length).toBe(2);
      expect(job.totalCount).toBe(2);
      expect(job.items[0].status).toBe('pending');
      expect(job.items[0].attempts).toBe(0);
    });

    it('should create a job with custom config', async () => {
      const job = await jobManager.createJob({
        title: 'Custom Config',
        type: 'scrape',
        instruction: 'Test',
        config: {
          delayMs: 5000,
          maxConcurrent: 3,
          retryOnFail: false,
        },
      });

      expect(job.config.delayMs).toBe(5000);
      expect(job.config.maxConcurrent).toBe(3);
      expect(job.config.retryOnFail).toBe(false);
    });

    it('should emit job:created event', async () => {
      const listener = jest.fn();
      jobManager.on(listener);

      await jobManager.createJob({
        title: 'Event Test',
        type: 'scrape',
        instruction: 'Test',
      });

      expect(listener).toHaveBeenCalledWith('job:created', expect.objectContaining({
        title: 'Event Test',
      }));
    });

    it('should save job to persistent storage', async () => {
      const job = await jobManager.createJob({
        title: 'Persisted Job',
        type: 'scrape',
        instruction: 'Test',
      });

      expect(jobManager.jobs.has(job.id)).toBe(true);
    });
  });

  // ============================================================
  // JOB QUERYING
  // ============================================================
  describe('getJob', () => {
    it('should retrieve job by id', async () => {
      const created = await jobManager.createJob({
        title: 'Get Test',
        type: 'scrape',
        instruction: 'Test',
      });

      const retrieved = jobManager.getJob(created.id);
      expect(retrieved).toEqual(created);
    });

    it('should return undefined for nonexistent job', () => {
      const job = jobManager.getJob('nonexistent');
      expect(job).toBeUndefined();
    });
  });

  describe('getAllJobs', () => {
    it('should return empty array initially', () => {
      const jobs = jobManager.getAllJobs();
      expect(jobs).toEqual([]);
    });

    it('should return all jobs sorted by creation date', async () => {
      const job1 = await jobManager.createJob({
        title: 'Job 1',
        type: 'scrape',
        instruction: 'Test',
      });

      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 10));

      const job2 = await jobManager.createJob({
        title: 'Job 2',
        type: 'scrape',
        instruction: 'Test',
      });

      const jobs = jobManager.getAllJobs();
      expect(jobs.length).toBe(2);
      // Most recent first
      expect(jobs[0].id).toBe(job2.id);
      expect(jobs[1].id).toBe(job1.id);
    });
  });

  describe('getActiveJobs', () => {
    it('should return only active jobs', async () => {
      const job1 = await jobManager.createJob({
        title: 'Active',
        type: 'scrape',
        instruction: 'Test',
      });
      job1.status = 'running';

      const job2 = await jobManager.createJob({
        title: 'Completed',
        type: 'scrape',
        instruction: 'Test',
      });
      job2.status = 'completed';

      const active = jobManager.getActiveJobs();
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(job1.id);
    });
  });

  describe('getCompletedJobs', () => {
    it('should return only completed jobs', async () => {
      const job1 = await jobManager.createJob({
        title: 'Running',
        type: 'scrape',
        instruction: 'Test',
      });
      job1.status = 'running';

      const job2 = await jobManager.createJob({
        title: 'Completed',
        type: 'scrape',
        instruction: 'Test',
      });
      job2.status = 'completed';

      const completed = jobManager.getCompletedJobs();
      expect(completed.some(j => j.id === job2.id)).toBe(true);
      expect(completed.some(j => j.id === job1.id)).toBe(false);
    });
  });

  // ============================================================
  // JOB PROGRESS
  // ============================================================
  describe('getJobProgress', () => {
    it('should calculate progress percentage', async () => {
      const job = await jobManager.createJob({
        title: 'Progress Test',
        type: 'scrape',
        instruction: 'Test',
        items: [{ url: 'url1' }, { url: 'url2' }, { url: 'url3' }],
      });

      job.processedCount = 1;
      job.successCount = 1;

      const progress = jobManager.getJobProgress(job.id);
      expect(progress.percent).toBeCloseTo(33, 0);
      expect(progress.processed).toBe(1);
      expect(progress.total).toBe(3);
      expect(progress.success).toBe(1);
    });

    it('should return null for nonexistent job', () => {
      const progress = jobManager.getJobProgress('nonexistent');
      expect(progress).toBeNull();
    });
  });

  // ============================================================
  // JOB DELETION
  // ============================================================
  describe('deleteJob', () => {
    it('should delete a job', async () => {
      const job = await jobManager.createJob({
        title: 'Delete Test',
        type: 'scrape',
        instruction: 'Test',
      });

      await jobManager.deleteJob(job.id);
      expect(jobManager.getJob(job.id)).toBeUndefined();
    });

    it('should emit job:deleted event', async () => {
      const listener = jest.fn();
      jobManager.on(listener);

      const job = await jobManager.createJob({
        title: 'Delete Event Test',
        type: 'scrape',
        instruction: 'Test',
      });

      await jobManager.deleteJob(job.id);
      expect(listener).toHaveBeenCalledWith('job:deleted', expect.objectContaining({
        id: job.id,
      }));
    });
  });

  describe('deleteCompletedJobs', () => {
    it('should delete only completed jobs', async () => {
      const job1 = await jobManager.createJob({
        title: 'Completed',
        type: 'scrape',
        instruction: 'Test',
      });
      job1.status = 'completed';

      const job2 = await jobManager.createJob({
        title: 'Running',
        type: 'scrape',
        instruction: 'Test',
      });
      job2.status = 'running';

      await jobManager.deleteCompletedJobs();

      expect(jobManager.getJob(job1.id)).toBeUndefined();
      expect(jobManager.getJob(job2.id)).toBeDefined();
    });
  });

  // ============================================================
  // JOB PAUSE/RESUME/CANCEL
  // ============================================================
  describe('pauseJob', () => {
    it('should pause a running job', async () => {
      const job = await jobManager.createJob({
        title: 'Pause Test',
        type: 'scrape',
        instruction: 'Test',
      });
      job.status = 'running';

      await jobManager.pauseJob(job.id);
      expect(job.status).toBe('paused');
    });

    it('should emit job:paused event', async () => {
      const listener = jest.fn();
      jobManager.on(listener);

      const job = await jobManager.createJob({
        title: 'Pause Event Test',
        type: 'scrape',
        instruction: 'Test',
      });
      job.status = 'running';

      await jobManager.pauseJob(job.id);
      expect(listener).toHaveBeenCalledWith('job:paused', expect.objectContaining({
        id: job.id,
      }));
    });
  });

  describe('cancelJob', () => {
    it('should cancel a job', async () => {
      const job = await jobManager.createJob({
        title: 'Cancel Test',
        type: 'scrape',
        instruction: 'Test',
        items: [{ url: 'url1' }, { url: 'url2' }],
      });
      job.status = 'running';

      await jobManager.cancelJob(job.id);
      expect(job.status).toBe('cancelled');
      expect(job.items[0].status).toBe('skipped');
    });

    it('should emit job:cancelled event', async () => {
      const listener = jest.fn();
      jobManager.on(listener);

      const job = await jobManager.createJob({
        title: 'Cancel Event Test',
        type: 'scrape',
        instruction: 'Test',
      });

      await jobManager.cancelJob(job.id);
      expect(listener).toHaveBeenCalledWith('job:cancelled', expect.objectContaining({
        id: job.id,
      }));
    });
  });

  // ============================================================
  // JOB LOGGING
  // ============================================================
  describe('log', () => {
    it('should add log entry to job', async () => {
      const job = await jobManager.createJob({
        title: 'Log Test',
        type: 'scrape',
        instruction: 'Test',
      });

      jobManager.log(job, 'Test log message');
      expect(job.logs.length).toBe(1);
      expect(job.logs[0].message).toBe('Test log message');
      expect(job.logs[0].timestamp).toBeDefined();
    });

    it('should limit logs to 500 entries', async () => {
      const job = await jobManager.createJob({
        title: 'Log Limit Test',
        type: 'scrape',
        instruction: 'Test',
      });

      // Add 600 logs
      for (let i = 0; i < 600; i++) {
        jobManager.log(job, `Log ${i}`);
      }

      expect(job.logs.length).toBe(500);
      expect(job.logs[0].message).toBe('Log 100');
    });

    it('should emit job:log event', async () => {
      const listener = jest.fn();
      jobManager.on(listener);

      const job = await jobManager.createJob({
        title: 'Log Event Test',
        type: 'scrape',
        instruction: 'Test',
      });

      jobManager.log(job, 'Event test');
      expect(listener).toHaveBeenCalledWith('job:log', expect.anything(), expect.objectContaining({
        message: 'Event test',
      }));
    });
  });

  // ============================================================
  // EVENT SYSTEM
  // ============================================================
  describe('on/emit', () => {
    it('should register event listener', () => {
      const callback = jest.fn();
      const unsubscribe = jobManager.on(callback);

      jobManager.emit('test:event', { data: 'test' });
      expect(callback).toHaveBeenCalledWith('test:event', { data: 'test' });
    });

    it('should unsubscribe listener', () => {
      const callback = jest.fn();
      const unsubscribe = jobManager.on(callback);

      unsubscribe();
      jobManager.emit('test:event', {});
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Test error');
      });
      const goodCallback = jest.fn();

      jobManager.on(errorCallback);
      jobManager.on(goodCallback);

      expect(() => {
        jobManager.emit('test:event', {});
      }).not.toThrow();

      // Good callback should still be called
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  // ============================================================
  // STALE JOB DETECTION
  // ============================================================
  describe('cleanupStaleJobs', () => {
    it('should detect stale jobs without heartbeat', async () => {
      const job = await jobManager.createJob({
        title: 'Stale Job',
        type: 'scrape',
        instruction: 'Test',
      });
      job.status = 'running';
      job.updatedAt = new Date(Date.now() - 150000).toISOString(); // 150 seconds ago

      const listener = jest.fn();
      jobManager.on(listener);

      await jobManager.cleanupStaleJobs(120000); // 120 second threshold

      expect(job.status).toBe('failed');
      expect(job.errorMessage).toContain('bloccato');
    });

    it('should not mark recent jobs as stale', async () => {
      const job = await jobManager.createJob({
        title: 'Recent Job',
        type: 'scrape',
        instruction: 'Test',
      });
      job.status = 'running';
      job.updatedAt = new Date(Date.now() - 30000).toISOString(); // 30 seconds ago

      await jobManager.cleanupStaleJobs(120000);

      expect(job.status).toBe('running');
    });
  });

  // ============================================================
  // PERSISTENCE
  // ============================================================
  describe('load/save', () => {
    it('should save jobs to storage', async () => {
      const job = await jobManager.createJob({
        title: 'Save Test',
        type: 'scrape',
        instruction: 'Test',
      });

      await jobManager.save();
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          cobra_jobs: expect.any(Array),
        }),
        expect.any(Function)
      );
    });

    it('should load jobs from storage', async () => {
      const mockData = {
        cobra_jobs: [
          {
            id: 'loaded-job',
            title: 'Loaded Job',
            type: 'scrape',
            instruction: 'Test',
            status: 'completed',
            items: [],
          },
        ],
      };

      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb(mockData);
      });

      const newManager = new self.JobManager();
      await newManager.load();

      expect(newManager.jobs.has('loaded-job')).toBe(true);
    });
  });

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================
  describe('_estimateETA', () => {
    it('should estimate time to completion', async () => {
      const job = await jobManager.createJob({
        title: 'ETA Test',
        type: 'scrape',
        instruction: 'Test',
        items: [{ url: 'url1' }, { url: 'url2' }, { url: 'url3' }, { url: 'url4' }, { url: 'url5' }],
      });

      job.status = 'running';
      job.startedAt = new Date(Date.now() - 10000).toISOString(); // 10 seconds ago
      job.processedCount = 2;

      const eta = jobManager._estimateETA(job);
      expect(typeof eta).toBe('number');
      expect(eta).toBeGreaterThan(0);
    });

    it('should return null for non-running jobs', async () => {
      const job = await jobManager.createJob({
        title: 'ETA Test',
        type: 'scrape',
        instruction: 'Test',
      });

      job.status = 'completed';
      const eta = jobManager._estimateETA(job);
      expect(eta).toBeNull();
    });
  });
});
