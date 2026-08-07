import { describe, expect, it, vi } from 'vitest';

import {
  followHostPermissions,
  registerOnce,
  unregister,
  type ListenableEvent,
} from './listener-lifecycle';

type AnyListener = (...args: never[]) => unknown;

/**
 * A stand-in for `chrome.events.Event` that keeps its listeners in an array rather than a Set,
 * so a stacked registration shows up as a duplicate instead of being silently deduplicated.
 * Chrome's real event objects ignore a second `addListener` with the same function reference,
 * but the listeners this module registers are freshly created closures on every service worker
 * start — which is exactly the case a Set would hide.
 */
function fakeEvent<TListener extends AnyListener, TOptions extends unknown[] = []>() {
  const listeners: TListener[] = [];
  const options: TOptions[] = [];

  const event: ListenableEvent<TListener, TOptions> & {
    listeners: TListener[];
    options: TOptions[];
    emit(...args: Parameters<TListener>): void;
  } = {
    listeners,
    options,
    addListener(listener, ...listenerOptions) {
      listeners.push(listener);
      options.push(listenerOptions);
    },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
        options.splice(index, 1);
      }
    },
    hasListener(listener) {
      return listeners.includes(listener);
    },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
  };

  return event;
}

describe('registerOnce', () => {
  it('registers the listener', () => {
    const event = fakeEvent<() => void>();
    const listener = vi.fn();

    registerOnce(event, listener);

    expect(event.listeners).toEqual([listener]);
  });

  it('leaves a single listener after two consecutive calls', () => {
    const event = fakeEvent<() => void>();
    const listener = vi.fn();

    registerOnce(event, listener);
    registerOnce(event, listener);

    expect(event.listeners).toHaveLength(1);
  });

  it('delivers an event once, not once per registration call', () => {
    const event = fakeEvent<() => void>();
    const listener = vi.fn();

    registerOnce(event, listener);
    registerOnce(event, listener);
    registerOnce(event, listener);
    event.emit();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the listeners of other registrations', () => {
    const event = fakeEvent<() => void>();
    const first = vi.fn();
    const second = vi.fn();

    registerOnce(event, first);
    registerOnce(event, second);
    registerOnce(event, first);

    expect(event.listeners).toHaveLength(2);
    expect(event.hasListener(first)).toBe(true);
    expect(event.hasListener(second)).toBe(true);
  });

  it('carries the registration options through, and only once', () => {
    const event = fakeEvent<() => void, [{ urls: string[] }]>();
    const listener = vi.fn();
    const filter = { urls: ['<all_urls>'] };

    registerOnce(event, listener, filter);
    registerOnce(event, listener, filter);

    expect(event.options).toEqual([[filter]]);
  });
});

describe('unregister', () => {
  it('removes a registered listener', () => {
    const event = fakeEvent<() => void>();
    const listener = vi.fn();

    registerOnce(event, listener);
    unregister(event, listener);

    expect(event.listeners).toEqual([]);
  });

  it('does nothing when the listener was never registered', () => {
    const event = fakeEvent<() => void>();
    const removeListener = vi.spyOn(event, 'removeListener');

    unregister(event, vi.fn());

    expect(removeListener).not.toHaveBeenCalled();
  });

  it('stops delivery', () => {
    const event = fakeEvent<() => void>();
    const listener = vi.fn();

    registerOnce(event, listener);
    unregister(event, listener);
    event.emit();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('followHostPermissions', () => {
  function fakePermissions() {
    return {
      onAdded: fakeEvent<(permissions: never) => unknown>(),
      onRemoved: fakeEvent<(permissions: never) => unknown>(),
    };
  }

  function fakeBinding() {
    return { apply: vi.fn(), remove: vi.fn() };
  }

  it('re-applies the binding when a host permission is granted', () => {
    const permissions = fakePermissions();
    const binding = fakeBinding();

    followHostPermissions(permissions, binding);
    permissions.onAdded.emit({ origins: ['https://example.test/*'] } as never);

    expect(binding.apply).toHaveBeenCalledTimes(1);
  });

  it('re-applies the binding when a host permission is revoked', () => {
    const permissions = fakePermissions();
    const binding = fakeBinding();

    followHostPermissions(permissions, binding);
    permissions.onRemoved.emit({ origins: ['https://example.test/*'] } as never);

    expect(binding.apply).toHaveBeenCalledTimes(1);
  });

  it('reports the change and the origins it carried', () => {
    const permissions = fakePermissions();
    const onChange = vi.fn();
    const granted = { origins: ['https://example.test/*'] };

    followHostPermissions(permissions, fakeBinding(), onChange);
    permissions.onAdded.emit(granted as never);
    permissions.onRemoved.emit(granted as never);

    expect(onChange).toHaveBeenNthCalledWith(1, 'added', granted);
    expect(onChange).toHaveBeenNthCalledWith(2, 'removed', granted);
  });

  it('applies once per grant however many times it subscribed', () => {
    const permissions = fakePermissions();
    const binding = fakeBinding();

    followHostPermissions(permissions, binding);
    followHostPermissions(permissions, binding);
    permissions.onAdded.emit({ origins: ['https://example.test/*'] } as never);

    // Two subscriptions build two distinct closures, so the honest count is 2, not 1. What must
    // not happen is 4 — which is what a plain `addListener` without the remove-first would give.
    expect(binding.apply).toHaveBeenCalledTimes(2);
    expect(permissions.onAdded.listeners).toHaveLength(2);
  });
});
