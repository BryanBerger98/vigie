/**
 * The disclosure, written once and rendered everywhere.
 *
 * The Chrome Web Store policy update of 2026-08-01 requires the disclosure to be prominent *in the
 * product*, not only in a linked privacy policy (`deployment.md:40`). It also requires the two to
 * agree: a policy that describes something the screen does not is a rejection motive on its own.
 * Keeping the sentences in one module is what makes that agreement structural — the consent screen
 * and the settings render this, and `docs/privacy-policy.md` is written from it word for word.
 *
 * ## Why a version number lives next to the text
 *
 * Consent is consent to *these* words. Adding a captured category to a build whose users already
 * agreed to the previous wording would leave the disclosure covering less than the capture does,
 * which is the failure the policy is about. Bumping `CONSENT_TEXT_VERSION` in the same edit that
 * changes a sentence is what makes the extension ask again (`consent/state.ts:33`).
 *
 * ## What is deliberately absent
 *
 * Screen video. The product does not record it, and announcing an absence the user never suspected
 * manufactures a doubt rather than removing one. The policy asks for what *is* captured to be
 * disclosed; the limits below state the three that bound it, and none of them is a denial list.
 */

/**
 * The wording currently shipped. Bump it in the same commit that edits any sentence in this file.
 *
 * A stored number greater than this one — a downgrade — is treated as valid rather than stale:
 * whoever accepted it saw at least this much.
 */
export const CONSENT_TEXT_VERSION = 1;

/** Where the same words live in their public form. Published to GitHub Pages in phase 11. */
export const PRIVACY_POLICY_URL = 'https://bryanberger98.github.io/vigie/privacy-policy.html';

export interface DisclosureItem {
  /** Short handle, also the anchor an end-to-end assertion counts on. */
  id: string;
  title: string;
  body: string;
}

export const CONSENT_HEADING = 'What Vigie records';

/** The single sentence the screen opens on: what the capture is for, before what it is. */
export const CONSENT_PROMISE =
  'Vigie keeps the last hour of what your browser does on the domains you designate, so you can hand over the context of a bug that already happened instead of trying to reproduce it.';

/**
 * The three categories the capture writes to disk. One per capture layer, and the list is
 * exhaustive: a fourth layer added later has to add its paragraph here, or the disclosure stops
 * covering the capture.
 */
export const CAPTURED: readonly DisclosureItem[] = [
  {
    id: 'network',
    title: 'Network traffic',
    body: 'Every request a watched tab makes: its URL, its method, its status code, its timing, and its raw request and response headers. Those headers carry authentication tokens, session cookies and API keys. Response bodies are never captured.',
  },
  {
    id: 'console',
    title: 'Console output',
    body: 'Everything the page writes to the console — log, info, warn, error and debug — with its arguments serialised as text. Whatever an application logs, including data about the people using it, is recorded exactly as it was logged.',
  },
  {
    id: 'error',
    title: 'JavaScript errors',
    body: 'Uncaught exceptions and unhandled promise rejections, with their message and their stack trace.',
  },
];

/**
 * What bounds the capture. Stated as counterpoints to the list above rather than as reassurance:
 * each one is a property of the code, and each one is verifiable from the settings screen.
 */
export const NOT_CAPTURED: readonly DisclosureItem[] = [
  {
    id: 'local',
    title: 'Nothing leaves this machine',
    body: 'Vigie has no server, no account and no telemetry. What it records stays in this browser profile until you copy a report yourself.',
  },
  {
    id: 'scope',
    title: 'Nothing outside the domains you designate',
    body: 'Capture happens only on the domains you add, and only while the browser grants Vigie access to them. Every other site is never observed and never stored.',
  },
  {
    id: 'hour',
    title: 'Nothing older than one hour',
    body: 'Anything captured more than an hour ago is deleted. You can also erase everything at once from the settings, at any time.',
  },
];

/** The label on the one control that unblocks the product. */
export const CONSENT_ACCEPT_LABEL = 'I agree — start capturing';
