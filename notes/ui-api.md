# DSH 客户端 UI API 研究报告：右侧栏自定义分栏 tab

任务：`task-1`（研究员：ui-api-researcher）。目标：给出可直接照抄的实现级结论，供 `dsh-2sider`
（右侧栏一个 tab：左目录树 + 右文件预览）编写客户端插件。

- 取证对象：DSH Desktop `0.2.1-rc.3`（`app.asar` 内 `dsh/package.json` 同版本，build commit
  `be72761ee1a6736ebcdf4f3739363b083ae53c98`）；已安装第三方插件 `dsh-better-sidebar@0.28.0`。
- asar 路径前缀：`D:\apps\DeepSeek Harness\resources\app.asar` 内为 `dsh/node_modules/@deepseek-ai/...`。
- 本报告所有代码均摘自 `lib/client.js`（已构建产物）或安装包源码，未做推测的地方会明确标注
  “**推测**/未验证”。
- 配套可运行骨架：`notes/snippets/`（`client.js`、`package.json`、`index.js`、`cordis.patch.yml`，
  以及可选的 `host-route.js`）。

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 |
|---|---|
| 客户端模块格式 | `window.__ModuleLoader__.load({ id, factory, chunk? })`；`id` = 包名；`factory(require)`，`require` 是**同步惰性 CJS**。 |
| 能 require 什么 | 只有 **冻结的平台模块表**（见 §1.3，`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`-ui-slots`、`-ui-primitives`、`-ui-dockkit`）+ 已注册 factory 的客户端插件包。**宿主服务不是模块**，走 `ctx.*` 依赖注入。 |
| 能否 require `@deepseek-ai/dsh-api-workspace-files` | 技术上它能作为客户端插件包被 require 到（返回它的 `{apply, inject}`），但**不要**：文件读写走 `ctx.remote.workspaceFiles.*`，无需 import 任何包。 |
| `dsh.client.inject` / `external` | `inject`：声明本插件依赖的客户端插件包名（元数据，用于图排序；本版本浏览器侧**未消费**，见 §1.5）。`external`：声明 bundle 里 require 的“基座之外”的模块，**驱动模块图排序**（`orderByModuleGraph` 只读它）。 |
| 注册右侧栏 tab | 两阶段：`ctx.sidebarRightTabs.register({ id, kind, title, guide?, keepMounted? })` + `ctx.slots.register({ name:'sidebar.right.pane.tab', key:id, locale, inject }, Body)`（正文）与 `...pane.tab.title`（chip）。**key 必须等于 type 的 id**。 |
| 会话 cwd | `ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd`（可 `subscribe` 订阅）；官方 body 里也以标准 prop `useSessions(...)` 出现。 |
| 列目录 / 读文件 | `ctx.remote.workspaceFiles.list(sessionId, absPath, signal)`、`.read(sessionId, absPath, { offset, limit }, signal)`、`.readBytes(...)`、`.stat(...)`、`.changes(...)`；返回统一 `RemoteResult` 信封 `{ok:true,value} | {ok:false,error:{code,...}}`。**read 已存在，不需要自建 host 路由。** |
| header 角落按钮 | `conversation.session.header.corner` 是 **single** 槽，已被原生右侧栏占用（展开按钮），外部插件**不应**抢；改用 `conversation.session.header.utilities`（list，`id`+`order`）。 |
| tab strip 的 rightActions | **没有公开槽位**。面板两个控件是右侧栏包直接传给 dockkit 的 `chrome` prop，外部插件不可插入（见 §4.4）。 |
| 纯客户端够不够 | **够**（树 + 预览都能通过 workspaceFiles Remote 完成）。host 侧最少只需一个空 `apply()` + `cordis.patch.yml` 行 + `package.json` 的 `dsh.bundle.patch` / `dsh.client`。 |

---

## 1. 客户端 bundle 的模块契约

### 1.1 文件形态

`lib/client.js` 的第一行就是（每个客户端插件包都一样）：

```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-modules",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    ...
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

