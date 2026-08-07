# Package

What this project ships as a reusable package: its public surface and release policy.

> **State:** `packages/sdk` is not scaffolded yet — see `aidd_docs/INSTALL.md` install step 3. What follows is the agreed contract; refresh it against the real `package.json` exports once written.

## Public API

- `@vigie/sdk` — the embeddable library host applications install. Single entry point, `packages/sdk/src/index.ts`.
- What it does: instruments `fetch`, XHR, `console`, WebSocket, `sendBeacon`, uncaught errors, and `ReportingObserver`, then emits to the extension through `postMessage`. It supplies the business context no browser API can infer — environment, user, page state, backend and library versions.
- Public: the init call, the application-context setter, and the event types re-exported from `@vigie/contract`.
- Internal: everything under `instrument/`, `observers/`, and `transport.ts`. The `postMessage` channel shape is an implementation detail, not a supported surface.
- `@vigie/contract` is a workspace package, **not published**. Its types reach consumers only through the SDK's re-exports.

## Consumers

- Installed from npm into the host application, bundled with it. Not a script tag.
- Output: ESM, CJS, and `.d.ts`, built with tsup.
- Runtime: browsers only. The SDK runs in the page's `MAIN` world and touches no `chrome.*` API — it must degrade silently when the extension is absent, since most page loads will not have it.
- No peer dependencies. The SDK is framework-agnostic by design; a peer dependency on a UI framework would halve its addressable surface.

## Versioning

- Semver on the npm package, independent of the extension's Chrome Web Store version. They ship on different channels and cannot be kept in lockstep.
- The real compatibility axis is `schemaVersion` in `@vigie/contract`, not the package version. The extension checks it on the first event and must handle both a newer and an older SDK — a host application will not upgrade on the extension's schedule.
- Breaking change: removing or renaming an emitted event field, or bumping `schemaVersion`. Adding an optional field is not.
