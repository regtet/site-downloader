# site-downloader

**Phase-1 目标：** 输入网站 URL → 输出可本地运行的 `dist/` → 自动对比源站效果。

不做：转 Vue、改业务代码、API 替换。

## 环境要求

- Node.js >= 14（推荐 >= 16）
- Playwright Chromium（`npm run install-browsers`）

## 使用

```bash
npm install
npm start
```

浏览器打开 **http://localhost:3000**：

1. 输入目标 URL
2. 点击「生成 dist」
3. 等待：抓取 → 下载 → 路径改写 → **源站对比**
4. 查看 `dist/<host>/diff.json` 与界面上的对比摘要
5. 点击「本地预览」打开 dist

CLI 预览：

```bash
npm run serve -- dist/example.com
```

CLI 单独对比：

```bash
npm run compare -- --source https://example.com --local dist/example.com
```

## 输出结构

```
dist/example.com/
├── index.html       # 主文档 HTML 壳（非水合后 DOM）
├── diff.json        # 源站 vs 本地运行时对比
├── manifest.json    # 资源清单
├── network.json     # Playwright 捕获的 Network
├── report.json      # 统计
├── errors.json      # 失败资源（如有）
└── ...              # 按原站路径保存的资源
```

## 默认策略

1. Playwright 打开页面，监听 Network
2. 保存**主文档网络响应**为 `index.html`（避免水合 DOM 导致双弹框）
3. 下载 Network 静态资源
4. 多轮扫描 JS/CSS 中的相对路径与动态 chunk（如 `index.Caf7Pe_r.js`）
5. 路径改写为本地相对路径
6. Playwright 对比源站与本地 DOM / Network / Console

可选：**下载皮肤清单**（`assets.hash.json`，4000+ 项，默认关闭）

## 模块

| 文件 | 职责 |
|------|------|
| `src/pipeline.js` | Phase-1 主流程编排 |
| `src/capture.js` | Playwright 抓取 + 文档 HTML 壳 |
| `src/asset-store.js` | URL 规范化、去重、按 pathname 落盘 |
| `src/compare.js` | 源站 vs 本地运行时对比 |
| `src/static-server.js` | 本地静态服务（404 不 fallback HTML） |
| `src/skin-manifest.js` | 可选皮肤清单下载 |
| `server.js` | Web UI + API |
| `scripts/compare-runtime.js` | 对比 CLI |
