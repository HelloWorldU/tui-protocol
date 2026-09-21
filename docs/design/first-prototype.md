# First Prototype Design Notes

| Field | Value |
|---|---|
| Status | Working note |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |

This working note records the first prototype's scenario and later incremental
extensions. The [Operation draft](../protocol/operations.md) defines the current
semantics; the [validation plan](next-stage-validation.md) tracks implementation
progress.

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

The first prototype tests reading-anchor stability when Operations change a
different Block, including a mutable Block above the user's reading position.
The semantic model does not map an anchor through a complete Update of its own
Block. The later [xterm experiment](../../prototypes/integration/xterm-protocol-endpoint/README.md#updating-the-block-being-read)
tests a local replacement-start policy under the agreed native-behavior rule.

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

The executable prototypes implement the five current baseline Operations.

#### Append

`Append` introduces a new Block at the end of the logical history. It carries
the Block ID, its initial complete content, and its initial lifecycle state.

Static content may be appended as `sealed`. Dynamic content is appended as
`mutable` and may later receive `Update`, `Extend`, `ReplaceSuffix`, and `Seal`
Operations as applicable.

#### Update

`Update` targets an existing mutable Block by ID and supplies its complete new
content snapshot.

The terminal decides how to reflow and render the replacement. Updating a
sealed or unknown Block is invalid.

The first prototype deliberately uses complete snapshots as the correctness
baseline. A streaming TUI may batch incoming tokens and send the latest
snapshot at its render cadence rather than sending one Operation per token.

Later design work has defined the initial semantics and wire schema of
[Extend](../protocol/operations.md#extend). It adds only at the logical end of
a mutable `text/plain` Block and names the exact prior content state on which
it depends. This preserves causal ordering between streamed fragments.

The executable path now implements Extend through the shared codec,
terminal Session/Endpoint, and xterm integration. The
[xterm protocol endpoint experiment](../../prototypes/integration/xterm-protocol-endpoint/README.md)
records the currently tested rendering and reading-anchor behavior. Update
remains the resynchronization path. Arbitrary character-range patches remain
outside this scenario until their offset, Unicode, revision, and recovery
semantics are understood.

The second incremental Operation is
[ReplaceSuffix](../protocol/operations.md#replacesuffix). It replaces a
non-empty suffix of `text/plain` content using a Unicode-scalar retained-prefix
boundary. The same executable path now implements and tests it, including its
reading-anchor mapping and capacity-rejection boundary.

#### Seal

`Seal` changes an existing Block from `mutable` to `sealed`. Afterward, the
terminal must reject Update, Extend, ReplaceSuffix, and repeated Seal
Operations targeting that Block.

Seal is a distinct semantic Operation. A future protocol version may still
encode a final Update and Seal together.

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

- Protocol-wide resource limits and allocation policy for Context and Block IDs;
  the reference implementation has a local [trial policy](trial-resource-budgets.md).
  Their JSON representation is defined in [JSON Serialization](../protocol/serialization.md);
  scope and reuse semantics are defined in [Protocol Context
  Semantics](../protocol/contexts.md).
- Concrete optional content types and their terminal-native projections; the
  shared requirements are now defined in
  [Content Representation](../protocol/content-representation.md).
- Repeated-query and backoff guidance; negotiation windows and timeout policies
  are caller-owned, while unsupported-terminal fallback is application-owned.
- Whether a future version needs an old-to-new anchor mapping for complete
  Update. The current draft does not require one.
- How far to extend the current incremental-Operation evidence beyond the
  tested plain-text xterm.js scenarios without weakening complete
  Update as the recovery path.
- Whether removal or an Operation beyond Append, Update, Extend,
  ReplaceSuffix, and Seal is needed.
- Whether a future protocol version should combine common Operation sequences.
