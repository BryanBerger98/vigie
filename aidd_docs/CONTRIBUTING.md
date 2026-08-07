# Contributing to this project's AI context

How to add or change the context the AI relies on here. For authoring AIDD skills, agents, rules, and templates, see the framework guide: <https://github.com/ai-driven-dev/framework/blob/main/CONTRIBUTING.md>.

## Changing project memory

Add or edit a file under `aidd_docs/memory/`. See [`memory/README.md`](memory/README.md) for what belongs there and how it loads.

## Adding AI content (skills, rules, agents, commands, hooks)

- Use the generator skills (`aidd-context:04-skill-generate` through `08-hook-generate`, and `10-learn` for memory or rules). They scaffold the right shape and write to the right place for each tool you use.
- Open a pull request for anything that changes how the AI behaves on this project. The team reviews it like any code change.

## Adding recipes

Create or edit project recipes under `aidd_docs/recipes/`. Use the cook skill when available so new recipes follow the shared contract and do not overwrite bundled framework recipes.

## House conventions

- A decision that shapes the architecture goes in `INSTALL.md` (the vision and its audit trail); a convention the AI must apply on every change goes in `memory/`. The two do not duplicate each other — `memory/` points to `INSTALL.md` for the why.
- Capture-layer knowledge (what the SDK, `webRequest`, and CDP can each observe) lives in `INSTALL.md`'s capability matrix. `memory/architecture.md` references it rather than copying it.
