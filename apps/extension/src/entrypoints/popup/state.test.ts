import { GAP_STATEMENTS, reportGap, type ReportBundle } from '@vigie/contract';
import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from '@/i18n/registry';
import { createTranslator } from '@/i18n/translate';
import { RETENTION_MS } from '@/storage/prune';

import {
  DEFAULT_EXPORT_DEPTH_MINUTES,
  deepLayerView,
  depthAvailability,
  downloadAcknowledgement,
  exportFailure,
  idleFeedback,
  interruptionNotice,
  isDeepLayerFailure,
  resolveCurrentDepth,
  scopeStatus,
  tabContextLine,
  workingFeedback,
  type DeepLayerFacts,
  type PopupFacts,
} from './state';

/**
 * The three answers the popup gives before anything else happens: which state the tab is in,
 * which depths can be clicked, and what the user is told they took away.
 *
 * Asserted on the sentences rather than on flags. The wording *is* the deliverable here — a state
 * rendered without naming itself is the failure `design.md:21` is about — so a test that only
 * checked a discriminant would pass on a popup that says nothing.
 *
 * The sentences now come from a catalog, so every case builds a translator instead of reading a
 * literal. English is the one asserted, because it is the catalog `MessageKey` is cut from: a key
 * these tests reach that no catalog holds fails to compile long before it fails to render.
 */

const t = createTranslator(DEFAULT_LOCALE);

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
    const status = scopeStatus(facts({ watchedDomain: null }), t);

    expect(status.kind).toBe('out-of-scope');
    expect(status.offerDomain).toBe('app.example.com');
    expect(status.detail).toContain('app.example.com');
  });

  it('offers nothing to watch when the window holds no web page', () => {
    const status = scopeStatus(facts({ subject: null, watchedDomain: null }), t);

    expect(status.kind).toBe('no-subject');
    expect(status.offerDomain).toBeNull();
  });

  it('says which half of the scope broke when the host access was revoked', () => {
    const status = scopeStatus(facts({ hostAccess: false }), t);

    expect(status.kind).toBe('degraded');
    expect(status.label).toContain('host access');
    expect(status.detail).toContain('no longer grants access');
  });

  it('says which half of the scope broke when the quota shortened the window', () => {
    const status = scopeStatus(facts({ coveredMinutes: 22, shrunkAt: NOW - 60_000 }), t);

    expect(status.kind).toBe('degraded');
    expect(status.label).toContain('shortened');
    expect(status.detail).toContain('22 min');
  });

  it('ignores a shrink older than the window it shortened', () => {
    const status = scopeStatus(facts({ shrunkAt: NOW - RETENTION_MS - 1 }), t);

    expect(status.kind).toBe('capturing');
  });

  it('states the volume held for the tab while capturing', () => {
    expect(scopeStatus(facts({ tabEntryCount: 1 }), t).detail).toContain('1 entry');
    expect(scopeStatus(facts({ tabEntryCount: 42 }), t).detail).toContain('42 entries');
  });

  // Every state carries its own words, so none of them can be told apart by colour alone.
  it('gives each state a label of its own', () => {
    const labels = [
      scopeStatus(facts({ subject: null }), t),
      scopeStatus(facts({ watchedDomain: null }), t),
      scopeStatus(facts(), t),
      scopeStatus(facts({ hostAccess: false }), t),
    ].map((status) => status.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => label.length > 0)).toBe(true);
  });

  // The plural rule is the locale's, not the count's: French says "1 entrée" where English says
  // "1 entry", and neither of them is reached by a `count === 1` written in this module.
  it('follows the locale for the singular, on the same facts', () => {
    const french = createTranslator('fr');

    expect(scopeStatus(facts({ tabEntryCount: 1 }), french).detail).toContain('1 entrée captée');
    expect(scopeStatus(facts({ tabEntryCount: 42 }), french).detail).toContain('42 entrées captées');
  });
});

describe('depthAvailability', () => {
  it('keeps the shallowest tier clickable on an empty store', () => {
    const [five, ...rest] = depthAvailability(0, t);

    expect(five).toEqual({ depthMinutes: 5, enabled: true, reason: null });
    expect(rest.every((depth) => !depth.enabled)).toBe(true);
  });

  it('lets a depth be asked for beyond what is covered, so the answer can say so', () => {
    // Forty minutes held: sixty is still a legitimate question, answered with forty.
    expect(depthAvailability(40, t).find((depth) => depth.depthMinutes === 60)?.enabled).toBe(true);
  });

  it('disables a tier the capture has not reached the previous one of, and says why', () => {
    const thirty = depthAvailability(4, t).find((depth) => depth.depthMinutes === 30);

    expect(thirty?.enabled).toBe(false);
    expect(thirty?.reason).toBe('needs 15 min of capture, 4 min held');
  });

  it('opens every tier once the store reaches the deepest threshold', () => {
    expect(depthAvailability(30, t).every((depth) => depth.enabled)).toBe(true);
  });
});

