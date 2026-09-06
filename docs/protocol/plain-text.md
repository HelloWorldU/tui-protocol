# Plain Text Content

| Field | Value |
|---|---|
| Status | Draft |
| Related drafts | [Content representation](content-representation.md), [Operations](operations.md), [Terminal-native behavior](terminal-native-behavior.md) |

This document defines the initial display, copy, and search semantics of
`text/plain` Block content. It does not change how frame-external ordinary
terminal bytes are interpreted.

## 1. Logical Content and Display

The `data` value remains the original sequence of Unicode scalar values.
Display processing does not rewrite it, alter its content-state identity, or
change the positions used by ReplaceSuffix. For example, CRLF counts as two
scalars, Tab as one, and ESC as one even when its visible label is longer.

The terminal derives layout and native text projections from that content.
It interprets the resulting complete content after each Operation; splitting
a CRLF pair between Append and Extend does not introduce a second line break.

## 2. Line Breaks

LF (`U+000A`), CRLF (`U+000D U+000A`), and bare CR (`U+000D`) each represent
one logical line break. Copy represents these breaks as LF. Automatic wrapping
does not add logical line breaks to copied text.

For example, `abc\rXY` displays `abc` and `XY` on separate lines. Unlike a
carriage return in ordinary terminal output, this CR cannot overwrite `abc`.

## 3. Tab Alignment

Tab (`U+0009`) provides alignment within the Block. The terminal chooses its
tab stops; interpretation does not depend on the global cursor or tab-stop
changes made by surrounding ordinary output. Copy preserves the original Tab
when that Tab is selected, rather than replacing it with its displayed spaces.

The protocol does not prescribe one tab width. If an endpoint selects only
part of a Tab's displayed span, copy contains the selected spaces instead of
that Tab. The terminal does not expand the selection to include the whole Tab.

## 4. Other Controls

C0 controls other than Tab, LF, and CR, together with DEL and C1 controls, are
displayed using visible labels. They are not executed, silently discarded, or
interpreted as drawing instructions. The terminal chooses the label spelling.

Copy and search operate on those visible labels, not the original control
characters. Copying an ESC label therefore cannot reconstruct an executable
escape sequence. Ordinary printable text remains literal; text/plain does not
interpret Markdown or other markup.

## Open Design Choices

- Detailed Unicode width, grapheme, and formatting-character behavior beyond
  the control ranges above.

## Experimental Evidence

The [xterm endpoint tests](../../prototypes/integration/xterm-protocol-endpoint/plain-text.test.ts)
exercise newline normalization, visible controls, all content-changing
Operations, raw scalar positions, and a CRLF pair split across Operations.
The [browser fixtures](../../prototypes/integration/xterm-browser-protocol-endpoint/scenarios/plain-text.ts)
exercise selected copy/search outcomes, fully and partially selected Tabs
through reflow, and one mixed-output copy case. Their [README](../../prototypes/integration/xterm-browser-protocol-endpoint/README.md)
records limitations. Label spelling and tab-stop implementation in those
fixtures are terminal choices, not protocol requirements.

The endpoint [capacity tests](../../prototypes/integration/xterm-protocol-endpoint/capacity.test.ts)
and [browser capacity record](../../prototypes/integration/xterm-browser-protocol-endpoint/README.md)
add bounded evidence for expanded text near capacity, including rejected
growth and selection behavior when exactly one complete oldest Block is evicted.
