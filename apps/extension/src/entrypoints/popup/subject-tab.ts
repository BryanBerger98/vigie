import type { SubjectTab } from './state';

/**
 * Which tab the report is about.
 *
 * Almost always the active one — the popup opens over the page the user is looking at, and
 * `activeTab` is what makes its address readable at that moment. The single exception is the
 * popup rendered as a full page of the extension's own origin, which happens when someone opens
 * `popup.html` in a tab and is how the end-to-end suite drives it. The active tab is then the
 * popup itself, and reporting on it would produce a report about `chrome-extension://` — or, more
 * often, about nothing at all, since Chrome withholds the address of a tab the extension holds no
 * permission for and an extension page is never covered by a host permission.
 *
 * Which of the two situations this is cannot be read off the active tab's URL for exactly that
 * reason. It is asked of `tabs.getCurrent()` instead: it answers with a tab only when the document
 * calling it *is* a tab, and a browser-rendered popup never is.
 *
 * The fallback then picks the web tab the user touched last. Anything the active tab may otherwise
 * be — `chrome://settings`, a PDF viewer, a tab whose address the browser withholds — resolves to
 * no subject at all. Guessing there would silently report on a neighbouring tab, which reads
 * exactly like a correct report about the wrong page.
 */

/** Schemes a report can be cut from. The same two the capture writes (`storage/scope.ts:19`). */
const WEB_SCHEMES = ['http:', 'https:'];

/**
 * The slice of `chrome.tabs.Tab` this needs. `lastAccessed` is Chrome 121+ and absent from older
 * type packages, so it is declared here rather than assumed present on the browser's own type.
 */
interface QueriedTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  index: number;
  lastAccessed?: number;
}

function asSubject(tab: QueriedTab): SubjectTab | null {
  if (tab.id === undefined || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (!WEB_SCHEMES.includes(url.protocol)) return null;
    return { tabId: tab.id, url: tab.url, title: tab.title, host: url.hostname };
  } catch {
    return null;
  }
}

export async function resolveSubjectTab(): Promise<SubjectTab | null> {
  const [own, tabs] = await Promise.all([
    browser.tabs.getCurrent(),
    browser.tabs.query({ currentWindow: true }) as Promise<QueriedTab[]>,
  ]);

  if (!own) {
    const active = tabs.find((tab) => tab.active);
    return active ? asSubject(active) : null;
  }

  const [mostRecent] = tabs
    .filter((tab) => tab.id !== own.id && asSubject(tab) !== null)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || b.index - a.index);

  return mostRecent ? asSubject(mostRecent) : null;
}
