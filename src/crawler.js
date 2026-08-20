const fs = require('fs');
const path = require('path');
const NetworkMonitor = require('./network');
const Downloader = require('./downloader');
const DedupeManager = require('./dedupe');
const ResourceParser = require('./resource-parser');
const PathRewriter = require('./path-rewriter');
const Reporter = require('./reporter');

class Crawler {
  constructor(options = {}) {
    this.outputRoot = options.outputRoot || path.join(process.cwd(), 'output');
    this.onLog = options.onLog || ((msg) => console.log(msg));
    this.onProgress = options.onProgress || (() => {});
    this.downloader = new Downloader(options);
    this.networkMonitor = new NetworkMonitor(options);
    this.pendingUrls = new Set();
    this.downloadedUrls = new Set();
    this.networkUrls = new Set();
    this.dedupe = new DedupeManager();
    this.reporter = null;
    this.sourceUrl = '';
    this.outputDir = '';
    this.urlMap = new Map();
    this.savedFiles = new Set();
    this.resourceMeta = [];
    this.reportedUrls = new Set();
    this.parsedFiles = new Set();
    this.maxQueueRounds = options.maxQueueRounds || 5;
    this.downloadDelay = options.downloadDelay || 100;
    this.skippedCount = 0;
    this.previousErrors = [];
  }

