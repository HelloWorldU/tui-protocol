# Content Representation

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Operations](operations.md), [Capabilities](capabilities.md), [Wire requirements](wire-requirements.md) |

This document defines the observable requirements for representing a Block's
content. It does not yet select a wire serialization or define a catalog of
optional content types.

## 1. Self-Contained and Declarative

A content snapshot describes what a Block contains, not a sequence of drawing
instructions. Its meaning does not depend on the global cursor position,
screen contents, or terminal state outside that Block.

A content representation cannot move the global cursor, clear the screen, or
modify another Block. Payload data is interpreted only according to its
declared content type; for example, escape sequences in `text/plain` are not
executed as terminal controls.

## 2. Single Negotiated Representation

Each Block snapshot carries exactly one content representation. Every terminal
that confirms support for the initial protocol version supports `text/plain`
as the baseline representation. Optional representations are advertised
through capability negotiation, and the TUI selects one that the terminal has
confirmed.

A snapshot does not carry a bundle of alternative representations. The
terminal therefore does not choose among alternatives or reconcile multiple
versions of the same logical content.

## 3. Explicit Content Type

Each snapshot explicitly declares its content type. The terminal interprets
the accompanying data according to that type and does not infer the type by
inspecting the payload.

An unknown, unnegotiated, or invalid content type makes the containing
Operation invalid and leaves protocol state unchanged. The concrete type
identifier and schema encoding remain wire-level design questions.

## 4. Complete Replacement Across Types

The content value consists of its type and data. An Update replaces that
complete value atomically and may retain the current type or change to another
type confirmed during capability negotiation.

The terminal does not convert between content types. A replacement whose new
type is unsupported or whose data is invalid fails as a whole, leaving the
Block's previous content unchanged.

## 5. Terminal-Native Projection

Each content type defines the logical semantics that terminal-native
capabilities operate on, including layout and reflow, selection and copying,
and a searchable text projection. For `text/plain`, that projection is the
text itself; richer types may preserve structured rendering while defining
the corresponding logical text.

The content type specifies these observable semantics. The terminal retains
ownership of how native capabilities are implemented, presented, and
executed.

## Open Design Choices

- Serialization and validation of the `ContentSnapshot` type and data fields.
- Newline, control-character, and Unicode handling for `text/plain`.
- The initial set of optional content types and their schemas.
- Content-type naming, registration, and versioning.
- Detailed native projections for each optional content type.
