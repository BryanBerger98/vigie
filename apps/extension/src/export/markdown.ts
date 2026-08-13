import {
  GAP_SUMMARIES,
  type CaptureEntry,
  type ConsoleEntry,
  type ErrorEntry,
  type HttpHeader,
  type NetworkEntry,
  type ReportBundle,
  type ReportGap,
  type ResponseBodyState,
} from '@vigie/contract';

import { BAD_STATUS_FROM, countEntries, isAnomalous, type EntryCounts } from './anomalies';
import { statusEmoji, statusLabel } from './status';

/**
 * The report, rendered. One format for every recipient (`spec.md:15`), and the first of those
 * recipients is a human — the product owner, the QA and the developer debugging their own
 * application. The agent that receives the pasted text comes second
 * (`spec-export-redesign.md:59`). Everything below follows from that order: what serves a human
 * scanning a page also serves an agent searching it, and the reverse is not true.
 *
 * ## What the shape rests on
 *
 * - **Framing before anything else.** A verdict line, then a table giving the subject, the window,
 *   the volume per kind and the number of anomalies. A reader has to know the scope and the size of
 *   what they hold before reading a line of it.
 * - **The gaps second.** What the report cannot show is read before a conclusion is drawn from an
 *   absence, and a footnote is read after the conclusion has been drawn. Each one leads with the
 *   short form so the list scans, and carries the full sentence so it convinces.
 * - **One chronological thread.** Network, console and errors interleaved by timestamp, because
 *   that is the order of causes: the log line that precedes a failed request is the one that
 *   explains it, and two separate sections would put them pages apart.
 * - **The identity first in a section title.** A title opens on what distinguishes the entry — the
 *   method and path, the level and first line — never on what every title shares. A column of
 *   headings that all begin with the same twenty-four characters of timestamp cannot be scanned,
 *   which is the one thing a heading is for. The timestamp moves into the block underneath, where
 *   it stays with any fragment cut out of the middle and costs nothing to read past.
 * - **What is code is set as code.** `GET /html/agendas/get_unplanned_bis.php` is a literal, not
 *   prose, and a heading that renders it in the same bold text as the words around it makes a
 *   reader parse where the identifier starts. A code span does that work typographically. The same
 *   holds for a status, a duration, a resource type and a URL.
 * - **A status is read, not decoded.** `500` alone asks the reader to know the registry;
 *   `500 Internal Server Error` does not, and the reader who most needs the report is the one who
 *   has not memorised it (`status.ts`).
 * - **One marker for every anomaly, and no index.** An anomalous entry opens on {@link ANOMALY} in
 *   place of its kind emoji, and the framing names that character so a reader knows what to search
 *   for. One search reaches the three failures of a report of three hundred entries, and nothing is
 *   republished — an index would restate every anomaly a second time, and then drift from it.
 * - **The meta block is quoted.** Everything a section says about itself before its content sits in
 *   one blockquote. It groups the fields, and it puts a rule between the entry and the next title —
 *   which is what a page of three hundred entries needs and what a run of bare lines cannot give.
 *
 * ## Emoji anchor a field, never carry it alone
 *
 * Every emoji sits beside a value that says the same thing: `✅ 200 OK` reads as a success with the
 * character stripped out, `🕑` precedes an ISO instant, `🔗` a URL. That is the same rule the
 * surface follows for colour (`design.md:28`), for the same reason — a channel a reader may not
 * have is a channel that cannot be the only one. It also bounds the count: an emoji that anchors no
 * field does not go in.
 *
 * ## The decisions this revokes
 *
 * A previous version rendered everything flat — no table, no folded block — so that the text
 * survived being cut at any point. That is given up here: a report cut in the middle of the framing
 * table or of a `<details>` is partially unusable. It is an accepted cost
 * (`spec-export-redesign.md:65`).
 *
 * A previous version also restated `Response body: not available.` under every single request. The
 * absence is still stated on every request — `prd.md:79` asks for it and it is the absence a reader
 * is most likely to mistake for an empty response — but as three words on the line that was already
 * there, not as a paragraph of its own. Three hundred requests used to mean three hundred repeated
 * sentences, and a sentence a reader learns to skip has stopped signalling anything.
 *
 * Folded blocks stay machine-readable: `<details>` hides content from a human eye, not from a
 * reader parsing the text, and everything inside one is present in the raw Markdown.
 *
 * What is *not* decided here is size. A report carries every header of every request, untrimmed,
 * because a debugging capture that quietly drops the header the reader was looking for is worse
 * than a long one. Trimming, if it ever happens, is a product decision and belongs to a phase that
 * has measured what a real report weighs.
 */

