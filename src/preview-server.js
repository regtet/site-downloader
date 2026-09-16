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

/** @param {boolean} enableAdapter */
function normalizeMode(enableAdapter) {
  return enableAdapter ? 'ours' : 'official';
}

class PreviewManager {
  constructor(options = {}) {
    this.spaFallback = options.spaFallback !== false;
    this.host = options.host || '127.0.0.1';
    this.basePort = options.basePort || 3456;
    this.portSpan = options.portSpan || 100;
    /**
     * key = resolvedSiteDir::official|ours
     * @type {Map<string, object>}
     */
    this.previews = new Map();
  }

  resolveSiteDir(siteDir) {
    return path.resolve(siteDir);
  }

  keyOf(siteDir, mode) {
    const m = mode === 'ours' || mode === 'official' ? mode : 'ours';
    return this.resolveSiteDir(siteDir) + '::' + m;
  }

  nameOf(siteDir) {
    return path.basename(siteDir);
  }

  toPublic(entry) {
    return {
      name: entry.name,
      path: entry.siteDir,
      mode: entry.mode,
      label: entry.mode === 'ours' ? '我们的' : '官方',
      port: entry.port,
      url: entry.url,
      sourceOrigin: entry.sourceOrigin || null,
      adapterEnabled: entry.adapterEnabled === true,
      startedAt: entry.startedAt
    };
  }

  list() {
    return [...this.previews.values()].map((p) => this.toPublic(p));
  }

  listForSite(siteDir) {
    const root = this.resolveSiteDir(siteDir);
    return this.list().filter((p) => p.path === root);
  }

  getInfo(siteDir) {
    if (siteDir) {
      const list = this.listForSite(siteDir);
      return {
        running: list.length > 0,
        previews: list,
        ...(list[0]
          ? {
            port: list[0].port,
            siteDir: list[0].path,
            url: list[0].url,
            sourceOrigin: list[0].sourceOrigin || null,
            mode: list[0].mode,
            adapterEnabled: list[0].adapterEnabled
          }
          : {})
      };
    }
    const list = this.list();
    return {
      running: list.length > 0,
      previews: list,
      ...(list[0]
        ? {
          port: list[0].port,
          siteDir: list[0].path,
          url: list[0].url,
          sourceOrigin: list[0].sourceOrigin || null,
          mode: list[0].mode,
          adapterEnabled: list[0].adapterEnabled
        }
        : {})
    };
  }

  async start(siteDir, options = {}) {
    // UI 明确传 true/false；其它调用（如本地抓包）可省略，交由 StaticServer 按是否有 adapter-hosts 决定
    let enableAdapter;
    if (options.enableAdapter === true) enableAdapter = true;
    else if (options.enableAdapter === false) enableAdapter = false;
    else enableAdapter = undefined;

    const mode = enableAdapter === false ? 'official' : (enableAdapter === true ? 'ours' : 'auto');
    const root = this.resolveSiteDir(siteDir);
    const key = this.keyOf(root, mode === 'auto' ? 'ours' : mode);
    const existing = this.previews.get(key);
    // 同站点同模式：重新拉起，避免旧 boot/adapter
    if (existing) {
      try {
        await existing.server.stop();
      } catch (_) { /* ignore */ }
      this.previews.delete(key);
    }

    const name = this.nameOf(root);
    // 官方 / 我们的 用不同种子，便于同时开两个端口对比
    const preferred = hashPort(name + '::' + mode, this.basePort, this.portSpan);
    const server = new StaticServer({
      spaFallback: this.spaFallback,
      host: this.host
    });
    const info = await server.start(root, preferred, {
      enableAdapter
    });
    const resolvedMode = info.adapterEnabled ? 'ours' : 'official';
    // 若以 auto 启动，按实际是否启用 adapter 归类；可能需要改 key
    if (mode === 'auto') {
      const realKey = this.keyOf(root, resolvedMode);
      if (realKey !== key && this.previews.has(realKey)) {
        try { await this.previews.get(realKey).server.stop(); } catch (_) { /* ignore */ }
        this.previews.delete(realKey);
      }
    }
    const entry = {
      server,
      siteDir: root,
      name,
      mode: resolvedMode,
      port: info.port,
      url: info.url,
      sourceOrigin: info.sourceOrigin || '',
      adapterEnabled: !!info.adapterEnabled,
      startedAt: new Date().toISOString()
    };
    const finalKey = this.keyOf(root, resolvedMode);
    this.previews.set(finalKey, entry);
    if (finalKey !== key) this.previews.delete(key);
    return {
      ...this.toPublic(entry),
      reused: false
    };
  }

  async stop(siteDir, options = {}) {
    if (!siteDir) {
      return this.stopAll();
    }
    const root = this.resolveSiteDir(siteDir);
    const mode = options.mode;
    if (mode === 'ours' || mode === 'official') {
      const key = this.keyOf(root, mode);
      const entry = this.previews.get(key);
      if (!entry) return { stopped: false, previews: this.list() };
      await entry.server.stop();
      this.previews.delete(key);
      return { stopped: true, path: root, mode, previews: this.list() };
    }
    // 未指定 mode：关掉该站点全部模式
    let n = 0;
    for (const m of ['official', 'ours']) {
      const key = this.keyOf(root, m);
      const entry = this.previews.get(key);
      if (!entry) continue;
      await entry.server.stop();
      this.previews.delete(key);
      n += 1;
    }
    return { stopped: n > 0, path: root, count: n, previews: this.list() };
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
module.exports.normalizeMode = normalizeMode;
