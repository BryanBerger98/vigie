import type { TabWindow } from '@/storage/live-query';
import { Button } from '@/ui/components/button';

import { EntryRow } from './EntryRow';
import { WindowEdge } from './WindowEdge';

/**
 * The thread: network, console and errors in one list, ascending timestamp, no filter.
 *
 * One list rather than three sections, for the same reason the report is one thread — the log line
 * that precedes a failed request is the one that explains it, and two sections put them pages apart
 * (`export/markdown.ts:19`). No filter either: sorting is forbidden at export
 * (`spec.md:14`), and a filter here would let a reader conclude from an absence the export does not
 * share, which is two truths about the same window.
 *
 * ## What "virtualising" means here
 *
 * Two mechanisms, and neither is a windowing library. Rows carry `content-visibility: auto`, so the
 * browser skips laying out and painting whatever is off screen — that is what keeps a scroll of
 * thousands of rows fluid. On top of it, only the newest slice is mounted at all, growable on
 * demand: React reconciling ten thousand rows on every live delivery is a cost `content-visibility`
 * cannot remove, since the elements still have to exist.
 *
 * A fixed-height virtual scroller was the other option and was rejected: rows unfold to unknown
 * heights, and a scroller that guesses them jumps under the reader's hands every time one opens.
 */

/** How many entries are mounted at once, and how many more each request adds. */
const RENDER_WINDOW = 200;

/** Distance from the bottom, in pixels, still counted as "the reader is at the live end". */
const AT_BOTTOM = 24;

interface TimelineProps {
  thread: TabWindow;
  /** Whether the last prune had to go past the hour to make room. Marks the low edge. */
  shrunk: boolean;
}

export function Timeline({ thread, shrunk }: TimelineProps) {
  const [mounted, setMounted] = useState(RENDER_WINDOW);
  const scroller = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);

  const hidden = Math.max(0, thread.entries.length - mounted);
  const visible = hidden === 0 ? thread.entries : thread.entries.slice(hidden);

  // The thread grows at the bottom, so it is followed — but only while the reader is already
  // there. Yanking someone back down while they are reading an entry from ten minutes ago is the
  // one way a live surface makes itself unusable.
  useEffect(() => {
    const node = scroller.current;
    if (node && following.current) node.scrollTop = node.scrollHeight;
  }, [thread.entries.length]);

  if (thread.entries.length === 0) {
    return (
      <p data-testid="timeline-empty" className="text-xs text-muted-foreground">
        Nothing captured on this tab in the last hour. What happens next appears here on its own.
      </p>
    );
  }

  return (
    <div
      data-testid="timeline"
      ref={scroller}
      onScroll={(event) => {
        const node = event.currentTarget;
        following.current = node.scrollHeight - node.scrollTop - node.clientHeight < AT_BOTTOM;
      }}
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
    >
      <WindowEdge thread={thread} shrunk={shrunk} />

      {hidden > 0 ? (
        <Button
          data-testid="timeline-older"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setMounted((count) => count + RENDER_WINDOW)}
        >
          {`Show older — ${hidden} more held in this window`}
        </Button>
      ) : null}

      <ol className="flex flex-col gap-0.5">
        {visible.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ol>
    </div>
  );
}
