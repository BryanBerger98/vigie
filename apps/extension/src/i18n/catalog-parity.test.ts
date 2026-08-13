import { describe, expect, it } from 'vitest';

import { messages as english } from './catalogs/en';
import { DEFAULT_LOCALE, LOCALES } from './registry';

/**
 * The one test that fails on a translation nobody wrote.
 *
 * The fallback makes a missing French key render English, which is the right behaviour at runtime
 * and a terrible one at review time: the interface stays usable and the hole stays invisible. This
 * file is what makes the hole loud, in both directions — a French key with no English counterpart
 * is a sentence the compiler cannot type and a term the glossary never saw.
 */

const englishKeys = Object.keys(english).sort();

describe('every shipped catalog', () => {
  const translations = LOCALES.filter((catalog) => catalog.code !== DEFAULT_LOCALE);

  it.each(translations.map((catalog) => [catalog.code, catalog] as const))(
    'says everything English says, and nothing English does not — %s',
    (_code, catalog) => {
      expect(Object.keys(catalog.messages).sort()).toEqual(englishKeys);
    },
  );

  it.each(LOCALES.map((catalog) => [catalog.code, catalog] as const))(
    'holds no empty sentence — %s',
    (_code, catalog) => {
      const blank = Object.entries(catalog.messages)
        .filter(([, sentence]) => !sentence || sentence.trim().length === 0)
        .map(([key]) => key);

      expect(blank).toEqual([]);
    },
  );

  it.each(LOCALES.map((catalog) => [catalog.code, catalog] as const))(
    'keeps every named placeholder English declares — %s',
    (_code, catalog) => {
      const mismatched = Object.entries(catalog.messages)
        .filter(([key, sentence]) => {
          const reference = english[key as keyof typeof english];
          return placeholders(reference) !== placeholders(sentence ?? '');
        })
        .map(([key]) => key);

      expect(mismatched).toEqual([]);
    },
  );
});

/** The set of `{name}` slots a sentence carries, as a comparable string. */
function placeholders(sentence: string): string {
  return [...sentence.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(',');
}
