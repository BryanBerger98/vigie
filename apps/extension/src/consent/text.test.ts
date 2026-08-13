import { describe, expect, it } from 'vitest';

import { messages as english } from '@/i18n/catalogs/en';

import {
  CAPTURED,
  CONSENT_TEXT_VERSION,
  NOT_CAPTURED,
  privacyPolicyUrl,
  type DisclosureItem,
} from './text';

/**
 * What the consent version is allowed to follow.
 *
 * `CONSENT_TEXT_VERSION` stops the capture and asks everyone again (`state.ts:33`). That is the
 * right answer to a widened capture and the wrong answer to a translated sentence: someone who
 * agreed to this capture agreed to it in whatever language it was read in, and translating asks
 * nothing of them (`prd.md:108`).
 *
 * Git is what would tell the two apart, and no test can read it. So the version is pinned here to
 * the shape of the disclosure instead: the categories announced, by id, in order. Widening the
 * capture means adding or renaming one, which fails this file and forces the version to be
 * reconsidered in the same edit. Translating touches neither, so a bump that no category justifies
 * fails here as an unexplained change.
 */

/** The capture announced by version 2, as ids. Editing this list is editing what is disclosed. */
const ANNOUNCED = {
  version: 2,
  captured: ['network', 'console', 'error'],
  limits: ['local', 'scope', 'hour'],
} as const;

describe('the disclosure', () => {
  it('announces the capture its version stands for', () => {
    expect(CONSENT_TEXT_VERSION).toBe(ANNOUNCED.version);
    expect(CAPTURED.map((item) => item.id)).toEqual(ANNOUNCED.captured);
    expect(NOT_CAPTURED.map((item) => item.id)).toEqual(ANNOUNCED.limits);
  });

  it('names a sentence for every category it announces', () => {
    const keys = [...CAPTURED, ...NOT_CAPTURED].flatMap((item: DisclosureItem) => [
      item.title,
      item.body,
    ]);

    for (const key of keys) {
      expect(english[key], `${key} has no English sentence`).toBeTruthy();
    }
  });
});

describe('the privacy policy link', () => {
  it('points at the policy written in the language being read', () => {
    expect(privacyPolicyUrl('fr')).toContain('politique-de-confidentialite');
    expect(privacyPolicyUrl('en')).toContain('privacy-policy');
  });

  /**
   * A language shipped before its policy is published gets the English one. An unreachable link is
   * a missing policy as far as the Web Store is concerned (`deployment.md:33`), which costs more
   * than a policy in the wrong language.
   */
  it('falls back to English rather than to a dead link', () => {
    expect(privacyPolicyUrl('de')).toBe(privacyPolicyUrl('en'));
  });
});
