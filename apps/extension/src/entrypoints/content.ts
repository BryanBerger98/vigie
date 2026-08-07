import { readBridgeMessage, relayMessage } from '@/capture/console/bridge';

/**
 * The isolated world half of the console capture: it relays what the page-side patch hears to the
 * service worker, and does nothing else.
 *
 * The patch itself is `entrypoints/injected.ts`, registered separately in the main world — see
 * `capture/console/registration.ts` for why the pair is split that way and why neither half
 * injects the other.
 *
 * ## Why it is not in the manifest
 *
 * A manifest content script declares its `matches` at install time, and Chrome turns them into the
 * "read and change all your data" warning — the exact permission this product refuses to ask for
 * up front (`wxt.config.ts`). So it is registered at runtime instead, by the service worker,
 * against the watched domains only. `registration: 'runtime'` with no `matches` is what keeps WXT
 * from writing either a `content_scripts` entry or a `host_permissions` line into the manifest.
 *
 * ## Why `document_start`
 *
 * Logs emitted while the page is loading are the ones a bug report needs most, and anything later
 * misses them. Both halves run before the page's own first script.
 */
export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_start',
  allFrames: true,
  // WXT's compatibility `postMessage` announcement is noise on a bus we share with the page, and
  // nothing here listens for it.
  noScriptStartedPostMessage: true,

  main() {
    window.addEventListener('message', (event) => {
      // This script has its own instance in every frame it matches, so anything posted by another
      // window is that frame's business, not ours — and is unauthenticated on top of it.
      if (event.source !== window) return;

      const payload = readBridgeMessage(event.data);
      if (payload === null) return;

      browser.runtime.sendMessage(relayMessage(payload)).catch(() => {
        // The worker is restarting, or the extension was reloaded from under this page. Losing one
        // line beats an unhandled rejection surfacing in the user's own console.
      });
    });
  },
});