/**
 * The character every anomalous section opens on, and the one a reader is told to search for.
 *
 * Fixed and greppable — that is its whole job, and it is why one character covers all three kinds
 * rather than one per kind. A reader answering "what failed?" runs a single search; the kind is
 * still legible from the words of the title.
 */
const ANOMALY = '🛑';

/** The kind of an entry that is not an anomaly, in one character. */
const NETWORK = '🌐';
const CONSOLE = '💬';
const WARNING = '⚠️';

/** The two endings that are not a status, and the fields of a meta block. */
const FAILED = '💥';
const PENDING = '⏳';
const AT = '🕑';
const TOOK = '⏱';
const OF_TYPE = '📄';
const LINK = '🔗';

/**
 * What the meta line says about the response body, one phrase per state.
 *
 * The phrase carries the cause, because that is the only thing a reader can act on: an eviction is
 * a buffer to raise, a filter is a setting to widen, and a structural absence is neither. The entry
 * is the whole context — nothing here refers to another section or to the gap list.
 */
const RESPONSE_BODY_PHRASES: Record<ResponseBodyState, string> = {
  captured: 'response body captured',
  truncated: 'response body truncated',
  evicted: 'response body evicted from the capture buffer',
  unavailable: 'no response body',
  filtered: 'response body not requested',
  'out-of-session': 'response body out of session reach',
  unfinished: 'response body never delivered',
};

/** How much of an entry's own text a section title borrows before cutting it. */
const TITLE_LIMIT = 80;

