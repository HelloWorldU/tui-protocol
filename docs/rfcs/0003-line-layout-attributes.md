# RFC 0003: Line Layout Attributes

| Field | Value |
|---|---|
| Status | Draft |
| Author | HelloWorldU |
| Created | 2026-10-19 |

## Abstract

This RFC proposes `text/lines`, an optional content type that extends styled
text with per-line layout attributes: a wrap mode, a continuation prefix for
soft-wrapped rows, and a width-filling line. Applications declare layout
intent once; the terminal applies it on every reflow, so content laid out by
a TUI renderer stays correct when the display width changes.

## Background

[`text/styled`](0002-styled-text-content.md) carries an application's styling
decision, but not its layout decision. A TUI renderer lays content out for a
known width: it wraps prose at word boundaries, indents list continuations,
repeats quote markers, and draws rules across the width. Once that content
is a Block in terminal-owned history, a width change is executed by the
terminal's reflow, which has only the logical text to work with.

The [renderer-owned layout experiment](../design/renderer-layout-and-reflow.md)
measured the consequence with Pi 0.87.1's real renderer and the experimental
xterm host. Content rendered at the display width matches Pi's layout row for
row; after a resize it does not, whichever render width the application
chooses:

- Rendering at the current width bakes width breaks into the logical text
  (6 extra breaks at 60 columns in the sample). Narrowing to 36 columns kept
  17 of Pi's 29 rows, with 6 words split and 3 list or quote continuations
  missing their prefix; widening left the width unused, and copy carries the
  baked breaks.
- Rendering wide keeps only content breaks, but the terminal's cell-based
  reflow then split 6 words at 60 columns and 11 at 36, dropped continuation
  prefixes, and spilled a fixed-length rule onto extra rows.

Re-rendering every Block through Update after each resize would require every
Block to stay mutable for its lifetime and resend retained history per
resize. The terminal already owns reflow; the gap is that it lacks the
layout intent needed to reflow this content well.

## Ownership Boundaries

Layout intent is content: whether a line is prose or code, which prefix its
continuations carry, and whether a line fills the width are the TUI's
decisions, as the renderer already makes them today. Choosing break
opportunities, measuring cells, producing rows, and reflowing on resize
remain terminal-owned execution under
[RFC 0001](0001-mutable-terminal-history-and-reading-anchors.md). No attribute
names a row, a column count, or a cursor position.

## Goals

1. Let an application render once, independent of width, and have the
   terminal reproduce the renderer's word wrapping, hanging indents, quote
   markers, and rules at any width.
2. Keep the logical text, copy, search, and reading anchors defined by the
   logical lines, with no width-dependent breaks.
3. Keep incremental streaming through Extend and ReplaceSuffix.
4. Stay optional and negotiated, with application-owned fallback to
   `text/styled` or `text/plain`.

## Non-Goals

- Tables, columns, borders around regions, collapsible regions, or other
  two-dimensional containers.
- Alignment (center, right), justification, or hyphenation.
- Prescribing a line-breaking algorithm beyond the minimum below.
- Markdown or other markup interpretation; renderers keep converting markup
  to lines.

## Proposal

### 1. Lines

A `text/lines` value is an ordered list of lines. Each line carries a span
list with the [`text/styled`](../protocol/styled-text.md) span and style
rules, except that span text contains no line break characters, and optional
layout attributes. An empty line list is empty content; a line with an empty
span list is an empty line.

The Block's logical text is the line texts joined by LF. Tabs and visible
control labels follow [Plain Text Content](../protocol/plain-text.md).

### 2. Wrap Mode

`wrap` selects how a line that exceeds the display width breaks into rows:

- `word` (the default): the terminal breaks at break opportunities. At
  minimum, a break opportunity follows each run of spaces and lies between
  any two adjacent wide (two-cell) characters, so CJK text breaks between
  characters; a line falls back to breaking between cells where a single
  word exceeds the available width. Terminals may use a fuller algorithm
  such as Unicode line breaking, for example to keep closing punctuation off
  the start of a row.
