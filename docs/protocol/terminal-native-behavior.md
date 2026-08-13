# Terminal-Native History and Reading Behavior

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Operation semantics](operations.md), [Content representation](content-representation.md) |

This document defines the initial observable behavior of terminal-owned
history and reading position when protocol Operations change Block content.
It does not expose the viewport to the TUI or prescribe a terminal rendering
algorithm.

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

## 5. Scrollback Capacity

The anchor guarantee applies while the anchored logical position remains in
terminal-owned history. If normal scrollback-capacity trimming removes that
position while the user is reading history, the terminal moves the viewport
to the nearest later logical content that remains retained and stays in
history reading mode. It does not switch to tail following solely because the
anchor was trimmed.

Capacity trimming is terminal-owned resource management. It is distinct from
history being cleared, duplicated, or lost while realizing an Operation.

## Current Scope

This draft defines reading behavior for Operations that affect content other
than the anchored Block, plus the capacity boundary above. It does not yet
define the interaction of mutable Blocks with resize and reflow, selections,
search results, hyperlinks, or other terminal-native metadata.
