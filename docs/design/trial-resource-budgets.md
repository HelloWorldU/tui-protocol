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
| Context records | 16 | Stop the execution session |
| Operation IDs, across Contexts | 16,384 | Stop rather than forget consumed IDs |
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
can succeed. Shrinking content releases content allowance. Closed, invalidated,
and visually evicted records remain charged. Cached repeated controls still
replay at the limit. Exhausting identity/replay storage raises a local
`SessionResourceLimitError`. The endpoint aborts and the host must close the
transport. Retained snapshots then remain diagnostic only.

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
paths. Endurance and process-memory measurements, general memory reclamation,
long-session latency, and resource policy for other hosts remain future work.
