/**
 * The one side effect of an export: the report leaves the extension as a file on disk.
 *
 * A blob and an anchor, nothing else. `chrome.downloads` would bring a "Save as" dialog, collision
 * control and a real receipt, and it costs a permission the user is warned about at install time —
 * the manifest stays as it is (`wxt.config.ts:36`).
 *
 * ## What this is free of
 *
 * `navigator.clipboard.writeText`, which this replaces, only ran on the transient activation the
 * click granted, and the first await outliving that click spent it. It forced the write to be the
 * last statement of a handler, it lost an export whenever the worker was slow to answer, and it is
 * what a "Copy again" button existed to catch. `createObjectURL` and `click()` know nothing of
 * activation: they work whenever they are called.
 *
 * ## Why the failure is returned rather than thrown
 *
 * A refused write is not an error in the program, it is an outcome the user has to see. Thrown, it
 * would land in a rejected promise nobody renders and the popup would show a button that did
 * nothing. Returned, the caller cannot render a success without having looked at the answer.
 */

export type DownloadOutcome = { ok: true } | { ok: false; reason: string };

/**
 * How long the blob URL is kept alive after the click.
 *
 * Never revoked synchronously: the download process reads the blob after the click returns, and
 * pulling the URL from under it would produce a file that never arrives. The delay is generous
 * because it costs nothing — a Markdown report is a few hundred kilobytes at most, and a popup that
 * closes before the timer fires takes the whole document, blob included, with it.
 */
const REVOKE_DELAY_MS = 60_000;

/** What the browser said, in a sentence a user can act on rather than a stack trace. */
function reasonFor(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'the browser refused the write without saying why';
}

export function downloadReport(markdown: string, filename: string): DownloadOutcome {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { ok: false, reason: 'this context cannot write a file' };
  }

  try {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, reason: reasonFor(error) };
  }
}
