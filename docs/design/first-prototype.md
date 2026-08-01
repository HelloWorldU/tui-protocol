# First Prototype Design Notes

| Field | Value |
|---|---|
| Status | Working note |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |

This document records the current design of the first protocol prototype. It
is intentionally non-normative: the prototype exists to test these ideas and
may change them.

## Validation Scenario

The first prototype follows one dynamic block through its complete lifecycle:

1. A TUI appends a mutable thinking block.
2. The TUI replaces its content while output is streaming.
3. Later output pushes the block into terminal-owned scrollback.
4. The TUI replaces the block again, possibly changing its rendered height.
5. The TUI seals the block when it is complete.
6. The terminal preserves native history and the user's reading position
   throughout the sequence.

Entering scrollback is a presentation event, not a block lifecycle event.

## Working Model

### Block

A Block is an identified logical unit of terminal content. The prototype
assumes that a block has:

- a stable ID;
- a complete content snapshot;
- a lifecycle state of `mutable` or `sealed`;
- an implicit position determined by append order.

Block order is append-only. A block's content may change while it is mutable,
regardless of whether its rendered rows are visible or in scrollback.

### Operations

The prototype begins with three candidate Operations.

#### Append

`Append` introduces a new Block at the end of the logical history. It carries
the Block ID, its initial complete content, and its initial lifecycle state.

Static content may be appended as `sealed`. Dynamic content is appended as
`mutable` and may later receive `Update` and `Seal` Operations.

#### Update

`Update` targets an existing mutable Block by ID and supplies its complete new
content snapshot. It is a semantic replacement, not a character-level patch
or a sequence of terminal rendering commands.

The terminal decides how to reflow and render the replacement. Updating a
sealed or unknown Block is invalid.

The first prototype deliberately uses complete snapshots as the correctness
baseline. A streaming TUI may batch incoming tokens and send the latest
snapshot at its render cadence rather than sending one Operation per token.

If measurement shows that repeated snapshots are too expensive, Update may
later be split into two Operations:

- `Extend`, which appends content only at the end of a mutable Block;
- `Replace`, which retains the complete-snapshot semantics defined above.

The initial optimization would be suffix-only. Arbitrary character-range
patches are out of scope until their offset, Unicode, revision, and recovery
semantics are understood.

#### Seal

`Seal` changes an existing Block from `mutable` to `sealed`. Afterward, the
terminal must reject further Updates to that Block.

Seal is a distinct semantic Operation. A future wire format may still encode
a final Update and Seal together.

## Responsibility Boundaries

- **Content (TUI-owned)**: Block identity, logical content, append order, and
  lifecycle.
- **Execution (terminal-owned)**: Storage, layout, reflow, scrollback, and the
  realization of Operations.
- **Info (shared)**: Semantic Block Operations and their observable effects.

Terminal-native scrolling, selection, copying, searching, resizing, and
reflow do not create protocol Operations. The terminal may use Block identity
internally to preserve a reading anchor.

## Open Questions

- Block ID format, scope, and reuse rules.
- Content representation and which terminal-native capabilities it may carry.
- Error reporting for invalid Operations.
- Capability negotiation and fallback for terminals without protocol support.
- Whether measured streaming costs justify splitting Update into Extend and
  Replace.
- Whether removal or any operation beyond Append, Update, and Seal is needed.
- The wire encoding and whether common Operation sequences should be combined.
