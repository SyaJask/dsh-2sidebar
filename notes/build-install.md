# 本地 bundle 的打包 / 安装 / 热加载 / 验证链路

研究任务：task-2（owner: install-researcher）。所有结论基于**只读**检查：读取 `app.asar` 内实现、
profile 文件、运行中 Host 的只读 HTTP 通道和窗口截图。**没有安装任何插件，没有修改 `C:\Users\Kaw0n\.dsh`，
没有重启 App。**

环境事实：DSH Desktop `0.2.1-rc.3`（build commit `be72761`），CLI `0.2.1-rc.3`，pnpm `11.28.5`，
Desktop Host 每次启动随机端口（本次 `127.0.0.1:25039`），窗口渲染进程 pid 21888，窗口标题
`为 dsh 创建目录分栏插件 — DeepSeek Harness`。

---

## 0. TL;DR（先看这段）

1. **bundle = 带 `dsh.bundle.patch` 的 npm 包**；客户端 bundle 再加 `dsh.client{platform:"web",...}` 和 `./client` 导出。
   清单可照抄 §1 的模板。
2. **安装 = 让包能从 profile 解析到 + 把包名加入 `dsh.profile.bundles`**。官方路径是
   `dsh.cmd plugin --profile desktop add "link:<绝对路径>"`（内部就是 `pnpm add` + 回写 bundles 列表）。
3. **不需要重启 App，正常也不需要硬刷新**：Host 的 HMR 在 profile `package.json` 的 bundles 列表变化时
   原地重组（`dsh-hmr`），浏览器侧由 SSE `/plugins/events` 推 graph，`dsh-client-hmr` 让已打开页面加载新插件。
   只有加/换 bundle 时例外的是"替换已安装包"和 DSH 本体 release 变化。
4. **验证不靠 UIA**：Chromium 无障碍没开，`WM_GETOBJECT` 也唤不醒（实测）。最靠谱的是
   ① 窗口截图 + 视觉读图（`tools/capture-window3.ps1`，已实测可用）
   ② 只读 HTTP：`GET http://127.0.0.1:<host端口>/plugins/events` 拿当前浏览器插件图，直接看新插件 id 是否在列
   （脚本：`notes/scripts/check-profile-state.ps1`）。
5. **回滚**：`dsh plugin --profile desktop remove <name>`，或 `notes/scripts/uninstall-local-bundle.ps1 -Apply`（junction 路线）。
6. ⚠️ **当前 profile 里 `dsh-better-sidebar` / `@linxin666/dsh-web-all` / `@hyzyn/dsh-profile` / `dsh-at-file` / `dsh-plugin`
   只是 dependencies，并不在 `dsh.profile.bundles` 里，实测也**没有**加载**（见 §4.3）。`cordis.patch.yml` 里针对
   `better-sidebar` 等 id 的覆盖行因此是**惰性的**（patch 不带 `insert:` 只能覆盖已存在的行）。不要基于"better-sidebar 已在跑"做设计假设。

---

## 1. bundle 清单契约（可直接照抄）

### 1.1 客户端 bundle 模板（装饰器，最小可用）

`package.json`（对应 `ref/preset-skills/cordis-plugin-development/templates/decoration/package.json:1-21`）：

```json
{
  "name": "@local/<your-bundle>",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

`cordis.patch.yml`（同模板 `templates/decoration/cordis.patch.yml:1-3`）：

```yaml
- insert:
    - id: <row-id>              # 建议与包名相同
      name: '@local/<your-bundle>'   # = package.json name，必须是包名
      config: {}                # 可选；有 Config 的插件才需要
