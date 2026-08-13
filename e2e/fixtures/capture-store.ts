import type { Page } from '@playwright/test';

/**
 * Reads and seeds the capture store from a page of the extension's own origin.
 *
 * The store lives in the `chrome-extension://<id>` origin, which the service worker and every
 * extension surface share. So any options or popup page opened by a spec can reach it — with the
 * raw IndexedDB API rather than Dexie, since the fixture runs in the page and has no bundler.
 *
 * Reading through the browser instead of asserting on the worker's own state is deliberate: what
 * a report will be cut from is what landed on disk, not what the write path believed it queued.
 */

/** Mirrors `@vigie/contract`'s `CaptureEntry` loosely — a spec asserts on fields, not on shape. */
export interface StoredEntry {
  id: number;
  kind: string;
  timestamp: number;
  tabId: number;
  domain: string;
  url?: string;
  method?: string;
  outcome?: string;
  statusCode?: number;
  error?: string;
  provenance?: string;
  resourceType?: string;
  responseBody?: string;
  responseBodyText?: string;
  requestHeaders?: { name: string; value: string }[];
  responseHeaders?: { name: string; value: string }[];
}

const DATABASE = 'vigie';
const TABLE = 'entries';

/**
 * Everything the store holds, oldest first.
 *
 * An absent database or an absent table both read as "nothing captured": before the first write
 * Dexie has not created either, and a spec asserting emptiness must not fail on that.
 */
export function readCapturedEntries(page: Page): Promise<StoredEntry[]> {
  return page.evaluate(
    ([database, table]) =>
      new Promise<StoredEntry[]>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onerror = () => reject(request.error ?? new Error('could not open the store'));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(table)) {
            db.close();
            resolve([]);
            return;
          }
          const read = db.transaction(table, 'readonly').objectStore(table).getAll();
          read.onerror = () => {
            db.close();
            reject(read.error ?? new Error('could not read the store'));
          };
          read.onsuccess = () => {
            db.close();
            const entries = read.result as StoredEntry[];
            resolve(entries.sort((a, b) => a.timestamp - b.timestamp));
          };
        };
      }),
    [DATABASE, TABLE] as const,
  ) as Promise<StoredEntry[]>;
}

/**
 * Puts an entry straight into the store, bypassing the capture.
 *
 * Used to state a past that the run cannot otherwise produce — an entry older than the rolling
 * hour, above all. Requires the table to exist, so a spec captures something for real first.
 */
export function seedCapturedEntry(page: Page, entry: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    ([database, table, value]) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(database as string);
        request.onerror = () => reject(request.error ?? new Error('could not open the store'));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(table as string)) {
            db.close();
            reject(new Error('the capture store has no entries table yet'));
            return;
          }
          const transaction = db.transaction(table as string, 'readwrite');
          transaction.objectStore(table as string).add(value);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error ?? new Error('could not seed the store'));
          };
        };
      }),
    [DATABASE, TABLE, entry] as const,
  );
}

/**
 * Asks the service worker to write what it still holds, and waits for it to say it did.
 *
 * Without this a spec would be polling against the batch delay, and the rolling purge — which runs
 * on the write path and nowhere else — would only happen when traffic happened to arrive.
 */
export function flushCapture(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        // `chrome` is not typed in this workspace, and pulling the whole extension surface in for
        // one call is not worth it. The narrow view is what the page actually reaches for.
        const { chrome } = globalThis as unknown as {
          chrome: { runtime: { sendMessage(message: unknown, callback: () => void): void } };
        };
        chrome.runtime.sendMessage('vigie:flush', () => resolve());
      }),
  );
}
