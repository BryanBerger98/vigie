/**
 * The one side effect of an export: the report leaves the extension for the clipboard.
 *
 * Called from a click handler and nowhere else. `navigator.clipboard.writeText` is gated on
 * transient user activation, and that activation is spent by the first await that outlives it —
 * so the write has to be the last step of the handler, never something scheduled for later.
 *
 * ## Why the failure is returned rather than thrown
 *
 * A refused clipboard is not an error in the program, it is an outcome the user has to see
 * (`phase-7.md:127`). Thrown, it would land in a rejected promise nobody renders and the popup
 * would show a button that did nothing — the exact silence this is written to avoid. Returned, the
 * caller cannot render a success without having looked at the answer.
 */

export type CopyOutcome = { ok: true } | { ok: false; reason: string };

/** What the browser said, in a sentence a user can act on rather than a stack trace. */
function reasonFor(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'the browser refused the write without saying why';
}

export async function copyToClipboard(text: string): Promise<CopyOutcome> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    return { ok: false, reason: 'this context has no clipboard' };
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, reason: reasonFor(error) };
  }
}
