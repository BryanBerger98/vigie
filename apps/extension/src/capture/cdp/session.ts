/**
 * The deep layer's life: armed by the user, following the watched perimeter, stopped by either.
 *
 * The unit is the perimeter, never a tab. The user arms a capture depth, and every tab standing on
 * a watched domain gets a session — the ones already open at that moment and the ones that arrive
 * later. That is one rule, applied by reconciling what is attached against what should be, which is
 * also the only shape that survives a service worker death: the answer is recomputed from the tabs
 * and the watched list, never accumulated from the events that were missed.
 *
 * Two windows are known and left open on purpose. A tab opened mid-session is attached about 82 ms
 * after its first requests start — the tab is born after the decision to attach, and no policy
 * closes that; it costs response bodies, never entries, since `webRequest` owns the entry. And a tab
 * leaving the perimeter keeps its session for about 60 ms; what bounds the capture is the URL filter
 * already in place, not the attachment.
 *
 * @see aidd_docs/backlog/spikes/cdp-attachment-scope.md
 */

import { registerOnce } from '@/capture/network/listener-lifecycle';
import { drainDeferredWrites } from '@/capture/network/listeners';
import { isWatchedUrl } from '@/storage/scope';
import { readWatchedDomains } from '@/storage/watched-domains';

import { attachTab, detachTab } from './attach';
import { clearCdpRecords, followCdpNetworkEvents, releaseCdpTab } from './events';
import { sessionWindows } from './ownership';
import { hasDebuggerAccess } from './permission';
import {
  arm,
  cancel,
  mayAttach,
  readCdpSessionState,
  stop,
  updateCdpSessionState,
  withTabAttached,
  withTabDetached,
  type CdpSessionState,
} from './session-state';

/** What the popup sends the worker. The layer is armed and stopped from there and nowhere else. */
export const START_DEEP_LAYER_MESSAGE = 'vigie:deep-layer-start';
export const STOP_DEEP_LAYER_MESSAGE = 'vigie:deep-layer-stop';

/**
 * Reconciliations are serialised behind one chain, for the reason every write path here is.
 *
 * A navigation moves several tabs at once and each move triggers one, so two overlapping passes
 * would read the same attachment list and both decide to attach the same tab — the second call
 * failing on a session that already exists, and the state recording a tab twice.
 */
let passes: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = passes.then(work, work);
  passes = next.catch(() => undefined);
  return next;
}

/**
 * The tabs standing on a watched domain right now.
 *
 * A tab whose URL the extension cannot read is out of scope by construction: Chrome only hands
 * `tab.url` over for a tab the granted host permissions cover, so the browser's own barrier and the
 * watched list agree here without either being trusted on its own.
 */
async function tabsInScope(): Promise<number[]> {
  const [tabs, domains] = await Promise.all([browser.tabs.query({}), readWatchedDomains()]);
  if (domains.length === 0) return [];

  const inScope: number[] = [];
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url) continue;
    if (isWatchedUrl(tab.url, domains)) inScope.push(tab.id);
  }
  return inScope;
}

/**
 * Brings the attached sessions in line with the perimeter, whatever the two currently are.
 *
 * Called at the start, at every scope change and at every tab that moves. It is deliberately not a
 * diff of an event: an event says what changed, and the layer needs what *is* — a worker that came
 * back from its own death has an attachment list written before it died and no idea what happened
 * since.
 *
 * A tab that refuses is not retried here. Its next navigation triggers another pass, and a tab
 * DevTools holds would otherwise be asked in a loop for a session Chrome will not give twice.
 */
export function reconcileDeepLayer(): Promise<void> {
  return serialise(async () => {
    const state = await readCdpSessionState();

    // The permission can be taken back from Chrome's own settings, and it takes the whole API with
    // it: measured on the shipped build, `browser.debugger` is `undefined` while the permission is
    // not granted, so no session can be standing and there is none to close either.
    if (!(await hasDebuggerAccess())) {
      await standDown();
      if (state.attachedTabs.length > 0) {
        await updateCdpSessionState((current) => ({ ...current, attachedTabs: [] }));
      }
      return;
    }

    if (!mayAttach(state)) {
      await Promise.all(state.attachedTabs.map(detachTab));
      await standDown();
      if (state.attachedTabs.length > 0) {
        await updateCdpSessionState((current) => ({ ...current, attachedTabs: [] }));
      }
      return;
    }

    const wanted = await tabsInScope();
    const leaving = state.attachedTabs.filter((tabId) => !wanted.includes(tabId));
    const joining = wanted.filter((tabId) => !state.attachedTabs.includes(tabId));

    await Promise.all(leaving.map(detachTab));
    const attached = await Promise.all(
      joining.map(async (tabId) => ({ tabId, outcome: await attachTab(tabId) })),
    );

    for (const { tabId, outcome } of attached) {
      if (outcome.ok) continue;
      // Said out loud rather than swallowed: a refused `Network.enable` is a tab that would carry
      // Chrome's banner for a capture that never starts, and the user has no other way to learn it.
      console.warn('[vigie] deep layer refused on tab %d (%s): %s', tabId, outcome.stage, outcome.reason);
    }

    const opened = attached.filter(({ outcome }) => outcome.ok).map(({ tabId }) => tabId);
    await updateCdpSessionState((current) => {
      let next = current;
      for (const tabId of leaving) next = withTabDetached(next, tabId);
      for (const tabId of opened) next = withTabAttached(next, tabId);
      return next;
    });

    // The capture side of the same reconciliation. A session window is what tells the `webRequest`
    // listeners to stand down on a tab, and it is opened here — after `Network.enable` came back —
    // rather than at the decision to attach: a request that started in between belongs to the layer
    // that actually saw it. A tab that refused is absent from `opened` and keeps no window.
    const live = [...state.attachedTabs.filter((tabId) => !leaving.includes(tabId)), ...opened];
    drainDeferredWrites();
    sessionWindows.reconcile(live, Date.now());
    await Promise.all(leaving.map(releaseCdpTab));
    if (live.length > 0) followCdpNetworkEvents();
    else await standDown();
  });
}

