# Protocol Context Semantics

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Operations](operations.md), [Capabilities](capabilities.md), [Wire requirements](wire-requirements.md), [Logical wire message model](wire-format.md) |

This document defines the lifecycle and addressing scope for a TUI's Block
state. A Protocol Context is not a third content primitive and its control
messages are not Block Operations. It is the namespace and authority boundary
within which Block Operations are valid.

## 1. Block ID Namespace

A Block ID is unique within one Protocol Context. The complete logical address
of a Block is therefore `(context_id, block_id)`. The same Block ID may be used
in a different Context without collision.

A terminal connection may carry multiple successive or interleaved Contexts.
The connection is the transport scope; a Context is the lifecycle scope for
one TUI's Block collection.

## 2. Explicit Establishment

Capability negotiation creates no Context and remains free of Block lifecycle
side effects. After positive capability confirmation, the TUI explicitly
requests a new Context. Block Operations are invalid until that Context has
been established successfully.

The logical control-message names are defined by the message model. Their
serialization and encoding remain wire-level choices.

## 3. Atomic Positive Establishment

Context establishment is a logically atomic request and response. On success,
the terminal allocates the complete Context state and returns a correlated
positive response. On failure, it creates no partial Context.

The TUI sends Block Operations only after receiving the positive response.
Context establishment requires confirmation because allocation, validation,
or resource limits may cause it to fail; this does not require an
acknowledgment for every Block Operation.

Within the current connection, retransmitting the same establishment request
with the same request correlation ID returns its original outcome without
allocating another Context. A new logical establishment uses a new correlation
ID, and reusing an ID with different request content is invalid. This makes a
lost or delayed establishment response safely recoverable.

## 4. Terminal-Assigned Context ID

On successful establishment, the terminal returns a fresh Context ID. The TUI
retains that value and carries it in subsequent Context control messages and
Block Operations.

The Context ID is an opaque handle: the TUI can transmit and compare it but
does not interpret its structure. The terminal guarantees that it is unique
and is not reused within the current terminal connection. A request
correlation ID identifies the establishment exchange; it is distinct from the
resulting Context ID.

## 5. Explicit Operation Addressing

Every Append, Update, and Seal explicitly carries the exact Context ID returned
for its open Context. The protocol has no ambient "current Context." This lets
messages for different Contexts interleave without changing their targets.

An Operation with an unknown, closed, cross-connection, or otherwise incorrect
Context ID is invalid. Existing Operation and wire failure-isolation semantics
apply to that failure.

## 6. Closure and Content Retention

Closing a Context permanently revokes its TUI's right to modify any of its
Blocks. Their latest content and append order remain in terminal-owned history,
and any Blocks still mutable at closure become sealed. Closing a Context does
not delete or replay its content.

Seal remains useful while a Context is open because it finalizes one Block
without ending the TUI's authority over other Blocks.

## 7. Confirmed and Idempotent Closure

Context closure is a logically atomic, correlated request and response. A
positive response means the Context is closed and all its remaining mutable
Blocks are sealed. Failure leaves an open Context unchanged.

Repeating closure for the same closed Context succeeds without another state
change, allowing the TUI to retry after losing a response. Closing a Context
that never existed is invalid. This idempotency is specific to Context closure
and does not change the initial non-idempotent Seal semantics.

## 8. One-Way Lifecycle and Explicit End Conditions

A Context has a one-way lifecycle:

```text
nonexistent -> open -> closed
```

A closed Context cannot be reopened, and its ID cannot be assigned to a later
Context on the same connection. Normal termination is expressed by an explicit
closure request. Ending the end-to-end terminal connection closes all of its
remaining open Contexts.

The initial protocol does not infer closure from inactivity, viewport state,
or other presentation events. A TUI may legitimately remain silent while
waiting for input or long-running work.

## 9. Abnormal Termination

If a TUI disappears without closing its Context while the underlying terminal
connection remains alive, the initial protocol does not guess that the Context
has ended. It may remain open until the connection ends or a future explicit
recovery mechanism applies.

Implementations may enforce resource limits, but a timeout or resource policy
does not silently create a successful semantic closure. Recovery, eviction,
and error reporting for abandoned Contexts remain open design questions.

## 10. Ordered Closure Boundary

Within one terminal byte stream, valid Block Operations before a closure
request are applied before the Context closes. The positive closure response
means those preceding Operations have completed and the Context is closed.
Operations ordered after closure are invalid.

This boundary follows the shared byte-stream ordering requirement rather than
thread scheduling or rendering completion. Concurrency across independent
streams remains undefined.

## Open Design Choices

- The establishment and closure message encoding.
- Context and correlation ID wire representations.
- Recovery and resource policy for abandoned Contexts.
- Authentication, provenance, and authority within a shared byte stream.
- Context behavior across terminal reset mechanisms.
