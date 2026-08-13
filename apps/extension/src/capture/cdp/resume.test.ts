import { describe, expect, it } from 'vitest';

import { forgetLostSessions, planResume } from './resume';
import {
  EMPTY_CDP_SESSION_STATE,
  arm,
  cancel,
  withRequestAnnounced,
  withTabAttached,
} from './session-state';

/**
 * The decision a start takes, on its own.
 *
 * Only the pure half is here. Attaching goes through `chrome.debugger`, which has no faithful mock,
 * and is asserted in `e2e/specs/cdp-resume.spec.ts` against a worker that was really killed.
 */

const armedWithTwoTabs = withTabAttached(withTabAttached(arm(EMPTY_CDP_SESSION_STATE), 7), 9);

describe('deciding whether to resume', () => {
  it('resumes an armed layer and hands back the tabs the dead generation believed it held', () => {
    expect(planResume(armedWithTwoTabs)).toEqual({ resume: true, lostTabs: [7, 9] });
  });

  it('resumes an armed layer that held nothing, so a tab arriving later still gets a session', () => {
    expect(planResume(arm(EMPTY_CDP_SESSION_STATE))).toEqual({ resume: true, lostTabs: [] });
  });

  it('refuses when the layer was never armed', () => {
    expect(planResume(EMPTY_CDP_SESSION_STATE)).toEqual({ resume: false, reason: 'never-armed' });
  });

  it('refuses after the banner was cancelled, and says so rather than calling it an absence', () => {
    expect(planResume(cancel())).toEqual({ resume: false, reason: 'canceled-by-user' });
  });

  it('refuses on a cancelled state still claiming to be armed, tabs and all', () => {
    expect(planResume({ ...armedWithTwoTabs, canceledByUser: true })).toEqual({
      resume: false,
      reason: 'canceled-by-user',
    });
  });
});

describe('forgetting what the death took', () => {
  it('drops the attached tabs and the in-flight requests', () => {
    const running = withRequestAnnounced(armedWithTwoTabs, '4.7', 'https://a.test/api');

    expect(forgetLostSessions(running)).toMatchObject({ attachedTabs: [], inFlight: {} });
  });

  it('keeps the user decision: a death revokes nothing the user said', () => {
    const cancelled = { ...armedWithTwoTabs, canceledByUser: true };

    expect(forgetLostSessions(armedWithTwoTabs).armed).toBe(true);
    expect(forgetLostSessions(cancelled).canceledByUser).toBe(true);
  });
});
