# Terminal-Native Behavior

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Operation semantics](operations.md), [Content representation](content-representation.md) |

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
semantics. This exception does not permit corruption, duplication, or loss of
unaffected Blocks.

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

## Experimental Evidence

The [xterm Protocol Endpoint Integration
Prototype](../../prototypes/integration/xterm-protocol-endpoint/README.md)
composes the current OSC codec, Session semantics, and a private xterm.js
history implementation. Its tested earlier-Block growth and shrink preserve a
later history-reading position, including across a tested resize and reflow,
while its tested tail-following viewport stays at the new tail. Its Extend and
ReplaceSuffix paths additionally exercise incremental content-state checks and
their defined target-Block reading-anchor mappings. The prototype's
capacity-limited cases demonstrate that a known resource limit can reject a
prepared Update, Extend, or ReplaceSuffix with `resource_exhausted` before
either Session state or rendered history changes. A separate capacity-aligned
Update test trims exactly one complete oldest Block while preserving a later
history-reading position and subsequent queued rendering. When that complete
Block instead contains the reading position, another tested path moves the
viewport to the next retained Block without following the tail. Partial-Block
trimming remains outside that tested boundary. Other renderer failures,
private APIs, and untested interaction paths further bound this evidence; they
are not a required implementation design. A separate [browser selection
prototype](../../prototypes/integration/xterm-browser-selection/README.md)
demonstrates two complete-Update cases: an unaffected later selection and its
copy text survive earlier-Block growth, while updating the selected Block
clears both the selection and its subsequent copy source. The same browser run
demonstrates three single-line ASCII ReplaceSuffix cases: a selection entirely
inside the retained prefix survives, while a selection inside the replaced old
suffix or crossing the retained-prefix boundary is cleared. Each case inserts
a non-empty replacement suffix. The experiment does not yet cover mouse
selection, the operating-system clipboard, Extend, reflow, capacity eviction,
or non-ASCII and wrapped ReplaceSuffix mapping.

## Current Scope

This draft defines initial correctness boundaries for reading, reflow,
selection, search, content metadata, and active input. It does not standardize
terminal shortcuts, search navigation policy, visual presentation, or internal
data structures. Detailed behavior for optional content representations
remains part of each representation's definition.
