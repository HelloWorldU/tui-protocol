# Local resource budgets for trial use

Implementation policy, not new wire semantics or negotiated capabilities.
The [terminal module](../../terminal/README.md) accepts optional Session limits;
the terminal-host and multi-round examples select `trialSessionLimits`.

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
| Stored caller identity length | 256 UTF-16 code units | Stop before retaining it |

String budgets use JavaScript code units to check projected retained size; they
are not rendered cells, Unicode-scalar edit positions, UTF-8 wire lengths, or
measured heap bytes. ReplaceSuffix still counts Unicode scalars. Limits are
copied and validated at construction. They are experimental sizing choices,
not production recommendations. Omitting `resourceLimits` preserves the earlier
unbudgeted Session behavior, so other hosts must explicitly choose a policy.

Content rejection preserves the old content and content-state ID but consumes
the rejected Operation ID as before. A smaller edit with a fresh Operation ID
can succeed. Shrinking content releases content allowance. Closed, invalidated,
and visually evicted records remain charged: no identity or content reclamation
is claimed. Cached repeated controls still replay at the limit. Exhausting
identity/replay storage raises a local `SessionResourceLimitError`; the endpoint
aborts and the host must close the transport. It does not send an invented wire
error or pretend recovery. Retained snapshots then remain diagnostic only.

## Pending input

`PendingInputBudget` accounts for both bytes and item count. The terminal-host
example limits its outer WebSocket work queue to 2 MiB and 512 items; its mixed
ingress has the same limits. These are separate counters, not additive proof
of total process memory. The ingress checks before copying caller bytes.
Overflow stops the endpoint; queued work checks the stopped state and releases
its allowance when settled. A callback already executing cannot be forcibly
cancelled by these counters. Browser/OS transport buffers, decoded temporary
objects, xterm memory, and snapshots retained by callers are outside accounting.

## Evidence and remaining work

[Session tests](../../terminal/test/resource-limits.test.ts) exercise cumulative
Extend, smaller edits after rejection, total content, Block/Context counts,
identity/replay exhaustion, scalar-versus-code-unit positions, and endpoint
failure propagation. [Mixed-ingress tests](../../prototypes/integration/xterm-protocol-endpoint/input-budget.test.ts)
check queued-byte/item overflow and allowance reuse after settlement.

These are deterministic boundary checks, not an endurance or process-memory
measurement. This step bounds selected retained structures instead of silently
deleting their protocol meaning. General memory reclamation, actual long-session
latency, and resource policy for other hosts remain future work.
