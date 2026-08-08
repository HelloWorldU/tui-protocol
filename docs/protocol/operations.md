# Operation Semantics

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Protocol Contexts](contexts.md), [Content representation](content-representation.md), [Wire requirements](wire-requirements.md), [Logical wire message model](wire-format.md) |

This document consolidates the observable semantics currently agreed for
protocol Operations. It remains non-normative while the protocol is under
development and does not define a wire encoding.

## Operation Index

| Operation | Status |
|---|---|
| [Append](#append) | Initial semantics defined |
| [Update](#update) | Initial semantics defined |
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

Lifecycle is explicit at the semantic level even if a future wire encoding
offers shorthand or defaults.

### 4. Reading Anchor Stability

The new Block appears exactly once at the logical tail. If the user is reading
existing history, their anchor remains bound to the same logical position and
keeps its viewport-relative position. A user following the tail continues to
follow the tail.

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
must remain equivalent to complete replacement. A future suffix-only Operation
may optimize streaming without changing these semantics.

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
undefined.

### 5. Failure Isolation

An Update targeting an unknown or sealed Block is invalid and leaves terminal
state unchanged. A malformed Operation likewise causes no partial mutation and
does not prevent the terminal from processing subsequent input. The rejection
is reported by the logical wire error mechanism; application-side recovery
remains TUI-owned.

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

The Operation ID defined by the logical wire model is only an error-correlation
value. It does not make Seal idempotent or permit its retransmission.

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
