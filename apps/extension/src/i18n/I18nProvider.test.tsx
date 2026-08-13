// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { I18nProvider, useI18n } from './I18nProvider';
import { writeLanguagePreference } from './preference';

/**
 * The part of the mechanism a pure function cannot carry: a surface that is already on screen has
 * to change language where it stands, without being remounted (`prd.md:102`).
 *
 * So every assertion here counts mounts as well as words. A provider that reloaded its subtree
 * would pass on the text and fail the product: an open popup would lose the depth it was about to
 * export at, and the side panel would lose its scroll position.
 */

/** What `act()` looks for before it agrees to flush effects instead of warning about them. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let mounts = 0;

function Probe() {
  const { t, locale, detected, preference, setPreference } = useI18n();

  useEffect(() => {
    mounts += 1;
  }, []);

  return (
    <div>
      <span data-role="title">{t('language.title')}</span>
      <span data-role="locale">{locale}</span>
      <span data-role="detected">{detected}</span>
      <span data-role="preference">{preference}</span>
      <button type="button" onClick={() => setPreference('fr')}>
        French
      </button>
    </div>
  );
}

function read(role: string): string {
  return container.querySelector(`[data-role="${role}"]`)?.textContent ?? '';
}

async function mountUnderBrowserLanguage(uiLanguage: string): Promise<void> {
  vi.spyOn(browser.i18n, 'getUILanguage').mockReturnValue(uiLanguage);

  await act(async () => {
    root.render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  mounts = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('a surface mounting on a profile that never chose', () => {
  it('speaks the browser language with nothing configured', async () => {
    await mountUnderBrowserLanguage('fr-FR');

    expect(read('title')).toBe('Langue');
    expect(read('preference')).toBe('auto');
  });

  it('names what the browser announced even when it had to fall back', async () => {
    await mountUnderBrowserLanguage('de-DE');

    expect(read('locale')).toBe('en');
    expect(read('detected')).toBe('de');
  });
});

describe('a surface mounting on a profile that chose', () => {
  it('honours the stored choice over the browser', async () => {
    await writeLanguagePreference('en');

    await mountUnderBrowserLanguage('fr-FR');

    expect(read('title')).toBe('Language');
    expect(read('preference')).toBe('en');
  });
});

describe('the language changing under an open surface', () => {
  it('repaints on a choice made here, without remounting anything', async () => {
    await mountUnderBrowserLanguage('en-US');
    expect(read('title')).toBe('Language');

    await act(async () => {
      container.querySelector('button')?.click();
    });

    expect(read('title')).toBe('Langue');
    expect(read('preference')).toBe('fr');
    expect(mounts).toBe(1);
  });

  it('records that choice where the other surfaces read it', async () => {
    await mountUnderBrowserLanguage('en-US');

    await act(async () => {
      container.querySelector('button')?.click();
    });

    expect(await fakeBrowser.storage.local.get('vigie:language')).toEqual({
      'vigie:language': 'fr',
    });
  });

  it('repaints on a choice made by another surface, without remounting anything', async () => {
    await mountUnderBrowserLanguage('en-US');

    await act(async () => {
      await writeLanguagePreference('fr');
    });

    expect(read('title')).toBe('Langue');
    expect(mounts).toBe(1);
  });

  it('goes back to following the browser when the choice is withdrawn', async () => {
    await writeLanguagePreference('en');
    await mountUnderBrowserLanguage('fr-FR');
    expect(read('title')).toBe('Language');

    await act(async () => {
      await writeLanguagePreference('auto');
    });

    expect(read('title')).toBe('Langue');
    expect(mounts).toBe(1);
  });
});

describe('a component reaching for the language outside a provider', () => {
  it('fails loudly rather than rendering English by accident', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      act(async () => {
        root.render(<Probe />);
      }),
    ).rejects.toThrow(/outside an I18nProvider/);
  });
});
