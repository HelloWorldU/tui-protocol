# xterm Browser Protocol Endpoint Integration Prototype

This browser-host experiment asks whether all five current Block Operation
Messages can traverse OSC `9002`, the codec, Session, and mutable xterm.js
history path while preserving the tested terminal-native states. Separate
browser fixtures supply earlier evidence for the non-mixed selection, search,
and active-input cases; the mixed-boundary cases are exercised only here.

It composes:

- the [xterm protocol endpoint](../xterm-protocol-endpoint/README.md);
- the [browser selection prototype](../xterm-browser-selection/README.md);
- the [browser search prototype](../xterm-browser-search/README.md); and
- the observable input fixture from the [browser active input state
  prototype](../xterm-browser-input-state/README.md).

The endpoint uses one shared private history renderer. Selection mapping and
search restoration therefore observe the same accepted Operation and rendered
Block ranges rather than running against independent copies of history.

## Proven

Forty-four browser scenarios negotiate the baseline capability and open a
Context through encoded OSC Messages. Thirty-one use the protocol-only
endpoint path. Each of thirteen additional scenarios uses an independent raw
mixed-ingress path for both the Messages and ordinary terminal bytes. Together
they demonstrate that:

- an OSC Update grows an earlier Block while a later reading position and
  selection move with their unchanged Block and retain the same copied text;
- an OSC Update moves an unaffected current search match with its Block; and
- an OSC Update changes earlier history without changing a current input line,
  input cursor, focus, or synthetic browser composition.
- an OSC Extend grows a Block while preserving a reading position and selected
  copy source in its retained content;
- an OSC Extend preserves an existing current search match and makes its new
  fragment searchable; and
- an OSC Extend grows earlier history without changing current input or
  synthetic browser composition.
- an OSC ReplaceSuffix preserves a reading position and selected copy source
  inside its retained prefix while growing the rendered Block;
- an OSC ReplaceSuffix clears a selection and copy source inside its removed
  suffix;
- an OSC ReplaceSuffix keeps a retained-prefix search match, removes the old
  suffix from search, and makes the replacement searchable; and
- an OSC ReplaceSuffix changes earlier history without changing current input
  or synthetic browser composition.
- an OSC Append adds a new logical tail Block while preserving an existing
  history-reading position, selection, and copy source;
- an OSC Append keeps a tail-following viewport at the new logical tail; and
- an OSC Append preserves an existing current search match and makes the new
  Block searchable.
- an OSC Seal changes a Block's Session lifecycle without changing its rendered
  rows, history-reading position, selection, or copy source, and a later Update
  returns the correlated `block_sealed` error without changing content; and
- an OSC Seal preserves the current search match and searchable text in its
  Block.
- a browser resize reflows Block ranges while preserving a history-reading
  position, selection, copy source, and a subsequent OSC Update;
- browser resize preserves a current search match, active input, and
  tail-following state in separate scenarios;
- an Update-driven complete-Block capacity eviction preserves a retained
  history-reading position, selection, copy source, and search match;
- the same capacity boundary clears a selection or search match inside the
  evicted Block, moves an evicted reading position to the next retained Block
  without following the tail, and leaves retained text searchable;
- complete-Block capacity eviction leaves current input text, cursor, and focus
  unchanged;
- in one protocol-only capacity fixture, an OSC Append evicts exactly one
  complete leading managed Block containing the reading position and selection;
  the selection and copy source clear, the viewport moves to the next retained
  Block without following the tail, and the new Block appears once at the
  logical tail;
- when a selection spans adjacent managed Blocks and the earlier Block has no
  trailing line break, copying represents their boundary with one normalized
  newline;
- when the earlier selected Block already ends with a line break, copying does
  not add a second newline at the adjacent managed-Block boundary;
- when a selection crosses from a managed Block into one following unmanaged
  ASCII row, growing and then shrinking an earlier Block moves the selection
  with the same content and preserves a copy result containing exactly one
  normalized newline at the boundary;
- when a selection crosses from an unmanaged ASCII row into a managed Block,
  an Update of that Block clears the complete selection and subsequent copy
  source while leaving the Context open;
- when a selection crosses from a managed Block into a following unmanaged
  ASCII row, Extend preserves both endpoints while its appended fragment makes
  the Block one physical row taller and becomes part of the copy result;
- when a selection crosses from an unmanaged ASCII row into a managed Block and
  ends before its logical tail, Extend preserves both endpoints while its
  appended fragment remains outside the copy result;
- when a selection crosses from an unmanaged ASCII row into a managed Block's
  retained prefix, ReplaceSuffix changes only the unselected suffix and leaves
  both endpoints and the copy result unchanged;
- when a selection crosses from a managed Block into a following unmanaged
  ASCII row and includes the removed suffix, ReplaceSuffix clears the complete
  selection and copy source; and
- sealing the managed side of a cross-boundary selection and then appending a
  later Block changes neither endpoint nor the copy result;
- when a selection ends exactly at a managed Block's old logical tail, Extend
  leaves that endpoint before the appended fragment, so the existing selection
  and copy result do not expand;
