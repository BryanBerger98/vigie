import { SCHEMA_VERSION, isExportRequest, type ExportRequest, type ExportResult } from '@vigie/contract';

import {
  EMPTY_MEASUREMENT_STATE,
  MEASUREMENT_STATE_KEY,
  followHostPermissions,
  registerOnce,
  unregister,
  type CaptureBinding,
  type MeasurementState,
} from '@/capture/network/listener-lifecycle';
import { resumeDeepLayer } from '@/capture/cdp/resume';
import {
  START_DEEP_LAYER_MESSAGE,
  STOP_DEEP_LAYER_MESSAGE,
  followDeepLayerScope,
  handleDeepLayerDetach,
  reconcileDeepLayer,
  startDeepLayer,
  stopDeepLayer,
} from '@/capture/cdp/session';
import { markCaptureInterrupted } from '@/capture/cdp/session-state';
import { isRelayMessage } from '@/capture/console/bridge';
import { applyConsoleCaptureScope } from '@/capture/console/registration';
import { storeRelayedCapture } from '@/capture/console/store';
import { eraseCapturedDataFor } from '@/capture/erase-domain-data';
import { flushNetworkCapture, networkCapture } from '@/capture/network/listeners';
import {
  isCapturePermitted,
  onConsentChanged,
  openConsentScreen,
  readConsent,
  type ConsentState,
} from '@/consent/state';
import { assembleBundle } from '@/export/bundle';
import { renderReport } from '@/export/markdown';
import { PURGE_MESSAGE, purgeCapturedData } from '@/storage/purge';
import { isWatchedUrl, watchedDomainFor } from '@/storage/scope';
import { onWatchedDomainsChanged, readWatchedDomains } from '@/storage/watched-domains';
import { FLUSH_MESSAGE, setCaptureConsent, setCaptureScope } from '@/storage/write';

/**
 * Service worker. Orchestration only: it owns the scope and hands every capture layer its turn.
 *
 * MV3 terminates it after roughly 30 seconds idle and drops every global, so nothing durable
 * may live in this module scope. Listener registration has to stay top-level: it is what makes
 * the browser wake the worker back up.
 *
 * Two things run side by side here. The capture — `webRequest` into the store, and the page
 * events the content script relays — and the phase 2 measurement probe, which counts events and
 * permission changes into `storage.session`. The probe is not capture; it is what the popup reads
 * today and what the end-to-end suite asserts on, and phase 11 retires it with the popup.
 *
 * The worker also owns the two locks the capture hangs on, and for the same reason in both cases:
 * the write path reads them synchronously and cannot await storage. The watched domains are one,
 * the user's agreement to the disclosure is the other. Both start closed at every worker start and
 * are pushed in as soon as they have been read.
 *
 * The phase 6 storage figures are not a third counter: they are read straight off the store by
 * whoever asks (`storage/metrics.ts`). The worker's only part in them is `FLUSH_MESSAGE`, which
 * hands over what is still queued so a reading is taken on the whole capture and not on the
 * capture minus one batch.
 */

// Web traffic only: an extension always sees requests for its own `chrome-extension://` resources,
// with or without host access, and counting those would drown the signal being measured.
const WEB_TRAFFIC = { urls: ['http://*/*', 'https://*/*'] };

/**
 * Storage writes are serialised behind one chain. `webRequest` events arrive faster than a
 * read-modify-write round trip completes, and two concurrent reads of the same counter would
 * both write the same value — undercounting exactly the thing being measured.
 */
let writes: Promise<void> = Promise.resolve();

function record(change: (state: MeasurementState) => MeasurementState): void {
  writes = writes
    .then(async () => {
      const stored = await browser.storage.session.get(MEASUREMENT_STATE_KEY);
      const current = (stored[MEASUREMENT_STATE_KEY] as MeasurementState | undefined) ?? EMPTY_MEASUREMENT_STATE;
      await browser.storage.session.set({ [MEASUREMENT_STATE_KEY]: change(current) });
    })
    .catch((error: unknown) => {
      console.error('[vigie] could not record the measurement state', error);
    });
}

/**
 * The watched domains, held in module scope because `webRequest.onCompleted` is synchronous and
 * cannot await a storage read. MV3 wipes this on every worker stop, so it is reloaded at each
 * start and kept current by the subscription below.
 *
 * The window between a worker start and that first read landing is real: requests arriving in it
 * are counted as delivered but not as watched. It costs nothing here — this is a counter — and
 * phase 4 has to answer it properly, since the same window would silently drop captured data.
 */
let watchedDomains: string[] = [];

function countCompletedRequest(details: { url: string }): void {
  const watched = isWatchedUrl(details.url, watchedDomains);
  record((state) => ({
    ...state,
    networkEvents: state.networkEvents + 1,
    watchedEvents: state.watchedEvents + (watched ? 1 : 0),
    lastEvent: { url: details.url, at: Date.now() },
  }));
}

