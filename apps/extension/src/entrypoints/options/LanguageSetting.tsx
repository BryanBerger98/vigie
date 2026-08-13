import { useI18n } from '@/i18n/I18nProvider';
import { findCatalog, LOCALES, type LocaleCode } from '@/i18n/registry';
import { AUTOMATIC, type LanguagePreference } from '@/i18n/resolve';

/**
 * The language of the interface, and the only place it is chosen.
 *
 * It sits directly under the header rather than at the end of the page: a setting that asks the
 * user to scroll past a domain list of unknown length is not "reachable from the settings alone"
 * (`prd.md:89`). It also sits outside the consent gate — the disclosure has to be readable in the
 * user's language *before* it is agreed to, so the language cannot be locked behind the agreement.
 *
 * The values come from the registry, never from a list written here. A third language is a file
 * dropped in `i18n/catalogs/`, and this file is not part of the change (`prd.md:125`).
 */

/**
 * The name to show a language under.
 *
 * A language we ship is shown under the name it calls itself — `Français`, not `French` — because
 * a list of languages is read by someone looking for their own. A language we do not ship can
 * still be the one the browser announced, and there `Intl` names it in the interface language,
 * which is the best that can be said about a language nobody translated.
 */
function languageName(code: LocaleCode, locale: LocaleCode): string {
  const shipped = findCatalog(code);
  if (shipped) return shipped.label;

  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function LanguageSetting() {
  const { t, locale, detected, preference, setPreference } = useI18n();

  return (
    <section className="flex flex-col gap-2">
      <h2 id="language-title" className="text-sm font-medium">
        {t('language.title')}
      </h2>

      {/*
        A native control on purpose: three values, no dependency, and a keyboard and screen-reader
        behaviour Chrome already owns. The change writes the preference and nothing else — what
        repaints the page is the provider's subscription, not this handler (`prd.md:102`).
      */}
      <select
        data-testid="language-select"
        aria-labelledby="language-title"
        className="h-9 w-fit rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={preference}
        onChange={(event) => setPreference(event.target.value as LanguagePreference)}
      >
        <option value={AUTOMATIC}>
          {detected
            ? t('language.automatic.detected', { language: languageName(detected, locale) })
            : t('language.automatic')}
        </option>

        {LOCALES.map((catalog) => (
          <option key={catalog.code} value={catalog.code}>
            {catalog.label}
          </option>
        ))}
      </select>

      <p className="text-xs text-muted-foreground">{t('language.description')}</p>
    </section>
  );
}
