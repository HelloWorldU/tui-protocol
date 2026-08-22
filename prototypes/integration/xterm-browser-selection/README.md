# xterm Browser Selection Integration Prototype

This browser-host experiment asks whether mutable xterm.js history can keep a
selection attached to unaffected Block content and clear it when a complete
`Update` replaces the selected Block.

It composes the private history mechanism from the [xterm-headless
prototype](../../xterm-headless/README.md) with the public selection and copy
surface of browser-hosted `@xterm/xterm` 6.0.0. The wrapper and its use of
private xterm.js Buffer internals are experimental fixtures, not a proposed
Terminal integration API.

## Proven

- In one browser scenario, selecting text in a later Block and growing an
  earlier Block moves the selection to the later Block's new physical rows.
- The selected text and the text supplied to xterm.js's `copy` event remain
  unchanged after that earlier-Block `Update`.
- In one browser scenario, a complete `Update` of the selected Block clears
  both its visible selection and subsequent copy source.

These scenarios provide narrow experimental evidence for the complete
`Update` rules in [Terminal-Native
Behavior](../../../docs/protocol/terminal-native-behavior.md#7-selection-and-copying).

## Not Proven

- Mouse-driven selection, the operating-system clipboard, accessibility
  selection, and cross-browser behavior are not exercised.
- Selection behavior for `Extend`, `ReplaceSuffix`, resize and reflow,
  capacity eviction, or a selection spanning multiple Blocks is not yet
  implemented or tested.
- The experiment applies Block Operations directly to the history fixture. It
  does not compose the OSC codec or protocol Session.

## Run

Build the browser fixture from the repository root:

```sh
pnpm build:xterm-browser-selection
```

For interactive inspection:

```sh
pnpm prototype:xterm-browser-selection
```

Then open the local URL printed by Vite. The page reports both scenarios as
passed or identifies the first failed assertion.
