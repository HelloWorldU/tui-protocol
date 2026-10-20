# RFC 0002: Styled Text Content

| Field | Value |
|---|---|
| Status | Accepted |
| Author | HelloWorldU |
| Created | 2026-10-16 |
| Accepted | 2026-10-20 |

## Abstract

This RFC proposes the first optional content type, `text/styled`: text with
per-range character styling (colors and emphasis), carried as a declarative
span list and editable through the incremental Operations. Structural content
such as tables, borders, and collapsible regions is explicitly left to later
work.

## Background

The protocol's baseline `text/plain` carries unstyled text. Real TUI
applications do not produce unstyled text: their interfaces rely on colors and
emphasis for syntax highlighting, status signaling, and visual structure. An
application integrated through the protocol today must strip that styling, so
adopting the protocol currently means a visibly degraded interface — a
regression that most applications will not accept. The adoption-path
assessment ranks this content gap as the second adoption blocker, behind only
the cold start ([Adoption path and cold start](../design/adoption-path.md)).
The Pi stock-UI trial currently passes plain text only, and the content-samples
record names styled ordinary traffic as a needed next step
([Trial content samples](../design/trial-content-samples.md)).

Applications already decide their styling and already express it, today as
ANSI styling sequences inside ordinary output. The gap is not styling intent
but a channel that can carry that intent without reverting to drawing
instructions. [Content Representation](../protocol/content-representation.md)
anticipates optional content types negotiated per connection; this RFC defines
the first one.

## Ownership Boundaries

Style decisions are content: which characters carry which color or emphasis is
the TUI's choice. Painting, layout, reflow, selection rendering, and clipboard
formats are execution: they remain terminal-owned. The wire carries the TUI's
styling decision as data, not drawing instructions. This split follows the
responsibility boundaries of
[RFC 0001](0001-mutable-terminal-history-and-reading-anchors.md); nothing in
this RFC moves rendering ownership to the TUI.

## Goals

1. Carry the styling real TUIs already produce — colors and emphasis — so
   that protocol integration no longer degrades their interfaces to plain
   text.
2. Keep every terminal-owned behavior operating on the logical text
   unchanged: layout, reflow, selection, copy, search, and reading anchors.
   Styling annotates characters; it never changes layout.
3. Support incremental streaming of styled content, since the primary
   scenario (AI agent output) arrives incrementally.
4. Remain optional and negotiated, with a clean fallback to `text/plain`.

## Non-Goals

- Structural content: tables, borders, collapsible regions, or layout
  containers. Unlike character styling, these change layout itself and
  interact with terminal-owned reflow, selection, and reading anchors; they
  require separate design.
- Images or other non-text media.
- Markdown or other markup rendering. A future markup type could project onto
  this one.
- Semantic or themeable color systems (for example, a named "error" color
  resolved by the terminal). Applications today produce literal colors.
- Rich clipboard formats. Copy keeps its plain-text projection.

## Proposal

### 1. Span List Representation

A `text/styled` content value is an ordered list of spans. Each span carries
a non-empty text string and an optional style. A span without a style uses
the terminal's default style. An empty span list is empty content.

The concatenation of all span texts in order is the Block's logical text.
Line breaks, tabs, visible control labels, width, and reflow follow
[Plain Text Content](../protocol/plain-text.md) unchanged: styling annotates
the displayed result of the logical text and never alters its layout. A
span's style covers everything its text displays as, including the visible
labels of control characters.

The representation is declarative and self-contained as required by
[Content Representation](../protocol/content-representation.md): it contains
no escape sequences, cursor movement, or references to state outside the
Block.

### 2. Initial Style Attribute Set

A style may combine:

- Foreground and background color, each one of: the terminal's current
  default, a 256-palette index (indices 0–15 follow the terminal's configured
  ANSI palette), or a 24-bit RGB value.
- Boolean emphasis: bold, faint, italic, underline, strikethrough, inverse.

Every attribute is optional; absent attributes mean the terminal default.
This set mirrors what terminals already paint for ordinary styled output. The
exact JSON encoding is defined by a follow-up protocol draft and is not part
of this RFC.

### 3. Incremental Editing

`text/styled` explicitly adopts incremental editing, as permitted for optional
types by [Capability Negotiation](../protocol/capabilities.md):

- **Extend** carries a non-empty span list appended once at the exact current
  logical tail. The content-state precondition and recovery model are
  unchanged from [Operation Semantics](../protocol/operations.md). The result
  is equivalent to concatenating the previous span list and the supplied one;
  whether adjacent identically styled spans are merged is an internal
  representation choice invisible on the wire.
