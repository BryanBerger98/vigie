import { SCHEMA_VERSION, type ReportBundle } from '@vigie/contract';
import { describe, expect, it } from 'vitest';

import { reportFilename } from './filename';

/**
 * The name, asserted on the two things it has to get right: where the instant comes from, and what
 * a host is allowed to put in a filename.
 */

/** 2026-08-11T15:39:22.123Z — chosen so the seconds and the local hour cannot be confused. */
const FROZEN_AT = Date.parse('2026-08-11T15:39:22.123Z');

function bundle(domain: string, frozenAt = FROZEN_AT): ReportBundle {
  return {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: '0.1.0',
    window: {
      requestedDepthMinutes: 15,
      frozenAt,
      from: frozenAt - 900_000,
      to: frozenAt,
      coveredDepthMinutes: 15,
    },
    subject: { domain, tabId: 7, url: `https://${domain}/page` },
    gaps: [],
    entries: [],
  };
}

describe('reportFilename', () => {
  it('leads with the domain, which is what a reader recognises in a download list', () => {
    expect(reportFilename(bundle('intranet.twimm.xyz'))).toBe(
      'vigie-intranet.twimm.xyz-2026-08-11-153922.md',
    );
  });

  it('reads the instant off the bundle in UTC, the reference the report itself uses', () => {
    // A local clock would put the file an hour or more from the timestamps inside it.
    expect(reportFilename(bundle('example.com', Date.parse('2026-01-02T03:04:05Z')))).toBe(
      'vigie-example.com-2026-01-02-030405.md',
    );
  });

  it('carries no colon, which macOS and Windows both refuse', () => {
    expect(reportFilename(bundle('example.com'))).not.toContain(':');
  });

  it('folds an uppercase host rather than hyphenating every letter of it', () => {
    expect(reportFilename(bundle('Example.COM'))).toContain('vigie-example.com-');
  });

  it('transliterates an internationalised domain instead of letting it through', () => {
    expect(reportFilename(bundle('münchen.de'))).toContain('vigie-m-nchen.de-');
  });

  it('strips what an IPv6 literal carries and a filesystem forbids', () => {
    expect(reportFilename(bundle('[::1]'))).toBe('vigie----1--2026-08-11-153922.md');
  });
});
