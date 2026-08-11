import { reportGap, type ReportBundle } from '@vigie/contract';
import { describe, expect, it } from 'vitest';

import { RETENTION_MS } from '@/storage/prune';

import {
  DEFAULT_EXPORT_DEPTH_MINUTES,
  IDLE_FEEDBACK,
  depthAvailability,
  downloadAcknowledgement,
  exportFailure,
  resolveCurrentDepth,
  scopeStatus,
  tabContextLine,
  workingFeedback,
  type PopupFacts,
} from './state';

/**
 * The three answers the popup gives before anything else happens: which state the tab is in,
 * which depths can be clicked, and what the user is told they took away.
 *
 * Asserted on the sentences rather than on flags. The wording *is* the deliverable here — a state
 * rendered without naming itself is the failure `design.md:21` is about — so a test that only
 * checked a discriminant would pass on a popup that says nothing.
 */

const NOW = 1_770_000_000_000;

function facts(overrides: Partial<PopupFacts> = {}): PopupFacts {
  return {
    subject: { tabId: 7, url: 'https://app.example.com/dashboard', host: 'app.example.com' },
    watchedDomain: 'example.com',
    hostAccess: true,
    tabEntryCount: 42,
    coveredMinutes: 60,
    shrunkAt: null,
    now: NOW,
    ...overrides,
  };
}

describe('scopeStatus', () => {
  it('names the domain it offers to watch when the tab is out of scope', () => {
    const status = scopeStatus(facts({ watchedDomain: null }));

    expect(status.kind).toBe('out-of-scope');
    expect(status.offerDomain).toBe('app.example.com');
    expect(status.detail).toContain('app.example.com');
  });

  it('offers nothing to watch when the window holds no web page', () => {
    const status = scopeStatus(facts({ subject: null, watchedDomain: null }));

    expect(status.kind).toBe('no-subject');
    expect(status.offerDomain).toBeNull();
  });

  it('says which half of the scope broke when the host access was revoked', () => {
    const status = scopeStatus(facts({ hostAccess: false }));

    expect(status.kind).toBe('degraded');
    expect(status.label).toContain('host access');
    expect(status.detail).toContain('no longer grants access');
  });

  it('says which half of the scope broke when the quota shortened the window', () => {
    const status = scopeStatus(facts({ coveredMinutes: 22, shrunkAt: NOW - 60_000 }));

    expect(status.kind).toBe('degraded');
    expect(status.label).toContain('shortened');
    expect(status.detail).toContain('22 min');
  });

  it('ignores a shrink older than the window it shortened', () => {
    const status = scopeStatus(facts({ shrunkAt: NOW - RETENTION_MS - 1 }));

    expect(status.kind).toBe('capturing');
  });

  it('states the volume held for the tab while capturing', () => {
    expect(scopeStatus(facts({ tabEntryCount: 1 })).detail).toContain('1 entry');
    expect(scopeStatus(facts({ tabEntryCount: 42 })).detail).toContain('42 entries');
  });

  // Every state carries its own words, so none of them can be told apart by colour alone.
  it('gives each state a label of its own', () => {
    const labels = [
      scopeStatus(facts({ subject: null })),
      scopeStatus(facts({ watchedDomain: null })),
      scopeStatus(facts()),
      scopeStatus(facts({ hostAccess: false })),
    ].map((status) => status.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => label.length > 0)).toBe(true);
  });
});

describe('depthAvailability', () => {
  it('keeps the shallowest tier clickable on an empty store', () => {
    const [five, ...rest] = depthAvailability(0);

    expect(five).toEqual({ depthMinutes: 5, enabled: true, reason: null });
    expect(rest.every((depth) => !depth.enabled)).toBe(true);
  });

  it('lets a depth be asked for beyond what is covered, so the answer can say so', () => {
    // Forty minutes held: sixty is still a legitimate question, answered with forty.
    expect(depthAvailability(40).find((depth) => depth.depthMinutes === 60)?.enabled).toBe(true);
  });

  it('disables a tier the capture has not reached the previous one of, and says why', () => {
    const thirty = depthAvailability(4).find((depth) => depth.depthMinutes === 30);

    expect(thirty?.enabled).toBe(false);
    expect(thirty?.reason).toBe('needs 15 min of capture, 4 min held');
  });

  it('opens every tier once the store reaches the deepest threshold', () => {
    expect(depthAvailability(30).every((depth) => depth.enabled)).toBe(true);
  });
});

