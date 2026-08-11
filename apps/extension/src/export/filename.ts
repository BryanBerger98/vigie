import type { ReportBundle } from '@vigie/contract';

/**
 * The name a report arrives under, and the only thing about it a user reads before opening it.
 *
 * `vigie-<domain>-<YYYY-MM-DD>-<HHMMSS>.md`, in that order. The domain leads because it is what
 * someone recognises in a download list; the instant follows because it is what tells two reports
 * of the same site apart. A prefix that never varies would put every report under `v` and sort them
 * by nothing.
 *
 * ## Why the instant is UTC, and why it comes from the bundle
 *
 * `bundle.window.frozenAt` rather than the clock at click time: the report stamps every line it
 * holds in ISO UTC, and a name in local time would put the file an hour away from its own contents.
 * Two references inside one document is a document that contradicts itself under the reader's eyes.
 *
 * ## Collisions
 *
 * Two exports inside the same second produce the same name, and Chrome resolves it by suffixing
 * `(1)`. Deciding otherwise means the `downloads` permission, which the manifest deliberately does
 * not ask for — so the resolution is the browser's, not ours.
 */

/**
 * Everything outside `[a-z0-9.-]` becomes a hyphen, one for one.
 *
 * The set is what a filename can carry on macOS, Windows and Linux alike. Lowercasing comes first
 * so an uppercase host is transliterated rather than erased into a row of hyphens, and the rule
 * covers the two cases a host can really take: an internationalised domain whose label is not
 * ASCII, and an IPv6 literal whose brackets and colons are forbidden on two of the three systems.
 */
function safeDomain(domain: string): string {
  return domain.toLowerCase().replaceAll(/[^a-z0-9.-]/g, '-');
}

export function reportFilename(bundle: ReportBundle): string {
  const iso = new Date(bundle.window.frozenAt).toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19).replaceAll(':', '');

  return `vigie-${safeDomain(bundle.subject.domain)}-${day}-${time}.md`;
}
