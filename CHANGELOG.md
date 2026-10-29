# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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

[0.1.1]: https://github.com/SyaJask/dsh-2sidebar/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/SyaJask/dsh-2sidebar/releases/tag/v0.1.0
