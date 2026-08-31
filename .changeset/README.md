# Changesets

This folder holds [changesets](https://changesets.dev): one small markdown file per
user-visible change, recording the semver bump and the changelog line.

To add one, run `npx changeset` and commit the generated file with your change.

On merge to `main`, CI opens a **Version Packages** PR that applies the bumps and
updates `CHANGELOG.md`. Merging that PR publishes to npm.

No changeset means no release, which is the right answer for docs, tests, and
tooling changes. Use `npx changeset --empty` if you want to record that explicitly.
