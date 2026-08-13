import { RESPONSE_BODY_UNAVAILABLE, type CaptureEntry, type NetworkEntry } from '@vigie/contract';
import Dexie, { type EntityTable } from 'dexie';

/**
 * The capture store: one table, holding the rolling hour of context a report is cut from.
 *
 * Everything the product exports comes out of here, and everything that goes in has already
 * passed the scope filter — the write path is the only door (`database.md:39`). Video segments
 * are the deliberate exception and live in OPFS; they never reach this table.
 *
 * ## Migrations
 *
 * A version block, once shipped, is frozen. Installed extensions upgrade in place with live data
 * in the database, so mutating `version(1)` would rewrite the past of profiles that already ran
 * it. An evolution appends `version(2)` and states its upgrade (`database.md:41`).
 */

/** A stored entry: the contract shape plus the auto-incremented key Dexie assigns. */
export type StoredEntry = CaptureEntry & { id: number };

/** What a write hands over — everything but the key, which the store allocates. */
export type NewEntry = CaptureEntry;

export class CaptureDatabase extends Dexie {
  /**
   * Two compound indexes, and no others. Each one costs on every write, and the write path is
   * what is under pressure here — a busy tab produces hundreds of entries a minute.
   *
   * - `[tabId+timestamp]` serves the only read the product performs: the slice of one tab over a
   *   time window, which is what an export is.
   * - `[domain+timestamp]` serves the erasure that follows the removal of a watched domain, and
   *   carries the timestamp so the rolling purge can walk a domain in order rather than scanning.
   *
   * `timestamp` alone is indexed too: the purge deletes across every tab at once, and the oldest
   * entry has to be readable without a table scan for the storage readout of phase 9.
   */
  entries!: EntityTable<StoredEntry, 'id'>;

  constructor(name = CAPTURE_DATABASE_NAME) {
    super(name);
    this.version(1).stores({
      entries: '++id, timestamp, [tabId+timestamp], [domain+timestamp]',
    });
    /**
     * Version 2 widens the shape of a network entry without touching the schema: it adds
     * `provenance` and the enumeration `responseBody` now draws from. No `stores()` call, so the
     * indexes carry over untouched — neither of the two new fields is a cut of an export, and an
     * index would be paid on every write for a read nothing performs.
     *
     * Entries written by version 1 came from `webRequest` and from nowhere else, so the upgrade
     * states exactly what produced them rather than guessing.
     */
    this.version(2).upgrade((transaction) =>
      transaction
        .table<CaptureEntry>('entries')
        .toCollection()
        .modify((entry) => {
          if (entry.kind !== 'network') return;
          const network = entry as NetworkEntry;
          network.provenance = 'webRequest';
          network.responseBody = RESPONSE_BODY_UNAVAILABLE;
        }),
    );
  }
}

export const CAPTURE_DATABASE_NAME = 'vigie';

let instance: CaptureDatabase | null = null;

/**
 * The one database handle the extension uses. Created on first call rather than at import time:
 * this module is pulled in by unit tests and by React surfaces, and neither should open an
 * IndexedDB connection merely by being loaded.
 */
export function db(): CaptureDatabase {
  instance ??= new CaptureDatabase();
  return instance;
}

/** Replaces the handle. Tests use it to run against a database of their own. */
export function setDatabase(next: CaptureDatabase | null): void {
  instance = next;
}