证据：
- `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js:1-4`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-files/lib/client.js:1-4, 1020-1024`
- 模板 `ref/preset-skills/cordis-plugin-development/templates/decoration/client.js:1-22`

要点：

1. 脚本执行**只注册 factory**；模块体副作用（含 `require('react')`、CSS 注入）只在
   **物化（materialize）**时运行。`factory(require) → exports` 结果按 id 记忆在 `loadCache`。
2. `id` 必须是**包名**；带 `/client` 后缀会被归一化（`stripClientSuffix`）：
   `<id>/client` 与裸 `<id>` 解析到同一组导出。
3. 重复注册同一 id 会 throw：`client-modules: duplicate factory registration for "..." (bundle executed twice without invalidate?)`
   （`dsh-client-modules/lib/client.js:701-714`）。
4. 入口 + 动态 chunk 的格式：入口 `client.js`；同包 chunk 必须命名为
   `client.<name>.js`，用 `require.async("./client.xxx.js")` 加载（`/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`）。

### 1.2 `require` 的解析顺序（精确）

`ClientModuleSystem.makeRequire`（`dsh-client-modules/lib/client.js:831-850`）：

```js
const require = (spec) => {
  edges.add(spec);
  if (this.seed.has(spec)) return this.seed.get(spec);              // 1) 平台种子表
  const id = stripClientSuffix(spec);
  const record = this.loadCache.get(id);
  if (record !== void 0) return record.exports;                     // 2) 已物化
  if (this.factories.has(id)) return this.materialize(id).exports;  // 3) 已注册 factory（递归物化）
  throw new Error(`client-modules: require("${spec}") missed the module table — ...`);
};
```

即：**平台种子 → 已物化模块 → 已注册 factory → 抛错**。注意：

- 同步 `require` **不会**触发异步图加载（只有 `import()` 才会 `arriveGraphRow`）。因此 require 另一个
  客户端插件包时，对方 bundle 的 factory 必须**已经注册**（boot 阶段会先把所有 row import 进来，
  `dsh-client-modules/lib/client.js:526-547`；`ClientEntries.create` 只传 `{name:id}`，见 483-491）。
- 若确实要 require 非基座包，务必在 `dsh.client.external` 里声明它 —— **模块图排序只看 `external`**：
  `orderByModuleGraph` 遍历 `entry.external`（`dsh-client-modules/lib/index.js:422-444`）。
- `require.async("./client.x.js")` 走 `importChunk`（同文件 842-848、852-877）。

### 1.3 平台种子表（`PLATFORM_MODULES`）——`require` 的“基座”

外壳 bundle（`dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js`，0.2.1-rc.3）
中，模块表的冻结工厂函数（压缩后名为 `OZ`）原文：

```js
function OZ(){return{
  react:aC,
  "react/jsx-runtime":dC,
  "react-dom":gC,
  "react-dom/client":_C,
  "@deepseek-ai/cordis":Ub,
  zod:Vj,
  "@tanstack/react-virtual":Xj,
  "@deepseek-ai/dsh-client-store":xI,
  "@deepseek-ai/dsh-client-ui-slots":jI,
  "@deepseek-ai/dsh-client-ui-primitives":TU,
  "@deepseek-ai/dsh-client-ui-dockkit":SZ
}}
```

同一 bundle 里外壳创建模块系统：

```js
const r = t.__ModuleLoader__;
this.modules = r.create({
  boot: t.__DSH_BOOT__,
  staticModules: OZ(),
  ...(transport.loadBundle ? { loadBundle: transport.loadBundle } : {}),
  ...this.seams,
});
```

结论：

- 这 11 个是**种子词**，`require` 一定命中，来源是外壳打包结果，不在 `node_modules` 里。
  已核实 asar 中**不存在** `@deepseek-ai/dsh-client-ui-slots` / `-ui-primitives` / `-ui-dockkit` /
  `-dsh-client-store` 的包目录（`node tools/asar-inspect.mjs list <asar> "dockkit"` 无结果），
  它们被固化在 `dsh-web-frontend` 的 vendor bundle 中。
- `@deepseek-ai/dsh-api-workspace-files`、`@deepseek-ai/dsh-client-*` 这类**是动态图 row**，不是种子；
  不在种子表里，同步 require 只能在对方 factory 已注册后命中。

### 1.4 能 require 到 `@deepseek-ai/*` 包或宿主服务吗？

- **宿主服务（`ctx.sessions` / `ctx.slots` / `ctx.remote` / `ctx.locale` / `ctx.webServer`…）不是模块**，
  不能 require。它们是 Cordis 服务，通过依赖注入获得：
  - 客户端 bundle 导出 `inject = ['slots','locale','sessions','sidebarRightTabs','remote','remote.workspaceFiles']`
    （`dsh-client-ui-sidebar-files/lib/client.js:934-941`），Cordis 等这些服务就绪后才跑 `apply`；
  - 或运行时用 `ctx.inject(['sidebarRightTabs'], (injected) => {...})`。
- `@deepseek-ai/dsh-api-workspace-files` 可以 require，但拿到的是它的模块导出 `{apply, inject}`
  （即它的客户端插件外壳），**拿不到 remote 命名空间**。要读文件就用 `ctx.remote.workspaceFiles`
  （它是 `@deepseek-ai/dsh-api-remotes` 按 typert 描述符挂载的 namespace 服务，见
  `dsh-api-remotes/README.zh.md:14,32,36`）。
- 官方插件作者规则明确写着**不要 require Harness 客户端包**：
  `ref/preset-skills/cordis-plugin-development/references/practices.md:35`
  “Do not `require('@deepseek-ai/dsh-client-ui-primitives')` or load any other Harness Client package as a
  module; `dsh.client.inject` entries only order activation and stay allowed.”
  官方 `@deepseek-ai/dsh-client-ui-sidebar-files` 的 bundle 只 require **种子表内的模块**：`react`、
  `react/jsx-runtime`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、
  `@deepseek-ai/dsh-client-ui-primitives`（其 `lib/client.js` 头部），没有 require 任何 `dsh-api-*` 包；
  文件读写全部走 `ctx.remote`。
- 例外：已安装的第三方 `dsh-better-sidebar@0.28.0` 同样只 require 种子表里的
  `react` / `react-dom` / `react/jsx-runtime` / `react-dom/client` /
  `@deepseek-ai/dsh-client-ui-primitives`（`lib/client.js:28-36`）。
  但对**手写纯 JS 插件**建议只 require `react`：primitives 的导出面会随版本变化，且没有类型检查，
  组件一 throw 整个 slot 条目就会空白（控制台 `slot entry crashed in '<slot>'`）。

### 1.5 `dsh.client` 清单字段与语义

`parseDshClient`（`dsh-client-modules/lib/client.js:61-75`，host 侧 `lib/index.js:67-75` 同构）：

```js
{ platform: string, inject?: string[], external?: string[], immediately?: boolean }
```

| 字段 | 语义 | 证据 |
|---|---|---|
| `platform` | 必填，桌面/Web 组合为 `"web"` | 上；`dsh-client-modules/package.json:29-36` |
| `exports["./client"]` | 指向浏览器 bundle；**缺失则激活失败**并给出构建提示 | `dsh-client-modules/README.zh.md:53-56` |
| `inject` | 客户端插件包名数组（Graph 顺序 / 元数据）；**本版本浏览器未消费**（`ClientEntries.create` 只用 `{name:id}`，`dsh-client-modules/lib/client.js:483-491`；全文件搜 `inject` 仅出现在清单解析与 boot 行里） | 同上 + `lib/client.js:132-141` |
| `external` | 本 bundle 同步/异步 require 的“基座之外”模块；**决定模块图排序**，缺失提供方/自引用/环会在组合阶段报错 | `lib/index.js:422-444`；`README.zh.md:51-52` |
| `immediately` | 页面启动即预取该 bundle（`manifest.plugins.filter(p => p.immediately)`） | 外壳 bundle `RZ.prefetchImmediateTier`；`lib/client.js:137-140` |

`dsh.client.inject` 的**实际作用**（重要，容易踩坑）：

- 组合结果里它被写进 `plugins[].inject` 与 `modules[].inject` 两个 wire 行
  （`dsh-client-modules/lib/client.js:132-141`），但 0.2.1-rc.3 的浏览器侧代码没有任何读取它的地方；
  真正生效的是 **bundle 自己的 `exports.inject`（Cordis 服务名）** 和 **`dsh.client.external`（模块图）**。
- 因此：要保证“右侧栏 seat 已声明、workspaceFiles namespace 已挂载”，请把服务名放进
  `exports.inject`；`dsh.client.inject` 只作为声明性元数据（写真实依赖即可，别指望它强制排序）。

### 1.6 写法建议（外部纯 JS 插件）

- 只 `require('react')`（JSX 可用 `React.createElement` 完全绕开构建链，见 snippets）。
- 不 require `-ui-primitives` / `-ui-slots` / `-ui-dockkit`；slot 走 `ctx.slots`，主题走 CSS token
  `var(--dsw-alias-*)`（practices.md:34）。
- UI 文案走 `ctx.locale.register(ns, {en, zh, ...})` + `ctx.locale.bind(ns)`（sidebar-files 同款）。

---

## 2. 从外部插件注册原生右侧栏 tab（两阶段 API）

### 2.1 公开文档（已提取）

`ref/native-sidebar-right/README.zh.md:81-88`：

> 1. **类型**——`ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted? })`，
>    一份没有运行时钩子的静态声明，返回 disposer。`id` 是这个实现在 tab 系统里的身份，在全部注册中唯一
>    （包名是天然取值；…同一 `id` 的第二次注册会 throw）。…`id` 同时也是该类型正文与标题注册时用的 key。
> 2. **正文**——`ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, Body)` 通过框架注入
>    的 `useTabInfo()` 读取 `{ sidebar, panel, tab }`。…可选标题注册及引导替换共享该 hook。
>
> 另有两个席位扩展已有之物：`sidebar.right.tab.guide`（chain）替换引导 tab 的正文而不替换 tab，
> `sidebar.right.tab.menu.item`（list）在套件自己的布局动作之后向 tab 菜单追加内容级动作。

`ref/native-sidebar-files/README.zh.md:29-33` 是随包发布的活例子（kind `files`，同一路径）

### 2.2 官方实现里的 registry（真实签名与 throw 规则）

`dsh-client-ui-sidebar-right/lib/client.js:4555-4611`（`SidebarRightTabRegistry`）：

```js
register(definition) {
  const { id, kind } = definition;
  const entries = definition.guide ?? [];
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw new Error(`sidebarRight: duplicate guide entry id in "${id}"`);
  const band = definition.priority ?? DEFAULT_BAND;
  if (this.ids.has(id)) throw new Error(`sidebarRight: tab type id "${id}" is already registered`);
  const held = this.kinds.get(kind);
  if (held !== void 0 && !coexists(held, band))
    throw new Error(`sidebarRight: tab kind "${kind}" is already registered (${held.inForce.band})`);
  ...
}
```

- band（`priority`）：`extension`（最高，外部插件默认）> `builtin` > `fallback`。
  同一 `kind` 最多一份 builtin + 一份 extension；extension 生效、builtin 被遮蔽；extension 卸载后恢复。
- 资源类型给 `patterns`（`dsh-resource://` 地址 glob）；页面类型**不给 patterns**，按 kind 打开。
  （`ref/native-sidebar-right/README.zh.md:83,86`）
- `title(address)` 在 tab 打开时**捕获一次**；要动态标题就用 `sidebar.right.pane.tab.title` 槽。
- `keepMounted: true`（0.1.7+）：访问过的正文在切 tab / 切 Session / 收起 / 停靠切换时保持挂载。
- `multiple: true`：每次打开得到独立内容地址（终端那种需要多实例的类型）。

### 2.3 `useTabInfo()` 返回结构（精确）

`dsh-client-ui-sidebar-right/lib/client.js:4856-4893`（`tabInfoFactory`）：

```js
const tab = layout?.tabs[tabId];                       // 未提交则 throw
const pane = findTabPane(layout, tabId);
return {
  sidebar: { expanded: layout.expanded, fullscreen },
  panel: { id: pane.id },
  tab: {
    ...tab,                                            // id / kind / title / contentId / ...
    visible: active && (pane.host === "float" || layout.expanded && (title || pane.activeTabId === tabId)),
    navigation,                                        // { address, params, revision }
    signal,                                            // AbortSignal：occurrence 卸载
    actions,                                           // openResource / openTab / close / bindCommands ...
    refreshShortcut,                                   // 页面刷新快捷键行
  },
};
```

`tab.actions.openResource(address, options?)` 与 `tab.actions.openTab(kind, options?)` 见
`ref/native-sidebar-right/README.zh.md:93`（资源地址 `dsh-resource://<type>/…`）。

### 2.4 guide 入口（开始页胶囊）

类型定义里给 `guide: [...]`，每项（`dsh-client-ui-sidebar-right/lib/client.js` 的 guide 渲染 +
better-sidebar 的真实调用 `src/client/native/index.ts:374-385`）：

```js
guide: [{
  id: 'two-pane',            // 必填且 per-provider 唯一（0.1.6-alpha.2 起；重复 throw）
  order: 100,                // 排序
  title: () => t('title'),   // 胶囊标题
  description: () => t('description'),  // 可选；开始页条目 >4 时不显示
  icon: (props) => <svg width={props.size ?? 16} .../>,  // 可选
}]
```

点击默认胶囊 = `tab.actions.openTab(entry.kind, { replaceTab: true })`
（`ref/native-sidebar-right/README.zh.md:122`）。所以**只要类型注册成功并在 guide 里列出，用户就能从开始页打开它**；
程序化打开用 `ctx.sidebarRight.openTab(kind, options?)`（同上 93）。

### 2.5 生命周期与竞态（必须照抄的写法）

1. **类型/正文/标题都放在 `ctx.effect`** 里，让注册与插件 fiber 同生共死：
   `ctx.effect(() => ctx.sidebarRightTabs.register(...), 'label')`，
   `ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(...)), 'label')`。
2. **`ctx.slots.inject(slotName, cb)` 等待该槽被声明**；未声明时是 no-op，声明出现时重跑，
   声明消失时执行返回的 disposer（`sidebar-files/lib/client.js:1003-1017` 的真实形态）。
3. **seat 早于 service 的坑**：右侧栏 seat 先声明 `sidebar.right.pane.tab` 槽，之后才 provide
   `sidebarRightTabs` 服务；如果只在 `ctx.slots.inject` 回调里读服务，会永久读不到。
   better-sidebar 的做法是先等服务：
   ```js
   const seat = ctx.inject(['sidebarRightTabs'], (injected) => { ...注册... })
   ```
   证据：`C:\Users\Kaw0n\.dsh\profiles\desktop\node_modules\dsh-better-sidebar\src\client\native\index.ts:260-270`。
   只要 bundle 的 `exports.inject` 里写了 `sidebarRightTabs`（Cordis 服务等待），就不需要这个兜底；
   纯 JS 插件建议**两个都写**：`exports.inject` 保激活顺序，`ctx.slots.inject` 保槽存在。
4. **组件的 props 来源**：框架标准 props（`sessionId`、`t`(带 locale 时)、`renderSlot`、`useSessions`、
   `useStore`、`actions`）+ 槽声明注入的 hooks（`useTabInfo`）+ 本条目 `inject` 函数返回的对象。
   证据：`FilesBody` 解构 `{ useTabInfo, sessionId, useSessions, useStore, actions, start, refresh,
   setAutoRefresh, toggle, t, renderSlot }`（`sidebar-files/lib/client.js:595`）；
   `RightbarSeat` 解构 `{ sessionId, useStore, actions, t, renderSlot, ... }`
   （`sidebar-right/lib/client.js:1572`）。
5. **正文根元素要撑满**：宿主把正文放在 `div.tabBody` 里，better-sidebar 通过
   `.nativeTabHost { flex: 1 }` 满足该约定（`src/client/native/tab-adapter.tsx:528-533,549-550` 注释）。
   snippets 里用 `display:flex/grid` + `flex:1 1 auto; minHeight:0; height:100%`；若实测高度塌陷，
   改成 `position:absolute; inset:0` 或补 `height:100%`（**高度契约未见文档，属实测项**）。

### 2.6 最小可运行示例

见 `notes/snippets/client.js`（完整可复制，纯 JS + `React.createElement`，无 JSX/无构建）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-2sider',
  factory(require) {
    const React = require('react');
    ...
    return {
      inject: ['slots', 'locale', 'sessions', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { en }), 'dsh-2sider: locale');
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TYPE_ID, kind: 'two-pane', priority: 'extension',
          title: () => t('title'),
          guide: [{ id: 'two-pane', order: 100, title: () => t('title'), description: () => t('description') }],
        }), 'dsh-2sider: tab type');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({
            name: 'sidebar.right.pane.tab', key: TYPE_ID, locale: NS,
            inject: (sessionId) => ({ ctx, sessionId }),
          }, TwoPaneBody)), 'dsh-2sider: tab body');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register({
            name: 'sidebar.right.pane.tab.title', key: TYPE_ID, inject: () => ({ t }),
          }, TwoPaneTitle)), 'dsh-2sider: tab title');
      },
    };
  },
});
```

---

## 3. 读取文件系统

### 3.1 会话 cwd

客户端**没有**“当前会话”字段；会话列表快照只有 `ids / byId / phase`（better-sidebar 注释：
`src/client/native/surface.ts:84-98`——“The session-list snapshot carries NO current-session field in any
DSH release”）。

拿 cwd 的两种方式：

1. **官方 body 的标准 prop**（框架已注入）：
   ```js
   const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);
   ```
   证据：`dsh-client-ui-sidebar-files/lib/client.js:605`；`dsh-client-ui-conversation/lib/client.js:17816`。
2. **直接用 `ctx.sessions` 服务**（对纯 JS 插件更可控；需在 `exports.inject` 写 `'sessions'`）：
   ```js
   ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
   ctx.sessions.list.subscribe(listener)      // ObservableSnapshot
   ```
   证据：`dsh-better-sidebar/src/client/use-session-root.ts:180-183`；
   `src/client/native/surface.ts:207`（`ctx.sessions.list.getSnapshot().byId ?? {}`）；
   better-sidebar 客户端 `inject` 列表含 `"sessions"`（`lib/client.js:31894-31902`）。

注意：列表里的 cwd 是**会话 header 里冻结的启动目录**。如果 agent 中途切到 git worktree，需要向 host 重新问
（`/sidebar/api/session.cwd` 是 better-sidebar 自建的路由，不是官方 API）。对本项目“目录树 + 预览”够用；
**不确定点**：host 侧是否有官方 Remote 能拿“当前活动根”，未取证到（workspaceFiles 的各方法只接 sessionId+path）。

### 3.2 `remote.workspaceFiles`：方法、签名、返回结构

命名空间服务名：**`remote.workspaceFiles`**（Cordis 服务 id 就是 `remote.` + namespace）。
调用面（`dsh-api-workspace-files/README.zh.md:28`）：

```js
remote.workspaceFiles.read(sessionId, path, range, signal)
remote.workspaceFiles.stat(sessionId, path, signal)
remote.workspaceFiles.readBytes(sessionId, path, options, signal)
remote.workspaceFiles.list(sessionId, path, signal)
remote.workspaceFiles.changes(sessionId, path, signal)   // stream
```

| 方法 | 参数 | 成功值（`result.value`） |
|---|---|---|
| `list` | `(sessionId, path, signal?)` | `{ path, entries: [{ name, type: 'file'\|'directory'\|'other', size? }], truncated }`（`typert.remote-client.js:27-36`） |
| `read` | `(sessionId, path, { offset?, limit? }, signal?)` | stat 字段 + `{ offset, text, lines, eof }`；`offset` 1 起算、`limit` 默认且不超过 `maxLines`(5000)（`typert.remote-client.js:37-55`） |
| `readBytes` | `(sessionId, path, { range?: { offset?, length? }, baseFile? }, signal?)` | stat + `{ offset, data: Uint8Array, eof }`；`maxBytes` 默认 2 MiB，整文件默认上限 32 MiB（`:56-75`） |
| `stat` | `(sessionId, path, signal?)` | `{ absolutePath, version, bytes? }`（`:77-86`） |
| `changes` | `(sessionId, path, signal?)` | 流：`{kind:'ready'}` 然后 `{kind:'change', change:{absolutePath,version}\|{absolutePath,absent:true}}` |

**返回信封**：所有方法都返回 `RemoteResult`，不 throw 业务错误：

```js
const result = await ctx.remote.workspaceFiles.list(sessionId, dir, signal);
if (result.ok !== true) {
  // result.error = { code, message, details? }
  // list 的 code：workspace-file/not-found | outside-workspace | not-directory | ...
} else {
  result.value.entries
}
```

证据：`dsh-client-ui-sidebar-files/lib/client.js:252-261`（list）；`dsh-client-ui-sidebar-documentpreview/
lib/client.js:242-243, 1189-1196, 4334-4340`（read 的 `result.ok` / `result.value.version` / `absolutePath`）；
错误码表 `dsh-api-workspace-files/README.zh.md:71-73`。

路径语义（`README.zh.md:38-44,54`）：`read/readBytes/stat` 接受绝对路径或**相对会话工作区根**的路径；
`list`/目录 `changes` 限定在工作区内，返回的 `path` 是相对根的路径；Windows 盘根等文件系统根也能作为树的根。
空路径是 `gateway/bad-request`。

### 3.3 依赖声明（照抄官方）

客户端 bundle：`exports.inject = ['slots','locale','sidebarRightTabs','sidebarRight','remote',
'remote.workspaceFiles']`（`sidebar-files/lib/client.js:934-941`）。

包清单：`dsh.client.inject` 里列客户端插件**包名**（`sidebar-files/package.json:29-40`）：

```json
"dsh": { "client": { "inject": [
  "@deepseek-ai/dsh-api-workspace-files",
  "@deepseek-ai/dsh-client-ui-sidebar-right",
  "@deepseek-ai/dsh-client-ui-session",
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-client-shortcuts"
], "platform": "web" } }
```

对 dsh-2sider 建议：`@deepseek-ai/dsh-client-ui-sidebar-right`、`@deepseek-ai/dsh-client-locale`、
`@deepseek-ai/dsh-api-workspace-files`、`@deepseek-ai/dsh-api-remotes`。**不需要**在 `external` 里写任何东西
（本插件不 require 这些包）。

### 3.4 更省事的路：把文件交给 DSH 自己的预览

如果预览不需要自己渲染，可以用 `tab.actions.openResource(address)` 在**新 tab** 里打开 DSH 内建预览，
地址语法（`dsh-api-workspace-files/README.zh.md:79`、`dsh-client-ui-sidebar-files/README.zh.md:43`）：

```
dsh-resource://file/session/<sessionId>/<相对工作区根的路径>
```

`<sessionId>/` 之后以 `/` 开头表示绝对路径（例：`dsh-resource://file/session/s//etc/hosts`）。
官方用 `@deepseek-ai/dsh-util-workspace-path` 的 `fileAddressFor()` 生成；该包**不在种子表里**，
纯 JS 插件需要自己拼（相对路径应由 cwd 前缀裁剪得到；绝对路径 host 也接受）。这是本项目可选的“偷懒”路径，
但会牺牲“左树右预览同 tab”的体验，故主方案仍是 `read`。

### 3.5 若确实需要自建 host 路由（本项目不需要）

better-sidebar 的完整做法（`src/index.ts`）：

```ts
export const inject = ['webServer', 'sessions', 'connection', 'tools']

ctx.effect(() => ctx.webServer.register({
  kind: 'prefix',                 // 'exact' | 'prefix'
  path: '/sidebar/api',
  handler: async (req, res) => {
    if (!fence(req)) { writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } }); return }
    ...
  },
}), 'dsh-better-sidebar: /sidebar/api routes')
```

- 入口拒绝：`const fence = (req) => ctx.connection.requestRejection(req) === undefined`
  （`src/index.ts:111-112,1316`；`ctx.connection.requestRejection` 返回 401/403，见
  `src/context-types.ts:117-128`）。
- 路由类型：`kind:'exact'`（`/sidebar/upload`、`/sidebar/write`、`/sidebar/archive`）与
  `kind:'prefix'`（`/sidebar/api`、`/sidebar/file`、`/sidebar/html`）；WebSocket 用
  `ctx.webServer.registerUpgrade({path, handler})`（`src/index.ts:1496,1534,1587,1612,1682,1741,1762`）。
- JSON 信封统一 `{ok:true,value}` / `{ok:false,error:{code,message}}`（`src/client/api.ts:240-265`）。
- **客户端 URL 必须用页面 base 解析**，不要以 `/` 开头（桌面 shell 页面是 `dsh-app://app/`，反代还可能有前缀）：
  `new URL('sidebar/api/x', document.baseURI)`；better-sidebar 的 `hostRouteUrl()` 与
  `__DSH_TRANSPORT__.streamBaseUrl` 讨论见 `src/client/host-route-url.ts:1-70`。
- 参考代码：`notes/snippets/host-route.js`。

**结论**：读目录/读文件/看变更都能用 workspaceFiles Remote 完成，本项目的 host 侧只需要空 `apply()`。

---

## 4. 槽（slot）注册签名汇总

### 4.1 `ctx.slots` 的公开面

真实调用形态（`sidebar-files/lib/client.js:996-1017`、`sidebar-right/lib/client.js:5079-5126`、
better-sidebar `src/context-types.ts:130-157` 的结构镜像）：

```js
const dispose = ctx.slots.register(options, Component)
const dispose = ctx.slots.inject(slotName, () => ctx.slots.register(...))
```

`options`（结构镜像 `SidebarSlotRegisterOptions`，`dsh-better-sidebar/src/context-types.ts:130-146`）：

| 字段 | 说明 |
|---|---|
| `name` | 槽名（必填） |
| `key` | **keyed** 槽的条目键（右栏 tab 正文/标题用它，必须 = type 的 `id`） |
| `id` | **list** 槽的条目身份（与 `order` 搭配） |
| `order` | list 槽内的排序 |
| `locale` | 命名空间；注册后组件会收到 `t`（locale-bound） |
| `inject` | 业务面注入：函数 `(sessionId, actions) => Record<string, unknown>`（也见传对象的写法，**两种都存在**） |
| `children` | 该条目继续声明子槽：`{ [slotName]: { kind, scope, inject? } }` |
| `label` / `select` / `priority` / `registrant` | 菜单/chain 等用途；`select` 是 chain 的路由选择器（**推断**） |

槽的 kind（来自真实声明）：`single`、`list`、`keyed`、`chain`。scope：`root` 或 `session`。

### 4.2 右侧栏相关槽位一览（含是否对外部插件可用）

| 槽名 | kind | scope | 声明者 / 证据 | 外部插件用法 |
|---|---|---|---|---|
| `sidebar.right.pane.tab` | keyed | session | `dsh-client-ui-sidebar-right/lib/client.js:5046-5050` | ✅ 正文，`key = type id` |
| `sidebar.right.pane.tab.title` | keyed | session | 同上 `:5051-5055` | ✅ chip 标题，`key = type id` |
| `sidebar.right.tab.menu.item` | list | session | 同上 `:5056-5059` | ✅ 往 tab 右键菜单追加动作（拿到 `{tab, dismiss}`） |
| `sidebar.right.tab.guide` | chain | session | 同上 `:5115-5119` | ⚠️ 替换引导页正文；**本版本无 in-tree 消费者，注册签名未验证** |
| `sidebar.right.tab.guide.entry` | keyed | session | 同上 `:5110-5114` | ✅ 自定义开始页胶囊（`key`=类型 id；终端范例 `sidebar-terminal/lib/client.js:463-474`） |
| `sidebar.right.tab.guide.actions` | list | root | 同上 `:5106-5109` | ✅ 开始页“更多工具”菜单项 |
| `sidebar.right.tab.files.actions` | list | session | `sidebar-files/lib/client.js:1009-1012`（作为 body 的 children 声明） | ✅ 说明：**body 条目可以自己声明子槽**给别的插件用 |
| `sidebar.right.tab.document` 等 | keyed | session | `sidebar-documentpreview/lib/client.js:7226-7232` | 同理：预览器内部子槽，不属于右侧栏 API |
| `rightbar` / `rightbar.session` | single | root/session | `sidebar-right/lib/client.js:5031-5077` | ❌ 右侧栏包自己的座位 |
| `conversation.session.header.corner` | **single** | session | `dsh-client-ui-conversation/lib/client.js:20051-20054`；渲染点 `:18199-18201` | ⚠️ **已被原生右侧栏占用**（展开按钮，`sidebar-right/lib/client.js:5079-5084`）；外部插件不要抢 |
| `conversation.session.header.utilities` | list | session | `conversation/lib/client.js:20047-20050`；渲染 `:18196-18197` | ✅ 想放 header 按钮就用这个（better-sidebar 的底部开关就这么做：`src/client/sidebar/bottom-toggle.tsx:5-28`） |
| `conversation.session.header.actions` | list | session | `conversation/lib/client.js:20043-20046` | ✅ 另一条 header 动作列表 |
| `conversation.session.header.views.actions` | list | root | `:20055-20058` | ✅ View 页签“更多”菜单 |
| `shell.overlay` / `settings.section` 等 | 各自 | — | better-sidebar 真实注册示例 | ✅ 常规用法 |

**header 角落按钮的注册签名**（参考“若你是胜者”）：`sidebar-right` 自己是这样注册的
（`sidebar-right/lib/client.js:5079-5084`，单槽，直接把 `ExpandButton` 放进去）：

```js
ctx.slots.inject('conversation.session.header.corner', () => ctx.slots.register({
  name: 'conversation.session.header.corner',
  locale: NS,
  store,
  inject: () => ({ hooks: { shortcuts: ctx.shortcuts.catalog } }),
}, ExpandButton))
```

对 dsh-2sider：**不要**注册这个槽；如果需要一个“打开双栏”的 header 按钮，
用 `conversation.session.header.utilities`：

```js
ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
  name: 'conversation.session.header.utilities',
  id: 'dsh-2sider:open',
  order: 20,
  registrant: 'dsh-2sider',
}, function OpenButton() { /* 调 ctx.sidebarRight.openTab(KIND) */ }))
```

（better-sidebar 的注释明确解释了为什么不去抢 corner：`src/client/sidebar/bottom-toggle.tsx:5-10`、
`src/client/Sidebar.tsx:12-14`。）

### 4.3 `sidebar.right.tab.guide`（chain，替换引导正文）

声明形态（`sidebar-right/lib/client.js:5115-5119`）：`{ kind: 'chain', scope: 'session',
inject: { hooks: { tabInfo: guideTabInfoFactory } } }`，语义是“替换引导 tab 的正文而不替换 tab”
（README:88）。本版本 asar 内 9 个 sidebar 相关包里**没有找到注册它的代码**（grep
`sidebar.right.tab.guide"` 只命中 `.entry`/`.actions`），所以**注册签名未验证**：
按 chain 槽的通用形态应是 `ctx.slots.register({ name:'sidebar.right.tab.guide', ... }, Body)`
（可能需 `select`）。**本项目不需要它**（我们注册自己的 tab 类型，不替换开始页）。

