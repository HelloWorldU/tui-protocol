# Operation Semantics

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Protocol Contexts](contexts.md), [Content representation](content-representation.md), [Terminal-native behavior](terminal-native-behavior.md), [Wire requirements](wire-requirements.md), [Logical wire message model](wire-format.md), [JSON serialization](serialization.md), [Error codes](error-codes.md) |

This document consolidates the observable semantics currently agreed for
protocol Operations. It remains non-normative while the protocol is under
development and does not define a wire encoding.

## Operation Index

| Operation | Status |
|---|---|
| [Append](#append) | Initial semantics defined |
| [Update](#update) | Initial semantics defined |
| [Extend](#extend) | Initial semantics defined |
| [ReplaceSuffix](#replacesuffix) | Initial semantics defined |
| [Seal](#seal) | Initial semantics defined |

## Shared Semantics

Each Operation is a logically atomic state transition. On success, its changes
to protocol state take effect together, including any content, lifecycle,
history structure, and reading-anchor state required by that Operation. On
failure, none of those changes take effect.

Logical atomicity does not yet require intermediate rendering frames to be
visually atomic. Wire framing and byte-stream ordering are defined separately
by the [Wire Format Requirements](wire-requirements.md); concurrency across
independent streams remains open.

Each Operation explicitly carries the Context ID returned for one open
[Protocol Context](contexts.md). Its Block ID is interpreted only within that
Context.

The [Logical Wire Message Model](wire-format.md) assigns every Block Operation
a correlation ID, reports rejected Operations without acknowledging successful
ones, and leaves later messages eligible for ordered processing. Block
Operation retransmission is not supported in the initial model.

## Content-State Identity

Each Block's current logical content state is identified by the Operation ID
of the last successful Operation that established or changed its content.
Append establishes the initial content state. A successful Update or
incremental content Operation advances it to that Operation's ID, including
when the resulting content happens to equal the previous content.

A failed Operation does not advance the content state. Seal does not advance
it because Seal changes lifecycle rather than content. The identifier is an
opaque causal token, not a content hash, byte count, integrity check, or
permission to reuse an Operation ID.

Every incremental content Operation declares the content-state Operation ID
on which it depends. The declared base must equal the target Block's current
content-state identifier. A mismatch rejects the entire Operation without
changing Block content or content state.

## Append

### 1. Creation and Append Order

`Append` creates a new Block at the end of logical history. It does not modify
an existing Block or change the relative order of existing Blocks. Insertion,
movement, and removal are outside the initial Operation set.

### 2. Block ID Uniqueness

The new Block's ID must not identify an existing Block in the same Protocol
Context. A duplicate Append is invalid and is not interpreted as an Update or
overwrite.

Because the initial model has no removal Operation, a Block ID cannot be reused
within its Protocol Context. The Context defines the Block ID namespace,
lifecycle boundary, and non-reuse rules.

### 3. Initial Content and Lifecycle

Append carries a complete initial content snapshot and declares the Block's
initial lifecycle as mutable or sealed. Dynamic content may begin mutable and
later receive Update and Seal Operations. Static content may begin sealed.

On success, the Append Operation's ID identifies the Block's initial content
state.

Lifecycle is explicit at the semantic level even if a future wire encoding
offers shorthand or defaults.

### 4. Reading Anchor Stability

The new Block appears exactly once at the logical tail. If the user is reading
existing history, their anchor remains bound to the same logical position and
keeps its viewport-relative position. A user following the tail continues to
follow the tail. The terminal-owned reading states and scrollback-capacity
boundary are defined by [Terminal-Native Behavior](terminal-native-behavior.md).

Appending content may push earlier rendered rows into scrollback, but that
presentation event does not change any Block's lifecycle.

### 5. Failure Isolation

A duplicate Append, or one missing a required ID, content snapshot, or
lifecycle, is invalid and leaves terminal state unchanged. A malformed
Operation likewise creates no partial Block and does not prevent the terminal
from processing subsequent input. The rejection is reported by the logical
wire error mechanism; application-side recovery remains TUI-owned.

## Update

### 1. Target and Validity

`Update` targets a Block by ID. It is valid only while the target Block exists
and remains mutable. Whether its rendered rows are in the active viewport or
scrollback does not affect its eligibility for update.

### 2. Replacement Semantics

An Update carries a complete replacement snapshot of the Block's content. The
target retains its Block ID, lifecycle, and position in append order while the
terminal replaces its content and reflows its presentation.

The terminal may optimize how it realizes an Update, but the observable result
must remain equivalent to complete replacement. Update has no content-state
precondition, and its Operation ID becomes the Block's current content-state
identifier on success. It is therefore the initial model's resynchronization
path after an incremental content chain can no longer continue.

### 3. History Integrity

The resulting history contains the replacement and every unaffected Block
exactly once and in the same logical order. The terminal does not realize the
Update by replaying old content into scrollback.

These semantics constrain the completed result. This draft does not yet
require a particular visibility or atomicity policy for intermediate rendering
states.

### 4. Reading Anchor Stability

If the user's reading anchor belongs to a different Block, it remains bound to
the same logical position and keeps its viewport-relative position. A user
following the tail continues to follow the tail.

Mapping a reading anchor through replacement of its own Block remains
undefined. The detailed anchor ownership, history-reading behavior, and
scrollback-capacity boundary are defined by [Terminal-Native
Behavior](terminal-native-behavior.md).

### 5. Failure Isolation

An Update targeting an unknown or sealed Block is invalid and leaves terminal
state unchanged. A malformed Operation likewise causes no partial mutation and
does not prevent the terminal from processing subsequent input. The rejection
is reported by the logical wire error mechanism; application-side recovery
remains TUI-owned.

## Extend

`Extend` is the first incremental content Operation. Its logical Message kind
is `block.extend`.

### 1. Target and Effect

Extend targets an existing mutable `text/plain` Block, carries a non-empty
text fragment, and identifies the exact content state on which that fragment
depends. On success, the fragment is appended once at the logical end of the
Block. No existing content is deleted, replaced, or reinterpreted.

The completed result must be equivalent to concatenating the previous logical
content and the supplied fragment. The terminal may choose its rendering
strategy but does not infer a diff from two complete snapshots.

### 2. Content-State Precondition

Extend uses the shared content-state precondition. This prevents a
later fragment from being applied after an earlier fragment on which it
depended was rejected.

On success, Extend's own Operation ID becomes the Block's new content-state
identifier.

### 3. Reading and Rendering

Logical positions in the Block's pre-existing content remain unchanged by
Extend. Layout, reflow, reading-anchor preservation, and tail-following
remain terminal-owned and follow [Terminal-Native
Behavior](terminal-native-behavior.md).

### 4. Failure and Recovery

Successful Extend Operations are silent and rejected ones use the correlated
error path defined by the logical wire model. Reusing the failed Operation ID
is invalid. A later Extend that names the failed Operation as its base is
rejected by the same content-state check; the protocol does not enter a
separate desynchronized mode. The normal absence of a success response does
not itself trigger a retry.

The initial protocol does not blindly retry incremental Operations. An SDK may
issue a new Operation ID with the same base after an explicitly retryable
transient failure, but resource exhaustion does not promise that the same
fragment can succeed unchanged. A content-state mismatch requires the TUI to
resynchronize with a complete Update before sending Extend again. Connection
loss still requires a new Context and reconstruction of application-owned
state.

### 5. Deliberate Scope

Extend does not itself define suffix deletion or replacement; those
belong to the separate [ReplaceSuffix](#replacesuffix) Operation. Arbitrary
range editing, concurrent writers, and a general patch language remain future
design work.

## ReplaceSuffix

`ReplaceSuffix` is the second incremental content Operation. Its logical
Message kind is `block.replace_suffix`.

### 1. Target and Effect

ReplaceSuffix targets an existing mutable `text/plain` Block. It carries the
shared content-state base, a retained-prefix count, and replacement text. Its
result is the first `retain` Unicode scalar values of the current content
followed by `replacement`. The position unit is defined by [Content
Representation](content-representation.md#5-incremental-text-operations).

`retain` must be a non-negative safe JSON integer and must be less than the
current scalar-value length. ReplaceSuffix therefore removes at least one
existing scalar value. `replacement` may be empty, allowing the Operation to
delete a suffix without inserting new content. Retaining the complete current
length would be an append and uses Extend instead.

### 2. Content-State Precondition

ReplaceSuffix uses the shared content-state precondition. On success, its own
Operation ID becomes the Block's new content-state identifier, even if the
resulting text equals the prior text.

### 3. Reading and Rendering

A reading anchor in the retained prefix remains attached to the same logical
position. An anchor in the removed suffix moves to the replacement boundary:
the beginning of the new replacement text, or the end of the retained prefix
when the replacement is empty. A user following the tail continues to follow
the new tail.

Layout, reflow, selection, search, and viewport-relative anchor preservation
remain terminal-owned and follow [Terminal-Native
Behavior](terminal-native-behavior.md).

### 4. Failure and Recovery

A content-state mismatch and an invalid retained-prefix boundary are distinct
failure categories because they require different recovery. A mismatch
reports `content_state_mismatch`: the incremental chain cannot continue and
requires a complete Update to resynchronize. A `retain` value that is
structurally valid but not below the current scalar-value length reports
`invalid_content_boundary`. It is a TUI error and does not become valid through
retry or automatic resynchronization.

Other target, lifecycle, atomicity, correlation, and retry behavior is
inherited from the shared Operation semantics and Extend recovery model.

### 5. Deliberate Scope

ReplaceSuffix does not address an arbitrary middle range, define positions for
optional content types, or introduce a general patch language. Optional
content types continue to use complete Update unless their own future
definition explicitly adopts incremental editing.

## Seal

### 1. Lifecycle Transition

`Seal` targets a Block by ID and permanently changes its lifecycle from mutable
to sealed. The Block retains its ID, content, and position in append order.
Subsequent Updates targeting it are invalid.

Sealing expresses that the TUI has relinquished the right to modify the Block.
It is independent of whether the Block's rendered rows are in the viewport or
scrollback.

### 2. Target Validity and Repeated Seal

Seal is valid only when the target Block exists and remains mutable. A Seal
targeting an unknown or already sealed Block is invalid. Seal is therefore not
idempotent in the initial semantics.

The Operation ID defined by the logical wire model correlates errors but does
not make Seal idempotent or permit its retransmission. Because Seal does not
change content, its Operation ID does not replace the Block's content-state
identifier.

### 3. Content Invariance

Seal carries no content and does not modify the Block's current content. If the
TUI needs to make a final content change, it sends Update before Seal.

The terminal may still reflow sealed content in response to terminal-native
events such as resize, but reflow does not change logical content. A future
wire encoding may combine a final Update and Seal as shorthand only if its
observable semantics remain equivalent to the two Operations in that order.

### 4. Failure Isolation

An invalid or malformed Seal leaves terminal state unchanged and does not
prevent the terminal from processing subsequent input. This includes a Seal
with an unknown or already sealed target, or one missing a required Block ID.
The rejection is reported by the logical wire error mechanism;
application-side recovery remains TUI-owned.
