# opencode-prs

[OpenCode](https://opencode.ai) TUI plugin that lists open GitHub pull requests referenced by the current session.

![Open pull requests in the OpenCode sidebar](../../assets/prs.png)

The sidebar section is collapsible. Each row shows the pull request number and title. Select a row to open it on GitHub.

## Install

OpenCode 2, in `~/.config/opencode/cli.json`:

```json
{ "plugins": ["opencode-prs"] }
```

OpenCode 1, in `~/.config/opencode/tui.json`:

```json
{ "plugin": ["opencode-prs"] }
```

Then restart OpenCode. The plugin requires an installed and authenticated [GitHub CLI](https://cli.github.com/).

## How it works

The plugin finds GitHub pull request URLs in user messages, assistant replies, and completed tool output. It asks `gh` for the current title and state, then keeps open pull requests in the sidebar.

One published package supports OpenCode 1 and OpenCode 2.

## Development

```sh
pnpm typecheck
pnpm test
```
