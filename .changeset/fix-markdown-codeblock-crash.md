---
"@eya46/dsh-plugin-info": patch
---

Fix a settings-section crash when a release note contains a fenced code block. The shell's `MarkdownText` reads `labels.code.copyLabel` / `labels.code.copiedLabel` / `labels.footnotes` with no defaults, so rendering notes with only a `text` prop threw `TypeError: Cannot read properties of undefined (reading 'code')` and took down the whole 插件信息 section. The plugin now passes a reference-stable `labels` object (matching the shape used by dsh's own consumers) and renders note bodies through a small error boundary that falls back to plain text if the shell primitive ever changes shape again.