/** The host, when the tab is on no watched domain — a report still has to name its subject. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Serves an export. The worker is the only place this can happen: it owns the write queue, so it
 * is the only one that can freeze an instant and then guarantee the disk has caught up to it.
 *
 * The watched list is read here rather than taken from module scope. A popup can be the very
 * thing that wakes a terminated worker, and `watchedDomains` is still empty for the few
 * milliseconds that first read takes — long enough for a report to come out named after nothing.
 */
async function serveExport(request: ExportRequest): Promise<ExportResult> {
  const [tab, domains] = await Promise.all([
    browser.tabs.get(request.tabId),
    readWatchedDomains(),
  ]);
  const url = tab.url ?? '';

  const bundle = await assembleBundle({
    tabId: request.tabId,
    requestedDepthMinutes: request.depthMinutes,
    subject: {
      // The stamp the entries carry, so the header names the scope the body was written under.
      domain: watchedDomainFor(url, domains) ?? hostOf(url),
      url,
      title: tab.title,
    },
    extensionVersion: browser.runtime.getManifest().version,
    // Freeze first, then drain: `export/bundle.ts:21` explains why that order and not the other.
    settle: flushNetworkCapture,
  });

  return { bundle, markdown: renderReport(bundle) };
}

/**
 * The registration under measurement. `apply` is called at every worker start and again at every
 * permission change; `registerOnce` is what keeps that from stacking listeners.
 */
const networkProbe: CaptureBinding = {
  apply: () => {
    registerOnce(browser.webRequest.onCompleted, countCompletedRequest, WEB_TRAFFIC);
  },
  remove: () => {
    unregister(browser.webRequest.onCompleted, countCompletedRequest);
  },
};

/** Chrome ended a deep layer session. The reason says whether it ended one of them or all of them. */
function routeDeepLayerDetach(source: { tabId?: number }, reason: string): void {
  console.info('[vigie] deep layer detached from tab %s (%s)', source.tabId ?? '?', reason);
  void handleDeepLayerDetach(source.tabId, reason);
}

/**
 * `chrome.debugger.onDetach`, registered only where the API exists.
 *
 * Measured on the shipped build: while the optional permission is not granted, `browser.debugger` is
 * `undefined` in the worker — an absent namespace, not an API that refuses on use. A top-level
 * registration would therefore throw on every start for every user who never arms the layer. So it
 * is applied the way the capture listeners are, at each start and at each permission change, which
 * is also what registers it the moment the popup obtains the grant.
 */
const deepLayerDetach: CaptureBinding = {
  apply: () => {
    const api: typeof browser.debugger | undefined = browser.debugger;
    if (api) registerOnce(api.onDetach, routeDeepLayerDetach);
  },
  remove: () => {
    const api: typeof browser.debugger | undefined = browser.debugger;
    if (api) unregister(api.onDetach, routeDeepLayerDetach);
  },
};

