# dsh-2sidebar

A split-pane file browser for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) right sidebar: directory tree on the left, the selected file on the right — both visible at once.

![Split files in the DSH right sidebar](https://raw.githubusercontent.com/SyaJask/dsh-2sidebar/main/docs/screenshot-split-files.png)

Full documentation: [English](https://github.com/SyaJask/dsh-2sidebar#readme) · [中文](https://github.com/SyaJask/dsh-2sidebar/blob/main/README.zh.md).

## Features

- Two panes in one sidebar tab, with a draggable divider (20%–70%) and a remembered ratio.
- Lazily loaded directory tree rooted at the session workspace, with reload, empty, truncated and error states.
- Paged text preview (2,000 lines per page) and inline images (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `avif`, `svg`).
- Collapsible tree, three entry points, theme-aware styling, English/Chinese UI.
- Read-only, no network, no host-side business code, zero runtime dependencies.

## Install

```powershell
dsh plugin --profile desktop add dsh-2sidebar
```

Or in the DSH Web GUI: **Plugins** → **Add plugin** → `dsh-2sidebar` → **Install**, then enable the **Split files** bundle.

To develop against a clone, install the package directory directly instead:

```powershell
dsh plugin --profile desktop add "link:C:/src/dsh-2sidebar/plugin"
```

Uninstall with:

```powershell
dsh plugin --profile desktop remove dsh-2sidebar
```

Replace `desktop` with your profile name if it differs. No restart is needed (the host reloads the profile in place); if an already-mounted tab keeps the old component, press `Ctrl+Shift+R`.

## Usage

Open the tab from the split icon in the session header, from the right sidebar start page, or as a normal sidebar tab. Click a file to preview it; the tree stays put. `Reload` refreshes the root and expanded directories, `Hide tree` collapses the left pane, and `Load more` appends the next text page.

## Compatibility

Tested with DSH Desktop `0.2.1-rc.3`. The bundle is client-only and platform-independent, but DSH's extension APIs are still moving; after a DSH upgrade, check the console for `[split-files]` errors and open an issue with the version.

## Known limitations

- Text and images only; use DSH's native preview tab for PDF/Office/HTML.
- The tree is rooted at the session working directory; no browsing outside the workspace.
- Text reads follow the host caps (`maxBytes` 2 MiB per page, `maxLines` 5,000); images follow `maxFileBytes` (32 MiB default); directory listings follow `maxEntries`.
- No file search, syntax highlighting or auto-refresh yet.

## License

[MIT](LICENSE) © 2026 SyaJask
