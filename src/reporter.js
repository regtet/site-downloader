const fs = require('fs');
const path = require('path');

class Reporter {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.resources = [];
    this.missing = [];
    this.errors = [];
    this.network = [];
    this.source = null;
  }

  addResource(entry) {
    this.resources.push(entry);
  }

  addMissing(entry) {
    this.missing.push(entry);
  }

  addError(entry) {
    this.errors.push(entry);
  }

  setNetwork(entries) {
    this.network = entries;
  }

  writeManifest(sourceUrl) {
    this.source = sourceUrl;
    const manifest = {
      source: sourceUrl,
      createdAt: new Date().toISOString(),
      resources: this.resources,
      missing: this.missing,
      errors: this.errors
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
    const stats = {
      total: this.resources.length + this.errors.length,
      success: this.resources.filter(r => r.status >= 200 && r.status < 400).length,
      failed: this.errors.length,
      missing: this.missing.length
    };

    const statusCounts = {};
    for (const err of this.errors) {
      const key = String(err.status || 'error');
      statusCounts[key] = (statusCounts[key] || 0) + 1;
    }

    const report = {
      ...stats,
      statusBreakdown: statusCounts,
      localCheck: checkResult || null,
      generatedAt: new Date().toISOString()
    };

    const filePath = path.join(this.outputDir, 'report.json');
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    return report;
  }

  getSummary(outputDir) {
    return {
      outputDir,
      source: this.source,
      resources: this.resources.length,
      failed: this.errors.length,
      missing: this.missing.length,
      errors: this.errors,
      report: {
        total: this.resources.length + this.errors.length,
        success: this.resources.filter(r => r.status >= 200 && r.status < 400).length,
        failed: this.errors.length
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
