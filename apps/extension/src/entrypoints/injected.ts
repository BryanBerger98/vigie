import { bridgeMessage } from '@/capture/console/bridge';
import { patchConsole } from '@/capture/console/patch';

/**
 * The main world half of the console capture.
 *
 * It has to run here, in the page's own realm, because that is the only realm where `console` is
 * the object the page's code calls. A content script sees an isolated copy: patching it would
 * capture nothing but our own logs.
 *
 * The price is that this script shares everything with the page — same globals, same prototypes,
 * same `window`. So it imports only `bridge.ts` and `patch.ts`, which touch no `chrome.*` API and
 * no storage. Nothing that could reach the capture store is reachable from code the page controls.
 *
 * Unlisted rather than a WXT content script: the service worker registers this file itself, with
 * `world: 'MAIN'`, so Chrome runs it before the page's own first script. Appending it from the
 * isolated world instead — WXT's `injectScript` — was measured losing that race every time.
 * See `capture/console/registration.ts`.
 */
export default defineUnlistedScript(() => {
  patchConsole((payload) => {
    // `'/'` rather than the literal origin: it means "only this document", and unlike an origin
    // string it still works on a sandboxed or `about:blank` document, whose origin is opaque.
    window.postMessage(bridgeMessage(payload), '/');
  }, window);
});