```

`index.js`（Host 半边，可空）：`export function apply() {}`（模板 `index.js:1-2`）。
`client.js`（浏览器半边，模板 `client.js:1-22` 是完整可跑样例）：

```js
window.__ModuleLoader__.load({
  id: '@local/<your-bundle>',   // 必须等于包名
  factory(require) {
    const React = require('react');
    return { inject: ['slots'], apply(ctx) { /* ctx.slots.inject / ctx.slots.register */ } };
  },
});
```

### 1.2 字段要求与证据

| 字段 | 要求 | 证据 |
| --- | --- | --- |
| `name` | bundle 的唯一身份；`cordis.patch.yml` 的 `insert[].name`、`client.js` 的 `load({id})`、`dsh.client.external` 的引用都用它 | `references/host-plugin.md:5-6`、`references/ui-plugin.md:9`、`dsh-client-modules/lib/index.js:92-95` |
| `type` | `"module"`（ESM；Host 半边用 `export function apply` 或默认导出 service class） | `host-plugin.md:6,57-63` |
| `exports["."]` | Host 入口（被 Loader 以包名 import） | `host-plugin.md:12`、`ui-plugin.md:3` |
| `exports["./client"]` | 浏览器入口；缺失则客户端半边不会加载 | `ui-plugin.md:3`、`dsh-client-modules/lib/index.js`（combo 路由）|
| `exports["./locale/*.json"]`、`exports["./icon"]` | Plugin Manager/设置页展示用；缺失回退到 `package.json` 的 `name`/`description` 与默认插画 | `host-plugin.md:31-51` |
| `files` | 打包/发布时过滤；**link: 安装不生效**（目录直接链接，`files` 不过滤目录） | `host-plugin.md:35` |
| `dsh.bundle.patch` | 一个文件或**有序文件列表**；相对包目录 | `host-plugin.md:15`、`app-boot/lib/index.js:493-494,529-531` |
| `dsh.client.platform` | 本窗口只服务 `"web"`；必须是字符串 | `dsh-client-modules/lib/index.js:66-75` |
| `dsh.client.inject` | 依赖的客户端插件 id 列表（如 `@deepseek-ai/dsh-client-ui-conversation`、`...-ui-slots`、`...-client-locale`） | `ui-plugin.md:3,11` |
| `dsh.client.external` | 基座模块表之外的运行时 import（精确说明符）；基座（react 等）已在冻结模块表里，不用写 | `client-modules/README.zh.md:38,49`、`index.js:413-438` |
| `dsh.client.immediately` | boolean；true 时页面启动即挂载该客户端行（不等 slot 延迟声明） | `index.js:69,74,408-409` |
| `icon` | 可选：`package.json` 顶层 `icon`（优先）或 `exports["./icon"]`；SVG/PNG/JPEG/WebP，≤256 KiB，必须在包内，禁绝对路径/URL/出包软链 | `host-plugin.md:51` |
| locale meta | `locale/en.json`、`locale/zh.json` 的 `{ "meta": { "title", "description" } }` | `host-plugin.md:31-42`、`templates/decoration/locale/en.json:1-6` |
| `dsh.manifestVersion` | 已发布的 `dsh-better-sidebar` 里有 `"manifestVersion": 1`，但本版本 `dsh-app-boot` / `plugin-manager` / `client-modules` **都不读它**（grep NO MATCH）→ 可选，别依赖 | `node_modules/dsh-better-sidebar/package.json:53`；asar grep 结果 |
| 兼容性 | 声明 `engines.dsh` 则单独决定；否则每个 `@deepseek-ai/dsh*` peer 都要匹配运行时 `0.2.1-rc.3`（`includePrerelease`）。**本地自用 bundle 最省事：不写 peers/engines** | `app-boot/lib/index.js:252-317` |
| 副作用 | 工厂函数（factory）里不要有副作用；资源用 `ctx.effect`/`ctx.on` 注册并返回清理；不要替换 app root | `ui-plugin.md:5-13` |

Host-only bundle 可以更简单（无 dependencies/exports/client）：见 `host-plugin.md:7-27`。

---

## 2. 安装链路

### 2.1 `dsh plugin` 子命令是什么

`dsh.cmd` 用 Electron 的 Node 模式运行打包在 asar 里的 CLI：

```
ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --expose-internals ...\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js %*
```
（`D:\apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd:1-5`）

`dsh plugin --help` 实测输出（只读执行）：

```
Usage: dsh plugin [options] [args...]

manage a profile's plugins by forwarding the remaining arguments to pnpm in the
profile directory

Arguments:
  args              pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>,
                    why <pkg>, ...)

Options:
  --profile <name>  the profile whose plugins to manage (initialized on first
                    use)
  -h, --help        show this help
