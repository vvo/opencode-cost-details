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

## How it works

The plugin replaces the built-in sidebar Context section with an identical one plus a per-turn cost line. Turn costs are computed by grouping assistant messages between your prompts and summing their `cost`.

It deactivates the built-in `internal:sidebar-context` plugin on startup and re-activates it when the plugin is disabled (via `/plugins`) or opencode shuts down, so removing the plugin restores the stock sidebar. No config needed.

## Caveats

- Subagent (task tool) spend is not included in session or turn costs ([upstream issue](https://github.com/anomalyco/opencode/issues/45417)).
- Models without pricing metadata show $0.00.
- The TUI syncs the last 100 messages, so a single turn spanning 100+ messages would be undercounted.

## License

MIT
