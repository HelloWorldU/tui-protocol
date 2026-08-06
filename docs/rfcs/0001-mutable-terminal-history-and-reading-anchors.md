# RFC 0001: Mutable Terminal History and Reading Anchors

| Field | Value |
|---|---|
| Status | Draft |
| Author | HelloWorldU |
| Created | 2026-07-31 |

## Abstract

This RFC frames a protocol for identified, mutable content in terminal-owned
history, allowing applications to update logical blocks while terminals
preserve native scrollback and stable reading positions.

## Background

AI coding assistants and agentic tools have created long-running, dynamic TUI
sessions in which earlier content continues to finalize, expand, shrink, and
reflow. Users still expect to review that content through terminal-owned
scrollback and its native reading capabilities.

Existing terminal protocols let applications edit the active screen, but do
not give historical content stable logical identity. Differential redraw
cannot generally reach anonymous rows already in scrollback, while destructive
clear-and-replay can erase history, duplicate content, or move the user's
reading position.

The missing contract is not a new redraw algorithm. Applications need to
express the identity and revision of logical content; terminals need to apply
those updates to their own history and preserve the user's reading position.
This resembles targeted updates to identified document nodes, without
requiring the terminal to become a browser or expose a DOM.

## Goals

The project explores whether a terminal protocol can provide all three of
these properties together:

1. Preserve terminal-owned scrollback and the native terminal capabilities
   built around it.
2. Update or reflow dynamic content after it has left the active screen.
3. Keep the user's reading position anchored to logical content when output
   continues or content above it changes.

## Responsibility Boundaries

The protocol separates three responsibilities:

1. **Content (TUI-owned)**: The TUI identifies logical blocks, controls their
   lifecycle, and decides when their content changes.
2. **Execution (terminal-owned)**: The terminal stores and lays out history,
   realizes content changes, and preserves terminal-native capabilities and
   the user's reading position.
3. **Info (shared)**: The protocol carries semantic changes between the TUI
   and terminal and specifies their observable effects without exposing
   cursor movement, physical rows, or redraw algorithms to the TUI.

A block's lifecycle is independent of its physical location. A block may
remain mutable after its rendered rows have entered scrollback, and entering
scrollback does not implicitly finalize it.

## Minimal Protocol Model

The initial model has two core primitives:

1. **Block**: an identified logical unit of content whose lifecycle is
   controlled by the TUI and whose presentation is controlled by the
   terminal.
2. **Operation**: a semantic change to one or more blocks. The TUI expresses
   the intended change; the terminal decides how to apply and render it.

Operations describe changes to blocks, not terminal rendering instructions.
For example, a user action inside a TUI may result in a block operation, while
terminal-native scrolling, selection, and copying remain entirely within the
terminal.

The terminal may use block identity to preserve a reading anchor across an
operation, but an anchor is not exposed as a separate primitive in this
initial model. The complete operation set, block representation, and wire
encoding remain open.

## Protocol Semantics

Detailed observable semantics are consolidated in the living
[Operation Semantics](../protocol/operations.md) document:

- [Append](../protocol/operations.md#append) introduces a Block; its initial
  semantics are defined.
- [Update](../protocol/operations.md#update) replaces the content of an
  existing mutable Block; its initial semantics are defined.
- [Seal](../protocol/operations.md#seal) finalizes a Block; its initial
  semantics are defined.

Protocol activation is governed by the living
[Capability Negotiation](../protocol/capabilities.md) document. A TUI enables
Block Operations only after the current terminal connection positively
confirms complete support for a mutually understood protocol version.

Any concrete encoding must satisfy the living
[Wire Format Requirements](../protocol/wire-requirements.md), including
explicit framing, safe coexistence with ordinary terminal traffic, ordered
application, payload integrity, failure recovery, and bidirectional
capability negotiation.