```

要点（`dsh/lib/bin.js` plugin 分支 + `dsh/lib/plugin-BiveYA7h.js`）：

- 只接受 `--profile <name>` + 透传给 pnpm 的参数；`desktop` profile 只有在 Desktop 自带 CLI
  （`manageDesktopProfile: true`）下才允许，普通 `dsh` 会拒绝（`rejectElectronProfile`）。
- 实际调用 `runPlugin` → **对 `<profile>/package.json` 加文件锁** → `runProfilePnpm(...)`（`plugin-BiveYA7h.js` `runPlugin`）。
- 兼容性拒绝会打印精确的 `allow-version` 命令；失败会打印 `dsh: plugin command failed; diagnostics: <logPath>`。
- 相对路径 `./x`、`../x` 会按**调用目录**锚定成绝对路径（`operations.js:70-77` `anchorPathSpec`），
  `file:`/`link:` 前缀保留原样。

### 2.2 `install_bundle` / `runProfilePnpm` 内部实际做了什么

服务端 `installBundle(spec, opts)`（`dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js:1970-2100`）：

1. `hmr` 存在且 spec 指向已安装依赖 → 直接 `already-installed` 拒绝（替换已装包要先卸载）。
2. 可选 `approvedBuilds` → 写 `pnpm-workspace.yaml` 的 `allowBuilds`。
3. 快照 `package.json` + `pnpm-lock.yaml`（`RESTORED_FILES`，`index.js:1292`），失败/取消会恢复。
4. git 源先做 `git ls-remote` 连通性检查（本地路径/registry 跳过）。
5. 在 profile 目录执行 `pnpm add <spec> [--save-exact] [--registry=...]`（`execution:"service"` 捕获输出，
   写入 `<profile>/.plugin-manager/logs/operation-*/pnpm.log`）。
6. 成功后确认"新增的依赖恰好一个""有 `dsh.bundle`""兼容性通过"，再 `loadOverlayPatches` 预校验 patch 文件。
7. `selectBundle(name, true)` 把名字写进 `dsh.profile.bundles`，然后 `publishAndReload`/`reload`：
   有 HMR 就 `hmr.reconcileProfile(...)` 原地重组，没有 HMR 则返回 `restart-required`（`index.js:2360-2382`）。

命令行路径 `runProfilePnpm`（`dsh-plugin-manager/lib/types/operations.js:299-561`）与上面共用，
关键差异是成功后调用 **`reconcile(before, dir, anchor, options)`**（`operations.js:96-121`）：

- 从 `dsh.profile.bundles` 中删掉"已不是依赖、也不是安装自带"的名字；
- 遍历新增的直接依赖，有 `dsh.bundle.patch` 的**追加到 bundles 列表**并预解析 patch；没有的只警告
  `declares no dsh.bundle — installed as a plain dependency, not a profile layer`；
- 只有 bundles 列表真的变化时才 `saveManifest`（2 空格缩进 + 末尾换行，`operations.js:92-94`）。

**结论：`dsh plugin add` 对 profile 的写入 = `dependencies` 新增一条 + `dsh.profile.bundles` 追加（+ pnpm 自己写的
`pnpm-lock.yaml`、`node_modules`、必要时 `pnpm-workspace.yaml`、`.plugin-manager/logs/*`）。它不会写 `cordis.patch.yml`**
（bundle 自己的 patch 文件才是层，profile patch 只用于覆盖/用户层）。

### 2.3 把本地目录装进 desktop profile 的确切命令

```bat
:: 官方路径（= plugin_manager install_bundle 的 CLI 等价物）
"D:\apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:D:\ai2all\projects\personal\dsh-2sider\plugin"

:: 只读核查
"D:\apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop why <包名>
"D:\apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop list --depth 0

:: 卸载
"D:\apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove <包名>
```

- **`link:` 是开发迭代该用的协议**：`pnpm add link:<abs>` 只建符号链接，源码改动直接可见；
  `file:` 对目录会走 store 拷贝，改源码不会自动生效。
- 实测 pnpm 11.28.5 在 profile 外的最小工程里：`pnpm add "link:D:\...\dir"` 成功、离线可跑，
  写入 `"<name>": "link:D:/ai2all/.../dir"`（正斜杠）并在 `node_modules/` 建链接（本次实验在 `%TEMP%` 的临时工程里做，未碰 profile）。
- 服务端 `installBundle` 的 spec 解析要求**本地路径必须是绝对路径**（`lib/types/install-spec.js:69-92`）；CLI 会把
  `./x`、`../x` 相对**调用目录**补成绝对路径（`operations.js:70-77`），但**用 `link:<绝对路径>` 最稳**。
- 有 HMR 时对已安装包再 `add` 同一包会被拒绝（`already-installed`），升级要 `remove` 再 `add`（`plugin-manager/README.zh.md:100`）。

### 2.4 副作用与注意点（别破坏现有 bundles / patch）

| 文件（profile 内） | 何时被改 | 注意 |
| --- | --- | --- |
| `package.json` | 依赖 + `dsh.profile.bundles` | 保留其它字段；插件管理器按 2 空格重写。列表顺序 = 层顺序（后 = 更高优先级） |
| `pnpm-lock.yaml` | `pnpm add/remove` | 依赖变化后别再用 `--frozen-lockfile` 假设；跨 registry 安装后换源可能报 `ERR_PNPM_TARBALL_URL_MISMATCH`（`plugin-manager/README.zh.md:140`） |
| `node_modules/` | `pnpm add/remove` | hoisted 布局，pnpm 可能顺带修正/剪枝，**这是官方路径最大的风险点**；已有第三方插件（better-sidebar 等）体积大，重装耗时 |
| `pnpm-workspace.yaml` | 只在你批准 build scripts 时（`allowBuilds`） | 本地 link 包通常没有 install 脚本，不会碰 |
| `cordis.patch.yml` | **不会**被 `dsh plugin` 改写 | 你自己别乱动；bundle 的行由 bundle patch 提供 |
| `.plugin-manager/logs/operation-*/pnpm.log` | 每次包操作 | 排错就在这；本次 profile 里已有 90+ 个历史操作目录 |
| `.plugin-manager/run.json` | 运行中临时记录 | 进程崩溃会残留；下一次操作最多等 5 秒再报"进程仍在写" |
| `package.json.bak-plugin-manager` | **当前代码不写**（grep 无此字符串） | 历史/人工备份，勿当契约 |

已知本地事实（只读核对）：

- `dsh.profile.bundles` 现有 13 项，全部是 `@deepseek-ai/*`；`dependencies` 里另有 7 项（含 `dsh-better-sidebar`、`@linxin666/dsh-web-all` 等）。
- `cordis.patch.yml` 4392 字节、19 个覆盖条目（`better-sidebar`、`ui-theme`、`web-ui-pet`…），**没有 `insert:`**。
- 因为 `loadProfileDirectory` 只按 `dsh.profile.bundles` 逐层解析（`app-boot/lib/index.js:1015-1053`），
  未在列表中的第三方包不会成为层；它们的覆盖行没有匹配行可覆盖，实测也确实没有生效（§4.3）。
- 结论：**想用实验把本地插件装进去时，追加一个 bundle 名即可，不必也不应该去动 cordis.patch.yml**。

### 2.5 没有 `plugin_manager` 工具时的等价手工步骤（本会话即如此）

按"风险从低到高"给两条路：

#### 路线 A（推荐，脚本已备好）：junction + 清单两处修改，不跑 pnpm

`notes/scripts/install-local-bundle.ps1`（默认 `-DryRun`，`-Apply` 才写）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\install-local-bundle.ps1 `
  -PluginDir D:\ai2all\projects\personal\dsh-2sider\plugin          # 只打印计划
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\install-local-bundle.ps1 `
  -PluginDir D:\ai2all\projects\personal\dsh-2sider\plugin -Apply   # 用户批准后执行
```

它只做三件事（全部在 profile 内，写前备份到 `%TEMP%\dsh-profile-backup-<时间戳>`）：

1. `New-Item -ItemType Junction <profile>\node_modules\<name> -> <plugin dir>`（等价于 `pnpm add link:` 建的那条链接，
   但不重解析/剪枝现有 node_modules）；
2. `dependencies[<name>] = "link:D:/.../plugin"`；
3. `dsh.profile.bundles` 追加 `<name>`（**这一步才会触发 Host HMR 重组**）。

手工等价命令（若不用脚本）：

```powershell
cmd /c mklink /J "C:\Users\Kaw0n\.dsh\profiles\desktop\node_modules\@local\my-bundle" "D:\ai2all\projects\personal\dsh-2sider\plugin"
# 然后编辑 profile\package.json：
#   dependencies 里加 "@local/my-bundle": "link:D:/ai2all/projects/personal/dsh-2sider/plugin"
#   dsh.profile.bundles 数组末尾加 "@local/my-bundle"
# 用 notes/scripts/profile-manifest.mjs 改更稳（保留格式 + 原子写）：
node notes\scripts\profile-manifest.mjs add-bundle "C:\Users\Kaw0n\.dsh\profiles\desktop" "@local/my-bundle" "link:D:/ai2all/projects/personal/dsh-2sider/plugin"
```

路线 A 的取舍：
- ✅ 不跑 pnpm、不动 lockfile、不剪枝 node_modules，对现有 7 个依赖零影响；
- ✅ 完全可逆（`uninstall-local-bundle.ps1`）；
- ⚠️ `pnpm-lock.yaml` 不会有这个 importers 条目，之后某次 `pnpm install` 会把它补上/或剪掉这个 junction
  （所以正式收尾建议走一次路线 B，或至少在收尾时执行 `dsh plugin install`）；
- ⚠️ 只适合**自身没有运行时依赖**的 bundle（我们的场景：客户端插件依赖由宿主模块表提供，零依赖）。

#### 路线 B（官方）：`dsh plugin add`

风险点：会跑 pnpm 重装/剪枝 profile 的 `node_modules`，耗时且可能顺带改变其他插件；DSH 自己的
`requireDesktopProfile` 文案也建议先完全退出 Desktop 再跑 CLI
（`plugin-BiveYA7h.js`：`...then fully quit it before running dsh plugin --profile desktop.`）。
但"退出 App"就失去 HMR 原地生效的观察机会，且需要重启 App（用户批准）。

> 两条路线都**必须由用户/宿主执行**：本会话的 DSH 文件策略是 workspace-write（写入仅限
> `D:\ai2all\projects\personal\dsh-2sider`），写 `C:\Users\Kaw0n\.dsh` 会被拒绝，且本会话审批已禁用。
> 脚本已把"要写的文件、要建的链接、备份路径"全部打印出来供审阅（默认 DryRun）。

#### 路线 C：宿主工具

如果 Lead 侧有 `plugin_manager` 工具：`install_bundle(spec="<绝对路径或 link:路径>", enabled=true)` 即可，
它内部就是 §2.2 的流程，并返回 activation 结果（`applied` / `restart-required` / `failed`）。`approvedBuilds`
只在用户明确批准 pnpm 报出的 build scripts 后传。

### 2.6 本项目的实际参数（`@local/dsh-split-files`，工作区 `plugin/`）

队友实际产出的 bundle 在 `D:\ai2all\projects\personal\dsh-2sider\plugin\`：

- `plugin/package.json`：`name: "@local/dsh-split-files"`、`dsh.bundle.patch: "./cordis.patch.yml"`、
  `dsh.client{platform:"web", immediately:true, inject:[locale, ui-slots, ui-sidebar-right, client-modules]}`、
  导出 `"."`/`"./client"`/`"./locale/*.json"`/`"./icon"`，含 `icon.svg`；
- `plugin/cordis.patch.yml`：`insert: [{ id: split-files, name: '@local/dsh-split-files', config: {} }]`
  （行 id `split-files` 与包名不同没问题：客户端模块图按**包名**挂浏览器半边，
  见 `ref/plugin-manager/README.zh.md:133` 与 `plugin/client.js:12` 的 `id: '@local/dsh-split-files'`）；
- 目录内容：`client.js`(32 KB)、`index.js`、`locale/en.json`、`locale/zh.json`、`icon.svg`、`README.md`。

已用 `install-local-bundle.ps1` 对它做过 **DryRun**（未写入），三项前置检查全部通过：

```text
package      : @local/dsh-split-files 0.1.0
patch file   : ...\plugin\.\cordis.patch.yml OK
dsh.client   : platform=web immediately=True
node_modules : (will be created as a junction)
```

照此执行（用户批准后）：

```powershell
# 路线 A（推荐先这样验证）：junction + 两处清单修改，不跑 pnpm
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\install-local-bundle.ps1 `
  -PluginDir D:\ai2all\projects\personal\dsh-2sider\plugin -Apply
# 只读确认（自动找 Host 端口，判定客户端行是否激活）
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\check-profile-state.ps1 `
  -PluginId '@local/dsh-split-files'
# 官方路线（会把 link: 依赖写进 package.json 并由 pnpm 回写 bundles 列表）
& "D:\apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add `
  "link:D:/ai2all/projects/personal/dsh-2sider/plugin"
```

注意 `notes/snippets/package.json` 里的 `name: "dsh-2sider"` 是早期草稿，与当前 `plugin/` 的
`@local/dsh-split-files` 不一致；**以 `plugin/package.json` 为准**（安装脚本自动读它，无需手填名字）。

---

## 3. 生效条件：要刷新页面吗？要重启 App 吗？

### 3.1 HMR 是开着的（证据链）

- base 组合包里 HMR 行默认启用，条件是启动器提供 `profileContext`：
  `dsh-base/cordis.patch.yml:27-32`（`disabled: !!js "!ctx.get('profileContext')"`，`config.root: []`）。
- Desktop 启动器确实 provide 了它：`dsh/lib/profile-boot-C14i-8IN.js:302-304`
  （`hostCtx.provide("profileContext", profileContext)`）。
- 浏览器侧传输：`dsh-web-app/cordis.patch.yml:214-219` 挂载 `@deepseek-ai/dsh-client-hmr`。
- `/plugins/events` 实测可连（§4.3），说明 SSE 通道在跑。

### 3.2 时序（装一个新 bundle）

```
profile/package.json 的 dsh.profile.bundles 变化
  → dsh-hmr 的 config 监听（watchConfig(<profile>/package.json)）触发 refresh(true)
      dsh-hmr/lib/index.js:849-873：manifestOnly 时**只有 bundles 列表变了才继续**（:855）
  → hmr.reconcileProfile() 原地重组：停掉受影响 Entry、导入新 bundle、启动新行（index.js:1308-1320）
  → dsh-client-modules 的增量组合把新 Loader 行变成浏览器 graph row
  → /plugins/events 推 {"type":"graph",...} 帧
  → dsh-client-hmr（浏览器）调用 ClientEntries 队列，加载并挂载新客户端模块（无需刷新）
```

文档结论一致：

- `references/host-plugin.md:70`：**"Installing a new bundle can activate through HMR; replacing an installed
  package requires restart to load a fresh JavaScript module generation."**
- `dsh-client-modules/README.zh.md:42`：已打开页面通过 HMR 跟随完整模块图；启用普通插件即新增 Loader 条目。
- `dsh-client-hmr/README.zh.md`：普通插件启停**无需刷新页面或重启 Host**；代码重建替换时 React 状态丢失、
  数据层保留。

### 3.3 判定表

| 变更 | 需要硬刷新页面？ | 需要重启 App？ | 依据 |
| --- | --- | --- | --- |
| 新装一个 bundle（新增依赖 + 追加 bundles） | 不需要（HMR）/ 极端情况刷新即可 | 不需要 | 上节 |
| 修改客户端 `client.js`（linked 目录原地改） | 不需要：`dsh-client-hmr` 每 **500 ms** stat 每行的 `client.js`（mtime/ctime/size 变化）→ `rebuilt` 帧 → 页面替换模块 | 不需要 | `dsh-client-hmr/lib/index.js:1-130`（`pollIntervalMs` 默认 500，`bundleStat`/`publish`） |
| 修改 Host 半边 `index.js` | 不需要 | **通常需要**（见下） | — |
| 替换已安装包（同名换版本/换目录） | — | 需要 | `host-plugin.md:70`、`dsh-hmr/README.zh.md` |
| DSH 本体升级（release.version/commit 变化） | **需要**：页面只应用启动时 release 的图 | 需要（Host 换进程） | `client-modules/README.zh.md:47` |
| HMR 行被禁用 / SSE 流被 Host 重启打断 | 需要刷新才能恢复 | — | `client-modules/README.zh.md:137` |

Host 半边为什么"通常需要重启"：`dsh-hmr` 的 `root: []` 表示不监听源码目录；profile 重组才会比较
"profile 目录 + 已链接包目标"下已加载模块的文件（`dsh-hmr/README.zh.md`"使用本包"第 4 段），
而唯一触发重组的输入是 **profile manifest 的 bundles 列表**或 `cordis.patch.yml`/home patch 的**内容**变化
（`dsh-hmr/lib/index.js:853-873`）。所以：如果只改了 Host 半边而不改任何配置，没有触发点；
想让它在不重启的情况下生效，需要制造一次真实的配置变化（例如在 `cordis.patch.yml` 末尾加一行注释、
或改一个 config 值——这属于写 profile，需要用户批准），重组时会把变化的 Host 模块逐出并用新文件重启该 Entry
（`dsh-hmr/lib/index.js:1308-1353`；"不改配置、直接改源码 → 等重启"）。**对纯 UI 插件（全部逻辑在 client.js）这条不适用。**

### 3.4 只读确认"bundle 已生效"

1. `profile/package.json`：`dependencies["<name>"]` 存在且 `dsh.profile.bundles` 含 `<name>`；
2. `profile/node_modules/<name>` 是链接且指向源码目录（`Get-Item -Force` 的 `LinkType/Target`）；
3. **最硬证据**：`GET http://127.0.0.1:<host端口>/plugins/events` 的 graph 里出现 `<name>`（客户端 bundle）
   —— 脚本 `notes/scripts/check-profile-state.ps1 -PluginId <name>` 自动找端口并判定；
4. `/plugins/<name>/client.js` 能否被 Host 提供（活跃行 200、未选中的包 404——实测 `dsh-better-sidebar` 是 404）；
5. `.plugin-manager/logs/operation-*/pnpm.log`（pnpm 输出）、`hub.log`（**注意：这是旧的 "Plugin Hub" 日志，
   57 行里只有 `system.start` 和失败安装记录，不是 DSH plugin manager 的日志**）；
6. `%USERPROFILE%\.dsh\logs\`：只有启动失败才写 `startup-*.log`（`dsh/lib/bin.js` `reportStartupFailure`），
   本次仅有一条 10-07 的旧日志 → **不能当常规运行日志用**；
7. `dsh --profile desktop --dump-config`：**技术上可行但不算纯只读**——`runDumpConfig` 会走
   `prepareProfile()`，后者每次都会重写 profile 的 `cordis.yml`（固定内容 `[]`，见
   `dsh/lib/profile-boot-C14i-8IN.js:216-221`）；Desktop 自带 CLI 允许 desktop profile（`manageDesktopProfile`），
   普通 `dsh` 会拒绝。文本 dump 能看到各 bundle 层 + 用户层 + `!!js` 原样未求值。**建议只在回滚核查时用，
   并明确告知用户它会 touch `cordis.yml`（内容不变）。**

---

## 4. 验证手段：改完代码 → 看到界面

### 4.1 窗口截图（最可靠，已实测）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\capture-window3.ps1 -Out "$env:TEMP\dsh-shot.png"
```

