---
name: aiditor-runtime-authoring
description: Create, edit, load, mount, reload, or replace workspace-backed panels in the current live AIditor host.
---

# AIditor Runtime Authoring

Inspect the workspace and real docks, write a plain JavaScript registered
component file, then place it with `aiditor.addPanelToDock`. Use
`aiditor.reloadPanel` after editing the same component and
`aiditor.replacePanel` only when component identity changes. Never send source
inside dock Tool arguments or guess dock names/layout JSON.
