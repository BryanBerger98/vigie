import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CDP_HANDOVER_DELAY_MS, MAX_DEFERRED_WRITES, WriteQueue } from './queue';

/**
 * The hold exists to give the deep layer the 42.6 ms it is behind by, and to hand a request back
 * when the session closes inside that delay. Both of those are timing, so the clock is driven here
 * rather than waited on.
 */

let written: string[];
let queue: WriteQueue<string>;

beforeEach(() => {
  vi.useFakeTimers();
  written = [];
  queue = new WriteQueue<string>((item) => written.push(item));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the hold', () => {
  it('writes nothing before the delay and everything after it', () => {
    queue.defer('a');

    vi.advanceTimersByTime(CDP_HANDOVER_DELAY_MS - 1);
    expect(written).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(written).toEqual(['a']);
    expect(queue.size).toBe(0);
  });

  it('resolves in arrival order, each on its own delay', () => {
    queue.defer('a');
    vi.advanceTimersByTime(20);
    queue.defer('b');

    vi.advanceTimersByTime(CDP_HANDOVER_DELAY_MS - 20);
    expect(written).toEqual(['a']);

    vi.advanceTimersByTime(20);
    expect(written).toEqual(['a', 'b']);
  });

  it('takes the delay it was built with', () => {
    const fast = new WriteQueue<string>((item) => written.push(item), 5);
    fast.defer('a');

    vi.advanceTimersByTime(5);
    expect(written).toEqual(['a']);
  });
});

describe('the drain', () => {
  it('writes everything held, at once, in arrival order', () => {
    queue.defer('a');
    queue.defer('b');
    queue.defer('c');

    queue.drain();
    expect(written).toEqual(['a', 'b', 'c']);
    expect(queue.size).toBe(0);
  });

  it('does not write an item a second time when its timer would have fired', () => {
    queue.defer('a');
    queue.drain();

    vi.advanceTimersByTime(CDP_HANDOVER_DELAY_MS * 2);
    expect(written).toEqual(['a']);
  });

  it('is a no-op on an empty queue', () => {
    queue.drain();
    expect(written).toEqual([]);
  });
});

describe('the runaway guard', () => {
  it('releases the oldest rather than growing without bound', () => {
    for (let index = 0; index < MAX_DEFERRED_WRITES; index += 1) {
      queue.defer(`request-${index}`);
    }
    expect(written).toEqual([]);
    expect(queue.size).toBe(MAX_DEFERRED_WRITES);

    queue.defer('one too many');
    expect(written).toEqual(['request-0']);
    expect(queue.size).toBe(MAX_DEFERRED_WRITES);

    // The evicted item's own timer has nothing left to do.
    vi.advanceTimersByTime(CDP_HANDOVER_DELAY_MS * 2);
    expect(written.filter((item) => item === 'request-0')).toHaveLength(1);
  });
});
