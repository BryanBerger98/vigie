import { captureEntry, type EntryDraft, type WriteOutcome } from '@/storage/write';

import type { CapturePayload } from './bridge';

/**
 * Turns a relayed page event into a store entry, through the same door as the network capture.
 *
 * The scope and the rolling hour are applied by `captureEntry`, which means a console line and a
 * request are filtered, stamped and pruned by identical code. A second write path would be a
 * second place for the privacy claim to be wrong.
 *
 * The URL handed to the write path is the *frame's*, taken from the message sender rather than
 * from anything the page said. A page can post whatever it likes on the bridge; it cannot forge
 * the sender Chrome attaches, so the domain an entry is stamped with is never the page's word.
 */

/** The slice of `chrome.runtime.MessageSender` this needs. */
export interface RelaySender {
  tab?: { id?: number };
  /** The URL of the frame the message came from. Absent for senders that are not a page. */
  url?: string;
}

export function storeRelayedCapture(payload: CapturePayload, sender: RelaySender): WriteOutcome {
  const tabId = sender.tab?.id ?? -1;
  const url = sender.url ?? '';

  const draft: EntryDraft =
    payload.kind === 'console'
      ? {
          kind: 'console',
          timestamp: payload.at,
          tabId,
          level: payload.level,
          text: payload.text,
          truncated: payload.truncated,
        }
      : {
          kind: 'error',
          timestamp: payload.at,
          tabId,
          source: payload.source,
          message: payload.message,
          stack: payload.stack,
          truncated: payload.truncated,
        };

  return captureEntry(draft, url);
}
