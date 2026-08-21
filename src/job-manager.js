const crypto = require('crypto');
const Pipeline = require('./pipeline');

class JobManager {
  constructor(options = {}) {
    this.outputRoot = options.outputRoot;
    this.maxSiteConcurrency = Math.max(1, options.maxSiteConcurrency || 2);
    this.downloadConcurrency = Math.max(1, options.downloadConcurrency || 20);
    this.jobs = new Map();
    this.listeners = new Map();
    this.pendingQueue = [];
    this.runningCount = 0;
  }

  createId() {
    return crypto.randomBytes(8).toString('hex');
  }

  subscribe(jobId, callback) {
    if (!this.listeners.has(jobId)) {
      this.listeners.set(jobId, new Set());
    }
    this.listeners.get(jobId).add(callback);
    return () => this.listeners.get(jobId).delete(callback);
  }

  emit(jobId, event) {
    const set = this.listeners.get(jobId);
    if (!set) return;
    for (const cb of set) {
      try { cb(event); } catch {}
    }
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  getQueueInfo() {
    return {
      maxSiteConcurrency: this.maxSiteConcurrency,
      downloadConcurrency: this.downloadConcurrency,
      running: this.runningCount,
      queued: this.pendingQueue.length
    };
  }

  listJobs() {
    return [...this.jobs.values()].map((j) => ({
      id: j.id,
      url: j.url,
      status: j.status,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
      progress: j.progress || null,
      summary: j.summary || null,
      error: j.error || null,
      logCount: (j.logs || []).length
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  startJob(url, options = {}) {
    const id = this.createId();
    const job = {
      id,
      url,
      status: 'pending',
      createdAt: new Date().toISOString(),
      finishedAt: null,
      logs: [],
      progress: null,
      summary: null,
      result: null,
      error: null,
      retryFailedOnly: !!options.retryFailedOnly,
      multiPage: !!options.multiPage,
      downloadSkinManifest: options.downloadSkinManifest === true,
      downloadConcurrency: options.downloadConcurrency || this.downloadConcurrency,
      pipeline: null,
      cancelRequested: false
    };
    this.jobs.set(id, job);
    this.pendingQueue.push(job);
    this.pumpQueue();
    return job;
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, error: '任务不存在' };
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return { ok: false, error: '任务已结束', status: job.status };
    }

    job.cancelRequested = true;

    if (job.status === 'pending') {
      const idx = this.pendingQueue.findIndex((j) => j.id === jobId);
      if (idx >= 0) this.pendingQueue.splice(idx, 1);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      job.error = '已终止';
      this.addLog(job, '任务已从队列取消');
      this.emit(job.id, { type: 'cancelled', data: { status: 'cancelled' } });
      this.emit(job.id, { type: 'status', data: { status: 'cancelled' } });
      return { ok: true, status: 'cancelled' };
    }

    if (job.pipeline && typeof job.pipeline.abort === 'function') {
      job.pipeline.abort();
    }
    this.addLog(job, '正在终止...');
    this.emit(job.id, { type: 'status', data: { status: 'cancelling' } });
    return { ok: true, status: 'cancelling' };
  }

  pumpQueue() {
    while (this.runningCount < this.maxSiteConcurrency && this.pendingQueue.length > 0) {
      const job = this.pendingQueue.shift();
      if (job.cancelRequested || job.status === 'cancelled') continue;
      this.runningCount++;
      this.runJob(job).finally(() => {
        this.runningCount--;
        this.pumpQueue();
      });
    }
  }

  addLog(job, message) {
    const entry = { time: new Date().toISOString(), message };
    job.logs.push(entry);
    this.emit(job.id, { type: 'log', data: entry });
  }

  async runJob(job) {
    if (job.cancelRequested) {
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      job.error = '已终止';
      this.emit(job.id, { type: 'cancelled', data: { status: 'cancelled' } });
      this.emit(job.id, { type: 'status', data: { status: 'cancelled' } });
      return;
    }

    job.status = 'running';
    this.emit(job.id, { type: 'status', data: { status: 'running' } });

    const pipeline = new Pipeline({
      outputRoot: this.outputRoot,
      downloadConcurrency: job.downloadConcurrency,
      downloadSkinManifest: job.downloadSkinManifest,
      runCompare: true,
      onLog: (msg) => this.addLog(job, msg),
      onProgress: (progress) => {
        job.progress = progress;
        this.emit(job.id, { type: 'progress', data: progress });
      }
    });
    job.pipeline = pipeline;

    try {
      if (job.cancelRequested) {
        pipeline.abort();
        throw Object.assign(new Error('已终止'), { code: 'CANCELLED' });
      }
      const result = await pipeline.run(job.url, {
        retryFailedOnly: job.retryFailedOnly,
        multiPage: job.multiPage
      });
      if (job.cancelRequested) {
        throw Object.assign(new Error('已终止'), { code: 'CANCELLED' });
      }
      job.result = result;
      job.summary = result.summary;
      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
      this.emit(job.id, { type: 'complete', data: { summary: job.summary, result } });
    } catch (err) {
      const cancelled = job.cancelRequested || err.code === 'CANCELLED' || /cancelled|已终止/i.test(err.message || '');
      if (cancelled) {
        job.error = '已终止';
        job.status = 'cancelled';
        job.finishedAt = new Date().toISOString();
        this.addLog(job, '任务已终止');
        this.emit(job.id, { type: 'cancelled', data: { status: 'cancelled' } });
      } else {
        job.error = err.message;
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        this.addLog(job, `失败: ${err.message}`);
        this.emit(job.id, { type: 'error', data: { error: err.message } });
      }
    } finally {
      job.pipeline = null;
    }

    this.emit(job.id, { type: 'status', data: { status: job.status } });
  }
}

module.exports = JobManager;
