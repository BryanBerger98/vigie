import { describe, expect, it } from 'vitest';

import {
  KEEPALIVE_CHROME_VERSION,
  chromeMajorVersion,
  deepLayerSupport,
  type BrowserIdentity,
} from './support';

/**
 * The one piece of the deep layer that decides something before any browser is touched, so it is
 * the one piece a unit suite can hold. Everything else in `capture/cdp/` goes through
 * `chrome.debugger`, which has no faithful mock, and is asserted end-to-end.
 *
 * The identities below are real strings, copied from what the browsers actually report. A
 * hand-written `Chrome/118` would pass a parser that a real user agent breaks.
 */

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/** What Chromium hands over: its own two brands, plus one deliberately scrambled entry. */
function brands(version: string): BrowserIdentity['userAgentData'] {
  return {
    brands: [
      { brand: 'Not-A.Brand', version: '99' },
      { brand: 'Chromium', version },
      { brand: 'Google Chrome', version },
    ],
  };
}

describe('reading the major version', () => {
  it('takes it from userAgentData, the surface Chrome intends to keep', () => {
    expect(chromeMajorVersion({ userAgentData: brands('151'), userAgent: CHROME_UA })).toBe(151);
  });

  it('ignores the GREASE brand, whose version is arbitrary by design', () => {
    const greaseOnly = { brands: [{ brand: 'Not/A)Brand', version: '99' }] };

    expect(chromeMajorVersion({ userAgentData: greaseOnly, userAgent: CHROME_UA })).toBe(151);
  });

  it('falls back to the user agent string where userAgentData does not exist', () => {
    expect(chromeMajorVersion({ userAgent: CHROME_UA })).toBe(151);
  });

  it('answers null for a browser that claims no Chrome version', () => {
    const firefox =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:133.0) Gecko/20100101 Firefox/133.0';

    expect(chromeMajorVersion({ userAgent: firefox })).toBeNull();
  });
});

describe('the availability verdict', () => {
  it('supports a browser at the version that keeps the worker alive', () => {
    const version = String(KEEPALIVE_CHROME_VERSION);

    expect(deepLayerSupport({ userAgentData: brands(version), userAgent: CHROME_UA })).toEqual({
      supported: true,
      chromeMajorVersion: KEEPALIVE_CHROME_VERSION,
    });
  });

  it('refuses the version just below it, where an attached session lets the worker die', () => {
    const version = String(KEEPALIVE_CHROME_VERSION - 1);

    expect(deepLayerSupport({ userAgentData: brands(version), userAgent: CHROME_UA })).toEqual({
      supported: false,
      reason: 'below-keepalive',
      chromeMajorVersion: KEEPALIVE_CHROME_VERSION - 1,
    });
  });

  it('refuses a browser it could read no version from, without calling it old', () => {
    expect(deepLayerSupport({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101' })).toEqual(
      { supported: false, reason: 'unknown-browser', chromeMajorVersion: null },
    );
  });
});
