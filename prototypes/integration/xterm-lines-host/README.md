# xterm lines host prototype

## Question

Can a terminal host execute
[RFC 0003](../../../docs/rfcs/0003-line-layout-attributes.md) `text/lines`
end to end, so that a TUI's content, sent once without width breaks, shows
in a real xterm.js buffer exactly as the TUI's own renderer would lay it out
at every width, with copy, search, and reading position on the logical text?

## Composition

- the [terminal module](../../../terminal/README.md)'s
  `TerminalProtocolEndpoint` and Session, configured with the optional
  `text/lines` type, with this host as its Operation adapter;
- the [line layout engine and projection](../../line-layout/README.md),
  which decide rows and map cells to logical offsets; and
- the SGR translation from the
  [xterm headless spikes](../../xterm-headless/README.md).

`XtermLinesHost` is independent of the existing private-core history used by
the other xterm prototypes: it uses only public xterm.js APIs. After every
accepted content Operation and every resize it lays out each Block at the
current width and redraws the whole managed history, then restores a
history reader's top row to the same logical position, or keeps following
the tail. `copy` and `find` map buffer cells to Block logical text through
the projection. `text/plain` and `text/styled` Blocks are shown as
char-wrapped lines.

## Evidence

2026-10-19, Node with `@xterm/headless`:

- [End to end with Pi](../pi-stock-ui/lines-host.test.ts): Pi 0.87.1's wide
  render, converted to `text/lines` and sent by the SDK client, fills the
  buffer exactly as Pi renders at 60 and then 36 columns; at 100 columns only
  the full-width rule differs from Pi's 80-cell cap. Bold continues onto a
  wrapped row, the quote marker keeps its color on continuation rows, and
  streaming the answer line by line through Extend ends in the same rows.
  Copy of a quote spanning three rows yields its logical text without
  repeated markers; a search match crossing a soft break maps to its first
  cell, and a continuation marker is not searchable. The Chinese and
  nested-list sample also fills the buffer exactly as Pi renders at 60 and
  36 columns; a Chinese quote copies without its repeated marker and a
  search match split across its soft break maps to the right cells.
- [Browser checks](checks.ts), 2026-10-20, Chrome in the Claude desktop
  browser pane with the xterm.js DOM renderer: six scenarios pass on Pi's
  recorded content ([fixture](pi-lines-fixture.json), kept current by
  [a Node check](../pi-stock-ui/lines-fixture.test.ts)). Both samples fill
  the buffer as Pi renders at 60 and 36 columns; the DOM paints `xterm-bold`
  on the wrapped bold row and the repeated `│` in `rgb(128, 128, 128)`;
  copy events over selections across soft-wrapped quote rows, starting in a
  hanging indent, or over search matches split by a soft break (English and
  Chinese) yield logical text while xterm.js's own selection text still
  shows the repeated marker; a reader's top row stays in its Block across
  20, 60, and 40 columns. A manual mouse drag across the three quote rows
  of the page's demo terminal copied `A quoted paragraph that is long enough
  to wrap, so every quoted row needs its prefix.` as one line.
- [Host checks](lines-host.test.ts): a reader's top row stays on the same
  Block's text across 20, 60, and 40 columns; a tail-following viewport
  keeps following after Append and resize; Tab content is rejected before
  mutation.

## Run

```sh
pnpm prototype:xterm-lines-host
node prototypes/integration/pi-stock-ui/record-lines-fixture.ts
```

The first serves the browser checks (keep the page visible; the DOM renderer
paints only visible pages). The second re-records the Pi fixture after a Pi
or sample change.

## Limits

- Full redraw per change is O(history) and resets the terminal, so the host
  owns the whole screen: no ordinary output, mixed ingress, or application
  region. It shows the semantics, not a renderer design.
- Browser copy is a capture-phase copy listener (`browser-wiring.ts`); the
  checks use synthetic copy events, and the OS clipboard and keyboard copy
  shortcuts are not exercised. Search is the host's logical search plus
  xterm.js selection, not the search addon or its decorations.
- No Tab or control-label projection: such content is rejected with
  `resource_exhausted`.
- Anchors are restored to the logical offset at the top row's start; finer
  intra-row positions and selections across redraws are not preserved.