- `char`: the terminal breaks between cells, as for `text/plain`, for
  preformatted text where breaking at spaces is not wanted. Pi 0.87.1 wraps
  code blocks with the `word` rule.

Rows created by wrapping are soft: they add no logical line break and no
copied text, consistent with Plain Text Content.

### 3. Continuation Prefix

`continuation` is an optional span list displayed at the start of every
soft-wrapped row of the line, before the wrapped text: two spaces for a
bullet item, three for a numbered item, `│ ` for a quote. It is
presentation, not logical text: it is not part of the logical text, not
matched by search, not counted by ReplaceSuffix, and not copied. Copy keeps
the logical text for the same reason automatic wrapping adds no copied line
breaks; this RFC defines no option to copy prefixes. The prefix
of the line's first row remains ordinary span text, because it is content
(the bullet, the number, the first marker).

When the continuation prefix leaves fewer than one cell of available width,
the terminal omits it for that row rather than failing.

### 4. Fill Line

A line may instead declare `fill`: one span whose text is a single grapheme,
repeated across the display width at its style, recomputed on every reflow.
Its logical text is that grapheme once; copy yields it once. Fill lines carry
no wrap or continuation attributes.

### 5. Incremental Editing

Extend carries a non-empty line list. Its first line's spans append to the
current last line, whose layout attributes stay unchanged; that first line
must not declare its own attributes. Each further line is appended as a new
line with its own attributes. A fill line is never extended; appending text
after it starts a new line.

ReplaceSuffix keeps its shared content-state base and counts the retained
prefix in Unicode scalar values of the logical text, LF separators included.
The line containing the boundary keeps its attributes; the replacement line
list follows the Extend rule. Update replaces the complete value and may
change the content type to any confirmed type.

### 6. Terminal-Native Projections

Selection, copy, search, and reading anchors operate on the logical text, as
for `text/styled`. A selection across a soft wrap copies no prefix and no
line break. Reflow changes only rows; a reading anchor bound to a logical
position stays bound to it.

### 7. Failure Behavior

Schema violations report `invalid_message`. Structurally valid values that
violate this type's rules report `invalid_content`, including a span text
containing a line break, an unknown wrap mode, a fill line whose span is not
a single grapheme, a first Extend line declaring attributes, and an Extend
of a fill line. Unconfirmed use reports `unsupported_content_type`. Every
failure leaves the Block's content, lifecycle, and content-state identifier
unchanged.

## Compatibility and Fallback

`text/lines` complements `text/styled` rather than replacing it. A terminal
that implements only styling advertises `text/styled`; one that also
implements layout advertises both. An application prefers `text/lines` when
it is confirmed. Each type thus adds one reviewable step to what a terminal
must implement.

A terminal advertises `text/lines` only when it completely implements it,
including word wrapping, continuation prefixes, fill lines, and the
projections above. When it is not confirmed, the application falls back as
it chooses: render at the current width into `text/styled` (today's trial
behavior) or into `text/plain`. Because renderers already produce lines with
a first-row prefix and continuation indent, the application side is a
change of output shape: the
[layout experiment](../design/renderer-layout-and-reflow.md) shows the needed
information is present in a wide render.

## Security Considerations

Attributes are declarative and bounded by the display width; none moves the
cursor or addresses rows. A continuation prefix and a fill grapheme count
toward the content capacity policy. A long continuation prefix cannot starve
content because the terminal omits a prefix that leaves no width. As with
styling, a prefix can visually disguise text; copy and search operate on the
logical text without it.

## Alternatives and Prior Art

- **Bake layout at the current width** (status quo). Measured above: exact
  only while the width holds.
- **Render wide and rely on cell reflow.** Measured above: clean copy, but
  words split and prefixes are lost at every narrower width.
