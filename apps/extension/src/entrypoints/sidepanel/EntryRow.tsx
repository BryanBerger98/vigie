import type { ConsoleEntry, ErrorEntry, HttpHeader, NetworkEntry } from '@vigie/contract';

import type { StoredEntry } from '@/storage/db';

/**
 * One entry of the thread: folded to a single line, unfolded to everything the store holds.
 *
 * Folded is the default because the thread is read by scanning it — an hour of a busy tab is
 * thousands of rows, and a row that opens by itself makes the scan impossible. What the fold shows
 * is what tells a reader whether to open it: when, what kind, how it ended, and the one string that
 * identifies it.
 *
 * The detail is the report's own content, laid out for a screen rather than for a paste
 * (`export/markdown.ts:194`). Nothing is summarised there: headers come out whole, because the
 * header a reader was looking for is the one a summary would have dropped.
 *
 * `<details>` rather than a piece of state: the browser already owns open-and-closed, keyboard
 * included, and a surface that must never write has no business keeping a per-entry flag anywhere.
 */

/** One mark per kind. Shape, not hue — the same rule the scope line follows (`design.md:28`). */
const MARK: Record<StoredEntry['kind'], string> = {
  network: '⇅',
  console: '›',
  error: '✗',
};

/** Clock time to the millisecond. Two entries inside the same second are the normal case. */
function clock(timestamp: number): string {
  const at = new Date(timestamp);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
}

/** What a fold can show of a multi-line value without becoming one. */
function oneLine(text: string): string {
  const [first = ''] = text.split('\n');
  return first;
}

/** The middle column: how it ended, in as few characters as the kind allows. */
function label(entry: StoredEntry): string {
  if (entry.kind === 'console') return entry.level;
  if (entry.kind === 'error') return entry.source;
  if (entry.outcome === 'failed') return 'failed';
  if (entry.outcome === 'pending') return 'pending';
  return String(entry.statusCode ?? 'no status');
}

/** The identifying string: the URL, or the first line of what was written. */
function headline(entry: StoredEntry): string {
  if (entry.kind === 'network') return `${entry.method} ${entry.url}`;
  if (entry.kind === 'console') return oneLine(entry.text);
  return oneLine(entry.message);
}

/** The same three sentences the report renders, so a reading here predicts the export. */
function outcomeText(entry: NetworkEntry): string {
  const duration = entry.durationMs === undefined ? '' : ` in ${Math.round(entry.durationMs)} ms`;
  const type = entry.resourceType ? ` (${entry.resourceType})` : '';

  if (entry.outcome === 'failed') return `failed${duration}: ${entry.error ?? '(unknown)'}${type}`;
  if (entry.outcome === 'pending') return `still open${type}`;
  return `completed ${entry.statusCode ?? '(no status)'}${duration}${type}`;
}

function Line({ term, children }: { term: string; children: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="break-all">{children}</dd>
    </>
  );
}

function Block({ term, text }: { term: string; text: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd>
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{text}</pre>
      </dd>
    </>
  );
}

function Headers({ term, headers }: { term: string; headers: HttpHeader[] | undefined }) {
  if (!headers || headers.length === 0) return null;
  return (
    <Block
      term={term}
      text={headers.map((header) => `${header.name}: ${header.value}`).join('\n')}
    />
  );
}

function NetworkDetail({ entry }: { entry: NetworkEntry }) {
  return (
    <>
      <Line term="outcome">{outcomeText(entry)}</Line>
      <Line term="url">{entry.url}</Line>
      <Headers term="request headers" headers={entry.requestHeaders} />
      {entry.requestBody === undefined ? null : (
        <Block term="request body" text={entry.requestBody} />
      )}
      <Headers term="response headers" headers={entry.responseHeaders} />
      {/*
        Stated on every single request, exactly as the report states it: this is the absence a
        reader is most likely to mistake for an empty response (`export/markdown.ts:203`).
      */}
      <Line term="response body">not available — webRequest never exposes one</Line>
    </>
  );
}

function ConsoleDetail({ entry }: { entry: ConsoleEntry }) {
  return (
    <>
      <Line term="level">{entry.level}</Line>
      <Block term="text" text={entry.text} />
      {entry.truncated ? <Line term="note">text truncated by the capture</Line> : null}
    </>
  );
}

function ErrorDetail({ entry }: { entry: ErrorEntry }) {
  return (
    <>
      <Line term="source">{entry.source}</Line>
      <Block term="message" text={entry.message} />
      {entry.stack ? <Block term="stack" text={entry.stack} /> : null}
      {entry.truncated ? <Line term="note">truncated by the capture</Line> : null}
    </>
  );
}

export function EntryRow({ entry }: { entry: StoredEntry }) {
  return (
    <li
      data-testid="entry-row"
      data-kind={entry.kind}
      data-at={entry.timestamp}
      // The virtualisation: the browser skips laying out and painting a row that is off screen,
      // and the intrinsic size keeps the scrollbar honest while it does. A thousand folded rows
      // then cost a thousand boxes instead of a thousand subtrees, with no windowing state of our
      // own — which an expandable row of unknown height would make wrong anyway.
      className="rounded-sm border-l-2 border-border pl-2 [contain-intrinsic-size:auto_1.5rem] [content-visibility:auto] data-[kind=error]:border-destructive"
    >
      <details>
        <summary
          data-testid="entry-summary"
          className="cursor-pointer select-none py-0.5 text-xs marker:text-muted-foreground"
        >
          <span className="inline-flex w-[calc(100%-1rem)] items-baseline gap-2 align-top">
            <span className="font-mono tabular-nums text-muted-foreground">
              {clock(entry.timestamp)}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              {MARK[entry.kind]}
            </span>
            <span className="font-mono text-muted-foreground">{label(entry)}</span>
            <span className="min-w-0 flex-1 truncate">{headline(entry)}</span>
            {entry.kind === 'network' ? (
              <span
                data-testid="entry-no-body"
                title="Response bodies are never captured."
                className="shrink-0 rounded-sm border px-1 text-[10px] text-muted-foreground"
              >
                no body
              </span>
            ) : null}
          </span>
        </summary>

        <dl
          data-testid="entry-detail"
          className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1 py-1 pl-4 text-xs"
        >
          {entry.kind === 'network' ? <NetworkDetail entry={entry} /> : null}
          {entry.kind === 'console' ? <ConsoleDetail entry={entry} /> : null}
          {entry.kind === 'error' ? <ErrorDetail entry={entry} /> : null}
        </dl>
      </details>
    </li>
  );
}
