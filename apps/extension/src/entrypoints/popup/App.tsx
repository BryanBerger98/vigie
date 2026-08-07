/**
 * Popup shell. The export surface — four depth buttons, capture status — lands here in phase 8.
 *
 * The `data-testid` is the handle the end-to-end suite uses to prove the extension loaded and
 * its popup mounted; keep it when the real content arrives.
 */
export default function App() {
  return (
    <main
      data-testid="popup-root"
      className="flex w-80 flex-col gap-1 bg-background p-4 text-foreground"
    >
      <h1 className="text-sm font-semibold">Vigie</h1>
      <p className="text-xs text-muted-foreground">Capture not wired yet.</p>
    </main>
  );
}
