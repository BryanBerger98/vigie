import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  LANGUAGE_PREFERENCE_KEY,
  onLanguagePreferenceChanged,
  readLanguagePreference,
  writeLanguagePreference,
} from './preference';

/**
 * The one setting the product stores about language.
 *
 * Three properties, and only the first is about the happy path: it comes back as it was written,
 * it never leaves the machine, and a value this build cannot honour reads as automatic rather than
 * as a language nobody can see.
 */

beforeEach(() => {
  fakeBrowser.reset();
});

describe('a profile that has never opened the setting', () => {
  it('is on automatic, without anything having been written', async () => {
    expect(await readLanguagePreference()).toBe('auto');
    expect(await fakeBrowser.storage.local.get(LANGUAGE_PREFERENCE_KEY)).toEqual({});
  });
});

describe('a language the user picked', () => {
  it('comes back exactly as it was written', async () => {
    await writeLanguagePreference('fr');

    expect(await readLanguagePreference()).toBe('fr');
  });

  it('stays on this machine, under the key the surfaces read', async () => {
    await writeLanguagePreference('fr');

    expect(await fakeBrowser.storage.local.get(LANGUAGE_PREFERENCE_KEY)).toEqual({
      [LANGUAGE_PREFERENCE_KEY]: 'fr',
    });
    expect(await fakeBrowser.storage.sync.get(LANGUAGE_PREFERENCE_KEY)).toEqual({});
  });

  it('is replaced by the next choice rather than accumulated', async () => {
    await writeLanguagePreference('fr');
    await writeLanguagePreference('en');

    expect(await readLanguagePreference()).toBe('en');
  });

  it('goes back to automatic, which is a stored answer and not an erasure', async () => {
    await writeLanguagePreference('fr');
    await writeLanguagePreference('auto');

    expect(await readLanguagePreference()).toBe('auto');
    expect(await fakeBrowser.storage.local.get(LANGUAGE_PREFERENCE_KEY)).toEqual({
      [LANGUAGE_PREFERENCE_KEY]: 'auto',
    });
  });
});

describe('a stored value this build cannot honour', () => {
  // Each of these is a plausible disk state: a hand-edited profile, a partial write, and a
  // language a future version could drop.
  it.each([
    ['a language with no catalog', 'de'],
    ['a regional variant, which is never what is stored', 'fr-CA'],
    ['a number', 3],
    ['null', null],
    ['a shape that is not a preference', { locale: 'fr' }],
  ])('reads as automatic when the key holds %s', async (_case, value) => {
    await fakeBrowser.storage.local.set({ [LANGUAGE_PREFERENCE_KEY]: value });

    expect(await readLanguagePreference()).toBe('auto');
  });
});

describe('a surface listening for the choice', () => {
  it('is told the new preference, whichever surface wrote it', async () => {
    const heard = vi.fn();
    onLanguagePreferenceChanged(heard);

    await writeLanguagePreference('fr');

    expect(heard).toHaveBeenCalledWith('fr');
  });

  it('is told a value it can honour, even when the disk holds one it cannot', async () => {
    const heard = vi.fn();
    onLanguagePreferenceChanged(heard);

    await fakeBrowser.storage.local.set({ [LANGUAGE_PREFERENCE_KEY]: 'de' });

    expect(heard).toHaveBeenCalledWith('auto');
  });

  it('stays quiet about every other key in the same store', async () => {
    const heard = vi.fn();
    onLanguagePreferenceChanged(heard);

    await fakeBrowser.storage.local.set({ 'vigie:export-depth': 15 });

    expect(heard).not.toHaveBeenCalled();
  });

  it('hears nothing more once it has unsubscribed', async () => {
    const heard = vi.fn();
    const unsubscribe = onLanguagePreferenceChanged(heard);

    unsubscribe();
    await writeLanguagePreference('fr');

    expect(heard).not.toHaveBeenCalled();
  });
});
