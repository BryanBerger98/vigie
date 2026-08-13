import { useI18n } from '@/i18n/I18nProvider';

import { CAPTURED, CONSENT_PROMISE, NOT_CAPTURED, privacyPolicyUrl, type DisclosureItem } from './text';

/**
 * The disclosure, rendered. One component for the two places it has to appear: the first-run screen
 * and the settings, where it stays readable after acceptance (`phase-9.md` tasks 2 and 3).
 *
 * Sharing the rendering is what makes the two agree by construction. Two copies of these
 * paragraphs would drift the first time one of them is edited, and a divergence between what the
 * product discloses in one surface and in another is the same defect as a divergence with the
 * privacy policy.
 *
 * The `data-testid` handles are what the end-to-end suite counts the announced categories on. They
 * carry the category `id`, never its title, so the same assertions hold in every language: what has
 * to match across languages is the set of things announced, not the words announcing them.
 */

function Item({ item }: { item: DisclosureItem }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{t(item.title)}</span>
      <span className="text-muted-foreground">{t(item.body)}</span>
    </div>
  );
}

export function Disclosure() {
  const { t, locale } = useI18n();

  return (
    <div data-testid="consent-disclosure" className="flex flex-col gap-5 text-sm">
      <p data-testid="consent-promise">{t(CONSENT_PROMISE)}</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('consent.captured.title')}</h2>
        <ul className="flex flex-col gap-3">
          {CAPTURED.map((item) => (
            <li key={item.id} data-testid="consent-captured" data-category={item.id}>
              <Item item={item} />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('consent.limits.title')}</h2>
        <ul className="flex flex-col gap-3">
          {NOT_CAPTURED.map((item) => (
            <li key={item.id} data-testid="consent-limit" data-category={item.id}>
              <Item item={item} />
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm">
        {/* The policy the reader is being asked to agree to, in the language they are reading it in. */}
        <a
          data-testid="privacy-policy-link"
          href={privacyPolicyUrl(locale)}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {t('consent.policy')}
        </a>
      </p>
    </div>
  );
}
