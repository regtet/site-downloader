const fs = require('fs');
const path = require('path');
const Capture = require('./capture');
const Downloader = require('./downloader');
const { sortByAssetPriority } = require('./downloader');
const AssetStore = require('./asset-store');
const ResourceParser = require('./resource-parser');
const PathRewriter = require('./path-rewriter');
const Reporter = require('./reporter');
const IntegrityChecker = require('./integrity');
const { compareRuntime } = require('./compare');
const { mapPool } = require('./concurrency');
const {
  hasUnresolvedTemplate,
  isOriginOnly,
  isApiLike,
  isLikelyAssetFile,
  isOptionalMissing,
  mergeTemplateContext,
  expandTemplates,
  collectAssetCdnBases,
  lobbyAssetLocalPath,
  lobbyAssetStemKey,
  buildLobbyAssetHints,
  lobbyAssetSavePath
} = require('./url-classify');
const {
  discoverManifestUrls,
  parseManifestEntries,
  manifestLocalPath,
  extractVersionQuery
} = require('./skin-manifest');
const { harvestFromLocalJsTree } = require('./asset-harvest');

class Pipeline {
  constructor(options = {}) {
    this.outputRoot = options.outputRoot || path.join(process.cwd(), 'dist');
    this.onLog = options.onLog || ((msg) => console.log(msg));
    this.onProgress = options.onProgress || (() => {});
    this.downloader = new Downloader(options);
    this.capture = new Capture(options);
    this.store = new AssetStore();
    this.pendingUrls = new Set();
    this.downloadedUrls = new Set();
    this.urlMap = new Map();
    this.savedFiles = new Set();
    this.resourceMeta = [];
    this.reportedUrls = new Set();
    this.parsedFiles = new Set();
    this.maxScanRounds = options.maxScanRounds || 3;
    this.downloadSkinManifest = options.downloadSkinManifest === true;
    this.runCompare = options.runCompare !== false;
    this.compareWaitMs = options.compareWaitMs != null ? options.compareWaitMs : 6000;
    this.downloadConcurrency = Math.max(1, options.downloadConcurrency || 20);
    this.skippedCount = 0;
    this.previousErrors = [];
    this.templateContext = {};
    this.assetCdnBases = [];
    this.lobbyAssetHints = new Map();
    this.inFlightDownloads = new Map();
    this.manifestStats = { manifests: 0, listed: 0, success: 0, failed: 0 };
    this.reporter = null;
    this.sourceUrl = '';
    this.outputDir = '';
    this._aborted = false;
  }

  abort() {
    if (this._aborted) return;
    this._aborted = true;
    if (this.capture && typeof this.capture.abort === 'function') {
      this.capture.abort();
    }
  }

  throwIfAborted() {
    if (!this._aborted) return;
    const err = new Error('已终止');
    err.code = 'CANCELLED';
    throw err;
  }

  isAborted() {
    return this._aborted;
  }

  getSiteDir(url) {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const port = parsed.port ? `_${parsed.port}` : '';
    return path.join(this.outputRoot, `${host}${port}`);
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

      const normalized = this.store.normalizeUrl(resource.url, this.sourceUrl) || resource.url;
      this.store.register(normalized, resource.local, resource.hash || '');
      this.downloadedUrls.add(normalized);
      this.urlMap.set(normalized, resource.local);
      this.savedFiles.add(resource.local);
      this.ensureResourceRecord(normalized, resource.local, resource.type, resource.status || 200, resource.size || 0, resource.hash || '');
      skipped++;
    }

    this.skippedCount = skipped;
    const extraErrors = [];
    const errorsPath = path.join(this.outputDir, 'errors.json');
    if (fs.existsSync(errorsPath)) {
      try {
        extraErrors.push(...JSON.parse(fs.readFileSync(errorsPath, 'utf-8')));
      } catch {}
    }
    this.previousErrors = [
      ...(manifest.errors || []),
      ...extraErrors,
      ...(manifest.unresolved || []).map((item) => ({ url: item.url, reason: item.reason || 'unresolved-template-url' })),
      ...(manifest.missing || []).map((item) => ({ url: item.url, status: 0, reason: item.reason || 'file missing' }))
    ].filter((item) => item && item.url);

