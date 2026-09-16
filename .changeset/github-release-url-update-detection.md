---
"@eya46/dsh-plugin-info": minor
---

Detect updates for plugins installed from GitHub release tarballs. A dependency spec like `https://github.com/<owner>/<repo>/releases/download/v2.0.3/<pkg>-2.0.3.tgz` is parsed to recover the repository and installed tag, the repo's latest release is compared against the installed version, and an update command pointing at the rewritten newer tarball URL is offered. The versions drawer now lists the repo's recent GitHub releases, and release notes resolve via the spec-derived repository even when the installed package.json has no `repository` field.
