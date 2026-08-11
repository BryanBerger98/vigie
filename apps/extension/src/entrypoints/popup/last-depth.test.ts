import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { LAST_DEPTH_KEY, readLastDepth, writeLastDepth } from './last-depth';

/**
 * The one thing the popup remembers between two openings.
 *
 * Two properties matter and neither is about the happy path: the value survives the popup being
 * closed, and a value this build cannot honour is treated as no memory rather than as a depth to
 * export at. The stored key outlives the version that wrote it.
 */

beforeEach(() => {
  fakeBrowser.reset();
});

describe('a popup that has never exported', () => {
  it('remembers nothing on a fresh profile', async () => {
    expect(await readLastDepth()).toBeNull();
  });
});

describe('a depth taken from a previous export', () => {
  it('comes back exactly as it was written', async () => {
    await writeLastDepth(30);

    expect(await readLastDepth()).toBe(30);
  });

  it('stays on this machine, under the key the surface reads', async () => {
    await writeLastDepth(15);

    expect(await fakeBrowser.storage.local.get(LAST_DEPTH_KEY)).toEqual({ [LAST_DEPTH_KEY]: 15 });
    expect(await fakeBrowser.storage.sync.get(LAST_DEPTH_KEY)).toEqual({});
  });

  it('is replaced by the next one rather than accumulated', async () => {
    await writeLastDepth(15);
    await writeLastDepth(60);

    expect(await readLastDepth()).toBe(60);
  });
});

describe('a stored value this build cannot honour', () => {
  // Each of these is a plausible disk state, not a hypothetical: a hand-edited profile, a partial
  // write, and a tier a future version could drop.
  it.each([
    ['a string', '15'],
    ['a shape that is not a depth', { depthMinutes: 15 }],
    ['null', null],
    ['a tier that is not on the list', 45],
    ['a negative number', -5],
  ])('reads as no memory when the key holds %s', async (_case, value) => {
    await fakeBrowser.storage.local.set({ [LAST_DEPTH_KEY]: value });

    expect(await readLastDepth()).toBeNull();
  });
});
