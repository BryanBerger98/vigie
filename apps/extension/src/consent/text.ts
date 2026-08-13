import { DEFAULT_LOCALE, type LocaleCode, type MessageKey } from '@/i18n/registry';

/**
 * The disclosure, named once and rendered everywhere.
 *
 * The Chrome Web Store policy update of 2026-08-01 requires the disclosure to be prominent *in the
 * product*, not only in a linked privacy policy (`deployment.md:40`). It also requires the two to
 * agree: a policy that describes something the screen does not is a rejection motive on its own.
 * This module is what makes that agreement structural — it holds the list of what is announced, the
 * consent screen and the settings render it, and each published policy is written from it.
 *
 * What lives here is now the *shape* of the disclosure: which categories are announced, in which
 * order, under which key. The sentences themselves live in the catalogs, because the same
 * disclosure has to exist in every language the extension ships.
 *
 * ## Why a version number lives next to it
 *
 * Consent is consent to a capture, not to a wording. Adding a captured category to a build whose
 * users already agreed to the previous disclosure would leave it covering less than the capture
 * does, which is the failure the policy is about. Bumping `CONSENT_TEXT_VERSION` is what makes the
 * extension ask again (`consent/state.ts:33`).
 *
 * So: **a category added, removed or widened carries the version. A sentence rendered in another
 * language does not.** Translating asks nothing of anyone (`prd.md:108`) — the person who agreed
 * agreed to this capture, and it has not changed. `text.test.ts` is what holds the two apart: it
 * pins the version to the announced categories, so a bump that no category justifies fails there.
 *
 * ## What is deliberately absent
 *
 * Screen video. The product does not record it, and announcing an absence the user never suspected
 * manufactures a doubt rather than removing one. The policy asks for what *is* captured to be
 * disclosed; the limits below state the three that bound it, and none of them is a denial list.
 */

/**
 * The capture currently disclosed. Bump it when what Vigie records changes, never when a sentence
 * about it changes.
 *
 * A stored number greater than this one — a downgrade — is treated as valid rather than stale:
 * whoever accepted it saw at least this much.
 */
export const CONSENT_TEXT_VERSION = 2;

/** The published policy, in the language the reader is being asked to agree in. */
const PRIVACY_POLICY_URLS: Readonly<Record<LocaleCode, string>> = {
  en: 'https://bryanberger98.github.io/vigie/privacy-policy.html',
  fr: 'https://bryanberger98.github.io/vigie/politique-de-confidentialite.html',
};

const FALLBACK_PRIVACY_POLICY_URL = 'https://bryanberger98.github.io/vigie/privacy-policy.html';

/**
 * Where the same words live in their public form.
 *
 * A language with no published policy falls back to the English one rather than to a dead link:
 * an unreachable policy is worse than one in the wrong language, since the Web Store treats a
 * broken policy link as a missing policy (`deployment.md:33`).
 */
export function privacyPolicyUrl(locale: LocaleCode): string {
  return PRIVACY_POLICY_URLS[locale] ?? PRIVACY_POLICY_URLS[DEFAULT_LOCALE] ?? FALLBACK_PRIVACY_POLICY_URL;
}

export interface DisclosureItem {
  /** Short handle, also the anchor an end-to-end assertion counts on, in every language. */
  id: string;
  title: MessageKey;
  body: MessageKey;
}

export const CONSENT_HEADING = 'consent.heading' satisfies MessageKey;

/** The single sentence the screen opens on: what the capture is for, before what it is. */
export const CONSENT_PROMISE = 'consent.promise' satisfies MessageKey;

/**
 * The three categories the capture writes to disk. One per capture layer, and the list is
 * exhaustive: a fourth layer added later has to add its entry here, or the disclosure stops
 * covering the capture — and adding one is exactly what carries `CONSENT_TEXT_VERSION`.
 */
export const CAPTURED: readonly DisclosureItem[] = [
  {
    id: 'network',
    title: 'consent.captured.network.title',
    body: 'consent.captured.network.body',
  },
  {
    id: 'console',
    title: 'consent.captured.console.title',
    body: 'consent.captured.console.body',
  },
  {
    id: 'error',
    title: 'consent.captured.error.title',
    body: 'consent.captured.error.body',
  },
];

/**
 * What bounds the capture. Stated as counterpoints to the list above rather than as reassurance:
 * each one is a property of the code, and each one is verifiable from the settings screen.
 */
export const NOT_CAPTURED: readonly DisclosureItem[] = [
  {
    id: 'local',
    title: 'consent.limit.local.title',
    body: 'consent.limit.local.body',
  },
  {
    id: 'scope',
    title: 'consent.limit.scope.title',
    body: 'consent.limit.scope.body',
  },
  {
    id: 'hour',
    title: 'consent.limit.hour.title',
    body: 'consent.limit.hour.body',
  },
];

/** The label on the one control that unblocks the product. */
export const CONSENT_ACCEPT_LABEL = 'consent.accept' satisfies MessageKey;
