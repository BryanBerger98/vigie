/**
 * Registration lifecycle of the capture listeners, kept apart from what those listeners do.
 *
 * The question this exists for: when the user grants a host permission at runtime, does an
 * already-registered `webRequest` listener start receiving events for that host, or does it
 * have to be registered again? The documentation does not say. Getting it wrong is the quietest
 * defect this product can have — a domain designated, nothing captured, and no sign of it until
 * the export comes back empty.
 *
 * So the listeners are re-applied on every permission change whatever the answer turns out to
 * be. It costs one function call and it survives a later change in Chrome's behaviour.
 *
 * Every function takes the event object it acts on as an argument. That is what lets the
 * idempotence be unit-tested without a browser: MV3 event objects have no faithful mock.
 */

/** Any listener shape an extension event can carry. */
type AnyListener = (...args: never[]) => unknown;

/** The slice of `chrome.events.Event` this module needs, plus the options its `addListener` takes. */
export interface ListenableEvent<
  TListener extends AnyListener,
  TOptions extends unknown[] = [],
> {
  addListener(listener: TListener, ...options: TOptions): void;
  removeListener(listener: TListener): void;
  hasListener(listener: TListener): boolean;
}

/**
 * Registers `listener` on `event`, removing it first if it is already there.
 *
 * The service worker restarts on every wake-up and re-runs its callers, so a plain `addListener`
 * on a surviving registration would stack duplicates and multiply every captured entry.
 */
export function registerOnce<TListener extends AnyListener, TOptions extends unknown[]>(
  event: ListenableEvent<TListener, TOptions>,
  listener: TListener,
  ...options: TOptions
): void {
  if (event.hasListener(listener)) event.removeListener(listener);
  event.addListener(listener, ...options);
}

/** Removes `listener` from `event` if present. Safe to call on a listener never registered. */
export function unregister<TListener extends AnyListener>(
  event: ListenableEvent<TListener, never[]>,
  listener: TListener,
): void {
  if (event.hasListener(listener)) event.removeListener(listener);
}

/** What a set of capture listeners exposes so the lifecycle can re-apply it. */
export interface CaptureBinding {
  /** Re-applies the whole registration. Idempotent by construction. */
  apply(): void;
  /** Tears it down. */
  remove(): void;
}

/** The two permission events the binding follows. */
export interface PermissionChangeEvents {
  onAdded: ListenableEvent<(permissions: never) => unknown>;
  onRemoved: ListenableEvent<(permissions: never) => unknown>;
}

/** Which way the granted host permissions moved. */
export type PermissionChange = 'added' | 'removed';

/**
 * Re-applies `binding` whenever the granted host permissions change.
 *
 * Both directions matter. A grant may or may not need the re-registration — that is the open
 * question. A revocation does not need it to stop delivering events, but re-applying keeps one
 * code path instead of two that can drift apart.
 */
export function followHostPermissions(
  permissions: PermissionChangeEvents,
  binding: CaptureBinding,
  onChange?: (change: PermissionChange, permissions: unknown) => void,
): void {
  const reapply = (change: PermissionChange) => (granted: never) => {
    onChange?.(change, granted);
    binding.apply();
  };

  registerOnce(permissions.onAdded, reapply('added'));
  registerOnce(permissions.onRemoved, reapply('removed'));
}

/**
 * Phase 2 scaffolding — the observable trace of the measurement, so the verdict rests on a
 * reading rather than on an inference. Written by the service worker, read by the popup and by
 * the end-to-end suite. Phase 4 replaces it with the real capture store.
 */
export const MEASUREMENT_STATE_KEY = 'vigie:measurement';

/** One permission change as the probes recorded it. */
export interface MeasuredPermissionChange {
  change: PermissionChange;
  origins: string[];
  at: number;
}

/** What the probes record. Lives in `chrome.storage.session`, so it survives a worker restart. */
export interface MeasurementState {
  /**
   * How many times the service worker evaluated this module. The scenario that lets the worker
   * be terminated is only credible if this went up, so the count is the proof, not the wait.
   */
  workerStarts: number;
  workerStartedAt: number;
  /** Every request Chrome dispatched to the extension, whatever the watched list says. */
  networkEvents: number;
  /**
   * The subset that also falls inside the watched domains. The two counters are kept apart on
   * purpose: `networkEvents` says what the browser let through, `watchedEvents` says what the
   * scope accepted, and phase 3 is precisely about the second barrier being the one that decides.
   */
  watchedEvents: number;
  lastEvent: { url: string; at: number } | null;
  permissionChanges: MeasuredPermissionChange[];
}

export const EMPTY_MEASUREMENT_STATE: MeasurementState = {
  workerStarts: 0,
  workerStartedAt: 0,
  networkEvents: 0,
  watchedEvents: 0,
  lastEvent: null,
  permissionChanges: [],
};
