import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  onLanguagePreferenceChanged,
  readLanguagePreference,
  writeLanguagePreference,
} from './preference';
import type { LocaleCode } from './registry';
import { AUTOMATIC, detectUILanguage, resolveLocale, type LanguagePreference } from './resolve';
import { createTranslator, type Translator } from './translate';

/**
 * The language, as a React surface sees it.
 *
 * A changed preference has to reach the surfaces that are *already open*, with no reload and no
 * restart (`prd.md:102`), so the language cannot be read once at start-up. The provider holds it
 * in state and re-subscribes to `storage.local.onChanged`, which is what makes a choice made in
 * the settings repaint a popup standing next to it.
 *
 * It touches nothing else. No database, no capture listener, no service worker message: changing
 * the language cannot interrupt a capture in progress (`prd.md:103`) because there is no path from
 * here to one.
 *
 * ## The first frame
 *
 * `getUILanguage()` answers synchronously, the stored preference does not. So the first render
 * resolves as if the preference were `'auto'`, and the stored one arrives a tick later. On the
 * common install — nothing chosen — the first frame is already right. On an install that forced a
 * language against its browser, the first frame can be the other one, briefly. That is the traded
 * cost: the alternative is rendering nothing until storage answers, which turns every popup
 * opening into a blank frame to spare a case that only exists for someone who overrode Chrome.
 */

export interface I18n {
  t: Translator;
  /** The locale actually rendering. */
  locale: LocaleCode;
  /** The root the browser announces, whether or not a catalog exists for it. */
  detected: LocaleCode;
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, holdPreference] = useState<LanguagePreference>(AUTOMATIC);
  // Read once: a browser whose language changes mid-session reloads its extension surfaces anyway.
  const [uiLanguage] = useState(detectUILanguage);

  useEffect(() => {
    let mounted = true;

    void readLanguagePreference().then((stored) => {
      if (mounted) holdPreference(stored);
    });

    const unsubscribe = onLanguagePreferenceChanged(holdPreference);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const { locale, detected } = useMemo(
    () => resolveLocale(preference, uiLanguage),
    [preference, uiLanguage],
  );

  const t = useMemo(() => createTranslator(locale), [locale]);

  /**
   * The state moves first and the disk follows. The surface that was clicked answers in the same
   * frame; the others hear about it through `onChanged`, which is also the path a change made in
   * another window takes.
   */
  const setPreference = useCallback((next: LanguagePreference) => {
    holdPreference(next);
    void writeLanguagePreference(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({ t, locale, detected, preference, setPreference }),
    [t, locale, detected, preference, setPreference],
  );

  return <I18nContext value={value}>{children}</I18nContext>;
}

/** The language of the surface this component belongs to. Throws outside a provider. */
export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n was called outside an I18nProvider');
  return value;
}
