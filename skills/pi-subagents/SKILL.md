---
name: pi-subagents
description: |
  Parent-only operational contract for delegating focused work to configured
  subagents without transferring orchestration responsibility to children.
---

# Pi Subagents

This skill is for the parent orchestrator only. Do not inject or follow it in
ordinary child subagents. The parent owns delegation, review fanout, follow-up
workers, and final synthesis. An ordinary child completes its assigned role
work and does not propose or run subagents; an explicitly configured fanout
child may use only its child-safe subagent capability for its assigned fanout.

## Dispatch

1. Dispatch known configured roles directly. Runtime rejects unknown or
   disabled names; use `{ action: "list" }` only for diagnostics,
   configuration changes, or unknown-role recovery.
2. Choose exactly one execution shape: single `{agent, task?}`, parallel
   `{tasks:[...]}`, or chain `{chain:[...]}`. Omit `action` for execution; use
   it only for management or control.
3. Keep one writer per cwd/worktree. Use fresh, read-only reviewers or
   validators for independent evidence; the parent synthesizes and assigns any
   follow-up writer.
4. Prefer `context:"fresh"` unless the child needs parent history. Do not give
   children parent-only orchestration material.

## Budgets are exceptional

Normal dispatch omits `timeoutMs`, `maxRuntimeMs`, `turnBudget`, and
`toolBudget`. Set a budget only when the user explicitly requests one or a
concrete external constraint requires it (for example, a fixed CI deadline).
Do not introduce one for speculative cost, latency, or runaway concerns. The
explicit API remains available: `timeoutMs` and `maxRuntimeMs` are aliases;
`turnBudget` has `maxTurns` and optional `graceTurns`; `toolBudget` has
`soft?`, `hard`, and optional `block`.

## Async and control

Use `async:true` only for independent work. Do not sleep or poll just to wait:
continue useful work or respond, and use the wait tool only when this turn must
block. Use `status`, `interrupt`, `stop`, `resume`, `steer`, and `append-step`
only to control the identified run; schedule work only when the user explicitly
requests delayed execution.

For command catalogues, chain templates, agent authoring, control details, and
examples, read [reference.md](reference.md) on demand. The registered
`subagent` tool description exposes the compact operational surface by default;
set `toolDescriptionMode:"full"` or `"custom"` only when that extra reference
is deliberately needed.
