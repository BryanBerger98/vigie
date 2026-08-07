import type {
  ConsoleEntry,
  ErrorEntry,
  HttpHeader,
  NetworkEntry,
  ReportBundle,
  ReportGap,
} from '@vigie/contract';

/**
 * The report, rendered. One format for every recipient (`spec.md:15`), and that recipient is
 * assumed to be an agent reading pasted text with no reformatting.
 *
 * ## The four decisions the shape rests on
 *
 * - **The gaps come first.** A reader has to know what the report cannot show before drawing a
 *   conclusion from an absence, and a footnote is read after the conclusion has been drawn.
 * - **One chronological thread.** Network, console and errors interleaved by timestamp, because
 *   that is the order of causes: the log line that precedes a failed request is the one that
 *   explains it, and two separate sections would put them pages apart.
 * - **No tables, no deep nesting.** An hour of a busy tab can exceed the context window of
 *   whoever reads it, so the text has to survive being cut anywhere. A table cut in half loses
 *   its header and becomes unreadable; a block cut in half loses one block.
 * - **A full timestamp on every entry line.** Redundant, and deliberately so: a fragment pasted
 *   out of the middle of a report still says when it happened, and a window straddling midnight
 *   cannot read as going backwards.
 *
 * What is *not* decided here is size. A report carries every header of every request, untrimmed,
 * because a debugging capture that quietly drops the header the reader was looking for is worse
 * than a long one. Trimming, if it ever happens, is a product decision and belongs to a phase that
 * has measured what a real report weighs.
 */

/** Two spaces between the columns of an entry line: greppable, and never mistaken for indentation. */
const COLUMN = '  ';

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

/** Indents every line of a block, so a multi-line console argument keeps its shape. */
function indent(text: string, by: number): string[] {
  const padding = ' '.repeat(by);
  return text.split('\n').map((line) => `${padding}${line}`);
}

function headerLines(label: string, headers: HttpHeader[] | undefined): string[] {
  if (!headers || headers.length === 0) return [];
  return [`  ${label}:`, ...headers.map((header) => `    ${header.name}: ${header.value}`)];
}

function count(bundle: ReportBundle, kind: string): number {
  return bundle.entries.filter((entry) => entry.kind === kind).length;
}

function reportHeader(bundle: ReportBundle): string[] {
  const { window, subject } = bundle;

  return [
    `# Vigie report — ${known(subject.domain)}`,
    '',
    `Subject: ${known(subject.domain)}, tab ${subject.tabId}`,
    `URL: ${known(subject.url)}`,
    ...(subject.title ? [`Title: ${subject.title}`] : []),
    `Window: ${minutes(window.requestedDepthMinutes)} min requested, ${minutes(window.coveredDepthMinutes)} min covered`,
    `Covering: ${iso(window.from)} to ${iso(window.to)}`,
    `Entries: ${bundle.entries.length} (${count(bundle, 'network')} network, ${count(bundle, 'console')} console, ${count(bundle, 'error')} error)`,
    `Produced by Vigie ${bundle.extensionVersion}, report schema ${bundle.schemaVersion}`,
  ];
}

function gapSection(gaps: ReportGap[]): string[] {
  if (gaps.length === 0) return [];
  return ['', '## What this report does not contain', '', ...gaps.map((gap) => `- ${gap.statement}`)];
}

/**
 * How a request ended, in one line. The three outcomes read differently on purpose: a reader
 * scanning for trouble should not have to parse a status code to notice a transport failure.
 */
function outcomeLine(entry: NetworkEntry): string {
  const duration = entry.durationMs === undefined ? '' : ` in ${Math.round(entry.durationMs)} ms`;
  const type = entry.resourceType ? ` (${entry.resourceType})` : '';

  if (entry.outcome === 'failed') {
    return `  failed${duration}: ${known(entry.error)}${type}`;
  }
  if (entry.outcome === 'pending') {
    return `  still open when the report was cut${type}`;
  }
  return `  completed ${entry.statusCode ?? '(no status)'}${duration}${type}`;
}

function networkBlock(entry: NetworkEntry): string[] {
  return [
    `${iso(entry.timestamp)}${COLUMN}network${COLUMN}${entry.method} ${entry.url}`,
    outcomeLine(entry),
    ...headerLines('request headers', entry.requestHeaders),
    ...(entry.requestBody === undefined
      ? []
      : ['  request body:', ...indent(entry.requestBody, 4)]),
    ...headerLines('response headers', entry.responseHeaders),
    // Stated on every single request, never omitted: this is the absence a reader is most likely
    // to mistake for an empty response (`prd.md:79`).
    '  response body: not available',
  ];
}

function consoleBlock(entry: ConsoleEntry): string[] {
  return [
    `${iso(entry.timestamp)}${COLUMN}console${COLUMN}${entry.level}`,
    ...indent(entry.text, 2),
    ...(entry.truncated ? ['  (text truncated by the capture)'] : []),
  ];
}

function errorBlock(entry: ErrorEntry): string[] {
  return [
    `${iso(entry.timestamp)}${COLUMN}error${COLUMN}${entry.source}`,
    ...indent(entry.message, 2),
    ...(entry.stack ? ['  stack:', ...indent(entry.stack, 4)] : []),
    ...(entry.truncated ? ['  (truncated by the capture)'] : []),
  ];
}

function timelineSection(bundle: ReportBundle): string[] {
  if (bundle.entries.length === 0) {
    // Said outright. An empty section reads as a rendering failure, and a reader who cannot tell
    // the two apart will go looking for a bug in the wrong place.
    return ['', '## Timeline', '', 'No entry was captured in this window.'];
  }

  const blocks = bundle.entries.map((entry) => {
    if (entry.kind === 'network') return networkBlock(entry);
    if (entry.kind === 'console') return consoleBlock(entry);
    return errorBlock(entry);
  });

  return ['', '## Timeline', '', ...blocks.flatMap((block) => [...block, ''])].slice(0, -1);
}

export function renderReport(bundle: ReportBundle): string {
  return [...reportHeader(bundle), ...gapSection(bundle.gaps), ...timelineSection(bundle)].join(
    '\n',
  );
}
