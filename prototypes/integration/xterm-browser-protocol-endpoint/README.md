# xterm Browser Protocol Endpoint Integration Prototype

This browser-host experiment asks whether OSC `9002` Update, Extend,
ReplaceSuffix, and Append Messages can traverse the current codec, Session, and
mutable xterm.js history path while preserving the terminal-native state
already demonstrated by separate browser fixtures.

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

Thirteen browser scenarios first negotiate the baseline capability and open a
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

Each scenario also observes the updated Session content after the rendered
history queue drains. This supplies narrow cross-layer evidence for the
[Terminal-Native Behavior](../../../docs/protocol/terminal-native-behavior.md)
requirements.

## Not Proven

- Search and ordinary user selection are separate scenarios because xterm.js's
  search addon presents its current match through the terminal selection.
- Content metadata is not composed because the protocol has not defined an
  optional styled content representation.
- The scenarios cover only complete Update, Extend, ReplaceSuffix, and Append
  with printable ASCII fixtures. Seal, resize, capacity eviction, and non-ASCII
  content remain covered only by their narrower component prototypes.
- Append while input is active remains outside the experiment because
  coordinating new output with the TUI's current input is not historical Block
  mutation.
- The composition event is synthetic and does not prove compatibility with a
  real operating-system IME.
- Private xterm core fields and explicit search-addon reconstruction remain
  experimental fixtures, not a proposed public Terminal API.
- Ordinary terminal output, a real PTY and TUI process, multiplexers, remote
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