### 4.4 tab strip 的 rightActions：不存在

右侧栏面板“没有自己的标题行”，形态切换/折叠两个按钮由右侧栏包作为 `chrome` prop 交给 dockkit：

```js
// dsh-client-ui-sidebar-right/lib/client.js:1535-1560
jsx(DockLayout, {
  ...,
  renderTabMenuItems: (tab, dismiss) => renderSlot("sidebar.right.tab.menu.item", { tab, dismiss }),
  chrome: jsx(PanelChrome, { sessionId, fullscreen, actions, t, shortcuts, toggleFullscreen }),
})
```

`PanelChrome`（`:1476-1510`）是包内组件，**没有任何 slot 暴露 tab 条的右侧动作区**。
可用替代：
- 页面内部自己做工具条（推荐，snippets 即如此）；
- `sidebar.right.tab.menu.item` 往 tab 菜单加项；
- `conversation.session.header.utilities` 往会话 header 加按钮。
（README 也写明“目前没有面向格级动作或折叠态控件的席位，因为还没有东西需要它”，
`ref/native-sidebar-right/README.zh.md:88`。）

---

## 5. 纯客户端够不够？host 侧最少写什么

**够。** 目录列举（`list`）、文本分页读取（`read`）、字节读取（`readBytes`）、元数据（`stat`）、
变更订阅（`changes`）全部由 `@deepseek-ai/dsh-api-workspace-files` 的 Remote 命名空间提供，
它在默认桌面 profile 里随内置右侧栏文件树一起启用；客户端只要声明服务依赖。

