# AI Operating Guidelines

How this team drives AI coding assistants on this project. Keep it short and specific to this repo.

## House rules

- Never widen the MV3 permission set on a whim. New capabilities go under `optional_permissions`, requested at use time — after checking the browser accepts them there: `debugger` is required precisely because Chrome drops it from that array at load and refuses every runtime request for it (`aidd_docs/memory/architecture.md:78`).
- Never add a network call that leaves the machine. Vigie has no backend by design; captured data stays in IndexedDB and OPFS.
- Never bump WXT off its pinned exact version without saying so. The project is pre-1.0 upstream and a minor can break the build layer.
- Every event shape crossing the SDK / extension boundary lives in `packages/contract` and bumps `schemaVersion` when it changes. No local redeclaration.
- Redaction is out of scope for the MVP. Do not add scrubbing "while you are at it" — it is tracked v2 debt and the trade-off was made deliberately.

## Validation depth

- A change inside one package: typecheck plus that package's unit tests.
- A change to `packages/contract`, to the capture pipeline, or to any MV3 permission: full build plus the Playwright run that loads the unpacked extension. These are the paths where a green unit suite proves nothing.
- Nothing merges with a failing typecheck. The MV3 surfaces are thinly typed and the compiler is the main guard.

## When the AI drifts

- Restate the layer being worked on in one sentence — SDK (page `MAIN` world), content script (bridge), service worker (orchestration), or offscreen document (video). Most drift is a change landing in the wrong one of the four.

For the general AIDD playbook (planning, review loops, prompting and context hygiene, anti-patterns), see the framework docs: <https://github.com/ai-driven-dev/framework>.
