import { describe, expect, it, vi } from 'vitest';

import { AUTOMATIC, detectUILanguage, languageRoot, resolveLocale } from './resolve';

/**
 * Everything the product promises about defaults, asserted without a browser.
 *
 * The cases are the acceptance criteria word for word: a French browser gets French with no
 * setting, a regional variant follows its root, anything else gets English, and an explicit choice
 * beats the browser in both directions.
 */

describe('a profile that has never chosen a language', () => {
  it.each([
    ['an English browser', 'en-US', 'en'],
    ['a French browser', 'fr-FR', 'fr'],
    ['a Canadian French browser', 'fr-CA', 'fr'],
    ['a Belgian French browser', 'fr-BE', 'fr'],
    ['a bare root with no region', 'fr', 'fr'],
  ])('follows %s', (_case, uiLanguage, expected) => {
    expect(resolveLocale(AUTOMATIC, uiLanguage).locale).toBe(expected);
  });

  it.each([
    ['a language this build does not ship', 'de-DE'],
    ['a language nobody anticipated', 'xx-YY'],
    ['a browser that answers nothing at all', ''],
  ])('falls back to English on %s', (_case, uiLanguage) => {
    expect(resolveLocale(AUTOMATIC, uiLanguage).locale).toBe('en');
  });
});

describe('a profile that chose a language', () => {
  it('renders it against an English browser', () => {
    expect(resolveLocale('fr', 'en-US').locale).toBe('fr');
  });

  it('renders it against a French browser too — the override goes both ways', () => {
    expect(resolveLocale('en', 'fr-FR').locale).toBe('en');
  });

  it('follows the browser again the moment it goes back to automatic', () => {
    expect(resolveLocale(AUTOMATIC, 'fr-FR').locale).toBe('fr');
  });

  it('falls back to the browser when the chosen language no longer ships', () => {
    // A profile written by a build that shipped German, read by one that does not.
    expect(resolveLocale('de', 'fr-FR').locale).toBe('fr');
  });
});

describe('what the settings screen has to name', () => {
  it('reports the detected root next to the applied locale', () => {
    expect(resolveLocale(AUTOMATIC, 'fr-CA')).toEqual({ locale: 'fr', detected: 'fr' });
  });

  it('keeps reporting the detection when the interface had to fall back', () => {
    expect(resolveLocale(AUTOMATIC, 'de-DE')).toEqual({ locale: 'en', detected: 'de' });
  });

  it('keeps reporting the detection when an explicit choice overrode it', () => {
    expect(resolveLocale('en', 'fr-FR')).toEqual({ locale: 'en', detected: 'fr' });
  });
});

describe('a browser language tag', () => {
  it.each([
    ['fr-CA', 'fr'],
    ['fr_BE', 'fr'],
    ['EN-GB', 'en'],
    ['  fr  ', 'fr'],
    ['', ''],
  ])('reduces %s to its root', (tag, expected) => {
    expect(languageRoot(tag)).toBe(expected);
  });
});

describe('asking the browser what it is set to', () => {
  it('answers the tag it announces', () => {
    vi.spyOn(browser.i18n, 'getUILanguage').mockReturnValue('fr-CA');

    expect(detectUILanguage()).toBe('fr-CA');
  });

  it('answers nothing rather than throwing where the API is absent', () => {
    // The unit environment is that case: WXT's fake browser refuses `i18n` outright.
    vi.spyOn(browser.i18n, 'getUILanguage').mockImplementation(() => {
      throw new Error('not implemented');
    });

    expect(detectUILanguage()).toBe('');
  });
});
