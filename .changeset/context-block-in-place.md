---
"opencode-cost-details": minor
---

Render the sidebar Context section instead of appending below it, so the turn costs sit directly under `spent` as a fourth line rather than under the MCP section.

The token, percent, and spent figures are computed the way each host computes them and verified against the built-in section. On opencode 1 the plugin hides the built-in section itself. On opencode 2 that API no longer exists, so `-opencode.sidebar.context` has to be added to `cli.json`; see the README.
