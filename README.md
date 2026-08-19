# @eya46/dsh-plugins

pnpm monorepo for DeepSeek Harness plugins.

| Package | Description |
|---|---|
| [`@eya46/dsh-plugin-info`](packages/dsh-plugin-info) | Settings page for profile-added plugins, updates, and version notes |

## Install

From npm (published package):

```sh
dsh plugin --profile web add @eya46/dsh-plugin-info
```

From this monorepo (local development):

```sh
pnpm install
dsh plugin --profile web add "file:./packages/dsh-plugin-info"
```

## Development

```sh
pnpm install
pnpm -r --filter "./packages/**" test          # run tests for every package
pnpm -r --filter "./packages/**" typecheck     # typecheck every package
pnpm -r --filter "./packages/**" build         # build every package
```

## Releases

This monorepo uses [changesets](https://github.com/changesets/changesets) to drive versioning, npm publishing, and GitHub releases.

1. **Ship a change.** Open a PR that touches `packages/*`, and include a `.changeset/<name>.md` describing the user-facing change and the semver bump for each affected package:
   ```md
   ---
   "@eya46/dsh-plugin-info": patch
   ---

   Brief, user-facing summary of what changed.
   ```
2. **Merge the PR.** The `Release` GitHub Action opens (or updates) a `chore: release packages` PR that bumps affected `package.json` versions and writes per-package `CHANGELOG.md` entries.
3. **Merge the release PR.** The same Action publishes the new versions to npm, creates the git tag, and opens a GitHub release with auto-generated notes for each package.

Required GitHub repository secret: `NPM_TOKEN` — an [npm Granular Access Token](https://docs.npmjs.com/about-access-tokens#publishing-packages) with the "Automation" type, scoped to the packages this org publishes. Trusted publishing (OIDC) is planned.