- **ReplaceSuffix** carries the shared content-state base, a retained-prefix
  count, and a replacement span list (possibly empty). The retained-prefix
  count uses the same unit as `text/plain`: Unicode scalar values of the
  logical text, ignoring span boundaries. When the boundary falls inside a
  span, the retained part of that span keeps its style; the replacement span
  list follows. The `content_state_mismatch` and `invalid_content_boundary`
  failure split is unchanged.

Update continues to replace the complete content value atomically and may
change the content type to any confirmed type, including back to
`text/plain`. Seal is unchanged.

### 4. Terminal-Native Projections

Selection, copy, and search operate on the logical text exactly as they do
for `text/plain`, including the two-cell Han selection rule. Span boundaries
and styles are invisible to search matching. Copy produces the logical text;
whether a terminal additionally offers styled clipboard formats is a
terminal-owned choice outside this RFC. Reading-anchor semantics are
unchanged because styling never moves a logical position.

### 5. Failure Behavior

Failure reporting follows
[Content Representation](../protocol/content-representation.md): a malformed
type field or schema violation reports `invalid_message`; a well-formed but
unnegotiated or unknown type reports `unsupported_content_type`; structurally
valid data violating this type's content rules reports `invalid_content`.
Content-rule violations include an empty span text, an unknown style
attribute, and a malformed or out-of-range color. Every failure leaves the
Block's content, lifecycle, and content-state identifier unchanged.

## Compatibility and Fallback

`text/styled` is advertised and selected through the optional-content-type
mechanism of [Capability Negotiation](../protocol/capabilities.md). A
terminal advertises it only when it completely implements this type,
including validation, layout and reflow, the native projections, and the
incremental Operations above. Baseline `text/plain` support is unaffected.

When `text/styled` is not confirmed, the TUI's fallback remains
application-owned: strip styling and send `text/plain`, or render outside the
protocol entirely. The Pi stock-UI trial already exercises the plain-text
fallback shape this fallback requires.

## Security Considerations

The representation carries declarative attributes only: no escape sequences
are interpreted, so styled content cannot move the cursor, clear the screen,
or modify other Blocks. Styling can conceal text (for example, foreground
equal to background), as ANSI styling already can today; selection and copy
operate on the logical text, so concealed text remains selectable and
copyable, and selection rendering remains terminal-owned. Span counts
contribute to content size and are bounded by the terminal's existing
capacity policy; oversized content fails as `resource_exhausted`.

## Alternatives and Prior Art

- **An ANSI-embedded string type** (styling sequences inside the payload).
  Rejected as the wire representation: embedded instructions are not
  self-contained or declarative, an incremental edit can split a sequence,
  and validation would depend on terminal-control dialects. SDK-side
  conversion from an application's existing ANSI-styled strings into spans is
  the intended adoption path and is an implementation detail, not wire
  format.
- **A snapshot-only styled type** without incremental editing. Rejected:
  streaming output would require resending the complete content per fragment,
  which is quadratic traffic for the primary scenario. Capability negotiation
  already permits an optional type to define its own incremental semantics.
- **A Markdown content type.** Deferred: it requires layout-affecting
  rendering decisions (heading sizes, list indentation) and can later be
  defined to project onto `text/styled`.
- **Semantic theme colors.** Deferred: applications today emit literal
  colors; a named-palette layer can be added without changing the span model.
- **A hyperlink range attribute.** Deferred: the span model admits additional
  range attributes in a future type revision.

## Unresolved Questions

- The exact JSON encoding of spans, styles, and colors.
- Attribute extensibility: whether unknown style attributes must be rejected
  (consistent with closed Message schemas) or ignored, and how a future
  revision of the type is named.
- Underline variants, blink, and other legacy emphasis attributes.
- Whether and how copy may carry styling to rich clipboard formats.
- Resource accounting for span counts, and any span-count limits.

## Evidence Required Before Acceptance

- Protocol package: schema, validation, and serialization coverage for the
  type, both incremental Operations, and each failure category above.
- Terminal module: styled rendering through the xterm adapter across all five
  Operations, reflow carrying styles with their characters, unchanged
  selection, copy, and search projections, and preserved reading anchors.
- Browser checks verifying the actual rendered attributes and the native
  projections.
- Pi stock-UI trial: Pi's real styled output carried through the protocol
  instead of stripped, with the plain-text fallback intact when the type is
  unconfirmed — a before/after pair against the current plain-text trial.
- An SDK-side ANSI-to-span conversion path exercised against recorded samples
  of real application output.
