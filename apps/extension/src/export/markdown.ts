import type {
  CaptureEntry,
  ConsoleEntry,
  ErrorEntry,
  HttpHeader,
  NetworkEntry,
  ReportBundle,
  ReportGap,
} from '@vigie/contract';

import { BAD_STATUS_FROM, countEntries, isAnomalous, type EntryCounts } from './anomalies';

/**
 * The report, rendered. One format for every recipient (`spec.md:15`), and that recipient is
 * assumed to be an agent reading pasted text with no reformatting.
 *
 * ## What the shape rests on
 *
 * - **Framing before anything else.** A table giving the subject, the window, the volume per kind
 *   and the number of anomalies. A reader has to know the scope and the size of what they hold
 *   before reading a line of it.
 * - **The gaps second.** What the report cannot show is read before a conclusion is drawn from an
 *   absence, and a footnote is read after the conclusion has been drawn.
 * - **One chronological thread.** Network, console and errors interleaved by timestamp, because
 *   that is the order of causes: the log line that precedes a failed request is the one that
 *   explains it, and two separate sections would put them pages apart.
 * - **A marker, not an index.** An anomalous entry carries `[!]` in its own section title. One
 *   search reaches the three failures of a report of three hundred entries, and nothing is
 *   republished — an index would restate every anomaly a second time, and then drift from it.
 * - **A full timestamp on every section title.** Redundant, and deliberately so: a fragment pasted
 *   out of the middle of a report still says when it happened, and a window straddling midnight
 *   cannot read as going backwards.
 *
 * ## The decision this revokes
 *
 * A previous version rendered everything flat — no table, no folded block — so that the text
 * survived being cut at any point. That is given up here: a report cut in the middle of the framing
 * table or of a `<details>` is partially unusable. It is an accepted cost
 * (`spec-export-redesign.md:65`). Being readable in full beats degrading gracefully when truncated,
 * and the framing that would be lost to a cut is the part a reader reads first anyway.
 *
 * Folded blocks stay machine-readable: `<details>` hides content from a human eye, not from a
 * reader parsing the text, and everything inside one is present in the raw Markdown.
 *
 * What is *not* decided here is size. A report carries every header of every request, untrimmed,
 * because a debugging capture that quietly drops the header the reader was looking for is worse
 * than a long one. Trimming, if it ever happens, is a product decision and belongs to a phase that
 * has measured what a real report weighs.
 */

/** The prefix an anomalous section title carries. Fixed and greppable — that is its whole job. */
const ANOMALY_MARKER = '[!] ';

/** How much of an entry's own text a section title borrows before cutting it. */
const TITLE_LIMIT = 80;

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/** Minutes as a human reads them: `15`, not `15.0`; `12.4`, not `12.43333`. */
function minutes(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** A value that may be missing. Stated as unknown rather than rendered as a blank. */
function known(value: string | undefined): string {
  return value && value.length > 0 ? value : '(unknown)';
}

/** `1 error`, `2 errors`. A count that disagrees with its noun reads as a rendering bug. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** A table cell. A pipe left unescaped — a query string carries them — would split the row. */
function cell(value: string): string {
  return value.replaceAll('|', '\\|');
}

/** The first line of a captured text, cut to what a section title can carry. */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0]!.trim();
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT)}…` : line;
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

function headerDetails(label: string, headers: HttpHeader[] | undefined): string[] {
  if (!headers || headers.length === 0) return [];

  const lines = headers.map((header) => `${header.name}: ${header.value}`).join('\n');
  return details(`${label} (${headers.length})`, fence('http', lines));
}

/**
 * A request body, reformatted only where reformatting is safe.
 *
 * JSON is reindented: a minified payload is unreadable, and re-indenting it changes nothing a
 * reader relies on. Anything else goes through exactly as it was received — including a payload
 * that looks like JSON and does not parse, which is announced rather than repaired. That
 * malformation may well be the defect the report was cut for.
 */
function requestBodyBlock(body: string | undefined): string[] {
  if (body === undefined) return [];

  try {
    const reindented = JSON.stringify(JSON.parse(body) as unknown, null, 2);
    return ['Request body:', '', ...fence('json', reindented)];
  } catch {
    const lead = /^\s*[[{]/.test(body)
      ? 'Request body, malformed JSON left exactly as it was received:'
      : 'Request body:';
    return [lead, '', ...fence('text', body)];
  }
}

/** The path a request hit, query included. The origin is on the line right under the title. */
function requestPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** How a request ended, in the few words a section title has room for. */
function endingWord(entry: NetworkEntry): string {
  if (entry.outcome === 'failed') return 'failed';
  if (entry.outcome === 'pending') return 'pending';
  return entry.statusCode === undefined ? 'no status' : String(entry.statusCode);
}

/**
 * How a request ended, in full, with the URL it ended for.
 *
 * The three outcomes read differently on purpose: a reader scanning for trouble should not have to
 * parse a status code to notice a transport failure. The whole URL is here rather than in the
 * title, which carries the path alone — a title long enough to hold an origin and a query string
 * stops being scannable, which is the one thing a title is for.
 */
function outcomeLine(entry: NetworkEntry): string {
  const duration = entry.durationMs === undefined ? '' : ` in ${Math.round(entry.durationMs)} ms`;
  const type = entry.resourceType ? ` · ${entry.resourceType}` : '';

  if (entry.outcome === 'failed') {
    return `${entry.url} · failed${duration}: ${known(entry.error)}${type}`;
  }
  if (entry.outcome === 'pending') {
    return `${entry.url} · still open when the report was cut${type}`;
  }
  return `${entry.url} · completed ${entry.statusCode ?? '(no status)'}${duration}${type}`;
}

function sectionTitle(entry: CaptureEntry, label: string): string {
  const marker = isAnomalous(entry) ? ANOMALY_MARKER : '';
  return `### ${marker}${iso(entry.timestamp)} · ${entry.kind} · ${label}`;
}

