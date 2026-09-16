# @eya46/dsh-plugin-info

## 0.1.0

### Minor Changes

- e4852c6: Track DSH 0.1.5-rc.2: bump `@deepseek-ai/cordis` to `^4.0.2`, `@deepseek-ai/dsh-host-webserver` to `^0.1.5-rc.2` (the old `^0.1.0-rc.7` peer range no longer matches current DSH), and `@deepseek-ai/schemastery` to `^3.18.2`.
- 7bea868: Detect updates for plugins installed from GitHub release tarballs. A dependency spec like `https://github.com/<owner>/<repo>/releases/download/v2.0.3/<pkg>-2.0.3.tgz` is parsed to recover the repository and installed tag, the repo's latest release is compared against the installed version, and an update command pointing at the rewritten newer tarball URL is offered. The versions drawer now lists the repo's recent GitHub releases, and release notes resolve via the spec-derived repository even when the installed package.json has no `repository` field.

### Patch Changes

- 142fbeb: When a registry plugin has an update, copy `dsh plugin --profile <current> add <pkg>@latest` in one click. The CLI profile name is read from the running profile (usually `web`).
- 142fbeb: Fix a settings-section crash when a release note contains a fenced code block. The shell's `MarkdownText` reads `labels.code.copyLabel` / `labels.code.copiedLabel` / `labels.footnotes` with no defaults, so rendering notes with only a `text` prop threw `TypeError: Cannot read properties of undefined (reading 'code')` and took down the whole 插件信息 section. The plugin now passes a reference-stable `labels` object (matching the shape used by dsh's own consumers) and renders note bodies through a small error boundary that falls back to plain text if the shell primitive ever changes shape again.

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
