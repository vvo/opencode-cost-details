# AGENTS.md

An opencode TUI plugin that appends a per-turn cost line to the sidebar Context
block. One published package serves both opencode 1 and opencode 2.

## Layout

- `src/turns.ts` — the turn/subagent cost math. Pure, host-agnostic, unit tested.
  Put logic here rather than in the host adapters.
- `src/tui.tsx` — the shared `CostLine` view plus two thin adapters: `tui(api)`
  for opencode 1, `setup(context)` for opencode 2.
- `test/turns.test.js` — runs against the **built** `dist/turns.js`, not `src/`.
- `scripts/build.mjs` — compiles every module listed in its `modules` array. Add
  new `src/` files there or they will not be emitted.

## Rules that are easy to get wrong

- **Never import `@opencode-ai/plugin` at runtime.** opencode 2 remaps that
  specifier to a host builtin, but opencode 1 resolves it to the real npm
  package, where the v2 exports do not exist. Types only, erased at build.
- **The default export must keep all three keys** (`{ id, tui, setup }`).
  opencode 1 validates `tui`, opencode 2 validates `setup`. Dropping either
  breaks that host with a generic "invalid plugin" toast.
- **`@opentui/solid` and `solid-js` stay optional peers.** Both hosts remap them
  to their own bundled copies. Installing them for real risks a second Solid
  instance and dead reactivity.
- **`dist/` is gitignored** and built by `npm test` / `prepublishOnly`. Do not
  commit it.
- **Requires Node 24+.** `node --test <dir>` fails on Node 22+, so the test
  script names the test file explicitly. Do not "simplify" it back to a directory.

## Verifying a change for real

Unit tests cover the math, but they do not prove the plugin renders. To check the
UI, install the built package into a host and read the sidebar. For a local
*directory* target, opencode 2 also needs an `index.js` beside `tui.js`; the
published package does not, because it resolves via `exports["./tui"]`.

opencode 1 reads TUI plugins from `~/.config/opencode/tui.json`, not
`opencode.json`.

## Releasing

Add a changeset in the same PR as the change:

```sh
npx changeset
```

Commit the generated `.changeset/*.md`. Omitting it means no release, which is
the right call for docs, tests, and tooling. Merging to `main` opens a version
PR; merging that publishes via npm trusted publishing (OIDC, no token).