/** A title made of the parts an entry actually has. An empty text must not leave a dangling dot. */
function label(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join(' · ');
}

function networkSection(entry: NetworkEntry): string[] {
  return paragraphs([
    [sectionTitle(entry, `${entry.method} ${requestPath(entry.url)} → ${endingWord(entry)}`)],
    [outcomeLine(entry)],
    headerDetails('Request headers', entry.requestHeaders),
    requestBodyBlock(entry.requestBody),
    headerDetails('Response headers', entry.responseHeaders),
    // Stated on every single request, never once per report: this is the absence a reader is most
    // likely to mistake for an empty response (`prd.md:79`).
    ['Response body: not available.'],
  ]);
}

function consoleSection(entry: ConsoleEntry): string[] {
  return paragraphs([
    [sectionTitle(entry, label([entry.level, firstLine(entry.text)]))],
    fence('text', entry.text),
    entry.truncated ? ['(text truncated by the capture)'] : [],
  ]);
}

function errorSection(entry: ErrorEntry): string[] {
  return paragraphs([
    [sectionTitle(entry, label([entry.source, firstLine(entry.message)]))],
    fence('text', entry.message),
    entry.stack ? details('Stack', fence('js', entry.stack)) : [],
    entry.truncated ? ['(truncated by the capture)'] : [],
  ]);
}

/** A volume with the anomalies it holds, or the bare figure when it holds none. */
function volume(total: number, anomalies: string[]): string {
  return anomalies.length === 0 ? String(total) : `${total} (${anomalies.join(', ')})`;
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
    ['Subject', `${known(subject.domain)}, tab ${subject.tabId}`],
    ['URL', known(subject.url)],
    ...(subject.title ? [['Title', subject.title] as [string, string]] : []),
    [
      'Window',
      `${minutes(window.requestedDepthMinutes)} min requested, ${minutes(window.coveredDepthMinutes)} min covered`,
    ],
    ['Period', `${iso(window.from)} → ${iso(window.to)}`],
    ['Network', networkVolume],
    ['Console', consoleVolume],
    ['JS errors', String(counts.error.total)],
    ['Anomalies', String(counts.anomalies)],
    ['Produced by', `Vigie ${bundle.extensionVersion}, report schema ${bundle.schemaVersion}`],
  ];

  return [
    `# Vigie report — ${known(subject.domain)}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([field, value]) => `| ${field} | ${cell(value)} |`),
  ];
}

function gapSection(gaps: ReportGap[]): string[] {
  if (gaps.length === 0) return [];
  return ['## What this report does not contain', '', ...gaps.map((gap) => `- ${gap.statement}`)];
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
