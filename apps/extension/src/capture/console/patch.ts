import type { ConsoleLevel, ErrorSource } from '@vigie/contract';

import type { CapturePayload } from './bridge';
import { clipText, serializeArguments } from './serialize';

/**
 * Replaces `console.*` and listens for uncaught failures, without the page being able to tell.
 *
 * This code runs inside someone else's application. The rule it exists under is narrower than
 * "try not to break things": **the page must behave identically with the extension installed and
 * without it**. Three things enforce that.
 *
 * - The original method is called first, with the original arguments and the original `this`.
 *   Capture happens after it has returned, so nothing the capture does can delay or alter what the
 *   developer sees in their own devtools.
 * - Every capture is wrapped. A serialisation that throws is swallowed, because an exception
 *   thrown from inside `console.log` would surface as an error in the page's own stack.
 * - Capture is non-reentrant. A sink that logs — ours does not, a future one might — would
 *   otherwise recurse until the stack gives out, inside the page.
 *
 * Patching is idempotent. A page can be injected into twice (a bfcache restore, a second frame
 * sharing a window), and two live patches would write every log down twice.
 */

/** The methods replaced. Nothing else is intercepted: `table`, `trace` and friends stay untouched. */
export const PATCHED_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/** Marks a function as one of ours, so a second patch of the same console is a no-op. */
const PATCH_MARKER = '__vigieConsolePatch';

/**
 * What `patchConsole` needs from its host. Declared as an interface rather than taken as
 * `globalThis` so the unit suite can exercise the whole thing without a DOM: what is under test
 * here is the wrapping discipline, and that needs no browser to be wrong.
 */
export interface PatchTarget {
  console: Record<ConsoleLevel, (...args: unknown[]) => void>;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

/** Undoes a patch. Returned rather than exported: only the caller knows which target it patched. */
export type RestoreConsole = () => void;

function isPatched(method: unknown): boolean {
  return typeof method === 'function' && PATCH_MARKER in method;
}

/**
 * A rejection reason or a thrown value turned into a message and a stack.
 *
 * A page can reject with anything — a string, a number, a response object — so the non-`Error`
 * case is the ordinary one, not the exception. It goes through the same serialiser as a console
 * argument, which is what keeps a rejected 10 MB object from being copied whole.
 */
function describeFailure(reason: unknown, source: ErrorSource, at: number): CapturePayload {
  if (reason instanceof Error) {
    const message = clipText(`${reason.name}: ${reason.message}`);
    const stack = typeof reason.stack === 'string' ? clipText(reason.stack) : null;
    return {
      kind: 'error',
      source,
      message: message.text,
      stack: stack?.text,
      truncated: message.truncated || (stack?.truncated ?? false),
      at,
    };
  }

  const { text, truncated } = serializeArguments([reason]);
  return { kind: 'error', source, message: text, truncated, at };
}

/** The two event shapes read here, kept minimal — `ErrorEvent` and `PromiseRejectionEvent`. */
interface FailureEvent {
  error?: unknown;
  message?: unknown;
  reason?: unknown;
}

/**
 * Patches `target` and returns the function that puts it back.
 *
 * `emit` is called once per observation, already serialised. It is called synchronously inside the
 * page's own call stack, so it must do nothing but hand the payload on.
 */
export function patchConsole(
  emit: (payload: CapturePayload) => void,
  target: PatchTarget,
  now: () => number = Date.now,
): RestoreConsole {
  if (PATCHED_LEVELS.some((level) => isPatched(target.console[level]))) {
    return () => undefined;
  }

  const originals = Object.fromEntries(
    PATCHED_LEVELS.map((level) => [level, target.console[level]]),
  ) as Record<ConsoleLevel, (...args: unknown[]) => void>;

  let capturing = false;

  const capture = (produce: () => CapturePayload): void => {
    if (capturing) return;
    capturing = true;
    try {
      emit(produce());
    } catch {
      // Deliberately silent. Reporting this failure would mean logging, which lands right back
      // here, and telling the page about it is the one thing the patch must never do.
    } finally {
      capturing = false;
    }
  };

  for (const level of PATCHED_LEVELS) {
    const original = originals[level];
    const patched = function patchedConsoleMethod(this: unknown, ...args: unknown[]): void {
      original.apply(this ?? target.console, args);
      capture(() => {
        const { text, truncated } = serializeArguments(args);
        return { kind: 'console', level, text, truncated, at: now() };
      });
    };
    Object.defineProperty(patched, PATCH_MARKER, { value: true });
    target.console[level] = patched;
  }

  const onError = (event: unknown): void => {
    const failure = event as FailureEvent;
    // `error` carries the thrown value when there is one; `message` is all a cross-origin script
    // failure ever gives ("Script error."), and stating that is better than storing nothing.
    capture(() => describeFailure(failure.error ?? failure.message, 'uncaught', now()));
  };

  const onRejection = (event: unknown): void => {
    const failure = event as FailureEvent;
    capture(() => describeFailure(failure.reason, 'unhandledrejection', now()));
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    for (const level of PATCHED_LEVELS) {
      target.console[level] = originals[level];
    }
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
