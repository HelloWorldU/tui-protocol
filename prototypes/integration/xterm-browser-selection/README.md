# xterm Browser Selection Integration Prototype

This browser-host experiment asks whether mutable xterm.js history can keep a
selection attached to unaffected Block content and clear it when a complete
`Update` replaces the selected Block. It also tests selection across
`ReplaceSuffix`'s retained-prefix boundary while a new suffix is inserted and
tests selection across resize and reflow.

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

The same browser run also demonstrates that:

- A selection entirely inside the retained prefix remains selected and copies
  the same text.
- A selection inside the old suffix replaced by new content is cleared together
  with its copy source.
- A selection crossing the retained-prefix boundary is cleared together with
  its copy source.

These `ReplaceSuffix` scenarios deliberately use one unwrapped ASCII line and
insert a non-empty replacement suffix.

The browser run further demonstrates that:

- A selection inside a Block remains attached to the same logical text when a
  narrower terminal reflows that Block across new physical rows.
- A selection in a later Block moves to that Block's new physical rows when an
  earlier Block reflows.
- Both scenarios require the subsequent xterm.js copy event to supply the same
  selected text.

The browser fixture converts each tested selection to a Block ID and ASCII
content offsets before resize, then reconstructs physical selection coordinates
after xterm.js reflow. This is a tested implementation fixture, not a proposed
Terminal integration design.

## Not Proven

- Mouse-driven selection, the operating-system clipboard, accessibility
  selection, and cross-browser behavior are not exercised.
- Selection behavior for `Extend`, capacity eviction, or a selection spanning
  multiple Blocks is not yet implemented or tested.
- Resize selection mapping for line breaks, wide or combining characters, and
  other non-ASCII text is not implemented or tested.
- ReplaceSuffix selection mapping for wrapped lines, line breaks, wide or
  combining characters, and other non-ASCII text is not implemented or tested.
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

Then open the local URL printed by Vite. The page reports the number of passed
scenarios or identifies the first failed assertion.
