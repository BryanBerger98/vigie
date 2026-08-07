import { describe, expect, it } from 'vitest';

import { hostPermissionPatterns, isWatchedUrl, parseWatchedDomain } from './scope';

describe('isWatchedUrl', () => {
  const watched = ['example.com'];

  it('matches the watched domain exactly', () => {
    expect(isWatchedUrl('https://example.com/', watched)).toBe(true);
    expect(isWatchedUrl('https://example.com/a/deep/path?q=1#x', watched)).toBe(true);
  });

  it('matches a subdomain of the watched domain', () => {
    expect(isWatchedUrl('https://app.example.com/', watched)).toBe(true);
    expect(isWatchedUrl('https://a.b.c.example.com/', watched)).toBe(true);
  });

  it('does not match a neighbouring domain that merely contains the watched name', () => {
    expect(isWatchedUrl('https://notexample.com/', watched)).toBe(false);
    expect(isWatchedUrl('https://example.com.evil.test/', watched)).toBe(false);
    expect(isWatchedUrl('https://example.community/', watched)).toBe(false);
  });

  it('does not match the parent of the watched domain', () => {
    expect(isWatchedUrl('https://com/', watched)).toBe(false);
    expect(isWatchedUrl('https://example.com/', ['app.example.com'])).toBe(false);
  });

  it('ignores the port', () => {
    expect(isWatchedUrl('http://example.com:8080/', watched)).toBe(true);
    expect(isWatchedUrl('http://example.com:3000/', watched)).toBe(true);
  });

  it('captures http and https, and nothing else', () => {
    expect(isWatchedUrl('http://example.com/', watched)).toBe(true);
    expect(isWatchedUrl('https://example.com/', watched)).toBe(true);
    expect(isWatchedUrl('ftp://example.com/file', watched)).toBe(false);
    expect(isWatchedUrl('ws://example.com/socket', watched)).toBe(false);
    expect(isWatchedUrl('file:///etc/hosts', watched)).toBe(false);
  });

  it('leaves the extension out of its own scope', () => {
    const url = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html';
    expect(isWatchedUrl(url, ['abcdefghijklmnopabcdefghijklmnop'])).toBe(false);
  });

  it('scopes nothing when the watched list is empty', () => {
    expect(isWatchedUrl('https://example.com/', [])).toBe(false);
    expect(isWatchedUrl('https://anything.test/', [])).toBe(false);
  });

  it('ignores case and the trailing root dot on both sides', () => {
    expect(isWatchedUrl('https://EXAMPLE.com/', watched)).toBe(true);
    expect(isWatchedUrl('https://example.com./', watched)).toBe(true);
    expect(isWatchedUrl('https://app.example.com/', ['Example.COM.'])).toBe(true);
  });

  it('matches a literal IP exactly and grants it no subdomains', () => {
    expect(isWatchedUrl('http://127.0.0.1:5173/', ['127.0.0.1'])).toBe(true);
    expect(isWatchedUrl('http://sub.127.0.0.1/', ['127.0.0.1'])).toBe(false);
  });

  it('returns false on a string that is not a URL', () => {
    expect(isWatchedUrl('', watched)).toBe(false);
    expect(isWatchedUrl('example.com', watched)).toBe(false);
    expect(isWatchedUrl('¯\\_(ツ)_/¯', watched)).toBe(false);
  });

  it('matches against any of several watched domains', () => {
    const list = ['example.com', 'other.test'];
    expect(isWatchedUrl('https://api.other.test/', list)).toBe(true);
    expect(isWatchedUrl('https://third.test/', list)).toBe(false);
  });
});

describe('parseWatchedDomain', () => {
  it('keeps a bare domain', () => {
    expect(parseWatchedDomain('example.com')).toBe('example.com');
    expect(parseWatchedDomain('app.example.co.uk')).toBe('app.example.co.uk');
  });

  it('trims, lowercases and drops the trailing root dot', () => {
    expect(parseWatchedDomain('  Example.COM.  ')).toBe('example.com');
  });

  it('keeps only the host of a pasted URL', () => {
    expect(parseWatchedDomain('https://example.com/some/path?q=1')).toBe('example.com');
    expect(parseWatchedDomain('http://example.com:8080')).toBe('example.com');
  });

  it('accepts a literal IPv4 and localhost', () => {
    expect(parseWatchedDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(parseWatchedDomain('http://localhost:5173')).toBe('localhost');
  });

  it('turns an internationalised name into its punycode form', () => {
    expect(parseWatchedDomain('café.fr')).toBe('xn--caf-dma.fr');
  });

  it('refuses what is not a domain', () => {
    expect(parseWatchedDomain('')).toBeNull();
    expect(parseWatchedDomain('   ')).toBeNull();
    expect(parseWatchedDomain('not a domain')).toBeNull();
    expect(parseWatchedDomain('example')).toBeNull();
    expect(parseWatchedDomain('-example.com')).toBeNull();
    expect(parseWatchedDomain('example-.com')).toBeNull();
    expect(parseWatchedDomain('exam_ple.com')).toBeNull();
    expect(parseWatchedDomain('999.999.999.999')).toBeNull();
  });

  it('refuses a wildcard rather than expanding it', () => {
    expect(parseWatchedDomain('*.example.com')).toBeNull();
    expect(parseWatchedDomain('*://example.com/*')).toBeNull();
  });

  it('refuses credentials instead of dropping them', () => {
    expect(parseWatchedDomain('https://user:pass@example.com')).toBeNull();
  });

  it('refuses an IPv6 literal, which has no match-pattern syntax', () => {
    expect(parseWatchedDomain('http://[::1]:8080')).toBeNull();
  });

  it('produces a domain that its own scope check accepts', () => {
    const domain = parseWatchedDomain('https://App.Example.com/dashboard');
    expect(domain).not.toBeNull();
    expect(isWatchedUrl('https://app.example.com/other', [domain!])).toBe(true);
  });
});

describe('hostPermissionPatterns', () => {
  it('asks for the domain and its subdomains, on both schemes', () => {
    expect(hostPermissionPatterns('example.com')).toEqual([
      '*://example.com/*',
      '*://*.example.com/*',
    ]);
  });

  it('asks for a literal IP alone, since it has no subdomains', () => {
    expect(hostPermissionPatterns('127.0.0.1')).toEqual(['*://127.0.0.1/*']);
  });

  it('covers exactly what the scope check considers watched', () => {
    const patterns = hostPermissionPatterns('example.com');
    expect(patterns).toHaveLength(2);
    expect(isWatchedUrl('https://example.com/', ['example.com'])).toBe(true);
    expect(isWatchedUrl('https://app.example.com/', ['example.com'])).toBe(true);
  });
});
