# Renderer-owned layout and terminal reflow

Working note, 2026-10-19. This note records an experiment on the tension the
[Pi stock-UI trial](../../prototypes/integration/pi-stock-ui/README.md#styled-transcript-content)
exposed: when an application lays out styled content itself and the terminal
owns reflow, which width should the application render at, and what is lost
either way? It is evidence for a future content proposal, not a protocol
document.

## Question and setup

[`text/styled`](../protocol/styled-text.md) carries the application's styling
decision; line breaks are part of the logical text, and the terminal wraps
longer lines itself. Pi's renderer, like most TUI renderers, decides layout
for a known width: it wraps prose at word boundaries, indents list
continuations, repeats quote markers, and draws rules to a length.

The [wrap-baking checks](../../prototypes/integration/pi-stock-ui/wrap-baking.test.ts)
render one fixed markdown sample (heading, prose with bold and inline code, a
bullet and a numbered item, a quote, a fenced code line, a rule) through Pi
0.87.1's real `AssistantMessageComponent`, append it as one sealed
`text/styled` Block through the experimental xterm endpoint at 60 columns,
resize to the display width, and compare the native rows with Pi's own layout
at that width. `node prototypes/integration/pi-stock-ui/wrap-probe.ts --rows`
prints the comparison.

## Results

| Render width | Display | Rows / Pi's | Pi's rows kept | Mid-word splits | Lost prefixes |
|---|---|---|---|---|---|
| 60 | 60 | 24 / 24 | 24 / 24 | 0 | 0 |
| 60 | 36 | 32 / 29 | 17 / 29 | 6 | 3 |
| 60 | 100 | 24 / 19 | 12 / 19 | 0 | 0 |
| 1000 (wide) | 60 | 25 / 24 | 13 / 24 | 6 | 3 |
| 1000 (wide) | 36 | 31 / 29 | 13 / 29 | 11 | 6 |
| 1000 (wide) | 100 | 19 / 19 | 17 / 19 | 1 | 0 |

"Lost prefixes" counts terminal-wrapped continuation rows of list or quote
lines that start without the indent or `│ ` marker Pi would give them. The
60-column render contains 6 line breaks that the wide render does not (11 at
36 columns): breaks inserted for width rather than for content.

## What each strategy costs

**Render at the current width (the trial's behavior).** Exact while the width
holds. Narrowing double-wraps: the terminal's soft wrap cuts words, and each
baked break then ends the row early (`…bold p` / `hrase that keeps going` /
`and inline code…`). Widening leaves the extra width unused. Because baked
breaks are logical line breaks, copying a paragraph yields lines broken at
the render width; [Plain Text Content](../protocol/plain-text.md#2-line-breaks)
keeps automatic wrapping out of copy, but cannot tell a baked break from a
real one.

**Render wide, keeping only content breaks.** Copy gets one line per
paragraph, and a wider display uses its width. But the terminal's reflow is
cell-based: it splits words at every narrower width and continues list and
quote lines at column 0 without their indent or marker. Elements drawn to a
length, such as Pi's rule (capped at 80 cells), spill onto extra rows.

**Re-render on every resize through Update** would reproduce Pi's layout
exactly. This was not tested. Under the current semantics it requires every
Block to stay mutable for its lifetime, because
[Update rejects a sealed Block](../protocol/operations.md#update); it sends a
full snapshot of the retained history per resize; and it moves reading
positions by the Update rules rather than by reflow.

## Inferences for a layout-aware content revision

The breakage concentrates in four observed behaviors, each of which a
terminal could execute from declarative data while keeping the ownership
split of [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md):

1. **Word-boundary soft wrapping** for prose. Pi wraps at words; xterm's
   reflow wraps at cells.
2. **A continuation prefix per logical line**: a hanging indent for list
   items and a repeated marker for quotes, applied to every soft-wrapped row.
   Whether copy includes a repeated marker is open.
3. **Width-relative fills** for rules (and plausibly code backgrounds),
   instead of runs of fixed length.
4. **No continuation prefix for code**: Pi wraps code lines by word like
   prose, breaks a word wider than the row between cells
   (`computeSomethingWithAVeryLongName(ar` / `gumentOne, …`), and does not
   repeat the code indent on wrapped rows. The
   [line layout prototype](../../prototypes/line-layout/README.md) later
   confirmed this is the same word rule.

These are this note's inferences from one sample, not adopted protocol
behavior. They suggest that the smallest useful step past
[RFC 0002](../rfcs/0002-styled-text-content.md)'s non-goals is line-level
layout attributes (wrap mode and continuation prefix) plus a fill element,
well short of tables or containers, with a wide render as the
application-side input.

## Limits

One application (Pi 0.87.1, dark theme), one ASCII sample, and xterm's
headless buffer reflow; no browser rendering, CJK or wide characters, nested
lists, tables, or other renderers. The row and prefix counts are heuristics
defined in [the experiment module](../../prototypes/integration/pi-stock-ui/wrap-experiment.ts).
