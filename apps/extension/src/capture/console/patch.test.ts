import type { ConsoleLevel } from '@vigie/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturePayload } from './bridge';
import { PATCHED_LEVELS, patchConsole, type PatchTarget } from './patch';

/**
 * What is under test is the wrapping discipline, not the browser: the patch runs inside someone
 * else's page, so every assertion below is a form of "the page cannot tell".
 */

interface Harness {
  target: PatchTarget;
  /** Calls the page's own console received, in order. */
  seen: { level: ConsoleLevel; args: unknown[] }[];
  /** The listeners the patch attached, keyed by event type. */
  listeners: Map<string, (event: unknown) => void>;
  originals: Record<ConsoleLevel, (...args: unknown[]) => void>;
  dispatch(type: string, event: unknown): void;
}

function harness(): Harness {
  const seen: Harness['seen'] = [];
  const listeners = new Map<string, (event: unknown) => void>();

  const console = Object.fromEntries(
    PATCHED_LEVELS.map((level) => [
      level,
      (...args: unknown[]) => {
        seen.push({ level, args });
      },
    ]),
  ) as PatchTarget['console'];

  const originals = { ...console };

  const target: PatchTarget = {
    console,
    addEventListener: (type, listener) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type) => {
      listeners.delete(type);
    },
  };

  return {
    target,
    seen,
    listeners,
    originals,
    dispatch: (type, event) => listeners.get(type)?.(event),
  };
}

let h: Harness;
let emitted: CapturePayload[];
let emit: (payload: CapturePayload) => void;

beforeEach(() => {
  h = harness();
  emitted = [];
  emit = (payload) => {
    emitted.push(payload);
  };
});

describe('the page keeps its own console', () => {
  it('calls the original for every patched level, with the same arguments', () => {
    patchConsole(emit, h.target);

    for (const level of PATCHED_LEVELS) {
      h.target.console[level]('message', level);
    }

    expect(h.seen).toEqual(
      PATCHED_LEVELS.map((level) => ({ level, args: ['message', level] })),
    );
  });

  it('calls the original before capturing, so capture can never delay the page', () => {
    const order: string[] = [];
    const original = h.target.console.log;
    h.target.console.log = (...args: unknown[]) => {
      order.push('page');
      original(...args);
    };

    patchConsole(() => {
      order.push('capture');
    }, h.target);

    h.target.console.log('x');

    expect(order).toEqual(['page', 'capture']);
  });

  it('keeps the `this` the caller used', () => {
    const receiver = { tag: 'caller' };
    const receivers: unknown[] = [];
    h.target.console.log = function recordThis(this: unknown) {
      receivers.push(this);
    };

    patchConsole(emit, h.target);
    h.target.console.log.call(receiver, 'x');

    expect(receivers).toEqual([receiver]);
  });
});

describe('a failing capture never reaches the page', () => {
  it('swallows an emit that throws', () => {
    patchConsole(() => {
      throw new Error('sink is down');
    }, h.target);

    expect(() => h.target.console.log('still fine')).not.toThrow();
    expect(h.seen).toHaveLength(1);
  });

  it('records a value that defeats the serialiser instead of throwing over it', () => {
    patchConsole(emit, h.target);

    // A proxy that refuses to be enumerated: the failure happens inside the renderer, past every
    // guard it has, which is the case the outer catch exists for.
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('nope');
        },
      },
    );

    expect(() => h.target.console.log(hostile)).not.toThrow();
    expect(emitted[0]).toMatchObject({ text: '[unserializable]', truncated: true });
  });

  it('does not recurse when the sink logs', () => {
    patchConsole(() => {
      h.target.console.log('from the sink');
    }, h.target);

    h.target.console.log('from the page');

    // Two page-visible lines — the original call and the sink's own — and no further nesting.
    expect(h.seen.map((call) => call.args[0])).toEqual(['from the page', 'from the sink']);
  });
});

describe('what is emitted', () => {
  it('carries the level, the serialised text and the stamp', () => {
    patchConsole(emit, h.target, () => 1_700_000_000_000);

    h.target.console.warn('count', { n: 2 });

    expect(emitted).toEqual([
      {
        kind: 'console',
        level: 'warn',
        text: 'count { n: 2 }',
        truncated: false,
        at: 1_700_000_000_000,
      },
    ]);
  });

  it('reports an uncaught error with its stack', () => {
    patchConsole(emit, h.target, () => 42);
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at page.js:1:1';

    h.dispatch('error', { error });

    expect(emitted).toEqual([
      {
        kind: 'error',
        source: 'uncaught',
        message: 'Error: boom',
        stack: 'Error: boom\n    at page.js:1:1',
        truncated: false,
        at: 42,
      },
    ]);
  });

  it('falls back to the message when a cross-origin failure hides the error', () => {
    patchConsole(emit, h.target);

    h.dispatch('error', { message: 'Script error.' });

    expect(emitted[0]).toMatchObject({
      kind: 'error',
      source: 'uncaught',
      message: 'Script error.',
    });
  });

  it('reports a rejection whose reason is not an Error at all', () => {
    patchConsole(emit, h.target);

    h.dispatch('unhandledrejection', { reason: { status: 500 } });

    expect(emitted[0]).toMatchObject({
      kind: 'error',
      source: 'unhandledrejection',
      message: '{ status: 500 }',
    });
  });
});

describe('idempotency', () => {
  it('does not patch a second time, which would double every entry', () => {
    patchConsole(emit, h.target);
    patchConsole(emit, h.target);

    h.target.console.log('once');

    expect(emitted).toHaveLength(1);
    expect(h.seen).toHaveLength(1);
  });

  it('returns a no-op restore from the second patch, so it cannot unpatch the first', () => {
    patchConsole(emit, h.target);
    const secondRestore = patchConsole(emit, h.target);

    secondRestore();
    h.target.console.log('still captured');

    expect(emitted).toHaveLength(1);
  });
});

describe('restore', () => {
  it('puts back the exact original functions', () => {
    const restore = patchConsole(emit, h.target);
    restore();

    for (const level of PATCHED_LEVELS) {
      expect(h.target.console[level]).toBe(h.originals[level]);
    }
  });

  it('stops emitting, and the page console still works', () => {
    const restore = patchConsole(emit, h.target);
    restore();

    h.target.console.log('after restore');

    expect(emitted).toHaveLength(0);
    expect(h.seen).toEqual([{ level: 'log', args: ['after restore'] }]);
  });

  it('detaches both failure listeners', () => {
    const restore = patchConsole(emit, h.target);
    expect(h.listeners.size).toBe(2);

    restore();

    expect(h.listeners.size).toBe(0);
  });

  it('allows a fresh patch afterwards', () => {
    patchConsole(emit, h.target)();
    patchConsole(emit, h.target);

    h.target.console.log('second life');

    expect(emitted).toHaveLength(1);
  });
});

describe('defaults', () => {
  it('stamps with the real clock when no clock is given', () => {
    vi.spyOn(Date, 'now').mockReturnValue(999);
    patchConsole(emit, h.target);

    h.target.console.log('x');

    expect(emitted[0]).toMatchObject({ at: 999 });
    vi.restoreAllMocks();
  });
});