describe('resolveCurrentDepth', () => {
  it('opens on the shallowest tier before anything has ever been exported', () => {
    expect(resolveCurrentDepth(null, depthAvailability(60, t))).toBe(DEFAULT_EXPORT_DEPTH_MINUTES);
    expect(DEFAULT_EXPORT_DEPTH_MINUTES).toBe(5);
  });

  it('takes the remembered tier back as it is while the store can honour it', () => {
    expect(resolveCurrentDepth(30, depthAvailability(60, t))).toBe(30);
  });

  // A purge, or a browser restarted minutes ago: the habit is out of reach, not forgotten.
  it('falls back to the deepest tier still reachable when the remembered one is not', () => {
    expect(resolveCurrentDepth(60, depthAvailability(20, t))).toBe(30);
  });

  it('lands on the shallowest tier when the store holds nothing at all', () => {
    expect(resolveCurrentDepth(60, depthAvailability(0, t))).toBe(5);
  });
});

describe('tabContextLine', () => {
  it('announces an empty window before anything is clicked', () => {
    expect(tabContextLine(facts({ tabEntryCount: 0 }), t)).toContain('nothing captured on this tab');
  });

  it('states the domain, the tab and the depth really available', () => {
    const line = tabContextLine(facts({ coveredMinutes: 12.42 }), t);

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
    const view = downloadAcknowledgement(bundle(), FILENAME, { ok: true }, t);

    expect(view.kind).toBe('downloaded');
    expect(view.headline).toBe(`Saved ${FILENAME}`);
  });

  it('says how much left in the file, since the name says nothing about it', () => {
    expect(downloadAcknowledgement(bundle(), FILENAME, { ok: true }, t).detail).toContain(
      '3 entries.',
    );
  });

  it('stays quiet about the depth when it is the one that was asked for', () => {
    expect(downloadAcknowledgement(bundle(), FILENAME, { ok: true }, t).detail).not.toContain(
      'not the 15 min',
    );
  });

  it('announces the delivered depth when it is shorter than the one requested', () => {
    const view = downloadAcknowledgement(
      bundle({ requestedDepthMinutes: 60, coveredDepthMinutes: 22.36 }),
      FILENAME,
      { ok: true },
      t,
    );

    expect(view.detail).toContain('covers 22.4 min, not the 60 min asked');
  });

  it('says the file is empty rather than letting a name pass for a report', () => {
    const view = downloadAcknowledgement(bundle({}, 0), FILENAME, { ok: true }, t);

    expect(view.detail).toContain('last 15 min');
    expect(view.detail).toContain('the report is empty');
  });

  it('summarises the gaps the report declares', () => {
    expect(downloadAcknowledgement(bundle(), FILENAME, { ok: true }, t).detail).toContain(
      'Declared in the report: no response bodies without the deep layer.',
    );
  });

  /**
   * The one place the two audiences of a gap are visible at once.
   *
   * The report is read by whoever it is handed to and stays English (`prd.md:55`); the popup is read
   * by whoever exported it and follows the chosen language. Same capture, same `GapKind`, two
   * wordings — and the summary is keyed on the kind, so a French popup never reaches the English
   * `GAP_SUMMARIES` to build it.
   */
  it('summarises a gap in the interface language while the report keeps its English statement', () => {
    const report = bundle();
    const view = downloadAcknowledgement(report, FILENAME, { ok: true }, createTranslator('fr'));

    expect(view.detail).toContain('aucun corps de réponse sans la capture profonde');
    expect(report.gaps[0]?.statement).toBe(GAP_STATEMENTS['response-bodies-unavailable']);
    expect(report.gaps[0]?.statement).toContain('Response bodies are not included');
  });

  it('reports a refused write instead of a file', () => {
    const view = downloadAcknowledgement(
      bundle(),
      FILENAME,
      {
        ok: false,
        reason: 'blocked by policy',
      },
      t,
    );

    expect(view.kind).toBe('failed');
    expect(view.headline).toBe('Not saved');
    expect(view.detail).toContain('blocked by policy');
  });

  it('never names a file on a refusal, whichever line a reader lands on', () => {
    const view = downloadAcknowledgement(
      bundle(),
      FILENAME,
      {
        ok: false,
        reason: 'blocked by policy',
      },
      t,
    );

    expect(`${view.headline} ${view.detail}`).not.toContain(FILENAME);
  });
});

