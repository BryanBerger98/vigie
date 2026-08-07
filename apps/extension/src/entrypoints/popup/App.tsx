import {
  EMPTY_MEASUREMENT_STATE,
  MEASUREMENT_STATE_KEY,
  type MeasurementState,
} from '@/capture/network/listener-lifecycle';

/**
 * Popup shell. The export surface — four depth buttons, capture status — lands here in phase 8.
 *
 * What it shows now is the phase 2 measurement readout: the network event counter, the worker
 * start count and the host-permission changes. It exists so the measurement can be read without
 * opening DevTools on the service worker, and it goes away when phase 8 fills this in.
 *
 * The `data-testid` attributes are the handles the end-to-end suite reads; `popup-root` proves
 * the popup mounted and predates this phase.
 */
export default function App() {
  const [state, setState] = useState<MeasurementState>(EMPTY_MEASUREMENT_STATE);

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      const stored = await browser.storage.session.get(MEASUREMENT_STATE_KEY);
      const next = stored[MEASUREMENT_STATE_KEY] as MeasurementState | undefined;
      if (!cancelled) setState(next ?? EMPTY_MEASUREMENT_STATE);
    };

    void read();

    // `onChanged` alone would do, but the popup is also the thing that wakes a terminated worker
    // and the first read can land before it has written. Polling keeps the readout honest.
    const timer = setInterval(() => void read(), 500);
    browser.storage.session.onChanged.addListener(read);

    return () => {
      cancelled = true;
      clearInterval(timer);
      browser.storage.session.onChanged.removeListener(read);
    };
  }, []);

  const lastChange = state.permissionChanges.at(-1);

  return (
    <main
      data-testid="popup-root"
      className="flex w-80 flex-col gap-2 bg-background p-4 text-foreground"
    >
      <h1 className="text-sm font-semibold">Vigie</h1>

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Network events</dt>
        <dd data-testid="measure-network-events" className="text-right font-mono tabular-nums">
          {state.networkEvents}
        </dd>

        <dt className="text-muted-foreground">Worker starts</dt>
        <dd data-testid="measure-worker-starts" className="text-right font-mono tabular-nums">
          {state.workerStarts}
        </dd>

        <dt className="text-muted-foreground">Permission changes</dt>
        <dd data-testid="measure-permission-changes" className="text-right font-mono tabular-nums">
          {state.permissionChanges.length}
        </dd>
      </dl>

      <p data-testid="measure-last-permission" className="truncate text-xs text-muted-foreground">
        {lastChange
          ? `${lastChange.change}: ${lastChange.origins.join(', ') || '(none)'}`
          : 'No host permission granted yet.'}
      </p>
    </main>
  );
}
