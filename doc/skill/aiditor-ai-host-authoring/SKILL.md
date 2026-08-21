---
name: aiditor-ai-host-authoring
description: Develop AIditor Agent, Skill, Tool, Context, provider, permission, request, runtime, and persistence integration.
---

# AIditor AI Host Authoring

Skills are stateless readable instructions and Tool organization. Their
`toolDisclosure: always | onRead`, explicit selection, and visible main
`skill.read` ToolCalls determine request-local Tool schema disclosure without
activation or loaded state. Resource-only reads never project Tools. Tool
Runtime still rechecks current availability and Permission remains the
independent authorization boundary. Context and References provide facts, never
Tool authorization. Every contribution has an exact Owner. Do not add Tool
visibility flags or Agent capability lists.