/**
 * Takes the capture side down: every window closed, every record handed back, the protocol
 * unsubscribed. Called wherever the layer stops holding sessions, whatever brought that about.
 *
 * The hold goes first, and every window move in this module does the same. `drainDeferredWrites`
 * carries why; the short version is that a held entry answers the ownership question at the instant
 * it resolves, so a window that closes over one turns a request the deep layer already wrote into a
 * second entry.
 */
async function standDown(): Promise<void> {
  drainDeferredWrites();
  sessionWindows.reconcile([], Date.now());
  await clearCdpRecords();
}

/**
 * The user armed the layer. The permission is already granted at this point — it is asked for in
 * the popup, inside the click, because a user gesture does not survive a message round trip.
 */
export async function startDeepLayer(): Promise<CdpSessionState> {
  await updateCdpSessionState(arm);
  await reconcileDeepLayer();
  return readCdpSessionState();
}

/** The user stopped it. Every session goes, including any the perimeter has since left. */
export async function stopDeepLayer(): Promise<CdpSessionState> {
  const { attachedTabs } = await readCdpSessionState();
  await Promise.all(attachedTabs.map(detachTab));
  await standDown();
  return updateCdpSessionState(stop);
}

/**
 * Chrome told us a session ended. The two reasons mean opposite things.
 *
 * `target_closed` is local: the tab was closed and took its own session with it, the others are
 * untouched. `canceled_by_user` is the banner's Cancel, which drops every session of the extension
 * at once — measured 2 ms apart across tabs — and is a refusal, not an accident. It is written down
 * because Chrome keeps no memory of it: an extension that re-attaches brings the banner back within
 * the second, over the click that asked for it to go.
 *
 * Neither reason ever arrives for a service worker death, which is why nothing here is the layer's
 * source of truth.
 *
 * Both branches close the capture side before touching the state: the window is what suppresses the
 * `webRequest` entry, and a session that is gone must stop suppressing anything within the same turn.
 */
export async function handleDeepLayerDetach(
  tabId: number | undefined,
  reason: string,
): Promise<unknown> {
  if (reason === 'canceled_by_user') {
    await standDown();
    return updateCdpSessionState(cancel);
  }
  if (tabId === undefined) return Promise.resolve();
  await closeTabSession(tabId);
  return updateCdpSessionState((state) => withTabDetached(state, tabId));
}

/**
 * One tab's session is over. Its window closes, so the requests it started come back to
 * `webRequest`, and the records it held go unwritten — `webRequest` still holds those requests and
 * closes them itself.
 */
async function closeTabSession(tabId: number): Promise<void> {
  drainDeferredWrites();
  sessionWindows.close(tabId, Date.now());
  await releaseCdpTab(tabId);
}

/**
 * Subscribes the layer to the tabs. Returns nothing to unsubscribe with: the worker registers this
 * once at the top level, and MV3 tears the registration down by killing the worker.
 *
 * `onUpdated` is filtered on `changeInfo.url` — it also fires for a title, a favicon and a loading
 * status, none of which can move a tab in or out of scope. A tab created with a URL raises it too,
 * so there is no separate `onCreated` subscription to keep in step with this one.
 *
 * The other half of the perimeter — the watched list moving — is not subscribed here. The worker
 * already owns one `onWatchedDomainsChanged` handler where every capture layer is re-applied, and a
 * second subscription to the same signal would be one more place for the layers to fall out of step.
 */
export function followDeepLayerScope(): void {
  registerOnce(browser.tabs.onUpdated, onTabUpdated);
  registerOnce(browser.tabs.onRemoved, onTabRemoved);
}

/** Module scope so `registerOnce` has the same function to recognise at every re-application. */
function onTabUpdated(_tabId: number, changeInfo: { url?: string }): void {
  if (changeInfo.url === undefined) return;
  void reconcileDeepLayer();
}

/**
 * A closed tab took its session with it. Chrome does raise `target_closed` for this, but only while
 * the worker is alive to hear it — and this listener is what wakes the worker in the first place.
 */
function onTabRemoved(tabId: number): void {
  void closeTabSession(tabId);
  void updateCdpSessionState((state) => withTabDetached(state, tabId));
}
