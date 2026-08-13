/**
 * One tab, one CDP session, buffer sizes never left to the browser.
 *
 * Attaching is two steps that have to be treated as one: `chrome.debugger.attach` opens the session
 * and `Network.enable` is what makes it report anything. Between the two the tab already carries
 * Chrome's banner while capturing nothing, which is the worst state this layer can be left in — so a
 * rejected `Network.enable` closes the session it opened rather than leaving it standing.
 *
 * Nothing here consults the session state or decides whether a tab deserves a session. It attaches
 * what it is given and says what happened; `session.ts` owns the decision.
 *
 * @see aidd_docs/backlog/spikes/cdp-body-capture-calibration.md
 */

import type { NetworkEnableParams, TabDebuggee } from '@/shared/chrome-apis';

/**
 * The protocol version asked of `chrome.debugger.attach`.
 *
 * `1.3` is the stable release of the protocol and the one every command in this layer belongs to.
 * The browser is free to run a newer one and answers this request with backward compatibility;
 * asking for `tot` instead would bind the extension to whatever the tip of tree happens to expose
 * on the user's Chrome.
 */
export const CDP_PROTOCOL_VERSION = '1.3';

/**
 * The five parameters of `Network.enable`, all of them explicit.
 *
 * Read on the renderer process rather than deduced: with the two buffer sizes left to the browser,
 * an attached tab's RSS grew by 605 MB for 200 MB transferred, against no growth at all for the same
 * page with nothing attached. At 10 MB and 2 MB nothing measurable grows, at 50, 200 or 400 MB
 * transferred, for the same zero read failures — the cost of enabling the domain lands on the user's
 * tab, so it is capped there and not in this extension's storage.
 *
 * `enableDurableMessages` is the experimental parameter that keeps a response body readable across a
 * cross-process navigation: 60 deferred reads out of 60 succeed with it, 1 out of 60 without. It
 * must never travel without `maxTotalBufferSize` — Chrome answers `-32602`, `maxTotalBufferSize is
 * required with enableDurableMessages`, which the CDP reference does not mention, and the rejected
 * call still leaves the session attached.
 *
 * `maxPostDataSize` stays at the protocol's own default. Request bodies are read from the SDK and
 * from `webRequest`, never from CDP, so this value bounds a payload nothing in the layer asks for.
 * It is passed anyway because omitting a parameter here is how the two buffer sizes get omitted too.
 *
 * `reportDirectSocketTraffic` is off: Direct Sockets is an isolated-web-app API, and no page this
 * product captures can open one.
 */
export const NETWORK_ENABLE_PARAMS: NetworkEnableParams = {
  maxTotalBufferSize: 10 * 1024 * 1024,
  maxResourceBufferSize: 2 * 1024 * 1024,
  maxPostDataSize: 65_536,
  reportDirectSocketTraffic: false,
  enableDurableMessages: true,
};

/** Which of the two steps refused. The second one is the one that leaves a banner behind. */
export type AttachStage = 'attach' | 'network-enable';

export type AttachOutcome = { ok: true } | { ok: false; stage: AttachStage; reason: string };

/** What the browser said, kept as it said it — these messages are how a refusal gets diagnosed. */
function reasonFor(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'the browser refused without saying why';
}

/**
 * Opens a session on one tab and turns the `Network` domain on.
 *
 * The two known refusals of the first step are a tab DevTools already holds — one debugger per tab,
 * whoever came first — and a tab that closed between the decision and the call. Both are reported,
 * neither is retried: the caller learns of the next attempt from a tab event, not from a loop here.
 */
export async function attachTab(tabId: number): Promise<AttachOutcome> {
  const target: TabDebuggee = { tabId };

  try {
    await browser.debugger.attach(target, CDP_PROTOCOL_VERSION);
  } catch (error) {
    return { ok: false, stage: 'attach', reason: reasonFor(error) };
  }

  try {
    await browser.debugger.sendCommand(target, 'Network.enable', NETWORK_ENABLE_PARAMS);
  } catch (error) {
    // The session survives its own rejected command, and a session that reports nothing is a banner
    // on the user's tab for no capture at all. Re-attaching would only report being already attached
    // to ourselves, so the way out is to close it and say why.
    await detachTab(tabId);
    return { ok: false, stage: 'network-enable', reason: reasonFor(error) };
  }

  return { ok: true };
}

/**
 * Closes the session on one tab. Never throws.
 *
 * A detach that fails failed because there was nothing left to detach — the tab is gone, or Chrome's
 * banner Cancel already took every session of the extension down at once. The caller wants the tab
 * to hold no session, and it does, so there is nothing to report. Note that this path fires no
 * `onDetach`: Chrome stays silent on a detach the extension initiates itself, which is why the
 * persisted state is updated by the caller rather than by an event coming back.
 */
export async function detachTab(tabId: number): Promise<void> {
  try {
    await browser.debugger.detach({ tabId });
  } catch {
    // Already detached. See above.
  }
}
