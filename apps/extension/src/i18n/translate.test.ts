import { describe, expect, it } from 'vitest';

import { messages as english } from './catalogs/en';
import type { MessageIndex } from './registry';
import { createTranslator } from './translate';

/**
 * What a key becomes on screen.
 *
 * The fallback is the case worth building a seam for. Shipped catalogs are complete — the parity
 * test fails the suite otherwise — so the behaviour a French user would see the day a key is added
 * and not translated cannot be observed against the real ones. The translator therefore takes its
 * index as an argument, and these tests hand it a catalog with a hole in it.
 */

const withHoles: MessageIndex = {
  en: english,
  fr: {
    'language.title': 'Langue',
    'store.entries.one': '{count} entrée',
    'store.entries.other': '{count} entrées',
    // 'language.description' is deliberately missing.
    'language.automatic': '   ',
  },
};

describe('a key the locale translates', () => {
  it('renders the translation', () => {
    const t = createTranslator('fr', withHoles);

    expect(t('language.title')).toBe('Langue');
  });

  it('renders English when English is what is asked for', () => {
    const t = createTranslator('en', withHoles);

    expect(t('language.title')).toBe('Language');
  });
});

describe('a key the locale has not translated', () => {
  it('renders the English sentence, not the key and not a blank', () => {
    const t = createTranslator('fr', withHoles);

    expect(t('language.description')).toBe(english['language.description']);
  });

  it('treats a blank entry as a hole rather than as a sentence', () => {
    const t = createTranslator('fr', withHoles);

    expect(t('language.automatic')).toBe('Automatic');
  });

  it('never renders a key or an empty string, whatever the index holds', () => {
    const t = createTranslator('fr', { en: english, fr: {} });

    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      expect(t(key).trim()).not.toBe('');
      expect(t(key)).not.toBe(key);
    }
  });
});

describe('a locale nothing in the index answers for', () => {
  it('renders English rather than failing', () => {
    const t = createTranslator('de', withHoles);

    expect(t('language.title')).toBe('Language');
  });
});

describe('a sentence with a named slot', () => {
  it('fills it from the parameters', () => {
    const t = createTranslator('fr');

    expect(t('language.automatic.detected', { language: 'Français' })).toBe(
      'Automatique — Français',
    );
  });

  it('fills it wherever the translation moved it', () => {
    const t = createTranslator('en');

    expect(t('language.automatic.detected', { language: 'French' })).toBe('Automatic — French');
  });

  it('accepts a number as readily as a string', () => {
    const t = createTranslator('en');

    expect(t('store.entries.other', { count: 12 })).toBe('12 entries');
  });

  it('leaves an unfilled slot standing, so the defect is visible', () => {
    const t = createTranslator('en');

    expect(t('language.automatic.detected')).toBe('Automatic — {language}');
    expect(t('language.automatic.detected', { other: 'x' })).toBe('Automatic — {language}');
  });
});

describe('a count, on a language whose plural rule is not English', () => {
  const en = createTranslator('en');
  const fr = createTranslator('fr');

  it.each([
    [1, '1 entry'],
    [2, '2 entries'],
    [0, '0 entries'],
  ])('says %d the English way', (count, expected) => {
    expect(en.plural(count, 'store.entries.one', 'store.entries.other')).toBe(expected);
  });

  it.each([
    [1, '1 entrée'],
    [2, '2 entrées'],
    // French keeps zero singular. A hard-coded `count === 1` would write "0 entrées" here.
    [0, '0 entrée'],
  ])('says %d the French way', (count, expected) => {
    expect(fr.plural(count, 'store.entries.one', 'store.entries.other')).toBe(expected);
  });

  it('passes the count to the sentence without being asked', () => {
    expect(fr.plural(7, 'store.entries.one', 'store.entries.other')).toContain('7');
  });
});
