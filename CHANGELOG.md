# opencode-cost-details

## 0.3.0

### Minor Changes

- 3f86107: Support opencode 2 alongside opencode 1 from a single package. The default export now carries both entrypoints (`tui` for opencode 1, `setup` for opencode 2), so the same version works on either host.
  
  The turn cost is now appended as one line under the built-in sidebar Context block instead of replacing that block, so tokens, percent used, and total spent stay exactly as opencode reports them. The plugin no longer deactivates the built-in section.
