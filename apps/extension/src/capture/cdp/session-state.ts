/**
 * What the deep layer knows about itself, written where it survives the worker.
 *
 * `chrome.debugger.onDetach` never fires for a service worker death — zero emissions across six
 * provoked deaths, including the extension's own `detach()` — so the layer is never told it was
 * detached. It can only find out by reading, at the next start, what it wrote before. That makes
 * this file the single source of truth rather than a cache of one.
 *
 * `chrome.storage.session` is the medium and it is enough: it survived every death that has a
 * revival and handed the in-flight map back intact, for 449 bytes on one attached tab and six
 * in-flight requests. A medium surviving a browser restart would have no purpose — a restart
 * closes every tab and leaves no in-flight request to re-attribute.
 *
 * The rules live in pure functions and the storage round trip is a thin wrapper around them, so
 * every transition is asserted without a browser.
 *
 * @see aidd_docs/backlog/spikes/cdp-service-worker-recovery.md
 */

export const CDP_SESSION_STATE_KEY = 'vigie:cdp-session';

export interface CdpSessionState {
  /** Whether the user armed the layer. Not "is something attached": that is `attachedTabs`. */
  armed: boolean;
  /** The tabs holding a session right now. A boot path re-attaches exactly these. */
  attachedTabs: number[];
  /**
   * `requestId → url` for every request CDP announced and has not concluded.
   *
   * It is the part that grows — the tab list weighs almost nothing — and it exists so a request
   * that started before a worker death can still be named after it. Nothing fills it yet: the
   * layer that owns a request, and therefore what goes in and out of this map, is phase 4.
   */
  inFlight: Record<string, string>;
  /**
   * Set when Chrome's banner Cancel took every session down at once.
   *
   * Distinct from a voluntary stop on purpose. Chrome keeps no memory of the refusal, so an
   * extension that re-attaches brings the banner back within the second — which reads as the
   * product overriding the user. Written here rather than held in memory because the generation
   * that comes back from a crash has no memory: the mark is what blocked two consecutive
   * re-attach attempts in that generation.
   */
  canceledByUser: boolean;
}

export const EMPTY_CDP_SESSION_STATE: CdpSessionState = {
  armed: false,
  attachedTabs: [],
  inFlight: {},
  canceledByUser: false,
};

/**
 * Reads a stored value back into a state, whatever it turns out to be.
 *
 * Tolerant field by field rather than all-or-nothing: an older build's shape must not cost the
 * cancellation mark, which is the one field whose loss makes the extension do something the user
 * refused.
 */
export function parseSessionState(stored: unknown): CdpSessionState {
  if (typeof stored !== 'object' || stored === null) return EMPTY_CDP_SESSION_STATE;
  const value = stored as Partial<Record<keyof CdpSessionState, unknown>>;

  return {
    armed: value.armed === true,
    attachedTabs: Array.isArray(value.attachedTabs)
      ? [...new Set(value.attachedTabs.filter((tabId): tabId is number => Number.isInteger(tabId)))]
      : [],
    inFlight: parseInFlight(value.inFlight),
    canceledByUser: value.canceledByUser === true,
  };
}

function parseInFlight(stored: unknown): Record<string, string> {
  if (typeof stored !== 'object' || stored === null) return {};
  return Object.fromEntries(
    Object.entries(stored as Record<string, unknown>).filter(
      (pair): pair is [string, string] => typeof pair[1] === 'string',
    ),
  );
}

/**
 * The user armed the layer.
 *
 * This clears the cancellation mark, and only this does. Refusing the banner stops the capture;
 * arming it again is a new decision, taken by the same person, in the popup. What the mark forbids
 * is the extension re-attaching on its own — never the user asking for it a second time.
 */
export function arm(state: CdpSessionState): CdpSessionState {
  return { ...state, armed: true, canceledByUser: false };
}

/** The user stopped the layer. Nothing is remembered: a stop is not a refusal. */
export function stop(): CdpSessionState {
  return EMPTY_CDP_SESSION_STATE;
}

/**
 * Chrome's banner Cancel took everything down.
 *
 * Every session of the extension is gone at that instant — measured 2 ms apart across tabs — so
 * the tab list is emptied here rather than tab by tab from `onDetach`.
 */
export function cancel(): CdpSessionState {
  return { ...EMPTY_CDP_SESSION_STATE, canceledByUser: true };
}

/**
 * Whether the layer is allowed to attach a tab without being asked again.
 *
 * Consulted before every attach the user did not personally trigger: a tab entering the watched
 * perimeter, and the re-attach a boot path performs. It is the guard the spike measured, not a
 * derived reading of `armed` — a cancellation must hold even if some other transition leaves the
 * armed flag standing.
 */
export function mayAttach(state: CdpSessionState): boolean {
  return state.armed && !state.canceledByUser;
}

