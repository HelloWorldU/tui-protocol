# xterm Browser Active Input State Integration Prototype

This browser-host experiment asks whether changing retained Block history can
leave xterm.js's current input text, input cursor, focus, and in-progress input
composition unchanged.

It composes the private history mechanism from the [xterm-headless
prototype](../../xterm-headless/README.md) with browser-hosted `@xterm/xterm`
6.0.0. The fixture writes one printable ASCII prompt and input line after the
Block history, moves the xterm cursor within that input, and focuses xterm's
textarea. Those writes model observable terminal state; they are not proposed
protocol Messages or an input-widget API.

## Proven

Five browser scenarios demonstrate that, within the tested fixture:

- growing an earlier Block with Update changes neither active input text, its
  logical cursor offset, nor input focus;
- Extend and ReplaceSuffix on historical content preserve the same three input
  properties;
- resizing and reflowing earlier history moves the input physically while
  preserving its text, logical cursor offset, and focus;
- complete-Block capacity eviction preserves the active input; and
- a synthetic browser composition remains active and sends no input data while
  an earlier Block is updated.

This provides narrow experimental evidence for [Active Input
State](../../../docs/protocol/terminal-native-behavior.md#10-active-input-state).

The separate [browser endpoint native-state cases](../xterm-browser-protocol-endpoint/scenarios/chinese-native-state.ts)
compose Chinese/Tab history, OSC Messages, and an unwrapped ASCII input line,
including synthetic composition across reflow and content Operations. Its
[capacity case](../xterm-browser-protocol-endpoint/scenarios/chinese-capacity.ts)
also checks input through Chinese Update-driven eviction. These do not change
this standalone page's scenario count or demonstrate a real IME.

## Not Proven

- The composition scenario dispatches browser `CompositionEvent` objects. It
  does not prove compatibility with a real operating-system IME, mobile
  keyboard, speech input, or assistive technology.
- The fixture is limited to one printable ASCII input line that remains
  physically unwrapped. Multiline editors, wide and combining characters,
  emoji, input selection, and application-owned editor models are not tested.
- Append while input is active is not tested because coordinating new output
  with the TUI's current input is outside historical Block mutation.
- Partial-Block and Append-driven capacity eviction are not tested.
- The experiment applies Block Operations directly to the history fixture. It
  does not compose the OSC codec or protocol Session and does not establish
  cross-terminal or cross-browser compatibility.

## Run

Build the browser fixture from the repository root:

```sh
pnpm build:xterm-browser-input-state
```

For interactive inspection:

```sh
pnpm prototype:xterm-browser-input-state
```

Then open the local URL printed by Vite. The page reports whether all
active-input scenarios passed or identifies the first failed assertion.