本次实测输出：`SAVED C:\Users\Kaw0n\AppData\Local\Temp\dsh-9T4e5q\dsh-probe.png (1942 x 1019) at -11,0`，
截图内容就是当前会话界面（含右侧栏）。脚本用 `SetProcessDPIAware` + `CopyFromScreen`，`EnumWindows`
按标题匹配 `DeepSeek Harness`。窗口标题实测 `为 dsh 创建目录分栏插件 — DeepSeek Harness`，
顶层窗口句柄 `0x8049E`、pid **21888**（渲染进程），子窗口：`Chrome_RenderWidgetHostHWND`（名字 "Chrome Legacy Window"）。

Agent 侧拿到图后直接读图判断即可（视觉模型）。这是"改完代码 → 看到界面"的首选闭环：
改 `client.js` → 等 ~1s（HMR 500ms 轮询）→ 截图 → 读图。

### 4.2 UIA / 远程调试：结论是"没有，别浪费时间"

实测（`notes/scripts/uia-accessibility-probe.ps1`）：

- UIA 只能看到 3 个节点：`Pane`(无名) → `Pane`("Chrome Legacy Window") → `Pane`(无名)；**没有 DOM 级节点**。
- 对顶层窗口和 `Chrome_RenderWidgetHostHWND` 各发一次 `WM_GETOBJECT`（`lParam=OBJID_CLIENT=-4`，
  `SendMessageTimeout` + `SMTO_ABORTIFHUNG`）：`rc=0`（消息没被处理/超时），1.5s 后 UIA 仍是 3 个节点。
  → **不重启无法打开 Chromium 无障碍**。要打开只能启动时加 `--force-renderer-accessibility`
  或由 App 调 `webContents.setForceRendererAccessibility(true)`，两者都要重启/改 App，本次禁止。
