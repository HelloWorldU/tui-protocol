# Block Model Prototype

This in-memory prototype tests the semantic model from
[the first prototype design note](../../docs/design/first-prototype.md).

The model provides:

- append-only Block order during normal Operations;
- explicit render-projection removal without changing protocol identity or lifecycle;
- full-snapshot updates to mutable Blocks;
- tail extension of mutable Blocks;
- Unicode-scalar suffix replacement of mutable Blocks;
- explicit lifecycle sealing;
- terminal-owned text layout and reflow;
- a semantic viewport anchor expressed as a Block ID and content offset.

The initial black-box scenario updates a mutable Block after it has entered
scrollback and verifies that a user reading a later Block remains anchored to
the same logical content without duplicated history rows.

## Run

```sh
pnpm install
pnpm test
pnpm typecheck
```

## Current Limits

- The prototype models one implicit Protocol Context and does not implement
  Context establishment, closure, or Context IDs on Operations.
- Content is plain text or a `text/styled` span list
  ([RFC 0002](../../docs/rfcs/0002-styled-text-content.md)), laid out by
  Unicode code point count of the logical text (the concatenated span texts),
  not terminal display width. Extend concatenates two span lists, and
  ReplaceSuffix counts its retained prefix in logical scalars across span
  boundaries, keeping a boundary-truncated span's style. Styling never enters
  layout.
- The model does not parse escape sequences, render images, or drive a real
  terminal emulator.
- Complete Update of the Block containing the reading anchor remains
  undefined in this model. The separate
  [xterm integration](../integration/xterm-protocol-endpoint/README.md#updating-the-block-being-read)
  now tests a local replacement-start policy. ReplaceSuffix separately tests
  its defined retained-prefix and removed-suffix mappings here.
- This prototype accepts in-memory TypeScript Operations and does not encode or
  decode wire Messages.
