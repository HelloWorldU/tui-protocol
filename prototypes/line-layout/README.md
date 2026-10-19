# Line layout prototype

## Question

Can a terminal reproduce a TUI renderer's layout at any width from the
line-level attributes proposed by
[RFC 0003](../../docs/rfcs/0003-line-layout-attributes.md), given content
rendered once without width breaks?

`layout.ts` is a pure layout engine for the proposed `text/lines` content: a
function from lines and a column count to display rows. It is the part of a
terminal-side implementation that decides rows; it does not render, track
history, or speak the wire protocol. `LayoutLine` is an experimental local
type, not a protocol schema.

## Rules implemented

- `word` wrap (default): a break opportunity follows each run of spaces and
  lies between two adjacent wide characters. Spaces at a break are dropped
  from display but remain logical text, so row offsets skip them. A word
  wider than the row starts a new row and then breaks between cells. Rows
  never end with displayed spaces. This matches the wrapping rule of Pi
  0.87.1's `wrapTextWithAnsi`.
- `char` wrap: breaks between cells.
- `continuation`: displayed at the start of every soft-wrapped row, narrowing
  that row's width; omitted when it would leave no width.
- `fill`: one grapheme repeated across the full width, in whole cells.

Each row records its source line, whether it is soft, its prefix width, and
the logical scalar offsets of its displayed text, which a host needs to map
selection, copy, and search back to logical text.

`cellWidth` is an experimental table: two cells for East Asian wide and
fullwidth ranges and common emoji, one otherwise.

## Evidence

- [Unit checks](layout.test.ts): nine rules above, including CJK breaking,
  prefix omission, and per-line offsets.
- [Pi comparison](../integration/pi-stock-ui/lines-layout.test.ts),
  2026-10-19: Pi's wide render of the
  [wrap sample](../integration/pi-stock-ui/wrap-sample.ts), converted to
  `text/lines` by
  [an experimental reader](../integration/pi-stock-ui/lines-from-render.ts),
  laid out at 36 and 60 columns, equals Pi's own render at those widths row
  for row, styles included. At 100 columns the only difference is the rule:
  Pi caps it at 80 cells, the fill line spans the width. The cell reflow of
  the same wide render keeps 13 of Pi's 29 or 24 rows
  ([layout experiment](../../docs/design/renderer-layout-and-reflow.md)).

## Limits

One renderer, one ASCII sample, and the engine alone: no xterm rendering,
history, selection, or wire encoding yet. The reader recovers layout intent
from rendered shapes of the sample's constructs; nested lists, tables, and
CJK prose have not been compared against a renderer.