host 侧最少 3 个文件（见 `notes/snippets/`）：

1. `package.json`：`exports` 含 `"."` 与 `"./client"`；`dsh.bundle.patch` 指向补丁；
   `dsh.client = { platform:'web', inject:[...客户端插件包名] }`。
2. `cordis.patch.yml`：`- insert: [{ id: dsh-2sider, name: 'dsh-2sider' }]`。
   **没有这一行就没有 host fiber，客户端 bundle 不会被扫描/加载**（dsh-client-modules 只扫描已启用的
   Loader 条目，`dsh-client-modules/README.zh.md:12,34`）。
3. `index.js`：`export function apply() {}`（可为空；客户端半侧负责一切）。

**什么时候才需要写 host 代码**：写文件/重命名/删除/上传/递归搜索/自己开 WebSocket 推流/Office 转换等
Remote 面没有的能力 → 按 §3.5 用 `ctx.webServer.register` 自建 `/dsh-2sider/api/*`。
本项目（只读树 + 只读预览）**不需要**。

---

## 6. 证据索引

### 6.1 asar 内路径（`D:\apps\DeepSeek Harness\resources\app.asar`）

| 主题 | 路径（asar 内） | 关键位置 |
|---|---|---|
| ModuleLoader 契约 | `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js` | 1-36（注释）、639-714、832-850、878-899 |
| 模块系统 host 半侧 | `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js` | 61-75、422-444、460-480 |
| 模块系统说明 | `dsh/node_modules/@deepseek-ai/dsh-client-modules/README.zh.md` | 12、34-56、69-101 |
| **平台种子表** | `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js` | 搜 `function OZ()` / `staticModules:` |
| 右侧栏 seat + registry + guide | `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js` | 4555-4611、4856-4893、5030-5126、1280-1315、1476-1512、1518-1564 |
| 右侧栏说明（中文） | `ref/native-sidebar-right/README.zh.md` | 57、81-88、93、104、115-123 |
| 官方文件树 tab（活例） | `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-files/lib/client.js` | 252-261、595-606、934-941、996-1017 |
| 官方文件树说明 | `ref/native-sidebar-files/README.zh.md` | 29-33、38、43 |
| 文本预览（read/readBytes 用法） | `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js` | 242-243、1189-1217、4334-4340 |
| 终端 tab（guide.entry/multiple 例） | `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.js` | 438-490 |
| 会话 header 槽声明 | `dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js` | 18195-18201、20029-20058 |
| workspaceFiles API | `dsh/node_modules/@deepseek-ai/dsh-api-workspace-files/README.zh.md` | 28、38-44、54、71-73、79 |
| workspaceFiles 类型（生成） | `dsh/node_modules/@deepseek-ai/dsh-api-workspace-files/lib/typert.remote-client.js` | 1-90 |
| workspaceFiles 依赖声明 | `dsh/node_modules/@deepseek-ai/dsh-api-workspace-files/package.json` | 41-49 |
| Remote 装配 | `dsh/node_modules/@deepseek-ai/dsh-api-remotes/README.zh.md` | 14、32、36 |

