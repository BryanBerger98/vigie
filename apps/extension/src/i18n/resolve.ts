import { DEFAULT_LOCALE, isKnownLocale, type LocaleCode } from './registry';

/**
 * Which language a surface renders in, decided in one pure function.
 *
 * Everything the product promises about defaults lives here rather than in a component: a French
 * browser gets French without a setting, a regional variant follows its root, anything else gets
 * English, and an explicit choice beats the browser in both directions (`prd.md:77` to `prd.md:87`).
 *
 * The applied locale and the detected one are returned separately on purpose. The settings screen
 * has to *name* what the browser announced — "Automatic — Français" — and that sentence is not
 * about the catalog that ended up rendering it.
 */

/** `'auto'` follows the browser. Anything else is a locale code that overrides it. */
export type LanguagePreference = 'auto' | LocaleCode;

/** The preference a fresh profile has, without anything being written to disk. */
export const AUTOMATIC: LanguagePreference = 'auto';

export interface LocaleResolution {
  /** The catalog the surfaces render from. Always one the registry holds. */
  locale: LocaleCode;
  /**
   * The root of what the browser announces, catalog or not. `de` stays `de` here even though the
   * interface renders in English: the setting reports a detection, not a fallback.
   */
  detected: LocaleCode;
}

/**
 * Reduces a browser language tag to its root: `fr-CA` and `fr_BE` both give `fr`.
 *
 * Chrome answers `getUILanguage()` with a single tag, and the region in it is a claim about
 * spelling and dates, not about a translation that exists. Vigie ships one French, and a Quebec
 * profile reading English because nothing said `fr-CA` would be a defect, not a nuance.
 */
export function languageRoot(uiLanguage: string): LocaleCode {
  return uiLanguage.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * The language to render in, from the stored preference and what the browser announces.
 *
 * An explicit preference for a language this build does not ship falls back to the automatic
 * behaviour rather than to English: the browser is a better guess than a locale that no longer
 * exists.
 */
export function resolveLocale(
  preference: LanguagePreference,
  uiLanguage: string,
): LocaleResolution {
  const detected = languageRoot(uiLanguage);

  if (preference !== AUTOMATIC && isKnownLocale(preference)) {
    return { locale: preference, detected };
  }

  return { locale: isKnownLocale(detected) ? detected : DEFAULT_LOCALE, detected };
}

/**
 * What the browser says it is set to.
 *
 * Guarded because `i18n` is the one API the unit environment's fake browser does not implement,
 * and because a surface that cannot ask still has to render something.
 */
export function detectUILanguage(): string {
  try {
    return browser.i18n?.getUILanguage() ?? '';
  } catch {
    return '';
  }
}
