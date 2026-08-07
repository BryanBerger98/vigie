/**
 * Compatibility axis between every producer and consumer of the shapes declared here.
 *
 * The package version is not that axis: the extension ships on the Chrome Web Store and the
 * SDK on npm, on unrelated schedules. Bump this only on a breaking change to a stored or
 * transported shape — removing or renaming a field. Adding an optional field is not one.
 *
 * A bump is also a Dexie migration, never just a type edit.
 */
export const SCHEMA_VERSION = 1;

export type SchemaVersion = typeof SCHEMA_VERSION;
