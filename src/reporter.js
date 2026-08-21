const fs = require('fs');
const path = require('path');
const { lobbyAssetLocalPath, lobbyAssetStemKey } = require('./url-classify');

class Reporter {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.resources = [];
    this.missing = [];
    this.errors = [];
    this.network = [];
    this.source = null;
    this.unresolved = [];
    this.integrity = null;
  }

  addResource(entry) {
    this.resources.push(entry);
  }

  addMissing(entry) {
    this.missing.push(entry);
  }

  addError(entry) {
    const key = lobbyAssetStemKey(lobbyAssetLocalPath(entry.url) || entry.url) || entry.url;
    if (this.errors.some((e) => (lobbyAssetStemKey(lobbyAssetLocalPath(e.url) || e.url) || e.url) === key)) return;
    this.errors.push(entry);
  }

  addUnresolved(entry) {
    this.unresolved.push(entry);
  }

  setNetwork(entries) {
    this.network = entries;
  }

  setIntegrity(integrity) {
    this.integrity = integrity;
    const seen = new Set(this.unresolved.map((item) => item.url || item.ref));
    for (const item of (integrity && integrity.unresolvedUrls) || []) {
      const url = item.ref;
      if (seen.has(url)) continue;
      seen.add(url);
      this.unresolved.push({
        url,
        from: item.from,
        reason: item.reason,
        kind: item.kind
      });
    }
  }

  staticFailures() {
    return this.errors.filter((err) => err.category !== 'api-skipped' && err.category !== 'optional-missing');
  }

  writeManifest(sourceUrl) {
    this.source = sourceUrl;
    const manifest = {
      source: sourceUrl,
      createdAt: new Date().toISOString(),
      resources: this.resources,
      missing: this.missing,
      errors: this.errors,
      unresolved: this.unresolved,
      brokenReferences: this.integrity ? this.integrity.brokenReferences : [],
      missingAssets: this.integrity ? this.integrity.missingAssets : [],
      urlMap: this.resources.map((item) => ({ url: item.url, local: item.local }))
    };
    const filePath = path.join(this.outputDir, 'manifest.json');
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
    return manifest;
  }

  writeNetwork() {
    const filePath = path.join(this.outputDir, 'network.json');
    fs.writeFileSync(filePath, JSON.stringify(this.network, null, 2));
  }

  writeErrors() {
    const filePath = path.join(this.outputDir, 'errors.json');
    if (this.errors.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    fs.writeFileSync(filePath, JSON.stringify(this.errors, null, 2));
  }

  writeReport(checkResult) {
    const staticFailed = this.staticFailures();
    const stats = {
      total: this.resources.length + staticFailed.length,
      success: this.resources.filter(r => r.status >= 200 && r.status < 400).length,
      failed: staticFailed.length,
      missing: this.missing.length,
      unresolved: this.unresolved.length,
      brokenReferences: this.integrity ? this.integrity.brokenReferences.length : 0,
      missingAssets: this.integrity ? this.integrity.missingAssets.length : 0,
      apiSkipped: this.errors.filter((err) => err.category === 'api-skipped').length
    };

    const statusCounts = {};
    for (const err of staticFailed) {
      const key = String(err.status || 'error');
      statusCounts[key] = (statusCounts[key] || 0) + 1;
    }

    const report = {
      ...stats,
      statusBreakdown: statusCounts,
      localCheck: checkResult || null,
      unresolvedUrls: this.unresolved,
      brokenReferences: this.integrity ? this.integrity.brokenReferences : [],
      missingAssets: this.integrity ? this.integrity.missingAssets : [],
      generatedAt: new Date().toISOString()
    };

    const filePath = path.join(this.outputDir, 'report.json');
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    return report;
  }

  getSummary(outputDir) {
    const staticFailed = this.staticFailures();
    return {
      outputDir,
      source: this.source,
      resources: this.resources.length,
      failed: staticFailed.length,
      missing: this.missing.length,
      unresolved: this.unresolved.length,
      brokenReferences: this.integrity ? this.integrity.brokenReferences.length : 0,
      missingAssets: this.integrity ? this.integrity.missingAssets.length : 0,
      errors: staticFailed,
      unresolvedUrls: this.unresolved,
      brokenReferenceItems: this.integrity ? this.integrity.brokenReferences : [],
      report: {
        total: this.resources.length + staticFailed.length,
        success: this.resources.filter(r => r.status >= 200 && r.status < 400).length,
        failed: staticFailed.length
      }
    };
  }

  printSummary(outputDir) {
    const s = this.getSummary(outputDir);
    console.log('');
    console.log('下载完成');
    console.log('');
    console.log('目录:');
    console.log(`  ${s.outputDir}`);
    console.log('');
    console.log(`资源: ${s.resources} 个`);
    console.log(`失败: ${s.failed} 个`);
    if (s.missing > 0) {
      console.log(`缺失: ${s.missing} 个`);
    }
    console.log('');
  }
}

module.exports = Reporter;
