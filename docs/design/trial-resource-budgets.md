# Local resource budgets for trial use

The [terminal module](../../terminal/README.md) accepts host-configured Session
limits. This note records the experimental `trialSessionLimits` policy selected
by the terminal-host and multi-round examples. The limits are local to the host.

## Retained state

| Resource | Trial allowance | Exhaustion behavior |
| --- | --- | --- |
| One Block's content | 262,144 UTF-16 code units | Reject the Operation with existing `resource_exhausted` |
| All retained Block content | 1,048,576 UTF-16 code units | Same atomic rejection |
| Retained Blocks | 1,024 | Reject another Append |
| Open, invalidated, and retained closed Context records | 16 | Stop the execution session |
| Operation IDs in those Contexts | 16,384 | Stop rather than forget consumed IDs |
| Cached control results | 1,024 | Stop rather than evict replay results |
| Cached control fingerprints | 262,144 UTF-16 code units | Stop rather than change replay behavior |
| Individually checked Request, Operation, and Block ID length | 256 UTF-16 code units | Stop before retaining that identity |

String budgets use JavaScript code units to check projected retained size; they
are separate from rendered cells, Unicode-scalar edit positions, UTF-8 wire
lengths, and measured heap bytes. ReplaceSuffix still counts Unicode scalars.
Limits are copied and validated at construction. Context IDs are assigned by
the terminal; incoming Context references in cached controls count toward the
fingerprint budget, not the individual-ID limit. Omitting `resourceLimits`
preserves the earlier unbudgeted Session behavior, so other hosts must
explicitly choose a policy.

Content rejection preserves the old content and content-state ID but consumes
the rejected Operation ID as before. A smaller edit with a fresh Operation ID
can succeed. Shrinking content releases content allowance. Without explicit
reclamation, closed, invalidated, and visually evicted records remain charged.
Cached repeated controls still replay at the limit. Exhausting identity/replay
storage raises a local `SessionResourceLimitError`. The endpoint aborts and the
host must close the transport. Retained snapshots then remain diagnostic only.

## Closed-Context reclamation

A host with an independent rendering projection can call
`TerminalProtocolSession.reclaimClosedContext(id)` after rendering drains. It
returns the closed snapshot for bounded accounting, then releases its content,
Block count, and Operation identity records. Reclaimed snapshots disappear
from `context()` and `contexts()`. Open and invalidated Contexts, unknown IDs,
and already reclaimed IDs return `undefined` without changing state.

This is a local retention policy under the existing
[closure and capacity semantics](../protocol/contexts.md#6-closure-and-content-retention),
not a new lifecycle or Message. Context IDs are never reused. Monotonic local ID
allocation preserves idempotent closure for reclaimed IDs without retaining
their snapshots, and the original control-request replay cache is unchanged.
Cached control results and fingerprints are not reclaimed by this API, so their
configured limits still apply. Releasing Operation identity records is safe only
after closure has revoked mutation authority; later Operations still report
`context_not_open`. The default without a reclamation call is unchanged.

The xterm adapter supports this only when the history exposes renderer-owned
Block ranges and eviction cleanup. Invalidation uses those ranges rather than
Session snapshots and still retires every range of an affected Context. A fully
evicted Block also leaves the render models; its eviction record remains until
its closed Context is reclaimed, preventing later edits from recreating it.
Visible closed Blocks retain their projection for reading, search, and reflow.

[Reclamation tests](../../terminal/test/reclamation.test.ts) cover budget
release, ID freshness, repeated closure, control replay, and open/invalidated
refusal. [Private-history eviction tests](../../prototypes/xterm-headless/private-core-history.test.ts)
cover projection removal and later edits. [Tabby's long-session record](../../prototypes/integration/tabby-demo/README.md#long-session-and-reclamation-evidence-2026-10-27)
covers 20 real Pi rounds and memory sampling. Open/invalidated reclamation,
partial-Block or unmanaged-row eviction, longer steady-state behavior,
long-session latency, and policies for other hosts remain open.

## Pending input

`PendingInputBudget` accounts for both bytes and item count. The terminal-host
example limits its outer WebSocket work queue to 2 MiB and 512 items; its mixed
ingress has the same limits. Each queue has its own counters. The ingress
checks before copying caller bytes. Overflow stops the endpoint; queued work
checks the stopped state and releases
its allowance when settled. A callback already executing cannot be forcibly
cancelled by these counters. Browser/OS transport buffers, decoded temporary
objects, xterm memory, and snapshots retained by callers are outside accounting.

## Evidence and remaining work

[Session tests](../../terminal/test/resource-limits.test.ts) exercise cumulative
Extend, smaller edits after rejection, total content, Block/Context counts,
identity/replay exhaustion, scalar-versus-code-unit positions, and endpoint
failure propagation. [Mixed-ingress tests](../../prototypes/integration/xterm-protocol-endpoint/input-budget.test.ts)
check queued-byte/item overflow and allowance reuse after settlement.

These deterministic checks exercise the configured limits and their failure
paths. General reclamation beyond the explicit closed-Context and full-eviction
paths above, longer steady-state behavior, long-session latency, and resource
policy for other hosts remain future work.
