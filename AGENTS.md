# AGENTS.md — dsh-2sidebar

本文件约束在本仓库工作的 AI 与协作者。约定变化时同步更新本文件。

## 项目定位

- 这是一个**单个可安装的 DSH 客户端插件 bundle**（外部 bundle，不在官方 `packages/*` monorepo 里）。
- 仓库根目录 = npm 包根目录 = 安装目标；**没有构建步骤**。
- 动手前先读：[README.md](README.md)、[package.json](package.json)、[cordis.patch.yml](cordis.patch.yml)、[client.js](client.js)。

## 可以做什么

- 在根目录维护 bundle：`client.js`、`index.js`、`package.json`、`cordis.patch.yml`、`locale/`、`icon.svg`。
- 用 DSH 宿主能力：`ctx.slots.*`、`ctx.remote.workspaceFiles`、`ctx.locale`、框架标准 `useSessions` prop、`ctx.sidebarRight*`。
- 样式使用宿主语义 token（`--dsw-alias-*`）；文案使用 locale 字典。
- 维护文档：`README.md` / `README.zh.md`、`CHANGELOG.md`、`docs/release-notes/<version>.md`、`docs/screenshot-split-files.png`。
- 做小范围、可回滚的改动；改行为时同步更新 CHANGELOG、README 和对应 release note。

## 不能做什么

- **不要重新引入** `plugin/`、`packages/`、`notes/`、`tools/`、`docs/releases/`（旧目录；发布说明统一放 `docs/release-notes/`）；不要保存运行文件的第二份副本。做减法，不做加法。
- **不要加构建链**（TypeScript、打包器、生成目录）；`client.js` 就是部署产物。除非用户明确要求并同时更新本文件。
- **不要加 npm 运行时依赖**；React 和 DSH client primitives 来自宿主的模块表。
- **不要 `require` 其他 Harness 客户端插件包**，也不要为此添加 `dsh.client.external`。
- **不要新增 Host 路由或权限**；文件读取只走 `ctx.remote.workspaceFiles`。
- **不要改包身份**：`package.json.name` = `client.js` loader `id` = `cordis.patch.yml` 行 `name`，三者必须一致。
- **不要改兼容性持久化标识**：tab `kind: 'split-files'`、`dsh-2sidebar.ratio`、`dsh-2sidebar.tree-hidden`，以及 legacy `dsh-split-files.*` 回退。改了会让已保存布局失效。
- **不要移动、删除或 force-push 已发布 tag**；不要在没有用户明确批准时 push tag 或 publish npm。
- **不要把未修复的“已知缺口”写成已支持**（见文末清单）。
- 不要把临时审查、调试报告、一次性文档放进仓库；`.agents/` 是本地忽略目录，不提交、不在其中写笔记。

## 要怎么做

### 改代码

- `client.js` 保持懒工厂：`window.__ModuleLoader__.load({ id, factory(require) { return { inject, apply } } })`。
- factory 内**不要有副作用**；所有注册、样式、监听器、定时器都在 `apply` 里通过 `ctx.effect` 创建并返回 disposer。
- 文件访问统一用 `ctx.remote.workspaceFiles.list/read/readBytes`，第一个参数是 `sessionId`。
- 可见文案同时改两处：`client.js` 内联字典和 `locale/*.json` 的 `meta`；中英文 README 保持同步。
- 保持 `client.js` 单文件；确实需要拆分时先征得用户同意，并更新本文件。

### 验证（声称“改好了”之前必须跑）

```powershell
node --check client.js
npm test
npm pack --dry-run
```

- `npm test` 跑 `test/` 下无第三方依赖的 bundle/manifest 测试；PR 与 main 的 CI 跑同一组（`.github/workflows/ci.yml`）。

- `npm pack --dry-run` 只应包含：`package.json`、`README*.md`、`LICENSE` 和运行文件（`index.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`）。
- DSH 侧验证：

```powershell
dsh plugin --profile <profile> add "link:<repo>"
dsh --profile <profile> --dump-config    # 应出现 "# == dsh-2sidebar" 层
```

- 在交接说明里写清楚：跑了哪些检查、对哪个 DSH 版本验证过。

### 发布与打 tag

1. 升版本：`package.json.version`，并在 `CHANGELOG.md` 加对应条目。
2. 写发布说明：`docs/release-notes/v<version>.md`，单文件中英双语，固定结构参考 `docs/release-notes/v0.1.2.md`：
   `# dsh-2sidebar v<version>` → 一段概要 → 语言链接 → `---` → `新增/改进/修复`（按需）→ `安装` → `限制` → CHANGELOG 链接 → `## English` 镜像。
   已发布版本的说明只做事实纠错，不重排结构。
3. 提交代码与文档。
4. 打 **annotated tag**，用文件而不是 `-m`：

   ```powershell
   git tag -a v<version> -F docs/release-notes/v<version>.md
   ```

   用 `-F` 是为了保证 tag message 与 Release 正文使用同一份 Markdown；`-m` 只适合一句话，不适合多段说明。

5. Push 并发布：

   ```powershell
   git push origin main
   git push origin refs/tags/v<version>
   ```

   `publish.yml` 会校验 tag 与 `package.json.version` 一致，然后发布带 provenance 的 npm 包。

6. **创建 GitHub Release**（`publish.yml` 只发 npm，不会自动建 Release；网页上能看 Markdown 改动信息的是 Release 正文，不是 tag annotation）。必须先推送 tag，再用 `--verify-tag` 绑定到已推送的 tag，避免在默认分支上新建一个错误 tag：

   ```powershell
   gh release create v<version> --verify-tag --title "dsh-2sidebar v<version>" `
     --notes-file docs/release-notes/v<version>.md --latest
   ```

7. 发布后核对：

   ```powershell
   npm view dsh-2sidebar@<version> version dist.tarball --json
   ```

   并比对 npm tarball 的 `client.js` git blob 与 `<tag>:client.js`；0.1.2 起还应核对 SLSA provenance 的 `gitCommit` 等于 tag 指向的提交。

8. 已发布 tag 永不移动；发布出错时发新的 patch 版本并 `npm deprecate` 旧版本。

## 目录结构

```text
dsh-2sidebar/
├── package.json            # 包身份 + dsh.bundle/dsh.client + engines.dsh
├── index.js                # 空 Host 半侧：name + apply
├── client.js               # 浏览器 bundle（__ModuleLoader__ 工厂）
├── cordis.patch.yml        # 一行 bundle row
├── locale/{en,zh}.json     # 插件管理器展示元数据
├── icon.svg
├── README.md / README.zh.md
├── CHANGELOG.md
├── LICENSE
├── AGENTS.md               # 本文件
├── docs/
│   ├── screenshot-split-files.png
│   └── release-notes/<version>.md
├── test/                   # 无依赖的 bundle/manifest 测试
├── .github/workflows/
│   ├── ci.yml              # PR/main 检查
│   └── publish.yml         # tag 发布（provenance）
└── .agents/                # 本地忽略，不提交
```

## 已知缺口（不要当成已支持）

- 分隔条只能拖动，键盘不可操作。
- “加载更多”失败没有行内错误提示。
- 分页请求不可取消。
- locale 字典内联在 `client.js`，`locale/*.json` 只含 `meta`。
- 每页 2000 行可能超过宿主 2 MiB 页上限（长行文件）。
- 测试只覆盖 bundle 注册契约、header 打开路径与 manifest/版本一致性；目录树、预览与拖拽的交互行为仍未覆盖。

修好其中一项时：删除对应条目，并同步更新 README 的说明与 `CHANGELOG.md`。
