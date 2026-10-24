# Line Layout Text Content

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0003](../rfcs/0003-line-layout-attributes.md) |
| Related drafts | [Styled text content](styled-text.md), [Content representation](content-representation.md), [Plain text content](plain-text.md), [Operations](operations.md), [Capability negotiation](capabilities.md), [Terminal-native behavior](terminal-native-behavior.md), [Concrete message schemas](message-schemas.md), [Error codes](error-codes.md) |

This document defines `text/lines`, an optional content type: styled text
organized as lines, each with layout attributes the terminal applies at every
width. [Capability Negotiation](capabilities.md) governs how a terminal
advertises it and how a TUI selects it. It complements
[`text/styled`](styled-text.md) rather than replacing it: a terminal that
implements only styling advertises `text/styled`, and a TUI prefers
`text/lines` when both are confirmed.

## 1. Lines and Logical Text

A `text/lines` value is an ordered list of lines. Each line carries a span
list following the span and style rules of [Styled Text
Content](styled-text.md), except that span text contains no line break
character (LF or CR), and optional layout attributes. An empty line list is
empty content; a line with an empty span list is an empty line.

The Block's logical text is the line texts joined by LF. Tabs and visible
control labels follow [Plain Text Content](plain-text.md).

## 2. Wrap Mode

`wrap` selects how a line wider than the display breaks into rows:

- `word` (the default): the terminal breaks at break opportunities. At
  minimum, a break opportunity follows each run of spaces and lies between
  any two adjacent wide (two-cell) characters. A word wider than the
  available width breaks between cells. Spaces at a break are not displayed
  but remain logical text. Terminals may use a fuller algorithm, such as
  Unicode line breaking.
- `char`: the terminal breaks between cells, as for `text/plain`.

Rows created by wrapping are soft: they add no logical line break and no
copied text.

## 3. Continuation Prefix

`continuation` is an optional span list displayed at the start of every
soft-wrapped row of the line, before the wrapped text. It is presentation:
it is not logical text, not matched by search, not counted by
ReplaceSuffix, and not copied. The prefix of a line's first row is ordinary
span text. When the continuation leaves no width, the terminal omits it for
that row rather than failing.

## 4. Fill Line

A line with `fill` carries exactly one span whose text is one grapheme; the
terminal repeats it across the display width in whole cells, recomputed on
every reflow. Its logical text is that grapheme once, and copy yields it
once. A fill line carries no `wrap` or `continuation`.

## 5. Incremental Editing

- **Extend** carries a non-empty line list. Its first line's spans append to
  the current last line, whose attributes stay unchanged; that first line
  must not declare attributes. Each further line is appended with its own
  attributes. A fill line receives no further text; a fragment whose first
  line is empty may follow it with new lines. Extending empty content
  appends the lines as given.
- **ReplaceSuffix** counts its retained prefix in Unicode scalar values of
  the logical text, LF separators included. The line containing the
  boundary is truncated with the span rule of Styled Text Content and keeps
  its attributes; the replacement line list, which may be empty, follows the
  Extend rule. A boundary at the end of a line, before its separator,
  removes all following lines.
- **Update** replaces the complete value and may change the content type to
  any confirmed type. Seal is unchanged.

A fragment or replacement on a `text/lines` Block is a line list; on other
Blocks its shape follows their own type. A shape that does not match the
Block's current content type is a content-validity failure.

## 6. Terminal-Native Projections

Selection, copy, and search operate on the logical text. A selection across
soft-wrapped rows copies the text between its ends, including spaces dropped
at a break, and no continuation prefix or line break; a selection starting
inside a prefix starts at the row's text. Search matches the logical text
across soft breaks and never matches a prefix. Reflow changes only rows; a
reading anchor bound to a logical position stays bound to it.

## 7. Failure Reporting

Reporting follows [Content Representation](content-representation.md). For
`text/lines`:

- A malformed type field, a non-array line list, a line that is not an
  object, a line without a `spans` array, a field other than `spans`,
  `wrap`, `continuation`, and `fill`, a non-string `wrap`, a non-array
  `continuation`, a non-boolean `fill`, or a span violating the span schema
  is a schema violation and reports `invalid_message`.
- A structurally valid value violating this type's content rules reports
  `invalid_content`: any span or continuation rule of Styled Text Content, a
  line break in span or continuation text, a `wrap` other than `word` or
  `char`, `fill` present but not `true`, a fill line with attributes or
  without exactly one single-grapheme span, a first fragment line that
  declares attributes, or text extending a fill line.
- Receiving `text/lines` content that was not confirmed reports
  `unsupported_content_type`.
- Incremental Operations keep the existing `content_state_mismatch` and
  `invalid_content_boundary` split.

Every failure leaves the Block's content, lifecycle, and content-state
identifier unchanged.

## 8. JSON Mapping

In the initial JSON serialization, the content snapshot is:

```text
{ "type": "text/lines", "data": [ line, ... ] }

line = {
  "spans": [ span, ... ],
  "wrap": "word" | "char" ?,
  "continuation": [ span, ... ] ?,
  "fill": true ?
}
```

`span` is the span of [Styled Text Content](styled-text.md#6-json-mapping).
For a Block whose current content is `text/lines`, `block.extend`'s
`fragment` is a non-empty line array and `block.replace_suffix`'s
`replacement` is a possibly empty line array. A non-empty array whose first
element has a `spans` field is a line array; otherwise it is a span array,
and an empty array is a valid empty replacement for either. Schema-level
validation checks structure only; the rules of section 7 that are not
schema rules are content semantics.

## Open Design Choices

- Whether a fill line takes a maximum width. Pi 0.87.1 caps its rules at 80
  cells; a fill line spans the display width.
- Break opportunities for scripts that neither use spaces nor render as wide
  characters, such as Thai.
- Whether code needs a non-wrapping mode with horizontal truncation.

## Experimental Evidence

- The [codec tests](../../protocol/test/lines-codec.test.ts) round-trip line
  snapshots, line fragments, and line replacements, and reject structural
  violations with their Operation identity.
- The [Session tests](../../terminal/test/lines-content.test.ts) cover
  advertisement, `unsupported_content_type`, each `invalid_content` rule,
  line-aware Extend and ReplaceSuffix, and type switching through Update.
- The [line layout prototype](../../prototypes/line-layout/README.md)
  implements sections 2–4 and the projections of section 6; Pi 0.87.1's
  output converted to `text/lines` lays out exactly as Pi renders it at every
  width from 20 to 100 columns for a Chinese and nested-list sample.
- The [xterm lines host](../../prototypes/integration/xterm-lines-host/README.md)
  and the region-aware host in the
  [Pi stock-UI trial](../../prototypes/integration/pi-stock-ui/README.md#line-layout-transcript-content)
  execute the type end to end, browser-verified, including copy, search, and
  reading position across resizes.
