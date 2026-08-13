import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The two strings the browser renders itself, and the one rule they have to obey.
 *
 * These live in `public/_locales/` rather than in the catalogs the surfaces read, because
 * `chrome.i18n` resolves at load against the browser's language and is the only way a store listing
 * gets localised (`architecture.md`). Nothing checks them at build time: WXT copies the directory
 * verbatim, and Chrome answers a description over the cap by rejecting the submission — days later,
 * by hand, from a reviewer.
 *
 * That already happened once. The English description shipped at 135 characters against a documented
 * ceiling of 132, and no one measured it until a translation forced the count. So the count is a
 * test now, and it runs on every locale the directory holds rather than on a list written here — a
 * locale added without being measured is the exact way this comes back.
 */

/** Chrome's documented ceiling for a manifest description. Longer is refused at submission. */
const DESCRIPTION_CEILING = 132;

const LOCALES_DIR = fileURLToPath(new URL('../../public/_locales', import.meta.url));

interface Message {
  message: string;
  description: string;
}

function localeMessages(locale: string): Record<string, Message> {
  const path = `${LOCALES_DIR}/${locale}/messages.json`;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, Message>;
}

const locales = readdirSync(LOCALES_DIR);
const reference = localeMessages('en');

describe('the manifest locales', () => {
  it('ships the locale the manifest defaults to', () => {
    expect(locales).toContain('en');
  });

  it.each(locales)('holds in %s the same keys as the default locale', (locale) => {
    // A partial catalog is fine for the surfaces, where English fills the hole at render time. It
    // is not fine here: Chrome falls back per message, so a hole shows a French listing with an
    // English line in the middle of it, and nothing in the build says so.
    expect(Object.keys(localeMessages(locale)).sort()).toEqual(Object.keys(reference).sort());
  });

  it.each(locales)('keeps the %s description under the ceiling Chrome enforces', (locale) => {
    const said = localeMessages(locale).extDescription?.message ?? '';
    expect([...said].length).toBeLessThanOrEqual(DESCRIPTION_CEILING);
  });

  it.each(locales)('repeats the product name verbatim in %s', (locale) => {
    // `Vigie` is a product name, and a product name is not translated (`glossaire.md`).
    expect(localeMessages(locale).extName?.message).toBe('Vigie');
  });
});
