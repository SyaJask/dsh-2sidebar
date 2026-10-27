# dsh-2sidebar

[English](README.md) | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness 0.2.1-rc.3](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.3-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)
[![GitHub release](https://img.shields.io/github/v/release/SyaJask/dsh-2sidebar?include_prereleases&label=release)](https://github.com/SyaJask/dsh-2sidebar/releases)

A split-pane file browser for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) right sidebar: **directory tree on the left, the selected file on the right** — both visible at once, so switching files never moves the tree.

![Split files in the DSH right sidebar](docs/screenshot-split-files.png)

> Status: early (`0.1.0`). The plugin uses DSH's client extension points, which are still moving — check [Compatibility](#compatibility) before upgrading DSH.

## Why

DSH's built-in **Files** tab opens a file as a sidebar preview, so browsing and reading share one column. This plugin keeps the tree and the preview side by side in the same tab: click a file, the right pane switches, the tree stays exactly where it was.

| | dsh-2sidebar | Built-in Files tab |
|---|---|---|
| Layout | tree and preview side by side | tree; a file opens as a preview in the same column |
| Browse while reading | both always visible | switch between tree and preview |
| Text / image preview | inline, paged | native preview, all supported formats |
| Tree state | kept while the tab is mounted | kept in the sidebar store |
| Open shortcut | header button / guide card | `Mod+P` |

Both can be installed and used at the same time.

## Features

- **Split view** with a draggable divider (20%–70%); the ratio and the collapsed-tree state are remembered per window.
- **Lazy directory tree** rooted at the session's workspace: directories load when expanded, `Reload` refreshes the root and expanded levels, and empty/truncated/failed states are reported inline.
- **Text preview** paged at 2,000 lines with `Load more` / `End of file`, plus a byte counter.
- **Image preview** for `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `avif` and `svg`.
- **Collapse the tree** to a single preview column, and restore it without losing the selected file.
- **Three entry points**: the split icon in the session header (next to the native sidebar toggle), the guide card on the right sidebar start page, or the plugin's own native tab.
- **Theme-aware styles**, English and Chinese UI.
- **Read-only and offline**: no network calls, no host-side business code, and zero runtime dependencies. File access goes through the host's `workspaceFiles` service, under the same caps as the built-in features.

## Install

### Requirements

- DSH Desktop with a managed profile (tested on `0.2.1-rc.3`; see [Compatibility](#compatibility)).
- The right sidebar and the client plugin manager (both ship with DSH).

### 1. Get the repository

```powershell
git clone https://github.com/SyaJask/dsh-2sidebar.git
```

### 2. Install the bundle

In the DSH Web GUI: **Plugins** → **Add plugin** → enter the absolute path of the `plugin` directory in the clone (for example `C:\src\dsh-2sidebar\plugin`) → **Install**, then switch the **Split files** bundle on.

Or from a terminal (the CLI forwards `add` to pnpm in the profile):

```powershell
dsh plugin --profile desktop add "link:C:/src/dsh-2sidebar/plugin"
```

`desktop` is the default DSH Desktop profile; replace it if your installation uses another name.

No restart is needed: the host reloads the profile in place (HMR). If a tab that is already mounted keeps the old component, press `Ctrl+Shift+R`.

Windows users who do not want to run pnpm can use the backup/rollback script instead (dry-run by default):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\install-local-bundle.ps1 `
  -PluginDir C:\src\dsh-2sidebar\plugin          # prints the plan only
# add -Apply to write; restore with uninstall-local-bundle.ps1 -Name @local/dsh-split-files -Apply
```

> Publishing to npm is planned. Once it is out, installation becomes a package name in the same dialog, with no clone and no local path.

### 3. Open it

- Click the **split icon** in the session header, next to the native "open/collapse right sidebar" button.
- Or open the right sidebar start page and pick the **Split files** card.
- The plugin is a normal sidebar tab: dock, split and fullscreen behave exactly like other tabs.

### Uninstall

- GUI: **Plugins** → the **Split files** bundle → **Remove**.
- CLI:

```powershell
dsh plugin --profile desktop remove @local/dsh-split-files
```

- Script: `notes\scripts\uninstall-local-bundle.ps1 -Name @local/dsh-split-files -Apply` (backs up the profile first).

## Usage

- Click a directory to expand or collapse it; expanding always re-reads that directory.
- Click a file to load it into the right pane. The tree is not moved, scrolled or re-rendered.
- Drag the divider to change the split ratio; the ratio is saved when you release.
- **Reload** refreshes the root and every expanded directory.
- **Hide tree** collapses the left pane; the preview keeps the selected file.
- For text, **Load more** appends the next 2,000-line page; the footer shows `End of file` at the end.
- PDF/Office/HTML files are intentionally not rendered inline — open them in DSH's native preview instead.

## Compatibility

- **Tested**: DSH Desktop `0.2.1-rc.3` on Windows.
- **Expected to work**: other DSH Desktop versions with the same client services (`slots`, `sidebarRightTabs`, `sidebarRight`, `remote.workspaceFiles`), and the macOS/Linux builds; the bundle itself is platform-independent.
- **Install scripts are Windows-only** (`.ps1`); use the GUI or `dsh plugin` on other platforms.
- DSH is in developer preview and its extension APIs can change without notice. If the plugin stops loading after a DSH upgrade, open an issue with the DSH version and the browser console error.

## How it works

The package is a **client-only bundle**:

- `index.js` is an empty host half; all rendering lives in the browser.
- The client registers a sidebar tab **type** (`ctx.sidebarRightTabs`), its **body** and **title** through the `sidebar.right.pane.tab` slot, a header button through `conversation.session.header.utilities`, and its own locale dictionaries (`zh`, `en`).
- Directory listings and file pages come from the host's existing `ctx.remote.workspaceFiles` (`list` / `read` / `readBytes`); the workspace root comes from `ctx.sessions.list`. The plugin adds no host routes and no permissions of its own.
- `cordis.patch.yml` inserts one profile row; `keepMounted: true` keeps the body alive across tab switches, so the tree state survives.

## FAQ

**The plugin does not show up.**
Check that the installed DSH version matches the tested one, that the bundle is enabled in **Plugins**, and look for `[split-files]` messages in the DevTools console. If the bundle fails to load, the rest of DSH keeps working — the tab and header button simply do not appear.

**It says "This session has no workspace directory".**
The tree is rooted at the session's working directory; sessions without one have nothing to browse. Open a session that has a workspace.

**A file says it is too large or binary.**
Text is read as line pages under the host's `maxBytes` (2 MiB per page) and `maxLines` (5,000) caps; images are read as complete files under `maxFileBytes` (32 MiB by default). A single line larger than the page cap cannot be previewed as text.

**Can I open PDF, Office or HTML files in the right pane?**
Not inline. Use DSH's native preview tab for those formats; this plugin focuses on code, configuration and images.

**Does the plugin read or send my files anywhere?**
It is read-only: it calls the host's workspace file service, which applies the same workspace scoping and limits as the built-in UI. The bundle makes no network requests and has no telemetry.

**Where are the split ratio and tree state stored?**
In `localStorage` (`dsh-split-files.ratio`, `dsh-split-files.tree-hidden`). Clear site data or those two keys to reset them.

**Why are there two file tabs?**
The built-in **Files** tab is for opening files into native previews; this plugin is for reading a tree and a file at the same time. They do not conflict.

## Roadmap

- Publish to npm for one-command installation.
- File search/filter, directory-first sorting, hidden-file toggle.
- Auto-refresh through the workspace file change feed.
- "Open in native preview" for PDF/Office/HTML.
- Keyboard navigation and a configurable shortcut.
- Automated tests and CI (the current smoke test covers the registration contract only).
- More UI languages.

## Development

There is no build step: `plugin/client.js` is the deployed client bundle and `plugin/index.js` is the empty host half.

```powershell
node --check plugin/client.js      # syntax
node tools/smoke-client.mjs        # registration + render smoke test
```

To iterate, install the bundle as described above and edit `plugin/client.js`; the host reloads the profile on change. `notes/ui-api.md` and `notes/build-install.md` document the extension API evidence and the install contract (Chinese). `ref/` is local-only reference material and is not part of the repository.

Pull requests and issues are welcome. For anything that touches DSH's internal client APIs, please include the tested DSH version.

## Repository layout

| Path | What |
|---|---|
| `plugin/` | The plugin bundle — the install target |
| `plugin/README.md` | Package README (also used on npm) |
| `notes/` | Implementation notes and install/verification scripts (Chinese) |
| `tools/` | Development helpers: asar inspection, screenshots, smoke test, conflict scanner |
| `docs/` | Screenshots |
| `ref/` | Extracted upstream reference material, git-ignored, local only |

## License

[MIT](LICENSE) © 2026 SyaJask
