# Testing

How the project is tested: the layers, the tools, and the conventions. Where tests live and how to run them.

> **State:** no test exists yet and the harness is not installed — see `aidd_docs/INSTALL.md` install step 5. What follows is the agreed strategy, not an observed one.

## Strategy

- **Unit** — the pure logic: report assembly, Markdown rendering, export window slicing, context pruning arithmetic, watched-domain matching, contract type guards. This is where most coverage belongs because it needs no browser.
- **End-to-end** — anything touching a `chrome.*` API. Extension code cannot be meaningfully unit-tested: `tabCapture`, `offscreen`, `webRequest`, and `debugger` have no faithful mock. A green unit suite says nothing about them.
- No integration layer. With no backend there is nothing between the two.

## Tools

- Vitest — units, across every workspace.
- Playwright — e2e, launching Chrome with the unpacked build loaded (`--load-extension`).

## Conventions

- Unit tests sit next to the code they cover, inside their own package.
- E2E specs live in `e2e/` at the repository root, never inside `apps/extension`, because they exercise the built artifact rather than the source.
- Must be covered: the event contract in `packages/contract` (a silent shape drift breaks both consumers at runtime), the watched-domain filter (a leak there writes unwatched traffic to disk, which is the product's own privacy claim), the one-hour context pruning path, and the consent flow (a Chrome Web Store requirement).
- Not worth covering: React presentation components with no branching.

## Run

- Units: `pnpm turbo test`
- E2E: `pnpm turbo e2e` — requires a prior `pnpm turbo build`, Playwright loads the built extension, not the sources.

## Browser QA

- Entry: no application URL — the surface under test is the extension itself, loaded unpacked from the WXT dev build. Any page can serve as the capture target; a fixture page mounting `@vigie/sdk` is needed to exercise the SDK layer.
- Auth: none. The project has no accounts.
- State: a run starts from a clean profile. Both stores must be reset between runs — IndexedDB through Dexie's delete, OPFS by clearing the segment directory. The watched domain list lives in `chrome.storage` and must be reset too, or a spec inherits the previous run's scope and captures nothing. Reusing a profile carries stale context over and makes assertions non-deterministic.
