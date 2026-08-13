import type { ConsoleEntry, ErrorEntry, HttpHeader, NetworkEntry } from '@vigie/contract';

import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/registry';
import type { Translator } from '@/i18n/translate';
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
 * The correspondence with the report is no longer word for word, since the report stays English
 * (`prd.md:55`). It is a correspondence of structure: the same fields, in the same order, under
 * names the glossary pairs up. The glossary is therefore where a reader finds which French term
 * designates which field of the report.
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

/**
 * The middle column: how it ended, in as few characters as the kind allows.
 *
 * A console level, an error source and a status code go through untranslated. They are what was
 * observed, and a captured value rendered in the reader's language is a value that was not observed.
 */
function label(entry: StoredEntry, t: Translator): string {
  if (entry.kind === 'console') return entry.level;
  if (entry.kind === 'error') return entry.source;
  if (entry.outcome === 'failed') return t('entry.label.failed');
  if (entry.outcome === 'pending') return t('entry.label.pending');
  return entry.statusCode === undefined ? t('entry.label.no-status') : String(entry.statusCode);
}

/** The identifying string: the URL, or the first line of what was written. */
function headline(entry: StoredEntry): string {
  if (entry.kind === 'network') return `${entry.method} ${entry.url}`;
  if (entry.kind === 'console') return oneLine(entry.text);
  return oneLine(entry.message);
}

/**
 * The same three sentences the report renders, so a reading here predicts the export.
 *
 * The resource type is a `chrome.webRequest.ResourceType` and the transport cause is Chrome's own
 * `net::ERR_*`: both travel through as they were observed, in their own parentheses.
 */
function outcomeText(entry: NetworkEntry, t: Translator): string {
  const duration =
    entry.durationMs === undefined
      ? ''
      : t('entry.outcome.duration', { ms: Math.round(entry.durationMs) });
  const type = entry.resourceType ? ` (${entry.resourceType})` : '';

  if (entry.outcome === 'failed') {
    return t('entry.outcome.failed', {
      duration,
      error: entry.error ?? t('entry.outcome.unknown-error'),
      type,
    });
  }
  if (entry.outcome === 'pending') return t('entry.outcome.pending', { type });

  return t('entry.outcome.completed', {
    status: entry.statusCode ?? t('entry.outcome.no-status'),
    duration,
    type,
  });
}

/**
 * Why this entry carries a response body, or why it does not.
 *
 * It used to say `not available — webRequest never exposes one`, on every request, forever. That was
 * true of the only layer there was; the deep layer reaches bodies, and the sentence has been a lie
 * on every deep entry since (`contract/events.ts:60`). What replaces it is the entry's own state,
 * which is also what the report says about it (`export/markdown.ts:114`).
 *
 * A captured body of zero bytes is the one state the enum cannot express on its own: neither an
 * absence nor something to show, and `captured` beside nothing at all reads as a rendering that
 * dropped it — the same exception the report makes (`export/markdown.ts:379`).
 */
function responseBodyKey(entry: NetworkEntry): MessageKey {
  if (entry.responseBody === 'captured' && entry.responseBodyText === '') return 'entry.body.empty';
  return `entry.body.${entry.responseBody}`;
}

/** The body itself, when the capture reached one. An empty one renders no block, as in the report. */
function responseBodyText(entry: NetworkEntry): string | undefined {
  const body = entry.responseBodyText;
  return body === undefined || body.length === 0 ? undefined : body;
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
  const { t } = useI18n();
  const body = responseBodyText(entry);

  return (
    <>
      <Line term={t('entry.term.outcome')}>{outcomeText(entry, t)}</Line>
      <Line term={t('entry.term.url')}>{entry.url}</Line>
      <Headers term={t('entry.term.request-headers')} headers={entry.requestHeaders} />
      {entry.requestBody === undefined ? null : (
        <Block term={t('entry.term.request-body')} text={entry.requestBody} />
      )}
      <Headers term={t('entry.term.response-headers')} headers={entry.responseHeaders} />
      {/*
        Stated on every single request, exactly as the report states it: this is the absence a
        reader is most likely to mistake for an empty response (`export/markdown.ts:348`). The body
        replaces the state line when there is one to show, so the column holds one fact per row.
      */}
      {body === undefined ? (
        <Line term={t('entry.term.response-body')}>{t(responseBodyKey(entry))}</Line>
      ) : (
        <Block term={t('entry.term.response-body')} text={body} />
      )}
      {entry.responseBody === 'truncated' ? (
        <Line term={t('entry.term.note')}>{t('entry.body.truncated')}</Line>
      ) : null}
    </>
  );
}

function ConsoleDetail({ entry }: { entry: ConsoleEntry }) {
  const { t } = useI18n();

  return (
    <>
      <Line term={t('entry.term.level')}>{entry.level}</Line>
      <Block term={t('entry.term.text')} text={entry.text} />
      {entry.truncated ? (
        <Line term={t('entry.term.note')}>{t('entry.note.text-truncated')}</Line>
      ) : null}
    </>
  );
}

function ErrorDetail({ entry }: { entry: ErrorEntry }) {
  const { t } = useI18n();

  return (
    <>
      <Line term={t('entry.term.source')}>{entry.source}</Line>
      <Block term={t('entry.term.message')} text={entry.message} />
      {entry.stack ? <Block term={t('entry.term.stack')} text={entry.stack} /> : null}
      {entry.truncated ? (
        <Line term={t('entry.term.note')}>{t('entry.note.truncated')}</Line>
      ) : null}
    </>
  );
}

export function EntryRow({ entry }: { entry: StoredEntry }) {
  const { t } = useI18n();
  // The badge marks an absence, so it is drawn only on an entry that really has nothing to show.
  // It used to sit on every network row, which made it say "network" rather than "no body".
  const missingBody = entry.kind === 'network' && responseBodyText(entry) === undefined;

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
            <span className="font-mono text-muted-foreground">{label(entry, t)}</span>
            <span className="min-w-0 flex-1 truncate">{headline(entry)}</span>
            {missingBody ? (
              <span
                data-testid="entry-no-body"
                title={t(responseBodyKey(entry as NetworkEntry))}
                className="shrink-0 rounded-sm border px-1 text-[10px] text-muted-foreground"
              >
                {t('entry.no-body')}
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
