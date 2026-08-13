import { beforeEach, describe, expect, it } from 'vitest';

import {
  CDP_SESSION_STATE_KEY,
  EMPTY_CDP_SESSION_STATE,
  arm,
  cancel,
  markCaptureInterrupted,
  mayAttach,
  parseSessionState,
  readCdpSessionState,
  stop,
  takeCaptureInterrupted,
  updateCdpSessionState,
  withRequestAnnounced,
  withRequestConcluded,
  withTabAttached,
  withTabDetached,
  type CdpSessionState,
  type SessionArea,
} from './session-state';

/**
 * The transitions, asserted on their own.
 *
 * Nothing here touches `chrome.debugger`, which has no faithful mock — what is being checked is the
 * rule the layer consults before it attaches anything, and that rule has to hold across a worker
 * death nobody is notified of.
 */

/** `chrome.storage.session` reduced to what the module asks of it, plus a lens on what it holds. */
function fakeArea(): SessionArea & { held: () => CdpSessionState | undefined } {
  const items = new Map<string, unknown>();

  return {
    get: (key) => Promise.resolve(items.has(key) ? { [key]: items.get(key) } : {}),
    set: (entries) => {
      for (const [key, value] of Object.entries(entries)) items.set(key, value);
      return Promise.resolve();
    },
    held: () => items.get(CDP_SESSION_STATE_KEY) as CdpSessionState | undefined,
  };
}

let area: ReturnType<typeof fakeArea>;

beforeEach(() => {
  area = fakeArea();
});

describe('arming and stopping', () => {
  it('arms the layer', () => {
    expect(arm(EMPTY_CDP_SESSION_STATE)).toMatchObject({ armed: true, canceledByUser: false });
  });

  it('remembers nothing of a voluntary stop: a stop is not a refusal', () => {
    const running = withTabAttached(arm(EMPTY_CDP_SESSION_STATE), 7);

    expect(stop()).toEqual(EMPTY_CDP_SESSION_STATE);
    expect(running.attachedTabs).toEqual([7]);
  });

  it('marks a cancellation and drops every session at once, the way Chrome does', () => {
    expect(cancel()).toEqual({ ...EMPTY_CDP_SESSION_STATE, canceledByUser: true });
  });

  it('lets the user arm again after refusing the banner, which clears the mark', () => {
    expect(arm(cancel())).toMatchObject({ armed: true, canceledByUser: false });
  });
});

describe('the guard on an attach nobody asked for', () => {
  it('refuses while the layer is not armed', () => {
    expect(mayAttach(EMPTY_CDP_SESSION_STATE)).toBe(false);
  });

  it('allows it once armed', () => {
    expect(mayAttach(arm(EMPTY_CDP_SESSION_STATE))).toBe(true);
  });

  it('refuses after a cancellation, even on a state still claiming to be armed', () => {
    expect(mayAttach({ ...arm(EMPTY_CDP_SESSION_STATE), canceledByUser: true })).toBe(false);
  });
});

describe('the attached tabs', () => {
  it('takes one in, and takes it in once', () => {
    const state = withTabAttached(withTabAttached(EMPTY_CDP_SESSION_STATE, 7), 7);

    expect(state.attachedTabs).toEqual([7]);
  });

  it('drops one without touching the others', () => {
    const state = withTabAttached(withTabAttached(EMPTY_CDP_SESSION_STATE, 7), 9);

    expect(withTabDetached(state, 7).attachedTabs).toEqual([9]);
  });

  it('drops one that was never there rather than failing', () => {
    expect(withTabDetached(EMPTY_CDP_SESSION_STATE, 7).attachedTabs).toEqual([]);
  });
});

describe('the in-flight map', () => {
  it('names a request by its url and forgets it once concluded', () => {
    const announced = withRequestAnnounced(EMPTY_CDP_SESSION_STATE, '4.7', 'https://a.test/api');

    expect(announced.inFlight).toEqual({ '4.7': 'https://a.test/api' });
    expect(withRequestConcluded(announced, '4.7').inFlight).toEqual({});
  });

  it('leaves a request it never announced alone', () => {
    expect(withRequestConcluded(EMPTY_CDP_SESSION_STATE, 'unknown')).toEqual(
      EMPTY_CDP_SESSION_STATE,
    );
  });
});

describe('reading back what was stored', () => {
  it('answers an empty state for anything unreadable', () => {
    for (const stored of [undefined, null, 'armed', 42, []]) {
      expect(parseSessionState(stored)).toEqual(EMPTY_CDP_SESSION_STATE);
    }
  });

  it('keeps the cancellation mark even when the rest of the shape is wrong', () => {
    const parsed = parseSessionState({ attachedTabs: 'seven', inFlight: 3, canceledByUser: true });

    expect(parsed).toEqual({ ...EMPTY_CDP_SESSION_STATE, canceledByUser: true });
  });

  it('drops tab ids and urls that are not what they claim to be', () => {
    const parsed = parseSessionState({
      armed: true,
      attachedTabs: [7, '9', 7, 1.5, 11],
      inFlight: { '4.7': 'https://a.test/api', '4.8': null },
    });

    expect(parsed.attachedTabs).toEqual([7, 11]);
    expect(parsed.inFlight).toEqual({ '4.7': 'https://a.test/api' });
  });
});

describe('the storage round trip', () => {
  it('reads an empty state from a store that holds nothing', async () => {
    expect(await readCdpSessionState(area)).toEqual(EMPTY_CDP_SESSION_STATE);
  });

  it('writes what the change produced and hands it back', async () => {
    const written = await updateCdpSessionState((state) => withTabAttached(arm(state), 7), area);

    expect(written).toMatchObject({ armed: true, attachedTabs: [7] });
    expect(area.held()).toEqual(written);
  });

  it('serialises concurrent updates, so six attaches leave six tabs', async () => {
    await updateCdpSessionState(arm, area);
    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((tabId) =>
        updateCdpSessionState((state) => withTabAttached(state, tabId), area),
      ),
    );

    expect((await readCdpSessionState(area)).attachedTabs).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('the interruption mark', () => {
  it('answers no interruption from a store that holds nothing', async () => {
    expect(await takeCaptureInterrupted(area)).toBe(false);
  });

  it('is read once and gone the next time, so the notice is not shown twice', async () => {
    await markCaptureInterrupted(area);

    expect(await takeCaptureInterrupted(area)).toBe(true);
    expect(await takeCaptureInterrupted(area)).toBe(false);
  });

  it('survives the transitions that answer a whole new state', async () => {
    await markCaptureInterrupted(area);
    await updateCdpSessionState(arm, area);
    await updateCdpSessionState(() => cancel(), area);
    await updateCdpSessionState(() => stop(), area);

    expect(await takeCaptureInterrupted(area)).toBe(true);
  });
});
