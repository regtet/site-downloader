# site-downloader

**目标：** 输入网站 URL → 下载完整前端包 → 自动对比源站效果 → 生成接入自有后端的部署包。

工具不重写目标站 Vue/React 业务代码。第二步通过 Migration Bridge 做接口映射、响应结构适配、登录态与官方只读配置回源。

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
6. 点击「替换接口」生成 `output/<siteId>/` 部署包；原始包会归档到 `input/<siteId>/`

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

执行第二步后：

```text
input/<siteId>/                 # 原始下载包
output/<siteId>/                # 可部署的接口替换包
├── adapter-hosts.json          # 系列、回源与 WGame 冻结连接配置
├── migration-manifest.json     # 映射清单与生成信息
├── oss-game-list.json          # 构建时冻结的游戏目录
└── ...                         # 官方 UI 静态资源
```

默认会保留该站点上次生成时的 WGame 环境快照，避免工作区切换分支后把已部署站点误绑到别的登录服或游戏域。确实需要重新绑定当前 WGame 环境时，显式设置 `WGAME_REBIND_ON_MIGRATE=1` 后再执行替换接口。

## 回归验证

```bash
npm run verify-p0 -- 719win
npm run verify-contract-fixtures
node scripts/smoke-bridge-routes.js 719win
node scripts/scan-dist-api-gaps.js 719win
npm run verify-download-routing
```

`verify-p0` 默认不会创建外部账号。只有显式设置 `WGAME_REGISTER_PROBE=1` 才运行注册探针；实网登录验证通过 `WGAME_TEST_ACCOUNT` 和 `WGAME_TEST_PASSWORD` 临时传入。

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
