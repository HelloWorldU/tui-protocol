# xterm Browser Content Metadata Integration Prototype

This browser-host experiment asks whether metadata remains attached to the
current logical content snapshot when mutable xterm.js history is replaced,
moved, reflowed, or evicted.

It composes the private history mechanism from the [xterm-headless
prototype](../../xterm-headless/README.md) with browser-hosted `@xterm/xterm`
6.0.0. A small experimental styled-text fixture projects foreground color and
bold weight into native xterm cells. It uses SGR only to create those cell
attributes; neither SGR nor this temporary representation is a proposed
protocol encoding or content type.

## Observed Behavior

Five browser scenarios demonstrate that, for the tested printable ASCII and
cell-style fixture:

- Update replaces the old snapshot's style with the replacement style.
- An Update whose replacement declares no style does not retain the old style.
- Styling in an unaffected later Block moves with that Block when an earlier
  Block grows.
- Styling stays attached to the same characters when resize reflows a Block.
- Complete-Block capacity eviction removes the evicted Block's style without
  changing styling in a retained Block.

These scenarios check [Content
Metadata](../../../docs/protocol/terminal-native-behavior.md#9-content-metadata).

## Scope and Limits

- Links, decorations, semantic annotations, and metadata beyond foreground
  color and bold weight are not tested.
- The fixture is limited to printable, single-line ASCII logical content. It
  does not test explicit line breaks, wide or combining characters, or emoji.
- Incremental Operations are not tested because metadata editing depends on a
  future optional content representation's own schema and semantics.
- Partial-Block or Append-driven capacity eviction is not tested.
- Operations are applied directly to the history fixture, followed by private
  xterm cell-attribute writes. OSC/Session composition and cross-browser behavior
  remain untested.

## Run

Build the browser fixture from the repository root:

```sh
pnpm build:xterm-browser-metadata
```

For interactive inspection:

```sh
pnpm prototype:xterm-browser-metadata
```

Then open the local URL printed by Vite. The page reports whether all metadata
scenarios passed or identifies the first failed assertion.
