# opencode-cost-details

[OpenCode](https://opencode.ai) TUI plugin that shows how much each prompt turn costs, right in the sidebar:

```
Context
125,661 tokens
13% used
$0.85 spent
current $0.12, previous $0.31
```

- `current`: cost of the turn in progress (updates live while the agent works), or the last finished turn.
- `previous`: cost of the turn before that.

Useful to spot when a single question burns way more money than expected.

Works on both opencode 1 and opencode 2 from the same version.

## Install

opencode 2, in `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["-opencode.sidebar.context", "opencode-cost-details"]
}
```

The `-opencode.sidebar.context` entry hides the built-in Context section, which this plugin renders itself. Without it you get the section twice. opencode 2 has no API for a plugin to hide a built-in section on its own.

opencode 1, in `~/.config/opencode/tui.json` (TUI plugins are configured there, not in `opencode.json`):

```json
{
  "plugin": ["opencode-cost-details"]
}
```

No extra entry needed there: opencode 1 lets the plugin hide the built-in section itself, and restores it if you remove the plugin.

Then restart opencode.

Subagent (task tool) spend is included in the turn costs, which is usually the difference between this line and the `spent` total above it.

opencode 1 leaves subagent spend out of that total entirely. opencode 2 adds it, but only for the subagent sessions it has already loaded, and only one level deep, so a session with nested subagents still reads low.

## How it works

The plugin renders the sidebar Context section itself: the same tokens, percent used, and spent lines opencode shows, plus the turn costs, so all four read as one group. The token and cost figures are computed the way the host computes them, and verified against the built-in section.

A turn starts at every user message. Costs come from the TUI's own message state, which updates live while the agent works. Because that state only keeps the most recent messages (20 on opencode 2), the plugin also backfills the last two turns from the server on first render of a session, and fetches subagent sessions with their costs.

Subagent spend is followed through `session.usage.updated` on opencode 2 and `session.updated` on opencode 1.

### One package, both hosts

The default export is `{ id, tui, setup }`. opencode 1 validates and calls `tui`, opencode 2 validates and calls `setup`, and neither rejects the other's key. Nothing is imported from `@opencode-ai/plugin` at runtime: on opencode 2 that specifier is remapped to a host builtin, but on opencode 1 it resolves to the real npm package, where the v2 exports do not exist.

`exports["./tui"]` points at prebuilt JS, not the `.tsx` source. opencode's Solid JSX transform skips any path containing `node_modules`, and that is where plugins get installed, so a plugin shipping JSX source never loads. `@opentui/solid` and `solid-js` are peer dependencies but marked optional, because both hosts remap those imports to their own bundled copies — installing them is unnecessary and would risk a second Solid instance.

## Caveats

- Models without pricing metadata show $0.00.
- A subagent's cost is attributed to the turn that created it. If a later turn resumes the same subagent, that extra spend still lands on the creation turn.
- Only direct subagents are counted; a subagent's own subagents are not. opencode has the same limit: it fetches children by `parentID`, one level deep.
- A `$` shell command counts as its own turn, because opencode records it as a user message.
- The line is hidden until a turn has a non-zero cost, so a fresh session shows nothing.

## Development

```sh
npm run typecheck
npm test        # builds, then runs the turn-math unit tests
```

Node 24 or newer. `node --test` rejects a bare directory argument on Node 22+, so the test script names the file explicitly.

To load a local checkout, point the config at the directory. opencode 2 additionally requires an `index.js` next to `tui.js` for a directory target, which the published package does not need since it resolves through `exports["./tui"]`.

## Releasing

Releases are automated with [Changesets](https://changesets.dev) and published to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers), so there is no npm token in this repo.

1. In your PR, run `npx changeset`, pick the bump, and commit the generated `.changeset/*.md`. No changeset means no release, which is correct for docs, tests, and tooling changes.
2. On merge to `main`, CI opens a **release: version packages** PR applying the bump and updating `CHANGELOG.md`.
3. Merging that PR publishes to npm and creates the GitHub release.

## License

MIT
