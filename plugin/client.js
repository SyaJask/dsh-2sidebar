/**
 * Split-files — a two-pane workspace browser for DSH's right Sidebar.
 *
 * The Client module registers one page tab type into DSH's native right
 * Sidebar (via `ctx.sidebarRightTabs`) and renders its body through the
 * `sidebar.right.pane.tab` slot. The body is one self-contained split view:
 * a lazily loaded directory tree on the left, the selected file's content on
 * the right. Directory listings and file pages come from the Host through
 * `ctx.remote.workspaceFiles`, so this bundle needs no Host routes of its own.
 */
window.__ModuleLoader__.load({
  id: 'dsh-2sidebar',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React;
    const h = React.createElement;

    /**
     * DSH's shared client primitives: the icon set, `PathLabel`, and the
     * file-type icons the native sidebar uses. They come from the shell's
     * frozen module table, not from this package, so no install is needed; a
     * host that does not seed them still gets the complete tree through the
     * local glyph fallbacks below.
     */
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives') ?? {};
      } catch (error) {
        console.warn('[split-files] UI primitives unavailable; using built-in glyphs', error);
        return {};
      }
    })();

    /** Cordis services this Client fiber needs. `sidebarRight` is what the header button's open call runs through. */
    const inject = ['slots', 'sessions', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'];

    /** Package identity: also the native tab implementation id and slot key. */
    const PACKAGE_ID = 'dsh-2sidebar';
    /** Native tab kind this package owns. */
    const KIND = 'split-files';
    /** Locale namespace the Host binds `t` to. Scoped like the package: a
     *  duplicate namespace+locale makes `locale.register` throw, so a generic
     *  name would be the one shared key a future plugin could collide with. */
    const NS = PACKAGE_ID;
    /** Lines read per page; the Host caps a page at 5000. */
    const PAGE_LINES = 2000;
    const RATIO_KEY = 'dsh-2sidebar.ratio';
    const TREE_HIDDEN_KEY = 'dsh-2sidebar.tree-hidden';
    /** Pre-rename keys: read once so an existing install keeps its saved layout. */
    const LEGACY_RATIO_KEY = 'dsh-split-files.ratio';
    const LEGACY_TREE_HIDDEN_KEY = 'dsh-split-files.tree-hidden';

    const IMAGE_MIME = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
      avif: 'image/avif',
      svg: 'image/svg+xml',
    };

    // ---------------------------------------------------------------- locale

    const zh = {
      'type.label': '目录分栏',
      'guide.title': '目录分栏',
      'guide.description': '左边目录树、右边文件内容，边看结构边切文件',
      'tree.title': '目录',
      'tree.loading': '正在读取…',
      'tree.empty': '空目录',
      'tree.truncated': '条目过多，只显示了一部分',
      'tree.noWorkspace': '这个会话没有工作区目录',
      'tree.failed': '目录读取失败',
      'tree.refresh': '重新读取',
      'tree.hide': '收起目录',
      'tree.show': '展开目录',
      'preview.empty': '从左边目录里选一个文件',
      'preview.loading': '正在读取…',
      'preview.more': '加载更多',
      'preview.loadingMore': '正在加载…',
      'preview.eof': '已到文件末尾',
      'preview.binary': '这是二进制文件，不能按文本预览',
      'preview.notFound': '文件不存在或已被删除',
      'preview.tooLarge': '文件太大，无法预览',
      'preview.notFile': '这不是普通文件',
      'preview.failed': '读取失败',
      'preview.truncated': '只显示了一页，可继续加载',
      'preview.unsupportedImage': '图片读取失败',
      'button.open': '打开目录分栏',
    };

    const en = {
      'type.label': 'Split files',
      'guide.title': 'Split files',
      'guide.description': 'Directory tree on the left, file content on the right',
      'tree.title': 'Files',
      'tree.loading': 'Loading…',
      'tree.empty': 'Empty directory',
      'tree.truncated': 'Too many entries; only part is shown',
      'tree.noWorkspace': 'This session has no workspace directory',
      'tree.failed': 'Could not read the directory',
      'tree.refresh': 'Reload',
      'tree.hide': 'Hide the tree',
      'tree.show': 'Show the tree',
      'preview.empty': 'Pick a file in the tree',
      'preview.loading': 'Loading…',
      'preview.more': 'Load more',
      'preview.loadingMore': 'Loading…',
      'preview.eof': 'End of file',
      'preview.binary': 'This is a binary file; no text preview',
      'preview.notFound': 'The file no longer exists',
      'preview.tooLarge': 'The file is too large to preview',
      'preview.notFile': 'This is not a regular file',
      'preview.failed': 'Could not read the file',
      'preview.truncated': 'One page shown; load more to continue',
      'preview.unsupportedImage': 'Could not read the image',
      'button.open': 'Open split files',
    };

    // ----------------------------------------------------------------- icons

    function splitGlyph({ size = 16, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, className, style: { flex: '0 0 auto' },
      },
        h('rect', { x: 1.2, y: 2.2, width: 13.6, height: 11.6, rx: 2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M6.4 2.4v11.2', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M3 5.2h1.6M3 8h1.6M3 10.8h1.6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }));
    }

    function folderGlyph({ size = 16, className, open = false }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, className, style: { flex: '0 0 auto' },
      }, h('path', {
        d: open
          ? 'M1.7 4h4.2l1.2 1.4h7.2v7.2a1 1 0 0 1-1 1H2.7a1 1 0 0 1-1-1V4z'
          : 'M1.7 3.2h4.2l1.2 1.4h7.2v8a1 1 0 0 1-1 1H2.7a1 1 0 0 1-1-1V3.2z',
        stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', fill: 'none',
      }));
    }

    function fileGlyph({ size = 16, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, className, style: { flex: '0 0 auto', opacity: 0.75 },
      }, h('path', {
        d: 'M3.4 2.2h5.4l3.8 3.8v7.8a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1z',
        stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', fill: 'none',
      }), h('path', { d: 'M8.6 2.4v3.6h3.6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', fill: 'none' }));
    }

    /**
     * Icon adapters: the native icon set when the host seeds it, the local
     * glyphs otherwise. The tree therefore matches the built-in Files tab
     * without depending on a primitives export surviving a DSH upgrade.
     */
    function FolderIcon({ open = false }) {
      const Component = open ? primitives.IconFolderOpenRegular : primitives.IconFolderCloseRegular;
      if (typeof Component === 'function') return h(Component, { className: 'dsfs-icon dsfs-folder-icon' });
      return h(folderGlyph, { open, className: 'dsfs-icon dsfs-folder-icon' });
    }

    /** `FileTypeIcon` renders the per-extension badge (MD, JS, …) the Files tab uses. */
    function FileIcon({ name }) {
      if (typeof primitives.FileTypeIcon === 'function' && typeof primitives.classifyFileType === 'function') {
        return h(primitives.FileTypeIcon, {
          kind: primitives.classifyFileType(name),
          size: 16,
          className: 'dsfs-icon',
        });
      }
      return h(fileGlyph, { className: 'dsfs-icon dsfs-muted-icon' });
    }

    function RefreshIcon() {
      const Component = primitives.IconRefreshOutlineRegular;
      return typeof Component === 'function' ? h(Component, {}) : h(refreshGlyph, {});
    }

    function CollapseIcon() {
      const Component = primitives.IconChevronLeftOutlineRegular;
      return typeof Component === 'function' ? h(Component, {}) : h(panelGlyph, { active: false });
    }

    function ExpandIcon() {
      const Component = primitives.IconChevronRightOutlineRegular;
      return typeof Component === 'function' ? h(Component, {}) : h(panelGlyph, { active: true });
    }

    /**
     * A native 28px tool button. The host's Tooltip gives the same delayed
     * bubble the Files tab's reload control uses; without primitives the plain
     * `title` attribute keeps the label reachable.
     */
    function ToolButton({ label, onClick, children }) {
      const Tooltip = primitives.Tooltip;
      const button = h('button', {
        type: 'button',
        className: 'dsfs-tool',
        'aria-label': label,
        title: typeof Tooltip === 'function' ? undefined : label,
        onClick,
      }, children);
      if (typeof Tooltip !== 'function') return button;
      return h(Tooltip, { label, side: 'bottom', delayMs: 500 }, button);
    }

    /**
     * The header path: directory dimmed, basename primary, clipped from the
     * left so the tail stays visible, exactly like the native PathLabel. The
     * local version is only used when primitives are unavailable.
     */
    function PathText({ path }) {
      const Component = primitives.PathLabel;
      if (typeof Component === 'function') return h(Component, { path, className: 'dsfs-path' });
      return h(FallbackPathLabel, { path });
    }

    function FallbackPathLabel({ path }) {
      const box = useRef(null);
      const text = useRef(null);
      useEffect(() => {
        const outer = box.current;
        const inner = text.current;
        if (outer === null || inner === null) return;
        const measure = () => {
          outer.toggleAttribute('data-path-clipped', inner.offsetWidth > outer.clientWidth);
        };
        measure();
        if (typeof ResizeObserver !== 'function') return;
        const observer = new ResizeObserver(measure);
        observer.observe(outer);
        observer.observe(inner);
        return () => observer.disconnect();
      }, [path]);
      const clean = String(path).replace(/[\\/]+$/, '');
      const cut = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
      const directory = cut === -1 ? '' : clean.slice(0, cut + 1);
      const name = cut === -1 ? clean : clean.slice(cut + 1);
      return h('span', { ref: box, className: 'dsfs-path', title: path, 'data-path-label': '' },
        h('span', { ref: text, className: 'dsfs-path-text' },
          directory !== '' ? h('span', { className: 'dsfs-path-dir' }, directory) : null,
          h('span', { className: 'dsfs-path-name' }, name)));
    }

    /** Directories first, then natural name order — the native Files tab's order. */
    const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    function entryType(entry) {
      return entry.type ?? entry.kind;
    }

    function orderEntries(entries) {
      return [...entries].sort((left, right) => {
        const group = Number(entryType(right) === 'directory') - Number(entryType(left) === 'directory');
        return group !== 0 ? group : byName.compare(left.name, right.name);
      });
    }

    function refreshGlyph({ size = 14, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, className, style: { flex: '0 0 auto' },
      }, h('path', {
        d: 'M13 8a5 5 0 1 1-1.5-3.55M13 2.6v3.2H9.8',
        stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none',
      }));
    }

    function panelGlyph({ size = 14, className, active = false }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, className, style: { flex: '0 0 auto', opacity: active ? 1 : 0.7 },
      },
        h('rect', { x: 1.6, y: 2.4, width: 12.8, height: 11.2, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: active ? 'M1.8 3.7h3.6v8.6H1.8z' : 'M5.4 2.6v10.8', fill: active ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.2 }));
    }

    /** The guide card's artwork: the component form the guide host calls. */
    function SplitArtwork({ size = 26, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        className, 'aria-hidden': true,
      },
        h('rect', { x: 2.4, y: 3.4, width: 19.2, height: 17.2, rx: 3, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M9.4 3.6v16.8', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M4.6 7.6h2.4M4.6 11.2h2.4M4.6 14.8h2.4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.85 }),
        h('path', { d: 'M12.4 7.6h6.2M12.4 11.2h4.4M12.4 14.8h5.6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.55 }));
    }

    // ----------------------------------------------------------------- style

    /**
     * The tab body's styles. Values mirror the built-in Files tab and the
     * sidebar document preview (13 px content scale, 38 px headers, 28 px
     * tools, 18 px nested-list indent, 5×10 px row padding), and every colour
     * comes from the shared `--dsw-alias-*` design tokens so light/dark and
     * future themes follow the host automatically.
     */
    const CSS = [
      '.dsfs-root{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;width:100%;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5;overflow:hidden;}',
      '.dsfs-main{flex:1;display:flex;min-height:0;min-width:0;width:100%;}',
      '.dsfs-pane{display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;}',
      '.dsfs-tree-pane{min-width:96px;max-width:72%;}',
      '.dsfs-bar{box-sizing:border-box;display:flex;align-items:center;gap:4px;height:38px;padding:0 6px 0 16px;flex:0 0 auto;border-bottom:.5px solid var(--dsw-alias-border-l3,color-mix(in srgb,currentColor 12%,transparent));}',
      '.dsfs-path{display:flex;flex:1 1 auto;justify-content:flex-end;min-width:0;overflow:hidden;margin-right:12px;font-size:12px;white-space:nowrap;}',
      '.dsfs-path[data-path-clipped]{mask-image:linear-gradient(to right,transparent,#000 28px);}',
      '.dsfs-path-text{flex:none;margin-right:auto;}',
      '.dsfs-path-dir{color:var(--dsw-alias-label-tertiary,inherit);}',
      '.dsfs-path-name{color:var(--dsw-alias-label-primary,inherit);}',
      '.dsfs-header-hint{flex:1 1 auto;min-width:0;margin-right:12px;color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.dsfs-meta{flex:0 0 auto;color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;white-space:nowrap;}',
      '.dsfs-tool{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;flex:0 0 auto;color:var(--dsw-alias-label-secondary,inherit);background:none;border:none;border-radius:var(--dsw-radius-sm,4px);cursor:pointer;line-height:1;}',
      '.dsfs-tool svg{width:15px;height:15px;}',
      '.dsfs-tool[aria-pressed="true"]{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 10%,transparent));}',
      '.dsfs-tool:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,currentColor);outline-offset:-2px;}',
      '@media (hover:hover){.dsfs-tool:hover{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 10%,transparent));}}',
      '.dsfs-tree-body{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;margin-right:2px;padding:8px 0 8px 8px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);}',
      '.dsfs-tree-body::-webkit-scrollbar-track{margin:2px;}',
      '.dsfs-level{margin:0;padding:0;list-style:none;}',
      '.dsfs-level .dsfs-level{padding-left:18px;}',
      '.dsfs-item{margin:0;padding:0;}',
      '.dsfs-row{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-width:0;padding:5px 10px;color:inherit;font:inherit;text-align:left;background:none;border:0;border-radius:var(--dsw-radius-md,6px);cursor:pointer;white-space:nowrap;user-select:none;}',
      '.dsfs-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-active,color-mix(in srgb,currentColor 14%,transparent));}',
      '@media (hover:hover){.dsfs-row:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent));}}',
      '.dsfs-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,currentColor);outline-offset:-2px;}',
      '.dsfs-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;}',
      '.dsfs-folder-icon,.dsfs-muted-icon{color:var(--dsw-alias-label-tertiary,inherit);}',
      '.dsfs-name{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}',
      '.dsfs-note{color:var(--dsw-alias-label-tertiary,inherit);margin:0;padding:3px 10px;font-size:12px;}',
      '.dsfs-note[data-kind="error"]{color:var(--dsw-alias-state-error-primary,inherit);}',
      '.dsfs-status{display:flex;flex-direction:column;padding:12px 10px;}',
      '.dsfs-status-line{margin:0;color:var(--dsw-alias-label-secondary,inherit);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6;}',
      '.dsfs-splitter{position:relative;flex:0 0 5px;cursor:col-resize;background:transparent;}',
      '.dsfs-splitter::after{content:"";position:absolute;top:0;bottom:0;left:2px;width:1px;background:var(--dsw-alias-border-l3,color-mix(in srgb,currentColor 12%,transparent));}',
      '.dsfs-splitter[data-dragging="true"]::after{background:var(--dsw-alias-brand-primary,currentColor);}',
      '@media (hover:hover){.dsfs-splitter:hover::after{background:var(--dsw-alias-brand-primary,currentColor);}}',
      '.dsfs-preview-pane{flex:1 1 auto;}',
      '.dsfs-preview-body{flex:1;min-height:0;overflow:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);}',
      '.dsfs-preview-body::-webkit-scrollbar-track{margin:2px;}',
      '.dsfs-pre{box-sizing:border-box;min-height:100%;margin:0;padding:8px 18px 16px;color:var(--dsw-alias-label-primary,inherit);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6;white-space:pre;tab-size:2;}',
      '.dsfs-image-wrap{display:flex;align-items:center;justify-content:center;min-height:100%;padding:12px;box-sizing:border-box;}',
      '.dsfs-image{max-width:100%;max-height:100%;object-fit:contain;border-radius:var(--dsw-radius-sm,4px);background:var(--dsw-alias-bg-layer-1,color-mix(in srgb,currentColor 6%,transparent));}',
      '.dsfs-empty{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:0 24px;color:var(--dsw-alias-label-secondary,inherit);font-size:var(--dsh-content-font-size-secondary,13px);text-align:center;line-height:1.6;}',
      '.dsfs-more{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:6px 10px;border-top:.5px solid var(--dsw-alias-border-l3,color-mix(in srgb,currentColor 12%,transparent));color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;}',
      '.dsfs-text-btn{display:inline-flex;align-items:center;height:24px;padding:0 10px;color:var(--dsw-alias-label-primary,inherit);font:inherit;background:none;border:.5px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 16%,transparent));border-radius:var(--dsw-radius-sm,4px);cursor:pointer;}',
      '@media (hover:hover){.dsfs-text-btn:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 10%,transparent));}}',
      '.dsfs-text-btn:disabled{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-tertiary,inherit));cursor:default;}',
      '.dsfs-title{display:inline-flex;align-items:center;gap:5px;min-width:0;}',
    ].join('');

    /** Styles for the always-visible header button (lives outside the tab body). */
    const GLOBAL_CSS = [
      '.dsfs-header-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;flex:none;color:var(--dsw-alias-label-secondary,inherit);background:none;border:none;border-radius:var(--dsw-radius-sm,4px);cursor:pointer;line-height:1;}',
      '.dsfs-header-btn svg{width:16px;height:16px;}',
      '.dsfs-header-btn:active{background:var(--dsw-alias-interactive-bg-active,color-mix(in srgb,currentColor 18%,transparent));}',
      '@media (hover:hover){.dsfs-header-btn:hover{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 12%,transparent));}}',
      '.dsfs-header-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,currentColor);outline-offset:-2px;}',
    ].join('');

    /** Mount the stylesheet once per body instance; dropping the node removes it. */
    function Styles() {
      return h('style', { 'data-split-files-style': '' }, CSS);
    }

    // --------------------------------------------------------------- helpers

    function joinPath(parent, name) {
      return String(parent).replace(/[\\/]+$/, '') + '/' + name;
    }

    function baseName(path) {
      const clean = String(path).replace(/[\\/]+$/, '');
      const index = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
      return index === -1 ? clean : clean.slice(index + 1);
    }

    function extensionOf(path) {
      const name = baseName(path);
      const index = name.lastIndexOf('.');
      return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function readStored(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : raw;
      } catch {
        return fallback;
      }
    }

    function writeStored(key, value) {
      try {
        window.localStorage.setItem(key, String(value));
      } catch {
        // Persistence is a nicety; a denied storage cannot break the browser.
      }
    }

    function previewErrorKey(code) {
      if (code === 'workspace-file/not-found') return 'preview.notFound';
      if (code === 'workspace-file/too-large') return 'preview.tooLarge';
      if (code === 'workspace-file/not-regular-file') return 'preview.notFile';
      if (code === 'workspace-file/not-text') return 'preview.binary';
      return 'preview.failed';
    }

    // ---------------------------------------------------------- directory tree

    /**
     * Lazily load a directory tree rooted at one absolute path.
     * @param root - absolute directory path (the session's workspace root).
     * @param list - bound `workspaceFiles.list` call returning a RemoteResult.
     */
    function useTree({ root, list }) {
      const [levels, setLevels] = useState({});
      const [expanded, setExpanded] = useState(() => new Set());
      const generations = useRef(new Map());
      const pending = useRef(new Set());

      const loadDir = useCallback(async (path) => {
        const generation = (generations.current.get(path) ?? 0) + 1;
        generations.current.set(path, generation);
        pending.current.add(path);
        setLevels((prev) => ({
          ...prev,
          [path]: { status: 'loading', entries: prev[path]?.entries ?? [], truncated: false },
        }));
        let result;
        try {
          result = await list(path);
        } catch (error) {
          result = { ok: false, error };
        }
        if (generations.current.get(path) !== generation) return;
        pending.current.delete(path);
        if (result && result.ok) {
          setLevels((prev) => ({
            ...prev,
            [path]: {
              status: 'ready',
              entries: result.value?.entries ?? [],
              truncated: result.value?.truncated === true,
            },
          }));
        } else {
          setLevels((prev) => ({
            ...prev,
            [path]: {
              status: 'error',
              entries: prev[path]?.entries ?? [],
              truncated: false,
              code: result?.error?.code,
            },
          }));
        }
      }, [list]);

      useEffect(() => {
        generations.current = new Map();
        pending.current = new Set();
        setLevels({});
        setExpanded(new Set());
        if (typeof root === 'string' && root.length > 0) loadDir(root);
      }, [root, loadDir]);

      const toggleDir = useCallback((path) => {
        let opened = false;
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else { next.add(path); opened = true; }
          return next;
        });
        // Opening always re-reads the directory: an external change is far more
        // likely between two visits than during one.
        if (opened || !pending.current.has(path)) loadDir(path);
      }, [loadDir]);

      const refresh = useCallback(() => {
        if (typeof root !== 'string' || root.length === 0) return;
        loadDir(root);
        for (const path of Array.from(expanded)) loadDir(path);
      }, [root, expanded, loadDir]);

      return { levels, expanded, toggleDir, refresh };
    }

    /**
     * One directory level as the native tree renders it: a `ul` of `li`
     * entries, each row a full-width button, nested levels indented by the
     * stylesheet (18 px). Directories come before files and are sorted the
     * same way the built-in Files tab sorts them.
     */
    function TreeLevel({ path, depth, levels, expanded, activePath, onToggle, onPick, t }) {
      const level = levels[path];
      if (level === undefined) return null;
      const items = [];
      const list = (children) => h('ul', {
        className: depth === 0 ? 'dsfs-level dsfs-level-root' : 'dsfs-level',
      }, children);
      if (level.status === 'loading' && level.entries.length === 0) {
        return list([h('li', { key: path + '/loading', className: 'dsfs-note' }, t('tree.loading'))]);
      }
      if (level.status === 'error' && level.entries.length === 0) {
        return list([h('li', { key: path + '/failed', className: 'dsfs-note', 'data-kind': 'error' },
          t('tree.failed') + (level.code ? ' (' + level.code + ')' : ''))]);
      }
      if (level.entries.length === 0 && level.status === 'ready') {
        items.push(h('li', { key: path + '/empty', className: 'dsfs-note' }, t('tree.empty')));
      }
      for (const entry of orderEntries(level.entries)) {
        const name = entry.name;
        const childPath = joinPath(path, name);
        // Wire shape: `type` is 'file' | 'directory' | 'other'; `kind` is kept
        // as a fallback so an older Host shape cannot blank the tree.
        const isDir = entryType(entry) === 'directory';
        const isOpen = isDir && expanded.has(childPath);
        items.push(h('li', { key: childPath, className: 'dsfs-item' },
          h('button', {
            type: 'button',
            className: 'dsfs-row',
            'aria-expanded': isDir ? isOpen : undefined,
            'data-active': !isDir && activePath === childPath ? 'true' : 'false',
            'data-directory': isDir ? 'true' : 'false',
            onClick: () => { if (isDir) onToggle(childPath); else onPick(childPath, name); },
          },
            isDir ? h(FolderIcon, { open: isOpen }) : h(FileIcon, { name }),
            h('span', { className: 'dsfs-name' }, name)),
          isDir && isOpen
            ? h(TreeLevel, {
              key: childPath + '/level',
              path: childPath,
              depth: depth + 1,
              levels,
              expanded,
              activePath,
              onToggle,
              onPick,
              t,
            })
            : null));
      }
      if (level.truncated) {
        items.push(h('li', { key: path + '/truncated', className: 'dsfs-note' }, t('tree.truncated')));
      }
      return list(items);
    }

    // ----------------------------------------------------------------- preview

    /**
     * Read one file into the preview pane; text pages append, images become a
     * blob URL.
     * @param read - bound text page reader.
     * @param readBytes - bound byte reader (images); absent on an older Host.
     */
    function usePreview({ read, readBytes }) {
      const [state, setState] = useState({ status: 'idle' });
      const stateRef = useRef(state);
      stateRef.current = state;
      const run = useRef(0);
      const objectUrl = useRef(null);

      const releaseUrl = useCallback(() => {
        if (objectUrl.current !== null) {
          try { URL.revokeObjectURL(objectUrl.current); } catch { /* already gone */ }
          objectUrl.current = null;
        }
      }, []);

      useEffect(() => releaseUrl, [releaseUrl]);

      const open = useCallback(async (path, name) => {
        const runId = ++run.current;
        releaseUrl();
        const ext = extensionOf(path);
        const mime = IMAGE_MIME[ext];

        if (mime !== undefined && typeof readBytes === 'function') {
          setState({ status: 'loading', path, name });
          let bytesResult;
          try {
            bytesResult = await readBytes(path);
          } catch (error) {
            bytesResult = { ok: false, error };
          }
          if (run.current !== runId) return;
          if (bytesResult && bytesResult.ok) {
            const data = bytesResult.value?.data;
            try {
              const url = URL.createObjectURL(new Blob([data], { type: mime }));
              objectUrl.current = url;
              setState({ status: 'image', path, name, url, bytes: bytesResult.value?.bytes });
            } catch (error) {
              setState({ status: 'error', path, name, key: 'preview.unsupportedImage' });
            }
          } else {
            setState({ status: 'error', path, name, key: previewErrorKey(bytesResult?.error?.code) });
          }
          return;
        }

        setState({ status: 'loading', path, name });
        let result;
        try {
          result = await read(path, { offset: 1, limit: PAGE_LINES });
        } catch (error) {
          result = { ok: false, error };
        }
        if (run.current !== runId) return;
        if (result && result.ok) {
          const value = result.value ?? {};
          setState({
            status: 'ready',
            path,
            name,
            text: value.text ?? '',
            lines: value.lines ?? 0,
            offset: value.offset ?? 1,
            eof: value.eof !== false,
            bytes: value.bytes,
          });
        } else {
          setState({ status: 'error', path, name, key: previewErrorKey(result?.error?.code) });
        }
      }, [read, readBytes, releaseUrl]);

      const loadMore = useCallback(async () => {
        const current = stateRef.current;
        if (current.status !== 'ready' || current.eof || current.loadingMore) return;
        const runId = run.current;
        setState({ ...current, loadingMore: true });
        let result;
        try {
          result = await read(current.path, { offset: current.offset + current.lines, limit: PAGE_LINES });
        } catch (error) {
          result = { ok: false, error };
        }
        if (run.current !== runId) return;
        setState((prev) => {
          if (prev.status !== 'ready' || prev.path !== current.path) return prev;
          if (!result || !result.ok) return { ...prev, loadingMore: false, moreFailed: true };
          const value = result.value ?? {};
          return {
            ...prev,
            text: prev.text + (value.text !== undefined && value.text !== '' ? '\n' + value.text : ''),
            lines: prev.lines + (value.lines ?? 0),
            offset: prev.offset,
            eof: value.eof !== false,
            loadingMore: false,
          };
        });
      }, [read]);

      return { state, open, loadMore };
    }

    function PreviewPane({ state, t, onLoadMore }) {
      if (state.status === 'idle') {
        return h('div', { className: 'dsfs-empty' }, t('preview.empty'));
      }
      if (state.status === 'loading') {
        return h('div', { className: 'dsfs-empty' }, t('preview.loading'));
      }
      if (state.status === 'error') {
        return h('div', { className: 'dsfs-empty' }, t(state.key));
      }
      if (state.status === 'image') {
        return h('div', { className: 'dsfs-preview-body' },
          h('div', { className: 'dsfs-image-wrap' },
            h('img', { className: 'dsfs-image', src: state.url, alt: state.name, title: state.path })));
      }
      return h(React.Fragment, null,
        h('div', { className: 'dsfs-preview-body' },
          h('pre', { className: 'dsfs-pre', 'data-split-files-text': '' }, state.text)),
        h('div', { className: 'dsfs-more' },
          state.eof
            ? h('span', null, t('preview.eof'))
            : h('button', {
              type: 'button',
              className: 'dsfs-text-btn',
              onClick: onLoadMore,
              disabled: state.loadingMore === true,
            }, state.loadingMore === true ? t('preview.loadingMore') : t('preview.more'))));
    }

    // ------------------------------------------------------------------ split

    /** Keep a CSS ratio inside the range the splitter allows. */
    function clampRatio(value) {
      const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
      if (!Number.isFinite(numeric)) return 46;
      return Math.min(70, Math.max(20, numeric));
    }

    /**
     * The tab body: one split view with the directory tree and the preview.
     * Props arrive from the slot registration: framework `sessionId`/`t`, the
     * host's `getCwd`/`subscribeSessions`, and the bound Remote readers.
     */
    function Body(props) {
      const { sessionId, t, getCwd, subscribeSessions, list, read, readBytes } = props;
      const cwd = useSyncExternalStore(subscribeSessions, getCwd, getCwd);

      const tree = useTree({ root: cwd, list });
      const preview = usePreview({ read, readBytes });
      const [ratio, setRatio] = useState(() => clampRatio(readStored(RATIO_KEY, readStored(LEGACY_RATIO_KEY, 46))));
      const [treeHidden, setTreeHidden] = useState(() => readStored(TREE_HIDDEN_KEY, readStored(LEGACY_TREE_HIDDEN_KEY, 'false')) === 'true');
      const [dragging, setDragging] = useState(false);
      const containerRef = useRef(null);

      const persistRatio = useCallback((next) => {
        setRatio(next);
        writeStored(RATIO_KEY, Math.round(next));
      }, []);

      const onSplitterDown = useCallback((event) => {
        const container = containerRef.current;
        if (container === null) return;
        event.preventDefault();
        setDragging(true);
        const rect = container.getBoundingClientRect();
        const move = (moveEvent) => {
          const next = clampRatio(((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * 100);
          setRatio(next);
        };
        const up = () => {
          setDragging(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          setRatio((current) => { writeStored(RATIO_KEY, Math.round(current)); return current; });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
      }, []);

      const toggleTree = useCallback(() => {
        setTreeHidden((current) => {
          const next = !current;
          writeStored(TREE_HIDDEN_KEY, next ? 'true' : 'false');
          return next;
        });
      }, []);

      const pickFile = useCallback((path, name) => {
        preview.open(path, name);
      }, [preview]);

      const hasRoot = typeof cwd === 'string' && cwd.length > 0;

      const treePane = h('div', {
        className: 'dsfs-pane dsfs-tree-pane',
        style: treeHidden ? { display: 'none' } : { flex: '0 0 ' + ratio + '%', width: ratio + '%' },
      },
        h('div', { className: 'dsfs-bar' },
          hasRoot
            ? h(PathText, { path: cwd })
            : h('span', { className: 'dsfs-header-hint' }, t('tree.title')),
          h(ToolButton, { label: t('tree.hide'), onClick: toggleTree }, h(CollapseIcon, {})),
          h(ToolButton, { label: t('tree.refresh'), onClick: tree.refresh }, h(RefreshIcon, {}))),
        h('div', { className: 'dsfs-tree-body' },
          hasRoot
            ? h(TreeLevel, {
              path: cwd,
              depth: 0,
              levels: tree.levels,
              expanded: tree.expanded,
              activePath: preview.state.path,
              onToggle: tree.toggleDir,
              onPick: pickFile,
              t,
            })
            : h('div', { className: 'dsfs-status' },
              h('p', { className: 'dsfs-status-line' }, t('tree.noWorkspace')))));

      const previewPane = h('div', { className: 'dsfs-pane dsfs-preview-pane' },
        h('div', { className: 'dsfs-bar' },
          treeHidden
            ? h(ToolButton, { label: t('tree.show'), onClick: toggleTree }, h(ExpandIcon, {}))
            : null,
          preview.state.path !== undefined
            ? h(PathText, { path: preview.state.path })
            : h('span', { className: 'dsfs-header-hint' }, hasRoot ? baseName(cwd) : t('preview.empty')),
          typeof preview.state.bytes === 'number'
            ? h('span', { className: 'dsfs-meta' }, formatBytes(preview.state.bytes))
            : null),
        h(PreviewPane, { state: preview.state, t, onLoadMore: preview.loadMore }));

      return h(React.Fragment, null,
        h(Styles, null),
        h('div', { className: 'dsfs-root', 'data-split-files-root': '' },
          h('div', { className: 'dsfs-main', ref: containerRef },
            treePane,
            treeHidden
              ? null
              : h('div', {
                className: 'dsfs-splitter',
                role: 'separator',
                'aria-orientation': 'vertical',
                'data-dragging': dragging ? 'true' : 'false',
                onPointerDown: onSplitterDown,
              }),
            previewPane)));
    }

    /**
     * The tab chip's title slot: the split glyph plus the title captured when
     * the tab was opened (the framework's own `tab.title`).
     */
    function Title({ useTabInfo }) {
      const { tab } = useTabInfo();
      return h('span', { className: 'dsfs-title' },
        h(splitGlyph, { size: 16 }),
        h('span', null, tab?.title ?? ''));
    }

    // ------------------------------------------------------------------- apply

    /**
     * Client plugin body. The module-level `inject` list makes Cordis run this
     * only once every service below is available, so each one is bound here
     * directly instead of through a nested `ctx.inject` seat.
     * @param ctx - the Client cordis context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'split-files: dictionaries');

      // The header button lives outside the tab body, so its stylesheet is
      // global and removed with the plugin fiber.
      ctx.effect(() => {
        const style = document.createElement('style');
        style.setAttribute('data-split-files-global', '');
        style.textContent = GLOBAL_CSS;
        document.head.appendChild(style);
        return () => { style.remove(); };
      }, 'split-files: global styles');

      /**
       * The always-visible entry point: one split icon next to the host's own
       * session-header utilities that opens (and focuses) the split tab.
       */
      const HeaderButton = () => h('button', {
        type: 'button',
        className: 'dsfs-header-btn',
        title: t('button.open'),
        'aria-label': t('button.open'),
        'data-split-files-open': '',
        onClick: () => {
          // Open through the captured pane target: the host applies the same
          // rule as a guide card or its own open-file shortcut, so an active
          // "Start" (guide) tab gives way to the page it opens, and a collapsed
          // column expands inside that same layout step.
          //
          // Never expand first: the host seeds the default guide page when an
          // empty column expands, so a pre-expansion would leave "Start" beside
          // this tab. An open into a fresh surface must show only what opened.
          //
          // The navigation service acts on the Session's ADOPTED store; a
          // just-opened Session may not have one yet, so retry briefly while
          // its view mounts and adopts the store.
          const attemptOpen = (left) => {
            try {
              const target = typeof ctx.sidebarRight.commandTarget === 'function'
                ? ctx.sidebarRight.commandTarget()
                : undefined;
              if (target !== undefined && typeof ctx.sidebarRight.openTabFromTarget === 'function') {
                ctx.sidebarRight.openTabFromTarget(KIND, target);
                return;
              }
              // Public fallback: an active guide gives way to the page it opens,
              // the same rule the host's own guide entries apply.
              const activeTab = typeof ctx.sidebarRight.active === 'function'
                ? ctx.sidebarRight.active()
                : undefined;
              ctx.sidebarRight.openTab(KIND, activeTab !== undefined && activeTab.kind === 'guide'
                ? { replaceTab: activeTab.id }
                : {});
            } catch (error) {
              if (left > 0) {
                window.setTimeout(() => attemptOpen(left - 1), 180);
                return;
              }
              console.error('[split-files] open tab failed:', error);
            }
          };
          attemptOpen(8);
        },
      }, h(splitGlyph, { size: 16 }));

      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'split-files:header-button',
        order: 20,
        registrant: 'split-files',
      }, HeaderButton)), 'split-files: header button');

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: PACKAGE_ID,
        kind: KIND,
        // The Host keeps a visited body mounted through hiding, tab selection
        // and Session switches, so the expanded tree survives a tab switch.
        keepMounted: true,
        title: () => t('type.label'),
        guide: [{
          id: 'split',
          order: 25,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
          icon: SplitArtwork,
        }],
      }), 'split-files: tab type');

      /** The Session's workspace root, from the live session-list snapshot. */
      const readCwd = (sessionId) => {
        try {
          return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
        } catch {
          return undefined;
        }
      };
      const subscribeSessions = (listener) => {
        try {
          return ctx.sessions.list.subscribe(listener);
        } catch {
          return () => {};
        }
      };

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: PACKAGE_ID,
        locale: NS,
        inject: (sessionId) => ({
          sessionId,
          getCwd: () => readCwd(sessionId),
          subscribeSessions,
          list: (path, signal) => ctx.remote.workspaceFiles.list(sessionId, path, signal),
          read: (path, range, signal) => ctx.remote.workspaceFiles.read(sessionId, path, range, signal),
          readBytes: typeof ctx.remote?.workspaceFiles?.readBytes === 'function'
            ? (path, options, signal) => ctx.remote.workspaceFiles.readBytes(sessionId, path, options ?? {}, signal)
            : undefined,
        }),
      }, Body)), 'split-files: tab body');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: PACKAGE_ID,
      }, Title)), 'split-files: tab title');
    }

    return { inject, apply };
  },
});

