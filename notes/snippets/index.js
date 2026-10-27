/**
 * Host half of the dsh-2sidebar bundle.
 *
 * The panel itself is drawn by `./client.js` in the browser, so this half is
 * empty. It still has to exist: a DSH bundle is a Cordis plugin row
 * (`cordis.patch.yml`) whose `name` resolves to this package, and the row is
 * what mounts the bundle at all. See host-route.js if the plugin later needs a
 * host endpoint the Remote namespaces do not cover.
 */
export function apply() {}
