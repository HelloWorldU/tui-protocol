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

The first prototype guarantees reading-anchor stability when Operations change
a different Block, including a mutable Block above the user's reading
position. Mapping an anchor through a complete Update of its own Block is
explicitly undefined at this stage.

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

The prototype implements the three initial Operations.

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

Later design work has defined the initial semantics and wire schema of
[Extend](../protocol/operations.md#extend). It adds only at the logical end of
a mutable `text/plain` Block and names the exact prior content state on which
it depends. This preserves causal ordering between streamed fragments without
turning Update into a character-level patch.

The executable prototypes now implement Extend through the reference codec,
protocol Session, protocol endpoint, and xterm integration path. The
[xterm protocol endpoint experiment](../../prototypes/integration/xterm-protocol-endpoint/README.md)
records the currently tested rendering and reading-anchor behavior. Update
remains the resynchronization path. Arbitrary character-range patches remain
outside this scenario until their offset, Unicode, revision, and recovery
semantics are understood.

The second incremental Operation is
[ReplaceSuffix](../protocol/operations.md#replacesuffix). It replaces a
non-empty suffix of `text/plain` content using a Unicode-scalar retained-prefix
boundary. The first prototype does not yet implement this Operation either.

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

- Concrete wire representations for Context and Block IDs; Context scope and
  reuse semantics are now defined in
  [Protocol Context Semantics](../protocol/contexts.md).
- Concrete optional content types and their terminal-native projections; the
  shared requirements are now defined in
  [Content Representation](../protocol/content-representation.md).
- The wire encoding for capability negotiation; unsupported-terminal fallback
  is application-owned.
- How to map a reading anchor when its own Block receives a complete Update.
- How to prototype and evaluate ReplaceSuffix, and how far to extend the
  current Extend evidence, without weakening complete Update as the recovery
  path.
- Whether removal or an Operation beyond Append, Update, Extend,
  ReplaceSuffix, and Seal is needed.
- The wire encoding and whether common Operation sequences should be combined.
