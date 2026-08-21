const path = require('path');
const { StaticServer } = require('./static-server');

function hashPort(seed, base = 3456, span = 100) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return base + (Math.abs(h) % span);
}

class PreviewManager {
  constructor(options = {}) {
    this.spaFallback = options.spaFallback !== false;
    this.host = options.host || '127.0.0.1';
    this.basePort = options.basePort || 3456;
    this.portSpan = options.portSpan || 100;
    /** @type {Map<string, { server: StaticServer, siteDir: string, name: string, port: number, url: string, sourceOrigin: string, startedAt: string }>} */
    this.previews = new Map();
  }

  keyOf(siteDir) {
    return path.resolve(siteDir);
  }

  nameOf(siteDir) {
    return path.basename(siteDir);
  }

  list() {
    return [...this.previews.values()].map((p) => ({
      name: p.name,
      path: p.siteDir,
      port: p.port,
      url: p.url,
      sourceOrigin: p.sourceOrigin || null,
      startedAt: p.startedAt
    }));
  }

  getInfo(siteDir) {
    if (siteDir) {
      const entry = this.previews.get(this.keyOf(siteDir));
      return entry
        ? {
          running: true,
          name: entry.name,
          path: entry.siteDir,
          port: entry.port,
          url: entry.url,
          sourceOrigin: entry.sourceOrigin || null
        }
        : { running: false };
    }
    const list = this.list();
    return {
      running: list.length > 0,
      previews: list,
      // 兼容旧单实例字段：取最近一个
      ...(list[0]
        ? {
          port: list[0].port,
          siteDir: list[0].path,
          url: list[0].url,
          sourceOrigin: list[0].sourceOrigin || null
        }
        : {})
    };
  }

  async start(siteDir) {
    const key = this.keyOf(siteDir);
    const existing = this.previews.get(key);
    if (existing) {
      return {
        name: existing.name,
        path: existing.siteDir,
        port: existing.port,
        url: existing.url,
        sourceOrigin: existing.sourceOrigin || null,
        reused: true
      };
    }

    const name = this.nameOf(siteDir);
    const preferred = hashPort(name, this.basePort, this.portSpan);
    const server = new StaticServer({
      spaFallback: this.spaFallback,
      host: this.host
    });
    const info = await server.start(siteDir, preferred);
    const entry = {
      server,
      siteDir: key,
      name,
      port: info.port,
      url: info.url,
      sourceOrigin: info.sourceOrigin || '',
      startedAt: new Date().toISOString()
    };
    this.previews.set(key, entry);
    return {
      name,
      path: key,
      port: entry.port,
      url: entry.url,
      sourceOrigin: entry.sourceOrigin || null,
      reused: false
    };
  }

  async stop(siteDir) {
    if (!siteDir) {
      return this.stopAll();
    }
    const key = this.keyOf(siteDir);
    const entry = this.previews.get(key);
    if (!entry) return { stopped: false, previews: this.list() };
    await entry.server.stop();
    this.previews.delete(key);
    return { stopped: true, path: key, previews: this.list() };
  }

  async stopAll() {
    const keys = [...this.previews.keys()];
    for (const key of keys) {
      const entry = this.previews.get(key);
      if (entry) await entry.server.stop();
      this.previews.delete(key);
    }
    return { stopped: true, count: keys.length, previews: [] };
  }
}

module.exports = PreviewManager;
module.exports.StaticServer = StaticServer;
module.exports.hashPort = hashPort;
