# Pi subagents reference

Load this only for uncommon administration or workflow authoring.

## Discovery and administration

`action:"list"` refreshes discovery after settings changes or helps recover an unknown name. It is never required before dispatching a known generated role. Use `get` for a role definition, `models` for loaded mappings, and `doctor` for runtime paths and discovery diagnostics. Agent changes use `create`, `update`, `delete`, `eject`, `disable`, `enable`, or `reset`; they are configuration work, not normal execution.

## Async control

`status` accepts a run id/prefix. `status` with `view:"fleet"` inspects active work; `view:"transcript"` tails one child. `interrupt`, `stop`, `resume`, `steer`, and `append-step` target a current run and must name its id. Completion notifications own normal result delivery; do not poll.

## Chains

Chain task templates support `{task}`, `{previous}`, `{chain_dir}`, and named `{outputs.name}`. A static parallel step is `{ parallel:[{ agent, task, count? }], concurrency? }`. Dynamic fanout requires a structured producer, an explicit `maxItems`, and collected output; use it only for bounded target lists.

## Scheduling and watchdog

Scheduling is disabled unless `scheduledRuns.enabled` is configured. Use it only for an explicitly requested future launch. Watchdog settings and profiles are opt-in diagnostics/configuration; do not add them to ordinary dispatch prompts.