### 6.2 已安装第三方插件（`C:\Users\Kaw0n\.dsh\profiles\desktop\node_modules\dsh-better-sidebar`）

| 主题 | 文件 | 位置 |
|---|---|---|
| 原生 tab 两阶段注册（外部插件实证） | `src/client/native/index.ts` | 87-100、260-335、338-407、410-443 |
| body/title 适配与 `useTabInfo` 用法 | `src/client/native/tab-adapter.tsx` | 484-575、618-673 |
| 会话 cwd（列表 + host 再确认） | `src/client/use-session-root.ts` | 174-198 |
| header utilities 注册 | `src/client/sidebar/bottom-toggle.tsx` | 5-28 |
| 不使用 corner 的理由 | `src/client/Sidebar.tsx` | 12-14 |
| host 路由/WebSocket | `src/index.ts` | 111-112、1306-1316、1446-1488、1496-1534、1741-1808 |
| 客户端 fetch 基址 | `src/client/host-route-url.ts` | 1-70 |
| slot 注册选项与槽服务镜像 | `src/context-types.ts` | 130-157 |
| 客户端 inject 服务名 | `lib/client.js` | 31894-31902 |
| 清单（dsh.client.inject / platform） | `package.json` | 39-54 |

### 6.3 参考技能文档（repo 内）

