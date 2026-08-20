---
"@eya46/dsh-plugin-info": patch
---

Render version release notes as Markdown using DSH's shared MarkdownText component (GFM, code fences, links, and math). Commit lists and empty/error states stay plain text.

Optionally register a "插件信息" sidebar tab when dsh-better-sidebar is present. Soft dependency: no peerDependency and no import; the tab reuses the settings panel and only mounts if that service exists.

Remove the default `@eya46/` scope allow-list so all profile-added plugins are shown. Configure `allowScopes` to restore a filtered view.
