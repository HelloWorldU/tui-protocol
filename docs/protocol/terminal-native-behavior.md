# Terminal-Native Behavior

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Operation semantics](operations.md), [Protocol Contexts](contexts.md), [Wire requirements](wire-requirements.md), [Content representation](content-representation.md) |

This document defines the initial observable behavior of terminal-native
history, reading, and interaction when protocol Operations change Block
content. It does not expose terminal interaction state to the TUI or prescribe
a terminal rendering algorithm.

## 1. Terminal-Owned Reading State

The terminal distinguishes between two existing user states:

- **history reading**, where the user has moved away from the logical tail to
  inspect earlier content; and
- **tail following**, where the viewport continues to show the newest
  content as output arrives.

The terminal owns this state. The TUI does not declare either state and cannot
set, move, or clear the user's reading anchor through the protocol.

## 2. Logical Reading Anchor

While the user is reading history, the terminal maintains an internal anchor
to a logical position within a Block and to that position's relative row in
the visible viewport. The anchor is based on Block identity and logical
content position rather than a physical scrollback row number.

When an Operation changes the rendered height of another Block, the terminal
keeps the anchored logical position on the same viewport-relative row. The
terminal may change physical history coordinates as needed to preserve that
observable result.

## 3. Tail-Following Behavior

An Operation does not turn tail following into history reading. If the user
was following the logical tail before the Operation, the terminal continues
to follow the tail according to its normal terminal behavior.

## 4. Updating the Anchored Block

The initial protocol defines no mapping between positions in the old and new
complete snapshots of one Block. If an Update replaces the Block containing
the reading anchor, the terminal is not required to preserve an internal
position within that Block.

The Update still follows the normal Block replacement and history-integrity
semantics. This exception does not permit corruption or duplication.
Unaffected content may disappear only through the normal capacity policy
defined below.

ReplaceSuffix provides a narrower mapping for an anchor in its target Block.
An anchor in the retained prefix remains at its logical position. An anchor in
the removed suffix moves to the replacement boundary, while a tail-following
reader continues to follow the new tail.

## 5. Scrollback Capacity

The anchor guarantee applies while the anchored logical position remains in
terminal-owned history. If normal scrollback-capacity trimming removes that
position while the user is reading history, the terminal moves the viewport
to the nearest later logical content that remains retained and stays in
history reading mode. It does not switch to tail following solely because the
anchor was trimmed.

Capacity trimming is terminal-owned resource management. It is distinct from
history being cleared, duplicated, or lost while realizing an Operation.
Trimming is not a Block lifecycle transition and does not itself Seal a Block
or revoke Context authority.

This draft has not yet defined the observable result of a later Operation that
targets partially or fully trimmed content, or the reading-state fallback when
no later retained logical position exists.

## 6. Resize and Reflow

A terminal resize may reflow the presentation of every retained Block. Reflow
changes physical layout only; it does not change Block content, identity,
lifecycle, or append order and does not produce a protocol Operation or
Message.

Tail following continues across resize. During history reading, reflow keeps
the same logical reading anchor and its viewport-relative row. If the old row
does not exist in a smaller viewport, the terminal uses the closest available
row without switching to tail following.

## 7. Selection and Copying

A selection remains attached to the same logical content when another Block
changes or when reflow moves that content to different physical rows. Append
and Seal do not clear an otherwise valid selection.

If an Update replaces any Block intersected by the selection, the terminal
clears the complete selection. The initial complete-snapshot model provides
no mapping from selected positions in the old content to the replacement.
ReplaceSuffix preserves a selection entirely within its retained prefix and
clears a selection that intersects its removed suffix. Extend does not
invalidate a selection of pre-existing content. Scrollback-capacity
trimming that removes any selected content has the same effect.

Clearing a selection removes its highlight and copy target; it does not remove
Block content. Copying returns only the content of a current valid selection,
never content retained from a replaced snapshot.

## 8. Search

Terminal-native search operates on the current searchable text projection of
each retained Block. After an Update or incremental content Operation, matches
that no longer exist are no longer results, and matches in the resulting
content are eligible results. Matches in unaffected content remain attached to
the same logical content even if their physical rows move.

