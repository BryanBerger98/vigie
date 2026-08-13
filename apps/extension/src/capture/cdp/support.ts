/**
 * Whether this browser can run the deep network layer at all.
 *
 * The layer is not a feature that degrades: below the threshold it starts, attaches, puts Chrome's
 * banner on every tab, and then cuts itself off the first time the worker goes idle — leaving a
 * user who armed it looking at a capture that stopped without saying so. So the answer is given
 * before anything is armed, and it is given with its reason.
 *
 * The verdict is a pure function of one browser identity, which is what lets it be asserted without
 * a browser. Nothing in this module touches `chrome.*`.
 */

/**
 * The Chrome version from which an attached `chrome.debugger` session keeps the MV3 service worker
 * alive past its 30-second idle timeout.
 *
 * Below it the worker dies under an attached session and Chrome fires no `onDetach` for that death
 * (0 emissions across six provoked deaths), so the layer cannot even tell the user it stopped. The
 * shipped manifest still declares `minimum_chrome_version: 114`, which predates this behaviour:
 * the side panel is what sets the floor for installing Vigie, and the deep layer refuses at
 * runtime rather than making the whole product uninstallable.
 *
 * @see aidd_docs/backlog/spikes/cdp-mv3-feasibility.md
 * @see aidd_docs/backlog/spikes/cdp-service-worker-recovery.md
 */
export const KEEPALIVE_CHROME_VERSION = 118;

/** The slice of `navigator` the verdict reads. Passed in, so the rule is testable on its own. */
export interface BrowserIdentity {
  /** `navigator.userAgentData`, absent outside Chromium and on insecure contexts. */
  userAgentData?: { brands: { brand: string; version: string }[] } | undefined;
  userAgent: string;
}

/** Why the layer cannot run here. Phrased for the user in `entrypoints/popup/state.ts`. */
export type UnsupportedReason =
  /** No Chrome version could be read at all — the browser is not one this layer knows. */
  | 'unknown-browser'
  /** A Chrome older than the version that keeps the worker alive. */
  | 'below-keepalive';

export type DeepLayerSupport =
  | { supported: true; chromeMajorVersion: number }
  | { supported: false; reason: UnsupportedReason; chromeMajorVersion: number | null };

/**
 * The brands Chromium reports for itself, as opposed to the GREASE entry it adds on purpose.
 *
 * `navigator.userAgentData.brands` deliberately carries one brand with a scrambled name and an
 * arbitrary version — `Not-A.Brand`, `;Not A Brand`, the spelling changes between releases — so
 * that nobody writes a parser that breaks on the day a new brand appears. Matching on the two
 * names we actually want is the only reading that survives that.
 */
const CHROMIUM_BRANDS = ['Google Chrome', 'Chromium'];

/** `Chrome/151.0.7922.34` in a user agent string. Edge and Opera carry it too, and behave alike. */
const USER_AGENT_VERSION = /Chrome\/(\d+)/;

/**
 * The major version of Chrome, or `null` when nothing readable says one.
 *
 * `userAgentData` is asked first because it is the surface Chrome intends to keep: the user agent
 * string is frozen and reduced, and a frozen string is a string that will one day stop moving with
 * the browser. It is still read as a fallback because `userAgentData` is absent from every
 * non-Chromium browser and from insecure contexts, and an absent surface must not read as "old".
 */
export function chromeMajorVersion(identity: BrowserIdentity): number | null {
  for (const brand of identity.userAgentData?.brands ?? []) {
    if (!CHROMIUM_BRANDS.includes(brand.brand)) continue;
    const major = Number.parseInt(brand.version, 10);
    if (Number.isFinite(major)) return major;
  }

  const matched = USER_AGENT_VERSION.exec(identity.userAgent);
  if (!matched?.[1]) return null;

  const major = Number.parseInt(matched[1], 10);
  return Number.isFinite(major) ? major : null;
}

/** The verdict, from a browser identity. */
export function deepLayerSupport(identity: BrowserIdentity): DeepLayerSupport {
  const major = chromeMajorVersion(identity);

  if (major === null) {
    return { supported: false, reason: 'unknown-browser', chromeMajorVersion: null };
  }
  if (major < KEEPALIVE_CHROME_VERSION) {
    return { supported: false, reason: 'below-keepalive', chromeMajorVersion: major };
  }
  return { supported: true, chromeMajorVersion: major };
}

/**
 * The verdict for the browser this code is running in.
 *
 * Reachable from the service worker, the popup and the side panel alike: `navigator` exists in all
 * three, and the answer is a property of the browser rather than of the surface asking.
 */
export function currentDeepLayerSupport(): DeepLayerSupport {
  const identity = navigator as Navigator & BrowserIdentity;
  return deepLayerSupport({
    userAgentData: identity.userAgentData,
    userAgent: identity.userAgent,
  });
}
