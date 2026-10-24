# dsh-2sider

为 DeepSeek Harness（DSH）桌面版做的右侧栏「目录分栏」插件工作区。

**成品在 [`plugin/`](plugin/README.md)**：一个纯客户端 bundle，在右侧栏里提供
「左目录树 + 右文件内容」的两列视图，可从会话标题栏按钮、右侧栏开始页或页签条直接打开。

## 目录

| 路径 | 说明 |
|---|---|
| `plugin/` | 插件本体（安装目标就是这个目录） |
| `plugin/README.md` | 用法、安装/卸载、实现要点与限制 |
| `notes/ui-api.md` | 客户端 UI 扩展 API 的取证报告（插槽、页签注册、Remote 读取） |
| `notes/build-install.md` | 本地 bundle 的清单契约、安装链路、生效条件、验证与回滚 |
| `notes/scripts/` | 安装/卸载/状态检查/证据采集脚本（可审阅，默认 DryRun） |
| `notes/snippets/` | 最小可运行客户端 bundle 片段 |
| `tools/` | asar 解析、窗口截图、安全点击、插件图检查、客户端 bundle 冒烟测试 |
| `ref/` | 从安装包内提取的官方文档、模板与原生右侧栏参考实现 |

## 快速自检

```powershell
node --check plugin/client.js
node tools/smoke-client.mjs                  # 模块契约 + 注册项 + 组件渲染冒烟
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\check-profile-state.ps1 `
  -PluginId "@local/dsh-split-files"        # 只读：看插件是否已被宿主加载
```

## 环境事实（本机）

- DSH Desktop 0.2.1-rc.3，profile `desktop`，GUI `http://127.0.0.1:25039`。
- 宿主没有对外暴露 CDP / UI Automation 可用的无障碍树，界面验证靠窗口截图
  （`tools/capture-window3.ps1`）+ `/plugins/events` 的客户端插件图（`notes/scripts/check-profile-state.ps1`）。
- 装/卸载会写 `C:\Users\<你>\.dsh\profiles\desktop`，脚本会先备份到 `%TEMP%` 并打印回滚命令。