    const networkPath = path.join(this.outputDir, 'network.json');
    if (fs.existsSync(networkPath)) {
      try {
        const cachedNetwork = JSON.parse(fs.readFileSync(networkPath, 'utf-8'));
        this.assetCdnBases = collectAssetCdnBases(cachedNetwork);
        this.lobbyAssetHints = buildLobbyAssetHints(cachedNetwork);
      } catch {}
    }

    return { skipped, previousErrors: this.previousErrors };
  }

  ensureResourceRecord(url, localPath, type, status, size, hash) {
    const normalized = this.store.normalizeUrl(url, this.sourceUrl);
    if (!normalized || this.reportedUrls.has(normalized)) return;
    this.reportedUrls.add(normalized);
    const meta = { url: normalized, local: localPath.replace(/\\/g, '/'), type: type || 'other', status: status || 200, size: size || 0, hash: hash || '' };
    this.resourceMeta.push(meta);
    this.reporter.addResource(meta);
  }

  queueUrl(url) {
    let normalized = this.store.normalizeUrl(url, this.sourceUrl);
    if (!normalized || isOriginOnly(normalized)) return;

    if (hasUnresolvedTemplate(normalized)) {
      const expanded = expandTemplates(normalized, this.templateContext);
      if (hasUnresolvedTemplate(expanded)) return;
      normalized = this.store.normalizeUrl(expanded, this.sourceUrl) || expanded;
    }

    if (!isLikelyAssetFile(normalized)) return;
    if (this.downloadedUrls.has(normalized) || this.pendingUrls.has(normalized)) return;
    this.pendingUrls.add(normalized);
  }

  saveIndexHtml(html, htmlSource) {
    const indexPath = path.join(this.outputDir, 'index.html');
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(indexPath, html, 'utf-8');
    this.savedFiles.add('index.html');
    const normalized = this.store.normalizeUrl(this.sourceUrl, this.sourceUrl);
    if (normalized) {
      const hash = this.store.computeHash(Buffer.from(html, 'utf-8'));
      this.urlMap.set(normalized, 'index.html');
      this.store.register(normalized, 'index.html', hash);
      this.downloadedUrls.add(normalized);
      this.ensureResourceRecord(normalized, 'index.html', 'document', 200, Buffer.byteLength(html, 'utf-8'), hash);
    }
    this.onLog(`保存 HTML 壳 (${htmlSource})`);
  }

  async downloadResource(url, resourceType, referer) {
    this.throwIfAborted();
    const normalized = this.store.normalizeUrl(url, this.sourceUrl);
    if (!normalized) return null;
    if (this.inFlightDownloads.has(normalized)) return this.inFlightDownloads.get(normalized);

    const task = this._downloadResourceImpl(normalized, url, resourceType, referer);
    this.inFlightDownloads.set(normalized, task);
    try {
      return await task;
    } finally {
      this.inFlightDownloads.delete(normalized);
    }
  }

  async _downloadResourceImpl(normalized, url, resourceType, referer) {
    if (this.downloadedUrls.has(normalized)) {
      const local = this.store.getLocalPath(normalized);
      if (local) this.ensureResourceRecord(normalized, local, resourceType, 200, 0, '');
      return local;
    }

    const existingLocal = this.store.getLocalPath(normalized);
    if (existingLocal && fs.existsSync(path.join(this.outputDir, existingLocal))) {
      this.downloadedUrls.add(normalized);
      this.ensureResourceRecord(normalized, existingLocal, resourceType, 200, 0, '');
      return existingLocal;
    }

    this.pendingUrls.delete(normalized);

    if (isApiLike(resourceType, normalized)) {
      this.downloadedUrls.add(normalized);
      this.reporter.addError({ url: normalized, status: 0, reason: 'api-skipped', category: 'api-skipped', resourceType });
      return null;
    }

    if (hasUnresolvedTemplate(normalized)) {
      const expanded = expandTemplates(normalized, this.templateContext);
      if (!hasUnresolvedTemplate(expanded)) {
        const local = await this.downloadResource(expanded, resourceType, referer);
        this.downloadedUrls.add(normalized);
        if (local) this.urlMap.set(normalized, local);
        return local;
      }
      this.downloadedUrls.add(normalized);
      this.reporter.addUnresolved({ url: normalized, reason: 'unresolved-template-url', resourceType });
      return null;
    }

    if (!isLikelyAssetFile(normalized) || !this.downloader.isStaticResource(resourceType, normalized)) {
      this.downloadedUrls.add(normalized);
      return null;
    }

    const candidates = this.buildFallbackUrls(normalized);
    let result = null;
    let usedUrl = normalized;
    for (const candidate of candidates) {
      result = await this.downloader.download(candidate, referer || this.sourceUrl, {
        retryStatuses: candidate === normalized ? [403, 429, 503] : [],
        maxRetries: candidate === normalized ? this.downloader.maxRetries : 0
      });
      if (result.status >= 200 && result.status < 400 && result.data) {
        usedUrl = candidate;
        break;
      }
    }

    if (!result || result.status < 200 || result.status >= 400 || !result.data) {
      const status = result ? result.status : 0;
      const reason = (result && (result.error || 'download failed')) || 'download failed';
      if (!isOptionalMissing(normalized)) {
        this.onLog(`失败: ${normalized} (${status || 'error'})`);
        this.reporter.addError({ url: normalized, status, reason, category: 'static-failed', resourceType });
      }
      this.downloadedUrls.add(normalized);
      return null;
    }

    const hash = this.store.computeHash(result.data);
    const existingByHash = this.store.getLocalByHash(hash);
    let localPath;

    if (existingByHash) {
      localPath = existingByHash;
      this.store.linkUrlToExisting(normalized, localPath);
    } else {
      localPath = lobbyAssetLocalPath(usedUrl) || lobbyAssetLocalPath(normalized)
        ? lobbyAssetSavePath(usedUrl, result.contentType, this.store)
        : this.store.urlToLocalPath(usedUrl, result.contentType);
      this.downloader.saveFile(path.join(this.outputDir, localPath), result.data);
      this.store.register(normalized, localPath, hash);
      this.store.register(usedUrl, localPath, hash);
      this.savedFiles.add(localPath);
    }

    this.downloadedUrls.add(normalized);
    this.urlMap.set(normalized, localPath);
    this.ensureResourceRecord(normalized, localPath, resourceType, result.status, result.data.length, hash);
    return localPath;
  }

  buildFallbackUrls(url) {
    const urls = [url];
    try {
      const parsed = new URL(url);
      const localKey = lobbyAssetLocalPath(url);
      if (localKey) {
        const hinted = this.lobbyAssetHints.get(localKey) || this.lobbyAssetHints.get(lobbyAssetStemKey(localKey));
        if (hinted) urls.unshift(hinted);
      }
      if (parsed.pathname.includes('/lobby_asset/')) {
        const suffix = parsed.pathname.slice(parsed.pathname.indexOf('/lobby_asset/')) + (parsed.search || '');
        for (const base of this.assetCdnBases || []) {
          urls.push(base.replace(/\/$/, '') + suffix);
        }
      }
    } catch {}
    return [...new Set(urls)];
  }

  async runDownloadPool(items, resourceType, referer, onProgress) {
    this.throwIfAborted();
    const ordered = sortByAssetPriority(items);
    let done = 0;
    await mapPool(ordered, this.downloadConcurrency, async (item) => {
      this.throwIfAborted();
      const targetUrl = typeof item === 'string' ? item : item.url;
      const type = typeof item === 'string' ? resourceType : (item.resourceType || resourceType);
      await this.downloadResource(targetUrl, type, referer);
      done++;
      if (onProgress) onProgress(done, ordered.length);
    }, { isAborted: () => this._aborted });
  }

  async parseAndQueueFile(localPath) {
    if (this.parsedFiles.has(localPath)) return;
    this.parsedFiles.add(localPath);

    const absPath = path.join(this.outputDir, localPath);
    if (!fs.existsSync(absPath)) return;

    const ext = path.extname(localPath).toLowerCase();
    const fileUrl = new URL(localPath.replace(/\\/g, '/'), this.sourceUrl.endsWith('/') ? this.sourceUrl : this.sourceUrl + '/').href;
    const parser = new ResourceParser(fileUrl);
    let discovered = [];

    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      if (ext === '.html' || ext === '.htm') discovered = parser.extractFromHtml(content);
      else if (ext === '.css') discovered = parser.extractFromCss(content, fileUrl);
      else if (/\.(js|mjs|cjs)$/.test(ext)) discovered = parser.extractFromJs(content, fileUrl);
    } catch {}

    for (const u of discovered) this.queueUrl(u);
  }

  async scanDownloadRounds(maxRounds) {
    let round = 0;
    while (round < maxRounds && this.pendingUrls.size > 0) {
      this.throwIfAborted();
      const batch = [...this.pendingUrls];
      this.pendingUrls.clear();
      this.onLog(`扫描第 ${round + 1} 轮: ${batch.length} 个待下载`);
      await this.runDownloadPool(batch, 'other', this.sourceUrl, (done, total) => {
        this.onProgress({ phase: 'download', subPhase: 'scan', message: `扫描 ${done}/${total}（第 ${round + 1} 轮）`, current: done, total });
      });
      for (const meta of [...this.resourceMeta]) {
        if (!this.parsedFiles.has(meta.local)) await this.parseAndQueueFile(meta.local);
      }
      round++;
    }
  }

  async downloadFromManifests(capture) {
    const versionQuery = extractVersionQuery(capture.network);
    const manifestUrls = discoverManifestUrls(capture.network, this.templateContext, this.assetCdnBases, capture.html || '');
    this.manifestStats.manifests = manifestUrls.length;
    if (!manifestUrls.length) return this.manifestStats;

    this.onLog(`皮肤清单: 发现 ${manifestUrls.length} 个 assets.hash.json`);
    const entries = [];
    for (const manifestUrl of manifestUrls) {
      const result = await this.downloader.download(manifestUrl, this.sourceUrl, { maxRetries: 1 });
      if (!result || result.status < 200 || result.status >= 400 || !result.data) continue;
      try {
        entries.push(...parseManifestEntries(manifestUrl, JSON.parse(result.data.toString('utf-8')), versionQuery));
      } catch {}
    }

    this.manifestStats.listed = entries.length;
    this.onLog(`皮肤清单: 批量下载 ${entries.length} 个资源`);
    this.onProgress({ phase: 'download', subPhase: 'skin', message: `皮肤清单 ${entries.length} 项`, current: 0, total: entries.length });

    let done = 0;
    await mapPool(entries, this.downloadConcurrency, async (entry) => {
      let result = null;
      let usedUrl = null;
      let usedExt = null;
      for (const candidate of entry.candidates) {
        result = await this.downloader.download(candidate, this.sourceUrl, { maxRetries: 0 });
        if (result.status >= 200 && result.status < 400 && result.data) {
          usedUrl = candidate;
          usedExt = path.extname(new URL(candidate).pathname).toLowerCase();
          break;
        }
      }
      if (result && result.data && usedUrl) {
        const hash = this.store.computeHash(result.data);
        const localHashed = manifestLocalPath(entry.relPath, entry.hash, usedExt);
        const absPath = path.join(this.outputDir, localHashed);
        if (!fs.existsSync(absPath)) {
          this.downloader.saveFile(absPath, result.data);
          this.savedFiles.add(localHashed);
        }
        this.store.register(usedUrl, localHashed, hash);
        this.urlMap.set(usedUrl, localHashed);
        this.manifestStats.success++;
      } else {
        this.manifestStats.failed++;
      }
      done++;
      if (done % 50 === 0) {
        this.onProgress({ phase: 'download', subPhase: 'skin', message: `皮肤清单 ${done}/${entries.length}`, current: done, total: entries.length });
      }
    });

    return this.manifestStats;
  }

  async rewriteAllPaths() {
    const rewriter = new PathRewriter(this.outputDir, this.urlMap);
    const files = [...this.savedFiles];
    for (let i = 0; i < files.length; i++) {
      rewriter.rewriteFile(files[i]);
      if (i % 10 === 0 || i === files.length - 1) {
        this.onProgress({ phase: 'rewrite', message: `路径改写 ${i + 1}/${files.length}`, current: i + 1, total: files.length });
      }
    }
  }

  async finish(url) {
    this.throwIfAborted();
    this.onLog('重写资源路径...');
    await this.rewriteAllPaths();

    const checkResult = { total: this.resourceMeta.length, success: 0, failed: 0, missingFiles: [] };
    for (const meta of this.resourceMeta) {
      if (fs.existsSync(path.join(this.outputDir, meta.local))) checkResult.success++;
      else {
        checkResult.failed++;
        checkResult.missingFiles.push(meta.local);
      }
    }

    const integrity = new IntegrityChecker({
      outputDir: this.outputDir,
      sourceUrl: this.sourceUrl,
      urlMap: this.urlMap,
      templateContext: this.templateContext
    }).check([...this.savedFiles]);
    this.reporter.setIntegrity(integrity);
    this.reporter.writeManifest(url);
    this.reporter.writeErrors();
    const report = this.reporter.writeReport(checkResult);

    let compareResult = null;
    if (this.runCompare) {
      this.onLog('源站 vs 本地运行时对比...');
      this.onProgress({ phase: 'compare', message: 'Playwright 对比 DOM/Network...' });
      try {
        compareResult = await compareRuntime({
          sourceUrl: url,
          localDir: this.outputDir,
          waitMs: this.compareWaitMs,
          outPath: path.join(this.outputDir, 'diff.json')
        });
        const findings = compareResult.diff.summary.topFindings || [];
        for (const f of findings.slice(0, 5)) this.onLog(`对比: ${f}`);
        if (compareResult.diff.summary.whyTwoDialogs.length) {
          this.onLog(`双弹框分析: ${compareResult.diff.summary.whyTwoDialogs[0]}`);
        }
      } catch (err) {
        this.onLog(`对比失败: ${err.message}`);
      }
    }

    const summary = this.reporter.getSummary(this.outputDir);
    summary.downloadMode = this.downloadSkinManifest ? 'network+skin-manifest' : 'network+scan';
    summary.manifestStats = { ...this.manifestStats };
    summary.compare = compareResult ? {
      diffPath: compareResult.diffPath,
      consistent: compareResult.diff.summary.consistent,
      topFindings: compareResult.diff.summary.topFindings,
      whyTwoDialogs: compareResult.diff.summary.whyTwoDialogs,
      overlayCount: {
        source: compareResult.source.snapshot.overlayCount,
        local: compareResult.local.snapshot.overlayCount
      }
    } : null;

    this.onProgress({ phase: 'done', message: 'dist 生成完成', summary });
    return { outputDir: this.outputDir, manifest: path.join(this.outputDir, 'manifest.json'), report, summary, diff: compareResult && compareResult.diff };
  }

  async run(url, options = {}) {
    this._aborted = false;
    this.sourceUrl = url;
    this.outputDir = this.getSiteDir(url);
    fs.mkdirSync(this.outputDir, { recursive: true });
    this.reporter = new Reporter(this.outputDir);

    const cache = this.loadExistingCache();
    if (cache.skipped > 0) this.onLog(`沿用已有资源: ${cache.skipped} 个`);

    if (options.retryFailedOnly) {
      this.onLog(`重试失败资源 (${this.previousErrors.length} 项)`);
      const unique = [];
      const seen = new Set();
      for (const item of this.previousErrors) {
        if (item.category === 'api-skipped' || item.reason === 'api-skipped') continue;
        const normalized = this.store.normalizeUrl(item.url, this.sourceUrl) || item.url;
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        this.downloadedUrls.delete(normalized);
        unique.push(normalized);
      }
      await this.runDownloadPool(unique, 'other', this.sourceUrl);
      return this.finish(url);
    }

    this.onLog(`Phase-1: ${url} → dist`);
    this.onLog(`输出: ${this.outputDir}`);
    if (options.multiPage) this.onLog('多页面模式: 开启');
    this.onProgress({ phase: 'capture', message: 'Playwright 打开页面并监听资源...' });

    this.throwIfAborted();
    const capture = await this.capture.run(url, {
      multiPage: !!options.multiPage,
      onLog: (msg) => this.onLog(msg)
    });
    this.throwIfAborted();

    this.reporter.setNetwork(capture.network);
    this.reporter.writeNetwork();
    this.assetCdnBases = collectAssetCdnBases(capture.network, capture.html || '');
    this.lobbyAssetHints = buildLobbyAssetHints(capture.network);

    if (capture.error) this.onLog(`页面警告: ${capture.error}`);

    if (capture.html) {
      this.templateContext = mergeTemplateContext(capture.html, capture.network);
      if (Object.keys(this.templateContext).length) {
        this.onLog(`皮肤变量: layout=${this.templateContext.layout || '-'} bg=${this.templateContext.bg || '-'} skin=${this.templateContext.skin || '-'}`);
      } else {
        this.onLog('警告: 未能从 HTML/Network 推断皮肤变量，lobby_asset 模板 URL 可能无法展开');
      }
      this.saveIndexHtml(capture.html, capture.htmlSource);
      const parser = new ResourceParser(this.sourceUrl);
      parser.extractFromHtml(capture.html).forEach((u) => this.queueUrl(u));
    }

    const staticEntries = capture.network.filter((e) =>
      this.downloader.isStaticResource(e.resourceType, e.url, e.contentType)
      && !hasUnresolvedTemplate(e.url)
      && isLikelyAssetFile(e.url)
    );

    const critical = staticEntries.filter((e) => /\.(js|mjs|cjs|css)(\?|$)/i.test(e.url) || e.resourceType === 'script' || e.resourceType === 'stylesheet');
    const rest = staticEntries.filter((e) => !critical.includes(e));

    this.onLog(`Network: 关键 ${critical.length}（JS/CSS）+ 其它 ${rest.length}`);
    await this.runDownloadPool(critical, 'other', this.sourceUrl, (done, total) => {
      this.onProgress({ phase: 'download', subPhase: 'network', message: `关键 JS/CSS ${done}/${total}`, current: done, total });
    });

    // 入口 JS 到手后立刻收割 Vite 依赖表，再下 CSS/chunk
    for (const localPath of [...this.savedFiles]) {
      if (/\.(js|mjs|cjs)$/i.test(localPath) && /assets\//i.test(localPath)) {
        await this.parseAndQueueFile(localPath);
      }
    }
    await this.harvestCssAndChunksFromJs();
    if (this.pendingUrls.size > 0) {
      const harvested = [...this.pendingUrls];
      this.pendingUrls.clear();
      this.onLog(`优先下载依赖表资源: ${harvested.length}`);
      await this.runDownloadPool(harvested, 'other', this.sourceUrl, (done, total) => {
        this.onProgress({ phase: 'download', subPhase: 'harvest', message: `依赖表 ${done}/${total}`, current: done, total });
      });
    }

    if (rest.length) {
      await this.runDownloadPool(rest, 'other', this.sourceUrl, (done, total) => {
        this.onProgress({ phase: 'download', subPhase: 'network', message: `其它资源 ${done}/${total}`, current: done, total });
      });
    }

    for (const localPath of [...this.savedFiles]) {
      if (/\.(js|mjs|cjs|css|html?)$/i.test(localPath)) await this.parseAndQueueFile(localPath);
    }

    await this.harvestCssAndChunksFromJs();

    if (this.downloadSkinManifest) {
      this.throwIfAborted();
      await this.downloadFromManifests(capture);
    }

    await this.scanDownloadRounds(this.maxScanRounds);

    await this.harvestCssAndChunksFromJs();
    if (this.pendingUrls.size > 0) {
      await this.scanDownloadRounds(2);
    }

    return this.finish(url);
  }

  async harvestCssAndChunksFromJs() {
    const urls = harvestFromLocalJsTree(this.outputDir, this.sourceUrl);
    let queued = 0;
    let cssCount = 0;
    for (const u of urls) {
      if (/\.css(\?|$)/i.test(u)) cssCount++;
      const before = this.pendingUrls.size;
      this.queueUrl(u);
      if (this.pendingUrls.size > before) queued++;
    }
    this.onLog(`JS 资产收割: 发现 ${urls.length}（其中 CSS ${cssCount}），新入队 ${queued}`);
    this.onProgress({
      phase: 'download',
      subPhase: 'harvest',
      message: `从 JS 收割 CSS/chunk ${queued} 个`,
      current: 0,
      total: queued || 1
    });
  }
}

module.exports = Pipeline;
