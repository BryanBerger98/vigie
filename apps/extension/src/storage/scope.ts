/**
 * Whether a URL falls inside the capture scope, and what a watched domain means exactly.
 *
 * Every write the capture layers make goes through `isWatchedUrl`. A false positive here puts
 * traffic on disk that the user never designated, which is the one promise this product makes.
 * So the module stays pure — no `chrome.*`, no storage — and is covered without a browser.
 *
 * Two independent barriers guard the scope. Chrome enforces the granted host permissions and
 * simply never dispatches the rest; this function enforces the watched list. They are expected
 * to agree, and the second one exists because a build variant, a broad grant left over from an
 * earlier version, or a future capture surface can make them disagree.
 */

/**
 * Schemes the product captures. Everything else is out: `file:`, `ftp:`, `data:`, and above all
 * `chrome-extension:` — an extension always sees requests for its own resources, with or without
 * host access, and those are never the user's traffic.
 */
const CAPTURED_PROTOCOLS = new Set(['http:', 'https:']);

/** Dotted-quad literal. Deliberately loose on shape; `isIpv4` checks the ranges. */
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** One DNS label: alphanumeric, inner hyphens allowed, never leading or trailing. */
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';

/** At least two labels, so a bare word is rejected before it can be requested as a permission. */
const DOMAIN_NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

/**
 * The one dotless host that is accepted. Local development is a first-class target for this
 * product, and `localhost` is a valid Chrome match-pattern host.
 */
const LOCALHOST = 'localhost';

function isIpv4(host: string): boolean {
  if (!DOTTED_QUAD.test(host)) return false;
  return host.split('.').every((part) => Number(part) <= 255);
}

/**
 * Case and the trailing root dot carry no meaning in a host name, and `URL` preserves the dot.
 * Normalising both here is what keeps `Example.COM.` and `example.com` from being two entries.
 */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/**
 * Reads a user-typed domain, or `null` when it is not one.
 *
 * A pasted URL is accepted as readily as a bare domain — the address bar is where the user
 * copies from — but only its host is kept: paths, ports and query strings are not part of the
 * scope. Credentials in the input are refused outright rather than silently dropped.
 *
 * Internationalised names come back in their punycode form, which is what Chrome match patterns
 * and `URL.hostname` both speak.
 */
export function parseWatchedDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let host: string;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (url.username || url.password) return null;
    host = normalizeHost(url.hostname);
  } catch {
    return null;
  }

  if (!host) return null;
  if (isIpv4(host)) return host;
  // `URL` hands IPv6 back bracketed, and Chrome match patterns have no syntax for it.
  if (host.startsWith('[')) return null;
  if (host === LOCALHOST) return host;
  return DOMAIN_NAME.test(host) ? host : null;
}

/**
 * The host permission patterns to request for a watched domain.
 *
 * Chrome documents `*.example.com` as matching `example.com` too, but the price of that being
 * wrong is a domain that captures nothing and says nothing, so both patterns are asked for.
 * A literal IP has no subdomains, and `*.1.2.3.4` would be a pattern that never matches.
 *
 * The scheme is left as `*` so http and https are both covered: a site that redirects to https
 * would otherwise fall out of scope halfway through a capture.
 */
export function hostPermissionPatterns(domain: string): string[] {
  if (isIpv4(domain)) return [`*://${domain}/*`];
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}

/**
 * How a watched domain covers a host: the domain itself and every subdomain under it.
 *
 * The comparison is on label boundaries, never on substrings — `notexample.com` ends with
 * `example.com` as a string and is a different site. There is no Public Suffix List here on
 * purpose: the user names the domain they want watched, and the code does not second-guess it.
 * Entering `co.uk` would therefore cover the whole suffix, which the browser's own permission
 * prompt already makes plain.
 */
function hostIsWithin(host: string, domain: string): boolean {
  if (!domain) return false;
  if (host === domain) return true;
  if (isIpv4(domain)) return false;
  return host.endsWith(`.${domain}`);
}

/**
 * Which watched domain covers `url`, or `null` when none does.
 *
 * The answer is the domain rather than a boolean because every stored entry is stamped with it:
 * that stamp is what the erasure of a removed domain deletes by, and reading it back off the URL
 * at erasure time would let a change of the matching rules orphan entries written under the old
 * one. The longest match wins, so watching both `example.com` and `api.example.com` stamps an
 * `api.example.com` request under the more specific of the two.
 *
 * The port plays no part: a watched domain covers every port on it, which is what the granted
 * match pattern does too, and what a developer running the same site on 3000 and 8080 expects.
 */
export function watchedDomainFor(
  url: string,
  watchedDomains: readonly string[],
): string | null {
  if (watchedDomains.length === 0) return null;

  let host: string;
  try {
    const parsed = new URL(url);
    if (!CAPTURED_PROTOCOLS.has(parsed.protocol)) return null;
    host = normalizeHost(parsed.hostname);
  } catch {
    return null;
  }

  let match: string | null = null;
  for (const candidate of watchedDomains) {
    const domain = normalizeHost(candidate);
    if (!hostIsWithin(host, domain)) continue;
    if (match === null || domain.length > match.length) match = domain;
  }
  return match;
}

/** Whether `url` is traffic the user asked to capture. */
export function isWatchedUrl(url: string, watchedDomains: readonly string[]): boolean {
  return watchedDomainFor(url, watchedDomains) !== null;
}
