import { CONSENT_TEXT_VERSION } from './text';

/**
 * Whether the user has agreed to the disclosure, and to which wording.
 *
 * Stored in `chrome.storage.local` for the same reason the watched list is (`watched-domains.ts:8`):
 * this is settings, not captured data, and the service worker has to be able to read it on a cold
 * start before opening a database. It is also what the write path is locked on, so a read that
 * needed IndexedDB would put the lock behind the very thing it guards.
 *
 * ## Three states, not a boolean
 *
 * `missing` is a first launch. `given` is the agreement in force. `stale` is an agreement to words
 * that are no longer the ones shipped — the user did consent, but to a smaller capture than the
 * build now performs. Collapsing it into `missing` would lose the only thing worth telling them:
 * that what Vigie records has changed. Collapsing it into `given` would be the policy breach.
 *
 * Only `given` unlocks the capture. Everything else fails closed.
 */

export const CONSENT_KEY = 'vigie:consent';

/** What acceptance leaves behind. The version is the point; the timestamp is for the reader. */
export interface ConsentRecord {
  /** The `CONSENT_TEXT_VERSION` in force when the user accepted. */
  acceptedVersion: number;
  acceptedAt: number;
}

export type ConsentState =
  | { status: 'missing'; record: null }
  | { status: 'stale'; record: ConsentRecord }
  | { status: 'given'; record: ConsentRecord };

const MISSING: ConsentState = { status: 'missing', record: null };

function isRecord(value: unknown): value is ConsentRecord {
  if (!value || typeof value !== 'object') return false;
  const { acceptedVersion, acceptedAt } = value as Partial<ConsentRecord>;
  return typeof acceptedVersion === 'number' && typeof acceptedAt === 'number';
}

/**
 * The agreement currently on record. Anything unreadable reads as no agreement at all: a corrupt
 * value is not evidence that somebody consented.
 *
 * A stored version *above* the shipped one is honoured rather than refused. It means a downgrade,
 * and whoever accepted the newer wording accepted at least everything this build captures — asking
 * again would be asking for less than they already gave.
 */
export async function readConsent(): Promise<ConsentState> {
  const stored = await browser.storage.local.get(CONSENT_KEY);
  const value = stored[CONSENT_KEY];
  if (!isRecord(value)) return MISSING;
  return value.acceptedVersion >= CONSENT_TEXT_VERSION
    ? { status: 'given', record: value }
    : { status: 'stale', record: value };
}

/** Whether the capture may run. The one predicate the write path and every surface agree on. */
export function isCapturePermitted(state: ConsentState): boolean {
  return state.status === 'given';
}

/** Records the agreement to the wording currently shipped. */
export async function acceptConsent(now = Date.now()): Promise<ConsentRecord> {
  const record: ConsentRecord = { acceptedVersion: CONSENT_TEXT_VERSION, acceptedAt: now };
  await browser.storage.local.set({ [CONSENT_KEY]: record });
  return record;
}

/**
 * Calls `listener` whenever the agreement changes, including from another surface, and returns the
 * unsubscribe function.
 *
 * This is what carries an acceptance from the consent tab to the service worker that holds the
 * lock. `storage.onChanged` also wakes a terminated worker, so the capture starts without the user
 * having to do anything else.
 */
export function onConsentChanged(listener: (state: ConsentState) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
    if (!(CONSENT_KEY in changes)) return;
    void readConsent().then(listener);
  };

  browser.storage.local.onChanged.addListener(onChanged);
  return () => browser.storage.local.onChanged.removeListener(onChanged);
}

/** Opens the disclosure in a tab of its own. The one exit every gated surface offers. */
export function openConsentScreen(): Promise<unknown> {
  return browser.tabs.create({ url: browser.runtime.getURL('/consent.html') });
}
