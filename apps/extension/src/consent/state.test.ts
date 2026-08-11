import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  CONSENT_KEY,
  acceptConsent,
  isCapturePermitted,
  onConsentChanged,
  readConsent,
} from './state';
import { CONSENT_TEXT_VERSION } from './text';

/**
 * The lock the capture hangs on, asserted on the three states a user can actually be in: never
 * asked, agreed, and agreed to a wording the build no longer ships.
 *
 * The third is the one worth a test of its own. It is indistinguishable from the second on disk —
 * a record is present either way — and treating it as agreement is exactly the disclosure breach
 * the Chrome Web Store policy is about (`deployment.md:40`).
 */

const NOW = 1_800_000_000_000;

beforeEach(() => {
  fakeBrowser.reset();
});

describe('without an agreement', () => {
  it('reads as missing on a fresh profile, and permits nothing', async () => {
    const state = await readConsent();

    expect(state.status).toBe('missing');
    expect(isCapturePermitted(state)).toBe(false);
  });

  it('reads as missing rather than throwing when the stored value is not a record', async () => {
    await fakeBrowser.storage.local.set({ [CONSENT_KEY]: 'yes' });

    expect((await readConsent()).status).toBe('missing');
  });

  // A half-written record is not evidence that somebody read anything.
  it('reads as missing when the record carries no version', async () => {
    await fakeBrowser.storage.local.set({ [CONSENT_KEY]: { acceptedAt: NOW } });

    expect((await readConsent()).status).toBe('missing');
  });
});

describe('with an agreement', () => {
  it('records the wording that was accepted, not just the fact of accepting', async () => {
    const record = await acceptConsent(NOW);

    expect(record).toEqual({ acceptedVersion: CONSENT_TEXT_VERSION, acceptedAt: NOW });
    expect(await fakeBrowser.storage.local.get(CONSENT_KEY)).toEqual({ [CONSENT_KEY]: record });
  });

  it('permits the capture and hands the record back', async () => {
    await acceptConsent(NOW);

    const state = await readConsent();

    expect(state.status).toBe('given');
    expect(state.record?.acceptedAt).toBe(NOW);
    expect(isCapturePermitted(state)).toBe(true);
  });

  // A downgrade: whoever accepted a later wording accepted at least everything this build captures.
  it('honours an agreement to a wording newer than the one shipped', async () => {
    await fakeBrowser.storage.local.set({
      [CONSENT_KEY]: { acceptedVersion: CONSENT_TEXT_VERSION + 1, acceptedAt: NOW },
    });

    expect((await readConsent()).status).toBe('given');
  });
});

describe('with an agreement outdated by a new wording', () => {
  beforeEach(async () => {
    await fakeBrowser.storage.local.set({
      [CONSENT_KEY]: { acceptedVersion: CONSENT_TEXT_VERSION - 1, acceptedAt: NOW },
    });
  });

  it('permits nothing, because the disclosure no longer covers what is captured', async () => {
    const state = await readConsent();

    expect(state.status).toBe('stale');
    expect(isCapturePermitted(state)).toBe(false);
  });

  // Kept, so the surface can say the agreement is outdated rather than that none was ever given.
  it('keeps the outdated record instead of discarding it', async () => {
    expect((await readConsent()).record).toEqual({
      acceptedVersion: CONSENT_TEXT_VERSION - 1,
      acceptedAt: NOW,
    });
  });

  it('is resolved by accepting again', async () => {
    await acceptConsent(NOW + 1);

    expect((await readConsent()).status).toBe('given');
  });
});

describe('onConsentChanged', () => {
  it('carries an acceptance to whoever holds the lock', async () => {
    const seen = vi.fn();
    const unsubscribe = onConsentChanged(seen);

    await acceptConsent(NOW);
    await vi.waitFor(() => expect(seen).toHaveBeenCalled());

    expect(seen.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'given' });
    unsubscribe();
  });

  it('ignores every other key, so an unrelated write does not reopen the lock', async () => {
    const seen = vi.fn();
    const unsubscribe = onConsentChanged(seen);

    await fakeBrowser.storage.local.set({ 'vigie:watched-domains': ['example.com'] });
    await Promise.resolve();

    expect(seen).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('stops calling back once unsubscribed', async () => {
    const seen = vi.fn();
    onConsentChanged(seen)();

    await acceptConsent(NOW);
    await Promise.resolve();

    expect(seen).not.toHaveBeenCalled();
  });
});
