/**
 * The English catalog: the reference every other language is measured against.
 *
 * Two things follow from that role and neither is decoration. Its keys *are* the `MessageKey`
 * type, so a key that exists nowhere fails to compile rather than to render (`registry.ts`). And
 * its sentences are the floor of the fallback chain, so a language that has not caught up shows
 * English rather than an empty label or a raw key (`translate.ts`).
 *
 * Keys read `surface.thing.state`, lowest common surface first. They are flat on purpose: a nested
 * catalog reads well and greps badly, and the one question worth answering fast is "who still says
 * this sentence".
 *
 * Interpolation is named — `{domain}`, never a positional slot. French does not keep the English
 * word order, so a positional catalog would force the translator to lie about what goes where.
 */

export const code = 'en';

/**
 * The language named in itself. It stays English in a French interface, exactly as `Français`
 * stays French in an English one: a list of languages is read by someone looking for their own.
 */
export const label = 'English';

export const messages = {
  'common.loading': 'Loading…',

  'language.title': 'Language',
  'language.description': 'Vigie follows your browser until you choose a language here.',
  'language.automatic': 'Automatic',
  'language.automatic.detected': 'Automatic — {language}',

  // The consent screen, and the copy of the disclosure the settings keep readable after it.
  'consent.heading': 'What Vigie records',
  'consent.promise':
    'Vigie keeps the last hour of what your browser does on the domains you designate, so you can hand over the context of a bug that already happened instead of trying to reproduce it.',
  'consent.captured.title': 'What Vigie captures',
  'consent.captured.network.title': 'Network traffic',
  'consent.captured.network.body':
    'Every request a watched tab makes: its URL, its method, its status code, its timing, and its raw request and response headers. Those headers carry authentication tokens, session cookies and API keys. Response bodies are captured only while deep capture is on: it stays off until you start it from the popup, and it then records the text of the responses a watched tab receives, up to 256 kB each.',
  'consent.captured.console.title': 'Console output',
  'consent.captured.console.body':
    'Everything the page writes to the console — log, info, warn, error and debug — with its arguments serialised as text. Whatever an application logs, including data about the people using it, is recorded exactly as it was logged.',
  'consent.captured.error.title': 'JavaScript errors',
  'consent.captured.error.body':
    'Uncaught exceptions and unhandled promise rejections, with their message and their stack trace.',
  'consent.limits.title': 'What bounds it',
  'consent.limit.local.title': 'Nothing leaves this machine',
  'consent.limit.local.body':
    'Vigie has no server, no account and no telemetry. What it records stays in this browser profile until you export a report yourself.',
  'consent.limit.scope.title': 'Nothing outside the domains you designate',
  'consent.limit.scope.body':
    'Capture happens only on the domains you add, and only while the browser grants Vigie access to them. Every other site is never observed and never stored.',
  'consent.limit.hour.title': 'Nothing older than one hour',
  'consent.limit.hour.body':
    'Anything captured more than an hour ago is deleted. You can also erase everything at once from the settings, at any time.',
  'consent.policy': 'Privacy policy',
  'consent.accept': 'I agree — start capturing',
  'consent.accept.until': 'Until then Vigie captures nothing, on any site.',
  'consent.accepted': 'Agreed on {date}. Vigie is capturing on the domains you designate.',
  'consent.accepted.options': 'Choose the domains to watch',
  'consent.stale':
    'What Vigie captures has changed since you last agreed. Capture is stopped until you have read the updated text below.',

  // The gate every surface shows instead of itself while the capture is locked.
  'consent.gate.title': 'Vigie has not started capturing',
  'consent.gate.body': 'Nothing is captured until you have read what Vigie records and agreed to it.',
  'consent.gate.stale.title': 'What Vigie captures has changed',
  'consent.gate.stale.body':
    'Nothing is being captured until you have read the updated disclosure and agreed to it.',
  'consent.gate.open': 'Read what Vigie records',

  'options.intro':
    'Vigie only captures on the domains listed below, and only while the browser grants it access to them.',
  'options.disclosure.open': 'Open the full disclosure',

  'domains.title': 'Watched domains',
  'domains.empty': 'No domain is watched yet. Nothing is being captured.',
  'domains.access.granted': 'Access granted',
  'domains.access.missing': 'Access missing — grant it again to capture',
  'domains.remove': 'Remove {domain}',
  'domains.remove.warning':
    'Removing {domain} revokes its access and erases everything captured for it. This cannot be undone.',
  'domains.remove.confirm': 'Remove and erase',
  'domains.remove.cancel': 'Cancel',
  'domains.add.label': 'Domain to watch',
  'domains.add.submit': 'Add',
  'domains.add.invalid': '"{value}" is not a domain. Try example.com, or paste a URL.',
  'domains.add.refused': 'Chrome did not grant access to {domain}, so it was not added.',
  'domains.add.failed': 'Something went wrong while adding "{value}".',

  'store.title': 'What is stored right now',
  'store.count': 'Entries held',
  'store.bytes': 'Space used',
  'store.oldest': 'Oldest entry',
  'store.oldest.none': 'nothing stored',
  'store.oldest.recent': 'less than a minute ago',
  'store.oldest.minutes': '{count} min ago',
  'store.oldest.hours': '{count} h ago',
  'store.empty': 'Nothing captured yet. Vigie writes only while a watched domain is open.',
  'store.retention':
    'Anything captured more than {minutes} minutes ago is deleted on its own. Erasing everything below does not stop the capture: watched domains stay watched, and the next hour starts from empty.',
  'store.purge': 'Erase everything captured',
  'store.purge.failed': 'Could not erase the capture: {reason}',
  'store.refresh': 'Refresh',
  'store.entries.one': '{count} entry',
  'store.entries.other': '{count} entries',

  // The scope of a tab, worded once for the popup and the side panel alike. Two surfaces naming
  // the same state differently would be two truths about it (`sidepanel/App.tsx:60`).
  'scope.loading': 'Reading the scope of this tab…',
  'scope.none.label': 'No page to report on',
  'scope.none.detail':
    'This window has no web page open, so there is nothing being captured to export.',
  'scope.out.label': 'Out of scope',
  'scope.out.detail':
    '{host} is not watched. Nothing on this tab is being captured, and nothing from before it is watched can ever be exported.',
  'scope.out.watch': 'Watch {domain}',
  'scope.revoked.label': 'Degraded — host access revoked',
  'scope.revoked.detail':
    '{domain} is still on the watched list, but Chrome no longer grants access to it, so nothing is being captured. Grant it again from the settings.',
  'scope.shrunk.label': 'Degraded — window shortened',
  'scope.shrunk.detail':
    '{domain} is being captured, but storage pressure pushed the oldest entries out: {minutes} min are held instead of 60.',
  'scope.capturing.label': 'Capturing',
  'scope.capturing.detail.one': '{domain} is watched. {count} entry captured on this tab.',
  'scope.capturing.detail.other': '{domain} is watched. {count} entries captured on this tab.',

  'popup.settings': 'Open the settings',
  'popup.sidepanel': 'Inspect live',
  'popup.context.none': 'No tab selected.',
  'popup.context.empty':
    '{domain} · tab {tabId} · nothing captured on this tab yet, so a report would come out empty.',
  'popup.context.held.one':
    '{domain} · tab {tabId} · {minutes} min available, {count} entry on this tab.',
  'popup.context.held.other':
    '{domain} · tab {tabId} · {minutes} min available, {count} entries on this tab.',

  'interruption.label': 'Capture interrupted',
  'interruption.detail': 'Vigie was updated, and the update stopped the capture that was running.',

  'export.title': 'Export the last',
  'export.run': 'Export {minutes} min',
  'export.menu': 'Choose another depth',
  'export.depth': '{minutes} min',
  'export.depth.locked': 'needs {previous} min of capture, {held} min held',
  'export.no-subject': 'This window has no web page to report on.',
  'export.idle.headline': 'Nothing exported yet',
  'export.idle.detail': 'One click, and the report lands in your downloads as a Markdown file.',
  'export.working.headline': 'Cutting the last {minutes} min…',
  'export.failed.headline': 'Export failed',
  'export.refused.headline': 'Not saved',
  'export.refused.detail':
    'The report is ready, but the browser refused to write it: {reason}',
  'export.saved.headline': 'Saved {filename}',
  'export.saved.empty':
    'Nothing was captured on this tab in the last {minutes} min, so the report is empty.',
  'export.saved.entries.one': '{count} entry.',
  'export.saved.entries.other': '{count} entries.',
  'export.saved.shorter':
    'It covers {covered} min, not the {requested} min asked: the capture does not reach further back.',
  'export.saved.gaps': 'Declared in the report: {gaps}.',

  // The four gaps, in the few words a control surface has room for. Their long form stays in the
  // contract and stays English: it is rendered in the report, which no language setting touches.
  'export.gap.response-bodies-unavailable': 'no response bodies without the deep layer',
  'export.gap.browser-messages-out-of-reach': 'no browser-generated messages',
  'export.gap.capture-started-after-page-load': 'nothing before the page had loaded',
  'export.gap.window-shrunk-by-quota': 'window shortened by storage pressure',

  'deep.unavailable.label': 'Deep capture unavailable',
  'deep.unavailable.version':
    'Chrome {version} cannot keep the capture running in the background. Response bodies need Chrome {required} or later.',
  'deep.unavailable.browser':
    'This browser is not a Chrome, so the response body capture cannot run here. Everything else keeps working.',
  'deep.canceled.label': 'Deep capture stopped from the banner',
  'deep.canceled.detail':
    'You canceled from the Chrome banner, which ended every session at once. Nothing will re-attach on its own — start it again whenever you want it back.',
  'deep.active.label': 'Deep capture on',
  'deep.active.detail.one':
    'Response bodies are being captured on {count} watched tab. The Chrome banner stays up until you stop it.',
  'deep.active.detail.other':
    'Response bodies are being captured on {count} watched tabs. The Chrome banner stays up until you stop it.',
  'deep.stopped.label': 'Deep capture off',
  'deep.stopped.detail':
    'Requests are captured, their response bodies are not. Turning it on attaches the Chrome debugger to every watched tab, and Chrome shows a banner on them until you stop it.',
  'deep.start': 'Start deep capture',
  'deep.stop': 'Stop deep capture',
  'deep.start.failed': 'Could not start it: {reason}',
  'deep.stop.failed': 'Could not stop it: {reason}',

  // The thread of the side panel: its two edges, and what it says when it holds nothing.
  'thread.empty':
    'Nothing captured on this tab in the last hour. What happens next appears here on its own.',
  'thread.older.one': 'Show older — {count} more entry held in this window',
  'thread.older.other': 'Show older — {count} more entries held in this window',
  'thread.edge.kept': 'Start of the window — one hour',
  'thread.edge.kept.detail':
    'Vigie holds one hour. Anything this tab did before this point has been purged — a deletion, not a gap in the capture.',
  'thread.edge.shortened': 'Start of the window — shortened',
  'thread.edge.shortened.detail':
    'Storage pressure pushed the oldest entries out early: this thread reaches back {minutes} min instead of {floor}. What came before it was purged.',

  // The terms of an unfolded entry. They name the fields of the report section the same entry
  // becomes, in the same order — which is the correspondence left once the report stays English.
  'entry.term.outcome': 'outcome',
  'entry.term.url': 'url',
  'entry.term.request-headers': 'request headers',
  'entry.term.request-body': 'request body',
  'entry.term.response-headers': 'response headers',
  'entry.term.response-body': 'response body',
  'entry.term.level': 'level',
  'entry.term.text': 'text',
  'entry.term.note': 'note',
  'entry.term.source': 'source',
  'entry.term.message': 'message',
  'entry.term.stack': 'stack',

  // How a request ended. A status code is a captured value and travels through untranslated; these
  // are the three endings that have no number to show.
  'entry.label.failed': 'failed',
  'entry.label.pending': 'pending',
  'entry.label.no-status': 'no status',

  // The same three sentences the report renders, assembled from named parts because French keeps
  // neither the word order nor the punctuation. `duration` and `type` carry their own leading space:
  // both are absent more often than not, and a sentence must not end up with a hole in it.
  'entry.outcome.failed': 'failed{duration}: {error}{type}',
  'entry.outcome.pending': 'still open{type}',
  'entry.outcome.completed': 'completed {status}{duration}{type}',
  'entry.outcome.duration': ' in {ms} ms',
  'entry.outcome.unknown-error': '(unknown)',
  'entry.outcome.no-status': '(no status)',

  // Why this request carries a body, or why it does not — the seven states of the contract, worded
  // for a column rather than for a meta line (`contract/events.ts:60`). The layer is not named: the
  // state is what says what to do next, where `webRequest` says only which code path ran.
  'entry.body.captured': 'captured, whole',
  'entry.body.truncated': 'captured, cut at the capture ceiling',
  'entry.body.evicted': 'evicted from the capture buffer before it could be read',
  'entry.body.unavailable': 'not captured — deep capture was not running on this tab',
  'entry.body.filtered': 'not requested — outside what a report can hold',
  'entry.body.out-of-session': 'out of reach — the request straddled the deep capture session',
  'entry.body.unfinished': 'never delivered — the request did not conclude',
  'entry.body.empty': 'captured, empty',
  'entry.no-body': 'no body',

  'entry.note.text-truncated': 'text truncated by the capture',
  'entry.note.truncated': 'truncated by the capture',
};
