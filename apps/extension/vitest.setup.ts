/**
 * IndexedDB in the unit environment.
 *
 * `fake-indexeddb/auto` installs the whole IndexedDB surface on `globalThis`, which is what Dexie
 * opens against. WXT's fake browser stops at `chrome.storage`; it has no notion of IndexedDB, so
 * without this every module that touches the capture store would need a browser to be tested.
 *
 * The store is per test file, not per test: whatever a test writes is still there for the next one.
 * Tests that care open a database of their own through `setDatabase` (`storage/db.ts`).
 */
import 'fake-indexeddb/auto';
