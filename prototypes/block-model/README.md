# Block Model Prototype

This prototype tests the semantic model from
[the first prototype design note](../../docs/design/first-prototype.md). It is
not a wire-protocol implementation.

The model provides:

- append-only Block order;
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
- Content is plain text laid out by Unicode code point count, not terminal
  display width.
- The model does not parse escape sequences, render images, or drive a real
  terminal emulator.
- Complete Update of the Block containing the reading anchor remains
  undefined. ReplaceSuffix separately tests its defined retained-prefix and
  removed-suffix mappings.
- Operations are in-memory TypeScript values; no wire encoding is defined.