- 没有 CDP：`lib/main.js` 里没有 `remote-debugging-port` / `appendSwitch` 相关开关（grep 无命中）；
  只有开发模式给 Host 子进程加 `--inspect=127.0.0.1:<port>`（`lib/main.js:3794-3796`，端口来自
  `developmentHostInspectPort(development)`，`:12181`）。实测 `http://127.0.0.1:9222|9229|9333/json/version`
  全部超时，`127.0.0.1:25039/json/version` 是 404。
- 页面 origin 是自定义协议 `dsh-app://app/`（`lib/main.js:7009`），通过 `streamBaseUrl = http://127.0.0.1:<host端口>`
  与 Host 通信（`lib/main.js:12193-12194,12429-12431`）；`dsh-client-hmr` 在 Electron 里走外壳提供的
  `__DSH_TRANSPORT__.fetch` 订阅 SSE（`dsh-client-hmr/README.zh.md` 实现表）。
- 因此**键盘/鼠标坐标注入可行但不建议**（`tools/click.ps1` 存在）：能看到效果，但拿不到文本断言。
  截图 + 视觉读图比坐标点击更稳。

### 4.3 只读 HTTP 通道（本次新发现，强烈推荐）

Host 的 `/plugins/events` **不要求 Web 登录 cookie**，直接可读：