/** An opening bracket a borrowed first line ends on, which would leave the title hanging open. */
const DANGLING_OPENER = /[([{<:,\-–—\s]+$/;

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/** Minutes as a human reads them: `15`, not `15.0`; `12.4`, not `12.43333`. */
function minutes(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * A duration a reader can compare at a glance.
 *
 * `30012 ms` and `2104 ms` are the same shape on the page and a reader has to count digits to tell
 * a timeout from a slow call. Past a second they are given in seconds, which is the unit the
 * difference is felt in.
 */
function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** A value that may be missing. Stated as unknown rather than rendered as a blank. */
function known(value: string | undefined): string {
  return value && value.length > 0 ? value : '(unknown)';
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `1 error`, `2 errors`. A count that disagrees with its noun reads as a rendering bug. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** A table cell. A pipe left unescaped — a query string carries them — would split the row. */
function cell(value: string): string {
  return value.replaceAll('|', '\\|');
}

/**
 * An inline code span.
 *
 * The delimiter grows past the longest run of backticks the value holds, for the same reason
 * {@link fence} does: a URL or a console line may carry one, and a single-backtick span would then
 * end in the middle of the value. A value that starts or ends on a backtick is padded, which
 * CommonMark strips back out on the way in.
 */
function code(value: string): string {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = '`'.repeat(longest + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${delimiter}${pad}${value}${pad}${delimiter}`;
}

/**
 * A link that still looks like the URL it points to.
 *
 * A code span alone is not clickable and a bare autolink is set in the body face, in the middle of
 * a block where every other value is monospaced. The two combine: the label is a code span, the
 * destination is the URL. The destination is bracketed because a URL may carry an unbalanced `)` —
 * a bare destination would end there. A URL holding `<`, `>` or a newline cannot be bracketed
 * either, so it falls back to a span that is merely unclickable rather than to a broken link.
 */
function link(url: string): string {
  return /[<>\n]/.test(url) ? code(url) : `[${code(url)}](<${url}>)`;
}

/**
 * The lines of a section's meta block, quoted so they read as one thing and not as loose prose.
 *
 * The two trailing spaces are a hard line break. Without them CommonMark joins the lines of a
 * blockquote into one paragraph, and the URL and the instants that follow it arrive on the reader's
 * screen as a single run-on line — which is exactly what the block exists to avoid.
 */
function quote(lines: string[]): string[] {
  const kept = lines.filter((line) => line.length > 0);
  return kept.map((line, index) => `> ${line}${index < kept.length - 1 ? '  ' : ''}`);
}

/**
 * The first line of a captured text, cut to what a section title can carry.
 *
 * Two things are dropped on the way. Backticks, because a cut lands wherever the character count
 * says it does — mid-pair as often as not — and a heading holding an odd number of them renders as
 * neither code nor text. And a trailing opener, because a log line that begins `checkout state {`
 * gave a title ending on a brace that said nothing; the object it opened is in the block below.
 */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0]!.replaceAll('`', '').trim();
  const cut = line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT).trimEnd()}…` : line;
  return cut.replace(DANGLING_OPENER, '');
}

/**
 * A fenced block, typed.
 *
 * The delimiter grows past the longest run of backticks the content holds. A captured console line
 * can itself contain a fence, and a three-backtick delimiter would then close the block in the
 * middle of the very text the reader came for.
 */
function fence(language: string, body: string): string[] {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = '`'.repeat(Math.max(3, longest + 1));
  return [`${delimiter}${language}`, body, delimiter];
}

/**
 * A folded block.
 *
 * The blank lines are not cosmetic: a fence glued to `<summary>` or to `</details>` is not rendered
 * as a fence, and what should have been a code block reaches the reader as one run-on line.
 */
function details(summary: string, body: string[]): string[] {
  return [`<details><summary>${summary}</summary>`, '', ...body, '', '</details>'];
}

/** Joins blocks with exactly one blank line between them, dropping the ones that produced nothing. */
function paragraphs(blocks: string[][]): string[] {
  return blocks
    .filter((block) => block.length > 0)
    .flatMap((block, index) => (index === 0 ? block : ['', ...block]));
}

/** A meta line: the parts an entry actually has, separated, with no dangling separator. */
function meta(parts: (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part.length > 0).join(' · ');
}

function headerDetails(label: string, headers: HttpHeader[] | undefined): string[] {
  if (!headers || headers.length === 0) return [];

  const lines = headers.map((header) => `${header.name}: ${header.value}`).join('\n');
  return details(`${label} (${headers.length})`, fence('http', lines));
}

/**
 * A payload, reformatted only where reformatting is safe.
 *
 * JSON is reindented: a minified payload is unreadable, and re-indenting it changes nothing a
 * reader relies on. Anything else goes through exactly as it was received — including a payload
 * that looks like JSON and does not parse, which is announced rather than repaired. That
 * malformation may well be the defect the report was cut for.
 *
 * `whole` is what separates a payload that failed to parse from one that was never meant to: a body
 * the capture cut at its ceiling does not parse by construction, and calling that malformed would
 * point a reader at a defect this tool introduced.
 */
function bodyBlock(label: string, body: string, whole: boolean): string[] {
  try {
    const reindented = JSON.stringify(JSON.parse(body) as unknown, null, 2);
    return details(label, fence('json', reindented));
  } catch {
    const malformed = whole && /^\s*[[{]/.test(body);
    return details(
      malformed ? `${label} — malformed JSON, left exactly as it was received` : label,
      fence('text', body),
    );
  }
}

function requestBodyBlock(body: string | undefined): string[] {
  return body === undefined ? [] : bodyBlock('Request body', body, true);
}

/**
 * The response body, when the capture reached one.
 *
 * Folded, and last in the section: it is the largest thing a request can carry, and a reader
 * scanning three hundred requests for one of them needs the titles to stay one screen apart. An
 * empty body renders no block at all — the meta line already says so, and an empty fence is a
 * question rather than an answer.
 */
function responseBodyBlock(entry: NetworkEntry): string[] {
  const body = entry.responseBodyText;
  if (body === undefined || body.length === 0) return [];

  const cut = entry.responseBody === 'truncated';
  return bodyBlock(cut ? 'Response body — cut at the capture ceiling' : 'Response body', body, !cut);
}

/** The path a request hit. The query string is on the URL line, where length costs nothing. */
function requestPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * How a request ended, anchored and named.
 *
 * A failure carries its transport cause here rather than in the block below: `net::ERR_CONNECTION_
 * TIMED_OUT` is the answer a reader opened the section for, and a title saying only `failed` sends
 * them one line further for it. A status carries its reason phrase for the same reason.
 */
function ending(entry: NetworkEntry): string {
  if (entry.outcome === 'failed') return `${FAILED} ${code(known(entry.error))}`;
  if (entry.outcome === 'pending') return `${PENDING} ${code('still open')}`;
  if (entry.statusCode === undefined) return code('no status');
  return `${statusEmoji(entry.statusCode)} ${code(statusLabel(entry.statusCode))}`;
}

/** The one character a section title opens on. */
function marker(entry: CaptureEntry): string {
  if (isAnomalous(entry)) return ANOMALY;
  if (entry.kind === 'network') return NETWORK;
  return entry.kind === 'console' && entry.level === 'warn' ? WARNING : CONSOLE;
}

/** A title: the marker, then what the entry is. An empty text must not leave a dangling dash. */
function title(entry: CaptureEntry, parts: (string | undefined)[]): string {
  const text = parts.filter((part) => part !== undefined && part.length > 0).join(' — ');
  return `### ${marker(entry)} ${text}`;
}

/**
 * What a section says about itself before its content.
 *
 * The state of the response body is stated here rather than on a line of its own — it holds for
 * every request of every report, and a sentence repeated three hundred times stops being read. It
 * stays on every request all the same: an absence stated once in the header and then omitted is an
 * absence a reader concludes from (`prd.md:79`).
 *
 * What it says now depends on the entry. Two layers write into the same report, and a reader has to
 * be able to explain why this request carries a body and its neighbour does not.
 *
 * The layer itself is not named here. It is the mechanism, and the answer to "why does this one
 * have no body" is the body state — `filtered`, `evicted`, `out-of-session` each say what to do
 * next, where `webRequest` says only which code path ran.
 */
function networkMeta(entry: NetworkEntry): string[] {
  return quote([
    `${LINK} ${link(entry.url)}`,
    meta([
      `${AT} ${code(iso(entry.timestamp))}`,
      entry.durationMs === undefined ? undefined : `${TOOK} ${code(duration(entry.durationMs))}`,
      entry.resourceType ? `${OF_TYPE} ${code(entry.resourceType)}` : undefined,
      responseBodyPhrase(entry),
    ]),
  ]);
}

/**
 * What the meta line says about this entry's body.
 *
 * A captured body of zero bytes is the one state the enum cannot express on its own: it is neither
 * an absence nor something to fold open, and saying "captured" next to no block at all would read
 * as a rendering that dropped it.
 */
function responseBodyPhrase(entry: NetworkEntry): string {
  if (entry.responseBody === 'captured' && entry.responseBodyText === '') return 'response body empty';
  return RESPONSE_BODY_PHRASES[entry.responseBody];
}

/** The meta block of an entry that is nothing but text: when it happened, and whether it is whole. */
function textMeta(entry: ConsoleEntry | ErrorEntry): string[] {
  return quote([
    meta([
      `${AT} ${code(iso(entry.timestamp))}`,
      entry.truncated ? 'truncated by the capture' : undefined,
    ]),
  ]);
}

function networkSection(entry: NetworkEntry): string[] {
  return paragraphs([
    [
      title(entry, [
        `${code(`${entry.method} ${requestPath(entry.url)}`)} → ${ending(entry)}`,
      ]),
    ],
    networkMeta(entry),
    headerDetails('Request headers', entry.requestHeaders),
    requestBodyBlock(entry.requestBody),
    headerDetails('Response headers', entry.responseHeaders),
    responseBodyBlock(entry),
  ]);
}

function consoleSection(entry: ConsoleEntry): string[] {
  return paragraphs([
    [title(entry, [code(`console.${entry.level}`), firstLine(entry.text)])],
    textMeta(entry),
    fence('text', entry.text),
  ]);
}

function errorSection(entry: ErrorEntry): string[] {
  return paragraphs([
    [title(entry, [code(entry.source), firstLine(entry.message)])],
    textMeta(entry),
    fence('text', entry.message),
    entry.stack ? details('Stack', fence('js', entry.stack)) : [],
  ]);
}

/** A volume with the anomalies it holds, or the bare figure when it holds none. */
function volume(total: number, anomalies: string[]): string {
  return anomalies.length === 0 ? String(total) : `${total} — ${anomalies.join(', ')}`;
}

/**
 * The one line a reader reads before deciding whether to read the rest, and the only place the
 * search token is named. A report with nothing wrong in it says so outright, rather than leaving
 * a zero in a table to be noticed.
 */
function verdict(counts: EntryCounts, covered: number): string {
  const window = `${minutes(covered)} min of capture`;
  if (counts.anomalies === 0) return `**Nothing failed** in ${window}.`;

  const noun = counts.anomalies === 1 ? 'anomaly' : 'anomalies';
  return `**${counts.anomalies} ${noun}** in ${window}. Search \`${ANOMALY}\` to reach them.`;
}

function framingTable(bundle: ReportBundle, counts: EntryCounts): string[] {
  const { window, subject } = bundle;

  const networkVolume = volume(counts.network.total, [
    ...(counts.network.failed > 0 ? [`${counts.network.failed} failed`] : []),
    ...(counts.network.badStatus > 0
      ? [`${counts.network.badStatus} with status ≥ ${BAD_STATUS_FROM}`]
      : []),
  ]);
  const consoleVolume = volume(
    counts.console.total,
    counts.console.errors > 0 ? [plural(counts.console.errors, 'error')] : [],
  );

  const rows: [string, string][] = [
    // The title is dropped when the tab had none, rather than rendered as unknown: a page with no
    // title is unremarkable, where a report with no URL is a report whose subject is in doubt.
    ['Page', meta([subject.title, `tab ${subject.tabId}`])],
    ['URL', known(subject.url)],
    [
      'Window',
      meta([
        `${iso(window.from)} → ${iso(window.to)}`,
        `${minutes(window.coveredDepthMinutes)} min covered of ${minutes(window.requestedDepthMinutes)} requested`,
      ]),
    ],
    ['Network', networkVolume],
    ['Console', consoleVolume],
    ['JS errors', String(counts.error.total)],
    ['Produced by', `Vigie ${bundle.extensionVersion} · report schema ${bundle.schemaVersion}`],
  ];

  return [
    `# Vigie report — ${known(subject.domain)}`,
    '',
    verdict(counts, window.coveredDepthMinutes),
    '',
    '| | |',
    '| --- | --- |',
    ...rows.map(([field, value]) => `| **${field}** | ${cell(value)} |`),
  ];
}

/**
 * The gaps, each led by its short form.
 *
 * The full sentence is what convinces a reader that an absence is structural; the short form is
 * what lets them find the one that applies to the conclusion they were about to draw. The list is
 * read once, in full, by someone who has not read it before — and skimmed by everyone else.
 */
function gapSection(gaps: ReportGap[]): string[] {
  if (gaps.length === 0) return [];
  return [
    '## What this report cannot show',
    '',
    // Capitalised here rather than in the contract: the short forms are written for a popup, where
    // they read as fragments of a sentence. Opening a bullet is a different job.
    ...gaps.map((gap) => `- **${capitalise(GAP_SUMMARIES[gap.kind])}.** ${gap.statement}`),
  ];
}

function timelineSection(bundle: ReportBundle): string[] {
  if (bundle.entries.length === 0) {
    // Said outright. An empty section reads as a rendering failure, and a reader who cannot tell
    // the two apart will go looking for a bug in the wrong place.
    return ['## Timeline', '', 'No entry was captured in this window.'];
  }

  const sections = bundle.entries.map((entry) => {
    if (entry.kind === 'network') return networkSection(entry);
    if (entry.kind === 'console') return consoleSection(entry);
    return errorSection(entry);
  });

  return ['## Timeline', '', ...paragraphs(sections)];
}

export function renderReport(bundle: ReportBundle): string {
  const counts = countEntries(bundle);

  return paragraphs([
    framingTable(bundle, counts),
    gapSection(bundle.gaps),
    timelineSection(bundle),
  ]).join('\n');
}