- when a selection crosses two managed/unmanaged boundaries, Extend can add two
  soft wraps between its endpoints without adding copied newlines for those
  wraps, while each managed/unmanaged boundary contributes one copied newline;
- a tested `20`-to-`10`-to-`20`-column resize round trip reflows both managed
  and unmanaged text while keeping both endpoints attached to the same logical
  ASCII offsets and preserving the copy result;
- capacity eviction that removes exactly one complete managed Block before a
  mixed selection keeps both retained endpoints and the copy result attached;
  and
- capacity eviction that removes the managed start of a mixed selection clears
  the complete selection and copy source while retaining its unmanaged row.

Five [plain-text scenarios](scenarios/plain-text.ts) additionally exercise the
[baseline text projection](../../../docs/protocol/plain-text.md):

- CR, CRLF, and LF copy as LF; a multiline selection retains that copy result
  through `40`-to-`10`-column reflow. ESC displays and copies as `<U+001B>`,
  which search finds instead of the original escape bytes;
- fully selected Tabs copy as HT through a `20`-to-`6`-to-`20`-column reflow
  round trip, although the display contains expanded spaces;
- Extend and ReplaceSuffix preserve a selected prefix containing a Tab and ESC
  using raw scalar positions; full Update clears that selection; and
- one mixed-output selection copies a managed Tab, an ordinary row, and a
  later Block with one LF at each boundary; and
- partial Tabs copy only the selected spaces while complete Tabs copy as HT,
  including in one reflow case and one complete trailing-Tab case.

The host uses ASCII `<U+XXXX>` labels and `tabStopWidth` logical-line stops
(default `8`), independent of viewport width. Those are implementation fixtures,
not protocol requirements. A capture-phase copy handler restores fully selected
managed Tabs and normalizes copied newlines. `getSelection()` still exposes
xterm's displayed text; the copy-event payload is the copy oracle. Tab settings
are held fixed while content is retained.

Across these scenarios, the fixture drains the rendered-history queue before
observing terminal state and checks Session content where it is part of the
scenario's assertion. This supplies narrow cross-layer evidence for the
[Terminal-Native Behavior](../../../docs/protocol/terminal-native-behavior.md)
requirements.

## Not Proven

- Search and ordinary user selection are separate scenarios because xterm.js's
  search addon presents its current match through the terminal selection.
- Content metadata is not composed because the protocol has not defined an
  optional styled content representation.
- The protocol-only scenarios exercise all five current Block Operation kinds,
  one fixed `20`-to-`10`-column resize, one Update-driven complete-Block
  capacity boundary, and one Append-driven fixture whose trim exactly matches
  one complete leading managed Block. They also exercise two
  adjacent-managed-Block copy fixtures, one with and one without an existing
  trailing line break, but only the outcomes listed above.
- Partial-Block trimming, Append-driven eviction outside that one exact
  complete-leading-Block fixture, dimensions beyond those listed, and non-ASCII content
  remain outside this composed experiment.
- Capacity eviction removes the tested Block's rendered range while Session
  retains its logical snapshot. The experiment does not define forgotten-Block
  lifecycle or prove complete memory reclamation.
- Append while input is active remains outside the experiment because
  coordinating new output with the TUI's current input is not historical Block
  mutation.
- Seal has no active-input scenario because it changes Session lifecycle
  without enqueueing a content render; the experiment claims only the tested
  lifecycle, rejection, selection, and search outcomes.
- The composition event is synthetic and does not prove compatibility with a
  real operating-system IME.
- Private xterm core fields and explicit search-addon reconstruction remain
  experimental fixtures, not a proposed public Terminal API.
- The original mixed-stream selection evidence covers twelve printable-ASCII fixtures
  and synthetic browser copy events: seven single-boundary-crossing Operation
  fixtures at `20` columns, one exact-tail Extend fixture, one two-boundary
  Extend fixture with two soft wraps, one `20`-to-`10`-to-`20`-column resize
  round trip, and two capacity fixtures whose trim exactly matches one complete
  leading managed Block. Unicode, line breaks within selected content other
  than the tested trailing LF at an adjacent-managed-Block boundary, other
  resize dimensions, capacity trimming that reaches unmanaged or partial-Block
  rows, mouse selection, and the operating-system clipboard remain untested.
- The additional plain-text fixtures do not establish general Unicode cell
  mapping, rectangular selection, or literal-Tab search-query behavior. Only
  fully selected Tabs are reconstructed; partial-Tab selections use the
  selected display spaces. Tabs alongside
  non-ASCII text are conservatively rejected by this host's capacity preflight.
- Arbitrary ordinary terminal output, a real PTY and TUI process, multiplexers,
  remote transport, other terminals, and cross-browser behavior are not
  tested.

## Run

Build the browser fixture from the repository root:

```sh
pnpm build:xterm-browser-protocol-endpoint
```

For interactive inspection:

```sh
pnpm prototype:xterm-browser-protocol-endpoint
```

Then open the local URL printed by Vite. The page reports whether all browser
endpoint scenarios passed or identifies the first failed assertion.
