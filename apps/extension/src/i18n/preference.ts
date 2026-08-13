import { isKnownLocale } from './registry';
import { AUTOMATIC, type LanguagePreference } from './resolve';

/**
 * The language the user picked, if they picked one.
 *
 * `chrome.storage.local`, deliberately not `sync`. The setting belongs to an installation, not to a
 * person (`prd.md:88`): someone reading English on a work machine and French at home would have
 * the two overwrite each other for a benefit neither of them asked for. It is the same reasoning,
 * and the same shape, as `popup/last-depth.ts`.
 *
 * Absent reads as `'auto'`, so the first launch asks nothing and writes nothing. Anything stored
 * that this build cannot honour — a hand-edited profile, a language dropped between two versions —
 * reads as `'auto'` too, which is the one value that is always renderable.
 */

export const LANGUAGE_PREFERENCE_KEY = 'vigie:language';

/**
 * Writes are serialised behind one chain, as in `storage/watched-domains.ts`. Two surfaces can be
 * open at once and the settings screen can outrun a round trip.
 */
let writes: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = writes.then(work, work);
  writes = next.catch(() => undefined);
  return next;
}

/** A stored value read back as something the interface can honour. */
export function normalizePreference(value: unknown): LanguagePreference {
  if (value === AUTOMATIC) return AUTOMATIC;
  return isKnownLocale(value) ? value : AUTOMATIC;
}

/** The stored preference, or `'auto'` when nothing usable is on record. */
export async function readLanguagePreference(): Promise<LanguagePreference> {
  const stored = await browser.storage.local.get(LANGUAGE_PREFERENCE_KEY);
  return normalizePreference(stored[LANGUAGE_PREFERENCE_KEY]);
}

/** Records the language the user just chose. `'auto'` is stored, not erased: it is an answer. */
export function writeLanguagePreference(value: LanguagePreference): Promise<void> {
  return serialise(async () => {
    await browser.storage.local.set({ [LANGUAGE_PREFERENCE_KEY]: value });
  });
}

/**
 * Calls `listener` whenever the preference changes, including from another surface. Returns the
 * unsubscribe function.
 *
 * This is what makes the popup follow a choice made in the settings while both are open, with no
 * message passing and no reload.
 */
export function onLanguagePreferenceChanged(
  listener: (preference: LanguagePreference) => void,
): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
    const change = changes[LANGUAGE_PREFERENCE_KEY];
    if (!change) return;
    listener(normalizePreference(change.newValue));
  };

  browser.storage.local.onChanged.addListener(onChanged);
  return () => browser.storage.local.onChanged.removeListener(onChanged);
}