```
GET http://127.0.0.1:25039/plugins/events
: connected

data: {"type":"graph","graph":{"rev":"a447a8dafedd","release":{"version":"0.2.1-rc.3","commit":"be72761"},"entries":[{"id":"@deepseek-ai/dsh-api-gateway","url":"plugins/??@deepseek-ai/dsh-api-gateway/client.js&rev=c089992c01c6",...}, ...]}}
```

实测：200、约 32 KB、76 个活跃客户端行；同一响应里没有任何 `dsh-better-sidebar` / `linxin666` / `dsh-pet`
/ `at-file`（即 §2.4 的"装而未选中"结论的硬证据）；活跃行的 combo 脚本可 `GET 200`（40 KB），
未激活的 `GET /plugins/dsh-better-sidebar/client.js` 返回 **404**。

脚本封装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\check-profile-state.ps1 -PluginId "@local/my-bundle"
# 输出 port / release / active rows / PLUGIN_ACTIVE YES|NO；退出码 0=激活 1=未激活
```

注意：Desktop Host 的端口是随机的（`--port 0`，见 `dsh-desktop-host/lib/index.js:236-241`）。本机还出现
"LISTENING 行在 agent 的 netstat 里看不到、只有 ESTABLISHED 两端"的情况，所以脚本从 netstat 两侧端点收集
loopback 端口后逐个探测 `/plugins/events`，不依赖固定端口（本次自动找到 25039）。

### 4.4 推荐的验证流程（含批准点）

1. 用户批准：把 bundle 装进 profile（§2.5，路线 A 或 B 之一）——**唯一的写操作/批准点**。
2. Agent 只读：`check-profile-state.ps1 -PluginId <name>` → `PLUGIN_ACTIVE`（并记录 release）。
3. 截图：`capture-window3.ps1 -Out "$env:TEMP\dsh-shot.png"`，`read_image` 看界面是否出现该 UI。
4. 迭代：改工作区里的 `client.js`（保存）→ 等 1–2 s → 重复 3。**不需要刷新/重启**；
   若 3 无变化：再看 `/plugins/events` 的该行 `rev` 是否变化（变化=Host 已重建，问题在页面），
   没变化=改的不是行指向的那份文件/mtime 未变。
5. 改 Host 半边（`index.js`）：预期需要重启 App（用户批准）；或临时改一次 `cordis.patch.yml` 触发重组（写 profile，用户批准）。
6. 收尾回滚（§5）。

### 4.5 提醒：Screenshot 的局限

- 只能证明"界面看起来对"，不能证明 DOM/事件绑定正确；点击交互要用坐标点击后再次截图比对。
- 截图必须让窗口在前台（脚本会 `ShowWindow` + `SetForegroundWindow`）；多显示器/DPI 已由 `SetProcessDPIAware` 处理。

---

## 5. 干净回滚

### 5.1 官方安装的回滚

```bat
"D:\apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove <包名>
```

`pnpm remove` 后 `reconcile()` 会把该名从 `dsh.profile.bundles` 移除（`operations.js:96-121` 的过滤逻辑：
已是依赖但已不在 dependencies → 丢弃），并重写 profile manifest。HMR 观察到 bundles 列表变化 → 卸载该层。
`cordis.patch.yml` 不会被碰，无需恢复。

### 5.2 路线 A（junction）的回滚

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\uninstall-local-bundle.ps1 -Name "@local/my-bundle" -PluginDir D:\ai2all\projects\personal\dsh-2sider\plugin
# 默认 DryRun；确认后加 -Apply
```