export default defineBackground(() => {
  console.info('[vigie] service worker started, contract schema v%d', SCHEMA_VERSION);

  record((state) => ({
    ...state,
    workerStarts: state.workerStarts + 1,
    workerStartedAt: Date.now(),
  }));

  networkProbe.apply();
  networkCapture.apply();
  deepLayerDetach.apply();
  // The deep layer follows the tabs from here on, and puts back what this start found missing. The
  // order is the one that matters: subscribing first means a tab that moves while the resume is
  // still running triggers its own reconciliation instead of being missed.
  followDeepLayerScope();
  void resumeDeepLayer().then((decision) => {
    if (decision.resume) console.info('[vigie] deep layer resumed, %d session(s) lost', decision.lostTabs.length);
    else console.info('[vigie] deep layer not resumed (%s)', decision.reason);
  });

  // The consent lock. It is pushed to the write path rather than consulted there, because
  // `webRequest.onCompleted` is synchronous and a storage read is not (`storage/write.ts:80`).
  // Every worker start reopens the question: the lock defaults to refused and only a read that
  // came back with an agreement in force reopens it.
  const applyConsent = (state: ConsentState) => {
    const permitted = isCapturePermitted(state);
    setCaptureConsent(permitted);
    console.info('[vigie] capture %s (consent %s)', permitted ? 'allowed' : 'blocked', state.status);
  };

  void readConsent().then(applyConsent);
  onConsentChanged(applyConsent);

  // A first launch, or an update that ships a wording the stored agreement no longer covers. The
  // screen is raised rather than waited for: a user who never opens the popup would otherwise run
  // an extension that captures nothing and never says why (`design.md:23`).
  //
  // An update is also the one death the user has to be told about, and this listener is the only
  // place the browser says so. Everything else that kills the worker has a resume — a stop lost 0
  // entries and a crash 6, both came back on the next request — while an update takes the whole
  // capture with it and gives nothing back, so it gets a mark and a notice and they do not.
  //
  // Three things around it were never measured, and the code should not be read as if they had
  // been. A Web Store update has never been observed at all, only the reason string the API
  // documents. `chrome.runtime.reload()` never restarts the worker on a `--load-extension` build,
  // which is why the end-to-end suite poses the mark directly instead of provoking one. And an
  // update leaves no worker running, so nothing here re-attaches anything: the resume above is
  // guaranteed only at the next browser start, or at the next traffic that wakes a worker.
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') void markCaptureInterrupted();
    void readConsent().then((state) => {
      if (!isCapturePermitted(state)) void openConsentScreen();
    });
  });

  // Both halves of the scope, followed independently. The list decides what the extension writes
  // down; the permission decides what the browser hands it in the first place. A domain added
  // has to start capturing without a restart, so neither may be read once and cached for good.
  const applyScope = (domains: string[]) => {
    watchedDomains = domains;
    setCaptureScope(domains);
    // The console capture is a registration rather than a filter, so it has to be pushed to the
    // browser every time the list moves — including at a cold start, where nothing else would.
    void applyConsoleCaptureScope(domains);
    console.info('[vigie] watching %s', domains.join(', ') || '(nothing)');
  };

  void readWatchedDomains().then(applyScope);
  onWatchedDomainsChanged((domains) => {
    // The removal flow already erased what it dropped, from the page the user clicked in. This
    // erases it again, from the worker that owns the write queue, so an entry queued microseconds
    // before the removal cannot land behind it.
    const dropped = watchedDomains.filter((domain) => !domains.includes(domain));
    applyScope(domains);
    for (const domain of dropped) {
      void eraseCapturedDataFor(domain);
    }
    networkProbe.apply();
    networkCapture.apply();
    // The deep layer's perimeter is the same list: a domain added has to be attached without a
    // restart, and a domain removed detached without one either.
    void reconcileDeepLayer();
  });

  followHostPermissions(browser.permissions, networkProbe, (change, permissions) => {
    const origins = (permissions as { origins?: string[] }).origins ?? [];
    console.info('[vigie] host permissions %s: %s', change, origins.join(', ') || '(none)');
    record((state) => ({
      ...state,
      permissionChanges: [...state.permissionChanges, { change, origins, at: Date.now() }],
    }));
    networkCapture.apply();
    // The `debugger` grant arrives on this event too, and it is what makes the namespace appear.
    deepLayerDetach.apply();
  });

  // A tab closing is the last chance to write what its requests produced; anything still batched
  // would otherwise wait for traffic that will never come. The surfaces that read the store ask
  // for the same flush through `vigie:flush`, so a report never omits the last few requests.
  //
  // Registered after `followDeepLayerScope`, and that order matters: Chrome calls the listeners of
  // one event in registration order, so the deep layer closes the tab's session window first and
  // this flush then writes the held requests instead of leaving them to a session that is gone.
  browser.tabs.onRemoved.addListener(() => void flushNetworkCapture());
  // `sendResponse` and `return true`, not a returned promise: Chrome only supports the callback
  // form, and a promise here would answer `undefined` before the batch had been written.
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message === FLUSH_MESSAGE) {
      void flushNetworkCapture().then(() => sendResponse(true));
      return true;
    }

    // The deep layer, armed and stopped from the popup and nowhere else. The permission is granted
    // at install time and never asked for here: Chrome refuses `debugger` as an optional permission,
    // so it is declared required (`wxt.config.ts:55`) and the popup arms the session rather than the
    // grant. The state is answered so the caller can tell a start that did nothing from one that
    // attached something.
    if (message === START_DEEP_LAYER_MESSAGE || message === STOP_DEEP_LAYER_MESSAGE) {
      const starting = message === START_DEEP_LAYER_MESSAGE;
      if (starting) deepLayerDetach.apply();

      (starting ? startDeepLayer() : stopDeepLayer()).then(sendResponse, (error: unknown) => {
        console.error('[vigie] could not %s the deep layer', starting ? 'start' : 'stop', error);
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      });
      return true;
    }

    // The purge runs here and nowhere else: the batch queue is module state of this worker, and a
    // settings page clearing its own would leave the real one to land behind the erasure
    // (`storage/purge.ts:13`).
    if (message === PURGE_MESSAGE) {
      purgeCapturedData().then(
        (deleted) => sendResponse({ deleted }),
        (error: unknown) => {
          console.error('[vigie] could not purge the capture store', error);
          sendResponse({ error: error instanceof Error ? error.message : String(error) });
        },
      );
      return true;
    }

    // An export. Failures are answered, not thrown: a rejected promise on this channel reaches
    // the caller as a bare "message port closed", which tells the user nothing about what broke.
    if (isExportRequest(message)) {
      serveExport(message).then(sendResponse, (error: unknown) => {
        console.error('[vigie] could not serve the export', error);
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      });
      return true;
    }

    // A page event relayed by the content script. Answered synchronously — the content script
    // only awaits the acknowledgement to know the worker was awake, never the write itself.
    if (isRelayMessage(message)) {
      storeRelayedCapture(message.payload, sender);
      sendResponse(true);
      return false;
    }

    return false;
  });
});
