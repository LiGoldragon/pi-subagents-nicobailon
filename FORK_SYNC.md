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
