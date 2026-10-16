# Styled Text Content

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0002](../rfcs/0002-styled-text-content.md) |
| Related drafts | [Content representation](content-representation.md), [Plain text content](plain-text.md), [Operations](operations.md), [Capability negotiation](capabilities.md), [Terminal-native behavior](terminal-native-behavior.md), [Concrete message schemas](message-schemas.md), [Error codes](error-codes.md) |

This document defines `text/styled`, the first optional content type: text
with per-range character styling. [Capability Negotiation](capabilities.md)
governs how a terminal advertises it and how a TUI selects it; a TUI falls
back to `text/plain` when it is not confirmed.

## 1. Span List and Logical Text

A `text/styled` content value is an ordered list of spans. Each span carries
a non-empty text string and an optional style. A span without a style uses
the terminal's default style. An empty span list is empty content.

The concatenation of all span texts in order is the Block's logical text.
Line breaks, tabs, visible control labels, and width follow [Plain Text
Content](plain-text.md) unchanged: styling annotates the displayed result of
the logical text and never alters layout. A span's style covers everything
its text displays as, including the visible labels of control characters.

The representation is declarative and self-contained per [Content
Representation](content-representation.md): it carries no escape sequences,
cursor movement, or references to state outside the Block.

## 2. Style Attributes

A style may combine any of:

- `foreground` and `background`: the terminal's current default color, a
  256-palette index (indices 0–15 follow the terminal's configured ANSI
  palette), or a 24-bit RGB value.
- `bold`, `faint`, `italic`, `underline`, `strikethrough`, `inverse`:
  booleans.

Every attribute is optional; an absent attribute means the terminal default
for that attribute. No other attributes are defined. Blink is not defined.

## 3. Incremental Editing

Unlike the general optional-type default of complete snapshots, `text/styled`
adopts the incremental Operations:

- **Extend** carries a non-empty span list appended once at the exact current
  logical tail. The content-state precondition, failure split, and recovery
  model are unchanged from [Operation Semantics](operations.md). The result
  is equivalent to concatenating the previous span list and the supplied one;
  whether adjacent identically styled spans are merged is an internal
  representation choice.
- **ReplaceSuffix** carries the shared content-state base, a retained-prefix
  count, and a replacement span list that may be empty. The retained-prefix
  count uses the same unit as `text/plain`: Unicode scalar values of the
  logical text, ignoring span boundaries. A boundary inside a span truncates
  that span; the retained part keeps its style.

An incremental Operation on a Block whose current content is `text/styled`
carries a span list; on a `text/plain` Block it carries text. A fragment or
replacement whose shape does not match the Block's current content type is a
content-validity failure. Update may replace the complete value with any
confirmed type, including between `text/plain` and `text/styled`.

## 4. Terminal-Native Projections

Selection, copy, and search operate on the logical text exactly as they do
for `text/plain`, including the two-cell Han selection rule. Span boundaries
and styles are invisible to search matching. Copy produces the logical text;
offering styled clipboard formats in addition is a terminal-owned choice
outside this draft. Styling moves with its characters under reflow and never
changes a logical position, so reading-anchor semantics are unchanged.

## 5. Failure Reporting

Reporting follows [Content Representation](content-representation.md). For
`text/styled`:

- A malformed type field, a non-array span list, a span missing `text`, or a
  span carrying fields other than `text` and `style` is a schema violation
  and reports `invalid_message`.
- A structurally valid value violating this type's content rules reports
  `invalid_content`: an empty span text, an unknown style attribute, a
  non-boolean emphasis attribute, or a malformed or out-of-range color.
- Receiving `text/styled` content that was not confirmed during capability
  negotiation reports `unsupported_content_type`.
- Incremental Operations keep the existing `content_state_mismatch` and
  `invalid_content_boundary` split; the boundary unit is the logical-text
  scalar count.

Every failure leaves the Block's content, lifecycle, and content-state
identifier unchanged.

## 6. JSON Mapping

In the initial JSON serialization, the content snapshot is:

```text
{ "type": "text/styled", "data": [ span, ... ] }

span = { "text": Text, "style": style? }
style = {
  "foreground": color?, "background": color?,
  "bold": boolean?, "faint": boolean?, "italic": boolean?,
  "underline": boolean?, "strikethrough": boolean?, "inverse": boolean?
}
color = "default" | { "palette": integer 0-255 } | { "rgb": [r, g, b] }
        with r, g, b integers 0-255
```

For a Block whose current content is `text/styled`, `block.extend`'s
`fragment` is a non-empty span array and `block.replace_suffix`'s
`replacement` is a possibly empty span array; the field names are unchanged
from the baseline schemas in [Concrete Message
Schemas](message-schemas.md). Schema-level validation checks span structure
only; the content rules of section 5 are content semantics, not schema.

## Open Design Choices

- Attribute extensibility and type versioning beyond the closed attribute
  set above.
- Underline variants and other legacy emphasis attributes.
- Styled clipboard formats.
- Hyperlink range attributes and semantic theme colors, both deferred by
  [RFC 0002](../rfcs/0002-styled-text-content.md).

## Experimental Evidence

- The [codec tests](../../protocol/test/codec.test.ts) round-trip styled
  snapshots, span fragments, and span replacements, and reject structural
  violations with their Operation identity.
- The [styled session tests](../../terminal/test/styled-content.test.ts)
  exercise negotiation advertisement, `unsupported_content_type` and
  `invalid_content` reporting, span-aware Extend and ReplaceSuffix including
  mid-span boundaries, type switching through Update, and resource accounting
  on logical text.
- The [pi-stock-ui trial](../../prototypes/integration/pi-stock-ui/README.md#styled-transcript-content)
  streams a real application's rendered styling (Pi's markdown emphasis,
  thinking, and error styles) into `text/styled` assistant Blocks while user
  and tool Blocks stay `text/plain` in the same Context, verifies the styled
  cell attributes in a headless xterm buffer, and checks that the logical
  text projection matches the plain mapping for the prose fixture.
