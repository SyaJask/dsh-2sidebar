# dsh-split-files

DSH 右侧栏里的「目录分栏」：一个页签内同时显示**左侧目录树**和**右侧文件内容**，点目录里的文件，右边直接切换，树不动。

A split-pane workspace browser for the DSH right Sidebar: directory tree on the
left, the selected file's content on the right.

## 怎么用

装好后有三个入口，都是同一份内容：

1. **标题栏按钮（最顺手的那个）**：会话标题栏右侧、原生「打开/收起右侧栏」按钮左边，多了一个
   分栏图标按钮「打开目录分栏」。点它 → 自动展开右侧栏 → 切到「目录分栏」页。
2. **右侧栏开始页**：`+` 打开的引导页里有带分栏图标的「目录分栏」胶囊，点一下即开。
3. 它就是一个原生页签，可以和其它页签一起停靠、分栏、全屏（`Ctrl+Alt+Enter`）。

页内操作：

- 左列点目录展开/收起（懒加载，展开即刷新）；点文件在右列打开。
- 中间分隔条可拖动调左右比例；拖出来的比例和「收起目录」状态记在 `localStorage`。
- 右列文本分页读取（每页 2000 行，`maxLines` 上限内），到底显示「已到文件末尾」，
  没到底有「加载更多」。
- 图片（png/jpg/jpeg/gif/webp/bmp/ico/avif/svg）走字节读取直接显示。
- 顶栏「重新读取」刷新根目录与已展开的层；「收起目录」把树折叠成单列。

## 安装 / 卸载（desktop profile）

```powershell
# 官方 CLI（会跑 pnpm 并回写 profile 清单）
dsh plugin --profile desktop add "link:D:/ai2all/projects/personal/dsh-2sidebar/plugin"

# 卸载
dsh plugin --profile desktop remove @local/dsh-split-files
```

本仓库还带了不跑 pnpm 的低风险安装脚本（junction + 两处清单，含备份/回滚）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\install-local-bundle.ps1 `
  -PluginDir D:\ai2all\projects\personal\dsh-2sidebar\plugin            # 预演
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\install-local-bundle.ps1 `
  -PluginDir D:\ai2all\projects\personal\dsh-2sidebar\plugin -Apply     # 实际安装
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\uninstall-local-bundle.ps1 `
  -Name @local/dsh-split-files -Apply                                 # 回滚
```

装完由宿主 HMR 原地激活，**不需要重启 App**；页面里已挂载的旧组件若没换新，按一次
`Ctrl+Shift+R` 即可。

## 实现要点

- 纯客户端插件，**没有 Host 业务代码**：目录列举与文件读取全部走宿主已有的
  `ctx.remote.workspaceFiles`（`list` / `read` / `readBytes`），会话工作目录来自
  `ctx.sessions.list`。Host 半侧只有一个空 `apply()`。
- 页签类型两阶段注册：`ctx.sidebarRightTabs.register({ id, kind, title, guide, keepMounted })`
  + `ctx.slots.register({ name: 'sidebar.right.pane.tab', key, locale, inject }, Body)`，
  标题走 `sidebar.right.pane.tab.title`。locale 命名空间直接用包名
  （`@local/dsh-split-files`）——`locale.register` 对同名命名空间+同语言会抛错，
  通用名是唯一容易被别的插件撞上的共享键。
- 标题栏按钮注册在 `conversation.session.header.utilities`；点击时先 `isExpanded()` 分流
  （展开态直接开，避免 `toggleExpanded` 把侧栏关掉），折叠态先 `toggleExpanded()` 再带重试地
  `ctx.sidebarRight.openTab(kind)`——`openTab` 走会话已 adopt 的 store，首帧可能抛
  `no session surface is mounted`，所以重试；不读宿主内部 DOM。
- `keepMounted: true`：切页签/切会话/收起时正文不卸载，树的展开状态与预览都还在。
- 样式用 `color-mix(currentColor …)` 跟随主题，不写死颜色；组件内 `<style>` 卸载即移除，
  全局按钮样式在 `ctx.effect` 里挂载并返回清理。

## 结构

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单：`dsh.bundle.patch` + `dsh.client` + exports/files |
| `cordis.patch.yml` | 插入一行 `local-split-files` 挂载本包（行 id 与其它 profile 层共用一个命名空间，所以带 `local-` 前缀） |
| `index.js` | Host 半侧：空实现 |
| `client.js` | Client 半侧：页签类型、正文、标题、标题栏按钮、样式与文案 |
| `locale/en.json`、`locale/zh.json` | 插件设置页用的标题与描述 |
| `icon.svg` | 插件图标 |

## 已知限制

- 只内置文本与图片预览；PDF / Office / HTML 等仍请用 DSH 原生预览页签打开。
- 目录树以会话工作目录为根，不提供浏览工作区之外的入口（宿主本身也只允许列工作区内目录）。
- 宿主原生 tab 条没有对第三方插件开放的「条上按钮」席位，所以「按钮」放在会话标题栏
  （紧挨右侧栏开关）而不是 tab 条里。
- 文件读取权限跟随宿主 `workspaceFiles` 的配置（`maxBytes` 2 MiB / 单页 `maxLines` 5000 /
  `maxEntries` 2000），本插件不绕过这些上限。
