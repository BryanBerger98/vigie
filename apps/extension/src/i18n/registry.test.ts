import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, findCatalog, isKnownLocale, LOCALES, MESSAGES } from './registry';

/**
 * The registry's whole job is to have no opinion about which languages exist.
 *
 * So the assertion that matters is not "en and fr are there" — it is that the list matches the
 * directory. A hand-maintained array passes the first and fails the second the day someone drops a
 * third catalog in, which is precisely the criterion this phase exists for (`prd.md:125`).
 */

const catalogDirectory = fileURLToPath(new URL('./catalogs', import.meta.url));

function catalogFiles(): string[] {
  return readdirSync(catalogDirectory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort();
}

describe('the languages this build ships', () => {
  it('are exactly the catalog files on disk, none written down anywhere', () => {
    expect(LOCALES.map((catalog) => catalog.code).sort()).toEqual(catalogFiles());
  });

  it('offers English first, then the rest alphabetically', () => {
    expect(LOCALES.map((catalog) => catalog.code)).toEqual(['en', 'fr']);
    expect(LOCALES[0]?.code).toBe(DEFAULT_LOCALE);
  });

  it('names each language in its own language', () => {
    expect(findCatalog('en')?.label).toBe('English');
    expect(findCatalog('fr')?.label).toBe('Français');
  });
});

describe('the message index', () => {
  it('holds one entry per language, keyed by its code', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(catalogFiles());
  });

  it('hands back the same object the catalog exports', () => {
    expect(MESSAGES['fr']).toBe(findCatalog('fr')?.messages);
  });
});

describe('a locale code coming from outside', () => {
  it('is recognised when a catalog backs it', () => {
    expect(isKnownLocale('fr')).toBe(true);
  });

  it.each([
    ['a language with no catalog', 'de'],
    ['a regional variant, which is never stored as such', 'fr-CA'],
    ['the automatic preference, which is not a locale', 'auto'],
    ['an empty string', ''],
    ['something that is not a string', 42],
  ])('is refused when it is %s', (_case, value) => {
    expect(isKnownLocale(value)).toBe(false);
  });
});