它会：备份 3 个 profile 文件 → 仅当 `node_modules\<name>` 是 Junction/SymbolicLink 且目标匹配时才删除链接
（`cmd /c rmdir`，绝不递归进源码目录）→ 从 bundles 移除 → 依赖值仅当是 `link:`/`file:` 时才删 →
等 3s → 重新检查 `/plugins/events` 应显示 `PLUGIN_NOT_ACTIVE`。
也可以用 `-RestoreFrom <备份目录>` 直接按备份还原 `package.json`（适合装了多个东西后要一次性回到原点）。

### 5.3 兜底

- 备份目录：`%TEMP%\dsh-profile-backup-<yyyyMMdd-HHmmss>\`（`package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、
  `install-state.json`）。恢复 = 拷回 profile（用户执行）。
- 若残留 `node_modules` 目录：官方路线用 `dsh plugin --profile desktop install` 让 pnpm 剪枝；路线 A 手动删 junction。
- 若 `.plugin-manager/run.json` 残留导致"进程仍在写 profile"：确认没有 pnpm 子进程后删除该文件（README 也这么说）。
- 回滚后再次确认：`check-profile-state.ps1` 的 bundles 列表、`/plugins/events`、截图三处一致。

---

## 6. 风险 / 不确定点（诚实清单）

1. **HMR 生效新 bundle 未在本机端到端实测**（受"不准真安装"约束）：依据是文档明文 + 代码路径 + SSE 通道可用；
   若装完 `/plugins/events` 里已有 id 但界面没出现，先硬刷新一次再判断。
2. **Host 半边热更新**是我从 `dsh-hmr` 代码推断的（配置变化触发重组会替换已变化的已加载模块），没有实测；
   保守做法是改 Host 代码就重启 App。
3. **junction 路线不写 lockfile**：后续任何 `pnpm install --frozen-lockfile`（如插件管理器安装其他插件时的兼容性回滚修复）
   可能报 lockfile 不同步或把 junction 剪掉。若只是短期验证可接受；正式留下就走 `dsh plugin add`。
4. **`dsh plugin add` 会重装/剪枝 profile node_modules**，对现有 7 个依赖（含体积很大的 better-sidebar/linxin666）有
   不可预知的耗时与改动风险；跑之前务必备份 `package.json`/`pnpm-lock.yaml`，并最好先退出 Desktop（DSH 自己的提示如此）。
5. **当前 profile 的第三方 bundle 全部未选中**（§2.4/§4.3 实测）。如果 Lead 的计划依赖"已有的 better-sidebar 覆盖行",
   那是错的；如果目标插件要和 better-sidebar 共存，得先把 better-sidebar 重新选进 bundles（用户决定）。
