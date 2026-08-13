/**
 * What a worker does about the deep layer when it comes back from its own death.
 *
 * Resume is a boot path, not a mechanism. Chrome restarts the worker on the first event it has a
 * handler for, and the `webRequest` traffic of a watched tab is enough — nothing here schedules an
 * alarm, opens a port or otherwise keeps the worker alive to be ready. The whole of it is three
 * gestures made at a start that has already happened: read what the previous generation wrote, close
 * and forget what it was holding, ask the perimeter to be attached again.
 *
 * ## The sessions outlive the worker that opened them
 *
 * A CDP session belongs to the extension, not to the generation that attached it. Measured in
 * phase 6, after a `Target.closeTarget` on the worker: `chrome.debugger.attach` on a tab the
 * previous generation held comes back `Another debugger is already attached to the tab with id: N`.
 * The banner is still up, the session is still open, and nothing in the new worker can drive it —
 * the request windows that decide what a CDP event belongs to lived in the memory that died.
 *
 * So the start closes them and opens them again. Detaching first is what makes `attachTab` succeed,
 * and re-attaching is what rebuilds the bookkeeping; adopting the surviving session would mean
 * reconstructing that state from nothing, for the sole gain of a banner that never blinks.
 *
 * `chrome.debugger.onDetach` says none of this — zero emissions across six provoked deaths — so the
 * persisted list is the only record of what to close, and clearing it is what stops
 * `reconcileDeepLayer` from reading those tabs as "already attached" and skipping exactly the ones
 * that need a session.
 *
 * Nothing is recovered from the interrupted requests. A response body lives in the CDP records of a
 * generation that no longer exists, and `enableDurableMessages` was measured to bring none of them
 * back; the in-flight map goes with the tab list for the same reason.
 *
 * @see aidd_docs/backlog/spikes/cdp-service-worker-recovery.md
 */

import { detachTab } from './attach';
import { reconcileDeepLayer } from './session';
import {
  mayAttach,
  readCdpSessionState,
  updateCdpSessionState,
  type CdpSessionState,
} from './session-state';

/** Why a start attached nothing. Both are ordinary; neither is an error. */
export type ResumeRefusal =
  /** Chrome's banner Cancel was pressed before the death. The user said no; a start does not re-ask. */
  | 'canceled-by-user'
  /** The layer was never armed, or was stopped. There was no capture to resume. */
  | 'never-armed';

export type ResumeDecision =
  | { resume: true; lostTabs: number[] }
  | { resume: false; reason: ResumeRefusal };

/**
 * Whether to resume, decided on the persisted state alone. The pure half of the boot path, and the
 * only half a unit test can hold.
 *
 * `mayAttach` stays the single guard — this does not restate its rule. The cancellation is read
 * first only to name the refusal: a state that is both armed and cancelled is a refusal, not an
 * absence of capture, and the two say different things to whoever reads the log.
 *
 * `lostTabs` is what the previous generation was holding. It is handed back as "these carry a
 * session nobody drives any more", never as "attach exactly these": the list can have aged past a
 * closed tab or a navigation out of the watched perimeter, and the perimeter is the authority on
 * what gets a session. The reconciliation recomputes it.
 */
export function planResume(state: CdpSessionState): ResumeDecision {
  if (state.canceledByUser) return { resume: false, reason: 'canceled-by-user' };
  if (!mayAttach(state)) return { resume: false, reason: 'never-armed' };
  return { resume: true, lostTabs: state.attachedTabs };
}

/**
 * Drops what the death made unusable, keeps what the user decided.
 *
 * `armed` and the cancellation mark survive — they are the user's answer and no death revokes it.
 * The attachment list and the in-flight map do not: both describe a generation that is gone, and
 * the sessions the list named have just been closed.
 */
export function forgetLostSessions(state: CdpSessionState): CdpSessionState {
  return { ...state, attachedTabs: [], inFlight: {} };
}

/**
 * The boot path itself. Called once per worker start, before anything else touches the layer.
 *
 * The closing and the clearing both happen *before* the reconciliation rather than inside it:
 * `reconcileDeepLayer` is also the ordinary path for a tab that moves, where the attachment list is
 * true and detaching every tab on it would take down live sessions for a navigation. Only a start
 * knows the list names sessions nobody drives.
 *
 * A refusal closes nothing, and that is deliberate. The cancellation came from Chrome's own banner,
 * which takes every session of the extension down as it is pressed, and the reconciliation that the
 * next tab event triggers stands the layer down on whatever is left. A start that may not attach has
 * nothing to undo.
 *
 * No permission check here. `reconcileDeepLayer` already refuses when `chrome.debugger` is absent,
 * and a second reading of the same fact is a second place for the two to disagree.
 */
export async function resumeDeepLayer(): Promise<ResumeDecision> {
  const decision = planResume(await readCdpSessionState());
  if (!decision.resume) return decision;

  await Promise.all(decision.lostTabs.map(detachTab));
  await updateCdpSessionState(forgetLostSessions);
  await reconcileDeepLayer();
  return decision;
}
