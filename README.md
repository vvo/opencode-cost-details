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

## Install

```sh
opencode plugin opencode-cost-details
```

Then restart opencode.

Subagent (task tool) spend is included, both in turn costs and in the total. The stock sidebar total leaves it out ([upstream issue](https://github.com/anomalyco/opencode/issues/45417)).

## How it works

The plugin replaces the built-in sidebar Context section with an identical one plus a per-turn cost line.

A turn starts at every user message. Costs come from the TUI's own message state, which updates live while the agent works. On first render of a session the plugin also backfills the last two turns from the server (paginated, so turns with 100+ messages are counted fully, unlike the TUI's 100-message window) and fetches subagent sessions with their costs, then follows subagent spend through `session.updated`.

`exports["./tui"]` points at prebuilt JS, not the `.tsx` source. opencode's Solid JSX transform skips any path containing `node_modules`, and that is where `opencode plugin` installs packages, so a plugin shipping JSX source never loads.

It deactivates the built-in `internal:sidebar-context` plugin on startup and re-activates it when the plugin is disabled (via `/plugins`) or opencode shuts down, so removing the plugin restores the stock sidebar. No config needed.

## Caveats

- Models without pricing metadata show $0.00.
- A subagent's cost is attributed to the turn that created it. If a later turn resumes the same subagent, that extra spend still lands on the creation turn.
- Only direct subagents are counted; a subagent's own subagents are not.
- `spent` includes subagent costs, so it reads higher than opencode's built-in total.
- A `$` shell command counts as its own turn, because opencode records it as a user message.

## License

MIT
