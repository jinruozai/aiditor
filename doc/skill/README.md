# AIditor Skills

These copyable packages mirror the built-in Skill taxonomy in
`src/ai/skill/builtins.js`. Skill is the only Agent/project capability-selection
surface. Exact API signatures remain in `aiditor://api`; Skill documents explain
intent, boundaries, and workflow.

| package | use |
| --- | --- |
| `aiditor-framework-authoring` | Core/UI/Dock/theme/host application work |
| `aiditor-runtime-authoring` | live workspace panel creation and placement |
| `aiditor-ai-host-authoring` | Agent/Skill/Tool/Context/provider work |
| `aiditor-extension-authoring` | Extension source and manifests |
| `aiditor-editor-control` | semantic editor state and operations |
| `aiditor-workspace-authoring` | bounded file/code changes |
| `aiditor-verify-changes` | tests/checks/diagnostics |
| `aiditor-version-control` | Git adapter work |
| `aiditor-extension-management` | installed Extension lifecycle |
| `aiditor-agent-orchestration` | child Agents and quests |

`aiditor.ai.skills.loadPackage()` indexes only existing standard resource
directories and never executes package scripts.
