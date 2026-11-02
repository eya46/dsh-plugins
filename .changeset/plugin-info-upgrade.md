---
"@eya46/dsh-plugin-info": minor
---

Upgrade a plugin from the settings page: the Host runs the upgrade through its own plugin manager, using the official `updateBundle` when the running DSH has it and otherwise removing the installed version and installing the target exactly, then restoring the previous version when the target fails.
