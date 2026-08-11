interface TabContextLineProps {
  text: string;
}

/**
 * What the export will cover, stated before anything is clicked: the domain, the tab, and the
 * depth actually available. Its whole reason to exist is the empty case — a window holding
 * nothing has to be known before the copy, not read off the acknowledgement afterwards
 * (`phase-8.md:133`).
 */
export function TabContextLine({ text }: TabContextLineProps) {
  return (
    <p data-testid="tab-context" className="text-xs text-muted-foreground">
      {text}
    </p>
  );
}
