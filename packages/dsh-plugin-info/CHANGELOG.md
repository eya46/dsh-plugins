# @eya46/dsh-plugin-info

## 0.0.3

### Patch Changes

- 6416475: Render version release notes as Markdown using DSH's shared MarkdownText component (GFM, code fences, links, and math). Commit lists and empty/error states stay plain text.

  Optionally register a "插件信息" sidebar tab when dsh-better-sidebar is present. Soft dependency: no peerDependency and no import; the tab reuses the settings panel and only mounts if that service exists.

  Remove the default `@eya46/` scope allow-list so all profile-added plugins are shown. Configure `allowScopes` to restore a filtered view.

## 0.0.2

### Patch Changes

- 2a9cdae: Initial public release of the settings page plugin: lists profile-added DSH
  plugins, marks available npm updates, and shows recent per-version release
  notes fetched from GitHub.
