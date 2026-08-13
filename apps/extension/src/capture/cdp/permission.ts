/**
 * The `debugger` permission, asked of the browser rather than remembered.
 *
 * It is declared in the required `permissions` because Chrome grants it no other way. Measured on
 * Chromium 151.0.7922.34, `permissions.request({ permissions: ['debugger'] })` inside a real click
 * answers "Only permissions specified in the manifest may be requested" while a control permission
 * declared beside it opens its bubble: the key is dropped from `optional_permissions` at load, and
 * `permissions.getAll()` never lists it (`wxt.config.ts:37`).
 *
 * So there is nothing to request and nothing to revoke here. What the user arms in the popup is the
 * session, not the permission — the banner Chrome puts on every tab of the profile appears when a
 * session attaches, and stopping the layer is what takes it down.
 *
 * The browser is still asked what it grants rather than a flag being kept somewhere, for the same
 * reason `storage/watched-domains.ts` asks: an enterprise policy or a Chrome the manifest outlives
 * can withhold it, and a layer that assumed the API was there would attach into `undefined`.
 */

/** Whether the browser currently grants it. */
export function hasDebuggerAccess(): Promise<boolean> {
  return browser.permissions.contains({ permissions: ['debugger'] });
}