describe('resolveCurrentDepth', () => {
  it('opens on the shallowest tier before anything has ever been exported', () => {
    expect(resolveCurrentDepth(null, depthAvailability(60))).toBe(DEFAULT_EXPORT_DEPTH_MINUTES);
    expect(DEFAULT_EXPORT_DEPTH_MINUTES).toBe(5);
  });

  it('takes the remembered tier back as it is while the store can honour it', () => {
    expect(resolveCurrentDepth(30, depthAvailability(60))).toBe(30);
  });

  // A purge, or a browser restarted minutes ago: the habit is out of reach, not forgotten.
  it('falls back to the deepest tier still reachable when the remembered one is not', () => {
    expect(resolveCurrentDepth(60, depthAvailability(20))).toBe(30);
  });

  it('lands on the shallowest tier when the store holds nothing at all', () => {
    expect(resolveCurrentDepth(60, depthAvailability(0))).toBe(5);
  });
});

describe('tabContextLine', () => {
  it('announces an empty window before anything is clicked', () => {
    expect(tabContextLine(facts({ tabEntryCount: 0 }))).toContain('nothing captured on this tab');
  });

  it('states the domain, the tab and the depth really available', () => {
    const line = tabContextLine(facts({ coveredMinutes: 12.42 }));

    expect(line).toContain('example.com');
    expect(line).toContain('tab 7');
    expect(line).toContain('12.4 min available');
  });
});

function bundle(overrides: Partial<ReportBundle['window']> = {}, entries = 3): ReportBundle {
  return {
    schemaVersion: 1,
    extensionVersion: '0.0.0',
    window: {
      requestedDepthMinutes: 15,
      frozenAt: NOW,
      from: NOW - 15 * 60_000,
      to: NOW,
      coveredDepthMinutes: 15,
      ...overrides,
    },
    subject: { domain: 'example.com', tabId: 7, url: 'https://example.com/' },
    gaps: [reportGap('response-bodies-unavailable')],
    entries: Array.from({ length: entries }, (_, index) => ({
      kind: 'console' as const,
      timestamp: NOW - index,
      tabId: 7,
      domain: 'example.com',
      level: 'log' as const,
      text: 'x',
      truncated: false,
    })),
  };
}

const FILENAME = 'vigie-example.com-2026-02-02-000000.md';

describe('downloadAcknowledgement', () => {
  it('leads with the filename, the one thing that makes a download list navigable', () => {
    const view = downloadAcknowledgement(bundle(), FILENAME, { ok: true });

    expect(view.kind).toBe('downloaded');
    expect(view.headline).toBe(`Saved ${FILENAME}`);
  });

  it('says how much left in the file, since the name says nothing about it', () => {
    expect(downloadAcknowledgement(bundle(), FILENAME, { ok: true }).detail).toContain('3 entries.');
  });

  it('stays quiet about the depth when it is the one that was asked for', () => {
    expect(downloadAcknowledgement(bundle(), FILENAME, { ok: true }).detail).not.toContain(
      'not the 15 min',
    );
  });

  it('announces the delivered depth when it is shorter than the one requested', () => {
    const view = downloadAcknowledgement(
      bundle({ requestedDepthMinutes: 60, coveredDepthMinutes: 22.36 }),
      FILENAME,
      { ok: true },
    );

    expect(view.detail).toContain('covers 22.4 min, not the 60 min asked');
  });

  it('says the file is empty rather than letting a name pass for a report', () => {
    const view = downloadAcknowledgement(bundle({}, 0), FILENAME, { ok: true });

    expect(view.detail).toContain('last 15 min');
    expect(view.detail).toContain('the report is empty');
  });

  it('summarises the gaps the report declares', () => {
    expect(downloadAcknowledgement(bundle(), FILENAME, { ok: true }).detail).toContain(
      'Declared in the report: no response bodies.',
    );
  });

  it('reports a refused write instead of a file', () => {
    const view = downloadAcknowledgement(bundle(), FILENAME, {
      ok: false,
      reason: 'blocked by policy',
    });

    expect(view.kind).toBe('failed');
    expect(view.headline).toBe('Not saved');
    expect(view.detail).toContain('blocked by policy');
  });

  it('never names a file on a refusal, whichever line a reader lands on', () => {
    const view = downloadAcknowledgement(bundle(), FILENAME, {
      ok: false,
      reason: 'blocked by policy',
    });

    expect(`${view.headline} ${view.detail}`).not.toContain(FILENAME);
  });
});

describe('the states that surround an acknowledgement', () => {
  it('opens on nothing exported, rather than on a line that could be read as a receipt', () => {
    expect(IDLE_FEEDBACK.kind).toBe('idle');
    expect(IDLE_FEEDBACK.headline).toBe('Nothing exported yet');
  });

  it('names the depth being cut while the export runs', () => {
    const view = workingFeedback(30);

    expect(view.kind).toBe('working');
    expect(view.headline).toContain('30 min');
  });

  it('carries a failed export as a failure, not as an acknowledgement', () => {
    const view = exportFailure('the worker never answered');

    expect(view.kind).toBe('failed');
    expect(view.detail).toBe('the worker never answered');
  });
});
