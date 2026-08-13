import { messages as english } from './catalogs/en';

/**
 * Which languages exist, and what a message key is.
 *
 * The list is discovered, never written down: `import.meta.glob` reads the catalogs directory at
 * build time, so a third language is a file dropped next to the other two and nothing else. That
 * is the acceptance criterion itself — "adding a third language means touching no surface"
 * (`prd.md:125`) — and any hand-maintained array would be the one place that criterion breaks.
 *
 * `eager: true` because the catalogs are loaded, not fetched. The language changes on a click and
 * the surfaces already open must answer in the same frame; a dynamic import would put a network of
 * promises between the click and the sentence, for a payload measured in kilobytes.
 *
 * English is named once here, and only in its second role: it is the reference the key type is cut
 * from and the floor of the fallback chain. As a *language* it is discovered by the glob like the
 * others.
 */

/** The language every fallback ends on. */
export const DEFAULT_LOCALE = 'en';

/**
 * A locale code, always a root: `fr`, never `fr-CA`. Regional variants are reduced before they
 * reach anything in this module (`resolve.ts`).
 *
 * It cannot be narrower than `string`: the set of codes is decided by which files exist, which is
 * a build-time fact TypeScript has no way to read. `isKnownLocale` is the runtime narrowing.
 */
export type LocaleCode = string;

/** Every key the interface can say. Absent from here means absent at compile time. */
export type MessageKey = keyof typeof english;

/** What a catalog file exports. Structural: the module namespace *is* the catalog. */
export interface Catalog {
  code: LocaleCode;
  /** The language named in its own language, so a reader finds theirs without knowing ours. */
  label: string;
  messages: Partial<Record<MessageKey, string>>;
}

/** Every catalog, keyed by locale. A language may hold holes; English may not. */
export type MessageIndex = Readonly<Record<LocaleCode, Partial<Record<MessageKey, string>>>>;

const discovered = import.meta.glob<Catalog>('./catalogs/*.ts', { eager: true });

/**
 * Every language the build ships, English first and the rest alphabetical.
 *
 * The order is the order the settings offer them in. English leads because it is the fallback:
 * the list reads as "the one you always get, then the ones that were added".
 */
export const LOCALES: readonly Catalog[] = Object.values(discovered).sort(fallbackFirst);

function fallbackFirst(a: Catalog, b: Catalog): number {
  if (a.code === b.code) return 0;
  if (a.code === DEFAULT_LOCALE) return -1;
  if (b.code === DEFAULT_LOCALE) return 1;
  return a.code.localeCompare(b.code);
}

export const MESSAGES: MessageIndex = Object.fromEntries(
  LOCALES.map((catalog) => [catalog.code, catalog.messages]),
);

/** Whether a value is a locale this build actually holds a catalog for. */
export function isKnownLocale(value: unknown): value is LocaleCode {
  return typeof value === 'string' && LOCALES.some((catalog) => catalog.code === value);
}

/** The catalog for a locale, or `undefined` when no file declares it. */
export function findCatalog(locale: LocaleCode): Catalog | undefined {
  return LOCALES.find((catalog) => catalog.code === locale);
}
