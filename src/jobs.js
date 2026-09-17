// ============================================================================
// src/jobs.js — Unified Background Processing & Jobs Center Architecture
// ============================================================================

const JOBS_STORAGE_KEY = 'schoolcenter_active_jobs_v1';

class JobsManager {
  constructor() {
    this.jobs = [];
    this.listeners = new Set();
    this.loadFromStorage();
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(JOBS_STORAGE_KEY);
      if (raw) {
        this.jobs = JSON.parse(raw);
      }
    } catch (e) {
      this.jobs = [];
    }
  }

  saveToStorage() {
    try {
      // Keep at most 30 recent jobs in history
      const trimmed = this.jobs.slice(-30);
      localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Failed to save jobs state:', e);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.saveToStorage();
    this.listeners.forEach(fn => {
      try { fn(this.jobs); } catch (err) { console.error('Job listener err:', err); }
    });
  }

  /**
   * Creates and registers a new job.
   */
  createJob({ type, title, sourceItem = '', affectedEntity = null, retryable = true, execute = null }) {
    const job = {
      id: 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      type,
      title: title || 'Background Task',
      sourceItem,
      status: 'queued', // queued | active | completed | failed | cancelled
      progress: 0,
      stage: 'queued', // uploading | reading | detecting | analyzing | extracting | indexing | completed | failed
      message: 'Queued in background...',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      retryable: !!retryable,
      result: null,
      affectedEntity, // { type: 'course'|'assignment'|'note', id, title }
      executeFn: execute
    };

    this.jobs.unshift(job);
    this.notify();

    if (execute) {
      this.runJob(job.id, execute);
    }

    return job;
  }

  getJob(id) {
    return this.jobs.find(j => j.id === id) || null;
  }

  updateJob(id, updates) {
    const job = this.getJob(id);
    if (!job) return;

    Object.assign(job, updates);
    if (updates.status === 'active' && !job.startedAt) {
      job.startedAt = Date.now();
    }
    if ((updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') && !job.completedAt) {
      job.completedAt = Date.now();
    }

    this.notify();
    return job;
  }

  async runJob(id, executeFn) {
    const job = this.getJob(id);
    if (!job) return;

    this.updateJob(id, {
      status: 'active',
      progress: 5,
      stage: 'started',
      message: 'Processing started...'
    });

    const reportProgress = (stage, progress, message) => {
      this.updateJob(id, { stage, progress, message });
    };

    try {
      const result = await executeFn(reportProgress);
      this.updateJob(id, {
        status: 'completed',
        progress: 100,
        stage: 'completed',
        message: 'Completed successfully ✓',
        result
      });
      return result;
    } catch (err) {
      console.error(`Job ${id} failed:`, err);
      this.updateJob(id, {
        status: 'failed',
        stage: 'failed',
        error: err.message || 'Operation failed',
        message: `Failed: ${err.message || 'Unknown error'}`
      });
    }
  }

  retryJob(id) {
    const job = this.getJob(id);
    if (!job || !job.executeFn) return;

    job.status = 'queued';
    job.progress = 0;
    job.error = null;
    job.completedAt = null;
    this.notify();

    this.runJob(id, job.executeFn);
  }

  cancelJob(id) {
    const job = this.getJob(id);
    if (!job || job.status === 'completed') return;

    this.updateJob(id, {
      status: 'cancelled',
      stage: 'cancelled',
      message: 'Cancelled by user'
    });
  }

  clearCompleted() {
    this.jobs = this.jobs.filter(j => j.status === 'active' || j.status === 'queued');
    this.notify();
  }

  getActiveJobsCount() {
    return this.jobs.filter(j => j.status === 'active' || j.status === 'queued').length;
  }

  getFailedJobsCount() {
    return this.jobs.filter(j => j.status === 'failed').length;
  }
}

export const jobsManager = new JobsManager();