If the current match disappears, the terminal does not retain a match that
points to old or unrelated content. Whether its local search interface moves
to another result, stays at the current viewport, or reports no current result
remains terminal-owned UX.

## 9. Content Metadata

Links, styles, and other metadata defined by a content representation belong
to that content snapshot. Update removes the old snapshot's metadata and
projects only metadata defined by the replacement. Metadata in unaffected
Blocks remains attached to its logical content rather than its former physical
rows.

Metadata does not create an independent Block Operation or allow a content
snapshot to modify terminal-global state. Each content type defines its own
logical metadata and terminal-native projection.

## 10. Active Input State

Changing historical Blocks does not itself alter current input content, the
input cursor's logical position, input focus, or an in-progress input-method
composition. The terminal may scroll while tail following to keep current
input visible, but physical layout changes do not move the logical input
position.

## 11. Mixed Ordinary Output

Ordinary terminal output that appends at the logical tail remains unmanaged
terminal history at its byte-stream position. It does not become part of an
adjacent Block and does not change Block content, lifecycle, content-state
identity, or Context authority. A later Append creates its Block after that
unmanaged output.

When an Operation changes the rendered height of an earlier Block, later
unmanaged output and later Blocks move together without being duplicated,
dropped, or reordered while that content remains retained under the terminal's
normal capacity policy. If the user is reading a logical position in that
unmanaged output, the terminal keeps the same content at the same
viewport-relative row while it remains retained. This internal identity is
terminal-owned and is not exposed to the TUI.

A managed Block and adjacent unmanaged output do not share one logical line.
If the preceding logical region does not already end at a line boundary, the
terminal supplies one. Copying a selection across that boundary represents it
as one newline.

Frame-external terminal traffic retains its normal terminal meaning. If its
realized effect makes a managed Block's rendering or reliable range no longer
trustworthy, it follows the Context invalidation boundary defined by [Protocol
Context Semantics](contexts.md#8-frame-external-invalidation).

## Experimental Evidence

The executable evidence for this draft is recorded in the linked prototype
READMEs; those documents are the source of truth for exact scenarios and
limitations:

- The [xterm protocol endpoint](../../prototypes/integration/xterm-protocol-endpoint/README.md)
  composes the codec, Session, terminal adapter, and private xterm.js history
  path. It exercises reading anchors, tail following, resize and reflow, a
  narrow complete-Block capacity boundary, a narrow parser bridge, ordered
  mixed output, one conservative mixed-capacity rejection, and bounded
  line-erase, display-erase, scrollback-clear, and full-reset invalidation
  cases.
- The browser-hosted [selection and copy](../../prototypes/integration/xterm-browser-selection/README.md),
  [search](../../prototypes/integration/xterm-browser-search/README.md),
  [content metadata](../../prototypes/integration/xterm-browser-metadata/README.md),
  and [active input state](../../prototypes/integration/xterm-browser-input-state/README.md)
  fixtures provide bounded evidence for their corresponding sections above.
- The [browser protocol endpoint](../../prototypes/integration/xterm-browser-protocol-endpoint/README.md)
  composes all five current Block Operations with the tested browser states,
  resize and reflow, and the same narrow complete-Block capacity boundary.

Together these experiments provide bounded evidence only for their listed
fixtures. They do not establish protocol conformance, cross-terminal
compatibility, a public terminal API, arbitrary mixed-stream ingress,
partial-Block or Append-driven eviction, non-ASCII position mapping, or
production renderer failure atomicity. Successful capacity eviction across
mixed managed and unmanaged history is also not demonstrated.

## Current Scope

This draft defines initial correctness boundaries for reading, reflow,
selection, search, content metadata, and active input. It does not standardize
terminal shortcuts, search navigation policy, visual presentation, or internal
data structures. Detailed behavior for optional content representations
remains part of each representation's definition.

The initial mixed-output boundary covers ordinary traffic that appends at the
logical tail. It does not attempt to redefine the terminal's native control
language. The effect of frame-external traffic on Context authority is
governed by the Context invalidation rule, while the exact reset effect on an
incomplete protocol frame assembly remains a framing question.

The current prototypes do not yet test the reading-anchor guarantee for
unmanaged output or selection and copy across a managed/unmanaged boundary.
