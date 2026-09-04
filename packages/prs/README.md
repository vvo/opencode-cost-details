# opencode-prs

[OpenCode](https://opencode.ai) TUI plugin that lists GitHub pull requests referenced by the current session.

![Open pull requests in the OpenCode sidebar](../../assets/prs.png)

The sidebar section is collapsible. Each compact row links to GitHub and shows whether the pull request is draft, open, or merged.

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

The plugin finds GitHub pull request URLs in user messages, assistant replies, and completed tool output. It asks `gh` for the current title and state. Closed pull requests are hidden, while merged pull requests remain visible.

One published package supports OpenCode 1 and OpenCode 2.

## Development

```sh
pnpm typecheck
pnpm test
```
