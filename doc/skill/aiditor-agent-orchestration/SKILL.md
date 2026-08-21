---
name: aiditor-agent-orchestration
description: Create, configure, delegate to, communicate with, and close child Agent quests.
---

# AIditor Agent Orchestration

Delegate bounded independent work. When an Agent should perform work, call
`agent.delegate` directly. Use `agent.create` only when the request explicitly
needs an idle Agent profile. Agents may manage only descendants and cannot
escape to the root. Use Quest read/result/cancel for precise task lifecycle;
reserve Agent stop for current-run cancellation. Skill and Tool availability
comes from the shared Host runtime, not child profile fields.
