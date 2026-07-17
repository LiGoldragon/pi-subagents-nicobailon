---
name: pi-subagents
description: Dispatch a known generated role for one focused, independent task.
---

# Pi subagents

Use `subagent({ agent: "known-role", task: "..." })` directly. Do not list before dispatch: generated role packets own the roster and runtime checks every caller-to-role edge before starting a child.

Omitting `async` runs the child in the background. Use `async: false` only when a non-Manager caller genuinely needs foreground execution. Manager dispatch is always background-only.

The psyche-facing root role is **Manager**. When this session is the generated Manager, its current roster is in `.pi/agents/manager.md`; read that file only for recovery or when the roster is unavailable in the current packet. Do not call the separate central **Orchestrator** daemon "Manager" or vice versa.

Generated Manager and nested roles use their generated model and may not use generic-role suggestions. A nested role may dispatch only its declared leaf roles; leaves do not dispatch.

For explicit advanced diagnostics, controls, chains, or administration, configure `toolDescriptionMode: "full"`. Those controls are intentionally not part of this default skill.
