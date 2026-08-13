import { messages as english } from './catalogs/en';
import {
  DEFAULT_LOCALE,
  MESSAGES,
  type LocaleCode,
  type MessageIndex,
  type MessageKey,
} from './registry';

/**
 * Turning a key into a finished sentence.
 *
 * Three rules, and the third is the one that decides the shape of the other two.
 *
 * A key with no translation renders English, never a blank and never the key itself
 * (`prd.md:97`). The chain is: the locale's catalog, then the default one, then the English object
 * imported here by name. That last step is not a runtime guess — `MessageKey` is cut from that
 * object, so the compiler already knows the sentence is there.
 *
 * Interpolation is named. `{domain}` survives a translation that moves it to the other end of the
 * sentence; a positional slot does not.
 *
 * Plurals are two explicit keys chosen by the count, not a rule hidden in the catalog — and the
 * choice runs through `Intl.PluralRules`, because the rule is not the same in the two languages
 * shipped. Zero is plural in English and singular in French: hard-coding `count === 1` would put
 * "0 entrées" on the French settings screen.
 */

export type MessageParams = Readonly<Record<string, string | number>>;

export interface Translator {
  (key: MessageKey, params?: MessageParams): string;
  /**
   * Picks between a singular and a plural key with the locale's own rule, then translates it.
   * `count` is passed to the sentence without being asked for, since a plural that never shows
   * its count is not a plural.
   */
  plural(count: number, one: MessageKey, other: MessageKey, params?: MessageParams): string;
}

/**
 * A translator bound to one locale.
 *
 * `messages` is injectable so the fallback chain can be tested against a catalog with a hole in
 * it. Shipped catalogs never have one — `catalog-parity.test.ts` fails the suite over it — which
 * is exactly why the behaviour needs a seam to be observed at all.
 */
export function createTranslator(locale: LocaleCode, messages: MessageIndex = MESSAGES): Translator {
  const translator = ((key: MessageKey, params?: MessageParams) =>
    interpolate(lookup(messages, locale, key), params)) as Translator;

  translator.plural = (count, one, other, params) =>
    translator(pluralRuleFor(locale).select(count) === 'one' ? one : other, { count, ...params });

  return translator;
}

function lookup(messages: MessageIndex, locale: LocaleCode, key: MessageKey): string {
  return filled(messages[locale]?.[key]) ?? filled(messages[DEFAULT_LOCALE]?.[key]) ?? english[key];
}

/** An empty catalog entry is a hole, not a sentence: it falls through like an absent key. */
function filled(sentence: string | undefined): string | undefined {
  return sentence && sentence.trim().length > 0 ? sentence : undefined;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * A placeholder with no matching parameter is left standing rather than blanked. It reads as the
 * defect it is, where an empty gap would read as a sentence that meant to say nothing.
 */
function interpolate(sentence: string, params?: MessageParams): string {
  if (!params) return sentence;
  return sentence.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

const pluralRules = new Map<LocaleCode, Intl.PluralRules>();

function pluralRuleFor(locale: LocaleCode): Intl.PluralRules {
  const known = pluralRules.get(locale);
  if (known) return known;

  const rules = safePluralRules(locale);
  pluralRules.set(locale, rules);
  return rules;
}

function safePluralRules(locale: LocaleCode): Intl.PluralRules {
  try {
    return new Intl.PluralRules(locale);
  } catch {
    return new Intl.PluralRules(DEFAULT_LOCALE);
  }
}
