/**
 * Who owns a request at its terminal event: the deep layer, or `webRequest`.
 *
 * The two layers observe the same traffic and neither can name a request the other would
 * recognise. `webRequest` numbers requests with its own generator; CDP numbers them
 * `<renderer process id>.<counter>`, restarted on every renderer process swap. There is no shared
 * key, and a `method + URL` correlation was measured exact but refused: it costs a one-second hold
 * before every write and the only requests it adds are network-stack artifacts — a cache-only probe
 * retried under a new id, six times out of 366.
 *
 * So ownership is not resolved by matching. It is resolved by *time*, against two marks and
 * nothing more:
 *
 * - CDP side: the set of request ids it announced itself, held by {@link CdpRecordStore}. An event
 *   whose id was never announced is discarded whole, which is what keeps an orphan out.
 * - `webRequest` side: one session window per tab, held here. A request is CDP's when it started
 *   inside a window that is still open.
 *
 * That yields exactly one entry per request at both boundaries, without either layer knowing the
 * other's names. A request already in flight when the session opens started before the window: it
 * stays `webRequest`'s, and CDP never announced it anyway. A request still in flight when the
 * session closes falls back whole — never a CDP beginning completed by `webRequest`. Both are
 * reported as straddling, so the entry can say why it alone carries no body.
 *
 * The module is pure — no `chrome.*`, no storage — so every boundary case is stated as a unit test.
 *
 * ## The cost this rule accepts
 *
 * On an attached tab, `webRequest` writes nothing for a request that started under the session.
 * A cross-site iframe is the exception that makes this visible: under `--site-per-process` its
 * requests reach `webRequest` against the tab and never reach a session attached by `tabId`, so
 * they produce no entry at all. Measured once across four business applications, on a video embed.
 * The alternative is the correlation this rule refuses.
 *
 * @see aidd_docs/memory/architecture.md
 * @see aidd_docs/backlog/spikes/cdp-webrequest-deduplication.md
 */

/** The layer that produces the entry. */
export type EntryOwner = 'cdp' | 'webRequest';

/** One tab's CDP session, as the `webRequest` side needs to see it. */
export interface SessionWindow {
  /** When the session was acknowledged. `webRequest` timestamps are on the same epoch clock. */
  openedAt: number;
  /** When it ended, whatever the cause. `undefined` while the session is live. */
  closedAt?: number;
}

export interface OwnershipQuestion {
  tabId: number;
  /** When the request's first event was seen, on `webRequest`'s clock. */
  startedAt: number;
  /** The tab's session window, or `undefined` for a tab that never held one. */
  window: SessionWindow | undefined;
}

export interface OwnershipVerdict {
  owner: EntryOwner;
  /**
   * True when the request straddles a session boundary, at either end: a session existed over it,
   * and the entry still falls back to `webRequest`. That is what tells a reader "the body was never
   * reachable" from "this layer has no bodies at all" — `out-of-session` against `unavailable`.
   *
   * The two ends were not always treated alike. While no layer reached a body, `unavailable` said
   * the truth on both sides. It stopped once the deep layer started reaching them: on an attached
   * tab, a lone "no response body" beside forty captured ones reads as a rendering that dropped it.
   */
  boundary: boolean;
}

const HANDED_BACK: OwnershipVerdict = { owner: 'webRequest', boundary: false };

/**
 * Names the layer that writes the entry for one request.
 *
 * A request with no tab is `webRequest`'s by construction: a page's service worker emits some, no
 * session can be attached to nothing, and CDP never sees them.
 */
export function decideOwner({ tabId, startedAt, window }: OwnershipQuestion): OwnershipVerdict {
  if (tabId < 0 || !window) return HANDED_BACK;

  // Before the session opened: CDP never announced it, and its orphan events were discarded. The
  // request still straddles the session, on the opening side, and the entry has to name that.
  if (startedAt < window.openedAt) return { owner: 'webRequest', boundary: true };

  // Session still live and the request started inside it — substitution, the ordinary case.
  if (window.closedAt === undefined) return { owner: 'cdp', boundary: false };

  // Session closed over a request it had started: a full handback, body included.
  return { owner: 'webRequest', boundary: startedAt < window.closedAt };
}

/**
 * The session windows, one per tab.
 *
 * Module state rather than storage: the decision runs inside a synchronous `webRequest` listener,
 * and a worker that has just started holds no window at all — which is the right answer, since a
 * worker death takes every CDP session with it and leaves `webRequest` owning everything.
 */
export class SessionWindows {
  private readonly windows = new Map<number, SessionWindow>();

  /** A session was acknowledged on this tab. */
  open(tabId: number, at: number): void {
    this.windows.set(tabId, { openedAt: at });
  }

  /** It ended. The window is kept, closed, so a request that straddles the end still reads it. */
  close(tabId: number, at: number): void {
    const window = this.windows.get(tabId);
    if (!window || window.closedAt !== undefined) return;
    window.closedAt = at;
  }

  of(tabId: number): SessionWindow | undefined {
    return this.windows.get(tabId);
  }

  /** Whether a live session covers this tab right now. */
  isLive(tabId: number): boolean {
    return this.windows.get(tabId)?.closedAt === undefined && this.windows.has(tabId);
  }

  /**
   * Brings the windows in line with the attachment list, the same way the layer reconciles sessions.
   *
   * Opening and closing are derived from the list rather than from the events that changed it, for
   * the reason the reconciliation itself exists: an event says what changed, and this needs what is.
   */
  reconcile(attachedTabs: readonly number[], at: number): void {
    for (const [tabId, window] of this.windows) {
      if (window.closedAt === undefined && !attachedTabs.includes(tabId)) window.closedAt = at;
    }
    for (const tabId of attachedTabs) {
      if (!this.isLive(tabId)) this.open(tabId, at);
    }
  }

  /**
   * Drops the windows closed longer than `retention` ago.
   *
   * A closed window answers for the requests that straddled its end; past the delay `webRequest`
   * itself has written or forgotten every one of them, and keeping the window would grow a map for
   * the lifetime of the worker.
   */
  sweep(now: number, retention: number): void {
    for (const [tabId, window] of this.windows) {
      if (window.closedAt !== undefined && now - window.closedAt >= retention) {
        this.windows.delete(tabId);
      }
    }
  }

  clear(): void {
    this.windows.clear();
  }

  get size(): number {
    return this.windows.size;
  }
}

/** The one instance the capture path reads. Written by the session, read by the listeners. */
export const sessionWindows = new SessionWindows();