6. **`--dump-config` 会重写 profile 的 `cordis.yml`**（内容固定 `[]`），严格说不是只读；本报告未执行它。
7. `dsh.manifestVersion` 在本版本无人读取，写了也没用；别把它当必需字段。
8. 截图/视觉验证依赖窗口可见且在前台；Agent 无法从 DOM 层断言文本，只能看图。

---

## 7. 证据索引（文件:行 / 命令输出）

**asar 内文件**（用 `tools/asar-inspect.mjs read <asar> <entry>` 或 `notes/scripts/asar-grep.mjs` 读取）：
归档 `D:\apps\DeepSeek Harness\resources\app.asar`

| 主题 | 路径 / 位置 |
| --- | --- |
| CLI 入口 | `lib/main.js`（Electron 主进程，516 KB / 13198 行） |
| Desktop Host 启动 profile | `dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js:220-250`（`loadProfileDirectory` + `--port 0` + `--no-open`） |
| Host ready URL → 窗口 | `lib/main.js:3824-3827`（ready 消息）、`:12189-12194`（`hostUrl`/`injections`）、`:12424-12431`（`streamBaseUrl`）、`:7009`（`SCHEME="dsh-app"`） |
| 开发用 inspect 端口 | `lib/main.js:3794-3796`、`:12181` |
| `dsh plugin` 参数与转发 | `dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`（plugin 子命令、`manageDesktopProfile`、`--dump-config`）、`dsh/lib/plugin-BiveYA7h.js:1-140` |
| pnpm 执行/恢复/reconcile | `dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/operations.js:70-121`（anchorPathSpec、bundleManifest、saveManifest、reconcile）、`:299-561`（runProfilePnpm） |
| 服务端 installBundle | `dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js:1970-2100`、`:2267-2279`（readRestoredFiles/restoreFiles）、`:2360-2382`（reload / restart-required） |
| install spec 解析 | `dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/install-spec.js:69-92`（local path 必须绝对） |
| profile 组合/解析/bundle 校验 | `dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:252-317`（兼容性）、`:905-967`（manifest / bundles 重写）、`:990-1053`（resolveBundleDir + loadProfileDirectory） |
| HMR（Host） | `dsh/node_modules/@deepseek-ai/dsh-hmr/lib/index.js:849-873`（profile manifest/patch 监听）、`:1308-1353`（reconcileProfile）、`:1445-1453`（linked 目标根） |
| HMR 行定义 | `dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml:27-32` |
| client HMR 传输 | `dsh/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:1-130`（500ms stat 轮询 → `rebuilt` → `/plugins/events`）、`dsh-web-app/cordis.patch.yml:214-219` |
| 客户端模块图 | `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:66-75`（dsh.client 校验）、`:408-438`（graph row / external 排序）、`README.zh.md:38,42,47,137,139` |
| 文档（预设技能） | `ref/preset-skills/cordis-plugin-development/references/host-plugin.md:5-70`、`references/ui-plugin.md:3-13`、`templates/decoration/*` |
| 插件管理器文档 | `ref/plugin-manager/README.zh.md:14,50-52,100,140-141` |

**运行时实测**：

- `dsh plugin --help` 输出（§2.1）；
- `dsh --version` → `0.2.1-rc.3`；
- pnpm `11.28.5`；`pnpm add link:D:\...` 在 `%TEMP%` 临时工程实测（写入 `"link:D:/..."`，建链接）；
- profile 现状：见 §2.4；
- `GET /plugins/events`：200 / 32779 B / 76 行 / release `0.2.1-rc.3` `be72761`；无第三方插件；
- `GET /plugins/dsh-better-sidebar/client.js` → 404；活跃行 combo → 200 / 40480 B；
- `capture-window3.ps1` → `SAVED ... (1942 x 1019) at -11,0`；
- `uia-accessibility-probe.ps1` → 基线 3 节点，`WM_GETOBJECT` 前后无变化，`rc=0`；
- `check-profile-state.ps1` → `PLUGIN_ACTIVE: YES`（对照组 ui-chat）/ 自动端口发现 25039。

**脚本清单**（全部纯 ASCII、PowerShell 5.1，除 `.mjs` 用 node）：

| 脚本 | 作用 |
| --- | --- |
| `notes/scripts/check-profile-state.ps1` | 只读：profile 清单/链接/SSE graph/日志；`-PluginId` 判定激活，退出码 0/1 |
| `notes/scripts/install-local-bundle.ps1` | 默认 DryRun；`-Apply` = 备份 + junction + 两处清单修改（触发 HMR） |
| `notes/scripts/uninstall-local-bundle.ps1` | 默认 DryRun；`-Apply` 安全删链接 + 还原清单，或 `-RestoreFrom` 按备份还原 |
| `notes/scripts/profile-manifest.mjs` | 原子、保格式地增删 bundles/dependencies（供上面两个脚本调用，也可单独用） |
| `notes/scripts/uia-accessibility-probe.ps1` | 只读：窗口/子窗口枚举 + UIA 基线 + `WM_GETOBJECT` 试探（证明 UIA 不可用） |
| `notes/scripts/asar-grep.mjs` | 只读：在 asar 单条目里按正则 grep 并带行号上下文 |
