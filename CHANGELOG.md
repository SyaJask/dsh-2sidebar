# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-11-01

### Changed

- The client tab now reads the session workspace root through the framework's
  standard `useSessions` prop instead of subscribing to the session store
  itself, so components carry no subscription machinery. The unused `sessions`
  Cordis service is no longer injected; behavior is unchanged.
- The declared DSH compatibility floor (`engines.dsh`) is now `0.2.1-rc.5`,
  matching the version the client APIs are verified against.

## [0.1.2] - 2026-11-01

### Changed

- The npm package now lives at the repository root: `plugin/` is gone, so the
  install target is the repository root and the bundle is `package.json`,
  `index.js`, `client.js`, `cordis.patch.yml`, `locale/` and `icon.svg`.
- The bundle manifest now follows the DSH plugin contract: `engines.dsh`, an
  exported `./package.json`, a host-half `name`, package-name
  `dsh.client.inject` edges, and a patch row without an empty `config`.
- The split tab now follows the native sidebar tab's visual language: the
  built-in Files tab's 13 px content scale, 38 px headers, 28 px tool buttons,
  5×10 px row padding, 18 px nested indentation, DSH design tokens, the shared
  `PathLabel`, and the native folder, per-extension file-type and compare-split
  icons. Directories are listed before files, as in the native Files tab, and
  the tree uses the open/closed folder icons instead of separate chevrons.
- The plugin no longer carries local copies of `PathLabel` or of the folder,
  file, refresh and panel glyphs; DSH's shared client primitives are now a
  required baseline module (`PLATFORM_MODULES` on supported releases).

### Fixed

- Opening the split tab from the session header no longer expands an empty
  right sidebar first, so a fresh or fully closed session shows only the split
  tab instead of the default "Start" guide tab beside it. When the Start tab is
  active, it now gives way to the split tab like the host's own guide entries.

## [0.1.1] - 2026-10-28

### Changed

- Releases are now published from GitHub Actions through npm trusted
  publishing (OIDC) with provenance. No plugin behavior changes.

## [0.1.0] - 2026-10-27

### Added

- Split-pane right-sidebar tab: directory tree on the left, paged text or image
  preview on the right, with a draggable and remembered split ratio.
- Three entry points: the session header button, the right-sidebar guide card,
  and the plugin's own native tab.
- English and Chinese UI, theme-aware styles, and `keepMounted` state retention.
- npm packaging as `dsh-2sidebar`, MIT license, English README and Chinese
  mirror.

### Changed

- The bundle is named `dsh-2sidebar` (previously `@local/dsh-split-files`); the
  old `dsh-split-files.*` localStorage keys are still read once.

[Unreleased]: https://github.com/SyaJask/dsh-2sidebar/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/SyaJask/dsh-2sidebar/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/SyaJask/dsh-2sidebar/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/SyaJask/dsh-2sidebar/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/SyaJask/dsh-2sidebar/releases/tag/v0.1.0
