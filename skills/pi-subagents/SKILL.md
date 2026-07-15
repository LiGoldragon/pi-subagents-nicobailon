# Pi subagents

Use `subagent` to delegate bounded work. Dispatch a known configured role directly; runtime validation rejects unknown or disabled names. `action:"list"` is optional discovery for an unknown name, diagnostics, or after configuration changes, not a precondition for execution.

## Common dispatch

Use exactly one execution shape per call:

- single: `{ agent, task? }`
- parallel: `{ tasks: [{ agent, task, output?, reads?, progress? }], concurrency? }`
- chain: `{ chain: [{ agent, task? }, { parallel: [...] }] }`

Use `context:"fresh"` by default. Use `fork` only when the child needs relevant session history. A role's generated frontmatter supplies its model and explicit skills; `inheritSkills:false` removes inherited discovery, not role-configured skills.

Give each child a compact contract: goal, relevant paths or sources, constraints, validation, and result shape. Known project roles are the dispatch roster in the manager packet; use `generalist` when no specialist fits. Do not use built-in role names as a fallback.

## Safe execution

- One writer owns a worktree. Use fresh read-only review children for independent review.
- Ordinary children do not orchestrate. Only an explicitly assigned fanout child may use its restricted child tool.
- Use `async:true` only for independent work. Continue useful work or return; use `subagent_wait` only when this turn must wait. Do not poll or sleep merely to wait.
- `output` names a persisted artifact. Report its path and residual risks.
- Budgets (`timeoutMs`, `maxRuntimeMs`, `turnBudget`, `toolBudget`) are opt-in for an explicit constraint, never speculative cost control.

## Optional administration

Use `action:"status"` for async state, `view:"fleet"` or `view:"transcript"` for inspection, and `steer`/`resume` only for a live child requiring guidance. `list`, `get`, `models`, `doctor`, and agent create/update/disable operations are on-demand administration. Scheduling, watchdog configuration, dynamic fanout, profiles, and detailed chain syntax are intentionally kept in [reference.md](reference.md); load it only when needed.

Keep the extension's independent-review safety: a worker result is not a reviewed result. Ask a separate fresh reviewer and synthesize its evidence before reporting reviewed acceptance.
