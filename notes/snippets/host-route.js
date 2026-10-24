/**
 * REFERENCE ONLY -- not needed for the tree + preview panel.
 *
 * The workspaceFiles Remote namespace already covers list/read/stat/readBytes/
 * changes, so a pure-client panel needs no host code beyond an empty `apply()`.
 * Write this file instead of index.js only when the panel needs something the
 * Remote surface does not expose (writes, rename, recursive search, streaming
 * binary over a custom endpoint, ...).
 *
 * Shape copied from the installed dsh-better-sidebar host half
 * (C:\Users\Kaw0n\.dsh\profiles\desktop\node_modules\dsh-better-sidebar\src\index.ts,
 * routes at lines 1446-1488, fence at line 1316).
 */
import { Buffer } from 'node:buffer'

// Services that must exist before apply() runs. `webServer` is the HTTP carrier,
// `connection` is the request-admission fence (same one the GUI itself uses),
// `sessions` resolves a live session and its cwd on the host.
export const inject = ['webServer', 'sessions', 'connection']

/** One JSON envelope, identical to /sidebar/api/* in better-sidebar. */
function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

const writeOk = (res, value) => writeJson(res, 200, { ok: true, value })
const writeError = (res, status, code, message) =>
  writeJson(res, status, { ok: false, error: { code, message } })

/**
 * @param {Context} ctx
 */
export function apply(ctx) {
  // Admission fence: rejects cross-origin / unauthenticated callers exactly
  // like the harness's own routes (401/403), returns undefined when admitted.
  const fence = (req) => ctx.connection.requestRejection(req) === undefined

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-2sider/api',
        handler: async (req, res) => {
          if (!fence(req)) {
            writeError(res, 403, 'forbidden', 'forbidden')
            return
          }
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const method = url.pathname.slice('/dsh-2sider/api/'.length)
          try {
            if (method === 'ping') {
              writeOk(res, { pong: true })
              return
            }
            writeError(res, 404, 'not-found', 'unknown method: ' + method)
          } catch (error) {
            writeError(res, 500, 'error', String(error?.message ?? error))
          }
        },
      }),
    'dsh-2sider: host routes',
  )
}

/**
 * CLIENT SIDE (drop into client.js). Resolve the route against the page base,
 * never against the origin root: the desktop shell serves the page from
 * `dsh-app://app/` and forwards it to the host, and a reverse-proxied GUI lives
 * under a directory prefix. See dsh-better-sidebar src/client/host-route-url.ts.
 *
 *   async function callHost(method, payload) {
 *     const url = new URL('dsh-2sider/api/' + method, document.baseURI)
 *     const response = await fetch(url, {
 *       method: 'POST',
 *       headers: { 'content-type': 'application/json' },
 *       body: JSON.stringify(payload),
 *     })
 *     const parsed = await response.json()
 *     if (!response.ok || parsed.ok !== true) {
 *       throw new Error(parsed?.error?.code ?? 'http')
 *     }
 *     return parsed.value
 *   }
 */