  readManifest() {
    const filePath = path.join(this.outputDir, 'manifest.json');
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  loadExistingCache() {
    const manifest = this.readManifest();
    if (!manifest) return { skipped: 0, previousErrors: [] };

    let skipped = 0;
    for (const resource of manifest.resources || []) {
      if (!resource || !resource.url || !resource.local) continue;
      const absPath = path.join(this.outputDir, resource.local);
      if (!fs.existsSync(absPath)) continue;

      const normalized = this.dedupe.normalizeUrl(resource.url, this.sourceUrl) || resource.url;
      this.dedupe.register(normalized, resource.local, resource.hash || '');
      this.downloadedUrls.add(normalized);
      this.urlMap.set(normalized, resource.local);
      this.savedFiles.add(resource.local);
      this.ensureResourceRecord(
        normalized,
        resource.local,
        resource.type,
        resource.status || 200,
        resource.size || 0,
        resource.hash || ''
      );
      skipped++;
    }

    this.skippedCount = skipped;
    const extraErrors = [];
    const errorsPath = path.join(this.outputDir, 'errors.json');
    if (fs.existsSync(errorsPath)) {
      try {
        const fromFile = JSON.parse(fs.readFileSync(errorsPath, 'utf-8'));
        if (Array.isArray(fromFile)) extraErrors.push(...fromFile);
      } catch {}
    }
    this.previousErrors = [
      ...(manifest.errors || []),
      ...extraErrors,
      ...(manifest.missing || []).map((item) => ({
        url: item.url,
        status: 0,
        reason: item.reason || 'file missing',
        resourceType: 'other'
      }))
    ].filter((item) => item && item.url);

    return { skipped, previousErrors: this.previousErrors };
  }

  ensureResourceRecord(url, localPath, type, status, size, hash) {
    const normalized = this.dedupe.normalizeUrl(url, this.sourceUrl);
    if (!normalized || this.reportedUrls.has(normalized)) return;
    this.reportedUrls.add(normalized);
    const meta = {
      url: normalized,
      local: localPath.replace(/\\/g, '/'),
      type: type || 'other',
      status: status || 200,
      size: size || 0,
      hash: hash || ''
    };
    this.resourceMeta.push(meta);
    this.reporter.addResource(meta);
  }

  getSiteDir(url) {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const port = parsed.port ? `_${parsed.port}` : '';
    return path.join(this.outputRoot, `${host}${port}`);
  }

  queueUrl(url, fromNetwork) {
    const normalized = this.dedupe.normalizeUrl(url, this.sourceUrl);
    if (!normalized) return;
    if (fromNetwork) this.networkUrls.add(normalized);
    if (this.downloadedUrls.has(normalized) || this.pendingUrls.has(normalized)) return;
    this.pendingUrls.add(normalized);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async downloadResource(url, resourceType, referer) {
    const normalized = this.dedupe.normalizeUrl(url, this.sourceUrl);
    if (!normalized) return null;

    if (this.downloadedUrls.has(normalized)) {
      const local = this.dedupe.getLocalPath(normalized);
      if (local) this.ensureResourceRecord(normalized, local, resourceType, 200, 0, '');
      return local;
    }

    const existingLocal = this.dedupe.getLocalPath(normalized);
    if (existingLocal) {
      const absExisting = path.join(this.outputDir, existingLocal);
      if (fs.existsSync(absExisting)) {
        this.downloadedUrls.add(normalized);
        this.ensureResourceRecord(normalized, existingLocal, resourceType, 200, 0, '');
        return existingLocal;
      }
    }

    this.pendingUrls.delete(normalized);

    if (!this.downloader.isStaticResource(resourceType, normalized)) {
      this.downloadedUrls.add(normalized);
      return null;
    }

    if (this.downloadDelay > 0) await this.sleep(this.downloadDelay);

    const result = await this.downloader.download(normalized, referer || this.sourceUrl);

    if (result.status < 200 || result.status >= 400 || !result.data) {
      const reason = result.error || this.statusReason(result.status);
      this.onLog(`失败: ${normalized} (${result.status || 'error'} ${reason})`);
      this.reporter.addError({
        url: normalized,
        status: result.status,
        reason,
        resourceType
      });
      this.downloadedUrls.add(normalized);
      return null;
    }

    const hash = this.dedupe.computeHash(result.data);
    const existingByHash = this.dedupe.getLocalByHash(hash);

    let localPath;
    if (existingByHash) {
      localPath = existingByHash;
      this.dedupe.linkUrlToExisting(normalized, localPath);
    } else {
      localPath = this.dedupe.urlToLocalPath(normalized, result.contentType);
      const absPath = path.join(this.outputDir, localPath);
      this.downloader.saveFile(absPath, result.data);
      this.dedupe.register(normalized, localPath, hash);
      this.savedFiles.add(localPath);
    }

    this.downloadedUrls.add(normalized);
    this.urlMap.set(normalized, localPath);
    this.ensureResourceRecord(normalized, localPath, resourceType, result.status, result.data.length, hash);

    return localPath;
  }

  statusReason(status) {
    const map = { 403: 'forbidden', 404: 'not found', 401: 'unauthorized', 429: 'rate limited', 500: 'server error' };
    return map[status] || 'download failed';
  }

  async parseAndQueueFile(localPath, contentType) {
    if (this.parsedFiles.has(localPath)) return;
    this.parsedFiles.add(localPath);

    const absPath = path.join(this.outputDir, localPath);
    if (!fs.existsSync(absPath)) return;

    const ext = path.extname(localPath).toLowerCase();
    const fileUrl = new URL(localPath, this.sourceUrl).href;
    const parser = new ResourceParser(fileUrl);
    let discovered = [];

    try {
      if (ext === '.html' || ext === '.htm' || contentType.includes('text/html')) {
        discovered = parser.extractFromHtml(fs.readFileSync(absPath, 'utf-8'));
      } else if (ext === '.css' || contentType.includes('text/css')) {
        discovered = parser.extractFromCss(fs.readFileSync(absPath, 'utf-8'), fileUrl);
      } else if (['.js', '.mjs', '.cjs'].includes(ext)) {
        discovered = parser.extractFromJs(fs.readFileSync(absPath, 'utf-8'), fileUrl);
      }
    } catch {
      return;
    }

    for (const url of discovered) {
      this.queueUrl(url, false);
    }
  }

  async processQueue() {
    let round = 0;
    let processed = 0;
    while (this.pendingUrls.size > 0 && round < this.maxQueueRounds) {
      const batch = [...this.pendingUrls];
      this.pendingUrls.clear();
      let batchDone = 0;
      for (const url of batch) {
        if (this.downloadedUrls.has(url)) continue;
        await this.downloadResource(url, 'other', this.sourceUrl, true);
        processed++;
        batchDone++;
        this.onProgress({
          phase: 'download',
          subPhase: 'queue',
          message: `关联资源 ${processed}（第 ${round + 1}/${this.maxQueueRounds} 轮）`,
          current: batchDone,
          total: batch.length
        });
      }
      for (const meta of [...this.resourceMeta]) {
        if (!this.parsedFiles.has(meta.local)) {
          await this.parseAndQueueFile(meta.local, '');
        }
      }
      round++;
    }
  }

  saveIndexHtml(html) {
    const indexPath = path.join(this.outputDir, 'index.html');
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(indexPath, html, 'utf-8');
    this.savedFiles.add('index.html');
    const normalized = this.dedupe.normalizeUrl(this.sourceUrl, this.sourceUrl);
    if (normalized) {
      const hash = this.dedupe.computeHash(Buffer.from(html, 'utf-8'));
      this.urlMap.set(normalized, 'index.html');
      this.dedupe.register(normalized, 'index.html', hash);
      this.downloadedUrls.add(normalized);
      this.ensureResourceRecord(normalized, 'index.html', 'document', 200, Buffer.byteLength(html, 'utf-8'), hash);
    }
  }

  async rewriteAllPaths() {
    const rewriter = new PathRewriter(this.outputDir, this.urlMap);
    const files = [...this.savedFiles];
    for (let i = 0; i < files.length; i++) {
      rewriter.rewriteFile(files[i]);
      if (i % 5 === 0 || i === files.length - 1) {
        this.onProgress({
          phase: 'rewrite',
          message: `路径改写 ${i + 1}/${files.length}`,
          current: i + 1,
          total: files.length
        });
      }
    }
  }

  async localCheck() {
    const result = { total: this.resourceMeta.length, success: 0, failed: 0, missingFiles: [], checkedAt: new Date().toISOString() };
    for (const meta of this.resourceMeta) {
      const absPath = path.join(this.outputDir, meta.local);
      if (fs.existsSync(absPath)) result.success++;
      else {
        result.failed++;
        result.missingFiles.push(meta.local);
        this.reporter.addMissing({ url: meta.url, local: meta.local, reason: 'file not found after download' });
      }
    }
    result.pageExists = fs.existsSync(path.join(this.outputDir, 'index.html'));
    return result;
  }

  async retryFailedResources() {
    const unique = [];
    const seen = new Set();
    for (const item of this.previousErrors) {
      const normalized = this.dedupe.normalizeUrl(item.url, this.sourceUrl) || item.url;
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push({ url: normalized, resourceType: item.resourceType || 'other' });
    }

    if (unique.length === 0) {
      this.onLog('没有需要重试的失败资源');
      return 0;
    }

    this.onLog(`重试失败资源: ${unique.length} 个`);
    let done = 0;
    let recovered = 0;
    for (const item of unique) {
      this.downloadedUrls.delete(item.url);
      const local = await this.downloadResource(item.url, item.resourceType, this.sourceUrl, true);
      if (local) recovered++;
      done++;
      this.onProgress({
        phase: 'download',
        subPhase: 'main',
        message: `重试 ${done}/${unique.length}`,
        current: done,
        total: unique.length
      });
    }
    this.onLog(`重试完成: 成功 ${recovered}，仍失败 ${unique.length - recovered}`);
    return unique.length;
  }

  async finishCrawl(url) {
    this.onLog('重写资源路径...');
    this.onProgress({ phase: 'rewrite', message: '正在改写本地资源路径...' });
    await this.rewriteAllPaths();

    const checkResult = await this.localCheck();
    this.reporter.writeManifest(url);
    this.reporter.writeErrors();
    const report = this.reporter.writeReport(checkResult);
    const summary = this.reporter.getSummary(this.outputDir);
    this.onProgress({ phase: 'done', message: '下载完成', summary });

    return {
      outputDir: this.outputDir,
      manifest: path.join(this.outputDir, 'manifest.json'),
      report,
      summary
    };
  }

  async crawl(url, options = {}) {
    this.sourceUrl = url;
    this.outputDir = this.getSiteDir(url);
    fs.mkdirSync(this.outputDir, { recursive: true });
    this.reporter = new Reporter(this.outputDir);

    const cache = this.loadExistingCache();
    if (cache.skipped > 0) {
      this.onLog(`沿用已有成功资源: ${cache.skipped} 个（跳过重复下载）`);
    }

    if (options.retryFailedOnly) {
      this.onLog(`输出目录: ${this.outputDir}`);
      this.onProgress({ phase: 'download', message: '正在重试失败资源...' });
      await this.retryFailedResources();
      return this.finishCrawl(url);
    }

    this.onLog(`正在抓取: ${url}`);
    this.onLog(`输出目录: ${this.outputDir}`);
    this.onProgress({ phase: 'capture', message: '正在打开页面并监听资源...' });

    const capture = await this.networkMonitor.capture(url);
    this.reporter.setNetwork(capture.network);
    this.reporter.writeNetwork();

    if (capture.error) this.onLog(`页面加载警告: ${capture.error}`);

    for (const entry of capture.network) {
      if (this.downloader.isStaticResource(entry.resourceType, entry.url, entry.contentType)) {
        this.queueUrl(entry.url, true);
      }
    }

    if (capture.html) {
      const parser = new ResourceParser(this.sourceUrl);
      parser.extractFromHtml(capture.html).forEach(u => this.queueUrl(u, false));
      this.saveIndexHtml(capture.html);
    }

    this.onLog(`Network 记录: ${capture.network.length} 条`);
    this.onLog(`待处理资源: ${this.pendingUrls.size} 个`);
    this.onLog('开始下载（已存在的成功文件将跳过）...');
    this.onProgress({ phase: 'download', message: '正在下载资源...', total: this.pendingUrls.size, current: 0 });

    let downloaded = 0;
    const staticEntries = capture.network.filter(e =>
      this.downloader.isStaticResource(e.resourceType, e.url, e.contentType)
    );
    for (const entry of staticEntries) {
      await this.downloadResource(entry.url, entry.resourceType, this.sourceUrl, true);
      downloaded++;
      this.onProgress({
        phase: 'download',
        subPhase: 'main',
        message: `已处理 ${downloaded}/${staticEntries.length}`,
        current: downloaded,
        total: staticEntries.length
      });
    }

    if (this.pendingUrls.size > 0) {
      this.onProgress({
        phase: 'download',
        subPhase: 'queue',
        message: `主资源已完成，扫描关联资源...`,
        current: 0,
        total: this.pendingUrls.size
      });
    }

    await this.processQueue();
    return this.finishCrawl(url);
  }
}

module.exports = Crawler;
