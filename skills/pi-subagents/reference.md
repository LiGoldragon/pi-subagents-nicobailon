# Pi Subagents Optional Reference

The normal generated-role surface is direct launch only. Generated packets own
the role roster; do not copy role names or descriptions into this reference.

Set `toolDescriptionMode:"full"` deliberately to expose optional runtime
operations: diagnostic inventory (`list`/`get`), status and transcripts,
wait/control/revival, chains and bounded fanout, acceptance and budgets,
worktrees, scheduling, administration, watchdogs, and artifact paths. Those
operations remain implemented but are omitted from default training and schema
context.

Authorization still applies to every launch, scheduled launch, append, and
revival. Diagnostic inventory is filtered to caller-visible generated roles.
Generated Manager and nested roles receive no proactive generic-role or skill
suggestions. The central daemon component may be called an Orchestrator; a
Manager role must never be called one.
