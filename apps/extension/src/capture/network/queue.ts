/**
 * The short hold between a request's terminal event and the write it triggers.
 *
 * `webRequest` is what says a request is over — it is the only layer that never misses that event —
 * but on an attached tab the entry belongs to the deep layer, and the deep layer is behind. Its
 * announcement of the same response arrives after `webRequest`'s terminal event for 98 % of
 * requests, 42.6 ms later on average. Writing at the instant the trigger fires resolves nothing
 * 294 times out of 299; a 50 ms rung resolves nearly all of them. That is the whole reason this
 * exists, and it is why the write path holds a queue rather than a lookup.
 *
 * The hold is not free of consequences, and one of them decides where it may be emptied. Ownership
 * is answered at the instant an item resolves, so a session window that closes while an item waits
 * changes that answer under it: measured on a stop clicked inside the hold, one navigation came out
 * as two entries, the deep layer's and a second one marked `out-of-session`. The rule that follows
 * is in `listeners.ts` — every window move drains first, so a held item always answers for the
 * session that was live when its request ended.
 *
 * Nothing here waits on a body. A response the page never read produces no terminal CDP event at
 * any delay — measured to ten seconds, zero bodies out of 3 053 requests — so a guard delay before
 * the read would buy nothing and cost every request its latency.
 *
 * The module is pure — no `chrome.*`, no storage — and the timer is the only thing it touches.
 *
 * @see aidd_docs/backlog/spikes/cdp-capture-loop-cost.md
 * @see aidd_docs/backlog/spikes/cdp-body-read-timing.md
 */

/** The measured rung. Not a guess at a network delay: the delay between two observers of the same one. */
export const CDP_HANDOVER_DELAY_MS = 50;

/**
 * How many writes may be held at once.
 *
 * The delay already bounds the queue to what one tab produces in 50 ms, which no real page comes
 * near. This is the runaway guard for the case that is not a real page — a fetch loop, a broken
 * retry — and it resolves the oldest rather than dropping it: the entry is written with what is
 * known, which is the same rule the delay itself applies.
 */
export const MAX_DEFERRED_WRITES = 500;

interface Held<T> {
  item: T;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A fixed-delay queue that resolves in order and can always be emptied on demand.
 *
 * `resolve` is called once per item, at the end of the hold or at the drain, whichever comes first.
 * It is never called twice for the same item.
 */
export class WriteQueue<T> {
  private held: Held<T>[] = [];

  constructor(
    private readonly resolve: (item: T) => void,
    private readonly delayMs: number = CDP_HANDOVER_DELAY_MS,
  ) {}

  /** Holds `item` for the delay. Resolves the oldest immediately when the queue is full. */
  defer(item: T): void {
    const oldest = this.held[0];
    if (oldest && this.held.length >= MAX_DEFERRED_WRITES) this.release(oldest);

    const entry: Held<T> = {
      item,
      timer: setTimeout(() => this.release(entry), this.delayMs),
    };
    this.held.push(entry);
  }

  /**
   * Resolves everything held, now, in arrival order.
   *
   * Called before every batch flush. An export fired the instant traffic stops would otherwise
   * return without the last 50 ms of it, and the user has no way to tell an entry that is late from
   * one that was never captured.
   */
  drain(): void {
    const pending = this.held;
    this.held = [];
    for (const entry of pending) {
      clearTimeout(entry.timer);
      this.resolve(entry.item);
    }
  }

  get size(): number {
    return this.held.length;
  }

  private release(entry: Held<T>): void {
    const index = this.held.indexOf(entry);
    if (index === -1) return;
    this.held.splice(index, 1);
    clearTimeout(entry.timer);
    this.resolve(entry.item);
  }
}
