/**
 * Node-side Loader placeholder for the browser-only fold-turns plugin.
 *
 * The Web client is discovered through `dsh.client` and loaded from
 * `dsh-fold-turns/client`; this entry exists so the bundle can occupy a
 * normal Cordis Loader row.
 */
export const name = 'dsh-fold-turns'

/** Browser behavior is registered by the client bundle. */
export function apply(): void {}
