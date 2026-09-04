# OpenCode plugins

This repository publishes independent OpenCode TUI plugins from `packages/`.

## Commands

- Use pnpm for workspace commands.
- Run `pnpm typecheck` and `pnpm test` before committing.
- Add a Changeset for package behavior changes. Skip it for docs and tooling only.

## Plugin compatibility

- Every plugin supports OpenCode 1 and OpenCode 2 from one npm version.
- The default export keeps `{ id, tui, setup }`.
- `tui` is the OpenCode 1 adapter. `setup` is the OpenCode 2 adapter.
- Never import `@opencode-ai/plugin` at runtime. Type-only imports are safe.
- Keep `@opentui/solid` and `solid-js` as optional peers.
- Publish compiled JavaScript under `dist/`. OpenCode skips JSX transforms inside `node_modules`.

## Layout

- Put shared, host-independent logic in ordinary `.ts` modules.
- Keep host adapters and JSX in `src/tui.tsx`.
- Unit tests run against built files under `dist/`.
- Keep package-specific details in each package README.

## Releasing

Changesets publishes packages independently through npm trusted publishing. Each published package must configure `vvo/opencode-plugins`, workflow `release.yml`, as its trusted publisher.
