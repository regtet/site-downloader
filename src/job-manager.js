const crypto = require('crypto');
const Crawler = require('./crawler');

class JobManager {
  constructor(options = {}) {
    this.outputRoot = options.outputRoot;
    this.jobs = new Map();
    this.listeners = new Map();
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

  listJobs() {
    return [...this.jobs.values()].map(j => ({
      id: j.id,
      url: j.url,
      status: j.status,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
      summary: j.summary || null,
      error: j.error || null
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  startJob(url) {
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
      error: null
    };
    this.jobs.set(id, job);
    this.runJob(job);
    return job;
  }

  addLog(job, message) {
    const entry = { time: new Date().toISOString(), message };
    job.logs.push(entry);
    this.emit(job.id, { type: 'log', data: entry });
  }

  async runJob(job) {
    job.status = 'running';
    this.emit(job.id, { type: 'status', data: { status: 'running' } });

    const crawler = new Crawler({
      outputRoot: this.outputRoot,
      onLog: (msg) => this.addLog(job, msg),
      onProgress: (progress) => {
        job.progress = progress;
        this.emit(job.id, { type: 'progress', data: progress });
      }
    });

    try {
      const result = await crawler.crawl(job.url);
      job.result = result;
      job.summary = result.summary;
      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
      this.emit(job.id, { type: 'complete', data: { summary: job.summary, result } });
    } catch (err) {
      job.error = err.message;
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      this.addLog(job, `下载失败: ${err.message}`);
      this.emit(job.id, { type: 'error', data: { error: err.message } });
    }

    this.emit(job.id, { type: 'status', data: { status: job.status } });
  }
}

module.exports = JobManager;
