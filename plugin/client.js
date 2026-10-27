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
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
    const h = React.createElement;

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

    function chevronGlyph({ size = 12, className, open = false }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, className,
        style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' },
      }, h('path', { d: 'M6 3.6 10.4 8 6 12.4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }));
    }

    function folderGlyph({ size = 14, className, open = false }) {
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

    function fileGlyph({ size = 14, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, className, style: { flex: '0 0 auto', opacity: 0.75 },
      }, h('path', {
        d: 'M3.4 2.2h5.4l3.8 3.8v7.8a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1z',
        stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', fill: 'none',
      }), h('path', { d: 'M8.6 2.4v3.6h3.6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', fill: 'none' }));
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

    const CSS = [
      '.dsfs-root{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;width:100%;color:inherit;font:inherit;font-size:12px;overflow:hidden;}',
      '.dsfs-main{flex:1;display:flex;min-height:0;min-width:0;width:100%;}',
      '.dsfs-pane{display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;}',
      '.dsfs-tree-pane{border-right:1px solid color-mix(in srgb,currentColor 12%,transparent);min-width:96px;max-width:72%;}',
      '.dsfs-bar{display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;flex:0 0 auto;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent);}',
      '.dsfs-bar-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.72;font-size:11px;letter-spacing:.02em;}',
      '.dsfs-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;opacity:.72;flex:0 0 auto;}',
      '.dsfs-icon-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent);opacity:1;}',
      '.dsfs-icon-btn[data-active="true"]{opacity:1;}',
      '.dsfs-tree{flex:1;overflow:auto;padding:4px 0 10px;}',
      '.dsfs-row{display:flex;align-items:center;gap:5px;height:24px;padding-right:8px;cursor:pointer;white-space:nowrap;user-select:none;border-radius:4px;margin:0 4px;}',
      '.dsfs-row:hover{background:color-mix(in srgb,currentColor 8%,transparent);}',
      '.dsfs-row[data-active="true"]{background:color-mix(in srgb,currentColor 15%,transparent);}',
      '.dsfs-name{overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto;}',
      '.dsfs-spacer{width:12px;flex:0 0 auto;}',
      '.dsfs-note{padding:4px 10px;opacity:.55;line-height:1.6;}',
      '.dsfs-note[data-kind="error"]{color:#e06c75;opacity:.9;}',
      '.dsfs-splitter{flex:0 0 5px;cursor:col-resize;background:transparent;position:relative;}',
      '.dsfs-splitter:hover,.dsfs-splitter[data-dragging="true"]{background:color-mix(in srgb,currentColor 18%,transparent);}',
      '.dsfs-preview-pane{flex:1 1 auto;}',
      '.dsfs-preview-body{flex:1;min-height:0;overflow:auto;}',
      '.dsfs-pre{margin:0;padding:8px 10px 16px;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:12px;line-height:1.55;white-space:pre;tab-size:2;}',
      '.dsfs-image-wrap{display:flex;align-items:center;justify-content:center;padding:12px;min-height:100%;box-sizing:border-box;}',
      '.dsfs-image{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;background:color-mix(in srgb,currentColor 6%,transparent);}',
      '.dsfs-empty{display:flex;align-items:center;justify-content:center;height:100%;padding:16px;opacity:.55;text-align:center;line-height:1.6;}',
      '.dsfs-more{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid color-mix(in srgb,currentColor 10%,transparent);opacity:.8;}',
      '.dsfs-text-btn{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:4px 8px;border-radius:5px;}',
      '.dsfs-text-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent);}',
      '.dsfs-title{display:inline-flex;align-items:center;gap:5px;min-width:0;}',
      '.dsfs-hidden{display:none;}',
    ].join('');

    /** Styles for the always-visible header button (lives outside the tab body). */
    const GLOBAL_CSS = [
      '.dsfs-header-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;opacity:.72;}',
      '.dsfs-header-btn:hover{background:color-mix(in srgb,currentColor 12%,transparent);opacity:1;}',
      '.dsfs-header-btn:active{background:color-mix(in srgb,currentColor 18%,transparent);}',
      '.dsfs-header-btn:focus-visible{outline:2px solid color-mix(in srgb,currentColor 45%,transparent);outline-offset:1px;}',
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

    function TreeLevel({ path, depth, levels, expanded, activePath, onToggle, onPick, t }) {
      const level = levels[path];
      if (level === undefined) return null;
      if (level.status === 'loading' && level.entries.length === 0) {
        return h('div', { className: 'dsfs-note' }, t('tree.loading'));
      }
      if (level.status === 'error' && level.entries.length === 0) {
        return h('div', { className: 'dsfs-note', 'data-kind': 'error' }, t('tree.failed') + (level.code ? ' (' + level.code + ')' : ''));
      }
      const rows = [];
      if (level.entries.length === 0 && level.status === 'ready') {
        rows.push(h('div', { key: path + '/empty', className: 'dsfs-note', style: { paddingLeft: 10 + depth * 12 } }, t('tree.empty')));
      }
      for (const entry of level.entries) {
        const name = entry.name;
        const childPath = joinPath(path, name);
        // Wire shape: `type` is 'file' | 'directory' | 'other'; `kind` is kept
        // as a fallback so an older Host shape cannot blank the tree.
        const isDir = (entry.type ?? entry.kind) === 'directory';
        const isOpen = isDir && expanded.has(childPath);
        rows.push(h('div', {
          key: childPath,
          className: 'dsfs-row',
          role: 'treeitem',
          'aria-expanded': isDir ? isOpen : undefined,
          'aria-label': name,
          'data-active': !isDir && activePath === childPath ? 'true' : 'false',
          'data-directory': isDir ? 'true' : 'false',
          title: childPath,
          style: { paddingLeft: 6 + depth * 12 },
          onClick: () => { if (isDir) onToggle(childPath); else onPick(childPath, name); },
        },
          isDir
            ? h(chevronGlyph, { open: isOpen })
            : h('span', { className: 'dsfs-spacer' }),
          isDir ? h(folderGlyph, { open: isOpen }) : h(fileGlyph, {}),
          h('span', { className: 'dsfs-name' }, name),
        ));
        if (isDir && isOpen) {
          rows.push(h(TreeLevel, {
            key: childPath + '/level',
            path: childPath,
            depth: depth + 1,
            levels,
            expanded,
            activePath,
            onToggle,
            onPick,
            t,
          }));
        }
      }
      if (level.truncated) {
        rows.push(h('div', { key: path + '/truncated', className: 'dsfs-note', style: { paddingLeft: 10 + depth * 12 } }, t('tree.truncated')));
      }
      return h('div', { role: 'group' }, rows);
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
            ? h('span', { style: { opacity: 0.55 } }, t('preview.eof'))
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
          h('button', {
            type: 'button', className: 'dsfs-icon-btn', title: t('tree.hide'), 'aria-label': t('tree.hide'),
            onClick: toggleTree,
          }, h(panelGlyph, { active: false })),
          h('span', { className: 'dsfs-bar-label', title: hasRoot ? cwd : '' }, t('tree.title')),
          h('button', {
            type: 'button', className: 'dsfs-icon-btn', title: t('tree.refresh'), 'aria-label': t('tree.refresh'),
            onClick: tree.refresh,
          }, h(refreshGlyph, {}))),
        h('div', { className: 'dsfs-tree', role: 'tree' },
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
            : h('div', { className: 'dsfs-note' }, t('tree.noWorkspace'))));

      const previewPane = h('div', { className: 'dsfs-pane dsfs-preview-pane' },
        h('div', { className: 'dsfs-bar' },
          treeHidden
            ? h('button', {
              type: 'button', className: 'dsfs-icon-btn', title: t('tree.show'), 'aria-label': t('tree.show'),
              onClick: toggleTree,
            }, h(panelGlyph, { active: true }))
            : null,
          h('span', { className: 'dsfs-bar-label', title: preview.state.path ?? '' },
            preview.state.name ?? (hasRoot ? baseName(cwd) : '')),
          typeof preview.state.bytes === 'number'
            ? h('span', { style: { opacity: 0.5, fontSize: 11 } }, formatBytes(preview.state.bytes))
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
        h(splitGlyph, { size: 14 }),
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
          // The navigation service acts on the session's ADOPTED store; a
          // collapsed column may not have adopted it yet, so opening retries
          // briefly while the panel renders.
          const attemptOpen = (left) => {
            try {
              ctx.sidebarRight.openTab(KIND);
            } catch (error) {
              if (left > 0) {
                window.setTimeout(() => attemptOpen(left - 1), 180);
                return;
              }
              console.error('[split-files] open tab failed:', error);
            }
          };
          let expanded = false;
          try {
            expanded = ctx.sidebarRight.isExpanded() === true;
          } catch {
            expanded = false;
          }
          if (expanded) {
            attemptOpen(0);
            return;
          }
          // Collapsed: expand first, then open. Both calls go through the
          // session's adopted store, so the open below retries while the panel
          // renders and adopts it. (No reading of the host's own expand
          // control: that would couple this bundle to a host-internal DOM.)
          try {
            ctx.sidebarRight.toggleExpanded();
          } catch (error) {
            console.error('[split-files] expand failed:', error);
          }
          window.setTimeout(() => attemptOpen(6), 240);
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