- **Re-render through Update on resize.** Exact, but forbids sealing,
  resends retained history per resize, and moves reading positions by Update
  rules instead of reflow.
- **A markup content type** (Markdown, HTML subset). Deferred again: it moves
  rendering decisions into the terminal and differs per renderer. Line
  layout attributes are what a markup renderer would produce anyway.
- **Hanging indent as a number of cells** instead of a prefix span list.
  Rejected: it cannot express repeated markers such as `│ `.

## Design Decisions

Decided while in Draft, 2026-10-19:

- Copy excludes continuation prefixes, with no option to include them. A
  copy option can be added later without changing the line model.
- The minimum `word` rule breaks at spaces and between wide characters;
  fuller line-breaking algorithms stay a terminal choice.
- `text/lines` and `text/styled` remain separate negotiated types.

## Unresolved Questions

- Break opportunities for scripts that neither use spaces nor render as wide
  characters, such as Thai.
- Whether a fill line takes a maximum width: Pi caps its rule at 80 cells,
  the only difference the line layout prototype found at 100 columns.
- The JSON encoding of lines, attributes, and fill lines.
- Whether code blocks need `none` (no wrap, horizontal truncation) in
  addition to `char`.

## Evidence Required Before Acceptance

- Protocol package: schema, validation, and serialization for lines, each
  attribute, both incremental Operations, and each failure above.
- Terminal module: line-aware content state, Extend and ReplaceSuffix across
  line boundaries, and resource accounting including prefixes.
- xterm host: word wrapping, continuation prefixes, and fill lines through
  reflow, with selection, copy, search, and reading anchors verified in the
  browser.
- The layout experiment re-run with Pi's wide render converted to
  `text/lines`: Pi's own layout reproduced at 36, 60, and 100 columns, or the
  remaining differences recorded.
- At least one sample with CJK text and one with nested lists.

## Experimental Evidence

- The [line layout prototype](../../prototypes/line-layout/README.md)
  implements the wrap, continuation, and fill rules as a pure layout engine.
  Pi 0.87.1's wide render of the layout experiment's sample, converted to
  `text/lines`, lays out at 36 and 60 columns exactly as Pi renders at those
  widths, styles included; at 100 columns only the rule differs, because Pi
  caps it at 80 cells. Cell reflow of the same render kept 13 of Pi's rows
  at either width.
- A second sample with Chinese prose, mixed Chinese and English, nested
  bullet and numbered lists, and a Chinese quote lays out exactly as Pi
  renders it at every width from 20 to 100 columns; cell reflow kept 13 of
  Pi's 26 rows at 36 columns. Over the same sweep the English sample differs
  only by the rule cap above 80 columns and, at 4 of 81 widths, by a Pi quirk:
  Pi keeps the space at a break that falls right after a styled span, while
  this RFC drops spaces at a break.
- The protocol, terminal, and SDK modules carry `text/lines` with an
  experimental JSON encoding: `{"type":"text/lines","data":[line, …]}` with
  `line = {"spans": [span…], "wrap"?: "word"|"char", "continuation"?: [span…],
  "fill"?: true}`, and Extend fragments and ReplaceSuffix replacements as
  line arrays, recognized by their first element's `spans` key. The
  [codec](../../protocol/test/lines-codec.test.ts),
  [Session](../../terminal/test/lines-content.test.ts), and
  [SDK](../../sdk/test/lines-content.test.ts) checks cover the rules of
  sections 1–5 and 7.
- The [xterm lines host](../../prototypes/integration/xterm-lines-host/README.md)
  executes `text/lines` on public xterm.js APIs: Pi's content sent through
  the SDK and the terminal module's endpoint fills the buffer exactly as Pi
  renders at 60 and 36 columns, keeps styles on continuation rows, copies
  and searches the logical text without prefixes, and keeps a reader's
  position across resizes. It redraws the whole history per change and has
  no browser selection or mixed ordinary output yet.
