# Fork synchronization

- Upstream: `nicobailon/pi-subagents`
- Reconciled base: `315e1eb1482c4ac2d912a8d95aac4287dc7e60ac`
- Former deployed fork base: `c940fe20e86d9ba429eebcac809ec79d478ef206` (6 ahead / 31 behind the reconciled base)

## Local deltas

| Historical delta | Decision | Current witness |
| --- | --- | --- |
| Nested accountable notification routing | Upstream/native supervisor channel owns it | upstream notification and native-supervisor coverage |
| Strict reviewed acceptance | Retained | missing reviewer result is a rejected ledger with blocker evidence |
| Typed blocked evidence | Retained | `commandsRun[].result = "blocked"` parses and persists |
| Compact defaults and schema guidance | Upstream owns it | current upstream schema and tool-description tests |
| Dynamic acceptance boundaries | Retained | aggregate acceptance exists only for an explicit dynamic group policy; materialized children retain their own ledgers |
| Read-only empty evidence | Upstream owns it | read-only acceptance integration coverage |
| Stale reconciliation | Upstream owns it | current upstream async/reconciliation coverage |
| Truthful process and acceptance provenance | Retained | process exit fields remain separate from acceptance ledger status |
| Authoritative output-file acceptance | Retained | resolved file content, not final chat prose, supplies file-only acceptance |

The fork carries only the retained deltas above on top of the stated upstream base.

## Certified acceptance inclusion

This merge includes the certified reconciliation revision `e550e8289bcdf22cc1c4b553949deb5a70bcae2a` as a parent. The current fork already implements its retained acceptance behavior, so the current implementations remain authoritative rather than duplicating older source forms:

| Certified behavior | Current witness |
| --- | --- |
| Strict reviewed acceptance | `src/runs/shared/acceptance.ts` rejects explicit reviewed requests that cannot supply an independent reviewer. |
| Typed blocked evidence | `src/shared/types.ts` permits `commandsRun[].result = "blocked"`. |
| Dynamic acceptance boundaries | `src/runs/foreground/chain-execution.ts` records group acceptance only for explicit dynamic group policy. |
| Authoritative output-file acceptance | `src/runs/foreground/execution.ts` marks resolved file-only output as authoritative. |

The newer fork retains opt-in budget controls: ordinary dispatch omits time, turn, and tool budget settings unless an explicit request or concrete external constraint requires one.