describe('the states that surround an acknowledgement', () => {
  it('opens on nothing exported, rather than on a line that could be read as a receipt', () => {
    expect(idleFeedback(t).kind).toBe('idle');
    expect(idleFeedback(t).headline).toBe('Nothing exported yet');
  });

  it('names the depth being cut while the export runs', () => {
    const view = workingFeedback(30, t);

    expect(view.kind).toBe('working');
    expect(view.headline).toContain('30 min');
  });

  it('carries a failed export as a failure, not as an acknowledgement', () => {
    const view = exportFailure('the worker never answered', t);

    expect(view.kind).toBe('failed');
    expect(view.detail).toBe('the worker never answered');
  });
});

/**
 * The deep layer's four states, asserted on what each one tells the user.
 *
 * The layer is the one capability that costs something visible — a permission, and Chrome's banner
 * on every tab of the profile — so a state that renders without naming that price is the failure
 * here, not a wrong discriminant. Two states are especially close and must not read alike: `stopped`
 * is a layer nobody armed, `canceled` is a layer the user refused, and telling them apart is what
 * keeps the extension from re-attaching over a click that asked it to stop.
 */

function deepLayerFacts(overrides: Partial<DeepLayerFacts> = {}): DeepLayerFacts {
  return {
    support: { supported: true, chromeMajorVersion: 151 },
    armed: false,
    canceledByUser: false,
    attachedTabs: 0,
    ...overrides,
  };
}

describe('deepLayerView', () => {
  it('names the Chrome the layer needs, and offers nothing to click, below the threshold', () => {
    const view = deepLayerView(
      deepLayerFacts({
        support: { supported: false, reason: 'below-keepalive', chromeMajorVersion: 116 },
      }),
      t,
    );

    expect(view.kind).toBe('unavailable');
    expect(view.detail).toContain('116');
    expect(view.detail).toContain('118');
    expect(view.action).toBeNull();
  });

  it('says the rest of the capture keeps working when the browser is not a Chrome', () => {
    const view = deepLayerView(
      deepLayerFacts({
        support: { supported: false, reason: 'unknown-browser', chromeMajorVersion: null },
      }),
      t,
    );

    expect(view.kind).toBe('unavailable');
    expect(view.detail).toContain('Everything else keeps working');
    expect(view.action).toBeNull();
  });

  it('states the price before it is paid rather than after', () => {
    const view = deepLayerView(deepLayerFacts(), t);

    expect(view.kind).toBe('stopped');
    expect(view.detail).toContain('banner');
    expect(view.action).toEqual({ label: 'Start deep capture', intent: 'start' });
  });

  it('counts the tabs it is running on, in the singular when there is one', () => {
    const running = deepLayerView(deepLayerFacts({ armed: true, attachedTabs: 3 }), t);
    const alone = deepLayerView(deepLayerFacts({ armed: true, attachedTabs: 1 }), t);

    expect(running.kind).toBe('active');
    expect(running.detail).toContain('3 watched tabs');
    expect(running.action).toEqual({ label: 'Stop deep capture', intent: 'stop' });
    expect(alone.detail).toContain('1 watched tab.');
  });

  it('reads as a refusal rather than as an off switch after a cancellation', () => {
    const canceled = deepLayerView(deepLayerFacts({ armed: true, canceledByUser: true }), t);
    const stopped = deepLayerView(deepLayerFacts(), t);

    expect(canceled.kind).toBe('canceled');
    expect(canceled.label).not.toBe(stopped.label);
    expect(canceled.detail).toContain('Nothing will re-attach on its own');
    // The mark blocks the extension, never the user: the way back is one click, from here.
    expect(canceled.action).toEqual({ label: 'Start deep capture', intent: 'start' });
  });
});

describe('interruptionNotice', () => {
  it('says nothing when nothing was interrupted, which is every ordinary opening', () => {
    expect(interruptionNotice(false, t)).toBeNull();
  });

  it('says the two things it owes: the update, and the capture it stopped', () => {
    const notice = interruptionNotice(true, t);

    expect(notice?.label).toBe('Capture interrupted');
    expect(notice?.detail).toContain('updated');
    expect(notice?.detail).toContain('stopped the capture');
  });

  it('claims nothing about what happens next: the deep layer block below answers that', () => {
    const notice = interruptionNotice(true, t);

    for (const promise of ['resum', 're-attach', 'restart', 'again']) {
      expect(notice?.detail.toLowerCase()).not.toContain(promise);
    }
  });
});

describe('isDeepLayerFailure', () => {
  it('reads the worker\'s error answer, which is what the click has to surface', () => {
    expect(isDeepLayerFailure({ error: 'Another debugger is already attached' })).toBe(true);
  });

  it('leaves the success answer alone: the session state is not a failure', () => {
    expect(isDeepLayerFailure({ armed: true, attachedTabs: [7], inFlight: {} })).toBe(false);
  });

  it('holds against the answers a dead worker gives, none of which carry an error string', () => {
    for (const answer of [undefined, null, 'error', 42, { error: 500 }]) {
      expect(isDeepLayerFailure(answer)).toBe(false);
    }
  });
});
