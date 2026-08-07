# VCS

The version-control conventions this project follows: branches, commits, and the platform.

## Setup

- Main branch: `main`
- Platform: `github` — also hosts the privacy policy on GitHub Pages
- Ticketing: `none`

## Branches

- Format: `<type>/<short-description>`
- Types in use: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`

## Commits

- Convention: Conventional Commits — <https://www.conventionalcommits.org>
- Format: `type(scope): description`
- Scopes follow the workspace layout: `extension`, `sdk`, `contract`, `e2e`, `docs`
- Rules: imperative mood, lowercase subject, no trailing period
- A change to `packages/contract` that alters an event shape is a breaking change for `@vigie/sdk` consumers. Mark it `feat(contract)!:` and bump `schemaVersion` in the same commit.

## Commit Strategy

AI should auto commit: `after task done`
