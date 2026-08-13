# Design

The visual language: the design system, tokens, and UI conventions. What it looks like, not how it is coded.

> **State:** no UI code exists yet — `apps/extension/src/ui/` is not scaffolded. The system below is the chosen approach, not an observed one.

## System

- shadcn/ui on Tailwind: components are copied into `apps/extension/src/ui/` and owned by the project, not imported from a dependency. Editing one is normal, not a fork.
- Styling is Tailwind utility classes. No CSS-in-JS, no modules.
- The UI is three small panels — popup, side panel, options — not an application. Density beats layout ambition: the popup is a control surface, the side panel is a log reader.

## Tokens

- Tailwind theme plus the shadcn/ui CSS variables, in `apps/extension/src/ui/`. Point there for colors, spacing, and typography.
- Constraint specific to an extension: the UI renders inside browser chrome, not a page. It must hold up against both browser themes, and cannot assume a viewport size — the popup is a few hundred pixels wide.

## Components

- The states that actually matter here are capture states, not form states: **out of scope** (the current domain is not watched), **capturing context**, **recording** (a screen recording is running), and **degraded** (a capture layer unavailable). Every surface showing capture status renders all four.
- Out of scope is the state most likely to be misread, because nothing visibly happens either way. It has to be unmistakable, or the user discovers at export time that the past hour was never captured.
- `chrome.debugger` needs its own visible affordance: it is opt-in, and while attached Chrome shows its own banner on every tab whose Cancel button stops the layer everywhere at once (see `architecture.md`). The UI states that the layer is running and reflects a `canceled_by_user` stop rather than silently losing the layer. It does coexist with DevTools, in either order — that is not the conflict to surface.
- An interrupted capture is announced, never acted upon. When the service worker comes back from an extension update it re-attaches on its own, so the surface says the extension was updated and the capture interrupted — and offers nothing to click. It is a notice, not a prompt: any button here would ask the user to redo what the boot path already did. See `architecture.md` and `aidd_docs/backlog/tasks/capture-resume-notice.md`.
- The consent screen is a first-run blocking surface, not a dismissible banner. See `deployment.md` for why.

## Accessibility

- shadcn/ui builds on Radix primitives, so keyboard navigation and ARIA come from the components. Keep them rather than replacing with bare elements.
- Capture state is never conveyed by color alone — recording status carries a label or icon too.
