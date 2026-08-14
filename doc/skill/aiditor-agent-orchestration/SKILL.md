---
name: aiditor-agent-orchestration
description: Create, configure, delegate to, communicate with, and close child Agent quests.
---

# AIditor Agent Orchestration

Delegate bounded independent work with focused `skillRefs`. Agents may manage
only descendants and cannot escape to the root. Use Quest read/result/cancel
for precise task lifecycle; reserve Agent stop for emergency current-run
cancellation. Never pass raw Tool ids to a child profile.
