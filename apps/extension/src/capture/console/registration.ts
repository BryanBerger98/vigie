import { hostPermissionPatterns } from '@/storage/scope';
import { hasHostAccess } from '@/storage/watched-domains';

/**
 * Registers the console capture scripts against the watched domains, and only those.
 *
 * This is the second scope barrier, and it is the stronger of the two: the write filter decides
 * what reaches the disk, this decides whether any code of ours runs on the page at all. A domain
 * the user never named never sees an injected script.
 *
 * ## Two scripts, two worlds
 *
 * `console` is a property of the page's own global, which an isolated world cannot reach. So the
 * patch has to run in the main world, and the main world cannot call `chrome.runtime`. Hence a
 * pair, both at `document_start`:
 *
 * ```txt
 * injected.js  (MAIN)      patches console, posts on the page's own message bus
 * content.js   (ISOLATED)  hears the bus, relays to the service worker
 * ```
 *
 * The main-world half is registered rather than injected from the isolated one. WXT's
 * `injectScript` appends a `<script src>`, and a dynamically inserted script is async: it loses the
 * race against the page's own first inline script every time — measured, not assumed. Registering
 * with `world: 'MAIN'` makes Chrome itself run the file before any page script, which is the only
 * way a log emitted while the page is loading can be captured at all.
 *
 * Ordering between the two is not guaranteed by Chrome, and does not need to be: both execute
 * synchronously at `document_start`, while `postMessage` delivery is a task. Nothing the patch
 * posts can be dispatched before the relay's listener exists.
 *
 * ## Why the granted domains rather than the watched ones
 *
 * `scripting.registerContentScripts` refuses a match pattern the extension has no host permission
 * for, and it refuses the whole call — one stale domain would silence the capture everywhere. The
 * list and the permissions can legitimately disagree, because Chrome lets the user revoke access
 * from its own settings without the extension being consulted, so each domain is checked first.
 *
 * ## Why it re-runs
 *
 * The registration outlives the service worker and the browser session, and the watched list can
 * change while the worker is asleep. Reapplying at every worker start and at every list change
 * costs one `getRegisteredContentScripts` call and removes a whole class of drift.
 */

/** Stable ids: reapplying has to update the existing registrations rather than add a second pair. */
export const RELAY_SCRIPT_ID = 'vigie-page-capture';
export const PATCH_SCRIPT_ID = 'vigie-page-patch';

/** Where WXT builds the two entrypoints. Verified against `.output/chrome-mv3`. */
export const RELAY_SCRIPT_FILE = 'content-scripts/content.js';
export const PATCH_SCRIPT_FILE = 'injected.js';

/** The subset of `chrome.scripting` used here, so the unit suite can hand over a double. */
export interface ScriptingApi {
  getRegisteredContentScripts(filter: { ids: string[] }): Promise<{ id: string }[]>;
  registerContentScripts(scripts: RegisteredScript[]): Promise<void>;
  updateContentScripts(scripts: RegisteredScript[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

export interface RegisteredScript {
  id: string;
  js: string[];
  matches: string[];
  runAt: 'document_start';
  allFrames: boolean;
  world: 'ISOLATED' | 'MAIN';
  persistAcrossSessions: boolean;
}

function scripting(): ScriptingApi {
  return browser.scripting as unknown as ScriptingApi;
}

/** The domains the browser really grants access to, in the order they were watched. */
async function grantedDomains(domains: readonly string[]): Promise<string[]> {
  const checks = await Promise.all(
    domains.map(async (domain) => ((await hasHostAccess(domain)) ? domain : null)),
  );
  return checks.filter((domain): domain is string => domain !== null);
}

/** The pair, aimed at `matches`. The relay comes first, so it is the first one Chrome registers. */
function consoleScripts(matches: string[]): RegisteredScript[] {
  const common = {
    matches,
    runAt: 'document_start',
    allFrames: true,
    // Kept across browser restarts on purpose: Chrome restores these before the first page of a
    // new session loads, whereas the worker only starts once something wakes it — too late.
    persistAcrossSessions: true,
  } as const;

  return [
    { ...common, id: RELAY_SCRIPT_ID, js: [RELAY_SCRIPT_FILE], world: 'ISOLATED' },
    { ...common, id: PATCH_SCRIPT_ID, js: [PATCH_SCRIPT_FILE], world: 'MAIN' },
  ];
}

/**
 * Makes the registered scripts match exactly `domains`, or removes them when none remain.
 *
 * Failures are logged and swallowed. This runs from the worker's startup path, where an exception
 * would take the network capture down with it — and a console capture that did not start is a
 * smaller loss than a worker that did not.
 */
export async function applyConsoleCaptureScope(domains: readonly string[]): Promise<void> {
  const ids = [RELAY_SCRIPT_ID, PATCH_SCRIPT_ID];

  try {
    const api = scripting();
    const registered = new Set(
      (await api.getRegisteredContentScripts({ ids })).map((script) => script.id),
    );
    const matches = (await grantedDomains(domains)).flatMap(hostPermissionPatterns);

    if (matches.length === 0) {
      const present = ids.filter((id) => registered.has(id));
      if (present.length > 0) await api.unregisterContentScripts({ ids: present });
      return;
    }

    // Registering an id that already exists throws, and so does updating one that does not, so the
    // two are split rather than one call being retried as the other.
    const scripts = consoleScripts(matches);
    const updates = scripts.filter((script) => registered.has(script.id));
    const additions = scripts.filter((script) => !registered.has(script.id));

    if (updates.length > 0) await api.updateContentScripts(updates);
    if (additions.length > 0) await api.registerContentScripts(additions);
  } catch (cause) {
    console.error('[vigie] could not apply the console capture scope', cause);
  }
}
