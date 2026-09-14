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

## Verification Checkpoint

The current regression batch covers the listed ASCII/basic-CJK and Tab fixtures,
not every combination of terminal state. No new protocol semantics are selected
by these tests. This is a bounded checkpoint for moving on to host integration,
not a claim that terminal-native behavior is complete.

| Area | Evidence in this batch |
| --- | --- |
| Reading and tail following | [Chinese reflow and earlier content changes](scenarios/chinese-native-state.ts) |
| Selection and copy | [Retained/evicted Chinese and Tab selections](scenarios/chinese-capacity.ts) |
| Tail Append near capacity | [Retained/evicted selections and new searchable text](scenarios/chinese-append-capacity.ts) |
| Active input | [Historical content changes and synthetic composition](scenarios/chinese-native-state.ts), [capacity eviction](scenarios/chinese-capacity.ts) |
| Mixed output | [Chinese managed content beside ordinary ASCII](scenarios/chinese-mixed-selection.ts) |
| Queued capacity decisions | [Node tests](../xterm-protocol-endpoint/capacity.test.ts) reject edits of an evicted Block while preserving a retained update chain |

Deferred work includes resize that itself triggers capacity eviction, partial
or unmanaged-row trimming, broader Unicode and literal-Tab queries, real input
methods and clipboard interaction, and PTY/multiplexer/cross-terminal hosts.
Styled metadata needs a content representation first. These are distinct
extensions, not outcomes established by this checkpoint.

## Proven

The [real PTY demonstration](../pty-demo/README.md) supplies separate,
environment-specific process-to-browser evidence. Its later-Chinese-Block
selection failure led to the additional
[earlier Extend regression](scenarios/chinese-mixed-selection.ts) here: two
extensions preserve the later Chinese/Tab copy and reading anchor.

Sixty-six browser scenarios negotiate the baseline capability and open a
Context through encoded OSC Messages. Fifty-one use the protocol-only
endpoint path. Each of fifteen additional scenarios uses an independent raw
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

Three [Chinese/Tab scenarios](scenarios/plain-text-chinese.ts) add narrow evidence:

- selecting and copying `中文\t结果` survives a `20`-to-`5`-to-`9`-to-`20`-column
  resize sequence, without copying the unused cell before a wrapped wide glyph;
- selection endpoints inside `中` and `文` expand outward to include both whole
  characters, survive reflow to `3` columns, and do not change the partial-Tab
  rule in an adjacent selection; and
- after resize to `9` columns, Extend and ReplaceSuffix preserve a selected
  Chinese/Tab prefix using three raw scalars rather than eight display cells.
  Replacing a selected new glyph clears copy, and a subsequent full Update
  renders the new Chinese/Tab snapshot at the resized width.

The shared mapping supports ASCII and basic CJK ideographs `U+4E00..U+9FFF`
under the pinned xterm `6.0.0` default Unicode provider (`6`). Its two-cell
ideograph width is an experimental fixture, checked against that provider by
[Node tests](../../xterm-headless/plain-text.test.ts), not a protocol-mandated
width table. Unicode-provider changes while retaining content are not supported.

