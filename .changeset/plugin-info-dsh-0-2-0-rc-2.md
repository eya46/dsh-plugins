---
"@eya46/dsh-plugin-info": patch
---

Support DSH 0.2.0-rc.2 (the current Desktop / Web release) without dropping 0.1.5-rc.2. The `@deepseek-ai/dsh-host-webserver` peer range becomes `^0.1.5-rc.2 || ^0.2.0-rc.2`, so the compatibility preflight no longer rejects the plugin on the new runtime; `@deepseek-ai/cordis` moves to `^4.0.4` and `@deepseek-ai/schemastery` to `^3.18.4`, the versions DSH 0.2.0-rc.2 ships.

No behavior change accompanies the bump: the `webServer.register()` route API the host half uses, the `settings.section` slot contract the browser half registers into, and the `__ModuleLoader__` / `react` / `@deepseek-ai/dsh-client-ui-primitives` module-table specifiers it requires are all unchanged between 0.1.5-rc.2 and 0.2.0-rc.2.
