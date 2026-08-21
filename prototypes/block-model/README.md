# Block Model Prototype

This prototype tests the semantic model from
[the first prototype design note](../../docs/design/first-prototype.md). It is
not a wire-protocol implementation.

The model provides:

- append-only Block order;
- full-snapshot updates to mutable Blocks;
- tail extension of mutable Blocks;
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
- The reading-anchor test updates a Block above the anchored Block. Mapping an
  anchor through changes to its own Block remains undefined.
- Operations are in-memory TypeScript values; no wire encoding is defined.