Four [Chinese search scenarios](scenarios/chinese-search.ts) additionally check
a match spanning wide-character reflow, the second identical match staying in
its Block after resize and earlier-Block updates, current versus removed matches
through Extend/ReplaceSuffix/Update, and adjacent identical matches reached by
find-next. They assert match text, copy payload, and physical endpoints.
The [search record](../xterm-browser-search/README.md#private-search-offset-workaround)
documents the reproduced padding-offset failure and local private-addon workaround.

Two further [capacity scenarios](scenarios/capacity.ts) combine that projection
with complete-Block eviction at `8` columns, `3` viewport rows, and `6`
scrollback rows. An Update's five-scalar snapshot occupies four physical rows
and evicts exactly the two rows of the oldest Tab-containing Block:

- an unaffected reader moves by one physical row while remaining at viewport
  top, and its selected text still copies as `r\ts`; and
- a selection in the evicted Block clears, including its Tab copy source;
  reading moves to the nearest retained Block without following the tail.

Both scenarios check the complete resulting Buffer rows and retain the evicted
Block's raw Session snapshot. They do not demonstrate partial-Block eviction,
Unicode alignment, or operating-system clipboard behavior.

Two [Chinese capacity search scenarios](scenarios/chinese-capacity.ts) use the
same dimensions with Chinese/Tab Blocks. An Update grows from one to four rows
and evicts exactly the two-row oldest Block. A retained Chinese match moves
with its Block and copies unchanged; an evicted match loses its selection and
copy source and cannot be found again. Both check full Buffer rows, retained
match endpoints, and raw Session snapshots, including the evicted Block's.
Capacity preflight uses the same pinned ASCII/basic-CJK width fixture as text
mapping; unmapped Unicode estimates still cannot authorize eviction.
Three additional cases in that file check retained/evicted reading positions
and Chinese/Tab selections, and preservation of an unwrapped ASCII input line.

Four [Chinese Append capacity cases](scenarios/chinese-append-capacity.ts) use
`8` columns, `3` viewport rows, and `6` scrollback rows: a three-row tail Append
evicts exactly a two-row oldest Block. A retained selection keeps its Chinese/Tab
copy; an evicted selection clears and reading moves forward. Separate search
cases preserve a retained current match or clear an evicted one. All check full
Buffer rows, retained Session snapshots, and that new text enters search while
evicted text leaves it.

Two [Chinese native-state cases](scenarios/chinese-native-state.ts) check reading
at the start of a retained Chinese Block through `20`-to-`5`-to-`9`-to-`20`
reflow and a later Update, followed by explicit tail following through reflow
and Extend. Separately, reflow to `9` columns and Extend/ReplaceSuffix/Update
preserve an unwrapped ASCII input line and synthetic composition.

One [Chinese mixed-selection case](scenarios/chinese-mixed-selection.ts) crosses
from a Chinese/Tab managed Block into ordinary ASCII output and survives a
`20`-to-`9`-to-`20` resize round trip. Extend adds text inside that selection;
ReplaceSuffix clears it when selected text is replaced. A reverse-boundary
selection clears on Update, while a new selection survives Seal and tail Append.
The copy assertions retain complete Tabs and one newline at each boundary.

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
  the listed resize dimensions, the original Update-driven complete-Block
  capacity boundary and the projected-text cases above, plus the ASCII and
  Chinese Append fixtures whose trim exactly matches one complete leading
  managed Block. They also exercise two
  adjacent-managed-Block copy fixtures, one with and one without an existing
  trailing line break, but only the outcomes listed above.
- Partial-Block trimming, Append-driven eviction outside the listed exact
  complete-leading-Block fixtures, dimensions beyond those listed, and Unicode
  content beyond the listed Chinese/Tab copy and search fixtures remain outside
  this experiment.
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
- Private xterm core fields, search-addon reconstruction, and the search-offset
  workaround remain experimental fixtures, not a proposed public Terminal API.
- The original mixed-stream selection evidence covers twelve printable-ASCII fixtures
  and synthetic browser copy events: seven single-boundary-crossing Operation
  fixtures at `20` columns, one exact-tail Extend fixture, one two-boundary
  Extend fixture with two soft wraps, one `20`-to-`10`-to-`20`-column resize
  round trip, and two capacity fixtures whose trim exactly matches one complete
  leading managed Block. Beyond the additional Chinese case above, Unicode,
  line breaks within selected content other
  than the tested trailing LF at an adjacent-managed-Block boundary, other
  resize dimensions, capacity trimming that reaches unmanaged or partial-Block
  rows, mouse selection, and the operating-system clipboard remain untested.
- The additional plain-text fixtures do not establish general Unicode cell
  mapping, rectangular selection, or literal-Tab search-query behavior. Only
  fully selected Tabs are reconstructed; partial-Tab selections use the
  selected display spaces. Tabs alongside Unicode outside the mapped basic-CJK
  range are conservatively rejected by this host's capacity preflight. The new
  Chinese fixtures do not exercise emoji, combining sequences, Unicode-provider
  changes, or Chinese mixed-output and eviction behavior beyond the listed
  cases above. The Chinese
  search cases do not test literal-Tab queries, general navigation, or search
  decorations.
- Arbitrary ordinary terminal output, a real PTY and TUI process, multiplexers,
  remote transport, other terminals, and cross-browser behavior are not
  tested by this fixture. See the separate PTY demonstration linked above for
  its fixed Windows process scenario and narrower compatibility findings.

## Updating the Block Being Read

Three [anchored-Update scenarios](scenarios/anchored-update.ts) exercise full
replacement of the Block at the reading position. Two use growth, shrinkage,
and empty content to check the local replacement-start viewport policy, exact
retained rows, clearing selection/copy in replaced content, and preserving a
later Block's selection/copy. A subsequent Extend and resize still work; explicit
searches find new text and do not find the replaced text. The third uses raw
mixed ingress: shrinkage below one screen retains its blank rows and positions
following ordinary output at the corrected native cursor.

This is bounded ASCII evidence for the [existing Update rule](../../../docs/protocol/terminal-native-behavior.md#4-updating-the-anchored-block),
not a new required viewport policy. The corresponding
[Node checks](../xterm-protocol-endpoint/anchored-update.test.ts) separately
exercise one complete-Block capacity eviction and rejection before mutation.

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
