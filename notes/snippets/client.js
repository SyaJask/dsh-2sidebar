// dsh-2sidebar minimal client bundle (plain JS, no build step required).
//
// Registers ONE page-type tab in DSH's native right Sidebar:
//   left  = directory tree (workspaceFiles.list, one level at a time)
//   right = text preview  (workspaceFiles.read, first page)
//
// Contract: this whole file is the package's `./client` export. DSH loads it as
// a classic script, which only REGISTERS the lazy factory; the factory body
// (including the `require('react')` below) runs when the plugin is materialized.
//
// Only `react` is required: `@deepseek-ai/dsh-client-ui-slots` / `-primitives`
// are NOT imported on purpose (see notes/ui-api.md, section 1 and the DSH
// plugin-authoring practice "do not require Harness Client packages").
window.__ModuleLoader__.load({
  id: 'dsh-2sidebar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // The implementation id. Must be unique across ALL registered tab types and
    // doubles as the slot key of the body/title registrations.
    const TYPE_ID = 'dsh-2sidebar'
    // The page kind. Page types have no `patterns`; they are opened by kind.
    const KIND = 'two-pane'
    // Locale namespace registered below.
    const NS = 'dsh2sider'
    // How many lines one preview page asks for (host default maxLines is 5000).
    const PAGE_LINES = 2000

    // ---------------------------------------------------------------- helpers

    /** Read one session's cwd from the client session list (reactive). */
    function useSessionCwd(ctx, sessionId) {
      const subscribe = React.useCallback(
        (listener) => ctx.sessions.list.subscribe(listener),
        [ctx],
      )
      const getSnapshot = React.useCallback(() => {
        const byId = ctx.sessions.list.getSnapshot().byId || {}
        const row = byId[sessionId]
        return row === undefined ? undefined : row.cwd
      }, [ctx, sessionId])
      return React.useSyncExternalStore(subscribe, getSnapshot, () => undefined)
    }

    /** Join a directory path and a child name with '/' (both path flavours). */
    function joinPath(dir, name) {
      if (dir === undefined || dir === '') return name
      return dir.slice(-1) === '/' ? dir + name : dir + '/' + name
    }

    /** Parent directory of an absolute path, or undefined at a filesystem root. */
    function parentPath(path) {
      if (path === undefined) return undefined
      const trimmed = path.replace(/[\\/]+$/, '')
      // "/", "C:", "C:/", "//server/share" are roots: no parent row.
      if (trimmed === '' || /^[A-Za-z]:$/.test(trimmed)) return undefined
      const cut = trimmed.lastIndexOf('/')
      if (cut <= 0) return undefined
      return path.slice(0, cut)
    }

    /**
     * One abort signal that ends when either the caller cancels or the tab
     * occurrence is torn down (tab.signal). Not AbortSignal.any: this bundle
     * stays compatible with older Chromium builds.
     */
    function linkedSignal(outer) {
      const controller = new AbortController()
      const abort = () => controller.abort()
      if (outer !== undefined && outer !== null) {
        if (outer.aborted) controller.abort()
        else outer.addEventListener('abort', abort, { once: true })
      }
      return {
        signal: controller.signal,
        dispose: () => {
          if (outer !== undefined && outer !== null) outer.removeEventListener('abort', abort)
          controller.abort()
        },
      }
    }

    /**
     * List one directory through the workspaceFiles Remote namespace.
     * Returns the ok/error envelope untouched so the caller can branch on
     * `error.code` (workspace-file/not-found, outside-workspace, ...).
     */
    async function listDirectory(ctx, sessionId, absolutePath, signal) {
      return ctx.remote.workspaceFiles.list(sessionId, absolutePath, signal)
    }

    /** Read the first page of a text file through workspaceFiles.read. */
    async function readTextPage(ctx, sessionId, absolutePath, signal) {
      return ctx.remote.workspaceFiles.read(
        sessionId,
        absolutePath,
        { offset: 1, limit: PAGE_LINES },
        signal,
      )
    }

    // ------------------------------------------------------------- components

    /** One tree row. */
    function Row({ entry, onOpen }) {
      const isDir = entry.type === 'directory'
      const isFile = entry.type === 'file'
      return h(
        'button',
        {
          type: 'button',
          disabled: !isDir && !isFile,
          onClick: () => onOpen(entry),
          title: entry.name,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '3px 8px',
            border: 0,
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: isDir || isFile ? 'pointer' : 'default',
            opacity: entry.type === 'other' ? 0.55 : 1,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          },
        },
        h('span', { 'aria-hidden': true }, isDir ? 'DIR ' : isFile ? 'FILE' : '?'),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, entry.name),
      )
    }

    /**
     * The tab body. Framework props this component is guaranteed to receive:
     *   - `sessionId`: the session the slot is scoped to
     *   - `useTabInfo`: the seat's bound hook -> { sidebar, panel, tab }
     *     (`tab.actions`, `tab.visible`, `tab.signal`, `tab.navigation`, ...)
     *   - `t`: locale-bound translate for namespace `locale` (only when the
     *     registration passes `locale: NS`)
     * The injected bag below adds `ctx`.
     */
    function TwoPaneBody(props) {
      const { sessionId, ctx, t } = props
      // `useTabInfo` must be called unconditionally; it throws if the record is
      // not committed, which the seat guarantees.
      const info = props.useTabInfo()
      const tab = info.tab
      const cwd = useSessionCwd(ctx, sessionId)
      const [dir, setDir] = React.useState(undefined)
      const [listing, setListing] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [file, setFile] = React.useState(undefined)
      const [preview, setPreview] = React.useState(undefined)

      // The tree root is the session cwd until the reader navigates.
      const root = dir === undefined ? cwd : dir

      // Load the current directory. The tab's abort signal ends the request
      // when the tab occurrence unmounts.
      React.useEffect(() => {
        if (root === undefined || root === '') {
          setListing(undefined)
          return undefined
        }
        const lifetime = linkedSignal(tab.signal)
        const signal = lifetime.signal
        let current = true
        setError(undefined)
        listDirectory(ctx, sessionId, root, signal)
          .then((result) => {
            if (!current) return
            if (result === undefined || result.ok !== true) {
              setListing(undefined)
              setError(result && result.error ? result.error.code : 'list-failed')
              return
            }
            setListing(result.value)
          })
          .catch((failure) => {
            if (!current) return
            setError(String(failure && failure.message ? failure.message : failure))
          })
        return () => {
          current = false
          lifetime.dispose()
        }
      }, [ctx, sessionId, root, tab.id, tab.signal])

      // Load the page of the selected file.
      React.useEffect(() => {
        if (file === undefined) {
          setPreview(undefined)
          return undefined
        }
        const lifetime = linkedSignal(tab.signal)
        const signal = lifetime.signal
        let current = true
        setPreview({ kind: 'loading' })
        readTextPage(ctx, sessionId, file, signal)
          .then((result) => {
            if (!current) return
            if (result === undefined || result.ok !== true) {
              setPreview({
                kind: 'error',
                code: result && result.error ? result.error.code : 'read-failed',
              })
              return
            }
            setPreview({
              kind: 'text',
              text: result.value.text,
              lines: result.value.lines,
              eof: result.value.eof,
            })
          })
          .catch((failure) => {
            if (!current) return
            setPreview({
              kind: 'error',
              code: String(failure && failure.message ? failure.message : failure),
            })
          })
        return () => {
          current = false
          lifetime.dispose()
        }
      }, [ctx, sessionId, file, tab.id, tab.signal])

      const onOpen = (entry) => {
        const absolute = joinPath(root, entry.name)
        if (entry.type === 'directory') {
          setFile(undefined)
          setDir(absolute)
          return
        }
        if (entry.type !== 'file') return
        setFile(absolute)
        // Alternative: hand the file to DSH's own preview tab instead of
        // rendering it here. The address carries a path relative to the
        // session workspace root (an absolute path is passed through too):
        //   tab.actions.openResource(
        //     'dsh-resource://file/session/' + sessionId + '/' + relativePath,
        //   )
      }

      const up = parentPath(root)
      const canGoUp = up !== undefined && cwd !== undefined && root !== cwd

      return h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 34%) 1fr',
            flex: '1 1 auto',
            minHeight: 0,
            height: '100%',
          },
        },
        // ---- left: directory tree -------------------------------------
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderRight: '1px solid rgba(128,128,128,.28)',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                padding: '4px 8px',
                borderBottom: '1px solid rgba(128,128,128,.18)',
                fontSize: 12,
                opacity: 0.8,
                overflow: 'hidden',
              },
              title: root === undefined ? '' : root,
            },
            h(
              'button',
              {
                type: 'button',
                disabled: !canGoUp,
                onClick: () => {
                  if (canGoUp) setDir(up)
                },
                style: {
                  border: 0,
                  background: 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  cursor: canGoUp ? 'pointer' : 'default',
                  opacity: canGoUp ? 1 : 0.4,
                },
              },
              '..',
            ),
            h(
              'span',
              { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              root || t('noCwd'),
            ),
          ),
          h(
            'div',
            { style: { flex: '1 1 auto', overflow: 'auto', padding: '2px 0' }, role: 'tree' },
            error !== undefined
              ? h('div', { style: { padding: '6px 8px', opacity: 0.7, fontSize: 12 } }, error)
              : listing === undefined
                ? h('div', { style: { padding: '6px 8px', opacity: 0.7, fontSize: 12 } }, t('loading'))
                : listing.entries.length === 0
                  ? h('div', { style: { padding: '6px 8px', opacity: 0.7, fontSize: 12 } }, t('empty'))
                  : listing.entries.map((entry) =>
                      h(Row, { key: entry.name, entry, onOpen }),
                    ),
          ),
        ),
        // ---- right: preview -------------------------------------------
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
          h(
            'div',
            {
              style: {
                padding: '4px 10px',
                borderBottom: '1px solid rgba(128,128,128,.18)',
                fontSize: 12,
                opacity: 0.8,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
              title: file || '',
            },
            file || t('noFile'),
          ),
          h(
            'div',
            { style: { flex: '1 1 auto', overflow: 'auto', padding: '8px 12px', minHeight: 0 } },
            preview === undefined
              ? null
              : preview.kind === 'loading'
                ? h('div', { style: { opacity: 0.7, fontSize: 12 } }, t('loading'))
                : preview.kind === 'error'
                  ? h('div', { style: { opacity: 0.7, fontSize: 12 } }, preview.code)
                  : h(
                      'pre',
                      {
                        style: {
                          margin: 0,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          fontSize: 12,
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        },
                      },
                      preview.text,
                    ),
          ),
        ),
      )
    }

    /** The tab chip's live content (optional: without it the opening title is kept). */
    function TwoPaneTitle(props) {
      const t = props.t
      return h('span', null, t ? t('title') : 'Two-pane')
    }

    // -------------------------------------------------------------- lifecycle

    return {
      // Cordis services this client half needs before `apply` runs. Names on
      // the right are the CLIENT service ids (not package names): the tab
      // registry, the slot registry, the locale service, the session list and
      // the Remote carrier + its workspace-files namespace.
      inject: ['slots', 'locale', 'sessions', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'],

      apply(ctx) {
        const t = ctx.locale.bind(NS)

        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              en: {
                title: 'Two-pane',
                description: 'Directory tree and file preview side by side.',
                loading: 'Loading...',
                empty: 'Empty directory',
                noFile: 'Select a file',
                noCwd: 'This session has no working directory',
              },
              // Add a `zh: { ... }` dictionary here for Chinese copy (the file is
              // UTF-8; this skeleton stays pure ASCII on purpose so no toolchain
              // ever mangles the bundle).
            }),
          'dsh-2sidebar: locale',
        )

        // Phase 1: the tab TYPE. A static declaration; no runtime hooks.
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: TYPE_ID,
              kind: KIND,
              priority: 'extension',
              title: () => t('title'),
              guide: [
                {
                  id: 'two-pane',
                  order: 100,
                  title: () => t('title'),
                  description: () => t('description'),
                },
              ],
            }),
          'dsh-2sidebar: tab type',
        )

        // Phase 2a: the body, keyed by the SAME id. The registration waits for
        // the seat's `sidebar.right.pane.tab` declaration (ctx.slots.inject).
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab',
                  key: TYPE_ID,
                  locale: NS,
                  inject: (sessionId) => ({ ctx, sessionId }),
                },
                TwoPaneBody,
              ),
            ),
          'dsh-2sidebar: tab body',
        )

        // Phase 2b: the chip title (optional; the title captured at open time is
        // used when this registration is absent).
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab.title', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab.title',
                  key: TYPE_ID,
                  inject: () => ({ t }),
                },
                TwoPaneTitle,
              ),
            ),
          'dsh-2sidebar: tab title',
        )
      },
    }
  },
})
