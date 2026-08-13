import { beforeEach, describe, expect, it } from 'vitest';

import { SessionWindows, decideOwner, type SessionWindow } from './ownership';

/**
 * The ownership rule decides, with no shared key, which of two layers writes the entry for one
 * request. Everything it can get wrong is a boundary — a request that starts just before a session,
 * ends just after it, or belongs to no tab at all — so the boundaries are what this file states.
 */

const OPENED = 1_000_000;

function asked(startedAt: number, window: SessionWindow | undefined, tabId = 7) {
  return decideOwner({ tabId, startedAt, window });
}

describe('a tab under a live session', () => {
  const live: SessionWindow = { openedAt: OPENED };

  it('gives the deep layer every request that started inside the window', () => {
    expect(asked(OPENED + 10, live)).toEqual({ owner: 'cdp', boundary: false });
  });

  it('counts a request opened at the same instant as inside', () => {
    expect(asked(OPENED, live)).toEqual({ owner: 'cdp', boundary: false });
  });

  it('leaves a request already in flight when the session opened to webRequest', () => {
    // CDP never announced it, so it holds no record for it either: handed back whole, and reported
    // as a boundary all the same. Its neighbours on this tab carry bodies and it cannot, which is
    // the one thing a reader would otherwise read as a missing rendering.
    expect(asked(OPENED - 1, live)).toEqual({ owner: 'webRequest', boundary: true });
  });
});

describe('a tab whose session has closed', () => {
  const closed: SessionWindow = { openedAt: OPENED, closedAt: OPENED + 100 };

  it('hands a request the session was holding back, and says it straddled the end', () => {
    expect(asked(OPENED + 50, closed)).toEqual({ owner: 'webRequest', boundary: true });
  });

  it('does not mark a request that started after the close', () => {
    expect(asked(OPENED + 200, closed)).toEqual({ owner: 'webRequest', boundary: false });
  });

  it('marks a request that started before the session, on the opening side', () => {
    expect(asked(OPENED - 1, closed)).toEqual({ owner: 'webRequest', boundary: true });
  });
});

describe('a request no session can cover', () => {
  it('belongs to webRequest when the tab never held a window', () => {
    expect(asked(OPENED, undefined)).toEqual({ owner: 'webRequest', boundary: false });
  });

  it('belongs to webRequest when there is no tab', () => {
    // A page's service worker emits requests against `tabId: -1`. Nothing can be attached to that.
    expect(asked(OPENED + 10, { openedAt: OPENED }, -1)).toEqual({
      owner: 'webRequest',
      boundary: false,
    });
  });
});

describe('the windows', () => {
  let windows: SessionWindows;

  beforeEach(() => {
    windows = new SessionWindows();
  });

  it('reports a tab live only between its open and its close', () => {
    expect(windows.isLive(7)).toBe(false);

    windows.open(7, OPENED);
    expect(windows.isLive(7)).toBe(true);

    windows.close(7, OPENED + 100);
    expect(windows.isLive(7)).toBe(false);
    expect(windows.of(7)).toEqual({ openedAt: OPENED, closedAt: OPENED + 100 });
  });

  it('keeps the first close, so a second detach cannot move the boundary', () => {
    windows.open(7, OPENED);
    windows.close(7, OPENED + 100);
    windows.close(7, OPENED + 500);

    expect(windows.of(7)?.closedAt).toBe(OPENED + 100);
  });

  it('ignores a close on a tab it never opened', () => {
    windows.close(9, OPENED);

    expect(windows.of(9)).toBeUndefined();
    expect(windows.size).toBe(0);
  });

  it('opens what the attachment list holds and closes what it dropped', () => {
    windows.reconcile([7, 8], OPENED);
    expect(windows.isLive(7)).toBe(true);
    expect(windows.isLive(8)).toBe(true);

    windows.reconcile([8, 9], OPENED + 100);
    expect(windows.of(7)).toEqual({ openedAt: OPENED, closedAt: OPENED + 100 });
    expect(windows.of(8)).toEqual({ openedAt: OPENED });
    expect(windows.of(9)).toEqual({ openedAt: OPENED + 100 });
  });

  it('reopens a tab that came back, rather than reviving its closed window', () => {
    windows.reconcile([7], OPENED);
    windows.reconcile([], OPENED + 100);
    windows.reconcile([7], OPENED + 200);

    expect(windows.of(7)).toEqual({ openedAt: OPENED + 200 });
  });

  it('drops a closed window once nothing can still straddle it', () => {
    windows.reconcile([7, 8], OPENED);
    windows.close(7, OPENED + 100);

    windows.sweep(OPENED + 100 + 30_000, 30_000);
    expect(windows.of(7)).toBeUndefined();
    // The live one is untouched, however long it has been open.
    expect(windows.isLive(8)).toBe(true);
  });

  it('keeps a closed window while a request could still straddle it', () => {
    windows.open(7, OPENED);
    windows.close(7, OPENED + 100);

    windows.sweep(OPENED + 100 + 29_999, 30_000);
    expect(windows.of(7)).toBeDefined();
  });
});
