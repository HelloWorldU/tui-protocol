# xterm Browser Protocol Endpoint Integration Prototype

This browser-host experiment asks whether all five current Block Operation
Messages can traverse OSC `9002`, the codec, Session, and mutable xterm.js
history path while preserving the terminal-native state already demonstrated
by separate browser fixtures.

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

Twenty-four browser scenarios first negotiate the baseline capability and open a
Context through encoded OSC Messages. They then demonstrate that:

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
  without following the tail, and leaves retained text searchable; and
- complete-Block capacity eviction leaves current input text, cursor, and focus
  unchanged.

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
- The scenarios exercise all five current Block Operation kinds, one fixed
  `20`-to-`10`-column resize, and one Update-driven complete-Block capacity
  eviction with printable ASCII fixtures, but only the outcomes listed above.
- Partial-Block trimming, Append-driven eviction, other dimensions, and
  non-ASCII content remain outside this composed experiment.
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
- Arbitrary ordinary terminal output interleaved with protocol frames through
  one mixed-stream ingress, a real PTY and TUI process, multiplexers, remote
  transport, other terminals, and cross-browser behavior are not tested.

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
