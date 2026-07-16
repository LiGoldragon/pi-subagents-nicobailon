---
name: pi-subagents
description: Parent-only direct dispatch contract for generated project roles.
---

# Pi Subagents

Use only from a generated Manager or explicitly generated nested role. Generated
packets own role names and descriptions: dispatch a known role directly; never
list before launch.

```ts
subagent({ agent: "known-role", task: "focused outcome" })
```

Runtime freezes the caller's generated role policy. Manager may dispatch visible
project roles except Manager; a nested role may dispatch only its declared leaf
children; leaves cannot dispatch. Unknown, disabled, built-in, manager, nested,
and undeclared targets are rejected before a child starts. Do not supply a
per-call model override for a generated role.

Use `async:true` only for independent work. The default launch surface is
intentionally minimal. Set `toolDescriptionMode:"full"` only when diagnostics,
controls, chains, budgets, scheduling, worktrees, or administration are needed.
See [reference.md](reference.md) then; it is optional operational detail, not a
roster curriculum.