- `ref/preset-skills/cordis-plugin-development/references/ui-plugin.md`（客户端插件规则）
- `ref/preset-skills/cordis-plugin-development/references/host-plugin.md`（bundle/清单/补丁）
- `ref/preset-skills/cordis-plugin-development/references/practices.md`（UI 章节 31-38，尤其 35）
- `ref/preset-skills/cordis-plugin-development/templates/decoration/`（最小 bundle 三件套）

### 6.4 复现取证命令（只需 Node，无 PowerShell 特性）

```powershell
node tools/asar-inspect.mjs list  "D:\apps\DeepSeek Harness\resources\app.asar" "dsh-client-modules"
node tools/asar-inspect.mjs read  "D:\apps\DeepSeek Harness\resources\app.asar" "dsh/node_modules/@deepseek-ai/dsh-api-workspace-files/package.json"
node tools/asar-inspect.mjs extract "D:\apps\DeepSeek Harness\resources\app.asar" "dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right" "$env:TEMP\sidebar-right"
```

（本次调查把相关包解包到 `%TEMP%\dsh-asar-research\`，路径随会话销毁；引用行号均基于 0.2.1-rc.3 构建产物，
换版本可能漂移。）

---

## 7. 不确定点 / 风险（按影响排序）

1. **`dsh.client.inject` 在 0.2.1-rc.3 浏览器侧未被读取**（`ClientEntries.create` 只传 `{name:id}`，
   全文件搜 `inject` 无消费点）。它可能只是元数据或供其它版本使用。**不要依赖它保证顺序**：
   服务就绪用 bundle `exports.inject`，模块依赖用 `dsh.client.external`。
2. **`ctx.slots.register` 的权威 TypeScript 签名不在 asar 里**（slots 源码被固化进外壳 bundle）：
   `inject` 允许“函数返回对象”和“直接对象”两种写法（官方代码两种都有），其余字段（`select`/`priority`/
   `label`）是从 better-sidebar 的结构镜像 + 零星用例推断的。对本项目用到的字段
   （`name`/`key`/`locale`/`inject`）都有官方直接用例，风险低。
3. **single 槽被二次注册的行为未验证**（throw 还是覆盖未知）。所以 corner 槽只作为“不要用”的结论给出；
   要 header 按钮请用 utilities（list，安全）。
4. **`sidebar.right.tab.guide`（chain）在 asar 内无消费者**，注册签名未实测；本项目不需要。
5. **正文根元素高度契约**：better-sidebar 用 `flex:1` 满足 `.tabBody`；未见文档。若面板高度塌陷，
   改用 `position:absolute; inset:0` 或给根 `height:100%`（snippets 已同时给 flex/height）。
6. **cwd 是会话启动时冻结值**：agent 切到 git worktree 后官方文件树会向 host 重问（better-sidebar 自建
   `session.cwd` 路由）。本项目若需要“当前活动根”，需要额外 host 路由或后续再确认是否有官方 Remote。
7. **未做运行时验证**（任务约束禁止安装/重启）：snippets 是静态合成，未在真实客户端加载过；
   首次实测重点看三处：`ctx.slots.inject` 是否等到槽、`remote.workspaceFiles` 服务是否存在、
   正文根高度是否撑满。