export function withTabAttached(state: CdpSessionState, tabId: number): CdpSessionState {
  if (state.attachedTabs.includes(tabId)) return state;
  return { ...state, attachedTabs: [...state.attachedTabs, tabId] };
}

/**
 * One tab's session is gone — it left the perimeter, or it was closed and raised `target_closed`.
 *
 * The in-flight map is left alone: it is keyed by request, not by tab, and nothing here can say
 * which requests belonged to the tab that left. Phase 4 owns that attribution, and until then the
 * map is emptied only by a stop or a cancellation.
 */
export function withTabDetached(state: CdpSessionState, tabId: number): CdpSessionState {
  return { ...state, attachedTabs: state.attachedTabs.filter((entry) => entry !== tabId) };
}

export function withRequestAnnounced(
  state: CdpSessionState,
  requestId: string,
  url: string,
): CdpSessionState {
  return { ...state, inFlight: { ...state.inFlight, [requestId]: url } };
}

export function withRequestConcluded(state: CdpSessionState, requestId: string): CdpSessionState {
  if (!(requestId in state.inFlight)) return state;
  const { [requestId]: _concluded, ...rest } = state.inFlight;
  return { ...state, inFlight: rest };
}

/** The slice of `chrome.storage.session` this module uses. Injected, so the tests hold their own. */
export interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function defaultArea(): SessionArea {
  return browser.storage.session as unknown as SessionArea;
}

/**
 * Writes are serialised behind one chain, for the same reason as everywhere else in this codebase:
 * attaching six tabs fires six read-modify-write round trips that would each write their own idea
 * of the tab list, and five of the six attachments would vanish from a state whose whole job is to
 * be re-read after a death.
 */
let writes: Promise<unknown> = Promise.resolve();

export async function readCdpSessionState(
  area: SessionArea = defaultArea(),
): Promise<CdpSessionState> {
  const stored = await area.get(CDP_SESSION_STATE_KEY);
  return parseSessionState(stored[CDP_SESSION_STATE_KEY]);
}

/**
 * Calls `listener` whenever the stored state changes, including from another surface. Returns the
 * unsubscribe function.
 *
 * The popup is the surface that needs it: a cancellation is decided in Chrome's banner, on a page,
 * with the popup nowhere in the picture — and a popup left open would otherwise keep offering to
 * stop a layer the user has already stopped.
 */
export function onCdpSessionStateChanged(listener: (state: CdpSessionState) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
    if (!(CDP_SESSION_STATE_KEY in changes)) return;
    listener(parseSessionState(changes[CDP_SESSION_STATE_KEY]?.newValue));
  };

  browser.storage.session.onChanged.addListener(onChanged);
  return () => browser.storage.session.onChanged.removeListener(onChanged);
}

/** Applies `change` to the stored state and hands back what was written. */
export function updateCdpSessionState(
  change: (state: CdpSessionState) => CdpSessionState,
  area: SessionArea = defaultArea(),
): Promise<CdpSessionState> {
  const next = writes.then(run, run);
  writes = next.catch(() => undefined);
  return next;

  async function run(): Promise<CdpSessionState> {
    const written = change(await readCdpSessionState(area));
    await area.set({ [CDP_SESSION_STATE_KEY]: written });
    return written;
  }
}

/**
 * The one death the user has to be told about, kept under its own key.
 *
 * It cannot be a field of `CdpSessionState`: `stop()` and `cancel()` both answer a whole new state,
 * so the mark would be erased by the next ordinary transition — and it has to outlive them, since
 * what it records happened before either could run.
 *
 * A worker stop or a crash does not set it. Both have a resume, and a capture that came back has
 * nothing to announce; the numbers say the same thing — 0 entries lost on a stop, 6 on a crash,
 * against everything on an update.
 */
export const CAPTURE_INTERRUPTED_KEY = 'vigie:capture-interrupted';

/** The capture was cut and will not come back on its own. Written once, by the start that found out. */
export async function markCaptureInterrupted(area: SessionArea = defaultArea()): Promise<void> {
  await area.set({ [CAPTURE_INTERRUPTED_KEY]: true });
}

/**
 * Reads the mark and clears it in the same move, so the notice is shown once and not on every
 * opening of the popup. Whichever surface asks first is the one that shows it.
 *
 * Cleared by writing `false` rather than by removing the key: `SessionArea` is the two calls the
 * module actually needs, and a third one for a value the reader already treats as absent would buy
 * nothing.
 */
export async function takeCaptureInterrupted(area: SessionArea = defaultArea()): Promise<boolean> {
  const stored = await area.get(CAPTURE_INTERRUPTED_KEY);
  if (stored[CAPTURE_INTERRUPTED_KEY] !== true) return false;

  await area.set({ [CAPTURE_INTERRUPTED_KEY]: false });
  return true;
}
